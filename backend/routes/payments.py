"""
支付 API 路由
"""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from backend.database.config import get_db
from backend.models.order import Order, OrderStatus
from backend.models.payment import Payment
from backend.models.table import RestaurantTable

router = APIRouter()


class PaymentInput(BaseModel):
    method: str
    amount: float
    reference: str = ""
    operator: str = ""
    shift_id: Optional[str] = None


class CheckoutRequest(BaseModel):
    payments: List[PaymentInput]
    rounding: float = 0
    operator: str = ""
    shift_id: Optional[str] = None


@router.post("/{order_id}/checkout")
def checkout(order_id: str, data: CheckoutRequest, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="訂單不存在")
    if order.status != OrderStatus.OPEN.value:
        raise HTTPException(status_code=400, detail="訂單已結帳")

    total_paid = 0
    for p in data.payments:
        payment = Payment(
            order_id=order_id,
            method=p.method,
            amount=p.amount,
            reference=p.reference,
            operator=p.operator or data.operator,
            shift_id=p.shift_id or data.shift_id,
        )
        db.add(payment)
        total_paid += p.amount

    order.rounding = round(data.rounding, 2)
    order.total = round(order.subtotal - order.discount_total + order.tax_total + order.rounding, 2)
    order.paid_amount = round(total_paid, 2)
    order.status = OrderStatus.PAID.value
    order.paid_at = datetime.now()
    order.closed_at = datetime.now()

    # 釋放桌台
    if order.table_id:
        table = db.query(RestaurantTable).filter(RestaurantTable.id == order.table_id).first()
        if table:
            table.status = "available"
            table.current_order_id = None

    db.commit()
    db.refresh(order)
    return {"order": order.to_dict()}


@router.post("/{order_id}/send-to-kitchen")
def send_to_kitchen(order_id: str, db: Session = Depends(get_db)):
    """將未送廚的菜品狀態改為 SENT_TO_KITCHEN"""
    from backend.models.order import OrderItem, OrderItemStatus

    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="訂單不存在")

    for item in order.items:
        if item.status == OrderItemStatus.NEW.value:
            item.status = OrderItemStatus.SENT_TO_KITCHEN.value
            item.sent_to_kitchen_at = datetime.now()

    db.commit()
    db.refresh(order)
    return {"order": order.to_dict()}


@router.post("/{order_id}/refund")
def refund_order(order_id: str, db: Session = Depends(get_db)):
    """整單退款"""
    from backend.services.audit_service import write_audit_log

    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="訂單不存在")

    order.status = OrderStatus.REFUNDED.value
    order.closed_at = datetime.now()

    write_audit_log(db, "refund", "order", order.id,
                    old_value=str(order.total), operator="system", reason="整單退款")

    if order.table_id:
        table = db.query(RestaurantTable).filter(RestaurantTable.id == order.table_id).first()
        if table:
            table.status = "available"
            table.current_order_id = None

    db.commit()
    return {"message": "退款完成", "order": order.to_dict()}

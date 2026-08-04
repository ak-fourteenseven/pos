"""
訂單 API 路由 - 核心收銀邏輯
"""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import desc
from pydantic import BaseModel
from typing import Optional, List
from backend.database.config import get_db
from backend.models.order import Order, OrderItem, OrderSource, OrderStatus, OrderItemStatus
from backend.models.table import RestaurantTable
from backend.models.audit import AuditLog
from backend.services.audit_service import write_audit_log

router = APIRouter()


class OrderItemInput(BaseModel):
    product_id: str
    product_name: str
    quantity: int = 1
    unit_price: float
    note: str = ""


class CreateOrderRequest(BaseModel):
    source: str = "dine_in"
    table_id: Optional[str] = None
    table_name: str = ""
    customer_name: str = ""
    customer_phone: str = ""
    items: List[OrderItemInput]
    operator: str = ""


class AddItemsRequest(BaseModel):
    items: List[OrderItemInput]
    operator: str = ""


class RemoveItemRequest(BaseModel):
    item_id: str
    reason: str = ""
    operator: str = ""


class ApplyDiscountRequest(BaseModel):
    discount_amount: float = 0
    reason: str = ""
    operator: str = ""


@router.get("")
def list_orders(
    status: Optional[str] = None,
    source: Optional[str] = None,
    date: Optional[str] = None,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    q = db.query(Order).order_by(desc(Order.created_at))
    if status:
        q = q.filter(Order.status == status)
    if source:
        q = q.filter(Order.source == source)
    if date:
        q = q.filter(Order.created_at >= datetime.fromisoformat(date))
    orders = q.limit(limit).all()
    return {"orders": [o.to_summary() for o in orders]}


@router.get("/{order_id}")
def get_order(order_id: str, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="訂單不存在")
    return {"order": order.to_dict()}


@router.post("")
def create_order(data: CreateOrderRequest, db: Session = Depends(get_db)):
    if not data.items:
        raise HTTPException(status_code=400, detail="訂單至少需要一個商品")

    # 生成訂單號：年月日時分秒 + 序號
    now = datetime.now()
    order_number = now.strftime("%Y%m%d%H%M%S") + str(now.microsecond % 1000).zfill(3)

    subtotal = 0
    order_items = []
    for item in data.items:
        item_subtotal = round(item.unit_price * item.quantity, 2)
        subtotal += item_subtotal
        order_items.append(OrderItem(
            product_id=item.product_id,
            product_name=item.product_name,
            quantity=item.quantity,
            unit_price=item.unit_price,
            subtotal=item_subtotal,
            note=item.note,
            status=OrderItemStatus.NEW.value,
        ))

    order = Order(
        order_number=order_number,
        source=data.source,
        table_id=data.table_id,
        table_name=data.table_name,
        customer_name=data.customer_name,
        customer_phone=data.customer_phone,
        subtotal=round(subtotal, 2),
        total=round(subtotal, 2),
        items=order_items,
        created_by=data.operator,
    )

    db.add(order)

    # 更新桌台狀態
    if data.table_id:
        table = db.query(RestaurantTable).filter(RestaurantTable.id == data.table_id).first()
        if table:
            table.status = "occupied"
            table.current_order_id = order.id

    db.commit()
    db.refresh(order)
    return {"order": order.to_dict()}


@router.post("/{order_id}/items")
def add_items(order_id: str, data: AddItemsRequest, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="訂單不存在")
    if order.status != OrderStatus.OPEN.value:
        raise HTTPException(status_code=400, detail="訂單已關閉，無法加菜")

    for item in data.items:
        item_subtotal = round(item.unit_price * item.quantity, 2)
        order_item = OrderItem(
            order_id=order_id,
            product_id=item.product_id,
            product_name=item.product_name,
            quantity=item.quantity,
            unit_price=item.unit_price,
            subtotal=item_subtotal,
            note=item.note,
        )
        order.items.append(order_item)
        order.subtotal = round(order.subtotal + item_subtotal, 2)

    order.total = round(order.subtotal - order.discount_total + order.tax_total + order.rounding, 2)
    db.commit()
    db.refresh(order)
    return {"order": order.to_dict()}


@router.post("/{order_id}/items/remove")
def remove_item(order_id: str, data: RemoveItemRequest, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="訂單不存在")
    if order.status != OrderStatus.OPEN.value:
        raise HTTPException(status_code=400, detail="訂單已關閉，無法刪菜")

    item = db.query(OrderItem).filter(OrderItem.id == data.item_id, OrderItem.order_id == order_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="明細不存在")

    # 審計留痕
    write_audit_log(db, "delete_item", "order_item", item.id,
                    old_value=f"{item.product_name} x{item.quantity} ${item.subtotal}",
                    operator=data.operator, reason=data.reason)

    order.subtotal = round(order.subtotal - item.subtotal, 2)
    order.total = round(order.subtotal - order.discount_total + order.tax_total + order.rounding, 2)
    db.delete(item)
    db.commit()
    db.refresh(order)
    return {"order": order.to_dict()}


@router.post("/{order_id}/discount")
def apply_discount(order_id: str, data: ApplyDiscountRequest, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="訂單不存在")

    old_discount = order.discount_total
    order.discount_total = round(data.discount_amount, 2)
    order.total = round(order.subtotal - order.discount_total + order.tax_total + order.rounding, 2)

    write_audit_log(db, "apply_discount", "order", order.id,
                    old_value=str(old_discount), new_value=str(data.discount_amount),
                    operator=data.operator, reason=data.reason)

    db.commit()
    db.refresh(order)
    return {"order": order.to_dict()}


@router.get("/active/tables")
def get_active_tables(db: Session = Depends(get_db)):
    """獲取所有有活躍訂單的桌台及其訂單摘要"""
    active_orders = db.query(Order).filter(Order.status == OrderStatus.OPEN.value, Order.table_name.isnot(None), Order.table_name != "").all()
    tables_data = {}
    for order in active_orders:
        if order.table_name and order.table_name not in tables_data:
            tables_data[order.table_name] = {
                "tableId": order.table_id,
                "tableName": order.table_name,
                "orderId": order.id,
                "orderNumber": order.order_number,
                "total": order.total,
                "itemCount": len(order.items) if order.items else 0,
            }
    return {"tables": list(tables_data.values())}


@router.get("/kds/pending")
def get_kds_pending(db: Session = Depends(get_db)):
    """KDS 端獲取待處理/製作中的菜品"""
    items = db.query(OrderItem).filter(
        OrderItem.status.in_([OrderItemStatus.SENT_TO_KITCHEN.value, OrderItemStatus.COOKING.value])
    ).order_by(OrderItem.sent_to_kitchen_at).all()

    result = []
    for item in items:
        order = db.query(Order).filter(Order.id == item.order_id).first()
        result.append({
            **item.to_dict(),
            "orderNumber": order.order_number if order else "",
            "tableName": order.table_name if order else "",
        })
    return {"items": result}

"""
班次 API 路由
"""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import desc
from pydantic import BaseModel
from typing import Optional
from backend.database.config import get_db
from backend.models.shift import Shift
from backend.models.order import Order, OrderStatus
from backend.models.payment import Payment

router = APIRouter()


class OpenShiftRequest(BaseModel):
    operator: str
    opening_cash: float = 0


class CloseShiftRequest(BaseModel):
    actual_cash: float = 0
    note: str = ""


@router.post("/open")
def open_shift(data: OpenShiftRequest, db: Session = Depends(get_db)):
    """開班"""
    # 檢查有無未結班次
    existing = db.query(Shift).filter(Shift.status == "open").first()
    if existing:
        raise HTTPException(status_code=400, detail="已有未結班次，請先結班")

    now = datetime.now()
    shift_number = "SH" + now.strftime("%Y%m%d%H%M%S")
    shift = Shift(
        shift_number=shift_number,
        operator=data.operator,
        opening_cash=data.opening_cash,
        opened_at=now,
    )
    db.add(shift)
    db.commit()
    db.refresh(shift)
    return {"shift": shift.to_dict()}


@router.post("/close")
def close_shift(data: CloseShiftRequest, db: Session = Depends(get_db)):
    """結班 - 計算當班銷售數據"""
    shift = db.query(Shift).filter(Shift.status == "open").first()
    if not shift:
        raise HTTPException(status_code=400, detail="沒有已開班的班次")

    # 統計當班收款
    payments = db.query(Payment).filter(
        Payment.shift_id == shift.id
    ).all()

    cash_total = 0
    wechat_total = 0
    alipay_total = 0
    card_total = 0
    other_total = 0

    for p in payments:
        if p.method == "cash":
            cash_total += p.amount
        elif p.method == "wechat":
            wechat_total += p.amount
        elif p.method == "alipay":
            alipay_total += p.amount
        elif p.method == "card":
            card_total += p.amount
        else:
            other_total += p.amount

    # 統計退款
    refunded = db.query(Order).filter(
        Order.status == OrderStatus.REFUNDED.value,
        Order.closed_at >= shift.opened_at,
    ).all()
    refund_total = sum(o.total for o in refunded)

    expected_cash = round(shift.opening_cash + cash_total - refund_total, 2)
    difference = round(data.actual_cash - expected_cash, 2)

    shift.cash_sales = round(cash_total, 2)
    shift.wechat_sales = round(wechat_total, 2)
    shift.alipay_sales = round(alipay_total, 2)
    shift.card_sales = round(card_total, 2)
    shift.other_sales = round(other_total, 2)
    shift.total_sales = round(cash_total + wechat_total + alipay_total + card_total + other_total, 2)
    shift.refund_total = round(refund_total, 2)
    shift.expected_cash = expected_cash
    shift.actual_cash = data.actual_cash
    shift.difference = difference
    shift.note = data.note
    shift.closed_at = datetime.now()
    shift.status = "closed"

    db.commit()
    db.refresh(shift)
    return {"shift": shift.to_dict()}


@router.get("/current")
def get_current_shift(db: Session = Depends(get_db)):
    """獲取當前活躍班次"""
    shift = db.query(Shift).filter(Shift.status == "open").first()
    return {"shift": shift.to_dict() if shift else None}


@router.get("")
def list_shifts(limit: int = 20, db: Session = Depends(get_db)):
    shifts = db.query(Shift).order_by(desc(Shift.opened_at)).limit(limit).all()
    return {"shifts": [s.to_dict() for s in shifts]}

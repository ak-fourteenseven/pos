"""
庫存 API 路由
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import desc
from pydantic import BaseModel
from typing import Optional
from backend.database.config import get_db
from backend.models.inventory import InventoryRecord

router = APIRouter()


class InventoryRecordInput(BaseModel):
    product_name: str
    record_type: str  # purchase / check / waste
    quantity: float
    unit: str = "kg"
    unit_price: float = 0
    operator: str = ""
    note: str = ""


@router.get("")
def list_records(
    record_type: Optional[str] = None,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    q = db.query(InventoryRecord).order_by(desc(InventoryRecord.created_at))
    if record_type:
        q = q.filter(InventoryRecord.record_type == record_type)
    records = q.limit(limit).all()
    return {"records": [r.to_dict() for r in records]}


@router.post("")
def add_record(data: InventoryRecordInput, db: Session = Depends(get_db)):
    total = round(data.quantity * data.unit_price, 2)
    record = InventoryRecord(
        product_name=data.product_name,
        record_type=data.record_type,
        quantity=data.quantity,
        unit=data.unit,
        unit_price=data.unit_price,
        total_cost=total,
        operator=data.operator,
        note=data.note,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return {"record": record.to_dict()}


@router.get("/summary")
def inventory_summary(db: Session = Depends(get_db)):
    """按商品名稱匯總庫存（進貨 - 損耗），簡單加總"""
    records = db.query(InventoryRecord).all()
    summary = {}
    for r in records:
        if r.product_name not in summary:
            summary[r.product_name] = {"productName": r.product_name, "totalIn": 0, "totalOut": 0, "unit": r.unit}
        if r.record_type == "purchase":
            summary[r.product_name]["totalIn"] += r.quantity
        elif r.record_type == "waste":
            summary[r.product_name]["totalOut"] += r.quantity
        elif r.record_type == "check":
            summary[r.product_name]["totalIn"] = r.quantity

    for name in summary:
        s = summary[name]
        s["currentStock"] = round(s["totalIn"] - s["totalOut"], 2)

    return {"summary": list(summary.values())}

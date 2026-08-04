"""
桌台管理 API 路由
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from backend.database.config import get_db
from backend.models.table import RestaurantTable
from backend.models.order import Order, OrderStatus

router = APIRouter()


class TableCreate(BaseModel):
    name: str
    capacity: int = 4


@router.get("")
def list_tables(db: Session = Depends(get_db)):
    tables = db.query(RestaurantTable).order_by(RestaurantTable.name).all()
    return {"tables": [t.to_dict() for t in tables]}


@router.post("")
def create_table(body: TableCreate, db: Session = Depends(get_db)):
    # 檢查桌台名稱是否重複
    existing = db.query(RestaurantTable).filter(RestaurantTable.name == body.name).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"桌台名稱「{body.name}」已存在")

    if body.capacity < 2 or body.capacity > 20:
        raise HTTPException(status_code=400, detail="容量必須在 2-20 之間")

    table = RestaurantTable(
        name=body.name,
        capacity=body.capacity,
        status="available",
    )
    db.add(table)
    db.commit()
    db.refresh(table)
    return {"table": table.to_dict()}


@router.delete("/{table_id}")
def delete_table(table_id: str, db: Session = Depends(get_db)):
    table = db.query(RestaurantTable).filter(RestaurantTable.id == table_id).first()
    if not table:
        raise HTTPException(status_code=404, detail="桌台不存在")

    # 檢查是否有進行中的訂單
    active_order = (
        db.query(Order)
        .filter(
            Order.table_name == table.name,
            Order.status == OrderStatus.OPEN,
        )
        .first()
    )
    if active_order:
        raise HTTPException(
            status_code=409,
            detail=f"桌台「{table.name}」有進行中的訂單（{active_order.order_number}），無法刪除",
        )

    db.delete(table)
    db.commit()
    return {"message": f"桌台「{table.name}」已刪除"}

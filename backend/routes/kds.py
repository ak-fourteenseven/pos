"""
KDS（廚房顯示系統）API 路由
"""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from backend.database.config import get_db
from backend.models.order import OrderItem, OrderItemStatus, Order

router = APIRouter()


class UpdateItemStatusRequest(BaseModel):
    item_id: str
    status: str
    operator: str = ""


@router.post("/items/{item_id}/status")
def update_item_status(item_id: str, data: UpdateItemStatusRequest, db: Session = Depends(get_db)):
    """更新菜品製作狀態"""
    item = db.query(OrderItem).filter(OrderItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="菜品不存在")

    valid_statuses = ["sent_to_kitchen", "cooking", "ready", "served"]
    if data.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"無效狀態，可選: {valid_statuses}")

    item.status = data.status
    if data.status == "cooking":
        item.cooking_at = datetime.now()
    elif data.status == "ready":
        item.ready_at = datetime.now()

    db.commit()
    return {
        "itemId": item.id,
        "status": item.status,
        "productName": item.product_name,
        "updatedAt": datetime.now().isoformat(),
    }

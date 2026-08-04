"""
設備配置 API 路由
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from backend.database.config import get_db
from backend.models.device import DeviceConfig

router = APIRouter()


class DeviceConfigUpdate(BaseModel):
    value: str


@router.get("")
def list_configs(db: Session = Depends(get_db)):
    configs = db.query(DeviceConfig).all()
    return {"configs": [c.to_dict() for c in configs]}


@router.put("/{key}")
def update_config(key: str, data: DeviceConfigUpdate, db: Session = Depends(get_db)):
    config = db.query(DeviceConfig).filter(DeviceConfig.key == key).first()
    if not config:
        raise HTTPException(status_code=404, detail="配置項不存在")
    config.value = data.value
    db.commit()
    return {"config": config.to_dict()}


@router.get("/shop")
def get_shop_info(db: Session = Depends(get_db)):
    """獲取店鋪基本資訊（用於小票打印等）"""
    configs = db.query(DeviceConfig).filter(
        DeviceConfig.key.in_(["shop_name", "shop_address", "shop_phone"])
    ).all()
    result = {}
    for c in configs:
        result[c.key.replace("shop_", "")] = c.value
    return result

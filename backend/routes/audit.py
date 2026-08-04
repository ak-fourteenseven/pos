"""
審計日誌 API 路由
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import desc
from typing import Optional
from backend.database.config import get_db
from backend.models.audit import AuditLog

router = APIRouter()


@router.get("")
def list_audit_logs(
    action_type: Optional[str] = None,
    target_type: Optional[str] = None,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    q = db.query(AuditLog).order_by(desc(AuditLog.created_at))
    if action_type:
        q = q.filter(AuditLog.action_type == action_type)
    if target_type:
        q = q.filter(AuditLog.target_type == target_type)
    logs = q.limit(limit).all()
    return {"logs": [log.to_dict() for log in logs]}

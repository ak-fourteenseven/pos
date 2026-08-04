"""
審計服務 - 敏感操作留痕
"""
from datetime import datetime
from sqlalchemy.orm import Session
from backend.models.audit import AuditLog


def write_audit_log(
    db: Session,
    action_type: str,
    target_type: str,
    target_id: str,
    operator: str = "",
    old_value: str = "",
    new_value: str = "",
    reason: str = "",
):
    log = AuditLog(
        action_type=action_type,
        target_type=target_type,
        target_id=target_id,
        old_value=old_value,
        new_value=new_value,
        operator=operator,
        reason=reason,
    )
    db.add(log)
    return log

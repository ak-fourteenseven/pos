"""
審計日誌資料模型
"""
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text
from backend.database.config import Base, generate_id


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(String, primary_key=True, default=lambda: generate_id("AUD"))
    action_type = Column(String(50), nullable=False)
    target_type = Column(String(50), nullable=False)
    target_id = Column(String(100), nullable=False)
    old_value = Column(Text, default="")
    new_value = Column(Text, default="")
    operator = Column(String(100), nullable=False)
    reason = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.now)

    def to_dict(self):
        return {
            "id": self.id,
            "actionType": self.action_type,
            "targetType": self.target_type,
            "targetId": self.target_id,
            "oldValue": self.old_value,
            "newValue": self.new_value,
            "operator": self.operator,
            "reason": self.reason,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }

"""
支付記錄資料模型
"""
from datetime import datetime
from sqlalchemy import Column, String, Float, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from backend.database.config import Base, generate_id


class Payment(Base):
    __tablename__ = "payments"

    id = Column(String, primary_key=True, default=lambda: generate_id("PAY"))
    order_id = Column(String, ForeignKey("orders.id"), nullable=False)
    method = Column(String(30), nullable=False)
    amount = Column(Float, nullable=False)
    reference = Column(String(100), default="")
    paid_at = Column(DateTime, default=datetime.now)
    operator = Column(String(100), default="")
    shift_id = Column(String, nullable=True)

    order = relationship("Order", back_populates="payments")

    def to_dict(self):
        return {
            "id": self.id,
            "orderId": self.order_id,
            "method": self.method,
            "amount": self.amount,
            "reference": self.reference,
            "paidAt": self.paid_at.isoformat() if self.paid_at else None,
            "operator": self.operator,
            "shiftId": self.shift_id,
        }

"""
班次資料模型
"""
from datetime import datetime
from sqlalchemy import Column, String, Float, DateTime, Text
from backend.database.config import Base, generate_id


class Shift(Base):
    __tablename__ = "shifts"

    id = Column(String, primary_key=True, default=lambda: generate_id("SHF"))
    shift_number = Column(String(20), unique=True, nullable=False)
    operator = Column(String(100), nullable=False)
    opened_at = Column(DateTime, default=datetime.now)
    closed_at = Column(DateTime, nullable=True)
    opening_cash = Column(Float, default=0)
    cash_sales = Column(Float, default=0)
    wechat_sales = Column(Float, default=0)
    alipay_sales = Column(Float, default=0)
    card_sales = Column(Float, default=0)
    other_sales = Column(Float, default=0)
    total_sales = Column(Float, default=0)
    refund_total = Column(Float, default=0)
    expected_cash = Column(Float, default=0)
    actual_cash = Column(Float, default=0)
    difference = Column(Float, default=0)
    note = Column(Text, default="")
    status = Column(String(20), default="open")

    def to_dict(self):
        return {
            "id": self.id,
            "shiftNumber": self.shift_number,
            "operator": self.operator,
            "openedAt": self.opened_at.isoformat() if self.opened_at else None,
            "closedAt": self.closed_at.isoformat() if self.closed_at else None,
            "openingCash": self.opening_cash,
            "cashSales": self.cash_sales,
            "wechatSales": self.wechat_sales,
            "alipaySales": self.alipay_sales,
            "cardSales": self.card_sales,
            "otherSales": self.other_sales,
            "totalSales": self.total_sales,
            "refundTotal": self.refund_total,
            "expectedCash": self.expected_cash,
            "actualCash": self.actual_cash,
            "difference": self.difference,
            "note": self.note,
            "status": self.status,
        }

"""
庫存流水資料模型
"""
from datetime import datetime
from sqlalchemy import Column, String, Float, DateTime, Text
from backend.database.config import Base, generate_id


class InventoryRecord(Base):
    __tablename__ = "inventory_records"

    id = Column(String, primary_key=True, default=lambda: generate_id("INV"))
    product_name = Column(String(200), nullable=False)
    record_type = Column(String(20), nullable=False)
    quantity = Column(Float, nullable=False)
    unit = Column(String(20), default="kg")
    unit_price = Column(Float, default=0)
    total_cost = Column(Float, default=0)
    operator = Column(String(100), default="")
    note = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.now)

    def to_dict(self):
        return {
            "id": self.id,
            "productName": self.product_name,
            "recordType": self.record_type,
            "quantity": self.quantity,
            "unit": self.unit,
            "unitPrice": self.unit_price,
            "totalCost": self.total_cost,
            "operator": self.operator,
            "note": self.note,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }

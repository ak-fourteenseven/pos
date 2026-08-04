"""
桌台資料模型
"""
from sqlalchemy import Column, String, Integer, Boolean, Float
from backend.database.config import Base, generate_id


class RestaurantTable(Base):
    __tablename__ = "tables"

    id = Column(String, primary_key=True, default=lambda: generate_id("T"))
    name = Column(String(50), nullable=False)
    capacity = Column(Integer, default=4)
    section = Column(String(50), default="主廳")
    status = Column(String(20), default="available")
    current_order_id = Column(String, nullable=True)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "capacity": self.capacity,
            "section": self.section,
            "status": self.status,
            "currentOrderId": self.current_order_id,
        }

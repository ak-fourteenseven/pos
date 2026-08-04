"""
設備配置資料模型
"""
from sqlalchemy import Column, String, Text
from backend.database.config import Base, generate_id


class DeviceConfig(Base):
    __tablename__ = "device_configs"

    id = Column(String, primary_key=True, default=lambda: generate_id("DEV"))
    key = Column(String(100), unique=True, nullable=False)
    value = Column(Text, default="")
    description = Column(Text, default="")

    def to_dict(self):
        return {
            "id": self.id,
            "key": self.key,
            "value": self.value,
            "description": self.description,
        }

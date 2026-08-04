"""
商品與分類資料模型
"""
from sqlalchemy import Column, String, Float, Integer, Boolean, ForeignKey, Text
from sqlalchemy.orm import relationship
from backend.database.config import Base, generate_id


class Category(Base):
    __tablename__ = "categories"

    id = Column(String, primary_key=True, default=lambda: generate_id("CAT"))
    name = Column(String(100), nullable=False, unique=True)
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)

    products = relationship("Product", back_populates="category")

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "sortOrder": self.sort_order,
            "isActive": self.is_active,
        }


class Product(Base):
    __tablename__ = "products"

    id = Column(String, primary_key=True, default=lambda: generate_id("P"))
    name = Column(String(200), nullable=False)
    category_id = Column(String, ForeignKey("categories.id"), nullable=False)
    price = Column(Float, nullable=False, default=0)
    cost = Column(Float, nullable=False, default=0)
    tax_rate = Column(Float, nullable=False, default=0)
    is_available = Column(Boolean, default=True)
    sort_order = Column(Integer, default=0)
    description = Column(Text, default="")
    image_path = Column(String(500), default="")

    category = relationship("Category", back_populates="products")

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "categoryId": self.category_id,
            "categoryName": self.category.name if self.category else "",
            "price": self.price,
            "cost": self.cost,
            "taxRate": self.tax_rate,
            "isAvailable": self.is_available,
            "sortOrder": self.sort_order,
            "description": self.description,
            "imagePath": self.image_path,
        }

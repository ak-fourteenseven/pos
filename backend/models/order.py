"""
訂單與訂單明細資料模型
"""
from datetime import datetime
from sqlalchemy import Column, String, Float, Integer, DateTime, ForeignKey, Text, Enum as SAEnum
from sqlalchemy.orm import relationship
from backend.database.config import Base, generate_id
import enum


class OrderSource(str, enum.Enum):
    DINE_IN = "dine_in"
    TAKEAWAY = "takeaway"
    DELIVERY = "delivery"


class OrderStatus(str, enum.Enum):
    OPEN = "open"
    PAID = "paid"
    REFUNDED = "refunded"
    CANCELLED = "cancelled"


class OrderItemStatus(str, enum.Enum):
    NEW = "new"
    SENT_TO_KITCHEN = "sent_to_kitchen"
    COOKING = "cooking"
    READY = "ready"
    SERVED = "served"
    CANCELLED = "cancelled"


class Order(Base):
    __tablename__ = "orders"

    id = Column(String, primary_key=True, default=lambda: generate_id("ORD"))
    order_number = Column(String(20), unique=True, nullable=False)
    source = Column(String(20), nullable=False, default=OrderSource.DINE_IN.value)
    table_id = Column(String, ForeignKey("tables.id"), nullable=True)
    table_name = Column(String(50), default="")
    customer_name = Column(String(100), default="")
    customer_phone = Column(String(20), default="")
    status = Column(String(20), nullable=False, default=OrderStatus.OPEN.value)
    subtotal = Column(Float, default=0)
    discount_total = Column(Float, default=0)
    tax_total = Column(Float, default=0)
    rounding = Column(Float, default=0)
    total = Column(Float, default=0)
    paid_amount = Column(Float, default=0)
    note = Column(Text, default="")
    created_by = Column(String(100), default="")
    created_at = Column(DateTime, default=datetime.now)
    paid_at = Column(DateTime, nullable=True)
    closed_at = Column(DateTime, nullable=True)

    items = relationship("OrderItem", back_populates="order", cascade="all, delete-orphan")
    payments = relationship("Payment", back_populates="order", cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "orderNumber": self.order_number,
            "source": self.source,
            "tableId": self.table_id,
            "tableName": self.table_name,
            "customerName": self.customer_name,
            "customerPhone": self.customer_phone,
            "status": self.status,
            "subtotal": self.subtotal,
            "discountTotal": self.discount_total,
            "taxTotal": self.tax_total,
            "rounding": self.rounding,
            "total": self.total,
            "paidAmount": self.paid_amount,
            "note": self.note,
            "createdBy": self.created_by,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "paidAt": self.paid_at.isoformat() if self.paid_at else None,
            "closedAt": self.closed_at.isoformat() if self.closed_at else None,
            "items": [item.to_dict() for item in self.items] if self.items else [],
        }

    def to_summary(self):
        return {
            "id": self.id,
            "orderNumber": self.order_number,
            "source": self.source,
            "tableName": self.table_name,
            "status": self.status,
            "total": self.total,
            "itemCount": len(self.items) if self.items else 0,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }


class OrderItem(Base):
    __tablename__ = "order_items"

    id = Column(String, primary_key=True, default=lambda: generate_id("OI"))
    order_id = Column(String, ForeignKey("orders.id"), nullable=False)
    product_id = Column(String, ForeignKey("products.id"), nullable=False)
    product_name = Column(String(200), nullable=False)
    quantity = Column(Integer, nullable=False, default=1)
    unit_price = Column(Float, nullable=False)
    discount = Column(Float, default=0)
    subtotal = Column(Float, nullable=False)
    status = Column(String(20), default=OrderItemStatus.NEW.value)
    note = Column(Text, default="")
    sent_to_kitchen_at = Column(DateTime, nullable=True)
    cooking_at = Column(DateTime, nullable=True)
    ready_at = Column(DateTime, nullable=True)

    order = relationship("Order", back_populates="items")

    def to_dict(self):
        return {
            "id": self.id,
            "orderId": self.order_id,
            "productId": self.product_id,
            "productName": self.product_name,
            "quantity": self.quantity,
            "unitPrice": self.unit_price,
            "discount": self.discount,
            "subtotal": self.subtotal,
            "status": self.status,
            "note": self.note,
            "sentToKitchenAt": self.sent_to_kitchen_at.isoformat() if self.sent_to_kitchen_at else None,
            "cookingAt": self.cooking_at.isoformat() if self.cooking_at else None,
            "readyAt": self.ready_at.isoformat() if self.ready_at else None,
        }

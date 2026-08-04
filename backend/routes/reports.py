"""
報表 API 路由
"""
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional
from backend.database.config import get_db
from backend.models.order import Order, OrderStatus
from backend.models.payment import Payment
from backend.models.product import Product

router = APIRouter()


@router.get("/daily-sales")
def daily_sales(date: Optional[str] = None, db: Session = Depends(get_db)):
    """日銷售報表：訂單數、銷售額、實收額、支付方式分布"""
    if date:
        target_date = datetime.fromisoformat(date)
    else:
        target_date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

    next_date = target_date + timedelta(days=1)

    orders = db.query(Order).filter(
        Order.created_at >= target_date,
        Order.created_at < next_date,
        Order.status.in_([OrderStatus.PAID.value, OrderStatus.REFUNDED.value]),
    ).all()

    total_orders = len(orders)
    total_sales = sum(o.total for o in orders if o.status == OrderStatus.PAID.value)
    total_refund = sum(o.total for o in orders if o.status == OrderStatus.REFUNDED.value)

    payments = db.query(Payment).filter(Payment.paid_at >= target_date, Payment.paid_at < next_date).all()
    by_method = {}
    for p in payments:
        method = p.method
        if method not in by_method:
            by_method[method] = 0
        by_method[method] = round(by_method[method] + p.amount, 2)

    return {
        "date": target_date.strftime("%Y-%m-%d"),
        "totalOrders": total_orders,
        "totalSales": round(total_sales, 2),
        "totalRefund": round(total_refund, 2),
        "netSales": round(total_sales - total_refund, 2),
        "paymentBreakdown": by_method,
    }


@router.get("/product-ranking")
def product_ranking(date: Optional[str] = None, db: Session = Depends(get_db)):
    """商品排行報表：銷量、銷售額"""
    if date:
        target_date = datetime.fromisoformat(date)
    else:
        target_date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    next_date = target_date + timedelta(days=1)

    from backend.models.order import OrderItem
    items = db.query(OrderItem).join(Order).filter(
        Order.created_at >= target_date,
        Order.created_at < next_date,
        Order.status == OrderStatus.PAID.value,
    ).all()

    ranking = {}
    for item in items:
        key = item.product_name
        if key not in ranking:
            ranking[key] = {"productName": key, "quantity": 0, "totalSales": 0}
        ranking[key]["quantity"] += item.quantity
        ranking[key]["totalSales"] = round(ranking[key]["totalSales"] + item.subtotal, 2)

    sorted_ranking = sorted(ranking.values(), key=lambda x: x["totalSales"], reverse=True)
    return {"ranking": sorted_ranking}


@router.get("/gross-profit")
def gross_profit(date: Optional[str] = None, db: Session = Depends(get_db)):
    """毛利報表：收入、成本、毛利額、毛利率"""
    if date:
        target_date = datetime.fromisoformat(date)
    else:
        target_date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    next_date = target_date + timedelta(days=1)

    from backend.models.order import OrderItem
    items = db.query(OrderItem).join(Order).filter(
        Order.created_at >= target_date,
        Order.created_at < next_date,
        Order.status == OrderStatus.PAID.value,
    ).all()

    by_product = {}
    for item in items:
        key = item.product_name
        if key not in by_product:
            product = db.query(Product).filter(Product.id == item.product_id).first()
            cost = product.cost if product else 0
            by_product[key] = {"productName": key, "revenue": 0, "cost": cost, "quantity": 0}
        by_product[key]["revenue"] = round(by_product[key]["revenue"] + item.subtotal, 2)
        by_product[key]["quantity"] += item.quantity

    result = []
    total_revenue = 0
    total_cost = 0
    for name, data in by_product.items():
        revenue = data["revenue"]
        cost_total = round(data["cost"] * data["quantity"], 2)
        profit = round(revenue - cost_total, 2)
        margin = round(profit / revenue * 100, 1) if revenue > 0 else 0
        total_revenue += revenue
        total_cost += cost_total
        result.append({**data, "costTotal": cost_total, "profit": profit, "margin": margin})

    result.sort(key=lambda x: x["profit"], reverse=True)
    total_profit = round(total_revenue - total_cost, 2)
    total_margin = round(total_profit / total_revenue * 100, 1) if total_revenue > 0 else 0

    return {
        "date": target_date.strftime("%Y-%m-%d"),
        "items": result,
        "totalRevenue": round(total_revenue, 2),
        "totalCost": round(total_cost, 2),
        "totalProfit": total_profit,
        "totalMargin": total_margin,
    }


@router.get("/refund-reasons")
def refund_reasons(date: Optional[str] = None, db: Session = Depends(get_db)):
    """退貨原因報表"""
    if date:
        target_date = datetime.fromisoformat(date)
    else:
        target_date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    next_date = target_date + timedelta(days=1)

    from backend.models.audit import AuditLog
    logs = db.query(AuditLog).filter(
        AuditLog.action_type == "refund",
        AuditLog.created_at >= target_date,
        AuditLog.created_at < next_date,
    ).all()

    result = []
    for log in logs:
        result.append({
            "time": log.created_at.isoformat() if log.created_at else None,
            "operator": log.operator,
            "reason": log.reason,
            "amount": log.old_value,
        })

    return {"date": target_date.strftime("%Y-%m-%d"), "refunds": result, "count": len(result)}

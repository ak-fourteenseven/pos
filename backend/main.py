"""
茶餐廳 POS 系統 - FastAPI 後端主入口
由 Electron 主進程啟動為本地子進程，提供 REST API
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.database.config import init_db
from backend.routes import products, orders, payments, shifts, inventory, reports, kds, devices, audit, tables

app = FastAPI(
    title="祥興茶餐廳 POS API",
    version="1.0.0",
    description="單店餐飲 POS 後端服務",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(products.router, prefix="/api/products", tags=["商品管理"])
app.include_router(orders.router, prefix="/api/orders", tags=["訂單管理"])
app.include_router(payments.router, prefix="/api/payments", tags=["支付管理"])
app.include_router(shifts.router, prefix="/api/shifts", tags=["班次管理"])
app.include_router(inventory.router, prefix="/api/inventory", tags=["庫存管理"])
app.include_router(reports.router, prefix="/api/reports", tags=["報表"])
app.include_router(kds.router, prefix="/api/kds", tags=["廚房顯示"])
app.include_router(devices.router, prefix="/api/devices", tags=["設備配置"])
app.include_router(audit.router, prefix="/api/audit", tags=["審計日誌"])
app.include_router(tables.router, prefix="/api/tables", tags=["桌台管理"])


@app.on_event("startup")
def startup():
    init_db()


@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "pos-backend"}

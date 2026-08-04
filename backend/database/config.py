"""
茶餐廳 POS 系統 - 資料庫配置
使用 SQLite 作為本地存儲，支援離線模式
"""
import os
import uuid
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base


def generate_id(prefix: str = "") -> str:
    return prefix + uuid.uuid4().hex[:8].upper()

# 資料庫檔案路徑（位於專案根目錄）
DB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data")
DB_PATH = os.path.join(DB_DIR, "pos.db")

os.makedirs(DB_DIR, exist_ok=True)

# SQLite 引擎配置：啟用 WAL 模式以支援並發讀寫
engine = create_engine(
    f"sqlite:///{DB_PATH}",
    connect_args={"check_same_thread": False},
    echo=False,
)

# 啟用 WAL 模式與外鍵約束
@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """FastAPI 依賴注入：獲取資料庫會話"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """初始化資料庫：建立所有資料表並載入預設資料"""
    from backend.models.product import Product, Category
    from backend.models.order import Order, OrderItem
    from backend.models.payment import Payment
    from backend.models.shift import Shift
    from backend.models.inventory import InventoryRecord
    from backend.models.audit import AuditLog
    from backend.models.device import DeviceConfig
    from backend.models.table import RestaurantTable

    Base.metadata.create_all(bind=engine)

    # 載入預設分類與商品
    db = SessionLocal()
    try:
        if db.query(Category).count() == 0:
            _seed_default_data(db)
    finally:
        db.close()


def _seed_default_data(db):
    """載入茶餐廳預設菜單資料"""
    from backend.models.product import Product, Category
    from backend.models.table import RestaurantTable
    from backend.models.device import DeviceConfig
    categories = [
        Category(id="CAT001", name="飲品", sort_order=1),
        Category(id="CAT002", name="小食", sort_order=2),
        Category(id="CAT003", name="粉麵飯", sort_order=3),
        Category(id="CAT004", name="三文治/多士", sort_order=4),
        Category(id="CAT005", name="碟頭飯", sort_order=5),
        Category(id="CAT006", name="湯羹", sort_order=6),
        Category(id="CAT007", name="甜品", sort_order=7),
        Category(id="CAT008", name="套餐", sort_order=8),
    ]
    db.add_all(categories)

    products = [
        # 飲品
        Product(id="P001", name="凍檸茶", category_id="CAT001", price=22.0, cost=5.0, is_available=True, sort_order=1),
        Product(id="P002", name="熱奶茶", category_id="CAT001", price=20.0, cost=4.5, is_available=True, sort_order=2),
        Product(id="P003", name="凍咖啡", category_id="CAT001", price=22.0, cost=5.0, is_available=True, sort_order=3),
        Product(id="P004", name="鴛鴦", category_id="CAT001", price=22.0, cost=5.0, is_available=True, sort_order=4),
        Product(id="P005", name="咸檸七", category_id="CAT001", price=26.0, cost=7.0, is_available=True, sort_order=5),
        # 小食
        Product(id="P006", name="炸雞翼", category_id="CAT002", price=38.0, cost=12.0, is_available=True, sort_order=6),
        Product(id="P007", name="咖喱魚蛋", category_id="CAT002", price=25.0, cost=8.0, is_available=True, sort_order=7),
        Product(id="P008", name="瑞士雞翼", category_id="CAT002", price=38.0, cost=13.0, is_available=True, sort_order=8),
        Product(id="P009", name="炸薯條", category_id="CAT002", price=28.0, cost=8.0, is_available=True, sort_order=9),
        # 粉麵飯
        Product(id="P010", name="沙嗲牛肉公仔麵", category_id="CAT003", price=42.0, cost=15.0, is_available=True, sort_order=10),
        Product(id="P011", name="叉燒湯意粉", category_id="CAT003", price=40.0, cost=14.0, is_available=True, sort_order=11),
        Product(id="P012", name="鮮蝦雲吞麵", category_id="CAT003", price=38.0, cost=13.0, is_available=True, sort_order=12),
        Product(id="P013", name="乾炒牛河", category_id="CAT003", price=55.0, cost=20.0, is_available=True, sort_order=13),
        # 三文治/多士
        Product(id="P014", name="蛋治", category_id="CAT004", price=22.0, cost=7.0, is_available=True, sort_order=14),
        Product(id="P015", name="火腿通粉", category_id="CAT004", price=35.0, cost=12.0, is_available=True, sort_order=15),
        Product(id="P016", name="奶油多", category_id="CAT004", price=18.0, cost=5.0, is_available=True, sort_order=16),
        # 碟頭飯
        Product(id="P017", name="粟米肉粒飯", category_id="CAT005", price=48.0, cost=16.0, is_available=True, sort_order=17),
        Product(id="P018", name="咖喱雞飯", category_id="CAT005", price=50.0, cost=17.0, is_available=True, sort_order=18),
        Product(id="P019", name="豉椒排骨飯", category_id="CAT005", price=52.0, cost=18.0, is_available=True, sort_order=19),
        # 湯羹
        Product(id="P020", name="例湯", category_id="CAT006", price=15.0, cost=4.0, is_available=True, sort_order=20),
        Product(id="P021", name="羅宋湯", category_id="CAT006", price=18.0, cost=5.0, is_available=True, sort_order=21),
        # 甜品
        Product(id="P022", name="西多士", category_id="CAT007", price=28.0, cost=9.0, is_available=True, sort_order=22),
        Product(id="P023", name="紅豆沙", category_id="CAT007", price=22.0, cost=6.0, is_available=True, sort_order=23),
        # 套餐
        Product(id="P024", name="常餐A", category_id="CAT008", price=55.0, cost=22.0, is_available=True, sort_order=24,
                description="沙嗲牛肉公仔麵 + 炒蛋多士 + 熱飲"),
        Product(id="P025", name="特餐B", category_id="CAT008", price=60.0, cost=24.0, is_available=True, sort_order=25,
                description="乾炒牛河 + 例湯 + 凍飲"),
    ]
    db.add_all(products)

    # 預設桌台
    tables = [RestaurantTable(id=f"T{i:02d}", name=f"桌{i}", capacity=4, status="available") for i in range(1, 13)]
    db.add_all(tables)

    # 預設設備配置
    device_configs = [
        DeviceConfig(key="printer_name", value="EPSON_TM_T88", description="小票打印機名稱"),
        DeviceConfig(key="printer_interface", value="usb", description="打印機接口類型"),
        DeviceConfig(key="kds_host", value="192.168.1.101", description="KDS 端 IP 地址"),
        DeviceConfig(key="kds_port", value="3001", description="KDS 端端口"),
        DeviceConfig(key="socket_port", value="3000", description="Socket.io 服務端口"),
        DeviceConfig(key="shop_name", value="祥興茶餐廳", description="店鋪名稱"),
        DeviceConfig(key="shop_address", value="香港旺角彌敦道 100 號", description="店鋪地址"),
        DeviceConfig(key="shop_phone", value="2388 1234", description="店鋪電話"),
    ]
    db.add_all(device_configs)

    db.commit()

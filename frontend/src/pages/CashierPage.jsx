import React, { useState, useEffect, useCallback } from "react";
import { productsApi, ordersApi, shiftsApi, tablesApi } from "../services/api";
import { connectSocket, registerDevice, sendToKitchen } from "../services/socket";

/**
 * 收銀主頁面 - 觸屏優化
 * 左側：桌台 + 商品分類與菜品網格
 * 右側：當前訂單明細
 */

export default function CashierPage() {
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [tables, setTables] = useState([]);
  const [activeCategory, setActiveCategory] = useState(null);
  const [currentOrder, setCurrentOrder] = useState(null);
  const [currentTable, setCurrentTable] = useState(null);
  const [shift, setShift] = useState(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [cashAmount, setCashAmount] = useState("");
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountAmount, setDiscountAmount] = useState("");
  const [loading, setLoading] = useState(false);

  // 初始化
  useEffect(() => {
    loadCategories();
    loadTables();
    loadShift();
    const socket = connectSocket();
    registerDevice("cashier", "收銀主機");
  }, []);

  const loadCategories = async () => {
    try {
      const data = await productsApi.categories();
      setCategories(data.categories);
      if (data.categories.length > 0) {
        setActiveCategory(data.categories[0].id);
      }
    } catch (e) {
      console.error("載入分類失敗:", e);
    }
  };

  const loadProducts = useCallback(async (categoryId) => {
    try {
      const data = await productsApi.list(categoryId);
      setProducts(data.products);
    } catch (e) {
      console.error("載入商品失敗:", e);
    }
  }, []);

  useEffect(() => {
    if (activeCategory) loadProducts(activeCategory);
  }, [activeCategory, loadProducts]);

  const loadTables = async () => {
    try {
      const tablesData = await tablesApi.list();
      const activeData = await ordersApi.activeTables().catch(() => ({ tables: [] }));
      const activeMap = {};
      (activeData.tables || []).forEach((t) => {
        activeMap[t.tableName] = t;
      });

      const merged = (tablesData.tables || []).map((t) => {
        const activeInfo = activeMap[t.name];
        return {
          id: t.id,
          name: t.name,
          capacity: t.capacity,
          status: activeInfo ? "occupied" : "available",
          orderId: activeInfo?.orderId || null,
          total: activeInfo?.total || 0,
        };
      });
      setTables(merged);
    } catch (e) {
      console.error("載入桌台失敗:", e);
    }
  };

  const loadShift = async () => {
    try {
      const data = await shiftsApi.current();
      setShift(data.shift);
    } catch (e) {
      console.error("載入班次失敗:", e);
    }
  };

  // 選擇桌台
  const selectTable = (table) => {
    setCurrentTable(table);
    if (table.status === "available") {
      setCurrentOrder(null);
    } else if (table.orderId) {
      ordersApi.get(table.orderId).then((data) => setCurrentOrder(data.order)).catch(() => {});
    }
  };

  // 加入菜品到訂單
  const addItemToOrder = async (product) => {
    if (!shift) {
      alert("請先開班");
      return;
    }

    if (!currentTable) {
      alert("請先選擇桌台");
      return;
    }
    setLoading(true);
    try {
      if (!currentOrder) {
        // 新建訂單
        const data = await ordersApi.create({
          source: "dine_in",
          table_id: null,
          table_name: currentTable.name,
          items: [
            {
              product_id: product.id,
              product_name: product.name,
              quantity: 1,
              unit_price: product.price,
            },
          ],
          operator: "cashier",
        });
        setCurrentOrder(data.order);
        currentTable.status = "occupied";
        currentTable.orderId = data.order.id;
        setTables([...tables]);
      } else {
        // 加菜
        const data = await ordersApi.addItems(currentOrder.id, {
          items: [
            {
              product_id: product.id,
              product_name: product.name,
              quantity: 1,
              unit_price: product.price,
            },
          ],
          operator: "cashier",
        });
        setCurrentOrder(data.order);
      }
    } catch (e) {
      alert("操作失敗: " + e.message);
    }
    setLoading(false);
  };

  // 刪除菜品
  const removeItem = async (itemId) => {
    if (!currentOrder || !window.confirm("確認刪除此菜品？")) return;
    try {
      const data = await ordersApi.removeItem(currentOrder.id, {
        item_id: itemId,
        reason: "手動刪除",
        operator: "cashier",
      });
      setCurrentOrder(data.order);
    } catch (e) {
      alert("刪除失敗: " + e.message);
    }
  };

  // 整單折扣
  const applyDiscount = async () => {
    const amount = parseFloat(discountAmount);
    if (isNaN(amount) || amount < 0) return;
    try {
      const data = await ordersApi.applyDiscount(currentOrder.id, {
        discount_amount: amount,
        reason: "店長授權",
        operator: "cashier",
      });
      setCurrentOrder(data.order);
      setDiscountOpen(false);
      setDiscountAmount("");
    } catch (e) {
      alert("折扣設定失敗: " + e.message);
    }
  };

  // 送廚
  const sendToKitchenHandler = async () => {
    if (!currentOrder) return;
    try {
      const data = await ordersApi.sendToKitchen(currentOrder.id);
      setCurrentOrder(data.order);
      sendToKitchen({
        orderId: currentOrder.id,
        orderNumber: currentOrder.orderNumber,
        tableName: currentOrder.tableName,
        items: currentOrder.items,
      });
    } catch (e) {
      alert("送廚失敗: " + e.message);
    }
  };

  // 結帳
  const checkout = async () => {
    if (!cashAmount) return;
    const amount = parseFloat(cashAmount);
    if (isNaN(amount) || amount <= 0) return;

    try {
      await ordersApi.checkout(currentOrder.id, {
        payments: [
          {
            method: "cash",
            amount: currentOrder.total,
            operator: "cashier",
            shift_id: shift?.id || "",
          },
        ],
        rounding: 0,
        operator: "cashier",
        shift_id: shift?.id || "",
      });
      setPaymentOpen(false);
      setCashAmount("");
      setCurrentOrder(null);
      if (currentTable) {
        currentTable.status = "available";
        currentTable.orderId = null;
        setTables([...tables]);
      }
      setCurrentTable(null);
    } catch (e) {
      alert("結帳失敗: " + e.message);
    }
  };

  // 開班
  const openShift = async () => {
    try {
      const data = await shiftsApi.open({ operator: "cashier", opening_cash: 0 });
      setShift(data.shift);
    } catch (e) {
      alert("開班失敗: " + e.message);
    }
  };

  // 結班
  const closeShift = async () => {
    const actual = prompt("請輸入實際現金金額:");
    if (!actual) return;
    try {
      const data = await shiftsApi.close({ actual_cash: parseFloat(actual) });
      setShift(null);
      alert(`結班完成\n應收現金: $${data.shift.expected_cash}\n實際現金: $${data.shift.actual_cash}\n差額: $${data.shift.difference}`);
    } catch (e) {
      alert("結班失敗: " + e.message);
    }
  };

  const totalItems = currentOrder?.items?.length || 0;

  return (
    <div style={{ display: "flex", height: "calc(100vh - 80px)", gap: 12 }}>
      {/* ===== 左側：桌台 + 菜品 ===== */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, overflow: "hidden" }}>
        {/* 桌台區域 */}
        <div className="card" style={{ flexShrink: 0, maxHeight: 420, overflowY: "auto" }}>
          <div className="flex items-center justify-between mb-12">
            <h3 style={{ fontSize: "var(--font-size-xl)" }}>桌台</h3>
            <div className="flex gap-8">
              {!shift ? (
                <button className="btn btn-success" onClick={openShift}>開班</button>
              ) : (
                <button className="btn btn-warning" onClick={closeShift}>結班</button>
              )}
              <span className="text-muted text-sm">
                {shift ? `當班: ${shift.operator} | 已開${Math.floor((Date.now() - new Date(shift.openedAt).getTime()) / 60000)}分鐘` : "尚未開班"}
              </span>
            </div>
          </div>
          <div className="grid grid-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
            {tables.map((t) => (
              <button
                key={t.id}
                className={`btn ${currentTable?.id === t.id ? "btn-primary" : "btn-secondary"}`}
                style={{
                  flexDirection: "column",
                  minHeight: 88,
                  padding: "14px 10px",
                  background: currentTable?.id === t.id ? "var(--accent)" : t.status === "occupied" ? "var(--bg-card)" : "var(--bg-primary)",
                  borderColor: t.status === "occupied" ? "var(--warning)" : "var(--border)",
                }}
                onClick={() => selectTable(t)}
              >
                <span style={{ fontSize: "var(--font-size-xl)", fontWeight: 700 }}>{t.name}</span>
                <span style={{ fontSize: "var(--font-size-md)" }}>
                  {t.status === "occupied" ? `$${t.total}` : "空"}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* 菜品區域 */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* 分類標籤 */}
          <div className="flex gap-8 mb-12" style={{ flexShrink: 0, overflowX: "auto" }}>
            {categories.map((cat) => (
              <button
                key={cat.id}
                className={`btn ${activeCategory === cat.id ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setActiveCategory(cat.id)}
              >
                {cat.name}
              </button>
            ))}
          </div>

          {/* 商品網格 */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
              {products.filter((p) => p.isAvailable).map((product) => (
                <button
                  key={product.id}
                  className="btn btn-secondary"
                  style={{
                    flexDirection: "column",
                    padding: "18px 12px",
                    height: 120,
                  }}
                  onClick={() => addItemToOrder(product)}
                  disabled={loading || !currentTable}
                >
                  <span style={{ fontSize: "var(--font-size-lg)", fontWeight: 700 }}>${product.price}</span>
                  <span style={{ fontSize: "var(--font-size-md)", marginTop: 4 }}>{product.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ===== 右側：訂單明細 ===== */}
      <div className="card" style={{ width: 400, flexShrink: 0, display: "flex", flexDirection: "column" }}>
        <h3 style={{ fontSize: "var(--font-size-lg)", marginBottom: 12 }}>
          {currentTable ? `${currentTable.name} 桌` : "訂單明細"}
        </h3>

        {!currentOrder ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
            請選擇桌台並加入菜品
          </div>
        ) : (
          <>
            {/* 訂單資訊 */}
            <div className="text-sm text-muted mb-8">
              訂單號: {currentOrder.orderNumber} | {currentOrder.source === "dine_in" ? "堂食" : currentOrder.source === "takeaway" ? "外帶" : "外賣"}
            </div>

            {/* 菜品列表 */}
            <div style={{ flex: 1, overflowY: "auto" }}>
              {currentOrder.items?.map((item) => (
                <div key={item.id} className="flex items-center justify-between" style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "var(--font-size-md)" }}>{item.productName}</div>
                    <div className="text-sm text-muted">${item.unitPrice} x {item.quantity}</div>
                  </div>
                  <div className="flex items-center gap-8">
                    <span className="amount" style={{ fontSize: "var(--font-size-md)" }}>${item.subtotal}</span>
                    <button
                      className="btn btn-danger"
                      style={{ padding: "4px 8px", minHeight: 32, fontSize: "var(--font-size-sm)" }}
                      onClick={() => removeItem(item.id)}
                    >
                      刪
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* 合計 */}
            <div style={{ borderTop: "2px solid var(--accent)", paddingTop: 12, marginTop: 8 }}>
              <div className="flex justify-between" style={{ fontSize: "var(--font-size-md)", marginBottom: 4 }}>
                <span>小計</span>
                <span>${currentOrder.subtotal || 0}</span>
              </div>
              {currentOrder.discountTotal > 0 && (
                <div className="flex justify-between" style={{ fontSize: "var(--font-size-md)", marginBottom: 4, color: "var(--success)" }}>
                  <span>折扣</span>
                  <span>-${currentOrder.discountTotal}</span>
                </div>
              )}
              <div className="flex justify-between" style={{ fontSize: "var(--font-size-xl)", fontWeight: 700, marginTop: 8 }}>
                <span>合計</span>
                <span className="amount">${currentOrder.total || 0}</span>
              </div>
            </div>

            {/* 操作按鈕 */}
            <div className="grid grid-2 gap-8 mt-12">
              <button className="btn btn-warning" onClick={() => setDiscountOpen(true)}>
                折扣
              </button>
              <button className="btn btn-primary" onClick={sendToKitchenHandler}>
                送廚
              </button>
              <button
                className="btn btn-success btn-large"
                style={{ gridColumn: "1 / -1" }}
                onClick={() => setPaymentOpen(true)}
              >
                結帳 $ {currentOrder.total || 0}
              </button>
            </div>
          </>
        )}
      </div>

      {/* ===== 結帳彈窗 ===== */}
      {paymentOpen && (
        <div className="modal-overlay" onClick={() => setPaymentOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>結帳 - {currentTable?.name} 桌</h2>
            <div style={{ fontSize: "var(--font-size-xl)", fontWeight: 700, marginBottom: 16 }}>
              應收: ${currentOrder?.total || 0}
            </div>
            <label className="text-sm text-muted mb-8" style={{ display: "block" }}>現金收款</label>
            <input
              className="input"
              type="number"
              value={cashAmount}
              onChange={(e) => setCashAmount(e.target.value)}
              placeholder="輸入收款金額"
              autoFocus
              style={{ fontSize: "var(--font-size-xl)", textAlign: "center" }}
            />
            {cashAmount && (
              <div style={{ fontSize: "var(--font-size-xl)", marginTop: 12, fontWeight: 700 }}>
                找零: <span className="amount-positive">${(parseFloat(cashAmount) - (currentOrder?.total || 0)).toFixed(2)}</span>
              </div>
            )}
            <div className="flex gap-8 mt-16">
              <button className="btn btn-secondary btn-block" onClick={() => setPaymentOpen(false)}>
                取消
              </button>
              <button className="btn btn-success btn-block btn-large" onClick={checkout}>
                確認收款
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 折扣彈窗 ===== */}
      {discountOpen && (
        <div className="modal-overlay" onClick={() => setDiscountOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>整單折扣</h2>
            <label className="text-sm text-muted mb-8" style={{ display: "block" }}>折扣金額</label>
            <input
              className="input"
              type="number"
              value={discountAmount}
              onChange={(e) => setDiscountAmount(e.target.value)}
              placeholder="輸入折扣金額"
              autoFocus
              style={{ fontSize: "var(--font-size-xl)", textAlign: "center" }}
            />
            <div className="flex gap-8 mt-16">
              <button className="btn btn-secondary btn-block" onClick={() => setDiscountOpen(false)}>取消</button>
              <button className="btn btn-primary btn-block" onClick={applyDiscount}>確認</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

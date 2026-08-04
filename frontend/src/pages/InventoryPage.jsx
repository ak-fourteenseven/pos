import React, { useState, useEffect } from "react";
import { inventoryApi } from "../services/api";

/**
 * 庫存管理頁面
 * 進貨記錄、庫存總覽
 */
export default function InventoryPage() {
  const [records, setRecords] = useState([]);
  const [summary, setSummary] = useState([]);
  const [activeTab, setActiveTab] = useState("summary");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    product_name: "",
    record_type: "purchase",
    quantity: "",
    unit: "kg",
    unit_price: "",
    operator: "manager",
    note: "",
  });

  useEffect(() => {
    loadData();
  }, [activeTab]);

  const loadData = async () => {
    try {
      if (activeTab === "summary") {
        const data = await inventoryApi.summary();
        setSummary(data.summary);
      } else {
        const type = activeTab === "purchase" ? "purchase" : activeTab === "waste" ? "waste" : null;
        const data = await inventoryApi.list(type);
        setRecords(data.records);
      }
    } catch (e) {
      console.error("庫存載入失敗:", e);
    }
  };

  const handleSubmit = async () => {
    if (!form.product_name || !form.quantity) {
      alert("請填寫完整");
      return;
    }
    try {
      await inventoryApi.add({
        ...form,
        quantity: parseFloat(form.quantity),
        unit_price: parseFloat(form.unit_price) || 0,
      });
      setShowForm(false);
      setForm({ product_name: "", record_type: "purchase", quantity: "", unit: "kg", unit_price: "", operator: "manager", note: "" });
      loadData();
    } catch (e) {
      alert("新增失敗: " + e.message);
    }
  };

  const typeLabels = { purchase: "進貨", check: "盤點", waste: "損耗" };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="flex items-center justify-between mb-12">
        <div className="flex gap-8">
          {[
            { key: "summary", label: "庫存總覽" },
            { key: "purchase", label: "進貨記錄" },
            { key: "waste", label: "損耗記錄" },
            { key: "all", label: "全部記錄" },
          ].map((tab) => (
            <button
              key={tab.key}
              className={`btn btn-large ${activeTab === tab.key ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button className="btn btn-success btn-large" onClick={() => setShowForm(true)}>
          + 新增記錄
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {activeTab === "summary" ? (
          <div className="card">
            <table className="table-touch">
              <thead>
                <tr>
                  <th>商品/原料</th>
                  <th>累計進貨</th>
                  <th>累計損耗</th>
                  <th>當前庫存</th>
                  <th>單位</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((item) => (
                  <tr key={item.productName}>
                    <td style={{ fontWeight: 600 }}>{item.productName}</td>
                    <td>{item.totalIn}</td>
                    <td className="amount-negative">{item.totalOut}</td>
                    <td className="amount" style={{ fontWeight: 700, color: item.currentStock < 0 ? "var(--danger)" : "var(--success)" }}>
                      {item.currentStock}
                    </td>
                    <td>{item.unit}</td>
                  </tr>
                ))}
                {summary.length === 0 && (
                  <tr><td colSpan="5" className="text-center text-muted">暫無庫存數據</td></tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card">
            <table className="table-touch">
              <thead>
                <tr>
                  <th>時間</th>
                  <th>類型</th>
                  <th>商品</th>
                  <th>數量</th>
                  <th>單價</th>
                  <th>總額</th>
                  <th>操作人</th>
                  <th>備註</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id}>
                    <td>{new Date(r.created_at).toLocaleString("zh-HK")}</td>
                    <td><span className={`badge ${r.record_type === "purchase" ? "badge-info" : r.record_type === "waste" ? "badge-danger" : "badge-warning"}`}>{typeLabels[r.record_type]}</span></td>
                    <td>{r.product_name}</td>
                    <td>{r.quantity} {r.unit}</td>
                    <td>${r.unit_price}</td>
                    <td className="amount">${r.total_cost}</td>
                    <td>{r.operator}</td>
                    <td className="text-sm text-muted">{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 新增記錄彈窗 */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>新增庫存記錄</h2>
            <div className="flex flex-col gap-12">
              <div>
                <label className="text-sm text-muted mb-8" style={{ display: "block" }}>類型</label>
                <select className="select" value={form.record_type} onChange={(e) => setForm({ ...form, record_type: e.target.value })}>
                  <option value="purchase">進貨</option>
                  <option value="waste">損耗</option>
                  <option value="check">盤點</option>
                </select>
              </div>
              <div>
                <label className="text-sm text-muted mb-8" style={{ display: "block" }}>商品名稱</label>
                <input className="input" value={form.product_name} onChange={(e) => setForm({ ...form, product_name: e.target.value })} placeholder="例: 豬肉" />
              </div>
              <div className="grid grid-2">
                <div>
                  <label className="text-sm text-muted mb-8" style={{ display: "block" }}>數量</label>
                  <input className="input" type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="0" />
                </div>
                <div>
                  <label className="text-sm text-muted mb-8" style={{ display: "block" }}>單位</label>
                  <select className="select" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                    <option value="kg">kg</option>
                    <option value="g">g</option>
                    <option value="件">件</option>
                    <option value="箱">箱</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-sm text-muted mb-8" style={{ display: "block" }}>單價</label>
                <input className="input" type="number" value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: e.target.value })} placeholder="0" />
              </div>
              <div>
                <label className="text-sm text-muted mb-8" style={{ display: "block" }}>備註</label>
                <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="選填" />
              </div>
            </div>
            <div className="flex gap-8 mt-16">
              <button className="btn btn-secondary btn-block" onClick={() => setShowForm(false)}>取消</button>
              <button className="btn btn-success btn-block" onClick={handleSubmit}>確認</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

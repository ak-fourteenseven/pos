import React, { useState, useEffect, useRef } from "react";
import { devicesApi, productsApi, tablesApi } from "../services/api";

/**
 * 設定頁面
 * 設備配置、商品列表、新增商品、桌台管理
 */
export default function ConfigPage() {
  const [configs, setConfigs] = useState([]);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [activeTab, setActiveTab] = useState("devices");
  const [editingKey, setEditingKey] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [tablesList, setTablesList] = useState([]);
  const [newTableName, setNewTableName] = useState("");
  const [newTableCapacity, setNewTableCapacity] = useState(4);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  // 商品管理狀態
  const [newProductName, setNewProductName] = useState("");
  const [newProductCategory, setNewProductCategory] = useState("");
  const [newProductPrice, setNewProductPrice] = useState("");
  const [newProductCost, setNewProductCost] = useState("0");
  const [newProductDescription, setNewProductDescription] = useState("");
  const [productDeleteConfirm, setProductDeleteConfirm] = useState(null);

  // Excel 匯入狀態
  const fileInputRef = useRef(null);
  const [importResult, setImportResult] = useState(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (activeTab === "devices") loadConfigs();
    else if (activeTab === "tables") loadTables();
    else if (activeTab === "lists" || activeTab === "create") { loadCategories(); loadProducts(); }
  }, [activeTab]);

  const loadConfigs = async () => {
    try {
      const data = await devicesApi.list();
      setConfigs(data.configs);
    } catch (e) {
      console.error("載入配置失敗:", e);
    }
  };

  const loadCategories = async () => {
    try {
      const data = await productsApi.categories();
      setCategories(data.categories);
    } catch (e) {}
  };

  const loadProducts = async () => {
    try {
      const data = await productsApi.list();
      setProducts(data.products);
    } catch (e) {}
  };

  const saveConfig = async (key) => {
    try {
      await devicesApi.update(key, editValue);
      setEditingKey(null);
      loadConfigs();
    } catch (e) {
      alert("保存失敗: " + e.message);
    }
  };

  const toggleProduct = async (product) => {
    try {
      await productsApi.update(product.id, { is_available: !product.is_available });
      loadProducts();
    } catch (e) {
      alert("操作失敗: " + e.message);
    }
  };

  const loadTables = async () => {
    try {
      const data = await tablesApi.list();
      setTablesList(data.tables);
    } catch (e) {
      console.error("載入桌台失敗:", e);
    }
  };

  const createTable = async () => {
    if (!newTableName.trim()) {
      alert("請輸入桌台名稱");
      return;
    }
    try {
      await tablesApi.create({ name: newTableName.trim(), capacity: newTableCapacity });
      setNewTableName("");
      setNewTableCapacity(4);
      loadTables();
    } catch (e) {
      alert("新增失敗: " + e.message);
    }
  };

  const deleteTable = async (table) => {
    setDeleteConfirm(table);
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await tablesApi.delete(deleteConfirm.id);
      setDeleteConfirm(null);
      loadTables();
    } catch (e) {
      alert("刪除失敗: " + e.message);
      setDeleteConfirm(null);
    }
  };

  // ===== 商品管理 =====
  const createProduct = async () => {
    const name = newProductName.trim();
    const price = parseFloat(newProductPrice);
    const cost = parseFloat(newProductCost) || 0;

    if (!name) { alert("請輸入商品名稱"); return; }
    if (!newProductCategory) { alert("請選擇分類"); return; }
    if (isNaN(price) || price < 0) { alert("請輸入有效的售價"); return; }

    try {
      await productsApi.create({
        name,
        category_id: newProductCategory,
        price,
        cost,
        tax_rate: 0,
        description: newProductDescription.trim(),
      });
      setNewProductName("");
      setNewProductCategory("");
      setNewProductPrice("");
      setNewProductCost("0");
      setNewProductDescription("");
      loadProducts();
    } catch (e) {
      alert("新增失敗: " + e.message);
    }
  };

  const deleteProduct = (product) => {
    setProductDeleteConfirm(product);
  };

  const confirmProductDelete = async () => {
    if (!productDeleteConfirm) return;
    try {
      await productsApi.delete(productDeleteConfirm.id);
      setProductDeleteConfirm(null);
      loadProducts();
    } catch (e) {
      alert("刪除失敗: " + e.message);
      setProductDeleteConfirm(null);
    }
  };

  // ===== Excel 操作 =====
  const downloadTemplate = () => {
    window.open(productsApi.template(), "_blank");
  };

  const handleExport = () => {
    window.open(productsApi.export(), "_blank");
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const result = await productsApi.import(file);
      setImportResult(result);
      loadProducts();
    } catch (err) {
      setImportResult({ error: err.message });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="flex gap-8 mb-12">
        {[
          { key: "devices", label: "設備配置" },
          { key: "lists", label: "商品列表" },
          { key: "create", label: "新增商品" },
          { key: "tables", label: "桌台管理" },
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

      <div style={{ flex: 1, overflowY: "auto" }}>
        {activeTab === "devices" ? (
          <div className="card">
            <div className="card-title">系統配置</div>
            <table className="table-touch">
              <thead>
                <tr>
                  <th>配置項</th>
                  <th>當前值</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {configs.map((c) => (
                  <tr key={c.key}>
                    <td style={{ fontWeight: 600 }}>{c.key.replace(/_/g, " ")}</td>
                    <td>
                      {editingKey === c.key ? (
                        <input
                          className="input"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          style={{ width: 300 }}
                        />
                      ) : (
                        c.value
                      )}
                    </td>
                    <td>
                      {editingKey === c.key ? (
                        <div className="flex gap-8">
                          <button className="btn btn-success" onClick={() => saveConfig(c.key)}>保存</button>
                          <button className="btn btn-secondary" onClick={() => setEditingKey(null)}>取消</button>
                        </div>
                      ) : (
                        <button className="btn btn-secondary" onClick={() => { setEditingKey(c.key); setEditValue(c.value); }}>
                          編輯
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : activeTab === "lists" ? (
          <div className="card">
            <div className="card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>商品列表</span>
              <button className="btn btn-primary" onClick={handleExport}>導出 Excel</button>
            </div>
            <table className="table-touch">
              <thead>
                <tr>
                  <th>名稱</th>
                  <th>分類</th>
                  <th>售價</th>
                  <th>成本</th>
                  <th>狀態</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const cat = categories.find((c) => c.id === p.categoryId);
                  return (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600 }}>{p.name}</td>
                      <td>{cat?.name || "-"}</td>
                      <td className="amount">${p.price}</td>
                      <td className="amount">${p.cost}</td>
                      <td>
                        <span className={p.isAvailable ? "badge badge-success" : "badge badge-danger"}>
                          {p.isAvailable ? "上架" : "下架"}
                        </span>
                      </td>
                      <td>
                        <div className="flex gap-8">
                          <button className="btn btn-secondary" onClick={() => toggleProduct(p)}>
                            {p.isAvailable ? "下架" : "上架"}
                          </button>
                          <button className="btn btn-danger" onClick={() => deleteProduct(p)}>
                            刪除
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {products.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)", padding: "24px" }}>
                      暫無商品，請至「新增商品」添加
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : activeTab === "create" ? (
          <div className="card">
            <div className="card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>新增商品</span>
              <div className="flex gap-8">
                <button className="btn btn-secondary" onClick={downloadTemplate}>下載模板</button>
                <button className="btn btn-primary" onClick={handleImportClick} disabled={importing}>
                  {importing ? "匯入中..." : "導入 Excel"}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  style={{ display: "none" }}
                  onChange={handleFileChange}
                />
              </div>
            </div>

            {/* 新增商品表單 */}
            <div className="flex items-end gap-8 mb-16" style={{ padding: "12px 0", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
              <div>
                <label className="text-sm text-muted" style={{ display: "block", marginBottom: 4 }}>名稱</label>
                <input
                  className="input"
                  value={newProductName}
                  onChange={(e) => setNewProductName(e.target.value)}
                  placeholder="商品名稱"
                  style={{ width: 150 }}
                />
              </div>
              <div>
                <label className="text-sm text-muted" style={{ display: "block", marginBottom: 4 }}>分類</label>
                <select
                  className="input"
                  value={newProductCategory}
                  onChange={(e) => setNewProductCategory(e.target.value)}
                  style={{ width: 130 }}
                >
                  <option value="">選擇分類</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm text-muted" style={{ display: "block", marginBottom: 4 }}>售價</label>
                <input
                  className="input"
                  type="number"
                  step="0.1"
                  min="0"
                  value={newProductPrice}
                  onChange={(e) => setNewProductPrice(e.target.value)}
                  placeholder="0"
                  style={{ width: 100 }}
                />
              </div>
              <div>
                <label className="text-sm text-muted" style={{ display: "block", marginBottom: 4 }}>成本</label>
                <input
                  className="input"
                  type="number"
                  step="0.1"
                  min="0"
                  value={newProductCost}
                  onChange={(e) => setNewProductCost(e.target.value)}
                  placeholder="0"
                  style={{ width: 100 }}
                />
              </div>
              <div>
                <label className="text-sm text-muted" style={{ display: "block", marginBottom: 4 }}>描述</label>
                <input
                  className="input"
                  value={newProductDescription}
                  onChange={(e) => setNewProductDescription(e.target.value)}
                  placeholder="選填"
                  style={{ width: 180 }}
                />
              </div>
              <button className="btn btn-primary" onClick={createProduct}>
                新增商品
              </button>
            </div>

            {/* 匯入結果 */}
            {importResult && (
              <div style={{ marginTop: 12 }}>
                {importResult.error ? (
                  <div className="card" style={{ borderColor: "var(--danger)", background: "#fff5f5" }}>
                    <div style={{ color: "var(--danger)", fontWeight: 600, marginBottom: 8 }}>匯入失敗</div>
                    <div>{importResult.error}</div>
                  </div>
                ) : (
                  <div className="card" style={{ borderColor: "var(--success)", background: "#f0fff4" }}>
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>
                      匯入完成：成功 {importResult.success} 筆，失敗 {importResult.failed} 筆
                    </div>
                    {importResult.failures && importResult.failures.length > 0 && (
                      <table className="table-touch" style={{ marginTop: 8 }}>
                        <thead>
                          <tr>
                            <th>行號</th>
                            <th>名稱</th>
                            <th>錯誤原因</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importResult.failures.map((f, i) => (
                            <tr key={i}>
                              <td>{f.row}</td>
                              <td>{f.name || "-"}</td>
                              <td style={{ color: "var(--danger)" }}>{f.errors.join("、")}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="card">
            <div className="card-title">桌台管理</div>
            <div className="flex items-end gap-8 mb-16" style={{ padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
              <div>
                <label className="text-sm text-muted" style={{ display: "block", marginBottom: 4 }}>桌台名稱</label>
                <input
                  className="input"
                  value={newTableName}
                  onChange={(e) => setNewTableName(e.target.value)}
                  placeholder="如：桌13、VIP3"
                  style={{ width: 200 }}
                />
              </div>
              <div>
                <label className="text-sm text-muted" style={{ display: "block", marginBottom: 4 }}>容量</label>
                <select
                  className="input"
                  value={newTableCapacity}
                  onChange={(e) => setNewTableCapacity(parseInt(e.target.value))}
                  style={{ width: 100 }}
                >
                  {Array.from({ length: 19 }, (_, i) => i + 2).map((n) => (
                    <option key={n} value={n}>{n} 人</option>
                  ))}
                </select>
              </div>
              <button className="btn btn-primary" onClick={createTable}>
                新增桌台
              </button>
            </div>
            <table className="table-touch">
              <thead>
                <tr>
                  <th>桌台名稱</th>
                  <th>容量</th>
                  <th>區域</th>
                  <th>狀態</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {tablesList.map((t) => (
                  <tr key={t.id}>
                    <td style={{ fontWeight: 600 }}>{t.name}</td>
                    <td>{t.capacity} 人</td>
                    <td>{t.section}</td>
                    <td>
                      <span className={t.status === "available" ? "badge badge-success" : "badge badge-warning"}>
                        {t.status === "available" ? "空閒" : "使用中"}
                      </span>
                    </td>
                    <td>
                      <button
                        className="btn btn-danger"
                        onClick={() => deleteTable(t)}
                      >
                        刪除
                      </button>
                    </td>
                  </tr>
                ))}
                {tablesList.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)", padding: "24px" }}>
                      暫無桌台，請新增
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* 刪除確認彈窗 - 桌台 */}
        {deleteConfirm && (
          <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h2>確認刪除</h2>
              <p style={{ margin: "16px 0" }}>
                確定要刪除桌台「{deleteConfirm.name}」嗎？此操作無法復原。
              </p>
              <div className="flex gap-8 mt-16">
                <button className="btn btn-secondary btn-block" onClick={() => setDeleteConfirm(null)}>取消</button>
                <button className="btn btn-danger btn-block" onClick={confirmDelete}>確認刪除</button>
              </div>
            </div>
          </div>
        )}

        {/* 刪除確認彈窗 - 商品 */}
        {productDeleteConfirm && (
          <div className="modal-overlay" onClick={() => setProductDeleteConfirm(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h2>確認刪除</h2>
              <p style={{ margin: "16px 0" }}>
                確定要刪除商品「{productDeleteConfirm.name}」嗎？此操作無法復原。
              </p>
              <div className="flex gap-8 mt-16">
                <button className="btn btn-secondary btn-block" onClick={() => setProductDeleteConfirm(null)}>取消</button>
                <button className="btn btn-danger btn-block" onClick={confirmProductDelete}>確認刪除</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

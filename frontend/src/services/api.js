/**
 * API 服務層
 * 封裝所有對 Python 後端的 REST API 請求
 */

const BASE_URL = "/api";

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "請求失敗" }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

// ===== 商品 =====
export const productsApi = {
  list: (categoryId) => request(`/products${categoryId ? `?category_id=${categoryId}` : ""}`),
  categories: () => request("/products/categories"),
  create: (data) => request("/products", { method: "POST", body: JSON.stringify(data) }),
  update: (id, data) => request(`/products/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  delete: (id) => request(`/products/${id}`, { method: "DELETE" }),
  import: async (file) => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`${BASE_URL}/products/import`, { method: "POST", body: formData });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "匯入失敗" }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
  },
  export: () => `${BASE_URL}/products/export`,
  template: () => `${BASE_URL}/products/template`,
};

// ===== 訂單 =====
export const ordersApi = {
  list: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/orders${qs ? "?" + qs : ""}`);
  },
  get: (id) => request(`/orders/${id}`),
  create: (data) => request("/orders", { method: "POST", body: JSON.stringify(data) }),
  addItems: (id, data) => request(`/orders/${id}/items`, { method: "POST", body: JSON.stringify(data) }),
  removeItem: (id, data) => request(`/orders/${id}/items/remove`, { method: "POST", body: JSON.stringify(data) }),
  applyDiscount: (id, data) => request(`/orders/${id}/discount`, { method: "POST", body: JSON.stringify(data) }),
  checkout: (id, data) => request(`/payments/${id}/checkout`, { method: "POST", body: JSON.stringify(data) }),
  sendToKitchen: (id) => request(`/payments/${id}/send-to-kitchen`, { method: "POST" }),
  refund: (id) => request(`/payments/${id}/refund`, { method: "POST" }),
  activeTables: () => request("/orders/active/tables"),
  kdsPending: () => request("/orders/kds/pending"),
};

// ===== 班次 =====
export const shiftsApi = {
  current: () => request("/shifts/current"),
  open: (data) => request("/shifts/open", { method: "POST", body: JSON.stringify(data) }),
  close: (data) => request("/shifts/close", { method: "POST", body: JSON.stringify(data) }),
  list: (limit = 20) => request(`/shifts?limit=${limit}`),
};

// ===== 庫存 =====
export const inventoryApi = {
  list: (type) => request(`/inventory${type ? `?record_type=${type}` : ""}`),
  add: (data) => request("/inventory", { method: "POST", body: JSON.stringify(data) }),
  summary: () => request("/inventory/summary"),
};

// ===== 報表 =====
export const reportsApi = {
  dailySales: (date) => request(`/reports/daily-sales${date ? `?date=${date}` : ""}`),
  productRanking: (date) => request(`/reports/product-ranking${date ? `?date=${date}` : ""}`),
  grossProfit: (date) => request(`/reports/gross-profit${date ? `?date=${date}` : ""}`),
  refundReasons: (date) => request(`/reports/refund-reasons${date ? `?date=${date}` : ""}`),
};

// ===== KDS =====
export const kdsApi = {
  updateItemStatus: (itemId, status, operator) =>
    request(`/kds/items/${itemId}/status`, {
      method: "POST",
      body: JSON.stringify({ item_id: itemId, status, operator }),
    }),
};

// ===== 設備 =====
export const devicesApi = {
  list: () => request("/devices"),
  update: (key, value) => request(`/devices/${key}`, { method: "PUT", body: JSON.stringify({ value }) }),
  shopInfo: () => request("/devices/shop"),
};

// ===== 桌台 =====
export const tablesApi = {
  list: () => request("/tables"),
  create: (data) => request("/tables", { method: "POST", body: JSON.stringify(data) }),
  delete: (id) => request(`/tables/${id}`, { method: "DELETE" }),
};

// ===== 審計 =====
export const auditApi = {
  list: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/audit${qs ? "?" + qs : ""}`);
  },
};

// ===== 健康檢查 =====
export const healthCheck = () => request("/health");

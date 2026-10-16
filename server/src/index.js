/**
 * POS 本地服務端 REST API
 * 所有業務資料存放在本地 SQLite（server/data/pos.db），無雲端依賴。
 */
const express = require('express');
const cors = require('cors');
const path = require('node:path');
const fs = require('node:fs');
const { getDb, reopenDb, DB_PATH, DATA_DIR, hashPassword, verifyPassword } = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 3001);

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const ok = (res, data) => res.json({ code: 0, data });
const fail = (res, message, status = 400) => res.status(status).json({ code: status, message });

/* ---------- 身份（本地單店應用，登入後透過頭部傳遞身份；敏感操作以 role 控制） ---------- */
app.use((req, _res, next) => {
  req.user = { id: Number(req.headers['x-user-id']) || null, role: req.headers['x-role'] || null };
  next();
});
function managerOnly(req, res, next) {
  if (req.user.role !== 'manager') return fail(res, '此操作需要店長權限', 403);
  next();
}

/* ---------- 工具 ---------- */
function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
function genOrderNo(db) {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  // 取當日最大序號（避免掛單刪除/併桌後 COUNT 回滾造成單號重複）
  const row = db.prepare('SELECT order_no FROM orders WHERE order_no LIKE ? ORDER BY id DESC LIMIT 1')
    .get(`POS${ymd}-%`);
  let seq = 0;
  if (row) {
    const m = String(row.order_no).match(/-(\d+)$/);
    if (m) seq = Number(m[1]);
  }
  return `POS${ymd}-${String(seq + 1).padStart(4, '0')}`;
}
function recomputeOrderTotal(db, orderId) {
  const row = db.prepare('SELECT COALESCE(SUM(price * quantity), 0) AS s FROM order_items WHERE order_id = ?').get(orderId);
  db.prepare('UPDATE orders SET total_amount = ? WHERE id = ?').run(row.s, orderId);
}
function orderWithItems(db, id) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) return null;
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(id);
  return order;
}
function freeTable(db, tableId, status = 'cleaning') {
  db.prepare('UPDATE tables SET status = ?, current_order_id = NULL WHERE id = ?').run(status, tableId);
}
/** 清理臨時檔案：刪除失敗不影響業務回應 */
function safeUnlink(file) {
  try { fs.unlinkSync(file); } catch { /* ignore */ }
}

/* ---------------- 飲品時段計價引擎 ---------------- */
/** 根據當前時間找出所屬時段 */
function currentTimeSlot(db, now = new Date()) {
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const slots = db.prepare('SELECT * FROM time_slots').all();
  return slots.find((s) => hm >= s.start_time && hm < s.end_time) || null;
}
/**
 * 計算飲品最終價格
 * - 下午茶時段：冷熱全免
 * - 午/晚市：熱飲免費；冷飲原價 + 冷飲加價
 */
function computeDrinkPrice(db, basePrice, temperature, now = new Date()) {
  const base = Number(basePrice) || 0;
  const slot = currentTimeSlot(db, now);
  if (!slot) return { price: base, period: null, periodCode: null, saved: 0 };
  const code = slot.code;
  if (Number(slot.drink_all_free) === 1) return { price: 0, period: slot.name, periodCode: code, saved: base };
  if (temperature === 'HOT' && Number(slot.drink_hot_free) === 1) return { price: 0, period: slot.name, periodCode: code, saved: base };
  if (temperature === 'COLD') {
    const extra = Number(slot.drink_cold_extra) || 0;
    return { price: base + extra, period: slot.name, periodCode: code, saved: -extra };
  }
  return { price: base, period: slot.name, periodCode: code, saved: 0 };
}
/** 依套餐選項計算單品總價（後端覆核，防止前端被改價） */
function computeComboUnitPrice(db, product, it) {
  const rawOptions = it.options || null;
  const options = rawOptions ? (typeof rawOptions === 'string' ? JSON.parse(rawOptions) : rawOptions) : null;
  // 獨立飲品：品項本身即飲品時，單價 = 飲品時段價（不重複計基礎價）
  const isSelfDrink = Number(product.is_drink) === 1 && options && options.drink
    && Number(options.drink.product_id) === Number(product.id);
  let unit = isSelfDrink ? 0 : Number(product.price) || 0;
  if (!options) return { unit: unit + Number(it.spec_diff || 0), options: null };
  for (const key of ['noodle', 'spiciness', 'filling', 'flavor']) {
    if (options[key] && options[key].price_diff) unit += Number(options[key].price_diff) || 0;
  }
  for (const t of options.toppings || []) unit += Number(t.price_diff) || 0;
  if (options.drink && options.drink.product_id) {
    const dp = db.prepare('SELECT * FROM products WHERE id = ?').get(options.drink.product_id);
    if (dp) {
      const calc = computeDrinkPrice(db, Number(dp.price), options.drink.temperature || 'HOT');
      options.drink = {
        ...options.drink,
        product_id: dp.id,
        name: dp.name,
        base_price: Number(dp.price),
        final_price: calc.price,
        period: calc.period,
      };
      unit += calc.price;
    }
  }
  return { unit, options };
}

/* ================= 登入 / 員工 ================= */
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return fail(res, '請輸入帳號密碼');
  const db = getDb();
  const staff = db.prepare('SELECT * FROM staff WHERE username = ?').get(username);
  if (!staff || !staff.is_active) return fail(res, '帳號不存在或已停用', 401);
  if (!verifyPassword(password, staff.password)) return fail(res, '密碼錯誤', 401);
  ok(res, { id: staff.id, username: staff.username, name: staff.name, role: staff.role });
});

app.get('/api/staff', managerOnly, (req, res) => {
  const db = getDb();
  ok(res, db.prepare('SELECT id, username, name, role, is_active, created_at FROM staff ORDER BY id').all());
});
app.post('/api/staff', managerOnly, (req, res) => {
  const { username, password, name, role } = req.body || {};
  if (!username || !password || !name) return fail(res, '請填寫完整資料');
  if (!['manager', 'cashier'].includes(role)) return fail(res, '角色不合法');
  const db = getDb();
  const exists = db.prepare('SELECT id FROM staff WHERE username = ?').get(username);
  if (exists) return fail(res, '帳號已存在');
  const r = db.prepare('INSERT INTO staff (username, password, name, role) VALUES (?, ?, ?, ?)')
    .run(username, hashPassword(password), name, role);
  ok(res, { id: Number(r.lastInsertRowid) });
});
app.put('/api/staff/:id', managerOnly, (req, res) => {
  const db = getDb();
  const staff = db.prepare('SELECT * FROM staff WHERE id = ?').get(req.params.id);
  if (!staff) return fail(res, '員工不存在', 404);
  const { name, role, is_active, password } = req.body || {};
  db.prepare('UPDATE staff SET name = ?, role = ?, is_active = ? WHERE id = ?')
    .run(name ?? staff.name, role ?? staff.role, is_active ?? staff.is_active, staff.id);
  if (password) db.prepare('UPDATE staff SET password = ? WHERE id = ?').run(hashPassword(password), staff.id);
  ok(res, { updated: true });
});
app.delete('/api/staff/:id', managerOnly, (req, res) => {
  const db = getDb();
  if (Number(req.params.id) === req.user.id) return fail(res, '不能刪除目前登入的帳號');
  db.prepare('DELETE FROM staff WHERE id = ?').run(req.params.id);
  ok(res, { deleted: true });
});

/* ================= 分類 / 菜品 ================= */
app.get('/api/categories', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.is_available = 1) AS product_count
    FROM categories c WHERE c.is_deleted = 0 ORDER BY c.sort_order, c.id`).all();
  ok(res, rows);
});
app.post('/api/categories', managerOnly, (req, res) => {
  const { name, sort_order = 0 } = req.body || {};
  if (!name) return fail(res, '請輸入分類名稱');
  const db = getDb();
  const r = db.prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)').run(name, sort_order);
  ok(res, { id: Number(r.lastInsertRowid) });
});
app.put('/api/categories/:id', managerOnly, (req, res) => {
  const db = getDb();
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!cat) return fail(res, '分類不存在', 404);
  const { name, sort_order } = req.body || {};
  db.prepare('UPDATE categories SET name = ?, sort_order = ? WHERE id = ?')
    .run(name ?? cat.name, sort_order ?? cat.sort_order, cat.id);
  ok(res, { updated: true });
});
app.delete('/api/categories/:id', managerOnly, (req, res) => {
  const db = getDb();
  db.prepare('UPDATE categories SET is_deleted = 1 WHERE id = ?').run(req.params.id);
  db.prepare('UPDATE products SET is_available = 0 WHERE category_id = ?').run(req.params.id);
  ok(res, { deleted: true });
});

app.get('/api/products', (req, res) => {
  const db = getDb();
  const { category_id, all } = req.query;
  let sql = `SELECT p.*, c.name AS category_name FROM products p
    LEFT JOIN categories c ON c.id = p.category_id WHERE 1 = 1`;
  const args = [];
  if (category_id) { sql += ' AND p.category_id = ?'; args.push(category_id); }
  if (all !== '1') sql += ' AND p.is_available = 1';
  sql += ' ORDER BY p.id';
  ok(res, db.prepare(sql).all(...args));
});
app.post('/api/products', managerOnly, (req, res) => {
  const { category_id, name, price, barcode, emoji, color, specs, is_available } = req.body || {};
  if (!name || price == null) return fail(res, '請輸入名稱與價格');
  const db = getDb();
  const r = db.prepare(`INSERT INTO products (category_id, name, price, barcode, emoji, color, specs, is_available)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(category_id ?? null, name, Number(price), barcode ?? null,
    emoji ?? '🍽️', color ?? '#f59e0b', specs ? JSON.stringify(specs) : null, is_available ?? 1);
  ok(res, { id: Number(r.lastInsertRowid) });
});
app.put('/api/products/:id', managerOnly, (req, res) => {
  const db = getDb();
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) return fail(res, '菜品不存在', 404);
  const { category_id, name, price, barcode, emoji, color, specs, is_available } = req.body || {};
  db.prepare(`UPDATE products SET category_id = ?, name = ?, price = ?, barcode = ?, emoji = ?, color = ?,
    specs = ?, is_available = ? WHERE id = ?`).run(
    category_id ?? p.category_id, name ?? p.name, price ?? p.price, barcode ?? p.barcode,
    emoji ?? p.emoji, color ?? p.color,
    specs !== undefined ? (specs ? JSON.stringify(specs) : null) : p.specs,
    is_available ?? p.is_available, p.id);
  ok(res, { updated: true });
});
app.delete('/api/products/:id', managerOnly, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  ok(res, { deleted: true });
});

/* ================= 菜單（套餐樹 + 飲品） ================= */
app.get('/api/menu', (req, res) => {
  const db = getDb();
  const cats = db.prepare('SELECT * FROM categories WHERE is_deleted = 0 ORDER BY sort_order, id').all();
  const products = db.prepare('SELECT * FROM products WHERE is_available = 1 ORDER BY id').all();
  const links = db.prepare('SELECT * FROM product_options ORDER BY step, id').all();
  const groups = db.prepare('SELECT * FROM option_groups ORDER BY sort_order, id').all();
  const items = db.prepare('SELECT * FROM option_items ORDER BY sort_order, id').all();
  const groupMap = new Map(groups.map((g) => [g.id, { ...g, items: [] }]));
  for (const it of items) {
    const g = groupMap.get(it.group_id);
    if (g) g.items.push(it);
  }
  const out = cats.map((c) => ({ ...c, products: [] }));
  const catMap = new Map(out.map((c) => [c.id, c]));
  const DRINK_GROUP = { id: 0, code: 'drink', name: '選擇飲品（跟餐）', is_multi: 0, items: [] };
  for (const p of products) {
    const steps = links
      .filter((l) => l.product_id === p.id)
      .map((l) => {
        const g = l.group_id ? groupMap.get(l.group_id) : DRINK_GROUP;
        return g ? { ...g, step: l.step, required: Number(l.required) } : null;
      })
      .filter(Boolean);
    const entry = { ...p, steps };
    const c = catMap.get(p.category_id);
    if (c) c.products.push(entry);
  }
  ok(res, {
    categories: out.filter((c) => c.products.length),
    drinks: products.filter((p) => Number(p.is_drink) === 1),
  });
});

/* ================= 時段設定 ================= */
app.get('/api/time-slots', (req, res) => {
  ok(res, getDb().prepare('SELECT * FROM time_slots ORDER BY start_time').all());
});
app.put('/api/time-slots', managerOnly, (req, res) => {
  const slots = req.body && req.body.slots;
  if (!Array.isArray(slots) || !slots.length) return fail(res, '資料不正確');
  for (const s of slots) {
    if (!s.code || !s.name) return fail(res, '時段代碼與名稱為必填');
    if (!/^\d{1,2}:\d{2}$/.test(s.start_time || '') || !/^\d{1,2}:\d{2}$/.test(s.end_time || '')) {
      return fail(res, '時間格式需為 HH:MM');
    }
  }
  const db = getDb();
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM time_slots').run();
    const ins = db.prepare(`INSERT INTO time_slots (code, name, start_time, end_time, drink_all_free, drink_cold_extra, drink_hot_free)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const s of slots) {
      ins.run(s.code, s.name, s.start_time, s.end_time,
        s.drink_all_free ? 1 : 0, Number(s.drink_cold_extra) || 0, s.drink_hot_free ? 1 : 0);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return fail(res, '儲存失敗：' + e.message);
  }
  ok(res, db.prepare('SELECT * FROM time_slots ORDER BY start_time').all());
});

/* ================= 桌台 ================= */
app.get('/api/tables', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT t.*, o.id AS order_id, o.order_no, o.total_amount, o.created_at AS opened_at,
      (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
    FROM tables t
    LEFT JOIN orders o ON o.id = t.current_order_id AND o.status = 'open'
    ORDER BY t.id`).all();
  ok(res, rows);
});
app.post('/api/tables', managerOnly, (req, res) => {
  const { table_number, area = '大廳', capacity = 4 } = req.body || {};
  if (!table_number) return fail(res, '請輸入桌號');
  const db = getDb();
  const dup = db.prepare('SELECT id FROM tables WHERE table_number = ?').get(table_number);
  if (dup) return fail(res, '桌號已存在');
  const r = db.prepare('INSERT INTO tables (table_number, area, capacity) VALUES (?, ?, ?)')
    .run(table_number, area, Number(capacity));
  ok(res, { id: Number(r.lastInsertRowid) });
});
app.put('/api/tables/:id', managerOnly, (req, res) => {
  const db = getDb();
  const t = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
  if (!t) return fail(res, '桌台不存在', 404);
  const { table_number, area, capacity } = req.body || {};
  db.prepare('UPDATE tables SET table_number = ?, area = ?, capacity = ? WHERE id = ?')
    .run(table_number ?? t.table_number, area ?? t.area, capacity ?? t.capacity, t.id);
  ok(res, { updated: true });
});
app.delete('/api/tables/:id', managerOnly, (req, res) => {
  const db = getDb();
  const t = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
  if (!t) return fail(res, '桌台不存在', 404);
  if (t.status === 'occupied') return fail(res, '桌台用餐中，無法刪除');
  db.prepare('DELETE FROM tables WHERE id = ?').run(t.id);
  ok(res, { deleted: true });
});
app.patch('/api/tables/:id/status', (req, res) => {
  const db = getDb();
  const t = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
  if (!t) return fail(res, '桌台不存在', 404);
  const { status } = req.body || {};
  if (!['available', 'occupied', 'reserved', 'cleaning'].includes(status)) return fail(res, '狀態不合法');
  if (status === 'occupied') return fail(res, '請透過開台佔用桌台');
  db.prepare('UPDATE tables SET status = ?, current_order_id = NULL WHERE id = ?').run(status, t.id);
  ok(res, { updated: true });
});
/** 開台：建立進行中的訂單 */
app.post('/api/tables/:id/open', (req, res) => {
  const db = getDb();
  const t = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
  if (!t) return fail(res, '桌台不存在', 404);
  if (t.status === 'occupied') return fail(res, '桌台已在用餐中');
  const r = db.prepare(`INSERT INTO orders (order_no, table_id, status, cashier_id)
    VALUES (?, ?, 'open', ?)`).run(genOrderNo(db), t.id, req.user.id);
  const orderId = Number(r.lastInsertRowid);
  db.prepare("UPDATE tables SET status = 'occupied', current_order_id = ? WHERE id = ?").run(orderId, t.id);
  ok(res, orderWithItems(db, orderId));
});
/** 併桌：把 from 的訂單（含明細）併入 to */
app.post('/api/tables/merge', (req, res) => {
  const { from_id, to_id } = req.body || {};
  if (!from_id || !to_id || Number(from_id) === Number(to_id)) return fail(res, '參數不正確');
  const db = getDb();
  const from = db.prepare('SELECT * FROM tables WHERE id = ?').get(from_id);
  const to = db.prepare('SELECT * FROM tables WHERE id = ?').get(to_id);
  if (!from || !to) return fail(res, '桌台不存在', 404);
  const fromOrder = db.prepare("SELECT * FROM orders WHERE table_id = ? AND status = 'open'").get(from.id);
  if (!fromOrder) return fail(res, '來源桌台沒有進行中的訂單');
  const toOrder = db.prepare("SELECT * FROM orders WHERE table_id = ? AND status = 'open'").get(to.id);
  if (toOrder) {
    db.prepare('UPDATE order_items SET order_id = ? WHERE order_id = ?').run(toOrder.id, fromOrder.id);
    db.prepare('DELETE FROM orders WHERE id = ?').run(fromOrder.id);
    recomputeOrderTotal(db, toOrder.id);
  } else {
    db.prepare('UPDATE orders SET table_id = ? WHERE id = ?').run(to.id, fromOrder.id);
    db.prepare('UPDATE tables SET current_order_id = ? WHERE id = ?').run(fromOrder.id, to.id);
  }
  db.prepare("UPDATE tables SET status = 'available', current_order_id = NULL WHERE id = ?").run(from.id);
  db.prepare("UPDATE tables SET status = 'occupied' WHERE id = ?").run(to.id);
  ok(res, { order_id: toOrder ? toOrder.id : fromOrder.id });
});

/* ================= 訂單 ================= */
app.get('/api/orders', (req, res) => {
  const db = getDb();
  const { status, date, table_id, limit = 200 } = req.query;
  let sql = `SELECT o.*, t.table_number, s.name AS cashier_name,
      (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
    FROM orders o
    LEFT JOIN tables t ON t.id = o.table_id
    LEFT JOIN staff s ON s.id = o.cashier_id
    WHERE 1 = 1`;
  const args = [];
  if (status) { sql += ' AND o.status = ?'; args.push(status); }
  if (date) { sql += ' AND date(o.created_at) = ?'; args.push(date); }
  if (table_id) { sql += ' AND o.table_id = ?'; args.push(table_id); }
  sql += ' ORDER BY o.id DESC LIMIT ?';
  args.push(Number(limit));
  ok(res, db.prepare(sql).all(...args));
});
app.get('/api/orders/:id', (req, res) => {
  const db = getDb();
  const order = orderWithItems(db, req.params.id);
  if (!order) return fail(res, '訂單不存在', 404);
  ok(res, order);
});
/** 建立訂單：開桌訂單 / 掛單（status=held，含明細）/ 快速結帳（含明細） */
app.post('/api/orders', (req, res) => {
  const { table_id, status = 'open', items = [], remark } = req.body || {};
  const db = getDb();
  if (table_id) {
    const t = db.prepare('SELECT * FROM tables WHERE id = ?').get(table_id);
    if (!t) return fail(res, '桌台不存在', 404);
    if (t.status === 'occupied') return fail(res, '桌台已在用餐中');
  }
  const orderNo = genOrderNo(db);
  const r = db.prepare(`INSERT INTO orders (order_no, table_id, status, remark, cashier_id)
    VALUES (?, ?, ?, ?, ?)`).run(orderNo, table_id ?? null, status, remark ?? null, req.user.id);
  const orderId = Number(r.lastInsertRowid);
  for (const it of items) {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id);
    if (!p) continue;
    const calc = computeComboUnitPrice(db, p, it);
    const itemType = p.kind === 'combo' ? 'combo' : calc.options ? 'combo' : 'simple';
    db.prepare(`INSERT INTO order_items
      (order_id, product_id, product_name, price, quantity, spec, remark, item_type, options)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(orderId, p.id, p.name, calc.unit,
      Number(it.quantity || 1), it.spec ?? null, it.remark ?? null, itemType,
      calc.options ? JSON.stringify(calc.options) : null);
  }
  recomputeOrderTotal(db, orderId);
  if (table_id && status === 'open') {
    db.prepare("UPDATE tables SET status = 'occupied', current_order_id = ? WHERE id = ?").run(orderId, table_id);
  }
  ok(res, orderWithItems(db, orderId));
});
/** 加菜（支援套餐選項；價格由後端覆核計算） */
app.post('/api/orders/:id/items', (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order || order.status !== 'open') return fail(res, '訂單狀態不可加菜');
  const { product_id, quantity = 1, spec, spec_diff = 0, remark, options } = req.body || {};
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);
  if (!p) return fail(res, '菜品不存在', 404);
  if (!p.is_available) return fail(res, `「${p.name}」已售罄`);
  const calc = computeComboUnitPrice(db, p, { options, spec_diff });
  const itemType = p.kind === 'combo' ? 'combo' : calc.options ? 'combo' : 'simple';
  const r = db.prepare(`INSERT INTO order_items
    (order_id, product_id, product_name, price, quantity, spec, remark, item_type, options)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(order.id, p.id, p.name, calc.unit,
    Number(quantity), spec ?? null, remark ?? null, itemType,
    calc.options ? JSON.stringify(calc.options) : null);
  recomputeOrderTotal(db, order.id);
  ok(res, db.prepare('SELECT * FROM order_items WHERE id = ?').get(Number(r.lastInsertRowid)));
});
app.put('/api/orders/:id/items/:itemId', (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order || order.status !== 'open') return fail(res, '訂單狀態不可修改');
  const { quantity, remark } = req.body || {};
  db.prepare('UPDATE order_items SET quantity = ?, remark = ? WHERE id = ? AND order_id = ?')
    .run(Number(quantity), remark ?? null, req.params.itemId, order.id);
  recomputeOrderTotal(db, order.id);
  ok(res, { updated: true });
});
/** 退菜 */
app.delete('/api/orders/:id/items/:itemId', (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order || order.status !== 'open') return fail(res, '訂單狀態不可退菜');
  db.prepare('DELETE FROM order_items WHERE id = ? AND order_id = ?').run(req.params.itemId, order.id);
  recomputeOrderTotal(db, order.id);
  ok(res, { deleted: true });
});
/** 換桌 / 備註 */
app.patch('/api/orders/:id', (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return fail(res, '訂單不存在', 404);
  if (order.status !== 'open') return fail(res, '僅進行中的訂單可換桌');
  const { table_id, remark } = req.body || {};
  if (table_id != null && Number(table_id) !== order.table_id) {
    const t = db.prepare('SELECT * FROM tables WHERE id = ?').get(table_id);
    if (!t) return fail(res, '目標桌台不存在', 404);
    if (t.status === 'occupied') return fail(res, '目標桌台用餐中，請先併桌或選其他桌台');
    if (order.table_id) freeTable(db, order.table_id, 'cleaning');
    db.prepare('UPDATE orders SET table_id = ? WHERE id = ?').run(t.id, order.id);
    db.prepare("UPDATE tables SET status = 'occupied', current_order_id = ? WHERE id = ?").run(order.id, t.id);
  }
  if (remark !== undefined) db.prepare('UPDATE orders SET remark = ? WHERE id = ?').run(remark, order.id);
  ok(res, orderWithItems(db, order.id));
});
/** 結帳 */
app.post('/api/orders/:id/pay', (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return fail(res, '訂單不存在', 404);
  if (order.status === 'completed') return fail(res, '訂單已結帳');
  if (order.status === 'voided') return fail(res, '訂單已作廢');
  const { payment_method, discount_amount = 0, received_amount = 0 } = req.body || {};
  if (!payment_method) return fail(res, '請選擇支付方式');
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  if (!items.length) return fail(res, '訂單無明細，無法結帳');
  const subtotal = items.reduce((s, it) => s + it.price * it.quantity, 0);
  const settings = getSettings(db);
  const serviceRate = Number(settings.service_fee_rate || 0);
  const serviceFee = Math.round(subtotal * serviceRate);
  const discount = Number(discount_amount || 0);
  const total = Math.max(0, subtotal + serviceFee - discount);
  const isCash = payment_method === 'cash';
  const received = isCash ? Number(received_amount || 0) : total;
  if (isCash && received < total) return fail(res, '收現金額不足');
  const change = isCash ? received - total : 0;
  const shift = db.prepare(`SELECT * FROM shift_records WHERE cashier_id = ? AND status = 'open'
    ORDER BY id DESC LIMIT 1`).get(order.cashier_id);
  db.prepare(`UPDATE orders SET status = 'completed', total_amount = ?, discount_amount = ?, service_fee = ?,
    pay_amount = ?, received_amount = ?, change_amount = ?, payment_method = ?, shift_id = ? WHERE id = ?`)
    .run(subtotal, discount, serviceFee, total, received, change, payment_method, shift ? shift.id : null, order.id);
  if (order.table_id) freeTable(db, order.table_id, 'cleaning');
  ok(res, orderWithItems(db, order.id));
});
/** 作廢訂單（店長） */
app.post('/api/orders/:id/void', managerOnly, (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return fail(res, '訂單不存在', 404);
  if (order.status === 'voided') return fail(res, '訂單已作廢');
  if (order.status === 'completed') return fail(res, '已結帳訂單不可作廢');
  db.prepare("UPDATE orders SET status = 'voided' WHERE id = ?").run(order.id);
  if (order.table_id) freeTable(db, order.table_id, 'cleaning');
  ok(res, { updated: true });
});
/** 刪除掛單 */
app.delete('/api/orders/:id', (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return fail(res, '訂單不存在', 404);
  if (order.status !== 'held') return fail(res, '僅掛單可刪除');
  db.prepare('DELETE FROM order_items WHERE order_id = ?').run(order.id);
  db.prepare('DELETE FROM orders WHERE id = ?').run(order.id);
  ok(res, { deleted: true });
});

/* ================= 支付方式 ================= */
app.get('/api/payment-methods', (req, res) => {
  const db = getDb();
  ok(res, db.prepare('SELECT * FROM payment_methods ORDER BY sort_order, id').all());
});
app.put('/api/payment-methods/:id', managerOnly, (req, res) => {
  const db = getDb();
  const pm = db.prepare('SELECT * FROM payment_methods WHERE id = ?').get(req.params.id);
  if (!pm) return fail(res, '支付方式不存在', 404);
  const { name, is_enabled, fee_rate } = req.body || {};
  db.prepare('UPDATE payment_methods SET name = ?, is_enabled = ?, fee_rate = ? WHERE id = ?')
    .run(name ?? pm.name, is_enabled ?? pm.is_enabled, fee_rate ?? pm.fee_rate, pm.id);
  ok(res, { updated: true });
});

/* ================= 設定 ================= */
const SETTING_KEYS = ['store_name', 'store_address', 'store_phone', 'receipt_footer',
  'service_fee_rate', 'currency', 'business_mode'];
app.get('/api/settings', (req, res) => {
  ok(res, getSettings(getDb()));
});
app.put('/api/settings', managerOnly, (req, res) => {
  const db = getDb();
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  for (const k of SETTING_KEYS) {
    if (req.body && req.body[k] != null) upsert.run(k, String(req.body[k]));
  }
  ok(res, getSettings(db));
});

/* ================= 交接班 ================= */
app.get('/api/shifts', (req, res) => {
  const db = getDb();
  ok(res, db.prepare(`SELECT s.*, st.name AS cashier_name FROM shift_records s
    LEFT JOIN staff st ON st.id = s.cashier_id ORDER BY s.id DESC LIMIT 60`).all());
});
app.get('/api/shifts/current', (req, res) => {
  const db = getDb();
  ok(res, db.prepare(`SELECT * FROM shift_records WHERE cashier_id = ? AND status = 'open'
    ORDER BY id DESC LIMIT 1`).get(req.user.id) || null);
});
app.post('/api/shifts/open', (req, res) => {
  const db = getDb();
  const open = db.prepare(`SELECT * FROM shift_records WHERE cashier_id = ? AND status = 'open'`).get(req.user.id);
  if (open) return fail(res, '已有進行中的交接班，請先結班');
  const r = db.prepare(`INSERT INTO shift_records (start_time, cashier_id, status)
    VALUES (datetime('now','localtime'), ?, 'open')`).run(req.user.id);
  ok(res, db.prepare('SELECT * FROM shift_records WHERE id = ?').get(Number(r.lastInsertRowid)));
});
app.post('/api/shifts/:id/close', (req, res) => {
  const db = getDb();
  const shift = db.prepare('SELECT * FROM shift_records WHERE id = ?').get(req.params.id);
  if (!shift) return fail(res, '交接班記錄不存在', 404);
  if (shift.status === 'closed') return fail(res, '該班別已結班');
  const stats = db.prepare(`SELECT
      COALESCE(SUM(pay_amount), 0) AS total_sales,
      COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN pay_amount ELSE 0 END), 0) AS cash_amount,
      COUNT(*) AS order_count
    FROM orders WHERE cashier_id = ? AND status = 'completed' AND created_at >= ?`).get(shift.cashier_id, shift.start_time);
  db.prepare(`UPDATE shift_records SET end_time = datetime('now','localtime'), total_sales = ?,
    cash_amount = ?, order_count = ?, status = 'closed' WHERE id = ?`)
    .run(stats.total_sales, stats.cash_amount, stats.order_count, shift.id);
  ok(res, db.prepare('SELECT * FROM shift_records WHERE id = ?').get(shift.id));
});

/* ================= 報表 ================= */
app.get('/api/reports/daily', (req, res) => {
  const db = getDb();
  const date = req.query.date || new Date().toLocaleDateString('sv-SE'); // 本地 YYYY-MM-DD
  const summary = db.prepare(`SELECT
      COALESCE(SUM(pay_amount), 0) AS total_sales,
      COALESCE(SUM(discount_amount), 0) AS discount_total,
      COALESCE(SUM(service_fee), 0) AS service_total,
      COUNT(*) AS order_count
    FROM orders WHERE status = 'completed' AND date(created_at) = ?`).get(date);
  const voidCount = db.prepare(`SELECT COUNT(*) AS c FROM orders WHERE status = 'voided' AND date(created_at) = ?`).get(date).c;
  const byPayment = db.prepare(`SELECT payment_method AS method, COUNT(*) AS cnt, SUM(pay_amount) AS amount
    FROM orders WHERE status = 'completed' AND date(created_at) = ? GROUP BY payment_method`).all(date);
  const byHour = db.prepare(`SELECT strftime('%H', created_at) AS hour, COUNT(*) AS cnt, SUM(pay_amount) AS amount
    FROM orders WHERE status = 'completed' AND date(created_at) = ? GROUP BY hour ORDER BY hour`).all(date);
  const topProducts = db.prepare(`SELECT oi.product_name AS name, SUM(oi.quantity) AS qty,
      SUM(oi.price * oi.quantity) AS amount
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.status = 'completed' AND date(o.created_at) = ?
    GROUP BY oi.product_name ORDER BY qty DESC, amount DESC LIMIT 10`).all(date);
  const byCategory = db.prepare(`SELECT COALESCE(c.name, '未分類') AS name,
      SUM(oi.price * oi.quantity) AS amount, SUM(oi.quantity) AS qty
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN products p ON p.id = oi.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE o.status = 'completed' AND date(o.created_at) = ?
    GROUP BY c.id ORDER BY amount DESC`).all(date);
  ok(res, {
    date,
    ...summary,
    avg_order: summary.order_count ? Math.round(summary.total_sales / summary.order_count) : 0,
    void_count: voidCount,
    by_payment: byPayment,
    by_hour: byHour,
    top_products: topProducts,
    by_category: byCategory,
  });
});
app.get('/api/reports/monthly', (req, res) => {
  const db = getDb();
  const now = new Date();
  const month = req.query.month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const summary = db.prepare(`SELECT COALESCE(SUM(pay_amount), 0) AS total_sales,
      COALESCE(SUM(discount_amount), 0) AS discount_total, COUNT(*) AS order_count
    FROM orders WHERE status = 'completed' AND strftime('%Y-%m', created_at) = ?`).get(month);
  const daily = db.prepare(`SELECT date(created_at) AS date, COUNT(*) AS orders, SUM(pay_amount) AS sales
    FROM orders WHERE status = 'completed' AND strftime('%Y-%m', created_at) = ?
    GROUP BY date ORDER BY date`).all(month);
  const byCategory = db.prepare(`SELECT COALESCE(c.name, '未分類') AS name, SUM(oi.price * oi.quantity) AS amount
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    LEFT JOIN products p ON p.id = oi.product_id LEFT JOIN categories c ON c.id = p.category_id
    WHERE o.status = 'completed' AND strftime('%Y-%m', o.created_at) = ?
    GROUP BY c.id ORDER BY amount DESC`).all(month);
  const topProducts = db.prepare(`SELECT oi.product_name AS name, SUM(oi.quantity) AS qty, SUM(oi.price * oi.quantity) AS amount
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.status = 'completed' AND strftime('%Y-%m', o.created_at) = ?
    GROUP BY oi.product_name ORDER BY amount DESC LIMIT 10`).all(month);
  ok(res, { month, ...summary, daily, by_category: byCategory, top_products: topProducts });
});
/** 菜品銷量排行 + ABC 分析 */
app.get('/api/reports/products', (req, res) => {
  const db = getDb();
  const now = new Date();
  const from = req.query.from || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const to = req.query.to || now.toLocaleDateString('sv-SE');
  const rows = db.prepare(`SELECT oi.product_id AS product_id, oi.product_name AS name,
      SUM(oi.quantity) AS qty, SUM(oi.price * oi.quantity) AS revenue
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.status = 'completed' AND date(o.created_at) BETWEEN ? AND ?
    GROUP BY oi.product_id, oi.product_name ORDER BY revenue DESC`).all(from, to);
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  let acc = 0;
  const ranked = rows.map((r, i) => {
    acc += r.revenue;
    const cumPct = totalRevenue ? (acc / totalRevenue) * 100 : 0;
    const grade = cumPct <= 80 ? 'A' : cumPct <= 95 ? 'B' : 'C';
    return { ...r, rank: i + 1, revenue_pct: totalRevenue ? (r.revenue / totalRevenue) * 100 : 0, cum_pct: cumPct, grade };
  });
  ok(res, { from, to, total_revenue: totalRevenue, products: ranked });
});
/** 期間支付方式佔比 */
app.get('/api/reports/payments', (req, res) => {
  const db = getDb();
  const now = new Date();
  const from = req.query.from || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const to = req.query.to || now.toLocaleDateString('sv-SE');
  const rows = db.prepare(`SELECT payment_method AS method, COUNT(*) AS cnt, SUM(pay_amount) AS amount
    FROM orders WHERE status = 'completed' AND date(created_at) BETWEEN ? AND ?
    GROUP BY payment_method ORDER BY amount DESC`).all(from, to);
  ok(res, { from, to, payments: rows });
});

/* ================= 系統：備份 / 還原 ================= */
app.post('/api/system/backup', managerOnly, (req, res) => {
  const { dir } = req.body || {};
  const targetDir = dir && dir.trim() ? dir.trim() : path.join(DATA_DIR, 'backups');
  try {
    fs.mkdirSync(targetDir, { recursive: true });
  } catch {
    return fail(res, '無法建立目標資料夾');
  }
  if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
    return fail(res, '目標資料夾不存在');
  }
  const db = getDb();
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* ignore */ }
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const target = path.join(targetDir, `pos-backup-${ts}.db`);
  fs.copyFileSync(DB_PATH, target);
  ok(res, { file: target, size: fs.statSync(target).size });
});
app.get('/api/system/backup/download', (req, res) => {
  const db = getDb();
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* ignore */ }
  res.download(DB_PATH, `pos-backup-${new Date().toISOString().slice(0, 10)}.db`);
});
app.post('/api/system/restore', managerOnly, express.raw({ type: 'application/octet-stream', limit: '500mb' }), (req, res) => {
  if (!req.body || !req.body.length) return fail(res, '請上傳資料庫檔案');
  const tmp = path.join(DATA_DIR, `restore-${Date.now()}.db`);
  fs.writeFileSync(tmp, req.body);
  try {
    const { DatabaseSync } = require('node:sqlite');
    const test = new DatabaseSync(tmp);
    test.prepare('SELECT COUNT(*) AS c FROM products').get();
    test.close();
  } catch {
    safeUnlink(tmp);
    return fail(res, '無效的 POS 資料庫檔案');
  }
  const db = getDb();
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* ignore */ }
  db.close();
  fs.copyFileSync(tmp, DB_PATH);
  safeUnlink(tmp);
  reopenDb();
  ok(res, { restored: true });
});
app.get('/api/system/info', (req, res) => {
  const db = getDb();
  const counts = {};
  for (const t of ['products', 'orders', 'order_items', 'tables', 'staff', 'shift_records']) {
    counts[t] = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
  }
  ok(res, {
    db_path: DB_PATH,
    size_bytes: fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0,
    counts,
  });
});

/* ================= 靜態託管（production：npm run build 後由本服務器提供前端） ================= */
const distDir = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

app.use((req, res) => {
  if (req.path.startsWith('/api')) return fail(res, '接口不存在', 404);
  res.status(404).send('Not Found');
});

// 統一 JSON 錯誤回應（避免前端解析 HTML 錯誤頁）
app.use((err, req, res, _next) => {
  console.error('[API ERROR]', err.message);
  res.status(500).json({ code: 500, message: '伺服器內部錯誤：' + err.message });
});

app.listen(PORT, () => {
  console.log(`[POS] 本地服務已啟動: http://localhost:${PORT}`);
  console.log(`[POS] 資料庫: ${DB_PATH}`);
});

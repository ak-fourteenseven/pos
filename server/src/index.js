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
/** 外賣桌區 → 固定支付方式（結賬時覆寫） */
function paymentForTableArea(area) {
  const a = String(area || '').toLowerCase();
  if (a.includes('keepta') || a.includes('keeta')) return 'keepta';
  if (a.includes('foodpanda')) return 'foodpanda';
  return null;
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
  const order = db.prepare('SELECT o.*, t.table_number FROM orders o LEFT JOIN tables t ON t.id = o.table_id WHERE o.id = ?').get(id);
  if (!order) return null;
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(id);
  return order;
}
/** 本地時間 'YYYY-MM-DD HH:MM:SS'（與 SQLite datetime('now','localtime') 同格式） */
function nowStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
/** 組出廚房單（後廚 + 水吧分區）；appended=true 表示為加菜後的追加單 */
function buildKitchenTicket(order, items) {
  const food = [];
  const bar = [];
  const drinkLine = (it, d) => {
    const t = d.temperature === 'HOT' ? '熱' : '凍';
    const prefs = d.preferences && d.preferences.length ? `, ${d.preferences.join(', ')}` : '';
    bar.push(`${it.quantity}x ${d.name} (${t}${prefs})`);
  };
  for (const it of items) {
    let o = null;
    try {
      o = it.options ? (typeof it.options === 'string' ? JSON.parse(it.options) : it.options) : null;
    } catch { o = null; }
    if (o && o.drink && Number(o.drink.product_id) === Number(it.product_id) && !o.base) {
      drinkLine(it, o.drink); // 獨立飲品
    } else if (o && o.base) {
      food.push(`${it.quantity}x ${o.base}`);
      if (o.noodle) food.push(`     麵: ${o.noodle.name}`);
      if (o.spiciness) food.push(`     辣度: ${o.spiciness.name}`);
      if (o.filling) food.push(`     餡料: ${o.filling.name}`);
      if (o.flavor) food.push(`     口味: ${o.flavor.name}`);
      if (o.toppings && o.toppings.length) food.push(`     加料: ${o.toppings.map((x) => x.name).join(', ')}`);
      if (o.drink) drinkLine(it, o.drink); // 套餐內飲品同步給水吧
    } else {
      food.push(`${it.quantity}x ${it.product_name}${it.spec ? ` [${it.spec}]` : ''}${it.remark ? ` (${it.remark})` : ''}`);
    }
  }
  return {
    order_no: order.order_no,
    table_number: order.table_number || null,
    appended: !!order.ordered_at,
    created_at: nowStr(),
    food,
    bar,
  };
}
function freeTable(db, tableId, status = 'available') {
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
    SELECT t.*, o.id AS order_id, o.order_no, o.total_amount, o.guest_count, o.created_at AS opened_at,
      (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
    FROM tables t
    LEFT JOIN orders o ON o.id = t.current_order_id AND o.status IN ('open', 'ordered')
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
  if (!['available', 'occupied', 'reserved', 'cleaning', 'preparing'].includes(status)) return fail(res, '狀態不合法');
  if (status === 'occupied') return fail(res, '請透過開台佔用桌台');
  if (status === 'preparing') return fail(res, '桌台狀態由下單送廚自動切換');
  db.prepare('UPDATE tables SET status = ?, current_order_id = NULL WHERE id = ?').run(status, t.id);
  ok(res, { updated: true });
});
/** 開台：建立進行中的訂單（暫不發放 order_no，下單送廚時才發） */
app.post('/api/tables/:id/open', (req, res) => {
  const db = getDb();
  const t = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
  if (!t) return fail(res, '桌台不存在', 404);
  if (t.status === 'occupied' || t.status === 'preparing') return fail(res, '桌台已在用餐中');
  const guests = Math.max(0, Number(t.capacity) || 0);
  const r = db.prepare(`INSERT INTO orders (table_id, status, cashier_id, guest_count)
    VALUES (?, 'open', ?, ?)`).run(t.id, req.user.id, guests);
  const orderId = Number(r.lastInsertRowid);
  db.prepare("UPDATE tables SET status = 'occupied', current_order_id = ? WHERE id = ?").run(orderId, t.id);
  ok(res, orderWithItems(db, orderId));
});
/** 分單：把選中的明細拆到新訂單（可選指定目標桌台） */
app.post('/api/orders/:id/split', (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return fail(res, '訂單不存在', 404);
  if (order.status !== 'open' && order.status !== 'ordered') return fail(res, '訂單狀態不可分單');
  const { item_ids, table_id } = req.body || {};
  if (!item_ids || !Array.isArray(item_ids) || !item_ids.length) return fail(res, '請選擇要分出的菜品');
  const selectedIds = item_ids.map(Number);
  const allItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  const toMove = allItems.filter((it) => selectedIds.includes(it.id));
  if (toMove.length !== selectedIds.length) return fail(res, '部分菜品不存在於此訂單');
  if (toMove.length === allItems.length) return fail(res, '不可分出全部菜品，請至少保留一項');
  // 目標桌台校驗
  if (table_id) {
    const t = db.prepare('SELECT * FROM tables WHERE id = ?').get(table_id);
    if (!t) return fail(res, '目標桌台不存在', 404);
    if (t.status === 'occupied' || t.status === 'preparing') return fail(res, '目標桌台已在用餐中');
    if (order.table_id && Number(table_id) === order.table_id) return fail(res, '目標桌台不能是當前桌台');
  }
  /* 來源單尚未發號時，分出單也暫不發號；已發號則立即發新號 */
  const newOrderNo = order.order_no ? genOrderNo(db) : null;
  const r = db.prepare(`INSERT INTO orders (order_no, table_id, status, remark, cashier_id)
    VALUES (?, ?, 'open', '分單', ?)`).run(newOrderNo, table_id || null, req.user.id);
  const newOrderId = Number(r.lastInsertRowid);
  db.exec('BEGIN');
  try {
    for (const it of toMove) {
      db.prepare('UPDATE order_items SET order_id = ? WHERE id = ?').run(newOrderId, it.id);
    }
    recomputeOrderTotal(db, order.id);
    recomputeOrderTotal(db, newOrderId);
    if (table_id) {
      db.prepare("UPDATE tables SET status = 'occupied', current_order_id = ? WHERE id = ?").run(newOrderId, table_id);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return fail(res, '分單失敗：' + e.message);
  }
  ok(res, {
    original: orderWithItems(db, order.id),
    new_order: orderWithItems(db, newOrderId),
  });
});
/** 併桌：把 from 的訂單（含明細）併入 to */
app.post('/api/tables/merge', (req, res) => {
  const { from_id, to_id } = req.body || {};
  if (!from_id || !to_id || Number(from_id) === Number(to_id)) return fail(res, '參數不正確');
  const db = getDb();
  const from = db.prepare('SELECT * FROM tables WHERE id = ?').get(from_id);
  const to = db.prepare('SELECT * FROM tables WHERE id = ?').get(to_id);
  if (!from || !to) return fail(res, '桌台不存在', 404);
  const fromOrder = db.prepare("SELECT * FROM orders WHERE table_id = ? AND status IN ('open','ordered')").get(from.id);
  if (!fromOrder) return fail(res, '來源桌台沒有進行中的訂單');
  const toOrder = db.prepare("SELECT * FROM orders WHERE table_id = ? AND status IN ('open','ordered')").get(to.id);
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
  const { status, date, business_date, table_id, limit = 200 } = req.query;
  let sql = `SELECT o.*, t.table_number, s.name AS cashier_name,
      (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
    FROM orders o
    LEFT JOIN tables t ON t.id = o.table_id
    LEFT JOIN staff s ON s.id = o.cashier_id
    WHERE 1 = 1`;
  const args = [];
  if (status) { sql += ' AND o.status = ?'; args.push(status); }
  if (business_date) { sql += ' AND o.business_date = ?'; args.push(business_date); }
  else if (date) { sql += ' AND date(o.created_at) = ?'; args.push(date); }
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
  /* 單號於首次下單送廚時發放；此處僅建草稿訂單 */
  const r = db.prepare(`INSERT INTO orders (table_id, status, remark, cashier_id)
    VALUES (?, ?, ?, ?)`).run(table_id ?? null, status, remark ?? null, req.user.id);
  const orderId = Number(r.lastInsertRowid);
  for (const it of items) {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id);
    if (!p) continue;
    const calc = computeComboUnitPrice(db, p, it);
    const itemType = p.kind === 'combo' ? 'combo' : calc.options ? 'combo' : 'simple';
    /* 若前端帶入 price（改價），覆寫後端覆核價 */
    const unit = it.price != null && it.price !== ''
      ? Math.max(0, Number(it.price) || 0)
      : calc.unit;
    db.prepare(`INSERT INTO order_items
      (order_id, product_id, product_name, price, quantity, spec, remark, item_type, options)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(orderId, p.id, p.name, unit,
      Number(it.quantity || 1), it.spec ?? null, it.remark ?? null, itemType,
      calc.options ? JSON.stringify(calc.options) : null);
  }
  recomputeOrderTotal(db, orderId);
  if (table_id && status === 'open') {
    db.prepare("UPDATE tables SET status = 'occupied', current_order_id = ? WHERE id = ?").run(orderId, table_id);
  }
  ok(res, orderWithItems(db, orderId));
});
/** 加菜（支援套餐選項；價格由後端覆核計算）。送廚後仍可加菜，加菜內容需再次下單送廚 */
app.post('/api/orders/:id/items', (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order || (order.status !== 'open' && order.status !== 'ordered')) return fail(res, '訂單狀態不可加菜');
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
  if (!order || (order.status !== 'open' && order.status !== 'ordered')) return fail(res, '訂單狀態不可修改');
  const it = db.prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?').get(req.params.itemId, order.id);
  if (!it) return fail(res, '訂單明細不存在', 404);
  const { quantity, remark, price } = req.body || {};
  /* 已送廚不可改數量；改價（單價）仍允許 */
  if (quantity != null && Number(quantity) !== Number(it.quantity) && it.sent_at) {
    return fail(res, '已送廚的菜品不可改數量，請退菜後重新點');
  }
  const nextQty = quantity != null ? Number(quantity) : Number(it.quantity);
  const nextRemark = remark !== undefined ? (remark ?? null) : it.remark;
  const nextPrice = price != null ? Math.max(0, Number(price) || 0) : Number(it.price);
  db.prepare('UPDATE order_items SET quantity = ?, remark = ?, price = ? WHERE id = ? AND order_id = ?')
    .run(nextQty, nextRemark, nextPrice, req.params.itemId, order.id);
  recomputeOrderTotal(db, order.id);
  ok(res, { updated: true, price: nextPrice, quantity: nextQty });
});
/** 退菜：已送廚的明細需店長權限（避免廚房已動工） */
app.delete('/api/orders/:id/items/:itemId', (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order || (order.status !== 'open' && order.status !== 'ordered')) return fail(res, '訂單狀態不可退菜');
  const it = db.prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?').get(req.params.itemId, order.id);
  if (!it) return fail(res, '訂單明細不存在', 404);
  if (it.sent_at && req.user.role !== 'manager') return fail(res, '已送廚的菜品需店長權限才能退菜', 403);
  db.prepare('DELETE FROM order_items WHERE id = ? AND order_id = ?').run(req.params.itemId, order.id);
  recomputeOrderTotal(db, order.id);
  ok(res, { deleted: true });
});
/** 下單（送廚房）：首次送廚時發放 order_no；標記未送廚明細、訂單進入「已送廚」，並回傳廚房單 */
app.post('/api/orders/:id/submit', (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT o.*, t.table_number FROM orders o LEFT JOIN tables t ON t.id = o.table_id WHERE o.id = ?').get(req.params.id);
  if (!order) return fail(res, '訂單不存在', 404);
  if (order.status !== 'open' && order.status !== 'ordered') return fail(res, '訂單狀態不可下單');
  const pending = db.prepare('SELECT * FROM order_items WHERE order_id = ? AND sent_at IS NULL').all(order.id);
  if (!pending.length) return fail(res, '沒有待送廚的新增菜品');
  const now = nowStr();
  const mark = db.prepare('UPDATE order_items SET sent_at = ? WHERE id = ? AND sent_at IS NULL');
  db.exec('BEGIN');
  try {
    if (!order.order_no) {
      const orderNo = genOrderNo(db);
      db.prepare('UPDATE orders SET order_no = ? WHERE id = ?').run(orderNo, order.id);
      order.order_no = orderNo;
    }
    for (const it of pending) mark.run(now, it.id);
    db.prepare(`UPDATE orders SET status = 'ordered', ordered_at = COALESCE(ordered_at, ?),
      submit_count = COALESCE(submit_count, 0) + 1 WHERE id = ?`).run(now, order.id);
    if (order.table_id) {
      db.prepare("UPDATE tables SET status = 'preparing', current_order_id = ? WHERE id = ?")
        .run(order.id, order.table_id);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return fail(res, '送廚失敗：' + e.message);
  }
  ok(res, {
    appended: !!order.ordered_at,
    sent_count: pending.length,
    order_no: order.order_no,
    ticket: buildKitchenTicket(order, pending),
  });
});
/** 廚房單（補印/重印）：取該訂單已送廚的全部明細 */
app.get('/api/orders/:id/ticket', (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT o.*, t.table_number FROM orders o LEFT JOIN tables t ON t.id = o.table_id WHERE o.id = ?').get(req.params.id);
  if (!order) return fail(res, '訂單不存在', 404);
  const sent = db.prepare('SELECT * FROM order_items WHERE order_id = ? AND sent_at IS NOT NULL ORDER BY id').all(order.id);
  if (!sent.length) return fail(res, '該訂單尚未下單送廚');
  ok(res, buildKitchenTicket(order, sent));
});
/** 換桌 / 備註 / 人數 */
app.patch('/api/orders/:id', (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return fail(res, '訂單不存在', 404);
  if (order.status !== 'open' && order.status !== 'ordered') return fail(res, '僅進行中的訂單可修改');
  const { table_id, remark, guest_count } = req.body || {};
  if (table_id != null && Number(table_id) !== order.table_id) {
    const t = db.prepare('SELECT * FROM tables WHERE id = ?').get(table_id);
    if (!t) return fail(res, '目標桌台不存在', 404);
    if (t.status === 'occupied') return fail(res, '目標桌台用餐中，請先併桌或選其他桌台');
    if (order.table_id) freeTable(db, order.table_id, 'available');
    db.prepare('UPDATE orders SET table_id = ? WHERE id = ?').run(t.id, order.id);
    db.prepare("UPDATE tables SET status = 'occupied', current_order_id = ? WHERE id = ?").run(order.id, t.id);
  }
  if (remark !== undefined) db.prepare('UPDATE orders SET remark = ? WHERE id = ?').run(remark, order.id);
  if (guest_count !== undefined) {
    const n = Math.max(0, Math.min(999, Math.floor(Number(guest_count) || 0)));
    db.prepare('UPDATE orders SET guest_count = ? WHERE id = ?').run(n, order.id);
  }
  ok(res, orderWithItems(db, order.id));
});
/** 結帳 */
app.post('/api/orders/:id/pay', (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return fail(res, '訂單不存在', 404);
  if (order.status === 'completed') return fail(res, '訂單已結帳');
  if (order.status === 'voided') return fail(res, '訂單已作廢');
  let { payment_method, discount_amount = 0, received_amount = 0 } = req.body || {};
  if (order.table_id) {
    const t = db.prepare('SELECT area FROM tables WHERE id = ?').get(order.table_id);
    const platformPay = paymentForTableArea(t?.area);
    if (platformPay) payment_method = platformPay;
  }
  if (!payment_method) return fail(res, '請選擇支付方式');
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  if (!items.length) return fail(res, '訂單無明細，無法結帳');
  const sentCount = items.filter((it) => it.sent_at).length;
  if (!sentCount) return fail(res, '請先下單送廚房，顧客用餐後再結賬');
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
  const day = db.prepare(`SELECT * FROM business_days WHERE cashier_id = ? AND status = 'open'
    ORDER BY id DESC LIMIT 1`).get(req.user.id);
  if (!day) return fail(res, '尚未開市，請先開啟營業日');
  db.prepare(`UPDATE orders SET status = 'completed', total_amount = ?, discount_amount = ?, service_fee = ?,
    pay_amount = ?, received_amount = ?, change_amount = ?, payment_method = ?,
    business_day_id = ?, business_date = ?, cashier_id = COALESCE(cashier_id, ?) WHERE id = ?`)
    .run(subtotal, discount, serviceFee, total, received, change, payment_method,
      day.id, day.business_date, req.user.id, order.id);
  if (order.table_id) freeTable(db, order.table_id, 'available');
  ok(res, orderWithItems(db, order.id));
});
/**
 * 作廢／清台（店長）
 * - 尚未發放單號（未正式下單）：刪除草稿訂單並將桌台恢復空閒
 * - 已發放單號：標記作廢，桌台恢復空閒
 */
app.post('/api/orders/:id/void', managerOnly, (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return fail(res, '訂單不存在', 404);
  if (order.status === 'voided') return fail(res, '訂單已作廢');
  if (order.status === 'completed') return fail(res, '已結帳訂單不可作廢');
  if (!order.order_no) {
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM order_items WHERE order_id = ?').run(order.id);
      db.prepare('DELETE FROM orders WHERE id = ?').run(order.id);
      if (order.table_id) freeTable(db, order.table_id, 'available');
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      return fail(res, '清台失敗：' + e.message);
    }
    return ok(res, { abandoned: true, cleared: true });
  }
  db.prepare("UPDATE orders SET status = 'voided' WHERE id = ?").run(order.id);
  if (order.table_id) freeTable(db, order.table_id, 'available');
  ok(res, { updated: true, abandoned: false });
});
/** 退款（店長）：對已結帳訂單進行退款 */
app.post('/api/orders/:id/refund', managerOnly, (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return fail(res, '訂單不存在', 404);
  if (order.status !== 'completed') return fail(res, '僅已結帳訂單可退款');
  const { reason } = req.body || {};
  db.prepare(`UPDATE orders SET status = 'refunded', refunded_at = ?, refund_reason = ?, refunded_by = ?
    WHERE id = ?`).run(nowStr(), reason || null, req.user.id, order.id);
  ok(res, { updated: true, refunded_amount: order.pay_amount });
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

/* ================= 營業日（開市 / 日結） ================= */
function todayYmd() {
  return new Date().toLocaleDateString('sv-SE');
}
function businessDaySummary(db, day) {
  const stats = db.prepare(`SELECT
      COALESCE(SUM(pay_amount), 0) AS total_sales,
      COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN pay_amount ELSE 0 END), 0) AS cash_amount,
      COUNT(*) AS order_count
    FROM orders WHERE business_day_id = ? AND status = 'completed'`).get(day.id);
  const byPayment = db.prepare(`SELECT payment_method, COUNT(*) AS order_count, SUM(pay_amount) AS amount
    FROM orders WHERE business_day_id = ? AND status = 'completed'
    GROUP BY payment_method ORDER BY amount DESC`).all(day.id);
  const opening = Number(day.opening_cash) || 0;
  const cashSales = Number(stats.cash_amount) || 0;
  return {
    ...day,
    total_sales: stats.total_sales,
    cash_amount: cashSales,
    order_count: stats.order_count,
    by_payment: byPayment,
    /** 錢箱應有現金 = 開市現金 + 現金收款 */
    expected_cash: opening + cashSales,
  };
}
app.get('/api/business-days', (req, res) => {
  const db = getDb();
  const limit = Math.min(200, Number(req.query.limit) || 60);
  ok(res, db.prepare(`SELECT b.*, st.name AS cashier_name FROM business_days b
    LEFT JOIN staff st ON st.id = b.cashier_id ORDER BY b.id DESC LIMIT ?`).all(limit));
});
app.get('/api/business-days/current', (req, res) => {
  const db = getDb();
  ok(res, db.prepare(`SELECT * FROM business_days WHERE cashier_id = ? AND status = 'open'
    ORDER BY id DESC LIMIT 1`).get(req.user.id) || null);
});
/** 該收銀員最近一筆營業日（含已日結） */
app.get('/api/business-days/latest', (req, res) => {
  const db = getDb();
  if (!req.user.id) return fail(res, '請先登入', 401);
  ok(res, db.prepare(`SELECT * FROM business_days WHERE cashier_id = ?
    ORDER BY id DESC LIMIT 1`).get(req.user.id) || null);
});
app.post('/api/business-days/open', (req, res) => {
  const db = getDb();
  if (!req.user.id) return fail(res, '請先登入', 401);
  const open = db.prepare(`SELECT * FROM business_days WHERE cashier_id = ? AND status = 'open'`).get(req.user.id);
  if (open) return fail(res, '已有進行中的營業日，請先日結');
  let { opening_cash = 0, business_date } = req.body || {};
  opening_cash = Math.max(0, Number(opening_cash) || 0);
  business_date = String(business_date || todayYmd()).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(business_date)) return fail(res, '營業日格式錯誤');
  const r = db.prepare(`INSERT INTO business_days
    (business_date, opening_cash, start_time, cashier_id, status)
    VALUES (?, ?, datetime('now','localtime'), ?, 'open')`)
    .run(business_date, opening_cash, req.user.id);
  ok(res, db.prepare('SELECT * FROM business_days WHERE id = ?').get(Number(r.lastInsertRowid)));
});
app.get('/api/business-days/:id/summary', (req, res) => {
  const db = getDb();
  const day = db.prepare('SELECT * FROM business_days WHERE id = ?').get(req.params.id);
  if (!day) return fail(res, '營業日不存在', 404);
  if (day.cashier_id !== req.user.id && req.user.role !== 'manager') {
    return fail(res, '無權查看此營業日', 403);
  }
  ok(res, businessDaySummary(db, day));
});
app.post('/api/business-days/:id/close', (req, res) => {
  const db = getDb();
  const day = db.prepare('SELECT * FROM business_days WHERE id = ?').get(req.params.id);
  if (!day) return fail(res, '營業日不存在', 404);
  if (day.cashier_id !== req.user.id && req.user.role !== 'manager') {
    return fail(res, '無權日結此營業日', 403);
  }
  if (day.status === 'closed') return fail(res, '該營業日已日結');
  const summary = businessDaySummary(db, day);
  const counted = Math.max(0, Number((req.body || {}).counted_cash));
  const countedCash = Number.isFinite(counted) ? counted : null;
  db.prepare(`UPDATE business_days SET end_time = datetime('now','localtime'), total_sales = ?,
    cash_amount = ?, order_count = ?, counted_cash = ?, status = 'closed' WHERE id = ?`)
    .run(summary.total_sales, summary.cash_amount, summary.order_count, countedCash, day.id);
  ok(res, {
    ...db.prepare('SELECT * FROM business_days WHERE id = ?').get(day.id),
    by_payment: summary.by_payment,
    expected_cash: summary.expected_cash,
  });
});
/** 撤銷日結：重新開啟已日結的營業日 */
app.post('/api/business-days/:id/reopen', (req, res) => {
  const db = getDb();
  if (!req.user.id) return fail(res, '請先登入', 401);
  const day = db.prepare('SELECT * FROM business_days WHERE id = ?').get(req.params.id);
  if (!day) return fail(res, '營業日不存在', 404);
  if (day.cashier_id !== req.user.id && req.user.role !== 'manager') {
    return fail(res, '無權撤銷此營業日日結', 403);
  }
  if (day.status !== 'closed') return fail(res, '該營業日未日結，無需撤銷');
  const otherOpen = db.prepare(`SELECT id FROM business_days WHERE cashier_id = ? AND status = 'open' AND id != ?`)
    .get(day.cashier_id, day.id);
  if (otherOpen) return fail(res, '已有進行中的營業日，請先日結後再撤銷');
  db.prepare(`UPDATE business_days SET status = 'open', end_time = NULL WHERE id = ?`).run(day.id);
  ok(res, db.prepare('SELECT * FROM business_days WHERE id = ?').get(day.id));
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
  const refundStats = db.prepare(`SELECT COUNT(*) AS cnt, COALESCE(SUM(pay_amount), 0) AS amount
    FROM orders WHERE status = 'refunded' AND date(created_at) = ?`).get(date);
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
    refund_count: refundStats.cnt,
    refund_amount: refundStats.amount,
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
  for (const t of ['products', 'orders', 'order_items', 'tables', 'staff', 'business_days']) {
    counts[t] = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
  }
  ok(res, {
    db_path: DB_PATH,
    size_bytes: fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0,
    counts,
  });
});

/* ================= 靜態託管 =================
 * 開發模式：npm run build 後提供 client/dist（單一 SPA：收銀台 + 後台）
 * 打包模式（Node SEA）：exe 同層的 public/client */
function resolveStaticDir(devRelative, packagedRelative) {
  const candidates = [path.join(__dirname, devRelative), path.join(__dirname, packagedRelative)];
  return candidates.find((p) => fs.existsSync(p)) || null;
}
const clientDist = resolveStaticDir('../../client/dist', 'public/client');
if (clientDist) {
  app.use(express.static(clientDist));
  /* SPA 路由回退（排除 API） */
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
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

/**
 * 本地 SQLite 資料庫（使用 Node 內建 node:sqlite，無需原生編譯）
 * - 資料庫檔案：server/data/pos.db
 * - 所有時間欄位使用本地時間（datetime('now','localtime')）
 */
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'pos.db');

let db = null;

function openDb() {
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

function getDb() {
  if (!db) openDb();
  return db;
}

/** 關閉並重開（用於還原備份） */
function reopenDb() {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
  }
  openDb();
}

/* ---------------- 密碼雜湊 ---------------- */
function hashPassword(pwd) {
  const salt = crypto.randomBytes(8).toString('hex');
  const hash = crypto.scryptSync(String(pwd), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(pwd, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const h = crypto.scryptSync(String(pwd), salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(hash, 'hex'));
}

/* ---------------- Schema ---------------- */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_deleted INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER,
  name TEXT NOT NULL,
  price REAL NOT NULL,
  barcode TEXT,
  image_path TEXT,
  emoji TEXT DEFAULT '🍽️',
  color TEXT DEFAULT '#f59e0b',
  specs TEXT,
  is_available INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT (datetime('now','localtime')),
  FOREIGN KEY(category_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_number TEXT NOT NULL,
  area TEXT DEFAULT '大廳',
  status TEXT DEFAULT 'available',
  capacity INTEGER DEFAULT 4,
  current_order_id INTEGER
);

CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'cashier',
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  is_enabled INTEGER DEFAULT 1,
  fee_rate REAL DEFAULT 0,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT UNIQUE NOT NULL,
  table_id INTEGER,
  total_amount REAL DEFAULT 0,
  discount_amount REAL DEFAULT 0,
  service_fee REAL DEFAULT 0,
  pay_amount REAL DEFAULT 0,
  received_amount REAL DEFAULT 0,
  change_amount REAL DEFAULT 0,
  payment_method TEXT,
  status TEXT DEFAULT 'open',
  remark TEXT,
  created_at DATETIME DEFAULT (datetime('now','localtime')),
  cashier_id INTEGER,
  shift_id INTEGER
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER,
  product_id INTEGER,
  product_name TEXT,
  price REAL,
  quantity INTEGER,
  spec TEXT,
  remark TEXT,
  FOREIGN KEY(order_id) REFERENCES orders(id)
);

CREATE TABLE IF NOT EXISTS shift_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_time DATETIME,
  end_time DATETIME,
  total_sales REAL DEFAULT 0,
  cash_amount REAL DEFAULT 0,
  order_count INTEGER DEFAULT 0,
  cashier_id INTEGER,
  status TEXT DEFAULT 'open'
);
`;

/* ---------------- 種子資料 ---------------- */
const DEFAULT_SETTINGS = {
  store_name: '時光餐飲館',
  store_address: '臺北市大安區復興南路一段 100 號',
  store_phone: '02-2345-6789',
  receipt_footer: '謝謝光臨，歡迎再來！',
  service_fee_rate: '0',
  currency: 'NT$',
  business_mode: 'table',
};

function seed() {
  const d = getDb();
  const staffCount = d.prepare('SELECT COUNT(*) AS c FROM staff').get().c;
  if (staffCount > 0) return;

  const insertSetting = d.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, v);

  const insertStaff = d.prepare('INSERT INTO staff (username, password, name, role) VALUES (?, ?, ?, ?)');
  insertStaff.run('admin', hashPassword('123456'), '王店長', 'manager');
  insertStaff.run('cashier', hashPassword('123456'), '李小收', 'cashier');
  insertStaff.run('cashier2', hashPassword('123456'), '陳小銀', 'cashier');

  const insertPay = d.prepare('INSERT INTO payment_methods (code, name, is_enabled, fee_rate, sort_order) VALUES (?, ?, ?, ?, ?)');
  insertPay.run('cash', '現金', 1, 0, 1);
  insertPay.run('mobile', '行動支付', 1, 0, 2);
  insertPay.run('card', '信用卡', 1, 0.025, 3);
  insertPay.run('credit', '記帳', 1, 0, 4);

  const insertCat = d.prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)');
  const cats = ['飲品', '咖啡', '快餐', '小食', '甜點'];
  cats.forEach((n, i) => insertCat.run(n, i + 1));

  const insertProduct = d.prepare(`INSERT INTO products
    (category_id, name, price, emoji, color, specs, is_available) VALUES (?, ?, ?, ?, ?, ?, 1)`);
  const P = (catId, name, price, emoji, color, specs = null) =>
    insertProduct.run(catId, name, price, emoji, color, specs ? JSON.stringify(specs) : null);

  // 飲品
  P(1, '珍珠奶茶', 55, '🧋', '#b45309', [{ name: '中杯', diff: -5 }, { name: '大杯', diff: 0 }]);
  P(1, '檸檬紅茶', 45, '🍋', '#65a30d');
  P(1, '百香綠茶', 50, '🥤', '#16a34a');
  P(1, '鮮榨西瓜汁', 60, '🍉', '#dc2626');
  // 咖啡
  P(2, '美式咖啡', 65, '☕', '#57534e', [{ name: '中杯', diff: -10 }, { name: '大杯', diff: 0 }]);
  P(2, '拿鐵', 80, '🍶', '#a16207');
  P(2, '卡布奇諾', 85, '☕', '#92400e');
  P(2, '焦糖瑪奇朵', 95, '🍮', '#d97706');
  // 快餐
  P(3, '排骨飯', 90, '🍱', '#ea580c');
  P(3, '雞腿飯', 100, '🍗', '#c2410c');
  P(3, '牛肉麵', 120, '🍜', '#b91c1c');
  P(3, '肉燥飯', 50, '🍚', '#a16207');
  // 小食
  P(4, '鹽酥雞', 60, '🍗', '#f59e0b', [{ name: '小份', diff: -15 }, { name: '大份', diff: 0 }]);
  P(4, '薯條', 45, '🍟', '#eab308');
  P(4, '洋蔥圈', 50, '🧅', '#ca8a04');
  // 甜點
  P(5, '提拉米蘇', 75, '🍰', '#7c2d12');
  P(5, '奶酪', 60, '🍮', '#fbbf24');
  P(5, '布朗尼', 65, '🍫', '#451a03');

  const insertTable = d.prepare('INSERT INTO tables (table_number, area, capacity) VALUES (?, ?, ?)');
  for (let i = 1; i <= 6; i++) insertTable.run(`A${i}`, '大廳', 4);
  for (let i = 1; i <= 4; i++) insertTable.run(`B${i}`, '包廂', i <= 2 ? 8 : 10);
  for (let i = 1; i <= 2; i++) insertTable.run(`C${i}`, '戶外陽台', 2);
}

function initDb() {
  openDb();
  db.exec(SCHEMA);
  seed();
}

initDb();

module.exports = { getDb, reopenDb, DB_PATH, DATA_DIR, hashPassword, verifyPassword };

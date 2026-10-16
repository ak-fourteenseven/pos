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

-- 套餐選項組（麵類/辣度/配料/餃子餡料/口味/飲品）
CREATE TABLE IF NOT EXISTS option_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  is_multi INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0
);

-- 選項組內的具體選項（含加價）
CREATE TABLE IF NOT EXISTS option_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER,
  name TEXT NOT NULL,
  price_diff REAL DEFAULT 0,
  is_default INTEGER DEFAULT 0,
  skip_spice INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0
);

-- 商品與選項組的關聯（套餐向導步驟）
CREATE TABLE IF NOT EXISTS product_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER,
  group_id INTEGER,
  step INTEGER DEFAULT 1,
  required INTEGER DEFAULT 1
);

-- 飲品時段計價規則
CREATE TABLE IF NOT EXISTS time_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  drink_all_free INTEGER DEFAULT 0,
  drink_cold_extra REAL DEFAULT 0,
  drink_hot_free INTEGER DEFAULT 0
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

/* ---------------- 遷移：為既有資料庫補欄位 ---------------- */
function migrate() {
  const d = getDb();
  const cols = (t) => d.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  const add = (table, col, ddl) => {
    if (!cols(table).includes(col)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  };
  add('products', 'kind', "kind TEXT DEFAULT 'simple'");
  add('products', 'is_drink', 'is_drink INTEGER DEFAULT 0');
  add('products', 'skip_group', 'skip_group TEXT');
  add('order_items', 'item_type', "item_type TEXT DEFAULT 'simple'");
  add('order_items', 'options', 'options TEXT');
}

/* ---------------- 種子：粉麵餐店菜單（套餐向導 + 飲品時段計價） ---------------- */
function seedNoodleMenu(d) {
  d.exec('BEGIN');
  try {
    seedNoodleMenuInner(d);
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

function seedNoodleMenuInner(d) {
  // 下架舊示範菜單（可於菜品管理重新上架）
  d.exec('UPDATE products SET is_available = 0');
  d.exec('UPDATE categories SET is_deleted = 1');

  const insCat = d.prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)');
  const catSoup = Number(insCat.run('湯底套餐', 1).lastInsertRowid);
  const catDumpling = Number(insCat.run('湯餃套餐', 2).lastInsertRowid);
  const catSnack = Number(insCat.run('精美小食', 3).lastInsertRowid);
  const catDrink = Number(insCat.run('飲品（跟餐）', 4).lastInsertRowid);

  // 選項組
  const insGroup = d.prepare('INSERT INTO option_groups (code, name, is_multi, sort_order) VALUES (?, ?, ?, ?)');
  const gNoodle = Number(insGroup.run('noodle', '麵類', 0, 1).lastInsertRowid);
  const gSpice = Number(insGroup.run('spiciness', '辣度', 0, 2).lastInsertRowid);
  const gTopping = Number(insGroup.run('topping', '配料（可多選）', 1, 3).lastInsertRowid);
  const gFilling = Number(insGroup.run('filling', '餃子餡料', 0, 4).lastInsertRowid);
  const gFlavorSpicy = Number(insGroup.run('flavor_spicy', '辣度口味', 0, 5).lastInsertRowid);
  const gFlavorStyle = Number(insGroup.run('flavor_style', '風味', 0, 6).lastInsertRowid);

  // 選項項
  const insItem = d.prepare('INSERT INTO option_items (group_id, name, price_diff, is_default, skip_spice, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
  const I = (gid, name, diff, def, skip, order) => insItem.run(gid, name, diff, def ? 1 : 0, skip ? 1 : 0, order);
  // 麵類：預設 $0，烏冬 +$2
  const noodles = [['上海麵', 0], ['幼薯粉', 0], ['芽菜底', 0], ['米粉', 0], ['意粉', 0], ['米線', 0], ['出前一丁', 0], ['烏冬', 2]];
  noodles.forEach(([n, p], i) => I(gNoodle, n, p, i === 0, 0, i + 1));
  // 辣度：唔辣 ~ 勁辣
  ['唔辣', '微辣', '少辣', '小辣', '中辣', '大辣', '特辣', '勁辣'].forEach((n, i) => I(gSpice, n, 0, i === 3, 0, i + 1));
  // 配料：階梯計價 $7/$8/$9/$11
  const toppings = [
    ['炸魚蛋', 7], ['魚腐', 7], ['豬皮', 7], ['芽菜', 7],
    ['墨魚丸', 8], ['蝦丸', 8], ['牛丸', 8], ['豬紅', 8],
    ['鮮魷', 9], ['牛柏葉', 9], ['豬耳', 9], ['雲腿', 9],
    ['肥牛', 11], ['鮮牛', 11], ['羊腩', 11], ['雞翼', 11],
  ];
  toppings.forEach(([n, p], i) => I(gTopping, n, p, 0, 0, i + 1));
  // 餃子餡料
  I(gFilling, '韭菜餃', 0, 1, 0, 1);
  I(gFilling, '粟米餃', 0, 0, 0, 2);
  // 小食口味
  ['小辣', '中辣', '大辣'].forEach((n, i) => I(gFlavorSpicy, n, 0, i === 1, 0, i + 1));
  ['滷水', '麻辣', '香辣'].forEach((n, i) => I(gFlavorStyle, n, 0, i === 0, 0, i + 1));

  // 商品
  const insCombo = d.prepare(`INSERT INTO products
    (category_id, name, price, emoji, color, kind, skip_group, is_available)
    VALUES (?, ?, ?, ?, ?, 'combo', ?, 1)`);
  const insSimple = d.prepare(`INSERT INTO products
    (category_id, name, price, emoji, color, kind, is_available)
    VALUES (?, ?, ?, ?, ?, 'simple', 1)`);
  const P = (cat, name, price, emoji, color, kind = 'simple', skipGroup = null) =>
    Number((kind === 'combo'
      ? insCombo.run(cat, name, price, emoji, color, skipGroup)
      : insSimple.run(cat, name, price, emoji, color)).lastInsertRowid);

  const insLink = d.prepare('INSERT INTO product_options (product_id, group_id, step, required) VALUES (?, ?, ?, ?)');
  const L = (pid, gid, step, req) => insLink.run(pid, gid, step, req ? 1 : 0);

  // 湯底套餐（$35）：步驟 2 麵類 → 3 辣度 → 4 配料 → 5 飲品
  const soups = [
    ['雲南酸辣', '🍲', '#dc2626', null],
    ['招牌酸麻辣', '🌶️', '#b91c1c', null],
    ['四川麻辣', '🔥', '#ea580c', null],
    ['香濃沙嗲', '🥜', '#a16207', null],
    ['清湯', '🍜', '#16a34a', 'spiciness'], // 清湯不適用辣度
    ['熱拌', '🥢', '#7c2d12', null],
  ];
  for (const [name, emoji, color, skip] of soups) {
    const pid = P(catSoup, name, 35, emoji, color, 'combo', skip);
    L(pid, gNoodle, 2, 1);
    L(pid, gSpice, 3, 1);
    L(pid, gTopping, 4, 0);
    L(pid, null, 5, 0); // 飲品步驟（group_id 由前端標記，見下）
  }

  // 湯餃套餐（$45）：步驟 2 餡料 → 3 飲品
  const dumplings = [['淨湯餃 10 隻', '🥟', '#ca8a04'], ['湯餃上海麵（6 隻）', '🍜', '#b45309']];
  for (const [name, emoji, color] of dumplings) {
    const pid = P(catDumpling, name, 45, emoji, color, 'combo', null);
    L(pid, gFilling, 2, 1);
    L(pid, null, 3, 0);
  }

  // 精美小食（部分需口味）
  const snacks = [
    ['麻辣牛柏葉', 35, '🥩', '#b91c1c', gFlavorSpicy],
    ['爽脆豬耳', 35, '🐷', '#db2777', gFlavorStyle],
    ['鹽酥雞', 28, '🍗', '#f59e0b', null],
    ['鮮蝦春卷', 16, '🌯', '#ca8a04', null],
    ['蝦多士', 24, '🍞', '#d97706', null],
    ['燒賣', 20, '🥟', '#a16207', null],
    ['蘿蔔糕', 18, '🍘', '#65a30d', null],
    ['薯條', 18, '🍟', '#eab308', null],
  ];
  for (const [name, price, emoji, color, flavor] of snacks) {
    const pid = P(catSnack, name, price, emoji, color);
    if (flavor) L(pid, flavor, 1, 1);
  }

  // 飲品（跟餐價 $7-$10，時段動態計價）
  const drinks = [
    ['奶茶', 7, '🧋', '#b45309'], ['檸檬茶', 7, '🍋', '#65a30d'], ['凍鴛鴦', 9, '☕', '#57534e'],
    ['咖啡', 8, '☕', '#92400e'], ['汽水', 7, '🥤', '#0ea5e9'], ['豆漿', 8, '🥛', '#fbbf24'],
    ['酸梅湯', 8, '🍶', '#7c2d12'], ['鮮榨果汁', 10, '🧃', '#f97316'],
  ];
  const insDrink = d.prepare(`INSERT INTO products
    (category_id, name, price, emoji, color, kind, is_drink, is_available)
    VALUES (?, ?, ?, ?, ?, 'simple', 1, 1)`);
  for (const [name, price, emoji, color] of drinks) insDrink.run(catDrink, name, price, emoji, color);

  // 時段規則
  const insSlot = d.prepare(`INSERT INTO time_slots (code, name, start_time, end_time, drink_all_free, drink_cold_extra, drink_hot_free)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  insSlot.run('lunch', '午市', '11:00', '15:00', 0, 3, 1);
  insSlot.run('teatime', '下午茶', '15:00', '18:00', 1, 0, 0);
  insSlot.run('dinner', '晚市', '18:00', '23:00', 0, 3, 1);

  d.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('menu_v2_seeded', '1');
}

function initDb() {
  openDb();
  db.exec(SCHEMA);
  migrate();
  seed();
  const d = getDb();
  const seeded = d.prepare("SELECT value FROM settings WHERE key = 'menu_v2_seeded'").get();
  if (!seeded) seedNoodleMenu(d);
}

initDb();

module.exports = { getDb, reopenDb, DB_PATH, DATA_DIR, hashPassword, verifyPassword };

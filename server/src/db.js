/**
 * 本地 SQLite 資料庫（使用 Node 內建 node:sqlite，無需原生編譯）
 * - 資料庫檔案：server/data/pos.db
 * - 所有時間欄位使用本地時間（datetime('now','localtime')）
 * - POS_SEED=1|true|yes|on → 每次啟動覆寫預設 settings；不清空營業日／訂單；空庫時仍補種主檔
 * - POS_SEED=0|false|no|off → 不寫入種子（含空庫）
 * - 未設定 → 僅首次（無員工時）寫入種子
 */
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const OFFICIAL_MENU = require('./official-menu');

/* 資料目錄：
 * - 開發模式：server/data
 * - 打包模式（Node SEA 單一執行檔）：exe 同層的 data 資料夾，方便整包搬遷與備份
 * - 可用環境變數 POS_DATA_DIR 覆蓋 */
let isSea = false;
try { isSea = require('node:sea').isSea(); } catch { /* 舊版 Node 無此模組，忽略 */ }
const DATA_DIR = process.env.POS_DATA_DIR
  || (isSea ? path.join(path.dirname(process.execPath), 'data') : path.join(__dirname, '..', 'data'));
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
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const computed = crypto.scryptSync(String(pwd), salt, 32).toString('hex');
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/* ---------------- Schema ---------------- */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_deleted INTEGER DEFAULT 0,
  include_drink_step INTEGER DEFAULT 0
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
  order_no TEXT UNIQUE,
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
  business_day_id INTEGER,
  business_date TEXT,
  ordered_at DATETIME,
  submit_count INTEGER DEFAULT 0,
  guest_count INTEGER DEFAULT 0
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
  sent_at DATETIME,
  FOREIGN KEY(order_id) REFERENCES orders(id)
);

CREATE TABLE IF NOT EXISTS business_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_date TEXT NOT NULL,
  opening_cash REAL NOT NULL DEFAULT 0,
  counted_cash REAL,
  start_time DATETIME,
  end_time DATETIME,
  total_sales REAL DEFAULT 0,
  cash_amount REAL DEFAULT 0,
  order_count INTEGER DEFAULT 0,
  cashier_id INTEGER NOT NULL,
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

-- 分類預設規格（可選多選標籤，含加價；飲品 UI 顯示為「口味」）
CREATE TABLE IF NOT EXISTS category_specs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  price_diff REAL DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY(category_id) REFERENCES categories(id)
);

-- 菜品自訂規格（use_custom_specs=1 時覆寫分類預設）
CREATE TABLE IF NOT EXISTS product_specs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  price_diff REAL DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY(product_id) REFERENCES products(id)
);

-- 分類選項組（麵類／辣度／配料／餡料等；套餐向導步驟）
CREATE TABLE IF NOT EXISTS category_option_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_multi INTEGER DEFAULT 0,
  required INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY(category_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS category_option_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  price_diff REAL DEFAULT 0,
  is_default INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY(group_id) REFERENCES category_option_groups(id)
);

-- 菜品自訂選項組（use_custom_options=1 時覆寫分類預設）
CREATE TABLE IF NOT EXISTS product_option_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_multi INTEGER DEFAULT 0,
  required INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY(product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS product_option_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  price_diff REAL DEFAULT 0,
  is_default INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY(group_id) REFERENCES product_option_groups(id)
);
`;

/* ---------------- 種子資料 ---------------- */
const DEFAULT_SETTINGS = {
  store_name: '新貴香園',
  store_address: '荃灣享和街53號郿城大樓地下E號舖',
  store_phone: '23602231',
  receipt_footer: '謝謝光臨，歡迎再來！',
  service_fee_rate: '0',
  currency: 'HKD$',
  business_mode: 'table',
};

/** @returns {'force'|'off'|'once'} */
function getSeedMode() {
  const raw = process.env.POS_SEED;
  if (raw === undefined || String(raw).trim() === '') return 'once';
  const v = String(raw).trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return 'off';
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return 'force';
  return 'once';
}

/** 覆寫預設門店 settings（不清空其他表；自訂 key 如 menu_v2_seeded 會保留） */
function seedSettings(d = getDb()) {
  const insertSetting = d.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, v);
}

/** 空庫時寫入員工／支付／示範菜單主檔（不清空既有資料） */
function seed() {
  const d = getDb();
  const staffCount = d.prepare('SELECT COUNT(*) AS c FROM staff').get().c;
  if (staffCount > 0) return;

  seedSettings(d);

  const insertStaff = d.prepare('INSERT INTO staff (username, password, name, role) VALUES (?, ?, ?, ?)');
  insertStaff.run('admin', hashPassword('123456'), '王店長', 'manager');
  insertStaff.run('cashier', hashPassword('123456'), '李小收', 'cashier');
  insertStaff.run('cashier2', hashPassword('123456'), '陳小銀', 'cashier');

  const insertPay = d.prepare('INSERT OR IGNORE INTO payment_methods (code, name, is_enabled, fee_rate, sort_order) VALUES (?, ?, ?, ?, ?)');
  insertPay.run('cash', '現金', 1, 0, 1);
  insertPay.run('alipay', '支付寶', 1, 0, 2);
  insertPay.run('octopus', '八達通', 1, 0, 3);
  insertPay.run('fps', '轉數快', 1, 0, 4);
  // 外賣平台：啟用供報表／結賬記錄，收銀台操作面板不顯示（前端過濾）
  insertPay.run('keepta', 'Keepta', 1, 0, 90);
  insertPay.run('foodpanda', 'foodpanda', 1, 0, 91);

  const insertCat = d.prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)');
  const cats = ['飲品', '咖啡', '快餐', '小食', '甜點'];
  cats.forEach((n, i) => insertCat.run(n, i + 1));

  const insertProduct = d.prepare(`INSERT INTO products
    (category_id, name, price, emoji, color, is_available) VALUES (?, ?, ?, ?, ?, 1)`);
  const P = (catId, name, price, emoji, color) =>
    insertProduct.run(catId, name, price, emoji, color);

  // 飲品
  P(1, '珍珠奶茶', 55, '🧋', '#b45309');
  P(1, '檸檬紅茶', 45, '🍋', '#65a30d');
  P(1, '百香綠茶', 50, '🥤', '#16a34a');
  P(1, '鮮榨西瓜汁', 60, '🍉', '#dc2626');
  // 咖啡
  P(2, '美式咖啡', 65, '☕', '#57534e');
  P(2, '拿鐵', 80, '🍶', '#a16207');
  P(2, '卡布奇諾', 85, '☕', '#92400e');
  P(2, '焦糖瑪奇朵', 95, '🍮', '#d97706');
  // 快餐
  P(3, '排骨飯', 90, '🍱', '#ea580c');
  P(3, '雞腿飯', 100, '🍗', '#c2410c');
  P(3, '牛肉麵', 120, '🍜', '#b91c1c');
  P(3, '肉燥飯', 50, '🍚', '#a16207');
  // 小食
  P(4, '鹽酥雞', 60, '🍗', '#f59e0b');
  P(4, '薯條', 45, '🍟', '#eab308');
  P(4, '洋蔥圈', 50, '🧅', '#ca8a04');
  // 甜點
  P(5, '提拉米蘇', 75, '🍰', '#7c2d12');
  P(5, '奶酪', 60, '🍮', '#fbbf24');
  P(5, '布朗尼', 65, '🍫', '#451a03');

  const insertTable = d.prepare('INSERT INTO tables (table_number, area, capacity) VALUES (?, ?, ?)');
  for (let i = 1; i <= 18; i++) insertTable.run(`A${i}`, '大廳', 4);
  for (let i = 1; i <= 10; i++) insertTable.run(`KP${i}`, 'keepta 外賣區', 4);
  for (let i = 1; i <= 10; i++) insertTable.run(`FP${i}`, 'foodpanda 外賣區', 4);
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
  add('products', 'use_custom_specs', 'use_custom_specs INTEGER DEFAULT 0');
  add('products', 'use_custom_options', 'use_custom_options INTEGER DEFAULT 0');
  add('categories', 'include_drink_step', 'include_drink_step INTEGER DEFAULT 0');
  // 移除舊版份量 JSON 欄位 products.specs（改由 category_specs / product_specs）
  if (cols('products').includes('specs')) {
    try {
      d.exec('ALTER TABLE products DROP COLUMN specs');
    } catch {
      d.prepare('UPDATE products SET specs = NULL').run();
    }
  }
  d.exec(`CREATE TABLE IF NOT EXISTS category_specs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    price_diff REAL DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY(category_id) REFERENCES categories(id)
  )`);
  d.exec(`CREATE TABLE IF NOT EXISTS product_specs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    price_diff REAL DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY(product_id) REFERENCES products(id)
  )`);
  d.exec(`CREATE TABLE IF NOT EXISTS category_option_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    is_multi INTEGER DEFAULT 0,
    required INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY(category_id) REFERENCES categories(id)
  )`);
  d.exec(`CREATE TABLE IF NOT EXISTS category_option_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    price_diff REAL DEFAULT 0,
    is_default INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY(group_id) REFERENCES category_option_groups(id)
  )`);
  d.exec(`CREATE TABLE IF NOT EXISTS product_option_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    is_multi INTEGER DEFAULT 0,
    required INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY(product_id) REFERENCES products(id)
  )`);
  d.exec(`CREATE TABLE IF NOT EXISTS product_option_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    price_diff REAL DEFAULT 0,
    is_default INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY(group_id) REFERENCES product_option_groups(id)
  )`);
  // 既有庫：飲品分類尚無規格時，補上預設口味標籤
  seedDrinkCategorySpecsIfEmpty(d);
  // 既有庫：湯底／湯餃分類尚無規格時，補上預設規格
  seedSoupCategorySpecsIfEmpty(d);
  // 既有庫：湯底／湯餃從全域 option_groups 遷移為分類選項組
  migrateCategoryOptionGroupsFromGlobal(d);
  // 既有庫：小食口味從 legacy product_options 遷到菜品自訂選項組
  migrateSnackFlavorToProductOptions(d);
  add('order_items', 'item_type', "item_type TEXT DEFAULT 'simple'");
  add('order_items', 'options', 'options TEXT');
  add('orders', 'refunded_at', 'refunded_at TEXT');
  add('orders', 'refund_reason', 'refund_reason TEXT');
  add('orders', 'refunded_by', 'refunded_by INTEGER');
  add('order_items', 'sent_at', 'sent_at DATETIME');
  add('orders', 'ordered_at', 'ordered_at DATETIME');
  add('orders', 'submit_count', 'submit_count INTEGER DEFAULT 0');
  add('orders', 'guest_count', 'guest_count INTEGER DEFAULT 0');
  add('orders', 'business_day_id', 'business_day_id INTEGER');
  add('orders', 'business_date', 'business_date TEXT');
  // 營業日表（取代交接班）；既有庫補建
  d.exec(`CREATE TABLE IF NOT EXISTS business_days (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_date TEXT NOT NULL,
    opening_cash REAL NOT NULL DEFAULT 0,
    counted_cash REAL,
    start_time DATETIME,
    end_time DATETIME,
    total_sales REAL DEFAULT 0,
    cash_amount REAL DEFAULT 0,
    order_count INTEGER DEFAULT 0,
    cashier_id INTEGER NOT NULL,
    status TEXT DEFAULT 'open'
  )`);
  add('business_days', 'counted_cash', 'counted_cash REAL');
  // 既有訂單補營業日 = 建立日
  d.prepare(`UPDATE orders SET business_date = date(created_at)
    WHERE business_date IS NULL AND created_at IS NOT NULL`).run();
  // 信用卡 → 轉數快（FPS）；並校正已存在的 fps 名稱／手續費
  const cardPm = d.prepare("SELECT id FROM payment_methods WHERE code = 'card'").get();
  if (cardPm) {
    const fpsExists = d.prepare("SELECT id FROM payment_methods WHERE code = 'fps'").get();
    if (fpsExists) {
      d.prepare('DELETE FROM payment_methods WHERE id = ?').run(cardPm.id);
    } else {
      d.prepare("UPDATE payment_methods SET code = 'fps', name = '轉數快', fee_rate = 0 WHERE id = ?").run(cardPm.id);
    }
  }
  d.prepare("UPDATE payment_methods SET name = '轉數快', fee_rate = 0 WHERE code = 'fps'").run();
  // 移除包廂桌位（B1–B18）
  d.prepare("DELETE FROM tables WHERE area = '包廂'").run();
  // 補上外賣平台支付方式（既有庫）
  const ensurePm = (code, name, sort) => {
    if (!d.prepare('SELECT id FROM payment_methods WHERE code = ?').get(code)) {
      d.prepare('INSERT INTO payment_methods (code, name, is_enabled, fee_rate, sort_order) VALUES (?, ?, 1, 0, ?)')
        .run(code, name, sort);
    }
  };
  ensurePm('keepta', 'Keepta', 90);
  ensurePm('foodpanda', 'foodpanda', 91);
  // 移除「記帳」支付方式
  d.prepare("DELETE FROM payment_methods WHERE code = 'credit'").run();
  // 單號改為下單送廚時才發放：既有庫放寬 order_no NOT NULL
  migrateOrderNoNullable(d);
  // 取消「待清」狀態：既有待清桌台改回空閒
  d.prepare("UPDATE tables SET status = 'available', current_order_id = NULL WHERE status = 'cleaning'").run();
}

/** SQLite 無法直接 DROP NOT NULL，需重建 orders 表（暫時關閉 FK） */
function migrateOrderNoNullable(d) {
  const info = d.prepare('PRAGMA table_info(orders)').all();
  const orderNoCol = info.find((c) => c.name === 'order_no');
  if (!orderNoCol || orderNoCol.notnull !== 1) return;

  const destCols = [
    'id', 'order_no', 'table_id', 'total_amount', 'discount_amount', 'service_fee',
    'pay_amount', 'received_amount', 'change_amount', 'payment_method', 'status',
    'remark', 'created_at', 'cashier_id', 'business_day_id', 'business_date',
    'ordered_at', 'submit_count', 'guest_count', 'refunded_at', 'refund_reason', 'refunded_by',
  ];
  const srcNames = new Set(info.map((c) => c.name));
  const copyCols = destCols.filter((c) => srcNames.has(c));

  d.exec('PRAGMA foreign_keys = OFF');
  try {
    d.exec('BEGIN');
    d.exec(`
      CREATE TABLE orders__new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_no TEXT UNIQUE,
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
        business_day_id INTEGER,
        business_date TEXT,
        ordered_at DATETIME,
        submit_count INTEGER DEFAULT 0,
        guest_count INTEGER DEFAULT 0,
        refunded_at TEXT,
        refund_reason TEXT,
        refunded_by INTEGER
      );
    `);
    d.exec(`INSERT INTO orders__new (${copyCols.join(',')}) SELECT ${copyCols.join(',')} FROM orders`);
    d.exec('DROP TABLE orders');
    d.exec('ALTER TABLE orders__new RENAME TO orders');
    d.exec('COMMIT');
  } catch (e) {
    try { d.exec('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  } finally {
    d.exec('PRAGMA foreign_keys = ON');
  }
}

/* ---------------- 種子：粉麵餐店菜單（套餐向導 + 飲品時段計價） ---------------- */
/**
 * 新貴香園正式菜單：清空既有測試菜單主檔並寫入正式資料。
 * 保留訂單／營業日／桌台／員工／支付方式；只重建分類、菜品、規格、選項組、時段。
 * 由 initDb() 以 settings flag 控制只執行一次（見 applyOfficialMenuOnce）。
 */
function applyOfficialMenu(d = getDb()) {
  d.exec('BEGIN');
  try {
    // 清空舊菜單主檔（不碰 order_items／orders）
    d.exec('DELETE FROM category_option_items');
    d.exec('DELETE FROM category_option_groups');
    d.exec('DELETE FROM product_option_items');
    d.exec('DELETE FROM product_option_groups');
    d.exec('DELETE FROM category_specs');
    d.exec('DELETE FROM product_specs');
    d.exec('DELETE FROM time_slots');
    d.exec('DELETE FROM products');
    d.exec('DELETE FROM categories');

    // 分類（由 SQLite 自動分配 id，避免與歷史 order_items.product_id 衝突）
    const insCat = d.prepare('INSERT INTO categories (name, sort_order, include_drink_step, is_deleted) VALUES (?, ?, ?, 0)');
    const catSoup = Number(insCat.run('湯底套餐', 1, 1).lastInsertRowid);
    const catDumpling = Number(insCat.run('湯餃套餐', 2, 1).lastInsertRowid);
    const catSnack = Number(insCat.run('精美小食', 3, 0).lastInsertRowid);
    const catDrink = Number(insCat.run('飲品（跟餐）', 4, 0).lastInsertRowid);

    const insCombo = d.prepare(`INSERT INTO products
      (category_id, name, price, emoji, color, kind, skip_group, is_available)
      VALUES (?, ?, ?, ?, ?, 'combo', ?, 1)`);
    const insSimple = d.prepare(`INSERT INTO products
      (category_id, name, price, emoji, color, kind, is_available)
      VALUES (?, ?, ?, ?, ?, 'simple', 1)`);
    const insDrinkStmt = d.prepare(`INSERT INTO products
      (category_id, name, price, emoji, color, kind, is_drink, is_available)
      VALUES (?, ?, ?, ?, ?, 'simple', 1, 1)`);
    const insId = (stmt, ...args) => Number(stmt.run(...args).lastInsertRowid);

    // 湯底
    seedCategoryOptionGroups(d, catSoup, OFFICIAL_MENU.SOUP_OPTION_GROUPS);
    seedCategorySpecs(d, catSoup, OFFICIAL_MENU.SOUP_SPECS);
    for (const [name, price, emoji, color, skip] of OFFICIAL_MENU.SOUP_PRODUCTS) {
      insId(insCombo, catSoup, name, price, emoji, color, skip);
    }

    // 湯餃
    seedCategoryOptionGroups(d, catDumpling, OFFICIAL_MENU.DUMPLING_OPTION_GROUPS);
    seedCategorySpecs(d, catDumpling, OFFICIAL_MENU.DUMPLING_SPECS);
    for (const [name, price, emoji, color] of OFFICIAL_MENU.DUMPLING_PRODUCTS) {
      insId(insCombo, catDumpling, name, price, emoji, color, null);
    }

    // 精美小食
    for (const [name, price, emoji, color, groupKey, specKey] of OFFICIAL_MENU.SNACK_PRODUCTS) {
      const id = insId(insSimple, catSnack, name, price, emoji, color);
      if (groupKey && OFFICIAL_MENU.SNACK_OPTION_GROUPS[groupKey]) {
        d.prepare('UPDATE products SET use_custom_options = 1 WHERE id = ?').run(id);
        seedProductOptionGroups(d, id, OFFICIAL_MENU.SNACK_OPTION_GROUPS[groupKey]);
      }
      if (specKey && OFFICIAL_MENU.SNACK_SPECS[specKey]) {
        d.prepare('UPDATE products SET use_custom_specs = 1 WHERE id = ?').run(id);
        seedProductSpecs(d, id, OFFICIAL_MENU.SNACK_SPECS[specKey]);
      }
    }

    // 飲品
    seedCategorySpecs(d, catDrink, OFFICIAL_MENU.DRINK_SPECS);
    for (const [name, price, emoji, color] of OFFICIAL_MENU.DRINK_PRODUCTS) {
      insId(insDrinkStmt, catDrink, name, price, emoji, color);
    }

    // 時段規則
    const insSlot = d.prepare(`INSERT INTO time_slots
      (code, name, start_time, end_time, drink_all_free, drink_cold_extra, drink_hot_free)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const s of OFFICIAL_MENU.TIME_SLOTS) insSlot.run(...s);

    // 標記已套用正式菜單
    d.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('menu_official_seeded', '1');
    d.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('menu_v2_seeded', '1');
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

/** 以 settings flag 控制正式菜單只套用一次；POS_SEED=force 時可指定 FORCE_MENU=1 強制重灌 */
function applyOfficialMenuOnce(d = getDb()) {
  const flag = d.prepare("SELECT value FROM settings WHERE key = 'menu_official_seeded'").get();
  if (!flag || process.env.FORCE_MENU === '1') applyOfficialMenu(d);
}

function seedProductSpecs(d, productId, entries) {
  const ins = d.prepare('INSERT INTO product_specs (product_id, name, price_diff, sort_order) VALUES (?, ?, ?, ?)');
  entries.forEach((entry, i) => {
    const { name, price_diff } = normalizeSpecSeedEntry(entry);
    if (!name) return;
    ins.run(productId, name, price_diff, i + 1);
  });
}

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

  const insCat = d.prepare('INSERT INTO categories (name, sort_order, include_drink_step) VALUES (?, ?, ?)');
  const catSoup = Number(insCat.run('湯底套餐', 1, 1).lastInsertRowid);
  const catDumpling = Number(insCat.run('湯餃套餐', 2, 1).lastInsertRowid);
  const catSnack = Number(insCat.run('精美小食', 3, 0).lastInsertRowid);
  const catDrink = Number(insCat.run('飲品（跟餐）', 4, 0).lastInsertRowid);

  // 湯底／湯餃：分類選項組（套餐向導）
  seedCategoryOptionGroups(d, catSoup, DEFAULT_SOUP_OPTION_GROUPS);
  seedCategoryOptionGroups(d, catDumpling, DEFAULT_DUMPLING_OPTION_GROUPS);

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

  // 湯底套餐（$35）：步驟由分類選項組 + 飲品旗標決定
  const soups = [
    ['雲南酸辣', '🍲', '#dc2626', null],
    ['招牌酸麻辣', '🌶️', '#b91c1c', null],
    ['四川麻辣', '🔥', '#ea580c', null],
    ['香濃沙嗲', '🥜', '#a16207', null],
    ['清湯', '🍜', '#16a34a', 'spiciness'], // 清湯不適用辣度
    ['熱拌', '🥢', '#7c2d12', null],
  ];
  for (const [name, emoji, color, skip] of soups) {
    P(catSoup, name, 35, emoji, color, 'combo', skip);
  }

  // 湯餃套餐（$45）
  const dumplings = [['淨湯餃 10 隻', '🥟', '#ca8a04'], ['湯餃上海麵（6 隻）', '🍜', '#b45309']];
  for (const [name, emoji, color] of dumplings) {
    P(catDumpling, name, 45, emoji, color, 'combo', null);
  }

  // 精美小食：部分菜品用自訂選項組（選填）；分類本身無選項組
  const snacks = [
    ['麻辣牛柏葉', 35, '🥩', '#b91c1c', DEFAULT_SNACK_SPICY_GROUPS],
    ['爽脆豬耳', 35, '🐷', '#db2777', DEFAULT_SNACK_STYLE_GROUPS],
    ['鹽酥雞', 28, '🍗', '#f59e0b', null],
    ['鮮蝦春卷', 16, '🌯', '#ca8a04', null],
    ['蝦多士', 24, '🍞', '#d97706', null],
    ['燒賣', 20, '🥟', '#a16207', null],
    ['蘿蔔糕', 18, '🍘', '#65a30d', null],
    ['薯條', 18, '🍟', '#eab308', null],
  ];
  for (const [name, price, emoji, color, groups] of snacks) {
    const pid = P(catSnack, name, price, emoji, color);
    if (groups) {
      d.prepare('UPDATE products SET use_custom_options = 1 WHERE id = ?').run(pid);
      seedProductOptionGroups(d, pid, groups);
    }
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

  // 湯底／湯餃分類預設「規格」（POS 於辣度或第一食品步驟顯示）
  seedCategorySpecs(d, catSoup, DEFAULT_SOUP_SPECS);
  seedCategorySpecs(d, catDumpling, DEFAULT_DUMPLING_SPECS);

  // 飲品分類預設「口味」規格
  seedCategorySpecs(d, catDrink, DEFAULT_DRINK_SPECS);

  // 時段規則
  const insSlot = d.prepare(`INSERT INTO time_slots (code, name, start_time, end_time, drink_all_free, drink_cold_extra, drink_hot_free)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  insSlot.run('lunch', '午市', '11:00', '15:00', 0, 3, 1);
  insSlot.run('teatime', '下午茶', '15:00', '18:00', 1, 0, 0);
  insSlot.run('dinner', '晚市', '18:00', '23:00', 0, 3, 1);

  d.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('menu_v2_seeded', '1');
}

/** 規格條目：字串 = 名稱（加價 0），或 [name, price_diff] */
/** 湯底套餐預設規格（與現庫一致） */
const DEFAULT_SOUP_SPECS = ['走蔥', '走芫茜', '走蔥花', '走蒜', '走油', '打包', ['加麵', 15]];
/** 湯餃套餐預設規格（與現庫一致；無走油／加麵） */
const DEFAULT_DUMPLING_SPECS = ['走蔥', '走芫茜', '走蔥花', '走蒜', '打包'];
/** 預設飲品口味標籤（規格模組；POS 顯示為「口味」） */
const DEFAULT_DRINK_SPECS = ['走甜', '少甜', '多甜', '走冰', '少冰', '多冰', '加濃', '去冰', '打包'];

/** 湯底分類選項組（與現庫全域 option_groups 一致） */
const DEFAULT_SOUP_OPTION_GROUPS = [
  {
    code: 'noodle', name: '麵類', is_multi: 0, required: 1,
    items: [
      ['上海麵', 0, 1], ['幼薯粉', 0, 0], ['芽菜底', 0, 0], ['米粉', 0, 0],
      ['意粉', 0, 0], ['米線', 0, 0], ['出前一丁', 0, 0], ['烏冬', 2, 0],
    ],
  },
  {
    code: 'spiciness', name: '辣度', is_multi: 0, required: 1,
    items: [
      ['唔辣', 0, 0], ['微辣', 0, 0], ['少辣', 0, 0], ['小辣', 0, 1],
      ['中辣', 0, 0], ['大辣', 0, 0], ['特辣', 0, 0], ['勁辣', 0, 0],
    ],
  },
  {
    code: 'topping', name: '配料（可多選）', is_multi: 1, required: 0,
    items: [
      ['炸魚蛋', 7], ['魚腐', 7], ['豬皮', 7], ['芽菜', 7],
      ['墨魚丸', 8], ['蝦丸', 8], ['牛丸', 8], ['豬紅', 8],
      ['鮮魷', 9], ['牛柏葉', 9], ['豬耳', 9], ['雲腿', 9],
      ['肥牛', 11], ['鮮牛', 11], ['羊腩', 11], ['雞翼', 11],
    ],
  },
];
/** 湯餃分類選項組 */
const DEFAULT_DUMPLING_OPTION_GROUPS = [
  {
    code: 'filling', name: '餃子餡料', is_multi: 0, required: 1,
    items: [['韭菜餃', 0, 1], ['粟米餃', 0, 0]],
  },
];
/** 小食菜品自訂選項（選填） */
const DEFAULT_SNACK_SPICY_GROUPS = [
  {
    code: 'flavor_spicy', name: '辣度口味', is_multi: 0, required: 0,
    items: [['小辣', 0, 0], ['中辣', 0, 1], ['大辣', 0, 0]],
  },
];
const DEFAULT_SNACK_STYLE_GROUPS = [
  {
    code: 'flavor_style', name: '風味', is_multi: 0, required: 0,
    items: [['滷水', 0, 1], ['麻辣', 0, 0], ['香辣', 0, 0]],
  },
];

function normalizeSpecSeedEntry(entry) {
  if (Array.isArray(entry)) {
    return { name: String(entry[0]), price_diff: Number(entry[1]) || 0 };
  }
  if (entry && typeof entry === 'object') {
    return { name: String(entry.name || ''), price_diff: Number(entry.price_diff) || 0 };
  }
  return { name: String(entry), price_diff: 0 };
}

function seedCategorySpecs(d, categoryId, entries) {
  const ins = d.prepare(
    'INSERT INTO category_specs (category_id, name, price_diff, sort_order) VALUES (?, ?, ?, ?)',
  );
  entries.forEach((entry, i) => {
    const { name, price_diff } = normalizeSpecSeedEntry(entry);
    if (!name) return;
    ins.run(categoryId, name, price_diff, i + 1);
  });
}

function seedCategoryOptionGroups(d, categoryId, groups) {
  const insG = d.prepare(
    'INSERT INTO category_option_groups (category_id, code, name, is_multi, required, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const insI = d.prepare(
    'INSERT INTO category_option_items (group_id, name, price_diff, is_default, sort_order) VALUES (?, ?, ?, ?, ?)',
  );
  groups.forEach((g, gi) => {
    const gid = Number(insG.run(
      categoryId, g.code, g.name, g.is_multi ? 1 : 0, g.required ? 1 : 0, gi + 1,
    ).lastInsertRowid);
    (g.items || []).forEach((it, ii) => {
      const name = Array.isArray(it) ? it[0] : it.name;
      const price_diff = Array.isArray(it) ? (Number(it[1]) || 0) : (Number(it.price_diff) || 0);
      const is_default = Array.isArray(it) ? (it[2] ? 1 : 0) : (it.is_default ? 1 : 0);
      insI.run(gid, name, price_diff, is_default, ii + 1);
    });
  });
}

function seedProductOptionGroups(d, productId, groups) {
  const insG = d.prepare(
    'INSERT INTO product_option_groups (product_id, code, name, is_multi, required, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const insI = d.prepare(
    'INSERT INTO product_option_items (group_id, name, price_diff, is_default, sort_order) VALUES (?, ?, ?, ?, ?)',
  );
  groups.forEach((g, gi) => {
    const gid = Number(insG.run(
      productId, g.code, g.name, g.is_multi ? 1 : 0, g.required ? 1 : 0, gi + 1,
    ).lastInsertRowid);
    (g.items || []).forEach((it, ii) => {
      const name = Array.isArray(it) ? it[0] : it.name;
      const price_diff = Array.isArray(it) ? (Number(it[1]) || 0) : (Number(it.price_diff) || 0);
      const is_default = Array.isArray(it) ? (it[2] ? 1 : 0) : (it.is_default ? 1 : 0);
      insI.run(gid, name, price_diff, is_default, ii + 1);
    });
  });
}

/** 既有庫：小食口味改為菜品自訂選項組（選填），並移除 legacy product_options */
function migrateSnackFlavorToProductOptions(d) {
  const targets = [
    { name: '麻辣牛柏葉', groups: DEFAULT_SNACK_SPICY_GROUPS },
    { name: '爽脆豬耳', groups: DEFAULT_SNACK_STYLE_GROUPS },
  ];
  for (const t of targets) {
    const p = d.prepare(`
      SELECT p.id FROM products p
      JOIN categories c ON c.id = p.category_id
      WHERE p.name = ? AND c.is_deleted = 0 AND c.name LIKE '%小食%'
      ORDER BY p.id LIMIT 1
    `).get(t.name);
    if (!p) continue;
    const n = d.prepare('SELECT COUNT(*) AS n FROM product_option_groups WHERE product_id = ?').get(p.id);
    if (Number(n?.n) === 0) {
      d.prepare('UPDATE products SET use_custom_options = 1 WHERE id = ?').run(p.id);
      seedProductOptionGroups(d, p.id, t.groups);
    } else {
      d.prepare('UPDATE products SET use_custom_options = 1 WHERE id = ?').run(p.id);
    }
    d.prepare('DELETE FROM product_options WHERE product_id = ?').run(p.id);
  }
}

/** 既有庫：把全域 noodle/spiciness/topping/filling 複製到湯底／湯餃分類 */
function migrateCategoryOptionGroupsFromGlobal(d) {
  const soup = d.prepare(`
    SELECT id FROM categories WHERE is_deleted = 0 AND name LIKE '%湯底%' ORDER BY sort_order, id LIMIT 1
  `).get();
  const dumpling = d.prepare(`
    SELECT id FROM categories WHERE is_deleted = 0 AND name LIKE '%湯餃%' ORDER BY sort_order, id LIMIT 1
  `).get();

  const copyCodes = (categoryId, codes) => {
    if (!categoryId) return;
    const existing = d.prepare('SELECT COUNT(*) AS n FROM category_option_groups WHERE category_id = ?').get(categoryId);
    if (Number(existing?.n) > 0) return;
    const insG = d.prepare(
      'INSERT INTO category_option_groups (category_id, code, name, is_multi, required, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const insI = d.prepare(
      'INSERT INTO category_option_items (group_id, name, price_diff, is_default, sort_order) VALUES (?, ?, ?, ?, ?)',
    );
    let sort = 0;
    for (const code of codes) {
      const g = d.prepare('SELECT * FROM option_groups WHERE code = ?').get(code);
      if (!g) continue;
      sort += 1;
      const required = code === 'topping' ? 0 : 1;
      const gid = Number(insG.run(
        categoryId, g.code, g.name, Number(g.is_multi) || 0, required, sort,
      ).lastInsertRowid);
      const items = d.prepare(
        'SELECT * FROM option_items WHERE group_id = ? ORDER BY sort_order, id',
      ).all(g.id);
      items.forEach((it, i) => {
        insI.run(gid, it.name, Number(it.price_diff) || 0, Number(it.is_default) || 0, i + 1);
      });
    }
    d.prepare('UPDATE categories SET include_drink_step = 1 WHERE id = ?').run(categoryId);
  };

  if (soup) copyCodes(soup.id, ['noodle', 'spiciness', 'topping']);
  else {
    // 無湯底分類時不補種；有分類但全域缺組時用預設
  }
  if (dumpling) copyCodes(dumpling.id, ['filling']);

  // 若分類仍空（無全域組可複製），用預設種子
  if (soup) {
    const n = d.prepare('SELECT COUNT(*) AS n FROM category_option_groups WHERE category_id = ?').get(soup.id);
    if (Number(n?.n) === 0) {
      seedCategoryOptionGroups(d, soup.id, DEFAULT_SOUP_OPTION_GROUPS);
      d.prepare('UPDATE categories SET include_drink_step = 1 WHERE id = ?').run(soup.id);
    }
  }
  if (dumpling) {
    const n = d.prepare('SELECT COUNT(*) AS n FROM category_option_groups WHERE category_id = ?').get(dumpling.id);
    if (Number(n?.n) === 0) {
      seedCategoryOptionGroups(d, dumpling.id, DEFAULT_DUMPLING_OPTION_GROUPS);
      d.prepare('UPDATE categories SET include_drink_step = 1 WHERE id = ?').run(dumpling.id);
    }
  }
}

/** 既有庫：湯底／湯餃分類尚無規格時補種 */
function seedSoupCategorySpecsIfEmpty(d) {
  const cats = d.prepare(`
    SELECT c.id, c.name FROM categories c
    WHERE c.is_deleted = 0 AND (c.name LIKE '%湯底%' OR c.name LIKE '%湯餃%')
    ORDER BY c.sort_order, c.id
  `).all();
  for (const cat of cats) {
    const count = d.prepare('SELECT COUNT(*) AS n FROM category_specs WHERE category_id = ?').get(cat.id);
    if (Number(count?.n) > 0) continue;
    const list = String(cat.name).includes('湯餃') ? DEFAULT_DUMPLING_SPECS : DEFAULT_SOUP_SPECS;
    seedCategorySpecs(d, cat.id, list);
  }
}

/** 既有庫：找出飲品分類且尚無規格時補種 */
function seedDrinkCategorySpecsIfEmpty(d) {
  const drinkCat = d.prepare(`
    SELECT c.id FROM categories c
    WHERE c.is_deleted = 0 AND (
      c.name LIKE '%飲品%'
      OR EXISTS (SELECT 1 FROM products p WHERE p.category_id = c.id AND p.is_drink = 1)
    )
    ORDER BY c.sort_order, c.id LIMIT 1
  `).get();
  if (!drinkCat) return;
  const count = d.prepare('SELECT COUNT(*) AS n FROM category_specs WHERE category_id = ?').get(drinkCat.id);
  if (Number(count?.n) > 0) return;
  seedCategorySpecs(d, drinkCat.id, DEFAULT_DRINK_SPECS);
}

function initDb() {
  openDb();
  db.exec(SCHEMA);
  migrate();

  const mode = getSeedMode();
  const d = getDb();

  if (mode === 'off') {
    console.log('[POS] Seeding skipped (POS_SEED=0)');
    return;
  }

  if (mode === 'force') {
    console.log('[POS] POS_SEED enabled — upserting default settings (preserving business days / orders)');
    seedSettings(d);
  }

  // once／force：僅空庫補種主檔；尚未寫入 menu_v2 時補種粉麵菜單
  seed();
  const seeded = d.prepare("SELECT value FROM settings WHERE key = 'menu_v2_seeded'").get();
  if (!seeded) seedNoodleMenu(d);

  // 正式菜單：以 menu_official_seeded flag 控制只覆蓋一次
  // （POS_SEED=force 時可用 FORCE_MENU=1 強制重灌正式菜單）
  applyOfficialMenuOnce(d);
}

initDb();

module.exports = { getDb, reopenDb, DB_PATH, DATA_DIR, hashPassword, verifyPassword };

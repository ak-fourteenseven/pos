/** 格式化工具 */

/** 本地日期 YYYY-MM-DD */
export function today(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 本地月份 YYYY-MM */
export function thisMonth(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function fmtMoney(n, currency = 'NT$') {
  const num = Number(n || 0);
  const s = Number.isInteger(num) ? num.toLocaleString('zh-TW') : num.toLocaleString('zh-TW', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  return `${currency}${s}`;
}

export function fmtNum(n) {
  return Number(n || 0).toLocaleString('zh-TW');
}

export function fmtPct(n, digits = 1) {
  return `${Number(n || 0).toFixed(digits)}%`;
}

/** 'YYYY-MM-DD HH:MM:SS' → 'HH:MM' */
export function fmtTime(s) {
  if (!s) return '';
  return String(s).slice(11, 16);
}

/** 'YYYY-MM-DD HH:MM:SS' → 'MM-DD HH:MM' */
export function fmtDateTime(s) {
  if (!s) return '';
  return String(s).slice(5, 16);
}

/** hex 顏色轉 rgba（用於淺色背景） */
export function hexA(hex, alpha = 0.1) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return `rgba(245, 158, 11, ${alpha})`;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

export const TABLE_STATUS = {
  available: { label: '空閒', cls: 'bg-emerald-100 text-emerald-700 border-emerald-300', dot: 'bg-emerald-500' },
  occupied: { label: '點餐中', cls: 'bg-brand-100 text-brand-700 border-brand-300', dot: 'bg-brand-500' },
  preparing: { label: '製作中', cls: 'bg-amber-100 text-amber-700 border-amber-300', dot: 'bg-amber-500' },
  reserved: { label: '已預訂', cls: 'bg-violet-100 text-violet-700 border-violet-300', dot: 'bg-violet-500' },
};

export const PAYMENT_META = {
  cash: { label: '現金', icon: '💵' },
  alipay: { label: '支付寶', icon: '<span class="inline-flex items-center justify-center w-6 h-6 rounded-md text-white text-xs font-bold" style="background:#1677FF">支</span>' },
  octopus: { label: '八達通', icon: '/payment-icons/octopus.png?v=2', img: true },
  fps: { label: '轉數快', icon: '/payment-icons/fps.png?v=2', img: true },
  /** @deprecated 舊資料相容：信用卡已改為轉數快 */
  card: { label: '轉數快', icon: '/payment-icons/fps.png?v=2', img: true },
  /** @deprecated 已從種子／支付清單移除；保留供舊訂單顯示 */
  credit: { label: '記帳', icon: '📒' },
  keepta: { label: 'Keepta', icon: '🛵' },
  foodpanda: { label: 'foodpanda', icon: '🐼' },
};

/** 外賣平台支付（不顯示於收銀台操作面板，依桌區自動套用） */
export const PLATFORM_PAYMENT_CODES = ['keepta', 'foodpanda'];

export function isPlatformPayment(code) {
  return PLATFORM_PAYMENT_CODES.includes(String(code || ''));
}

/** 依桌台區域回傳預設支付代碼；非外賣區回傳 null */
export function paymentForTableArea(area) {
  const a = String(area || '').toLowerCase();
  if (a.includes('keepta') || a.includes('keeta')) return 'keepta';
  if (a.includes('foodpanda')) return 'foodpanda';
  return null;
}

export const ORDER_STATUS = {
  open: { label: '點餐中', cls: 'bg-brand-100 text-brand-700' },
  ordered: { label: '已送廚', cls: 'bg-amber-100 text-amber-700' },
  held: { label: '掛單', cls: 'bg-amber-100 text-amber-700' },
  completed: { label: '已結帳', cls: 'bg-emerald-100 text-emerald-700' },
  voided: { label: '已作廢', cls: 'bg-red-100 text-red-700' },
  refunded: { label: '已退款', cls: 'bg-orange-100 text-orange-700' },
};

export const QUICK_REMARKS = ['去冰', '少冰', '微冰', '常溫', '熱', '無糖', '微糖', '半糖', '少糖', '全糖',
  '加珍珠', '加椰果', '加布丁', '大份', '小份', '免辣', '小辣', '中辣', '大辣', '打包'];

export const EMOJI_LIST = ['🍽️', '🧋', '🍋', '🥤', '🍉', '☕', '🍶', '🍮', '🍱', '🍗', '🍜', '🍚',
  '🍟', '🧅', '🍰', '🍫', '🥗', '🍕', '🍔', '🌮', '🍦', '🥧', '🍢', '🍡'];

export const COLOR_LIST = ['#f59e0b', '#ea580c', '#dc2626', '#db2777', '#7c3aed', '#2563eb',
  '#0891b2', '#059669', '#65a30d', '#a16207', '#57534e', '#b45309'];

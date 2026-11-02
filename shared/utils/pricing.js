/** 飲品時段計價（與後端引擎規則一致） */

export function pad2(n) {
  return String(n).padStart(2, '0');
}

/** 根據當前時間找出所屬時段 */
export function currentSlot(slots, now = new Date()) {
  const hm = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  return (slots || []).find((s) => hm >= s.start_time && hm < s.end_time) || null;
}

/** 時段規則說明文字 */
export function slotRuleText(slot) {
  if (!slot) return '非營業時段 · 飲品按原價';
  if (Number(slot.drink_all_free) === 1) return `${slot.name} · 飲品免費贈送`;
  const parts = [];
  if (Number(slot.drink_hot_free) === 1) parts.push('熱飲免費');
  if (Number(slot.drink_cold_extra) > 0) parts.push(`凍飲 +$${slot.drink_cold_extra}`);
  return `${slot.name} · ${parts.join(' · ') || '原價'}`;
}

/**
 * 計算飲品最終價格
 * @returns {{ price: number, label: string, free: boolean }}
 */
export function drinkPrice(base, temperature, slot) {
  const b = Number(base) || 0;
  if (!slot) return { price: b, label: '原價', free: false };
  if (Number(slot.drink_all_free) === 1) return { price: 0, label: '時段免費', free: true };
  if (temperature === 'HOT' && Number(slot.drink_hot_free) === 1) return { price: 0, label: '熱飲免費', free: true };
  if (temperature === 'COLD' && Number(slot.drink_cold_extra) > 0) {
    return { price: b + Number(slot.drink_cold_extra), label: `凍飲 +$${slot.drink_cold_extra}`, free: false };
  }
  return { price: b, label: '原價', free: false };
}

export const DRINK_PREFS = ['走甜', '少甜', '多甜', '走冰', '少冰', '多冰', '去冰', '加濃', '打包'];

/** 組合套餐選項的價格加總（不含基礎價與飲品） */
export function modifiersSum(options) {
  if (!options) return 0;
  let sum = 0;
  for (const key of ['noodle', 'spiciness', 'filling', 'flavor']) {
    if (options[key] && options[key].price_diff) sum += Number(options[key].price_diff) || 0;
  }
  for (const t of options.toppings || []) sum += Number(t.price_diff) || 0;
  return sum;
}

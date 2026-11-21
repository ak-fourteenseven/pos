<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@shared/api';
import { useAuthStore } from '@shared/stores/auth';
import { useCatalogStore } from '@shared/stores/catalog';
import { usePosStore } from '../stores/pos';
import { useToastStore } from '@shared/stores/toast';
import Modal from '@shared/components/Modal.vue';
import ComboWizard from '../components/ComboWizard.vue';
import DrinkModal from '../components/DrinkModal.vue';
import KitchenTicketModal from '../components/KitchenTicketModal.vue';
import {
  fmtMoney, hexA, PAYMENT_META, QUICK_REMARKS,
} from '@shared/utils/format';
import { currentSlot, modifiersSum, slotRuleText } from '@shared/utils/pricing';

const auth = useAuthStore();
const catalog = useCatalogStore();
const pos = usePosStore();
const toast = useToastStore();
const router = useRouter();

/* ---------------- 菜品區（套餐菜單） ---------------- */
const activeCategory = ref('all');
const keyword = ref('');

const menuProducts = computed(() => {
  const list = [];
  for (const c of catalog.menu.categories) for (const p of c.products) list.push(p);
  return list;
});

const products = computed(() => {
  let list = menuProducts.value;
  if (activeCategory.value !== 'all') {
    list = list.filter((p) => p.category_id === activeCategory.value);
  }
  const kw = keyword.value.trim();
  if (kw) list = list.filter((p) => p.name.includes(kw));
  return list;
});

/* ---------------- 菜品／操作分頁網格 ---------------- */
const actionPaneRef = ref(null);
const productPage = ref(0);
const payPage = ref(0);
const opPage = ref(0);
/** 菜品固定 5×5；超過 25 時右下角為翻頁（每頁 24 項） */
const PRODUCT_COLS = 5;
const PRODUCT_ROWS = 5;
const PRODUCT_CAPACITY = PRODUCT_COLS * PRODUCT_ROWS;
/** 操作列：左操作 5×2=10，右支付 4×2=8 */
const PAY_COLS = 4;
const PAY_ROWS = 2;
const PAY_CAPACITY = PAY_COLS * PAY_ROWS;
const OP_COLS = 5;
const OP_ROWS = 2;
const OP_CAPACITY = OP_COLS * OP_ROWS;
const actionCellSize = ref(48);

const ACTION_GAP = 6;
const ACTION_SECTION_GAP = 10;
const ACTION_MIN_SIZE = 40;

function pageMeta(total, capacity, page) {
  const needsPager = total > capacity && capacity > 0;
  const perPage = needsPager ? Math.max(1, capacity - 1) : Math.max(1, capacity || 1);
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const start = safePage * perPage;
  return {
    needsPager,
    perPage,
    totalPages,
    page: safePage,
    start,
    end: start + perPage,
    canPrev: safePage > 0,
    canNext: safePage < totalPages - 1,
  };
}

const productPageMeta = computed(() => pageMeta(products.value.length, PRODUCT_CAPACITY, productPage.value));
const pagedProducts = computed(() => products.value.slice(productPageMeta.value.start, productPageMeta.value.end));
/** 本頁剩餘空白格（含翻頁格時扣 1） */
const productEmptySlots = computed(() => {
  const slots = productPageMeta.value.needsPager ? PRODUCT_CAPACITY - 1 : PRODUCT_CAPACITY;
  return Math.max(0, slots - pagedProducts.value.length);
});

const paymentItems = computed(() =>
  (catalog.enabledPayments || []).map((pm) => ({ type: 'payment', id: `pay-${pm.id}`, pm })),
);
const opItems = computed(() => [
  { type: 'price', id: 'price', icon: '改', label: '改價' },
  { type: 'tables', id: 'tables', icon: '🪑', label: '桌台' },
  { type: 'move', id: 'move', icon: '🔄', label: '換桌', disabled: !pos.tableId },
  {
    type: 'void',
    id: 'void',
    icon: '🚫',
    label: '作廢',
    danger: true,
    disabled: !(pos.hasServerOrder && auth.isManager),
  },
  {
    type: 'reprint',
    id: 'reprint',
    icon: '🖨️',
    label: '補印',
    disabled: !pos.hasServerOrder,
  },
  {
    type: 'split',
    id: 'split',
    icon: '✂️',
    label: '分單',
    disabled: !(pos.hasServerOrder && pos.items.length > 1),
  },
]);

const payPageMeta = computed(() => pageMeta(paymentItems.value.length, PAY_CAPACITY, payPage.value));
const pagedPayments = computed(() => paymentItems.value.slice(payPageMeta.value.start, payPageMeta.value.end));
const payEmptySlots = computed(() => {
  const slots = payPageMeta.value.needsPager ? PAY_CAPACITY - 1 : PAY_CAPACITY;
  return Math.max(0, slots - pagedPayments.value.length);
});

const opPageMeta = computed(() => pageMeta(opItems.value.length, OP_CAPACITY, opPage.value));
const pagedOps = computed(() => opItems.value.slice(opPageMeta.value.start, opPageMeta.value.end));
const opEmptySlots = computed(() => {
  const slots = opPageMeta.value.needsPager ? OP_CAPACITY - 1 : OP_CAPACITY;
  return Math.max(0, slots - pagedOps.value.length);
});

function onActionClick(item) {
  if (item.disabled) {
    if (item.type === 'move') toast.error('目前不是桌台單，無法換桌');
    else if (item.type === 'void') toast.error(auth.isManager ? '尚無訂單可作廢' : '作廢需店長權限');
    else if (item.type === 'reprint') toast.error('尚未下單，無廚房單可補印');
    else if (item.type === 'split') toast.error('需已下單且購物車超過 1 項才能分單');
    return;
  }
  if (item.type === 'payment') pos.setPayment(item.pm.code);
  else if (item.type === 'price') openPriceModal();
  else if (item.type === 'tables') router.push('/tables');
  else if (item.type === 'move') moveModal.value = true;
  else if (item.type === 'void') voidModal.value = true;
  else if (item.type === 'reprint') reprintTicket();
  else if (item.type === 'split') openSplit();
}

function gridWidth(cols, cell) {
  return cols * cell + ACTION_GAP * Math.max(0, cols - 1);
}

function measureActionGrid() {
  const pane = actionPaneRef.value;
  if (!pane) return;
  const style = getComputedStyle(pane);
  const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
  const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
  const w = Math.max(0, pane.clientWidth - padX);
  const h = Math.max(0, pane.clientHeight - padY);
  let cell = Math.max(
    ACTION_MIN_SIZE,
    Math.floor((h - ACTION_GAP * (PAY_ROWS - 1)) / PAY_ROWS),
  );
  while (
    cell > ACTION_MIN_SIZE
    && gridWidth(PAY_COLS, cell) + ACTION_SECTION_GAP + gridWidth(OP_COLS, cell) > w
  ) {
    cell -= 1;
  }
  actionCellSize.value = Math.max(1, cell);
  if (payPage.value >= pageMeta(paymentItems.value.length, PAY_CAPACITY, payPage.value).totalPages) {
    payPage.value = 0;
  }
  if (opPage.value >= pageMeta(opItems.value.length, OP_CAPACITY, opPage.value).totalPages) {
    opPage.value = 0;
  }
}

let gridObserver = null;
watch([products, () => activeCategory.value, keyword], () => { productPage.value = 0; });
watch(paymentItems, () => { payPage.value = 0; });
watch(opItems, () => { opPage.value = 0; });

/* ---------------- 時段（飲品計價） ---------------- */
/** 每 10 秒更新一次時間戳，帶動時段重新計算（跨時段邊界即時切換） */
const nowTick = ref(Date.now());
/** 時段必須隨時段設定載入即時重算，否則開單初始 10 秒內會誤用原價 */
const nowSlot = computed(() => currentSlot(catalog.timeSlots, new Date(nowTick.value)));
let slotTimer = null;
onMounted(() => {
  slotTimer = setInterval(() => { nowTick.value = Date.now(); }, 10000);
  gridObserver = new ResizeObserver(() => measureActionGrid());
  requestAnimationFrame(() => {
    if (actionPaneRef.value) gridObserver.observe(actionPaneRef.value);
    measureActionGrid();
  });
});
onUnmounted(() => {
  clearInterval(slotTimer);
  gridObserver?.disconnect();
});

/* ---------------- 彈窗狀態 ---------------- */
const specModal = ref(false);
const specForm = ref({ product: null, qty: 1, spec: '', remark: '', editing: null });

const discountModal = ref(false);
const discountForm = ref({ mode: 'rate', rate: 95, amount: 0 });

const moveModal = ref(false);
const receipt = ref(null);
const voidModal = ref(false);
const splitModal = ref(false);
const splitForm = ref({ selectedIds: [], tableId: null });
const priceModal = ref(false);
const priceForm = ref({ price: 0 });
const priceDigits = ref('');
const cashPayModal = ref(false);
const wizardProduct = ref(null);
const drinkProduct = ref(null);
const receiptTab = ref('customer');
const ticketModal = ref(false);
const ticket = ref(null);

/* ---------------- 初始化 ---------------- */
onMounted(async () => {
  try {
    await catalog.loadAll();
    requestAnimationFrame(() => measureActionGrid());
  } catch (e) {
    toast.error(e.message);
  }
});

const receivedDigits = ref('');
const NUM_PAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];

watch(() => pos.paymentMethod, (m) => {
  if (m !== 'cash') {
    pos.setReceived(0);
    receivedDigits.value = '';
    cashPayModal.value = false;
  }
});

/** 通用數字鍵盤：寫入 digits ref，並回呼數值 */
function applyNumPad(digitsRef, key, onValue, maxLen = 8) {
  let d = digitsRef.value;
  if (key === 'C') d = '';
  else if (key === '⌫') d = d.slice(0, -1);
  else if (d.length < maxLen) d = d === '0' ? key : `${d}${key}`;
  digitsRef.value = d;
  onValue?.(Number(d) || 0);
}

function onPriceNumPad(key) {
  applyNumPad(priceDigits, key, (v) => { priceForm.value.price = v; });
}

function onCashNumPad(key) {
  applyNumPad(receivedDigits, key, (v) => pos.setReceived(v));
}

function addQuickAmount(v) {
  const next = Number(pos.received || 0) + v;
  pos.setReceived(next);
  receivedDigits.value = String(next);
}

function setExactAmount() {
  const exact = Number(pos.total) || 0;
  pos.setReceived(exact);
  receivedDigits.value = String(exact);
}

/* ---------------- 加菜 ---------------- */
function onProduct(p) {
  if (Number(p.is_available) !== 1) {
    toast.error(`「${p.name}」已售罄`);
    return;
  }
  // 套餐（湯底/湯餃/需口味的小食）→ 嚮導
  if (p.steps && p.steps.length) {
    wizardProduct.value = p;
    return;
  }
  // 飲品 → 凍熱/口味彈窗
  if (Number(p.is_drink) === 1) {
    drinkProduct.value = p;
    return;
  }
  pos.addProduct(p);
}

/** 套餐選項明細文字（購物車/小票共用） */
function optionLines(item) {
  let o = item.options;
  if (!o) return [];
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch { return []; } }
  const lines = [];
  if (o.noodle) lines.push(`麵: ${o.noodle.name}`);
  if (o.spiciness) lines.push(`辣度: ${o.spiciness.name}`);
  if (o.filling) lines.push(`餡料: ${o.filling.name}`);
  if (o.flavor) lines.push(`口味: ${o.flavor.name}`);
  if (o.toppings && o.toppings.length) lines.push(`加料: ${o.toppings.map((t) => t.name).join('、')}`);
  if (o.drink) {
    const t = o.drink.temperature === 'HOT' ? '熱' : '凍';
    const prefs = o.drink.preferences && o.drink.preferences.length ? `, ${o.drink.preferences.join('、')}` : '';
    const price = Number(o.drink.final_price) === 0 ? '免費' : fmtMoney(o.drink.final_price, catalog.currency);
    lines.push(`飲品: ${o.drink.name}(${t}${prefs}) ${price}`);
  }
  return lines;
}

function onWizardAdd({ product, options, qty }) {
  const unit = Number(product.price) + modifiersSum(options) + (options.drink ? Number(options.drink.final_price) || 0 : 0);
  pos.addCombo(product, options, unit, qty);
  wizardProduct.value = null;
}
function onDrinkAdd({ product, temperature, preferences, qty }) {
  pos.addDrink(product, { temperature, preferences }, qty);
  drinkProduct.value = null;
}

function specDiff() {
  const specs = catalog.parseSpecs(specForm.value.product);
  const s = specs.find((x) => x.name === specForm.value.spec);
  return s ? Number(s.diff || 0) : 0;
}

async function confirmSpec() {
  const { product, qty, spec, remark, editing } = specForm.value;
  if (editing) {
    await pos.updateItem(editing, { remark });
  } else {
    await pos.addProduct(product, { spec, spec_diff: specDiff(), remark, qty });
  }
  specModal.value = false;
}

function editItem(item) {
  const product = catalog.products.find((p) => p.id === item.product_id) || { name: item.name };
  const specs = catalog.parseSpecs(product);
  specForm.value = {
    product,
    qty: item.qty,
    spec: item.spec || (specs[0]?.name ?? ''),
    remark: item.remark,
    editing: item,
  };
  specModal.value = true;
}

function toggleRemark(tag) {
  const cur = specForm.value.remark.trim();
  const parts = cur ? cur.split(/[\s,，]+/).filter(Boolean) : [];
  const idx = parts.indexOf(tag);
  if (idx >= 0) parts.splice(idx, 1);
  else parts.push(tag);
  specForm.value.remark = parts.join('、');
}

/* ---------------- 折扣 ---------------- */
function openDiscount() {
  discountForm.value = { mode: 'rate', rate: 95, amount: pos.discount };
  discountModal.value = true;
}
function applyDiscount() {
  const { mode, rate, amount } = discountForm.value;
  if (mode === 'rate') {
    const off = Math.round(pos.subtotal * (1 - rate / 100));
    pos.setDiscount(off, `${rate}折`);
  } else if (mode === 'round') {
    const rounded = Math.floor(pos.subtotal / 10) * 10;
    pos.setDiscount(pos.subtotal - rounded, '抹零');
  } else {
    pos.setDiscount(Math.min(Number(amount) || 0, pos.subtotal), '自訂折扣');
  }
  discountModal.value = false;
}

/* ---------------- 換桌 ---------------- */
const availableTables = computed(() => catalog.tables.filter((t) => t.status === 'available'));
async function moveToTable(t) {
  try {
    await api.patch(`/orders/${pos.orderId}`, { table_id: t.id });
    pos.tableId = t.id;
    pos.tableNumber = t.table_number;
    await catalog.reloadTables();
    moveModal.value = false;
    toast.success(`已換桌至 ${t.table_number}`);
  } catch (e) {
    toast.error(e.message);
  }
}

/* ---------------- 下單（送廚房） ---------------- */
const submitting = ref(false);
async function submitOrder() {
  if (!pos.items.length) {
    toast.error('購物車為空');
    return;
  }
  submitting.value = true;
  try {
    const res = await pos.submitOrder();
    ticket.value = res.ticket;
    ticketModal.value = true;
    await catalog.reloadTables();
    toast.success(res.appended
      ? `已送廚（追加 ${res.sent_count} 項），廚房單已產生`
      : `已下單送廚（${res.sent_count} 項），廚房單已產生`);
  } catch (e) {
    toast.error(e.message);
  } finally {
    submitting.value = false;
  }
}
/** 廚房單補印（重印該訂單已送廚的全部明細） */
async function reprintTicket() {
  try {
    ticket.value = await pos.kitchenTicket();
    ticketModal.value = true;
  } catch (e) {
    toast.error(e.message);
  }
}

/* ---------------- 結帳 / 作廢 ---------------- */
function requestCheckout() {
  if (!pos.items.length) {
    toast.error('購物車為空');
    return;
  }
  if (pos.pendingCount > 0) {
    toast.error('請先「下單」送廚房，顧客用餐後再結賬');
    return;
  }
  if (pos.paymentMethod === 'cash') {
    receivedDigits.value = pos.received ? String(pos.received) : '';
    if (!pos.received) pos.setReceived(0);
    cashPayModal.value = true;
    return;
  }
  checkout();
}

async function confirmCashPay() {
  if (pos.received < pos.total) {
    toast.error('收現金額不足');
    return;
  }
  cashPayModal.value = false;
  await checkout();
}

async function checkout() {
  if (!pos.items.length) {
    toast.error('購物車為空');
    return;
  }
  if (pos.pendingCount > 0) {
    toast.error('請先「下單」送廚房，顧客用餐後再結賬');
    return;
  }
  if (pos.paymentMethod === 'cash' && pos.received < pos.total) {
    toast.error('收現金額不足');
    return;
  }
  try {
    receipt.value = await pos.checkout();
    receivedDigits.value = '';
    cashPayModal.value = false;
    await catalog.reloadTables();
  } catch (e) {
    toast.error(e.message);
  }
}
async function voidOrder() {
  try {
    await pos.voidOrder();
    await catalog.reloadTables();
    voidModal.value = false;
    toast.success('訂單已作廢');
  } catch (e) {
    toast.error(e.message);
  }
}

function afterReceipt() {
  receipt.value = null;
  receiptTab.value = 'customer';
}

/* ---------------- 分單 ---------------- */
const splitTargetTables = computed(() => catalog.tables.filter((t) => t.status === 'available' && t.id !== pos.tableId));
function openSplit() {
  splitForm.value = { selectedIds: [], tableId: null };
  splitModal.value = true;
}
function toggleSplitItem(id) {
  const idx = splitForm.value.selectedIds.indexOf(id);
  if (idx >= 0) splitForm.value.selectedIds.splice(idx, 1);
  else splitForm.value.selectedIds.push(id);
}
const splitSelectedItems = computed(() => pos.items.filter((it) => splitForm.value.selectedIds.includes(it.id)));
const splitSelectedTotal = computed(() => splitSelectedItems.value.reduce((s, it) => s + it.price * it.qty, 0));
async function confirmSplit() {
  if (!splitForm.value.selectedIds.length) {
    toast.error('請選擇要分出的菜品');
    return;
  }
  try {
    const newOrder = await pos.splitOrder(splitForm.value.selectedIds, splitForm.value.tableId);
    splitModal.value = false;
    await catalog.reloadTables();
    toast.success(`已分單：${splitSelectedItems.value.length} 項分出至新訂單 ${newOrder.order_no}`);
  } catch (e) {
    toast.error(e.message);
  }
}

/** 飲品時段優惠金額（顧客單顯示：原價 $X，優惠 −$Y） */
function drinkSaving(it) {
  let o = it.options;
  if (!o) return null;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch { return null; } }
  if (!o.drink || !o.drink.base_price) return null;
  const saved = Number(o.drink.base_price) - Number(o.drink.final_price || 0);
  if (saved <= 0) return null;
  return { base: Number(o.drink.base_price), saved };
}

/** 廚房單文字（後廚 + 水吧分區） */
const kitchenText = computed(() => {
  if (!receipt.value) return '';
  const food = [];
  const bar = [];
  const drinkLine = (it, d) => {
    const t = d.temperature === 'HOT' ? '熱' : '凍';
    const prefs = d.preferences && d.preferences.length ? `, ${d.preferences.join(', ')}` : '';
    bar.push(`${it.quantity}x ${d.name} (${t}${prefs})`);
  };
  for (const it of receipt.value.items) {
    let o = it.options;
    if (typeof o === 'string') { try { o = JSON.parse(o); } catch { o = null; } }
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
  const lines = [];
  if (food.length) { lines.push('【廚房】', ...food); }
  if (bar.length) { lines.push('', '【水吧】', ...bar); }
  return lines.join('\n');
});

/* ---------------- 改價（選中列的單價） ---------------- */
function openPriceModal() {
  const item = pos.selectedItem;
  if (!item) {
    toast.error('請先在購物車選取要改價的項目');
    return;
  }
  const p = Number(item.price) || 0;
  priceForm.value = { price: p };
  priceDigits.value = p ? String(p) : '';
  priceModal.value = true;
}
async function applyPrice() {
  const item = pos.selectedItem;
  if (!item) {
    toast.error('請先選取要改價的項目');
    priceModal.value = false;
    return;
  }
  const p = Math.max(0, Number(priceForm.value.price) || 0);
  try {
    if (typeof pos.setItemPrice === 'function') {
      await pos.setItemPrice(item, p);
    } else {
      /* Pinia HMR 可能尚未掛上新 action：直接改單價並同步後端 */
      if (pos.orderId && typeof item.id === 'number') {
        await api.put(`/orders/${pos.orderId}/items/${item.id}`, {
          quantity: item.qty,
          remark: item.remark || '',
          price: p,
        });
      }
      item.price = p;
      pos.selectItem?.(item);
    }
    priceModal.value = false;
    toast.success(`已改價為 ${fmtMoney(item.price, catalog.currency)}`);
  } catch (e) {
    toast.error(e.message);
  }
}

function paymentMeta(m) {
  return PAYMENT_META[m] || { label: m, icon: '💰' };
}

/** 單號縮短顯示：POS20261121-0002 → #0002；下單送廚後才顯示 */
function shortOrderNo(no) {
  if (!no) return '';
  const m = String(no).match(/-(\d+)$/);
  return m ? `#${m[1]}` : `#${String(no).slice(-4)}`;
}
const showOrderNo = computed(() => !!pos.orderNo && pos.items.some((i) => i.sent));

const cashShort = computed(() => pos.paymentMethod === 'cash' && pos.received > 0 && pos.received < pos.total);
</script>

<template>
  <div class="h-full flex min-h-0">
    <!-- 左：菜品展示區（container query 依中欄寬度切欄） -->
    <section class="pos-menu-pane flex-1 flex flex-col min-w-0 min-h-0">
      <!-- 工具列：單據狀態 / 輔助操作 / 主要動作 -->
      <div class="bg-white border-b border-gray-200 px-2 xl:px-4 py-2 xl:py-2.5 flex items-center gap-1.5 xl:gap-2 flex-wrap shrink-0 shadow-[0_1px_0_rgba(0,0,0,0.02)]">
        <!-- 左：目前單據狀態 -->
        <div class="flex items-center gap-1.5 xl:gap-2 pr-2 xl:pr-3 mr-0.5 xl:mr-1 border-r border-gray-200 min-w-0">
          <span
            class="chip !gap-1.5 !px-2.5 xl:!px-3 !py-1 !text-xs xl:!text-[13px] max-w-[14rem] xl:max-w-none truncate"
            :class="pos.tableId ? 'bg-brand-100 text-brand-700' : showOrderNo ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'"
          >
            <span class="ico">{{ pos.tableId ? '🪑' : '🥡' }}</span>
            <template v-if="pos.tableId">
              {{ pos.tableNumber }}<template v-if="showOrderNo"> · {{ shortOrderNo(pos.orderNo) }}</template>
            </template>
            <template v-else-if="showOrderNo">外帶 / 快餐 · {{ shortOrderNo(pos.orderNo) }}</template>
            <template v-else>快餐模式（未開台）</template>
          </span>
          <span
            v-if="pos.hasServerOrder"
            class="chip !gap-1.5 !px-2.5 xl:!px-3 !py-1 !text-xs xl:!text-[13px] shrink-0"
            :class="pos.pendingCount ? 'bg-gray-100 text-gray-500' : 'bg-emerald-100 text-emerald-700'"
          >
            <span class="ico">{{ pos.pendingCount ? '⏳' : '✅' }}</span>
            <span class="hidden sm:inline">{{ pos.pendingCount ? `${pos.pendingCount} 項待送廚` : '已全部送廚' }}</span>
            <span class="sm:hidden">{{ pos.pendingCount ? `${pos.pendingCount}待送` : '已送廚' }}</span>
          </span>
        </div>

        <div class="flex-1 min-w-2" />

        <!-- 右：時段資訊（操作鈕已移至下方面板） -->
        <span class="chip !gap-1.5 !px-2.5 xl:!px-3 !py-1 !text-xs xl:!text-[13px] bg-amber-100 text-amber-700 max-w-[10rem] xl:max-w-none truncate"><span class="ico">🕐</span>{{ slotRuleText(nowSlot) }}</span>
        <span v-if="catalog.serviceRate > 0" class="chip !gap-1.5 !px-2.5 xl:!px-3 !py-1 !text-xs xl:!text-[13px] bg-amber-100 text-amber-700 hidden xl:inline-flex"><span class="ico">💁</span>服務費 {{ catalog.serviceRate }}%</span>
      </div>

      <!-- 分類 -->
      <div class="bg-white border-b border-gray-200 px-2 xl:px-4 py-2 flex gap-2 overflow-x-auto shrink-0">
        <button
          class="btn btn-sm shrink-0"
          :class="activeCategory === 'all' ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-600'"
          @click="activeCategory = 'all'"
        >
          全部
        </button>
        <button
          v-for="c in catalog.menu.categories"
          :key="c.id"
          class="btn btn-sm shrink-0"
          :class="activeCategory === c.id ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-600'"
          @click="activeCategory = c.id"
        >
          {{ c.name }}（{{ c.products.length }}）
        </button>
        <div class="flex-1 min-w-2" />
        <input v-model="keyword" class="input !w-28 xl:!w-44 !py-1 shrink-0" placeholder="搜尋…" />
      </div>

      <!-- 上 78% 菜品 / 下 22% 支付與操作（滿格時右下角為翻頁） -->
      <div class="flex-1 flex flex-col min-h-0">
        <div class="basis-[78%] min-h-0 overflow-hidden p-2 xl:p-2.5">
          <div class="pos-product-grid">
            <!-- 先佔住右下角（第 25 格），避免自動排版蓋住翻頁 -->
            <div
              v-if="productPageMeta.needsPager"
              class="rounded-xl border-2 border-gray-200 bg-white min-w-0 min-h-0 overflow-hidden flex"
              :style="{ gridColumn: PRODUCT_COLS, gridRow: PRODUCT_ROWS }"
            >
              <button
                type="button"
                class="flex-1 font-extrabold text-lg xl:text-xl text-gray-600 transition hover:bg-brand-50 hover:text-brand-600 disabled:text-gray-300 disabled:hover:bg-transparent"
                :disabled="!productPageMeta.canPrev"
                @click="productPage = Math.max(0, productPage - 1)"
              >‹</button>
              <div class="w-px self-stretch bg-gray-200" />
              <button
                type="button"
                class="flex-1 font-extrabold text-lg xl:text-xl text-gray-600 transition hover:bg-brand-50 hover:text-brand-600 disabled:text-gray-300 disabled:hover:bg-transparent"
                :disabled="!productPageMeta.canNext"
                @click="productPage += 1"
              >›</button>
            </div>

            <button
              v-for="p in pagedProducts"
              :key="p.id"
              class="relative rounded-xl border-2 px-1.5 pt-1 pb-1 text-left transition active:scale-95 hover:shadow-md min-w-0 min-h-0 overflow-hidden flex flex-col"
              :style="{
                borderColor: hexA(p.color, 0.35),
                background: hexA(p.color, 0.07),
              }"
              @click="onProduct(p)"
            >
              <div class="flex-1 min-h-0 flex items-center justify-center text-2xl xl:text-3xl leading-none">{{ p.emoji }}</div>
              <div class="shrink-0 min-w-0 leading-none">
                <div class="font-bold text-[11px] xl:text-xs text-gray-800 truncate" :title="p.name">{{ p.name }}</div>
                <div class="flex items-center justify-between gap-0.5 min-w-0 mt-0.5">
                  <span class="font-extrabold text-[11px] xl:text-xs truncate leading-none" :style="{ color: p.color }">{{ fmtMoney(p.price, catalog.currency) }}</span>
                  <span v-if="p.kind === 'combo'" class="chip !px-1 !py-0 bg-brand-100 text-brand-700 text-[9px] shrink-0">套餐</span>
                  <span v-else-if="Number(p.is_drink) === 1" class="chip !px-1 !py-0 bg-sky-100 text-sky-700 text-[9px] shrink-0">飲品</span>
                  <span v-else-if="p.steps && p.steps.length" class="chip !px-1 !py-0 bg-violet-100 text-violet-700 text-[9px] shrink-0">選口味</span>
                </div>
              </div>
              <div v-if="Number(p.is_available) !== 1" class="absolute inset-0 bg-white/70 rounded-xl flex items-center justify-center font-extrabold text-gray-400 text-xs">
                售罄
              </div>
            </button>

            <div
              v-for="n in productEmptySlots"
              :key="`product-empty-${n}`"
              class="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/60 min-w-0 min-h-0"
              aria-hidden="true"
            />
          </div>
        </div>

        <div
          ref="actionPaneRef"
          class="basis-[22%] min-h-0 overflow-hidden border-t border-gray-200 bg-white px-2 xl:px-2.5 py-1 flex items-center justify-center gap-2.5"
        >
          <!-- 左：操作 5×2 = 10 -->
          <div
            class="pos-action-grid shrink-0"
            :style="{
              gridTemplateColumns: `repeat(${OP_COLS}, ${actionCellSize}px)`,
              gridTemplateRows: `repeat(${OP_ROWS}, ${actionCellSize}px)`,
            }"
          >
            <div
              v-if="opPageMeta.needsPager"
              class="rounded-xl border-2 border-gray-200 bg-white overflow-hidden flex box-border"
              :style="{
                width: `${actionCellSize}px`,
                height: `${actionCellSize}px`,
                gridColumn: OP_COLS,
                gridRow: OP_ROWS,
              }"
            >
              <button
                type="button"
                class="flex-1 font-extrabold text-lg text-gray-600 transition hover:bg-brand-50 hover:text-brand-600 disabled:text-gray-300 disabled:hover:bg-transparent"
                :disabled="!opPageMeta.canPrev"
                @click="opPage = Math.max(0, opPage - 1)"
              >‹</button>
              <div class="w-px self-stretch bg-gray-200" />
              <button
                type="button"
                class="flex-1 font-extrabold text-lg text-gray-600 transition hover:bg-brand-50 hover:text-brand-600 disabled:text-gray-300 disabled:hover:bg-transparent"
                :disabled="!opPageMeta.canNext"
                @click="opPage += 1"
              >›</button>
            </div>

            <button
              v-for="item in pagedOps"
              :key="item.id"
              type="button"
              class="rounded-xl border-2 text-center transition active:scale-95 flex flex-col items-center justify-center gap-0.5 px-1 overflow-hidden box-border"
              :class="[
                item.disabled ? 'opacity-40' : '',
                item.danger
                  ? 'border-red-200 hover:border-red-400 hover:bg-red-50'
                  : 'border-gray-200 hover:border-brand-300',
              ]"
              :style="{ width: `${actionCellSize}px`, height: `${actionCellSize}px` }"
              @click="onActionClick(item)"
            >
              <div class="text-sm font-extrabold leading-none" :class="item.danger ? 'text-red-500' : ''">{{ item.icon }}</div>
              <div class="text-[10px] font-bold leading-tight" :class="item.danger ? 'text-red-500' : ''">{{ item.label }}</div>
            </button>

            <div
              v-for="n in opEmptySlots"
              :key="`op-empty-${n}`"
              class="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/60 box-border"
              :style="{ width: `${actionCellSize}px`, height: `${actionCellSize}px` }"
              aria-hidden="true"
            />
          </div>

          <div class="w-px self-stretch bg-gray-200 shrink-0" aria-hidden="true" />

          <!-- 右：支付 4×2 = 8 -->
          <div
            class="pos-action-grid shrink-0"
            :style="{
              gridTemplateColumns: `repeat(${PAY_COLS}, ${actionCellSize}px)`,
              gridTemplateRows: `repeat(${PAY_ROWS}, ${actionCellSize}px)`,
            }"
          >
            <div
              v-if="payPageMeta.needsPager"
              class="rounded-xl border-2 border-gray-200 bg-white overflow-hidden flex box-border"
              :style="{
                width: `${actionCellSize}px`,
                height: `${actionCellSize}px`,
                gridColumn: PAY_COLS,
                gridRow: PAY_ROWS,
              }"
            >
              <button
                type="button"
                class="flex-1 font-extrabold text-lg text-gray-600 transition hover:bg-brand-50 hover:text-brand-600 disabled:text-gray-300 disabled:hover:bg-transparent"
                :disabled="!payPageMeta.canPrev"
                @click="payPage = Math.max(0, payPage - 1)"
              >‹</button>
              <div class="w-px self-stretch bg-gray-200" />
              <button
                type="button"
                class="flex-1 font-extrabold text-lg text-gray-600 transition hover:bg-brand-50 hover:text-brand-600 disabled:text-gray-300 disabled:hover:bg-transparent"
                :disabled="!payPageMeta.canNext"
                @click="payPage += 1"
              >›</button>
            </div>

            <button
              v-for="item in pagedPayments"
              :key="item.id"
              type="button"
              class="rounded-xl border-2 text-center transition active:scale-95 flex flex-col items-center justify-center gap-0.5 px-1 overflow-hidden box-border"
              :class="pos.paymentMethod === item.pm.code
                ? 'border-brand-500 bg-brand-50'
                : 'border-gray-200 hover:border-brand-300'"
              :style="{ width: `${actionCellSize}px`, height: `${actionCellSize}px` }"
              @click="onActionClick(item)"
            >
              <img
                v-if="paymentMeta(item.pm.code).img"
                :src="paymentMeta(item.pm.code).icon"
                :alt="item.pm.name"
                class="h-7 w-7 object-contain shrink-0"
              />
              <div
                v-else
                class="text-base leading-none flex items-center justify-center"
                v-html="paymentMeta(item.pm.code).icon"
              />
              <div class="text-[10px] font-bold leading-tight truncate max-w-full">{{ item.pm.name }}</div>
              <div v-if="Number(item.pm.fee_rate) > 0" class="text-[9px] text-gray-400 leading-tight truncate max-w-full">
                {{ (item.pm.fee_rate * 100).toFixed(1) }}%
              </div>
            </button>

            <div
              v-for="n in payEmptySlots"
              :key="`pay-empty-${n}`"
              class="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/60 box-border"
              :style="{ width: `${actionCellSize}px`, height: `${actionCellSize}px` }"
              aria-hidden="true"
            />
          </div>
        </div>
      </div>
    </section>

    <!-- 右：購物車 / 結帳面板（僅購物車列表可捲；金額與鍵盤固定可見） -->
    <aside class="w-[300px] xl:w-[340px] 2xl:w-[380px] shrink-0 bg-white border-l border-gray-200 flex flex-col min-h-0">
      <div class="px-2.5 xl:px-3 py-2 border-b border-gray-100 flex items-center justify-between shrink-0">
        <span class="font-extrabold text-sm">購物車</span>
        <span class="chip bg-gray-100 text-gray-500 !text-xs">{{ pos.count }} 件</span>
      </div>

      <!-- 明細 -->
      <div class="flex-1 overflow-y-auto min-h-0">
        <div v-if="!pos.items.length" class="h-full flex flex-col items-center justify-center text-gray-300 gap-2 py-10">
          <div class="text-5xl">🛒</div>
          <div class="text-sm">購物車空空，快來點餐吧</div>
        </div>
        <div
          v-for="item in pos.items"
          :key="item.id"
          role="button"
          tabindex="0"
          class="px-3 xl:px-4 py-2.5 xl:py-3 border-b flex gap-2 xl:gap-3 items-start cursor-pointer transition border-l-4"
          :class="pos.isSelected(item)
            ? 'bg-brand-500 border-brand-600 border-l-brand-700 text-white shadow-sm'
            : 'bg-white border-gray-100 border-l-transparent hover:bg-gray-50'"
          @click="pos.selectItem(item)"
          @keydown.enter.prevent="pos.selectItem(item)"
          @keydown.space.prevent="pos.selectItem(item)"
        >
          <div class="flex-1 min-w-0">
            <div
              class="font-bold text-sm truncate"
              :class="pos.isSelected(item) ? 'text-white' : 'text-gray-900'"
            >
              {{ item.name }}
              <span
                v-if="item.item_type === 'combo'"
                class="chip text-[10px] ml-1"
                :class="pos.isSelected(item) ? 'bg-white/25 text-white' : 'bg-brand-100 text-brand-700'"
              >套餐</span>
              <span
                v-if="item.sent"
                class="chip text-[10px] ml-1"
                :class="pos.isSelected(item) ? 'bg-white/25 text-white' : 'bg-emerald-100 text-emerald-700'"
              >已送廚</span>
              <span
                v-else
                class="chip text-[10px] ml-1"
                :class="pos.isSelected(item) ? 'bg-white/20 text-white/90' : 'bg-gray-200 text-gray-600'"
              >未送廚</span>
            </div>
            <div
              v-for="(line, i) in optionLines(item)"
              :key="i"
              class="text-xs mt-0.5 truncate"
              :class="pos.isSelected(item) ? 'text-brand-50' : 'text-gray-600'"
            >{{ line }}</div>
            <div
              v-if="item.spec || item.remark"
              class="text-xs mt-0.5 truncate"
              :class="pos.isSelected(item) ? 'text-brand-50' : 'text-gray-600'"
            >
              <span v-if="item.spec">[{{ item.spec }}]</span> {{ item.remark }}
            </div>
            <div
              class="font-extrabold text-sm mt-1"
              :class="pos.isSelected(item) ? 'text-white' : 'text-brand-700'"
            >
              {{ fmtMoney(item.price * item.qty, catalog.currency) }}
            </div>
          </div>
          <div class="flex flex-col items-end gap-1.5 shrink-0" @click.stop>
            <div class="flex items-center gap-1">
              <button
                class="w-7 h-7 rounded-lg font-bold"
                :class="pos.isSelected(item) ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'"
                @click="pos.setQty(item, item.qty - 1)"
              >−</button>
              <span
                class="w-7 text-center font-bold"
                :class="pos.isSelected(item) ? 'text-white' : 'text-gray-900'"
              >{{ item.qty }}</span>
              <button
                class="w-7 h-7 rounded-lg font-bold"
                :class="pos.isSelected(item) ? 'bg-white text-brand-600 hover:bg-brand-50' : 'bg-brand-100 text-brand-700 hover:bg-brand-200'"
                @click="pos.setQty(item, item.qty + 1)"
              >＋</button>
            </div>
            <div class="flex gap-2 text-xs">
              <button
                class="font-medium"
                :class="pos.isSelected(item) ? 'text-white/90 hover:text-white' : 'text-gray-600 hover:text-brand-600'"
                @click="editItem(item)"
              >備註</button>
              <button
                class="font-medium disabled:cursor-not-allowed"
                :class="pos.isSelected(item)
                  ? 'text-white/90 hover:text-white disabled:text-white/40'
                  : 'text-gray-600 hover:text-red-600 disabled:text-gray-300'"
                :disabled="item.sent && !auth.isManager"
                :title="item.sent && !auth.isManager ? '已送廚的菜品需店長權限才能退菜' : ''"
                @click="pos.removeItem(item)"
              >
                退菜
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 金額摘要：固定不捲動；數字鍵盤改在改價／現金結賬彈窗 -->
      <div class="shrink-0 overflow-hidden border-t border-gray-100 px-2.5 xl:px-3 py-1.5 space-y-0.5 text-xs">
        <div class="flex justify-between gap-2 text-gray-500">
          <span>小計</span>
          <span class="tabular-nums">{{ fmtMoney(pos.subtotal, catalog.currency) }}</span>
        </div>
        <button class="flex justify-between w-full gap-2 text-gray-500 hover:text-brand-500" @click="openDiscount">
          <span class="truncate">折扣{{ pos.discountLabel ? `（${pos.discountLabel}）` : '' }}</span>
          <span class="tabular-nums shrink-0" :class="pos.discount > 0 ? 'text-red-500 font-bold' : ''">−{{ fmtMoney(pos.discount, catalog.currency) }}</span>
        </button>
        <div v-if="catalog.serviceRate > 0" class="flex justify-between gap-2 text-gray-500">
          <span>服務費（{{ catalog.serviceRate }}%）</span>
          <span class="tabular-nums">{{ fmtMoney(pos.serviceFee, catalog.currency) }}</span>
        </div>
        <div class="flex justify-between items-baseline gap-2 pt-0.5">
          <span class="font-extrabold text-sm">應收</span>
          <span class="text-lg xl:text-xl font-extrabold text-brand-600 tabular-nums">{{ fmtMoney(pos.total, catalog.currency) }}</span>
        </div>
      </div>

      <!-- 下單（送廚房） / 結賬 -->
      <div class="px-2.5 xl:px-3 py-2 border-t border-gray-100 shrink-0 space-y-1.5">
        <button
          v-if="pos.pendingCount"
          class="btn-ghost w-full !py-2 text-sm !border-brand-300 !text-brand-600"
          :disabled="submitting"
          @click="submitOrder"
        >
          {{ submitting ? '送廚中…' : `🥘 下單 · ${pos.pendingCount} 項待送` }}
        </button>
        <button class="btn-primary w-full !py-2.5 text-base" :disabled="!pos.items.length || !!pos.pendingCount" @click="requestCheckout">
          💰 結賬 {{ fmtMoney(pos.total, catalog.currency) }}
        </button>
        <p v-if="pos.pendingCount" class="text-center text-[10px] text-gray-400 leading-tight">
          請先「下單」送廚房，顧客用餐後再結賬
        </p>
      </div>
    </aside>

    <!-- ============ 規格 / 備註彈窗 ============ -->
    <Modal v-model="specModal" :title="specForm.editing ? `備註 · ${specForm.editing.name}` : `${specForm.product?.name ?? ''} · 規格選擇`">
      <div v-if="specForm.product" class="space-y-5">
        <div>
          <div class="label">規格</div>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="s in catalog.parseSpecs(specForm.product)"
              :key="s.name"
              class="rounded-xl border-2 py-2.5 text-sm font-bold transition"
              :class="specForm.spec === s.name ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200'"
              @click="specForm.spec = s.name"
            >
              {{ s.name }}
              <span class="text-xs font-normal text-gray-400 ml-1">
                {{ s.diff > 0 ? '+' : '' }}{{ s.diff || '' }}{{ s.diff ? '元' : '' }}
              </span>
            </button>
          </div>
        </div>

        <div>
          <div class="label">備註（快捷標籤）</div>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="tag in QUICK_REMARKS"
              :key="tag"
              class="chip border transition"
              :class="specForm.remark.includes(tag) ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-gray-500 border-gray-300'"
              @click="toggleRemark(tag)"
            >
              {{ tag }}
            </button>
          </div>
          <input v-model="specForm.remark" class="input mt-2" placeholder="自訂備註…" />
        </div>

        <div class="flex items-center justify-between">
          <div class="label !mb-0">數量</div>
          <div class="flex items-center gap-3">
            <button class="w-9 h-9 rounded-lg bg-gray-100 font-bold" @click="specForm.qty = Math.max(1, specForm.qty - 1)">−</button>
            <span class="w-8 text-center font-extrabold text-lg">{{ specForm.qty }}</span>
            <button class="w-9 h-9 rounded-lg bg-brand-100 font-bold text-brand-600" @click="specForm.qty++">＋</button>
          </div>
        </div>

        <div class="flex justify-between items-center bg-gray-50 rounded-xl px-4 py-3">
          <span class="text-sm text-gray-500">小計</span>
          <span class="font-extrabold text-brand-600 text-lg">
            {{ fmtMoney((Number(specForm.product.price) + specDiff()) * specForm.qty, catalog.currency) }}
          </span>
        </div>
      </div>
      <template #footer>
        <button class="btn-ghost" @click="specModal = false">取消</button>
        <button class="btn-primary" @click="confirmSpec">{{ specForm.editing ? '儲存備註' : '加入購物車' }}</button>
      </template>
    </Modal>

    <!-- ============ 折扣彈窗 ============ -->
    <Modal v-model="discountModal" title="折扣 / 抹零" width="max-w-md">
      <div class="space-y-4">
        <div class="grid grid-cols-4 gap-2">
          <button
            v-for="r in [95, 90, 85, 80]"
            :key="r"
            class="rounded-xl border-2 py-3 font-extrabold transition"
            :class="discountForm.mode === 'rate' && discountForm.rate === r ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200'"
            @click="discountForm = { mode: 'rate', rate: r, amount: 0 }"
          >
            {{ r === 100 ? '原價' : (r / 10) + '折' }}
          </button>
        </div>
        <button
          class="w-full rounded-xl border-2 py-3 font-extrabold transition"
          :class="discountForm.mode === 'round' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200'"
          @click="discountForm = { mode: 'round', rate: 0, amount: 0 }"
        >
          抹零（減至十位）
        </button>
        <div>
          <div class="label">自訂折扣金額</div>
          <input
            v-model="discountForm.amount"
            type="number"
            min="0"
            class="input"
            placeholder="輸入折扣金額"
            @focus="discountForm.mode = 'custom'"
          />
        </div>
        <div class="bg-gray-50 rounded-xl px-4 py-3 flex justify-between text-sm">
          <span class="text-gray-500">折扣後總價</span>
          <span class="font-extrabold text-brand-600">
            {{ fmtMoney(Math.max(0, pos.subtotal - (discountForm.mode === 'rate'
              ? Math.round(pos.subtotal * (1 - discountForm.rate / 100))
              : discountForm.mode === 'round'
                ? pos.subtotal - Math.floor(pos.subtotal / 10) * 10
                : Number(discountForm.amount) || 0)), catalog.currency) }}
          </span>
        </div>
      </div>
      <template #footer>
        <button class="btn-ghost" @click="pos.setDiscount(0, ''); discountModal = false">清除折扣</button>
        <button class="btn-primary" @click="applyDiscount">套用</button>
      </template>
    </Modal>

    <!-- ============ 換桌 ============ -->
    <Modal v-model="moveModal" title="換桌" width="max-w-md">
      <p class="text-sm text-gray-500 mb-3">目前桌台：<b class="text-gray-800">{{ pos.tableNumber }}</b>，請選擇空閒桌台：</p>
      <div class="grid grid-cols-4 gap-2">
        <button
          v-for="t in availableTables"
          :key="t.id"
          class="rounded-xl border-2 border-gray-200 py-3 font-bold hover:border-brand-400 transition"
          @click="moveToTable(t)"
        >
          {{ t.table_number }}
          <div class="text-[10px] text-gray-400 font-normal">{{ t.area }} · {{ t.capacity }}人</div>
        </button>
      </div>
      <div v-if="!availableTables.length" class="text-center text-gray-300 py-6">沒有空閒桌台</div>
    </Modal>

    <!-- ============ 作廢確認 ============ -->
    <Modal v-model="voidModal" title="作廢訂單" width="max-w-sm">
      <p class="text-sm text-gray-600">
        確定作廢訂單 <b>{{ pos.orderNo }}</b>（桌台 {{ pos.tableNumber }}）？作廢後桌台將轉為待清，此操作無法復原。
      </p>
      <template #footer>
        <button class="btn-ghost" @click="voidModal = false">取消</button>
        <button class="btn-danger" @click="voidOrder">確定作廢</button>
      </template>
    </Modal>

    <!-- ============ 分單 ============ -->
    <Modal v-model="splitModal" title="分單" width="max-w-lg">
      <div class="space-y-4">
        <p class="text-sm text-gray-500">勾選要分出到新訂單的菜品（整個套餐將一併分出）：</p>
        <div class="space-y-1 max-h-72 overflow-y-auto">
          <label
            v-for="item in pos.items"
            :key="item.id"
            class="flex items-start gap-3 px-3 py-2.5 rounded-xl border-2 cursor-pointer transition"
            :class="splitForm.selectedIds.includes(item.id) ? 'border-brand-500 bg-brand-50' : 'border-gray-100 hover:border-gray-200'"
          >
            <input
              type="checkbox"
              class="mt-1 w-4 h-4 accent-brand-500"
              :checked="splitForm.selectedIds.includes(item.id)"
              @change="toggleSplitItem(item.id)"
            />
            <div class="flex-1 min-w-0">
              <div class="font-bold text-sm text-gray-800 truncate">
                {{ item.name }}
                <span v-if="item.item_type === 'combo'" class="chip bg-brand-100 text-brand-700 text-[10px] ml-1">套餐</span>
                <span v-if="item.sent" class="chip bg-emerald-100 text-emerald-700 text-[10px] ml-1">已送廚</span>
              </div>
              <div v-for="(line, i) in optionLines(item)" :key="i" class="text-xs text-gray-400 truncate">{{ line }}</div>
            </div>
            <div class="text-right shrink-0">
              <div class="font-extrabold text-sm text-brand-600">{{ fmtMoney(item.price * item.qty, catalog.currency) }}</div>
              <div class="text-xs text-gray-400">×{{ item.qty }}</div>
            </div>
          </label>
        </div>

        <div>
          <div class="label">分出至桌台（可不選，作為外帶/快餐）</div>
          <div class="flex flex-wrap gap-2">
            <button
              class="chip border transition"
              :class="splitForm.tableId === null ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-gray-500 border-gray-300'"
              @click="splitForm.tableId = null"
            >
              外帶 / 快餐
            </button>
            <button
              v-for="t in splitTargetTables"
              :key="t.id"
              class="chip border transition"
              :class="splitForm.tableId === t.id ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-gray-500 border-gray-300'"
              @click="splitForm.tableId = t.id"
            >
              🪑 {{ t.table_number }}
            </button>
          </div>
          <div v-if="!splitTargetTables.length" class="text-xs text-gray-400 mt-1">目前無空閒桌台</div>
        </div>

        <div class="bg-gray-50 rounded-xl px-4 py-3 flex justify-between items-center">
          <div>
            <div class="text-xs text-gray-400">已選 {{ splitForm.selectedIds.length }} 項</div>
            <div class="font-extrabold text-brand-600 text-lg">{{ fmtMoney(splitSelectedTotal, catalog.currency) }}</div>
          </div>
          <div class="text-xs text-gray-400">原單保留 {{ pos.items.length - splitForm.selectedIds.length }} 項</div>
        </div>
      </div>
      <template #footer>
        <button class="btn-ghost" @click="splitModal = false">取消</button>
        <button class="btn-primary" :disabled="!splitForm.selectedIds.length" @click="confirmSplit">確認分單</button>
      </template>
    </Modal>

    <!-- ============ 改價（數字鍵盤） ============ -->
    <Modal v-model="priceModal" title="改價" width="max-w-sm">
      <div class="space-y-3">
        <div class="bg-gray-50 rounded-xl px-4 py-3 space-y-1.5 text-sm">
          <div class="flex justify-between gap-3">
            <span class="text-gray-500 shrink-0">品項</span>
            <span class="font-extrabold text-right truncate">{{ pos.selectedItem?.name || '—' }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-500">目前單價</span>
            <span class="font-bold">{{ fmtMoney(pos.selectedItem?.price || 0, catalog.currency) }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-500">數量</span>
            <span class="font-bold">× {{ pos.selectedItem?.qty || 0 }}</span>
          </div>
        </div>

        <div class="rounded-xl bg-white border-2 border-brand-200 px-3 py-2 flex items-center justify-between gap-2">
          <span class="text-xs text-gray-400 shrink-0">新單價</span>
          <span class="font-extrabold text-2xl text-brand-700 tabular-nums truncate">
            {{ fmtMoney(Number(priceForm.price) || 0, catalog.currency) }}
          </span>
        </div>

        <div class="grid grid-cols-3 gap-2">
          <button
            v-for="key in NUM_PAD_KEYS"
            :key="key"
            type="button"
            class="h-12 rounded-xl border-2 border-gray-200 font-extrabold text-lg transition active:scale-95 hover:border-brand-300 hover:bg-brand-50"
            :class="key === 'C' || key === '⌫' ? 'text-gray-500' : 'text-gray-800'"
            @click="onPriceNumPad(key)"
          >
            {{ key }}
          </button>
        </div>

        <div class="text-sm text-gray-500 flex justify-between">
          <span>改價後小計</span>
          <span class="font-extrabold text-brand-600">
            {{ fmtMoney(Math.max(0, Number(priceForm.price) || 0) * (pos.selectedItem?.qty || 0), catalog.currency) }}
          </span>
        </div>
      </div>
      <template #footer>
        <button class="btn-ghost" @click="priceModal = false">取消</button>
        <button class="btn-primary" @click="applyPrice">確認改價</button>
      </template>
    </Modal>

    <!-- ============ 現金收現（數字鍵盤） ============ -->
    <Modal v-model="cashPayModal" title="現金收現" width="max-w-sm">
      <div class="space-y-3">
        <div class="bg-gray-50 rounded-xl px-4 py-3 space-y-1.5 text-sm">
          <div class="flex justify-between">
            <span class="text-gray-500">應收總額</span>
            <span class="font-extrabold text-brand-600 text-lg tabular-nums">{{ fmtMoney(pos.total, catalog.currency) }}</span>
          </div>
          <div class="flex justify-between" :class="cashShort ? 'text-red-500' : 'text-gray-500'">
            <span>找零</span>
            <span class="font-extrabold text-lg tabular-nums">{{ fmtMoney(pos.change, catalog.currency) }}</span>
          </div>
        </div>

        <div class="rounded-xl bg-white border-2 border-brand-200 px-3 py-2 flex items-center justify-between gap-2">
          <span class="text-xs text-gray-400 shrink-0">收現</span>
          <span class="font-extrabold text-2xl text-gray-900 tabular-nums truncate">
            {{ receivedDigits ? fmtMoney(Number(receivedDigits), catalog.currency) : fmtMoney(0, catalog.currency) }}
          </span>
        </div>

        <div class="grid grid-cols-3 gap-2">
          <button
            v-for="key in NUM_PAD_KEYS"
            :key="key"
            type="button"
            class="h-12 rounded-xl border-2 border-gray-200 font-extrabold text-lg transition active:scale-95 hover:border-brand-300 hover:bg-brand-50"
            :class="key === 'C' || key === '⌫' ? 'text-gray-500' : 'text-gray-800'"
            @click="onCashNumPad(key)"
          >
            {{ key }}
          </button>
        </div>

        <div class="grid grid-cols-4 gap-2">
          <button
            v-for="v in [100, 500, 1000]"
            :key="v"
            type="button"
            class="h-10 rounded-xl border-2 border-gray-200 text-sm font-bold text-gray-600 hover:border-brand-300 hover:bg-brand-50 active:scale-95"
            @click="addQuickAmount(v)"
          >
            +{{ v }}
          </button>
          <button
            type="button"
            class="h-10 rounded-xl border-2 border-gray-200 text-sm font-bold text-gray-600 hover:border-brand-300 hover:bg-brand-50 active:scale-95"
            @click="setExactAmount"
          >
            剛好
          </button>
        </div>
      </div>
      <template #footer>
        <button class="btn-ghost" @click="cashPayModal = false">取消</button>
        <button class="btn-primary" :disabled="Number(pos.received) < pos.total" @click="confirmCashPay">
          確認收款 {{ fmtMoney(pos.received || 0, catalog.currency) }}
        </button>
      </template>
    </Modal>

    <!-- ============ 結帳小票（顧客收銀單 / 廚房單） ============ -->
    <Modal v-model="receipt" title="結帳完成" width="max-w-sm">
      <template v-if="receipt">
        <div class="flex gap-2 mb-3">
          <button class="btn btn-sm flex-1" :class="receiptTab === 'customer' ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-600'" @click="receiptTab = 'customer'">顧客收銀單</button>
          <button class="btn btn-sm flex-1" :class="receiptTab === 'kitchen' ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-600'" @click="receiptTab = 'kitchen'">廚房單（後廚/水吧）</button>
        </div>

        <!-- 顧客收銀單 -->
        <div v-if="receiptTab === 'customer'">
          <div class="text-center space-y-1 pb-3 border-b border-dashed border-gray-200">
            <div class="font-extrabold text-lg">{{ catalog.settings.store_name }}</div>
            <div class="text-xs text-gray-400">{{ receipt.order_no }} · {{ receipt.created_at }}</div>
            <div v-if="receipt.table_number" class="text-xs text-gray-400">桌台 {{ receipt.table_number }}</div>
          </div>
          <div class="py-3 space-y-2 text-sm border-b border-dashed border-gray-200">
            <div v-for="it in receipt.items" :key="it.id">
              <div class="flex justify-between">
                <span class="truncate mr-2">{{ it.product_name }}<span v-if="it.spec">[{{ it.spec }}]</span> ×{{ it.quantity }}</span>
                <span class="shrink-0">{{ fmtMoney(it.price * it.quantity, catalog.currency) }}</span>
              </div>
              <div v-for="(line, i) in optionLines(it)" :key="i" class="text-xs text-gray-400 pl-2">{{ line }}</div>
              <div v-if="drinkSaving(it)" class="text-xs text-emerald-500 pl-2">飲品時段優惠：原價 {{ fmtMoney(drinkSaving(it).base, catalog.currency) }}，優惠 −{{ fmtMoney(drinkSaving(it).saved, catalog.currency) }}</div>
            </div>
          </div>
          <div class="py-3 space-y-1.5 text-sm">
            <div class="flex justify-between text-gray-500"><span>小計</span><span>{{ fmtMoney(receipt.total_amount, catalog.currency) }}</span></div>
            <div v-if="receipt.discount_amount" class="flex justify-between text-gray-500"><span>折扣</span><span>−{{ fmtMoney(receipt.discount_amount, catalog.currency) }}</span></div>
            <div v-if="receipt.service_fee" class="flex justify-between text-gray-500"><span>服務費</span><span>{{ fmtMoney(receipt.service_fee, catalog.currency) }}</span></div>
            <div class="flex justify-between font-extrabold"><span>實收</span><span class="text-brand-600">{{ fmtMoney(receipt.pay_amount, catalog.currency) }}</span></div>
            <div class="flex justify-between text-gray-500"><span>支付方式</span><span>{{ paymentMeta(receipt.payment_method).label }}</span></div>
            <div v-if="receipt.payment_method === 'cash'" class="flex justify-between text-gray-500">
              <span>收現 / 找零</span>
              <span>{{ fmtMoney(receipt.received_amount, catalog.currency) }} / {{ fmtMoney(receipt.change_amount, catalog.currency) }}</span>
            </div>
          </div>
          <div class="text-center text-xs text-gray-400 pt-2 border-t border-dashed border-gray-200">
            {{ catalog.settings.receipt_footer }}
          </div>
        </div>

        <!-- 廚房單 -->
        <div v-else>
          <div class="text-center space-y-1 pb-3 border-b border-dashed border-gray-200">
            <div class="font-extrabold">【廚房單】</div>
            <div class="text-xs text-gray-400">{{ receipt.order_no }}<span v-if="receipt.table_number"> · 桌台 {{ receipt.table_number }}</span> · {{ receipt.created_at }}</div>
          </div>
          <pre class="py-3 text-sm font-mono whitespace-pre-wrap leading-relaxed border-b border-dashed border-gray-200">{{ kitchenText }}</pre>
          <p class="text-xs text-gray-400 pt-2">實際硬體列印需在桌面殼（Tauri/Electron）接入 ESC/POS 印表機；此處為列印內容預覽。</p>
        </div>
      </template>
      <template #footer>
        <button class="btn-primary" @click="afterReceipt">完成</button>
      </template>
    </Modal>

    <!-- ============ 套餐嚮導 ============ -->
    <ComboWizard
      v-model="wizardProduct"
      :product="wizardProduct"
      :drinks="catalog.menu.drinks"
      :slot="nowSlot"
      :currency="catalog.currency"
      @add="onWizardAdd"
      @close="wizardProduct = null"
    />

    <!-- ============ 獨立飲品 ============ -->
    <DrinkModal
      v-model="drinkProduct"
      :product="drinkProduct"
      :slot="nowSlot"
      :currency="catalog.currency"
      @add="onDrinkAdd"
      @close="drinkProduct = null"
    />

    <!-- ============ 廚房單（下單送廚 / 補印） ============ -->
    <KitchenTicketModal v-model="ticketModal" :ticket="ticket" :currency="catalog.currency" />
  </div>
</template>

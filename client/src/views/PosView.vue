<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import { useAuthStore } from '../stores/auth';
import { useCatalogStore } from '../stores/catalog';
import { usePosStore } from '../stores/pos';
import { useToastStore } from '../stores/toast';
import Modal from '../components/Modal.vue';
import {
  fmtMoney, fmtTime, hexA, PAYMENT_META, ORDER_STATUS, QUICK_REMARKS, today,
} from '../utils/format';

const auth = useAuthStore();
const catalog = useCatalogStore();
const pos = usePosStore();
const toast = useToastStore();
const router = useRouter();

/* ---------------- 菜品區 ---------------- */
const activeCategory = ref('all');
const keyword = ref('');

const products = computed(() => {
  let list = catalog.availableProducts;
  if (activeCategory.value !== 'all') {
    list = list.filter((p) => p.category_id === activeCategory.value);
  }
  const kw = keyword.value.trim();
  if (kw) list = list.filter((p) => p.name.includes(kw));
  return list;
});

/* ---------------- 彈窗狀態 ---------------- */
const specModal = ref(false);
const specForm = ref({ product: null, qty: 1, spec: '', remark: '', editing: null });

const discountModal = ref(false);
const discountForm = ref({ mode: 'rate', rate: 95, amount: 0 });

const heldModal = ref(false);
const ordersModal = ref(false);
const todayOrders = ref([]);
const ordersDetail = ref(null);

const moveModal = ref(false);
const receipt = ref(null);
const voidModal = ref(false);

/* ---------------- 初始化 ---------------- */
onMounted(async () => {
  try {
    await catalog.loadAll();
    await pos.loadHeld();
  } catch (e) {
    toast.error(e.message);
  }
});

watch(() => pos.paymentMethod, (m) => {
  if (m !== 'cash') pos.setReceived(0);
});

/* ---------------- 加菜 ---------------- */
function onProduct(p) {
  if (Number(p.is_available) !== 1) {
    toast.error(`「${p.name}」已售罄`);
    return;
  }
  const specs = catalog.parseSpecs(p);
  if (specs.length) {
    specForm.value = { product: p, qty: 1, spec: specs[0].name, remark: '', editing: null };
    specModal.value = true;
  } else {
    pos.addProduct(p);
  }
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

/* ---------------- 掛單 / 取單 ---------------- */
async function holdOrder() {
  try {
    await pos.hold();
    await pos.loadHeld();
    toast.success('已掛單，可在「取單」恢復');
  } catch (e) {
    toast.error(e.message);
  }
}
async function resumeHeld(order) {
  try {
    await pos.resumeHeld(order);
    heldModal.value = false;
    toast.success('已取單');
  } catch (e) {
    toast.error(e.message);
  }
}

/* ---------------- 今日訂單 ---------------- */
async function openOrders() {
  try {
    todayOrders.value = await api.get(`/orders?date=${today()}&limit=100`);
    ordersDetail.value = null;
    ordersModal.value = true;
  } catch (e) {
    toast.error(e.message);
  }
}
async function showOrderDetail(o) {
  if (ordersDetail.value && ordersDetail.value.id === o.id) {
    ordersDetail.value = null;
    return;
  }
  try {
    ordersDetail.value = await api.get(`/orders/${o.id}`);
  } catch (e) {
    toast.error(e.message);
  }
}
async function continueOrder(o) {
  try {
    const full = await api.get(`/orders/${o.id}`);
    pos.bindOrder(full, o.table_number || '');
    ordersModal.value = false;
    toast.success(`已載入訂單 ${full.order_no}`);
  } catch (e) {
    toast.error(e.message);
  }
}
async function voidOrderRow(o) {
  if (!confirm(`確定作廢訂單 ${o.order_no}？此操作無法復原。`)) return;
  try {
    await api.post(`/orders/${o.id}/void`);
    todayOrders.value = await api.get(`/orders?date=${today()}&limit=100`);
    ordersDetail.value = null;
    toast.success('訂單已作廢');
  } catch (e) {
    toast.error(e.message);
  }
}
async function deleteHeldRow(o) {
  if (!confirm(`確定刪除掛單 ${o.order_no}？`)) return;
  try {
    await api.del(`/orders/${o.id}`);
    todayOrders.value = await api.get(`/orders?date=${today()}&limit=100`);
    await pos.loadHeld();
    toast.success('掛單已刪除');
  } catch (e) {
    toast.error(e.message);
  }
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

/* ---------------- 結帳 / 作廢 ---------------- */
async function checkout() {
  if (!pos.items.length) {
    toast.error('購物車為空');
    return;
  }
  if (pos.paymentMethod === 'cash' && pos.received < pos.total) {
    toast.error('收現金額不足');
    return;
  }
  try {
    receipt.value = await pos.checkout();
    await catalog.reloadTables();
    await pos.loadHeld();
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
}

function paymentMeta(m) {
  return PAYMENT_META[m] || { label: m, icon: '💰' };
}

const cashShort = computed(() => pos.paymentMethod === 'cash' && pos.received > 0 && pos.received < pos.total);
</script>

<template>
  <div class="h-full flex">
    <!-- 左：菜品展示區 -->
    <section class="flex-1 flex flex-col min-w-0">
      <!-- 工具列 -->
      <div class="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center gap-2 flex-wrap shrink-0">
        <span class="chip" :class="pos.isTableMode ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-600'">
          {{ pos.isTableMode ? `🪑 桌台 ${pos.tableNumber} · ${pos.orderNo}` : '🥡 快餐模式（未開台）' }}
        </span>
        <button class="btn-ghost btn-sm" @click="router.push('/tables')">桌台視圖</button>
        <button class="btn-ghost btn-sm" :disabled="!pos.items.length || pos.isTableMode" @click="holdOrder">掛單</button>
        <button class="btn-ghost btn-sm" @click="heldModal = true">取單（{{ pos.heldOrders.length }}）</button>
        <button class="btn-ghost btn-sm" @click="openOrders">今日訂單</button>
        <button v-if="pos.isTableMode" class="btn-ghost btn-sm" @click="moveModal = true">換桌</button>
        <button v-if="pos.isTableMode && auth.isManager" class="btn-ghost btn-sm !text-red-500" @click="voidModal = true">作廢</button>
        <div class="flex-1" />
        <span v-if="catalog.serviceRate > 0" class="chip bg-amber-100 text-amber-700">服務費 {{ catalog.serviceRate }}%</span>
      </div>

      <!-- 分類 -->
      <div class="bg-white border-b border-gray-200 px-4 py-2 flex gap-2 overflow-x-auto shrink-0">
        <button
          class="btn btn-sm shrink-0"
          :class="activeCategory === 'all' ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-600'"
          @click="activeCategory = 'all'"
        >
          全部
        </button>
        <button
          v-for="c in catalog.categories"
          :key="c.id"
          class="btn btn-sm shrink-0"
          :class="activeCategory === c.id ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-600'"
          @click="activeCategory = c.id"
        >
          {{ c.name }}（{{ c.product_count }}）
        </button>
        <div class="flex-1" />
        <input v-model="keyword" class="input !w-44 !py-1" placeholder="搜尋菜品…" />
      </div>

      <!-- 菜品網格 -->
      <div class="flex-1 overflow-y-auto p-4">
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-3">
          <button
            v-for="p in products"
            :key="p.id"
            class="relative rounded-2xl border-2 p-3 text-left transition active:scale-95 hover:shadow-md"
            :style="{
              borderColor: hexA(p.color, 0.35),
              background: hexA(p.color, 0.07),
            }"
            @click="onProduct(p)"
          >
            <div class="text-4xl text-center leading-none py-2">{{ p.emoji }}</div>
            <div class="mt-2 font-bold text-gray-800 truncate">{{ p.name }}</div>
            <div class="flex items-center justify-between mt-0.5">
              <span class="font-extrabold" :style="{ color: p.color }">{{ fmtMoney(p.price, catalog.currency) }}</span>
              <span v-if="p.specs" class="chip bg-white/70 text-gray-500 text-[10px]">規格</span>
            </div>
            <div v-if="Number(p.is_available) !== 1" class="absolute inset-0 bg-white/70 rounded-2xl flex items-center justify-center font-extrabold text-gray-400">
              售罄
            </div>
          </button>
        </div>
        <div v-if="!products.length" class="text-center text-gray-300 py-16">沒有符合的菜品</div>
      </div>
    </section>

    <!-- 右：購物車 / 結帳面板 -->
    <aside class="w-[380px] shrink-0 bg-white border-l border-gray-200 flex flex-col">
      <div class="px-4 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
        <span class="font-extrabold">購物車</span>
        <span class="chip bg-gray-100 text-gray-500">{{ pos.count }} 件</span>
      </div>

      <!-- 明細 -->
      <div class="flex-1 overflow-y-auto">
        <div v-if="!pos.items.length" class="h-full flex flex-col items-center justify-center text-gray-300 gap-2 py-10">
          <div class="text-5xl">🛒</div>
          <div class="text-sm">購物車空空，快來點餐吧</div>
        </div>
        <div
          v-for="item in pos.items"
          :key="item.id"
          class="px-4 py-3 border-b border-gray-50 flex gap-3 items-start"
        >
          <div class="flex-1 min-w-0">
            <div class="font-bold text-sm text-gray-800 truncate">{{ item.name }}</div>
            <div v-if="item.spec || item.remark" class="text-xs text-gray-400 mt-0.5 truncate">
              <span v-if="item.spec">[{{ item.spec }}]</span> {{ item.remark }}
            </div>
            <div class="text-brand-600 font-extrabold text-sm mt-1">
              {{ fmtMoney(item.price * item.qty, catalog.currency) }}
              <span class="text-gray-400 font-normal">{{ fmtMoney(item.price, catalog.currency) }} × {{ item.qty }}</span>
            </div>
          </div>
          <div class="flex flex-col items-end gap-1.5">
            <div class="flex items-center gap-1">
              <button class="w-7 h-7 rounded-lg bg-gray-100 font-bold text-gray-600 hover:bg-gray-200" @click="pos.setQty(item, item.qty - 1)">−</button>
              <span class="w-7 text-center font-bold">{{ item.qty }}</span>
              <button class="w-7 h-7 rounded-lg bg-brand-100 font-bold text-brand-600 hover:bg-brand-200" @click="pos.setQty(item, item.qty + 1)">＋</button>
            </div>
            <div class="flex gap-2 text-xs">
              <button class="text-gray-400 hover:text-brand-500" @click="editItem(item)">備註</button>
              <button class="text-gray-400 hover:text-red-500" @click="pos.removeItem(item)">退菜</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 金額匯總 -->
      <div class="border-t border-gray-100 px-4 py-3 space-y-1.5 text-sm shrink-0">
        <div class="flex justify-between text-gray-500">
          <span>小計</span>
          <span>{{ fmtMoney(pos.subtotal, catalog.currency) }}</span>
        </div>
        <button class="flex justify-between w-full text-gray-500 hover:text-brand-500" @click="openDiscount">
          <span>折扣{{ pos.discountLabel ? `（${pos.discountLabel}）` : '' }}</span>
          <span :class="pos.discount > 0 ? 'text-red-500 font-bold' : ''">−{{ fmtMoney(pos.discount, catalog.currency) }}</span>
        </button>
        <div v-if="catalog.serviceRate > 0" class="flex justify-between text-gray-500">
          <span>服務費（{{ catalog.serviceRate }}%）</span>
          <span>{{ fmtMoney(pos.serviceFee, catalog.currency) }}</span>
        </div>
        <div class="flex justify-between items-end pt-1">
          <span class="font-extrabold">應收總額</span>
          <span class="text-2xl font-extrabold text-brand-600">{{ fmtMoney(pos.total, catalog.currency) }}</span>
        </div>
      </div>

      <!-- 支付方式 -->
      <div class="border-t border-gray-100 px-4 py-3 shrink-0">
        <div class="grid grid-cols-4 gap-2">
          <button
            v-for="pm in catalog.enabledPayments"
            :key="pm.id"
            class="rounded-xl border-2 py-2 text-center transition active:scale-95"
            :class="pos.paymentMethod === pm.code ? 'border-brand-500 bg-brand-50' : 'border-gray-200'"
            @click="pos.setPayment(pm.code)"
          >
            <div class="text-xl">{{ paymentMeta(pm.code).icon }}</div>
            <div class="text-xs font-bold mt-0.5">{{ pm.name }}</div>
            <div v-if="Number(pm.fee_rate) > 0" class="text-[10px] text-gray-400">費率{{ (pm.fee_rate * 100).toFixed(1) }}%</div>
          </button>
        </div>

        <!-- 現金找零 -->
        <div v-if="pos.paymentMethod === 'cash'" class="mt-3 space-y-2">
          <div class="flex gap-2">
            <input
              :value="pos.received || ''"
              type="number"
              min="0"
              class="input"
              placeholder="收現金額"
              @input="pos.setReceived(Number($event.target.value) || 0)"
              @keyup.enter="checkout"
            />
            <button
              v-for="v in [100, 500, 1000]"
              :key="v"
              class="btn-ghost btn-sm shrink-0"
              @click="pos.setReceived(Number(pos.received || 0) + v)"
            >
              +{{ v }}
            </button>
            <button class="btn-ghost btn-sm shrink-0" @click="pos.setReceived(pos.total)">剛好</button>
          </div>
          <div class="flex justify-between text-sm" :class="cashShort ? 'text-red-500' : 'text-gray-500'">
            <span>找零</span>
            <span class="font-extrabold text-lg">{{ fmtMoney(pos.change, catalog.currency) }}</span>
          </div>
        </div>
      </div>

      <!-- 結帳 -->
      <div class="p-4 border-t border-gray-100 shrink-0">
        <button class="btn-primary w-full py-3.5 text-lg" :disabled="!pos.items.length" @click="checkout">
          結帳 {{ fmtMoney(pos.total, catalog.currency) }}
        </button>
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

    <!-- ============ 掛單列表 ============ -->
    <Modal v-model="heldModal" title="掛單 / 取單" width="max-w-md">
      <div v-if="!pos.heldOrders.length" class="text-center text-gray-300 py-8">目前沒有掛單</div>
      <div v-else class="space-y-2">
        <div
          v-for="o in pos.heldOrders"
          :key="o.id"
          class="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3"
        >
          <div class="flex-1">
            <div class="font-bold text-sm">{{ o.order_no }}</div>
            <div class="text-xs text-gray-400">{{ fmtTime(o.created_at) }} · {{ o.item_count }} 件 · {{ fmtMoney(o.total_amount, catalog.currency) }}</div>
          </div>
          <button class="btn-primary btn-sm" @click="resumeHeld(o)">取單</button>
          <button class="btn-ghost btn-sm !text-red-500" @click="api.del(`/orders/${o.id}`).then(() => { pos.loadHeld(); toast.success('掛單已刪除'); }).catch((e) => toast.error(e.message))">刪除</button>
        </div>
      </div>
    </Modal>

    <!-- ============ 今日訂單 ============ -->
    <Modal v-model="ordersModal" title="今日訂單" width="max-w-2xl">
      <div class="space-y-2">
        <div
          v-for="o in todayOrders"
          :key="o.id"
          class="rounded-xl border border-gray-200 overflow-hidden"
        >
          <button class="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left" @click="showOrderDetail(o)">
            <span class="chip" :class="ORDER_STATUS[o.status]?.cls">{{ ORDER_STATUS[o.status]?.label }}</span>
            <span class="font-bold text-sm">{{ o.order_no }}</span>
            <span class="text-xs text-gray-400">{{ fmtTime(o.created_at) }}</span>
            <span class="text-xs text-gray-400">{{ o.table_number ? `桌台 ${o.table_number}` : '快餐' }}</span>
            <div class="flex-1" />
            <span class="font-extrabold text-brand-600">{{ fmtMoney(o.pay_amount || o.total_amount, catalog.currency) }}</span>
          </button>
          <div v-if="ordersDetail && ordersDetail.id === o.id" class="border-t border-gray-100 bg-gray-50 px-4 py-3 space-y-2">
            <div v-for="it in ordersDetail.items" :key="it.id" class="flex justify-between text-sm">
              <span>{{ it.product_name }}<span v-if="it.spec">[{{ it.spec }}]</span> ×{{ it.quantity }}<span v-if="it.remark" class="text-gray-400">（{{ it.remark }}）</span></span>
              <span class="text-gray-500">{{ fmtMoney(it.price * it.quantity, catalog.currency) }}</span>
            </div>
            <div class="flex justify-between text-sm pt-1 border-t border-gray-200">
              <span class="text-gray-500">支付：{{ paymentMeta(ordersDetail.payment_method).label || '—' }}</span>
              <span class="font-bold">合計 {{ fmtMoney(ordersDetail.pay_amount || ordersDetail.total_amount, catalog.currency) }}</span>
            </div>
            <div class="flex gap-2 pt-1">
              <button v-if="o.status === 'open' && o.table_id" class="btn-primary btn-sm" @click="continueOrder(o)">繼續點餐</button>
              <button v-if="o.status === 'open'" class="btn-ghost btn-sm !text-red-500" @click="voidOrderRow(o)">作廢</button>
              <button v-if="o.status === 'held'" class="btn-ghost btn-sm !text-red-500" @click="deleteHeldRow(o)">刪除掛單</button>
            </div>
          </div>
        </div>
        <div v-if="!todayOrders.length" class="text-center text-gray-300 py-8">今日尚無訂單</div>
      </div>
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

    <!-- ============ 結帳小票 ============ -->
    <Modal v-model="receipt" title="結帳完成" width="max-w-sm">
      <template v-if="receipt">
        <div class="text-center space-y-1 pb-3 border-b border-dashed border-gray-200">
          <div class="font-extrabold text-lg">{{ catalog.settings.store_name }}</div>
          <div class="text-xs text-gray-400">{{ receipt.order_no }} · {{ receipt.created_at }}</div>
          <div v-if="receipt.table_number" class="text-xs text-gray-400">桌台 {{ receipt.table_number }}</div>
        </div>
        <div class="py-3 space-y-1.5 text-sm border-b border-dashed border-gray-200">
          <div v-for="it in receipt.items" :key="it.id" class="flex justify-between">
            <span class="truncate mr-2">{{ it.product_name }}<span v-if="it.spec">[{{ it.spec }}]</span> ×{{ it.quantity }}</span>
            <span class="shrink-0">{{ fmtMoney(it.price * it.quantity, catalog.currency) }}</span>
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
      </template>
      <template #footer>
        <button class="btn-primary" @click="afterReceipt">完成</button>
      </template>
    </Modal>
  </div>
</template>

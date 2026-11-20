<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@shared/api';
import { useAuthStore } from '@shared/stores/auth';
import { useCatalogStore } from '@shared/stores/catalog';
import { useShiftStore } from '@shared/stores/shift';
import { useToastStore } from '@shared/stores/toast';
import { usePosStore } from '../stores/pos';
import Modal from '@shared/components/Modal.vue';
import { fmtMoney, fmtTime, PAYMENT_META, ORDER_STATUS, today } from '@shared/utils/format';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const catalog = useCatalogStore();
const shift = useShiftStore();
const toast = useToastStore();
const pos = usePosStore();

/** 前台收银只保留收银台与桌台视图 */
const navFront = [
  { path: '/pos', title: '收銀台', icon: '🧾' },
  { path: '/tables', title: '桌台視圖', icon: '🪑' },
];

const shiftModal = ref(false);
const closing = ref(false);

/* ---------------- 今日訂單 ---------------- */
const ordersModal = ref(false);
const todayOrders = ref([]);
const ordersDetail = ref(null);
const refundModal = ref(false);
const refundTarget = ref(null);
const refundReason = ref('');

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
    router.push('/pos');
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
function openRefund(o) {
  refundTarget.value = o;
  refundReason.value = '';
  refundModal.value = true;
}
async function confirmRefund() {
  if (!refundTarget.value) return;
  try {
    const res = await api.post(`/orders/${refundTarget.value.id}/refund`, { reason: refundReason.value });
    refundModal.value = false;
    todayOrders.value = await api.get(`/orders?date=${today()}&limit=100`);
    ordersDetail.value = null;
    toast.success(`已退款 ${fmtMoney(res.refunded_amount, catalog.currency)}`);
  } catch (e) {
    toast.error(e.message);
  }
}

function paymentMeta(m) {
  return PAYMENT_META[m] || { label: m, icon: '💰' };
}

/** 套餐選項明細文字 */
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

onMounted(async () => {
  try {
    await catalog.loadAll();
  } catch (e) {
    toast.error(e.message);
  }
  try {
    await shift.loadCurrent();
  } catch { /* 未登入時忽略 */ }
});

function logout() {
  auth.logout();
  router.push('/login');
}
async function openShift() {
  try {
    await shift.open();
  } catch (e) {
    toast.error(e.message);
  }
}
async function closeShift() {
  closing.value = true;
  try {
    const rec = await shift.close();
    shiftModal.value = false;
    toast.success(`結班完成，營業額 ${fmtMoney(rec.total_sales, catalog.currency)}`);
  } catch (e) {
    toast.error(e.message);
  } finally {
    closing.value = false;
  }
}

const pageTitle = computed(() => route.meta.title || '');
</script>

<template>
  <div class="h-full flex bg-gray-100">
    <!-- 側邊欄：≤1280（含 4:3 POS）收成圖示欄，寬螢幕還原完整標籤 -->
    <aside class="w-[4.5rem] xl:w-60 shrink-0 bg-gray-900 text-gray-300 flex flex-col">
      <div class="px-2 py-4 xl:px-5 xl:py-5 border-b border-gray-800 text-center xl:text-left">
        <div class="ico-lg mx-auto xl:mx-0">🍽️</div>
        <div class="mt-1 font-extrabold text-white leading-tight hidden xl:block truncate" :title="catalog.storeName">{{ catalog.storeName }}</div>
        <div class="text-[11px] text-gray-500 hidden xl:block">前台收銀</div>
      </div>

      <nav class="flex-1 overflow-y-auto overflow-x-hidden py-3 xl:py-4">
        <div class="px-4 mb-1 text-[11px] font-bold text-gray-500 uppercase tracking-wider hidden xl:block">前台</div>
        <router-link
          v-for="n in navFront"
          :key="n.path"
          :to="n.path"
          :title="n.title"
          class="flex items-center justify-center xl:justify-start gap-3 mx-1.5 xl:mx-2 px-2 xl:px-3 py-2.5 rounded-lg text-sm font-bold transition"
          :class="route.path.startsWith(n.path) ? 'bg-brand-500 text-white' : 'hover:bg-gray-800'"
        >
          <span class="ico">{{ n.icon }}</span>
          <span class="hidden xl:inline">{{ n.title }}</span>
        </router-link>
        <button
          title="今日訂單"
          class="flex items-center justify-center xl:justify-start gap-3 mx-1.5 xl:mx-2 px-2 xl:px-3 py-2.5 rounded-lg text-sm font-bold transition hover:bg-gray-800 text-left w-[calc(100%-0.75rem)] xl:w-auto"
          @click="openOrders"
        >
          <span class="ico">📋</span>
          <span class="hidden xl:inline">今日訂單</span>
        </button>
      </nav>

    </aside>

    <!-- 主區 -->
    <div class="flex-1 flex flex-col min-w-0 min-h-0">
      <header class="h-12 xl:h-14 bg-white border-b border-gray-200 flex items-center px-3 xl:px-5 gap-2 xl:gap-3 shrink-0">
        <h1 class="text-base xl:text-lg font-extrabold truncate">{{ pageTitle }}</h1>
        <div class="flex-1" />
        <button
          class="btn-ghost btn-sm shrink-0"
          :class="shift.current ? '!border-emerald-300 !text-emerald-600' : ''"
          @click="shiftModal = true"
        >
          <span class="w-2 h-2 rounded-full" :class="shift.current ? 'bg-emerald-500' : 'bg-gray-300'" />
          <span class="hidden sm:inline">{{ shift.current ? `交接班中 ${fmtTime(shift.current.start_time)}` : '未開始交接班' }}</span>
          <span class="sm:hidden">{{ shift.current ? '交班中' : '未交班' }}</span>
        </button>
        <div class="chip bg-gray-100 text-gray-600 shrink-0 max-w-[9rem] xl:max-w-none truncate">
          {{ auth.user?.name }}<span class="hidden md:inline">（{{ auth.user?.role === 'manager' ? '店長' : '收銀員' }}）</span>
        </div>
        <button class="btn-ghost btn-sm shrink-0" @click="logout">登出</button>
      </header>

      <main class="flex-1 overflow-hidden min-h-0">
        <router-view />
      </main>
    </div>

    <!-- 交接班彈窗 -->
    <Modal v-model="shiftModal" title="交接班" width="max-w-md">
      <template v-if="shift.current">
        <div class="text-sm text-gray-600 space-y-2">
          <p>本班開始時間：<b class="text-gray-800">{{ shift.current.start_time }}</b></p>
          <p class="text-gray-400 text-xs">結班後將自動統計本班營業額、現金收款與訂單數，並生成交接班報表。</p>
        </div>
      </template>
      <template v-else>
        <p class="text-sm text-gray-600">開始新班別後，本班的訂單將歸入此交接班記錄，方便日後對帳。</p>
      </template>
      <template #footer>
        <button v-if="!shift.current" class="btn-primary" @click="openShift">開始交接班</button>
        <button v-else class="btn-danger" :disabled="closing" @click="closeShift">
          {{ closing ? '結班中…' : '結束本班並結班' }}
        </button>
      </template>
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
            <div v-for="it in ordersDetail.items" :key="it.id" class="text-sm">
              <div class="flex justify-between">
                <span>{{ it.product_name }}<span v-if="it.spec">[{{ it.spec }}]</span> ×{{ it.quantity }}<span v-if="it.remark" class="text-gray-400">（{{ it.remark }}）</span></span>
                <span class="text-gray-500">{{ fmtMoney(it.price * it.quantity, catalog.currency) }}</span>
              </div>
              <div v-for="(line, i) in optionLines(it)" :key="i" class="text-xs text-gray-400 pl-2">{{ line }}</div>
            </div>
            <div class="flex justify-between text-sm pt-1 border-t border-gray-200">
              <span class="text-gray-500">支付：{{ paymentMeta(ordersDetail.payment_method).label || '—' }}</span>
              <span class="font-bold">合計 {{ fmtMoney(ordersDetail.pay_amount || ordersDetail.total_amount, catalog.currency) }}</span>
            </div>
            <div v-if="ordersDetail.refunded_at" class="text-xs text-orange-500 bg-orange-50 rounded-lg px-3 py-2">
              已退款 {{ fmtTime(ordersDetail.refunded_at) }}{{ ordersDetail.refund_reason ? ` · ${ordersDetail.refund_reason}` : '' }}
            </div>
            <div class="flex gap-2 pt-1">
              <button v-if="o.status === 'open' && o.table_id" class="btn-primary btn-sm" @click="continueOrder(o)">繼續點餐</button>
              <button v-if="o.status === 'open'" class="btn-ghost btn-sm !text-red-500" @click="voidOrderRow(o)">作廢</button>
              <button v-if="o.status === 'completed' && auth.isManager" class="btn-ghost btn-sm !text-orange-500" @click="openRefund(o)">退款</button>
            </div>
          </div>
        </div>
        <div v-if="!todayOrders.length" class="text-center text-gray-300 py-8">今日尚無訂單</div>
      </div>
    </Modal>

    <!-- ============ 退款確認 ============ -->
    <Modal v-model="refundModal" title="退款確認" width="max-w-sm">
      <div class="space-y-3">
        <p class="text-sm text-gray-600">
          確定對訂單 <b>{{ refundTarget?.order_no }}</b> 進行退款？
          退款金額 <b class="text-orange-600">{{ fmtMoney(refundTarget?.pay_amount || 0, catalog.currency) }}</b>。
        </p>
        <div>
          <div class="label">退款原因（選填）</div>
          <input v-model="refundReason" class="input" placeholder="如：菜品品質問題、重複結帳…" />
        </div>
      </div>
      <template #footer>
        <button class="btn-ghost" @click="refundModal = false">取消</button>
        <button class="btn-danger" @click="confirmRefund">確認退款</button>
      </template>
    </Modal>
  </div>
</template>

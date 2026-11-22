<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@shared/stores/auth';
import { useCatalogStore } from '@shared/stores/catalog';
import { useBusinessDayStore } from '@shared/stores/businessDay';
import { useToastStore } from '@shared/stores/toast';
import Modal from '@shared/components/Modal.vue';
import { fmtMoney, today } from '@shared/utils/format';
import { usePosStore } from '../stores/pos';

const router = useRouter();
const auth = useAuthStore();
const catalog = useCatalogStore();
const businessDay = useBusinessDayStore();
const toast = useToastStore();
const pos = usePosStore();

const openModal = ref(false);
const opening = ref(false);
const openDate = ref(today());
const cashDigits = ref('');
const openingCash = ref(0);

/** 營業日 ≠ 今天：確認是否繼續 */
const dateMismatchModal = ref(false);
/** 今日已日結：撤銷或返回 */
const closedTodayModal = ref(false);
const closedDay = ref(null);
const reopening = ref(false);

const NUM_PAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];

onMounted(() => {
  catalog.loadAll().catch(() => {});
  businessDay.loadCurrent().catch(() => {});
});

function applyNumPad(key) {
  let d = cashDigits.value;
  if (key === 'C') d = '';
  else if (key === '⌫') d = d.slice(0, -1);
  else if (d.length < 8) d = d === '0' ? key : `${d}${key}`;
  cashDigits.value = d;
  openingCash.value = Number(d) || 0;
}

/** 進入前台：一律先到桌台視圖，不帶入既有桌台／購物車 */
function enterPos() {
  pos.reset();
  router.push('/tables');
}

function showOpenModal() {
  openDate.value = today();
  cashDigits.value = '';
  openingCash.value = 0;
  openModal.value = true;
}

async function goPos() {
  try {
    await businessDay.loadCurrent();
  } catch (e) {
    toast.error(e.message);
    return;
  }

  // 1) 已開市：營業日與今天不同 → 確認後再進
  if (businessDay.current) {
    const bd = businessDay.current.business_date;
    if (bd && bd !== today()) {
      dateMismatchModal.value = true;
      return;
    }
    enterPos();
    return;
  }

  // 2) 未開市：最近一筆已日結且營業日=今天 → 通知已日結
  try {
    const latest = await businessDay.loadLatest();
    if (latest && latest.status === 'closed' && latest.business_date === today()) {
      closedDay.value = latest;
      closedTodayModal.value = true;
      return;
    }
  } catch (e) {
    toast.error(e.message);
    return;
  }

  showOpenModal();
}

function confirmDateMismatch() {
  dateMismatchModal.value = false;
  enterPos();
}

async function voidDayEnd() {
  if (!closedDay.value?.id) return;
  reopening.value = true;
  try {
    await businessDay.reopen(closedDay.value.id);
    closedTodayModal.value = false;
    closedDay.value = null;
    enterPos();
  } catch (e) {
    toast.error(e.message);
  } finally {
    reopening.value = false;
  }
}

async function confirmOpen() {
  opening.value = true;
  try {
    await businessDay.open({
      opening_cash: openingCash.value,
      business_date: openDate.value || today(),
    });
    openModal.value = false;
    enterPos();
  } catch (e) {
    toast.error(e.message);
  } finally {
    opening.value = false;
  }
}

function goAdmin() {
  router.push('/admin/reports');
}

function logout() {
  auth.logout();
  router.push('/login');
}
</script>

<template>
  <div class="h-full flex flex-col items-center justify-center bg-gradient-to-br from-brand-500 via-brand-600 to-amber-700 p-6">
    <div class="w-full max-w-2xl text-center mb-10">
      <div class="text-6xl">🍽️</div>
      <h1 class="mt-3 text-3xl font-extrabold text-white">{{ catalog.storeName || '本地 POS' }}</h1>
      <p class="mt-2 text-brand-100 text-sm">
        {{ auth.user?.name }}（{{ auth.user?.role === 'manager' ? '店長' : '收銀員' }}）· 選擇要進入的功能
      </p>
      <p v-if="businessDay.current" class="mt-2 text-xs text-white/80">
        營業日 {{ businessDay.current.business_date }} · 開市現金 {{ fmtMoney(businessDay.current.opening_cash, catalog.currency) }}
      </p>
    </div>

    <div class="w-full max-w-2xl grid gap-4" :class="auth.isManager ? 'sm:grid-cols-2' : 'sm:grid-cols-1 max-w-md'">
      <button
        type="button"
        class="bg-white rounded-2xl shadow-xl p-8 text-left hover:scale-[1.02] transition focus:outline-none focus:ring-4 focus:ring-white/40"
        @click="goPos"
      >
        <div class="text-4xl">🧾</div>
        <div class="mt-3 text-xl font-extrabold text-gray-900">收銀台</div>
        <p class="mt-1 text-sm text-gray-500">點餐、結帳、桌台與今日訂單</p>
      </button>

      <button
        v-if="auth.isManager"
        type="button"
        class="bg-white rounded-2xl shadow-xl p-8 text-left hover:scale-[1.02] transition focus:outline-none focus:ring-4 focus:ring-white/40"
        @click="goAdmin"
      >
        <div class="text-4xl">⚙️</div>
        <div class="mt-3 text-xl font-extrabold text-gray-900">後台管理</div>
        <p class="mt-1 text-sm text-gray-500">報表、菜品、桌台、員工與系統設定</p>
      </button>
    </div>

    <button type="button" class="mt-10 text-sm font-bold text-brand-100 hover:text-white transition" @click="logout">
      登出
    </button>

    <!-- 開市 -->
    <Modal v-model="openModal" title="開市 · 開啟營業日" width="max-w-sm">
      <div class="space-y-3">
        <p class="text-sm text-gray-500">進入收銀台前請先開市，並輸入錢箱開市現金金額。</p>
        <div>
          <div class="label">營業日</div>
          <input v-model="openDate" type="date" class="input" />
        </div>
        <div class="rounded-xl bg-white border-2 border-brand-200 px-3 py-2 flex items-center justify-between gap-2">
          <span class="text-xs text-gray-400 shrink-0">開市現金</span>
          <span class="font-extrabold text-2xl text-brand-700 tabular-nums truncate">
            {{ fmtMoney(openingCash, catalog.currency) }}
          </span>
        </div>
        <div class="grid grid-cols-3 gap-2">
          <button
            v-for="key in NUM_PAD_KEYS"
            :key="key"
            type="button"
            class="h-12 rounded-xl border-2 border-gray-200 font-extrabold text-lg transition active:scale-95 hover:border-brand-300 hover:bg-brand-50"
            :class="key === 'C' || key === '⌫' ? 'text-gray-500' : 'text-gray-800'"
            @click="applyNumPad(key)"
          >
            {{ key }}
          </button>
        </div>
      </div>
      <template #footer>
        <button class="btn-ghost" :disabled="opening" @click="openModal = false">取消</button>
        <button class="btn-primary" :disabled="opening" @click="confirmOpen">
          {{ opening ? '開市中…' : '確認開市' }}
        </button>
      </template>
    </Modal>

    <!-- 營業日與今天不同 -->
    <Modal v-model="dateMismatchModal" title="營業日與今天不同" width="max-w-sm">
      <p class="text-sm text-gray-600">
        目前開市營業日為
        <b class="text-brand-700">{{ businessDay.current?.business_date }}</b>，
        今天是 <b>{{ today() }}</b>。
        是否仍要繼續進入收銀台？
      </p>
      <template #footer>
        <button class="btn-ghost" @click="dateMismatchModal = false">取消</button>
        <button class="btn-primary" @click="confirmDateMismatch">繼續進入</button>
      </template>
    </Modal>

    <!-- 今日已日結 -->
    <Modal v-model="closedTodayModal" title="營業日已日結" width="max-w-sm">
      <p class="text-sm text-gray-600">
        營業日 <b class="text-brand-700">{{ closedDay?.business_date }}</b> 已完成日結
        <span v-if="closedDay?.end_time">（{{ closedDay.end_time }}）</span>。
        若需繼續收銀，可撤銷日結並重新開啟本日。
      </p>
      <template #footer>
        <button class="btn-ghost" :disabled="reopening" @click="closedTodayModal = false">Back</button>
        <button class="btn-primary" :disabled="reopening" @click="voidDayEnd">
          {{ reopening ? '處理中…' : 'Void Day End' }}
        </button>
      </template>
    </Modal>
  </div>
</template>

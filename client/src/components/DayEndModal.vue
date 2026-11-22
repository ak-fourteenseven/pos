<script setup>
import { computed, ref, watch } from 'vue';
import Modal from '@shared/components/Modal.vue';
import { useBusinessDayStore } from '@shared/stores/businessDay';
import { useCatalogStore } from '@shared/stores/catalog';
import { useToastStore } from '@shared/stores/toast';
import { fmtMoney, PAYMENT_META } from '@shared/utils/format';

const emit = defineEmits(['done']);

const businessDay = useBusinessDayStore();
const catalog = useCatalogStore();
const toast = useToastStore();

const visible = ref(false);
const summary = ref(null);
const ending = ref(false);
const cashDigits = ref('');
const countedCash = ref(0);
/** confirm = 對帳輸入；done = 日結完成（返回 / 列印） */
const phase = ref('confirm');

const NUM_PAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];

const expectedCash = computed(() => {
  const s = summary.value;
  if (!s) return 0;
  if (s.expected_cash != null) return Number(s.expected_cash) || 0;
  return (Number(s.opening_cash) || 0) + (Number(s.cash_amount) || 0);
});

const cashMatch = computed(() => {
  if (!cashDigits.value.length) return null;
  return Number(countedCash.value) === Number(expectedCash.value);
});

function payLabel(code) {
  return PAYMENT_META[code]?.label || code || '—';
}

function applyNumPad(key) {
  let d = cashDigits.value;
  if (key === 'C') d = '';
  else if (key === '⌫') d = d.slice(0, -1);
  else if (d.length < 8) d = d === '0' ? key : `${d}${key}`;
  cashDigits.value = d;
  countedCash.value = Number(d) || 0;
}

async function open() {
  if (!businessDay.current) {
    toast.error('尚未開市，無法日結');
    return;
  }
  try {
    summary.value = await businessDay.loadSummary();
    cashDigits.value = '';
    countedCash.value = 0;
    phase.value = 'confirm';
    visible.value = true;
  } catch (e) {
    toast.error(e.message);
  }
}

async function confirm() {
  if (!cashDigits.value.length) {
    toast.error('請輸入錢箱實點現金');
    return;
  }
  ending.value = true;
  try {
    await businessDay.close({ counted_cash: countedCash.value });
    phase.value = 'done';
  } catch (e) {
    toast.error(e.message);
  } finally {
    ending.value = false;
  }
}

function goBack() {
  visible.value = false;
}

function onPrint() {
  /* 列印日結單：稍後實作 */
}

/** 日結完成後關閉視窗（含 ✕／遮罩）也要觸發離開流程 */
watch(visible, (v, prev) => {
  if (prev && !v && phase.value === 'done') emit('done');
});

defineExpose({ open });
</script>

<template>
  <Modal v-model="visible" title="日結" width="max-w-3xl">
    <div v-if="summary" class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <!-- 左：營業摘要 -->
      <div class="space-y-3 min-w-0">
        <div class="bg-gray-50 rounded-xl px-4 py-3 text-sm space-y-1.5">
          <div class="flex justify-between gap-2">
            <span class="text-gray-500 shrink-0">營業日</span>
            <span class="font-extrabold text-right">{{ summary.business_date }}</span>
          </div>
          <div class="flex justify-between gap-2">
            <span class="text-gray-500 shrink-0">開市時間</span>
            <span class="font-bold text-right">{{ summary.start_time }}</span>
          </div>
          <div class="flex justify-between gap-2 border-t border-gray-200 pt-1.5">
            <span class="text-gray-500">訂單數</span>
            <span class="font-bold">{{ summary.order_count }}</span>
          </div>
          <div class="flex justify-between gap-2">
            <span class="text-gray-500">總營業額</span>
            <span class="font-extrabold text-brand-600 text-lg">{{ fmtMoney(summary.total_sales, catalog.currency) }}</span>
          </div>
        </div>

        <div>
          <div class="text-xs font-bold text-gray-400 mb-2">按支付方式</div>
          <div class="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
            <div
              v-for="p in summary.by_payment"
              :key="p.payment_method"
              class="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-sm"
            >
              <span class="font-bold">{{ payLabel(p.payment_method) }}
                <span class="text-gray-400 font-normal text-xs ml-1">×{{ p.order_count }}</span>
              </span>
              <span class="font-extrabold">{{ fmtMoney(p.amount, catalog.currency) }}</span>
            </div>
            <div v-if="!(summary.by_payment || []).length" class="text-center text-gray-300 py-4 text-sm">
              本日尚無已結帳訂單
            </div>
          </div>
        </div>

        <p v-if="phase === 'confirm'" class="text-xs text-gray-400">確認日結後將關閉本日營業日，需重新開市才能繼續收銀。</p>
        <p v-else class="text-sm font-bold text-emerald-600">日結完成 · 可列印日結單後返回</p>
      </div>

      <!-- 右：錢箱對帳 + 數字鍵盤 -->
      <div class="rounded-xl border border-gray-200 p-3 space-y-2 min-w-0">
        <div class="text-xs font-bold text-gray-400">錢箱對帳</div>
        <div class="flex justify-between text-sm">
          <span class="text-gray-500">開市現金</span>
          <span class="font-bold">{{ fmtMoney(summary.opening_cash, catalog.currency) }}</span>
        </div>
        <div class="flex justify-between text-sm">
          <span class="text-gray-500">現金收款</span>
          <span class="font-bold">{{ fmtMoney(summary.cash_amount, catalog.currency) }}</span>
        </div>
        <div class="flex justify-between text-sm border-t border-gray-100 pt-1.5">
          <span class="text-gray-500">應有現金</span>
          <span class="font-extrabold text-brand-700">{{ fmtMoney(expectedCash, catalog.currency) }}</span>
        </div>

        <div
          class="rounded-xl bg-white border-2 px-3 py-2 flex items-center justify-between gap-2"
          :class="cashMatch === null
            ? 'border-brand-200'
            : cashMatch
              ? 'border-emerald-400'
              : 'border-red-400'"
        >
          <span class="text-xs text-gray-400 shrink-0">實點現金</span>
          <div class="flex items-center gap-2 min-w-0">
            <span
              class="font-extrabold text-2xl tabular-nums truncate"
              :class="cashMatch === null
                ? 'text-brand-700'
                : cashMatch
                  ? 'text-emerald-700'
                  : 'text-red-600'"
            >
              {{ fmtMoney(countedCash, catalog.currency) }}
            </span>
            <span
              v-if="cashMatch !== null"
              class="text-xl font-extrabold shrink-0"
              :class="cashMatch ? 'text-emerald-600' : 'text-red-500'"
              :title="cashMatch ? '與應有現金相符' : '與應有現金不符'"
            >
              {{ cashMatch ? '✓' : '✗' }}
            </span>
          </div>
        </div>

        <div v-if="phase === 'confirm'" class="grid grid-cols-3 gap-2">
          <button
            v-for="key in NUM_PAD_KEYS"
            :key="`dayend-${key}`"
            type="button"
            class="h-11 rounded-xl border-2 border-gray-200 font-extrabold text-lg transition active:scale-95 hover:border-brand-300 hover:bg-brand-50"
            :class="key === 'C' || key === '⌫' ? 'text-gray-500' : 'text-gray-800'"
            @click="applyNumPad(key)"
          >
            {{ key }}
          </button>
        </div>
      </div>
    </div>
    <template #footer>
      <template v-if="phase === 'confirm'">
        <button class="btn-ghost" :disabled="ending" @click="visible = false">取消</button>
        <button class="btn-danger" :disabled="ending || !cashDigits.length" @click="confirm">
          {{ ending ? '日結中…' : '確認日結' }}
        </button>
      </template>
      <template v-else>
        <button class="btn-ghost" @click="goBack">返回</button>
        <button class="btn-primary" @click="onPrint">列印</button>
      </template>
    </template>
  </Modal>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';
import { useCatalogStore } from '../stores/catalog';
import { useShiftStore } from '../stores/shift';
import { useToastStore } from '../stores/toast';
import BarChart from '../components/charts/BarChart.vue';
import LineChart from '../components/charts/LineChart.vue';
import DonutChart from '../components/charts/DonutChart.vue';
import { downloadCSV, downloadExcel } from '../utils/export';
import { fmtDateTime, fmtMoney, fmtNum, fmtPct, thisMonth, today } from '../utils/format';

const catalog = useCatalogStore();
const shift = useShiftStore();
const toast = useToastStore();

const tab = ref('daily');
const cur = catalog.currency;

/* ---------------- 日結單 ---------------- */
const dailyDate = ref(today());
const daily = ref(null);

async function loadDaily() {
  try {
    daily.value = await api.get(`/reports/daily?date=${dailyDate.value}`);
  } catch (e) {
    toast.error(e.message);
  }
}

const PAYMENT_COLORS = { cash: '#f59e0b', mobile: '#10b981', card: '#3b82f6', credit: '#8b5cf6' };

const paymentDonut = computed(() =>
  (daily.value?.by_payment || []).map((p) => ({
    label: p.method,
    value: p.amount,
    color: PAYMENT_COLORS[p.method] || '#9ca3af',
  })),
);

function exportDailyCSV() {
  if (!daily.value) return;
  const d = daily.value;
  const rows = [
    ['日結單', d.date],
    [],
    ['總營業額', d.total_sales],
    ['訂單數', d.order_count],
    ['客單價', d.avg_order],
    ['折扣合計', d.discount_total],
    ['服務費合計', d.service_total],
    ['作廢訂單數', d.void_count],
    [],
    ['支付方式', '筆數', '金額'],
    ...d.by_payment.map((p) => [p.method, p.cnt, p.amount]),
    [],
    ['時段', '筆數', '金額'],
    ...d.by_hour.map((h) => [`${h.hour}:00`, h.cnt, h.amount]),
    [],
    ['熱銷菜品', '銷量', '金額'],
    ...d.top_products.map((p) => [p.name, p.qty, p.amount]),
    [],
    ['分類營收', '銷量', '金額'],
    ...d.by_category.map((c) => [c.name, c.qty, c.amount]),
  ];
  downloadCSV(`日結單-${d.date}.csv`, rows);
  toast.success('CSV 已匯出');
}

async function exportDailyExcel() {
  if (!daily.value) return;
  const d = daily.value;
  await downloadExcel(`日結單-${d.date}.xlsx`, [
    { name: '總覽', rows: [['項目', '數值'], ['總營業額', d.total_sales], ['訂單數', d.order_count], ['客單價', d.avg_order], ['折扣合計', d.discount_total], ['服務費合計', d.service_total], ['作廢訂單數', d.void_count]] },
    { name: '支付方式', rows: [['方式', '筆數', '金額'], ...d.by_payment.map((p) => [p.method, p.cnt, p.amount])] },
    { name: '時段分佈', rows: [['時段', '筆數', '金額'], ...d.by_hour.map((h) => [`${h.hour}:00`, h.cnt, h.amount])] },
    { name: '熱銷菜品', rows: [['菜品', '銷量', '金額'], ...d.top_products.map((p) => [p.name, p.qty, p.amount])] },
    { name: '分類營收', rows: [['分類', '銷量', '金額'], ...d.by_category.map((c) => [c.name, c.qty, c.amount])] },
  ]);
  toast.success('Excel 已匯出');
}

/* ---------------- 月報表 ---------------- */
const month = ref(thisMonth());
const monthly = ref(null);

async function loadMonthly() {
  try {
    monthly.value = await api.get(`/reports/monthly?month=${month.value}`);
  } catch (e) {
    toast.error(e.message);
  }
}

const dailySeries = computed(() => {
  const m = monthly.value?.month || '';
  const daysInMonth = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate();
  const map = new Map((monthly.value?.daily || []).map((d) => [d.date, d]));
  const out = [];
  for (let i = 1; i <= daysInMonth; i++) {
    const ds = `${m}-${String(i).padStart(2, '0')}`;
    const hit = map.get(ds);
    out.push({ label: String(i), value: hit ? hit.sales : 0, orders: hit ? hit.orders : 0 });
  }
  return out;
});

function exportMonthlyCSV() {
  if (!monthly.value) return;
  const m = monthly.value;
  const rows = [
    ['月報表', m.month],
    [],
    ['總營業額', m.total_sales],
    ['訂單數', m.order_count],
    [],
    ['日期', '訂單數', '營業額'],
    ...m.daily.map((d) => [d.date, d.orders, d.sales]),
    [],
    ['分類營收', '金額'],
    ...m.by_category.map((c) => [c.name, c.amount]),
    [],
    ['熱銷菜品', '銷量', '金額'],
    ...m.top_products.map((p) => [p.name, p.qty, p.amount]),
  ];
  downloadCSV(`月報表-${m.month}.csv`, rows);
  toast.success('CSV 已匯出');
}

/* ---------------- 菜品分析 ---------------- */
const range = ref({ from: `${thisMonth()}-01`, to: today() });
const productReport = ref(null);

async function loadProductReport() {
  try {
    productReport.value = await api.get(`/reports/products?from=${range.value.from}&to=${range.value.to}`);
  } catch (e) {
    toast.error(e.message);
  }
}

const GRADE_CLS = { A: 'bg-emerald-100 text-emerald-700', B: 'bg-amber-100 text-amber-700', C: 'bg-gray-100 text-gray-500' };

function exportProductCSV() {
  if (!productReport.value) return;
  const r = productReport.value;
  const rows = [
    ['菜品銷量排行', `${r.from} ~ ${r.to}`],
    [],
    ['排名', '菜品', '銷量', '營收', '營收佔比', '累計佔比', 'ABC'],
    ...r.products.map((p) => [p.rank, p.name, p.qty, p.revenue, fmtPct(p.revenue_pct), fmtPct(p.cum_pct), p.grade]),
  ];
  downloadCSV(`菜品分析-${r.from}~${r.to}.csv`, rows);
  toast.success('CSV 已匯出');
}

/* ---------------- 交接班 ---------------- */
const closing = ref(false);

onMounted(async () => {
  try {
    await catalog.loadAll();
  } catch { /* 忽略 */ }
  await Promise.all([loadDaily(), loadMonthly(), loadProductReport()]);
  try {
    await shift.loadCurrent();
    await shift.loadRecords();
  } catch { /* 忽略 */ }
});

async function doCloseShift() {
  closing.value = true;
  try {
    await shift.close();
    await shift.loadRecords();
  } catch (e) {
    toast.error(e.message);
  } finally {
    closing.value = false;
  }
}

const tabs = [
  { key: 'daily', label: '日結單' },
  { key: 'monthly', label: '月報表' },
  { key: 'products', label: '菜品分析' },
  { key: 'shifts', label: '交接班報表' },
];
</script>

<template>
  <div class="h-full overflow-y-auto p-5">
    <!-- 頁籤 -->
    <div class="flex gap-2 mb-5">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="btn btn-sm"
        :class="tab === t.key ? 'bg-brand-500 text-white' : 'bg-white text-gray-600 border border-gray-200'"
        @click="tab = t.key"
      >
        {{ t.label }}
      </button>
    </div>

    <!-- ============ 日結單 ============ -->
    <template v-if="tab === 'daily'">
      <div class="flex items-center gap-3 mb-4">
        <input v-model="dailyDate" type="date" class="input !w-44" @change="loadDaily" />
        <button class="btn-ghost btn-sm" @click="loadDaily">查詢</button>
        <div class="flex-1" />
        <button class="btn-ghost btn-sm" @click="exportDailyCSV">匯出 CSV</button>
        <button class="btn-primary btn-sm" @click="exportDailyExcel">匯出 Excel</button>
      </div>

      <div v-if="daily" class="space-y-4">
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div class="card p-4">
            <div class="text-xs text-gray-400 font-bold">總營業額</div>
            <div class="text-2xl font-extrabold text-brand-600 mt-1">{{ fmtMoney(daily.total_sales, cur) }}</div>
          </div>
          <div class="card p-4">
            <div class="text-xs text-gray-400 font-bold">訂單數</div>
            <div class="text-2xl font-extrabold mt-1">{{ fmtNum(daily.order_count) }}</div>
          </div>
          <div class="card p-4">
            <div class="text-xs text-gray-400 font-bold">客單價</div>
            <div class="text-2xl font-extrabold mt-1">{{ fmtMoney(daily.avg_order, cur) }}</div>
          </div>
          <div class="card p-4">
            <div class="text-xs text-gray-400 font-bold">作廢 / 折扣</div>
            <div class="text-2xl font-extrabold mt-1">{{ daily.void_count }} <span class="text-sm text-gray-400 font-normal">/ {{ fmtMoney(daily.discount_total, cur) }}</span></div>
          </div>
        </div>

        <div class="grid lg:grid-cols-2 gap-4">
          <div class="card p-5">
            <h3 class="font-extrabold mb-4">支付方式佔比</h3>
            <DonutChart :data="paymentDonut" :center-label="fmtMoney(daily.total_sales, cur)" />
          </div>
          <div class="card p-5">
            <h3 class="font-extrabold mb-4">時段營業額分佈</h3>
            <BarChart :data="daily.by_hour.map((h) => ({ label: `${h.hour}時`, value: h.amount }))" />
          </div>
        </div>

        <div class="grid lg:grid-cols-2 gap-4">
          <div class="card p-5">
            <h3 class="font-extrabold mb-4">熱銷菜品 TOP 10</h3>
            <BarChart :data="daily.top_products.map((p) => ({ label: p.name, value: p.qty }))" color="#10b981" :format="(v) => `${v}份`" />
          </div>
          <div class="card p-5">
            <h3 class="font-extrabold mb-4">分類營收</h3>
            <BarChart :data="daily.by_category.map((c) => ({ label: c.name, value: c.amount }))" color="#8b5cf6" :format="(v) => fmtMoney(v, cur)" />
          </div>
        </div>
      </div>
    </template>

    <!-- ============ 月報表 ============ -->
    <template v-if="tab === 'monthly'">
      <div class="flex items-center gap-3 mb-4">
        <input v-model="month" type="month" class="input !w-44" @change="loadMonthly" />
        <button class="btn-ghost btn-sm" @click="loadMonthly">查詢</button>
        <div class="flex-1" />
        <button class="btn-ghost btn-sm" @click="exportMonthlyCSV">匯出 CSV</button>
      </div>

      <div v-if="monthly" class="space-y-4">
        <div class="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <div class="card p-4">
            <div class="text-xs text-gray-400 font-bold">本月營業額</div>
            <div class="text-2xl font-extrabold text-brand-600 mt-1">{{ fmtMoney(monthly.total_sales, cur) }}</div>
          </div>
          <div class="card p-4">
            <div class="text-xs text-gray-400 font-bold">訂單數</div>
            <div class="text-2xl font-extrabold mt-1">{{ fmtNum(monthly.order_count) }}</div>
          </div>
          <div class="card p-4">
            <div class="text-xs text-gray-400 font-bold">折扣合計</div>
            <div class="text-2xl font-extrabold mt-1">{{ fmtMoney(monthly.discount_total, cur) }}</div>
          </div>
        </div>

        <div class="card p-5">
          <h3 class="font-extrabold mb-4">每日營業額趨勢</h3>
          <LineChart :data="dailySeries" :height="220" />
        </div>

        <div class="grid lg:grid-cols-2 gap-4">
          <div class="card p-5">
            <h3 class="font-extrabold mb-4">分類營收佔比</h3>
            <DonutChart
              :data="monthly.by_category.map((c, i) => ({ label: c.name, value: c.amount, color: ['#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#06b6d4'][i % 6] }))"
              :center-label="fmtMoney(monthly.total_sales, cur)"
            />
          </div>
          <div class="card p-5">
            <h3 class="font-extrabold mb-4">本月熱銷菜品</h3>
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left text-xs text-gray-400 border-b">
                  <th class="py-2">菜品</th><th class="py-2 text-right">銷量</th><th class="py-2 text-right">金額</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in monthly.top_products" :key="p.name" class="border-b border-gray-50">
                  <td class="py-2 font-bold">{{ p.name }}</td>
                  <td class="py-2 text-right">{{ p.qty }}</td>
                  <td class="py-2 text-right text-brand-600 font-bold">{{ fmtMoney(p.amount, cur) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </template>

    <!-- ============ 菜品分析 ============ -->
    <template v-if="tab === 'products'">
      <div class="flex items-center gap-3 mb-4 flex-wrap">
        <input v-model="range.from" type="date" class="input !w-44" />
        <span class="text-gray-400">至</span>
        <input v-model="range.to" type="date" class="input !w-44" />
        <button class="btn-ghost btn-sm" @click="loadProductReport">查詢</button>
        <div class="flex-1" />
        <button class="btn-ghost btn-sm" @click="exportProductCSV">匯出 CSV</button>
      </div>

      <div v-if="productReport" class="space-y-4">
        <div class="card p-4 flex items-center gap-6 flex-wrap">
          <div>
            <div class="text-xs text-gray-400 font-bold">區間總營收</div>
            <div class="text-xl font-extrabold text-brand-600">{{ fmtMoney(productReport.total_revenue, cur) }}</div>
          </div>
          <div class="text-xs text-gray-400 leading-relaxed">
            <b>ABC 分析：</b>A 類（累計營收 80% 以內，重點關注）· B 類（80%–95%）· C 類（95% 以後）
          </div>
        </div>

        <div class="grid lg:grid-cols-2 gap-4">
          <div class="card p-5">
            <h3 class="font-extrabold mb-4">營收 TOP 10</h3>
            <BarChart :data="productReport.products.slice(0, 10).map((p) => ({ label: p.name, value: p.revenue }))" :format="(v) => fmtMoney(v, cur)" />
          </div>
          <div class="card p-5">
            <h3 class="font-extrabold mb-4">銷量 TOP 10</h3>
            <BarChart :data="[...productReport.products].sort((a, b) => b.qty - a.qty).slice(0, 10).map((p) => ({ label: p.name, value: p.qty }))" color="#10b981" :format="(v) => `${v}份`" />
          </div>
        </div>

        <div class="card p-5 overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-xs text-gray-400 border-b">
                <th class="py-2">排名</th><th class="py-2">菜品</th><th class="py-2 text-right">銷量</th>
                <th class="py-2 text-right">營收</th><th class="py-2 text-right">營收佔比</th>
                <th class="py-2 text-right">累計佔比</th><th class="py-2 text-center">ABC</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in productReport.products" :key="p.rank" class="border-b border-gray-50">
                <td class="py-2 font-bold text-gray-400">{{ p.rank }}</td>
                <td class="py-2 font-bold">{{ p.name }}</td>
                <td class="py-2 text-right">{{ p.qty }}</td>
                <td class="py-2 text-right text-brand-600 font-bold">{{ fmtMoney(p.revenue, cur) }}</td>
                <td class="py-2 text-right text-gray-500">{{ fmtPct(p.revenue_pct) }}</td>
                <td class="py-2 text-right text-gray-500">{{ fmtPct(p.cum_pct) }}</td>
                <td class="py-2 text-center"><span class="chip" :class="GRADE_CLS[p.grade]">{{ p.grade }}</span></td>
              </tr>
              <tr v-if="!productReport.products.length">
                <td colspan="7" class="py-8 text-center text-gray-300">區間內尚無銷售記錄</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <!-- ============ 交接班 ============ -->
    <template v-if="tab === 'shifts'">
      <div class="card p-5 mb-4">
        <div class="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div class="text-xs text-gray-400 font-bold">目前班別</div>
            <div v-if="shift.current" class="text-lg font-extrabold mt-1">
              進行中 · 開始於 {{ shift.current.start_time }}
            </div>
            <div v-else class="text-lg font-extrabold mt-1 text-gray-400">尚未開始交接班</div>
          </div>
          <button v-if="shift.current" class="btn-danger" :disabled="closing" @click="doCloseShift">
            {{ closing ? '結班中…' : '結束本班並結班' }}
          </button>
          <span v-else class="text-xs text-gray-400">請於頂部導航列點擊「未開始交接班」開班</span>
        </div>
      </div>

      <div class="card p-5 overflow-x-auto">
        <h3 class="font-extrabold mb-3">交接班紀錄</h3>
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-xs text-gray-400 border-b">
              <th class="py-2">班次</th><th class="py-2">收銀員</th><th class="py-2">開始時間</th>
              <th class="py-2">結束時間</th><th class="py-2 text-right">營業額</th>
              <th class="py-2 text-right">現金收款</th><th class="py-2 text-right">訂單數</th><th class="py-2 text-center">狀態</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in shift.records" :key="s.id" class="border-b border-gray-50">
              <td class="py-2 font-bold">#{{ s.id }}</td>
              <td class="py-2">{{ s.cashier_name || '—' }}</td>
              <td class="py-2 text-gray-500">{{ fmtDateTime(s.start_time) }}</td>
              <td class="py-2 text-gray-500">{{ s.end_time ? fmtDateTime(s.end_time) : '—' }}</td>
              <td class="py-2 text-right font-bold text-brand-600">{{ fmtMoney(s.total_sales, cur) }}</td>
              <td class="py-2 text-right">{{ fmtMoney(s.cash_amount, cur) }}</td>
              <td class="py-2 text-right">{{ s.order_count }}</td>
              <td class="py-2 text-center">
                <span class="chip" :class="s.status === 'open' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'">
                  {{ s.status === 'open' ? '進行中' : '已結班' }}
                </span>
              </td>
            </tr>
            <tr v-if="!shift.records.length">
              <td colspan="8" class="py-8 text-center text-gray-300">尚無交接班紀錄</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

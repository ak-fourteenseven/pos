<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@shared/api';
import { useBusinessDayStore } from '@shared/stores/businessDay';
import { useCatalogStore } from '@shared/stores/catalog';
import { usePosStore } from '../stores/pos';
import { useToastStore } from '@shared/stores/toast';
import { fmtMoney, TABLE_STATUS } from '@shared/utils/format';
import DayEndModal from '../components/DayEndModal.vue';

const catalog = useCatalogStore();
const businessDay = useBusinessDayStore();
const pos = usePosStore();
const toast = useToastStore();
const router = useRouter();

const loading = ref(false);
const mergeMode = ref(false);
const mergeSelected = ref([]); // table ids
const dayEndModalRef = ref(null);

onMounted(async () => {
  try {
    await catalog.loadAll();
  } catch (e) {
    toast.error(e.message);
  }
});

const areas = computed(() => {
  const map = new Map();
  for (const t of catalog.tables) {
    if (!map.has(t.area)) map.set(t.area, []);
    map.get(t.area).push(t);
  }
  return [...map.entries()];
});

/** 用餐中 = 点餐中 + 制作中 */
const busyCount = computed(() => catalog.tables.filter((t) => t.status === 'occupied' || t.status === 'preparing').length);

function isBusyTable(t) {
  return t.status === 'occupied' || t.status === 'preparing';
}

/** 用餐中顯示訂單人數；空閒等顯示桌台容納人數 */
function tablePeopleLabel(t) {
  const guests = Number(t.guest_count) || 0;
  if (isBusyTable(t) && guests > 0) return `${guests}人`;
  return `${t.capacity}人`;
}

async function reload() {
  try {
    await catalog.reloadTables();
  } catch (e) {
    toast.error(e.message);
  }
}

async function openTable(t) {
  try {
    const order = await api.post(`/tables/${t.id}/open`);
    pos.bindOrder(order, t.table_number);
    await catalog.reloadTables();
    toast.success(`${t.table_number} 已開台`);
    router.push('/pos');
  } catch (e) {
    toast.error(e.message);
  }
}

async function continueOrder(t) {
  try {
    const full = await api.get(`/orders/${t.order_id}`);
    pos.bindOrder(full, t.table_number);
    router.push('/pos');
  } catch (e) {
    toast.error(e.message);
  }
}

async function clearTable(t) {
  try {
    await api.patch(`/tables/${t.id}/status`, { status: 'available' });
    await reload();
    toast.success(`${t.table_number} 已清台`);
  } catch (e) {
    toast.error(e.message);
  }
}

async function cancelReserve(t) {
  try {
    await api.patch(`/tables/${t.id}/status`, { status: 'available' });
    await reload();
    toast.success(`${t.table_number} 已取消預訂`);
  } catch (e) {
    toast.error(e.message);
  }
}

function toggleMergeSelect(t) {
  const idx = mergeSelected.value.indexOf(t.id);
  if (idx >= 0) mergeSelected.value.splice(idx, 1);
  else {
    if (mergeSelected.value.length >= 2) mergeSelected.value.shift();
    mergeSelected.value.push(t.id);
  }
}

/** 點擊桌卡：併桌模式選桌；用餐中則進入收銀台 */
function onTableCardClick(t) {
  if (mergeMode.value) {
    if (isBusyTable(t)) toggleMergeSelect(t);
    return;
  }
  if (isBusyTable(t)) continueOrder(t);
}

async function doMerge() {
  if (mergeSelected.value.length !== 2) {
    toast.error('請選擇兩個用餐中的桌台進行併桌');
    return;
  }
  const [from, to] = mergeSelected.value;
  try {
    await api.post('/tables/merge', { from_id: from, to_id: to });
    mergeSelected.value = [];
    mergeMode.value = false;
    await reload();
    toast.success('併桌完成');
  } catch (e) {
    toast.error(e.message);
  }
}
</script>

<template>
  <div class="h-full overflow-y-auto p-5">
    <!-- 工具列 -->
    <div class="flex items-center gap-3 mb-5 flex-wrap">
      <div class="chip bg-white border border-gray-200 text-gray-600 shadow-sm">
        用餐中 {{ busyCount }} / {{ catalog.tables.length }} 桌
      </div>
      <div class="flex gap-2 text-xs text-gray-400">
        <span v-for="(s, k) in TABLE_STATUS" :key="k" class="flex items-center gap-1">
          <span class="w-2.5 h-2.5 rounded-full" :class="s.dot" />{{ s.label }}
        </span>
      </div>
      <div class="flex-1" />
      <button class="btn-ghost btn-sm" @click="reload">重新載入</button>
      <button v-if="!mergeMode" class="btn-ghost btn-sm" @click="mergeMode = true; mergeSelected = []">併桌模式</button>
      <template v-else>
        <span class="text-xs text-gray-500">已選 {{ mergeSelected.length }}/2</span>
        <button class="btn-primary btn-sm" @click="doMerge">執行併桌</button>
        <button class="btn-ghost btn-sm" @click="mergeMode = false; mergeSelected = []">取消</button>
      </template>
      <button
        class="btn-danger btn-sm"
        :disabled="!businessDay.current"
        :title="businessDay.current ? '日結' : '尚未開市，無法日結'"
        @click="dayEndModalRef?.open()"
      >日結</button>
    </div>

    <DayEndModal ref="dayEndModalRef" @done="router.push('/')" />

    <!-- 桌台看板：每列最多 10 格；固定 桌號/人數 → 金額 → 操作，高度一致 -->
    <div v-for="[area, list] in areas" :key="area" class="mb-5">
      <h2 class="text-xs font-extrabold text-gray-500 mb-2">{{ area }}（{{ list.length }} 桌）</h2>
      <div class="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 gap-2">
        <div
          v-for="t in list"
          :key="t.id"
          class="rounded-lg border-2 px-1.5 py-1.5 transition cursor-pointer flex flex-col gap-0.5 min-h-[5.25rem]"
          :class="[
            TABLE_STATUS[t.status]?.cls,
            isBusyTable(t) ? 'hover:shadow-md' : '',
            mergeSelected.includes(t.id) ? 'ring-2 ring-brand-400' : '',
          ]"
          @click="onTableCardClick(t)"
        >
          <div class="flex items-baseline justify-between gap-0.5 min-w-0">
            <span class="text-sm font-extrabold leading-none truncate">{{ t.table_number }}</span>
            <span class="text-[10px] font-bold leading-none shrink-0">{{ tablePeopleLabel(t) }}</span>
          </div>
          <div
            class="text-[10px] font-bold leading-tight tabular-nums h-4 flex items-center"
            :class="isBusyTable(t) ? '' : 'invisible'"
            :aria-hidden="!isBusyTable(t)"
          >
            {{ fmtMoney(t.total_amount || 0, catalog.currency) }}
          </div>

          <button
            v-if="isBusyTable(t)"
            class="btn-primary btn-xs w-full mt-auto !px-0.5 !py-1 !text-[10px] !rounded-md whitespace-nowrap"
            @click.stop="continueOrder(t)"
          >
            {{ t.status === 'preparing' ? '點餐/結賬' : '點餐' }}
          </button>
          <button
            v-else-if="t.status === 'available' || t.status === 'cleaning'"
            class="btn-ghost btn-xs w-full mt-auto !px-0.5 !py-1 !text-[10px] !rounded-md whitespace-nowrap"
            @click.stop="openTable(t)"
          >開台</button>
          <button
            v-else
            class="btn-ghost btn-xs w-full mt-auto !px-0.5 !py-1 !text-[10px] !rounded-md whitespace-nowrap"
            @click.stop="cancelReserve(t)"
          >取消預訂</button>
        </div>
      </div>
    </div>
  </div>
</template>

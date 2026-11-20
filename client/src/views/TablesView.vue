<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@shared/api';
import { useCatalogStore } from '@shared/stores/catalog';
import { usePosStore } from '../stores/pos';
import { useToastStore } from '@shared/stores/toast';
import { fmtMoney, TABLE_STATUS } from '@shared/utils/format';

const catalog = useCatalogStore();
const pos = usePosStore();
const toast = useToastStore();
const router = useRouter();

const loading = ref(false);
const mergeMode = ref(false);
const mergeSelected = ref([]); // table ids

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
    </div>

    <!-- 桌台看板 -->
    <div v-for="[area, list] in areas" :key="area" class="mb-5">
      <h2 class="text-xs font-extrabold text-gray-500 mb-2">{{ area }}（{{ list.length }} 桌）</h2>
      <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-9 xl:grid-cols-10 gap-2">
        <div
          v-for="t in list"
          :key="t.id"
          class="rounded-lg border-2 px-2 py-1.5 transition cursor-pointer"
          :class="[
            TABLE_STATUS[t.status]?.cls,
            mergeMode && (t.status === 'occupied' || t.status === 'preparing') ? 'hover:shadow-md' : '',
            mergeSelected.includes(t.id) ? 'ring-2 ring-brand-400' : '',
          ]"
          @click="mergeMode && (t.status === 'occupied' || t.status === 'preparing') && toggleMergeSelect(t)"
        >
          <div class="flex items-center justify-between">
            <span class="text-sm font-extrabold">{{ t.table_number }}</span>
            <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="TABLE_STATUS[t.status]?.dot" />
          </div>
          <div class="text-[10px] text-gray-400 leading-tight">{{ t.capacity }}人</div>

          <template v-if="t.status === 'occupied' || t.status === 'preparing'">
            <div class="text-xs font-bold mt-0.5">{{ fmtMoney(t.total_amount || 0, catalog.currency) }}</div>
            <button class="btn-primary btn-xs w-full mt-1 !py-1 !text-[10px] !rounded-md" @click.stop="continueOrder(t)">
              {{ t.status === 'preparing' ? '點餐/結賬' : '點餐' }}
            </button>
          </template>
          <template v-else-if="t.status === 'available'">
            <button class="btn-ghost btn-xs w-full mt-1 !py-1 !text-[10px] !rounded-md" @click.stop="openTable(t)">開台</button>
          </template>
          <template v-else-if="t.status === 'cleaning'">
            <button class="btn-ghost btn-xs w-full mt-1 !py-1 !text-[10px] !rounded-md" @click.stop="clearTable(t)">清台</button>
          </template>
          <template v-else>
            <button class="btn-ghost btn-xs w-full mt-1 !py-1 !text-[10px] !rounded-md" @click.stop="cancelReserve(t)">取消預訂</button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import { useCatalogStore } from '../stores/catalog';
import { usePosStore } from '../stores/pos';
import { useToastStore } from '../stores/toast';
import { fmtMoney, fmtTime, TABLE_STATUS } from '../utils/format';

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

const occupiedCount = computed(() => catalog.tables.filter((t) => t.status === 'occupied').length);

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
        用餐中 {{ occupiedCount }} / {{ catalog.tables.length }} 桌
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
    <div v-for="[area, list] in areas" :key="area" class="mb-6">
      <h2 class="text-sm font-extrabold text-gray-500 mb-3">{{ area }}</h2>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <div
          v-for="t in list"
          :key="t.id"
          class="card p-4 border-2 transition"
          :class="[
            TABLE_STATUS[t.status]?.cls,
            mergeMode && t.status === 'occupied' ? 'cursor-pointer hover:shadow-md' : '',
            mergeSelected.includes(t.id) ? 'ring-4 ring-brand-300' : '',
          ]"
          @click="mergeMode && t.status === 'occupied' && toggleMergeSelect(t)"
        >
          <div class="flex items-center justify-between">
            <span class="text-xl font-extrabold">{{ t.table_number }}</span>
            <span class="chip" :class="TABLE_STATUS[t.status]?.cls">{{ TABLE_STATUS[t.status]?.label }}</span>
          </div>
          <div class="text-xs text-gray-400 mt-1">{{ t.capacity }} 人桌</div>

          <template v-if="t.status === 'occupied'">
            <div class="mt-2 text-sm font-bold">{{ fmtMoney(t.total_amount || 0, catalog.currency) }}</div>
            <div class="text-xs text-gray-400">{{ t.item_count }} 件 · {{ fmtTime(t.opened_at) }} 開台</div>
            <div class="mt-2 flex gap-2">
              <button class="btn-primary btn-sm flex-1" @click.stop="continueOrder(t)">繼續點餐</button>
            </div>
          </template>
          <template v-else-if="t.status === 'available'">
            <div class="mt-3">
              <button class="btn-ghost btn-sm w-full" @click="openTable(t)">開台</button>
            </div>
          </template>
          <template v-else-if="t.status === 'cleaning'">
            <div class="mt-3">
              <button class="btn-ghost btn-sm w-full" @click="clearTable(t)">清台完成</button>
            </div>
          </template>
          <template v-else>
            <div class="mt-3">
              <button class="btn-ghost btn-sm w-full" @click="cancelReserve(t)">取消預訂</button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

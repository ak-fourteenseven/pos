<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';
import { useCatalogStore } from '../stores/catalog';
import { useToastStore } from '../stores/toast';
import Modal from '../components/Modal.vue';
import { TABLE_STATUS } from '../utils/format';

const catalog = useCatalogStore();
const toast = useToastStore();

const modal = ref(false);
const form = ref({ id: null, table_number: '', area: '大廳', capacity: 4 });

onMounted(async () => {
  try {
    await catalog.loadAll();
  } catch (e) {
    toast.error(e.message);
  }
});

const areas = computed(() => [...new Set(catalog.tables.map((t) => t.area))]);

function openForm(t = null) {
  form.value = t
    ? { id: t.id, table_number: t.table_number, area: t.area, capacity: t.capacity }
    : { id: null, table_number: '', area: '大廳', capacity: 4 };
  modal.value = true;
}

async function save() {
  if (!form.value.table_number.trim()) {
    toast.error('請輸入桌號');
    return;
  }
  try {
    if (form.value.id) {
      await api.put(`/tables/${form.value.id}`, form.value);
    } else {
      await api.post('/tables', form.value);
    }
    modal.value = false;
    await catalog.reloadTables();
    toast.success('桌台已儲存');
  } catch (e) {
    toast.error(e.message);
  }
}

async function remove(t) {
  if (!confirm(`確定刪除桌台 ${t.table_number}？`)) return;
  try {
    await api.del(`/tables/${t.id}`);
    await catalog.reloadTables();
    toast.success('桌台已刪除');
  } catch (e) {
    toast.error(e.message);
  }
}

async function setStatus(t, status) {
  try {
    await api.patch(`/tables/${t.id}/status`, { status });
    await catalog.reloadTables();
    toast.success(`${t.table_number} 狀態已更新`);
  } catch (e) {
    toast.error(e.message);
  }
}
</script>

<template>
  <div class="h-full overflow-y-auto p-5">
    <div class="flex items-center mb-4">
      <p class="text-sm text-gray-500">共 {{ catalog.tables.length }} 張桌台 · 用餐中 {{ catalog.tables.filter((t) => t.status === 'occupied').length }} 張</p>
      <div class="flex-1" />
      <button class="btn-primary" @click="openForm()">＋ 新增桌台</button>
    </div>

    <div class="card overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-xs text-gray-400 border-b bg-gray-50">
            <th class="py-2.5 px-4">桌號</th>
            <th class="py-2.5 px-4">區域</th>
            <th class="py-2.5 px-4">容納人數</th>
            <th class="py-2.5 px-4">狀態</th>
            <th class="py-2.5 px-4 text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in catalog.tables" :key="t.id" class="border-b border-gray-50 hover:bg-gray-50">
            <td class="py-2.5 px-4 font-extrabold">{{ t.table_number }}</td>
            <td class="py-2.5 px-4 text-gray-500">{{ t.area }}</td>
            <td class="py-2.5 px-4">{{ t.capacity }} 人</td>
            <td class="py-2.5 px-4">
              <select
                :value="t.status"
                class="chip cursor-pointer border-0"
                :class="TABLE_STATUS[t.status]?.cls"
                @change="setStatus(t, $event.target.value)"
              >
                <option v-for="(s, k) in TABLE_STATUS" :key="k" :value="k" :disabled="k === 'occupied'">{{ s.label }}</option>
              </select>
            </td>
            <td class="py-2.5 px-4 text-right whitespace-nowrap">
              <button class="btn-ghost btn-sm" @click="openForm(t)">編輯</button>
              <button class="btn-ghost btn-sm !text-red-500 ml-1" @click="remove(t)">刪除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Modal v-model="modal" :title="form.id ? '編輯桌台' : '新增桌台'" width="max-w-sm">
      <div class="space-y-4">
        <div>
          <label class="label">桌號 *</label>
          <input v-model="form.table_number" class="input" placeholder="例如：A7" />
        </div>
        <div>
          <label class="label">區域</label>
          <input v-model="form.area" class="input" list="area-list" placeholder="例如：大廳" />
          <datalist id="area-list">
            <option v-for="a in areas" :key="a" :value="a" />
          </datalist>
        </div>
        <div>
          <label class="label">容納人數</label>
          <input v-model.number="form.capacity" type="number" min="1" class="input" />
        </div>
      </div>
      <template #footer>
        <button class="btn-ghost" @click="modal = false">取消</button>
        <button class="btn-primary" @click="save">儲存</button>
      </template>
    </Modal>
  </div>
</template>

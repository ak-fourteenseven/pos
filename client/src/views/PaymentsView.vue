<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../api';
import { useCatalogStore } from '../stores/catalog';
import { useToastStore } from '../stores/toast';

const catalog = useCatalogStore();
const toast = useToastStore();
const saving = ref(null);

onMounted(async () => {
  try {
    await catalog.loadAll();
  } catch (e) {
    toast.error(e.message);
  }
});

const METHOD_ICONS = { cash: '💵', mobile: '📱', card: '💳', credit: '📒' };

async function save(pm) {
  saving.value = pm.id;
  try {
    await api.put(`/payment-methods/${pm.id}`, {
      name: pm.name,
      is_enabled: Number(pm.is_enabled),
      fee_rate: Number(pm.fee_rate) || 0,
    });
    toast.success(`${pm.name} 已儲存`);
  } catch (e) {
    toast.error(e.message);
  } finally {
    saving.value = null;
  }
}

async function toggle(pm) {
  pm.is_enabled = Number(pm.is_enabled) === 1 ? 0 : 1;
  await save(pm);
}
</script>

<template>
  <div class="h-full overflow-y-auto p-5">
    <p class="text-sm text-gray-500 mb-4">
      啟用或停用支付方式；停用後收銀台不再顯示。手續費率僅供統計參考（如信用卡 2.5%）。
    </p>

    <div class="grid sm:grid-cols-2 gap-4">
      <div v-for="pm in catalog.payments" :key="pm.id" class="card p-5">
        <div class="flex items-center gap-3">
          <span class="text-3xl">{{ METHOD_ICONS[pm.code] || '💰' }}</span>
          <div class="flex-1">
            <input v-model="pm.name" class="input !border-transparent !px-0 font-extrabold !text-lg hover:!border-gray-200 focus:!border-brand-400 focus:!px-3" />
            <div class="text-xs text-gray-400 mt-0.5">代碼：{{ pm.code }}</div>
          </div>
          <button
            class="chip cursor-pointer"
            :class="Number(pm.is_enabled) === 1 ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'"
            @click="toggle(pm)"
          >
            {{ Number(pm.is_enabled) === 1 ? '已啟用' : '已停用' }}
          </button>
        </div>
        <div class="flex items-end gap-3 mt-4">
          <div class="flex-1">
            <label class="label">手續費率（%）</label>
            <input v-model.number="pm.fee_rate" type="number" min="0" step="0.1" class="input" />
          </div>
          <button class="btn-primary" :disabled="saving === pm.id" @click="save(pm)">
            {{ saving === pm.id ? '儲存中…' : '儲存' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

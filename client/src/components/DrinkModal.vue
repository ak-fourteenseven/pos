<script setup>
import { computed, ref, watch } from 'vue';
import Modal from '@shared/components/Modal.vue';
import { DRINK_PREFS, drinkPrice, normalizeSpecEntries, slotRuleText, specPriceSum } from '@shared/utils/pricing';
import { fmtMoney } from '@shared/utils/format';

const props = defineProps({
  // v-model 傳入的即為飲品商品（開啟時為物件，關閉時為 null）
  modelValue: { type: [Boolean, Object], default: null },
  product: { type: Object, default: null },
  slot: { type: Object, default: null },
  currency: { type: String, default: 'NT$' },
});
const emit = defineEmits(['close', 'add', 'update:modelValue']);

/** 關閉彈窗：同時通知父層關閉 */
function onClose() {
  emit('update:modelValue', null);
  emit('close');
}

const temperature = ref('HOT');
const preferences = ref([]);
const qty = ref(1);

const prefOptions = computed(() => {
  const list = normalizeSpecEntries(props.product?.resolved_specs || []);
  if (list.length) return list;
  return DRINK_PREFS.map((name) => ({ name, price_diff: 0 }));
});

watch(() => props.modelValue, (open) => {
  if (!open) return;
  temperature.value = 'HOT';
  preferences.value = [];
  qty.value = 1;
});

const calc = computed(() => {
  if (!props.product) return null;
  const base = drinkPrice(props.product.price, temperature.value, props.slot);
  const prefExtra = base.price === 0 ? 0 : specPriceSum(preferences.value);
  return { ...base, price: base.price + prefExtra };
});

function togglePref(tag) {
  const key = tag.id ?? tag.name;
  const idx = preferences.value.findIndex((x) => (x.id ?? x.name) === key);
  if (idx >= 0) preferences.value.splice(idx, 1);
  else preferences.value.push({ id: tag.id, name: tag.name, price_diff: Number(tag.price_diff) || 0 });
}
function isPrefSelected(tag) {
  const key = tag.id ?? tag.name;
  return preferences.value.some((x) => (x.id ?? x.name) === key);
}

function confirmAdd() {
  if (!props.product) return;
  emit('add', {
    product: props.product,
    temperature: temperature.value,
    preferences: preferences.value.map((x) => ({
      name: x.name,
      price_diff: Number(x.price_diff) || 0,
    })),
    qty: qty.value,
  });
}
</script>

<template>
  <Modal :model-value="modelValue" :title="product ? `${product.emoji || ''} ${product.name}` : ''" width="max-w-md" @close="onClose">
    <div v-if="product" class="space-y-4">
      <div class="flex items-center justify-between">
        <span class="text-sm text-gray-500">原價 {{ fmtMoney(product.price, currency) }}</span>
        <span class="chip bg-amber-100 text-amber-700">{{ slotRuleText(slot) }}</span>
      </div>

      <div>
        <div class="label">冷熱選擇</div>
        <div class="grid grid-cols-2 gap-2">
          <button class="rounded-xl border-2 py-3 font-bold transition" :class="temperature === 'HOT' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200'" @click="temperature = 'HOT'">🔥 熱飲</button>
          <button class="rounded-xl border-2 py-3 font-bold transition" :class="temperature === 'COLD' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200'" @click="temperature = 'COLD'">🧊 凍飲</button>
        </div>
      </div>

      <div v-if="prefOptions.length">
        <div class="label">口味（選填）</div>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="tag in prefOptions"
            :key="tag.id || tag.name"
            type="button"
            class="chip border transition"
            :class="isPrefSelected(tag) ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-gray-500 border-gray-300'"
            @click="togglePref(tag)"
          >
            {{ tag.name }}
            <span v-if="Number(tag.price_diff)" class="text-[10px] ml-0.5">
              {{ Number(tag.price_diff) > 0 ? '+' : '' }}{{ fmtMoney(tag.price_diff, currency) }}
            </span>
          </button>
        </div>
      </div>

      <div class="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3">
        <div class="flex items-center gap-2">
          <button class="w-8 h-8 rounded-lg bg-white border font-bold" @click="qty = Math.max(1, qty - 1)">−</button>
          <span class="w-6 text-center font-extrabold">{{ qty }}</span>
          <button class="w-8 h-8 rounded-lg bg-white border font-bold" @click="qty++">＋</button>
        </div>
        <div class="flex-1" />
        <span class="text-sm text-gray-500">售價</span>
        <span class="font-extrabold text-lg" :class="calc && calc.free ? 'text-emerald-500' : 'text-brand-600'">
          {{ calc ? (calc.free ? '免費' : fmtMoney(calc.price * qty, currency)) : '' }}
          <span class="text-xs font-normal text-gray-400 ml-1">{{ calc ? calc.label : '' }}</span>
        </span>
      </div>
    </div>

    <template #footer>
      <button class="btn-ghost" @click="onClose">取消</button>
      <button class="btn-primary" @click="confirmAdd">加入購物車</button>
    </template>
  </Modal>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import Modal from './Modal.vue';
import { DRINK_PREFS, drinkPrice, slotRuleText } from '../utils/pricing';
import { fmtMoney } from '../utils/format';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  product: { type: Object, default: null }, // 含 steps 的套餐商品
  drinks: { type: Array, default: () => [] },
  slot: { type: Object, default: null }, // 當前時段
  currency: { type: String, default: 'NT$' },
});
const emit = defineEmits(['close', 'add']);

const stepIdx = ref(0);
const selections = ref({}); // groupCode -> { id, name, price_diff } | [{...}]
const drink = ref(null); // { product_id, name, base_price, temperature, preferences }
const qty = ref(1);

const steps = computed(() => (props.product && props.product.steps) || []);
const skipCode = computed(() => props.product?.skip_group || null);
/** 清湯等跳過辣度步驟 */
const visibleSteps = computed(() => steps.value.filter((s) => s.code !== skipCode.value));
const currentStep = computed(() => visibleSteps.value[stepIdx.value] || null);
const isLast = computed(() => stepIdx.value >= visibleSteps.value.length - 1);

/** 初始化：單選組預設選中 is_default 或第一項 */
watch(() => props.modelValue, (open) => {
  if (!open || !props.product) return;
  stepIdx.value = 0;
  qty.value = 1;
  const sel = {};
  for (const st of steps.value) {
    if (st.code === 'drink') continue;
    if (st.code === skipCode.value) continue; // 清湯等跳過的組不預選
    if (Number(st.is_multi) === 1) {
      sel[st.code] = [];
    } else {
      const def = st.items.find((i) => Number(i.is_default) === 1) || st.items[0];
      sel[st.code] = def ? { id: def.id, name: def.name, price_diff: Number(def.price_diff) || 0 } : null;
    }
  }
  selections.value = sel;
  drink.value = null;
});

function toggleMulti(group, item) {
  const list = selections.value[group.code] || [];
  const idx = list.findIndex((x) => x.id === item.id);
  if (idx >= 0) list.splice(idx, 1);
  else list.push({ id: item.id, name: item.name, price_diff: Number(item.price_diff) || 0 });
  selections.value[group.code] = list;
}
function selectSingle(group, item) {
  selections.value[group.code] = { id: item.id, name: item.name, price_diff: Number(item.price_diff) || 0 };
}
function isSelected(group, item) {
  const v = selections.value[group.code];
  if (Array.isArray(v)) return v.some((x) => x.id === item.id);
  return v && v.id === item.id;
}

/** 選擇飲品（含凍/熱與口味） */
function selectDrink(p) {
  if (drink.value && drink.value.product_id === p.id) {
    drink.value = null;
    return;
  }
  drink.value = { product_id: p.id, name: p.name, base_price: Number(p.price), temperature: 'HOT', preferences: [] };
}
function setTemp(t) {
  if (drink.value) drink.value.temperature = t;
}
function togglePref(tag) {
  if (!drink.value) return;
  const idx = drink.value.preferences.indexOf(tag);
  if (idx >= 0) drink.value.preferences.splice(idx, 1);
  else drink.value.preferences.push(tag);
}

const drinkCalc = computed(() =>
  drink.value ? drinkPrice(drink.value.base_price, drink.value.temperature, props.slot) : null);

const modifiersSum = computed(() => {
  let sum = 0;
  for (const st of steps.value) {
    if (st.code === 'drink') continue;
    const v = selections.value[st.code];
    if (Array.isArray(v)) sum += v.reduce((s, x) => s + (x.price_diff || 0), 0);
    else if (v) sum += v.price_diff || 0;
  }
  return sum;
});

const subtotal = computed(() => {
  if (!props.product) return 0;
  const base = Number(props.product.price) || 0;
  const dp = drink.value && drinkCalc.value ? drinkCalc.value.price : 0;
  return (base + modifiersSum.value + dp) * qty.value;
});

function next() {
  if (isLast.value) confirmAdd();
  else stepIdx.value++;
}
function prev() {
  if (stepIdx.value > 0) stepIdx.value--;
}

function confirmAdd() {
  if (!props.product) return;
  const options = { base: props.product.name };
  for (const st of steps.value) {
    if (st.code === 'drink') continue;
    if (st.code === skipCode.value) continue; // 清湯不寫入辣度
    const v = selections.value[st.code];
    if (Array.isArray(v)) {
      if (v.length) options.toppings = v.map((x) => ({ name: x.name, price_diff: x.price_diff || 0 }));
    } else if (v) {
      // 小食口味組統一歸檔到 flavor 鍵
      const key = st.code.startsWith('flavor') ? 'flavor' : st.code;
      options[key] = { name: v.name, price_diff: v.price_diff || 0 };
    }
  }
  if (drink.value) {
    options.drink = {
      product_id: drink.value.product_id,
      name: drink.value.name,
      base_price: drink.value.base_price,
      temperature: drink.value.temperature,
      preferences: [...drink.value.preferences],
      final_price: drinkCalc.value ? drinkCalc.value.price : drink.value.base_price,
    };
  }
  emit('add', { product: props.product, options, qty: qty.value });
}

const stepLabel = computed(() => {
  if (!currentStep.value) return '';
  return `Step ${stepIdx.value + 1}/${visibleSteps.value.length} · ${currentStep.value.name}`;
});
</script>

<template>
  <Modal :model-value="modelValue" :title="product ? `${product.emoji || ''} ${product.name}` : ''" width="max-w-xl" @close="emit('close')">
    <div v-if="product" class="space-y-4">
      <!-- 步驟指示 -->
      <div class="flex items-center gap-2 text-xs font-bold text-gray-400">
        <span class="text-brand-600">{{ stepLabel }}</span>
        <div class="flex-1 flex gap-1">
          <span v-for="(s, i) in visibleSteps" :key="i" class="h-1.5 flex-1 rounded-full" :class="i <= stepIdx ? 'bg-brand-500' : 'bg-gray-200'" />
        </div>
      </div>

      <!-- 選項主體 -->
      <div v-if="currentStep && currentStep.code !== 'drink'">
        <div class="flex items-center justify-between mb-2">
          <span class="label !mb-0">{{ currentStep.name }}</span>
          <span class="text-xs text-gray-400">{{ currentStep.is_multi ? '可多選' : '單選' }}{{ currentStep.required ? ' · 必選' : ' · 選填' }}</span>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <button
            v-for="item in currentStep.items"
            :key="item.id"
            class="rounded-xl border-2 py-2.5 px-3 text-sm font-bold transition text-left"
            :class="isSelected(currentStep, item) ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200 hover:border-gray-300'"
            @click="Number(currentStep.is_multi) === 1 ? toggleMulti(currentStep, item) : selectSingle(currentStep, item)"
          >
            {{ item.name }}
            <span v-if="Number(item.price_diff) !== 0" class="text-xs font-normal ml-1" :class="Number(item.price_diff) > 0 ? 'text-brand-500' : 'text-emerald-500'">
              {{ Number(item.price_diff) > 0 ? '+' : '' }}{{ fmtMoney(item.price_diff, currency) }}
            </span>
          </button>
        </div>
      </div>

      <!-- 飲品步驟 -->
      <div v-else-if="currentStep && currentStep.code === 'drink'">
        <div class="flex items-center justify-between mb-2">
          <span class="label !mb-0">選擇飲品（跟餐）</span>
          <span class="chip bg-amber-100 text-amber-700">{{ slotRuleText(slot) }}</span>
        </div>
        <div class="space-y-2">
          <div v-for="d in drinks" :key="d.id" class="rounded-xl border-2 p-3 transition" :class="drink && drink.product_id === d.id ? 'border-brand-500 bg-brand-50' : 'border-gray-200'">
            <button class="w-full flex items-center gap-2 text-left" @click="selectDrink(d)">
              <span class="text-xl">{{ d.emoji }}</span>
              <span class="font-bold flex-1">{{ d.name }}</span>
              <span class="text-xs text-gray-400 line-through" v-if="false">{{ fmtMoney(d.price, currency) }}</span>
              <span class="text-sm font-bold text-gray-500">原價 {{ fmtMoney(d.price, currency) }}</span>
              <span v-if="drink && drink.product_id === d.id" class="chip bg-brand-500 text-white">已選</span>
            </button>
            <div v-if="drink && drink.product_id === d.id" class="mt-3 space-y-3">
              <div class="flex items-center gap-2">
                <span class="text-xs font-bold text-gray-500">冷熱</span>
                <button class="btn btn-sm" :class="drink.temperature === 'HOT' ? 'bg-brand-500 text-white' : 'bg-white border border-gray-300'" @click="setTemp('HOT')">🔥 熱飲</button>
                <button class="btn btn-sm" :class="drink.temperature === 'COLD' ? 'bg-brand-500 text-white' : 'bg-white border border-gray-300'" @click="setTemp('COLD')">🧊 凍飲</button>
                <div class="flex-1" />
                <span class="text-sm font-extrabold" :class="drinkCalc && drinkCalc.free ? 'text-emerald-500' : 'text-brand-600'">
                  {{ drinkCalc ? (drinkCalc.free ? '免費' : fmtMoney(drinkCalc.price, currency)) : '' }}
                  <span class="text-xs font-normal text-gray-400 ml-1">{{ drinkCalc ? drinkCalc.label : '' }}</span>
                </span>
              </div>
              <div class="flex flex-wrap gap-1.5">
                <button
                  v-for="tag in DRINK_PREFS"
                  :key="tag"
                  class="chip border transition"
                  :class="drink.preferences.includes(tag) ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-gray-500 border-gray-300'"
                  @click="togglePref(tag)"
                >
                  {{ tag }}
                </button>
              </div>
            </div>
          </div>
        </div>
        <p class="text-xs text-gray-400 mt-2">不選飲品可直接進入下一步（部分套餐飲品為選填）。</p>
      </div>

      <!-- 底部匯總 -->
      <div class="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3">
        <div class="flex items-center gap-2">
          <button class="w-8 h-8 rounded-lg bg-white border font-bold" @click="qty = Math.max(1, qty - 1)">−</button>
          <span class="w-6 text-center font-extrabold">{{ qty }}</span>
          <button class="w-8 h-8 rounded-lg bg-white border font-bold" @click="qty++">＋</button>
        </div>
        <div class="flex-1 text-xs text-gray-400">
          基礎 {{ fmtMoney(product.price, currency) }}
          <span v-if="modifiersSum"> + 加料 {{ fmtMoney(modifiersSum, currency) }}</span>
          <span v-if="drink"> + 飲品 {{ drinkCalc && drinkCalc.free ? '免費' : fmtMoney(drinkCalc ? drinkCalc.price : 0, currency) }}</span>
        </div>
        <span class="font-extrabold text-brand-600 text-lg">{{ fmtMoney(subtotal, currency) }}</span>
      </div>
    </div>

    <template #footer>
      <button class="btn-ghost" :disabled="stepIdx === 0" @click="prev">上一步</button>
      <button class="btn-primary" @click="next">{{ isLast ? '加入購物車' : '下一步' }}</button>
    </template>
  </Modal>
</template>

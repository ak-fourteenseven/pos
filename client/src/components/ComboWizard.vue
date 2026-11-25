<script setup>
import { computed, ref, watch } from 'vue';
import Modal from '@shared/components/Modal.vue';
import { DRINK_PREFS, drinkPrice, normalizeSpecEntries, slotRuleText, specPriceSum } from '@shared/utils/pricing';
import { fmtMoney } from '@shared/utils/format';

const props = defineProps({
  // v-model 傳入的即為套餐商品（開啟時為物件，關閉時為 null）
  modelValue: { type: [Boolean, Object], default: null },
  product: { type: Object, default: null }, // 含 steps 的套餐商品
  drinks: { type: Array, default: () => [] },
  slot: { type: Object, default: null }, // 當前時段
  currency: { type: String, default: 'NT$' },
});
const emit = defineEmits(['close', 'add', 'update:modelValue']);

/** 關閉嚮導：同時通知父層關閉（取消點單不加入購物車） */
function onClose() {
  emit('update:modelValue', null);
  emit('close');
}

const stepIdx = ref(0);
const selections = ref({}); // groupCode -> { id, name, price_diff } | [{...}]
const selectedSpecs = ref([]); // [{ id, name, price_diff }]
const drink = ref(null); // { product_id, name, base_price, temperature, preferences, resolved_specs }
const qty = ref(1);
const toppingPage = ref(0); // 分頁（0 起，配料／飲品共用頁碼）
const TOPPING_PAGE_SIZE = 18; // 配料每頁 18 項
const DRINK_PAGE_SIZE = 5; // 飲品每頁 5 項

const steps = computed(() => (props.product && props.product.steps) || []);
const skipCode = computed(() => props.product?.skip_group || null);
/** 清湯等跳過辣度步驟 */
const visibleSteps = computed(() => steps.value.filter((s) => s.code !== skipCode.value));
const currentStep = computed(() => visibleSteps.value[stepIdx.value] || null);
const isLast = computed(() => stepIdx.value >= visibleSteps.value.length - 1);

/** 分頁：配料（topping）與飲品（drink）步驟每頁 18 項，其餘步驟全部顯示 */
const isTopping = computed(() => currentStep.value?.code === 'topping');
const isDrinkStep = computed(() => currentStep.value?.code === 'drink');
const pagedItems = computed(() => {
  const items = currentStep.value?.items || [];
  if (!isTopping.value) return items;
  const start = toppingPage.value * TOPPING_PAGE_SIZE;
  return items.slice(start, start + TOPPING_PAGE_SIZE);
});
const pagedDrinks = computed(() => {
  const start = toppingPage.value * DRINK_PAGE_SIZE;
  return (props.drinks || []).slice(start, start + DRINK_PAGE_SIZE);
});
// 當前步驟的總頁數（配料用 items，飲品用 drinks）
const pageCount = computed(() => {
  const total = isTopping.value
    ? (currentStep.value.items?.length || 0)
    : isDrinkStep.value ? (props.drinks?.length || 0) : 0;
  const size = isTopping.value ? TOPPING_PAGE_SIZE : DRINK_PAGE_SIZE;
  return total ? Math.max(1, Math.ceil(total / size)) : 1;
});
const showPaging = computed(() => (isTopping.value || isDrinkStep.value) && pageCount.value > 1);
function prevPage() {
  if (toppingPage.value > 0) toppingPage.value--;
}
function nextPage() {
  if (toppingPage.value < pageCount.value - 1) toppingPage.value++;
}

/** 菜品生效規格（分類預設或覆寫） */
const productSpecs = computed(() => normalizeSpecEntries(props.product?.resolved_specs || []));

/** 規格區塊：辣度步驟同面板；無辣度時掛在第一個非飲品步驟 */
const showSpecsOnStep = computed(() => {
  if (!productSpecs.value.length || !currentStep.value || currentStep.value.code === 'drink') return false;
  const spice = visibleSteps.value.find((s) => s.code === 'spiciness');
  if (spice) return currentStep.value.code === 'spiciness';
  const firstFood = visibleSteps.value.find((s) => s.code !== 'drink');
  return firstFood && currentStep.value.code === firstFood.code;
});

/** 初始化：單選組預設選中 is_default 或第一項 */
watch(() => props.modelValue, (open) => {
  if (!open || !props.product) return;
  stepIdx.value = 0;
  qty.value = 1;
  toppingPage.value = 0;
  selectedSpecs.value = [];
  const sel = {};
  for (const st of steps.value) {
    if (st.code === 'drink') continue;
    if (st.code === skipCode.value) continue; // 清湯等跳過的組不預選
    if (Number(st.is_multi) === 1) {
      sel[st.code] = [];
    } else if (!Number(st.required)) {
      // 選填：不預選，收銀台可直接跳過
      sel[st.code] = null;
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

function toggleSpec(spec) {
  const key = spec.id ?? spec.name;
  const idx = selectedSpecs.value.findIndex((x) => (x.id ?? x.name) === key);
  if (idx >= 0) selectedSpecs.value.splice(idx, 1);
  else selectedSpecs.value.push({ id: spec.id, name: spec.name, price_diff: Number(spec.price_diff) || 0 });
}
function isSpecSelected(spec) {
  const key = spec.id ?? spec.name;
  return selectedSpecs.value.some((x) => (x.id ?? x.name) === key);
}

/** 選擇飲品（含凍/熱與口味） */
function selectDrink(p) {
  if (drink.value && drink.value.product_id === p.id) {
    drink.value = null;
    return;
  }
  drink.value = {
    product_id: p.id,
    name: p.name,
    base_price: Number(p.price),
    temperature: 'HOT',
    preferences: [],
    resolved_specs: normalizeSpecEntries(p.resolved_specs || []),
  };
}
function setTemp(t) {
  if (drink.value) drink.value.temperature = t;
}
function drinkPrefOptions() {
  if (!drink.value) return [];
  const list = drink.value.resolved_specs;
  if (list.length) return list;
  return DRINK_PREFS.map((name) => ({ name, price_diff: 0 }));
}
function togglePref(tag) {
  if (!drink.value) return;
  const key = tag.id ?? tag.name;
  const idx = drink.value.preferences.findIndex((x) => (x.id ?? x.name) === key);
  if (idx >= 0) drink.value.preferences.splice(idx, 1);
  else drink.value.preferences.push({ id: tag.id, name: tag.name, price_diff: Number(tag.price_diff) || 0 });
}
function isPrefSelected(tag) {
  if (!drink.value) return false;
  const key = tag.id ?? tag.name;
  return drink.value.preferences.some((x) => (x.id ?? x.name) === key);
}

const drinkCalc = computed(() => {
  if (!drink.value) return null;
  const base = drinkPrice(drink.value.base_price, drink.value.temperature, props.slot);
  const prefExtra = base.price === 0 ? 0 : specPriceSum(drink.value.preferences);
  return { ...base, price: base.price + prefExtra };
});

const modifiersSum = computed(() => {
  let sum = 0;
  for (const st of steps.value) {
    if (st.code === 'drink') continue;
    const v = selections.value[st.code];
    if (Array.isArray(v)) sum += v.reduce((s, x) => s + (x.price_diff || 0), 0);
    else if (v) sum += v.price_diff || 0;
  }
  sum += specPriceSum(selectedSpecs.value);
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
  else {
    stepIdx.value++;
    toppingPage.value = 0;
  }
}
function prev() {
  if (stepIdx.value > 0) {
    stepIdx.value--;
    toppingPage.value = 0;
  }
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
  if (selectedSpecs.value.length) {
    options.specs = selectedSpecs.value.map((x) => ({
      name: x.name,
      price_diff: Number(x.price_diff) || 0,
    }));
  }
  if (drink.value) {
    options.drink = {
      product_id: drink.value.product_id,
      name: drink.value.name,
      base_price: drink.value.base_price,
      temperature: drink.value.temperature,
      preferences: drink.value.preferences.map((x) => ({
        name: x.name,
        price_diff: Number(x.price_diff) || 0,
      })),
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
  <Modal :model-value="modelValue" :title="product ? `${product.emoji || ''} ${product.name}` : ''" width="max-w-xl" @close="onClose">
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
            v-for="item in pagedItems"
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
        <!-- 配料分頁控制（每頁 18 項） -->
        <div v-if="showPaging" class="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
          <button class="btn-ghost !px-5 !py-2.5 !text-base" :disabled="toppingPage === 0" @click="prevPage">◀ 上一頁</button>
          <span class="text-sm font-bold text-gray-500">第 {{ toppingPage + 1 }} / {{ pageCount }} 頁</span>
          <button class="btn-ghost !px-5 !py-2.5 !text-base" :disabled="toppingPage >= pageCount - 1" @click="nextPage">下一頁 ▶</button>
        </div>

        <!-- 規格（選填）：辣度同面板 / 無辣度時掛第一個食品步驟 -->
        <div v-if="showSpecsOnStep" class="mt-4">
          <div class="flex items-center justify-between mb-2">
            <span class="label !mb-0">規格</span>
            <span class="text-xs text-gray-400">可多選 · 選填</span>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="s in productSpecs"
              :key="s.id || s.name"
              type="button"
              class="chip border transition"
              :class="isSpecSelected(s) ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-gray-500 border-gray-300'"
              @click="toggleSpec(s)"
            >
              {{ s.name }}
              <span v-if="Number(s.price_diff)" class="text-[10px] ml-0.5 opacity-90">
                {{ Number(s.price_diff) > 0 ? '+' : '' }}{{ fmtMoney(s.price_diff, currency) }}
              </span>
            </button>
          </div>
        </div>
      </div>

      <!-- 飲品步驟 -->
      <div v-else-if="currentStep && currentStep.code === 'drink'">
        <div class="flex items-center justify-between mb-2">
          <span class="label !mb-0">選擇飲品（跟餐）</span>
          <span class="chip bg-amber-100 text-amber-700">{{ slotRuleText(slot) }}</span>
        </div>
        <div class="space-y-2">
          <div v-for="d in pagedDrinks" :key="d.id" class="rounded-xl border-2 p-3 transition" :class="drink && drink.product_id === d.id ? 'border-brand-500 bg-brand-50' : 'border-gray-200'">
            <button class="w-full flex items-center gap-2 text-left" @click="selectDrink(d)">
              <span class="text-xl">{{ d.emoji }}</span>
              <span class="font-bold flex-1">{{ d.name }}</span>
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
              <div v-if="drinkPrefOptions().length">
                <div class="text-xs font-bold text-gray-500 mb-1.5">口味（選填）</div>
                <div class="flex flex-wrap gap-1.5">
                  <button
                    v-for="tag in drinkPrefOptions()"
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
            </div>
          </div>
        </div>
        <!-- 飲品分頁控制（每頁 18 項） -->
        <div v-if="showPaging" class="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
          <button class="btn-ghost !px-5 !py-2.5 !text-base" :disabled="toppingPage === 0" @click="prevPage">◀ 上一頁</button>
          <span class="text-sm font-bold text-gray-500">第 {{ toppingPage + 1 }} / {{ pageCount }} 頁</span>
          <button class="btn-ghost !px-5 !py-2.5 !text-base" :disabled="toppingPage >= pageCount - 1" @click="nextPage">下一頁 ▶</button>
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
      <button class="btn-ghost" @click="onClose">取消</button>
      <button class="btn-ghost" :disabled="stepIdx === 0" @click="prev">上一步</button>
      <button class="btn-primary" @click="next">{{ isLast ? '加入購物車' : '下一步' }}</button>
    </template>
  </Modal>
</template>

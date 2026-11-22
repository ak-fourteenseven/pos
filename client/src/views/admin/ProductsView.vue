<script setup>
/* draft-then-commit */
import { computed, onMounted, ref } from 'vue';
import { api } from '@shared/api';
import { useCatalogStore } from '@shared/stores/catalog';
import { useToastStore } from '@shared/stores/toast';
import Modal from '@shared/components/Modal.vue';
import { COLOR_LIST, EMOJI_LIST, fmtMoney } from '@shared/utils/format';

const catalog = useCatalogStore();
const toast = useToastStore();

const keyword = ref('');
const filterCat = ref(0); // 0 = 全部
const showAll = ref(true);

/* ---------------- 菜品 ---------------- */
const prodModal = ref(false);
const prodForm = ref({
  id: null, category_id: 0, name: '', price: '', barcode: '',
  emoji: '🍽️', color: '#f59e0b', is_available: true,
  use_custom_specs: false, product_specs: [],
  use_custom_options: false, product_option_groups: [],
});
const newSpecName = ref('');
const newSpecPrice = ref(0);
const editingSpecId = ref(null);
const editName = ref('');
const editPrice = ref(0);
const dragFrom = ref(null);

const expandedGroupId = ref(null);
const editingGroupId = ref(null);
const editGroupCode = ref('');
const editGroupName = ref('');
const editGroupMulti = ref(false);
const editGroupRequired = ref(true);
const groupDragFrom = ref(null);
const newItemName = ref('');
const newItemPrice = ref(0);
const newItemDefault = ref(false);
const editingItemId = ref(null);
const editItemName = ref('');
const editItemPrice = ref(0);
const editItemDefault = ref(false);
const itemDragFrom = ref(null);

let tmpId = 0;
function nextTempId() {
  return --tmpId;
}

const draftSnapshot = ref('');

const categoryDefaultSpecs = computed(() => {
  const cat = catalog.categories.find((c) => c.id === prodForm.value.category_id);
  return cat?.specs || [];
});
const categoryDefaultOptionGroups = computed(() => {
  const cat = catalog.categories.find((c) => c.id === prodForm.value.category_id);
  return cat?.option_groups || [];
});
const hasCategoryOptionGroups = computed(() => categoryDefaultOptionGroups.value.length > 0);

function cloneSpecs(list) {
  return (list || []).map((s) => ({
    id: s.id ?? nextTempId(),
    name: s.name,
    price_diff: Number(s.price_diff) || 0,
  }));
}
function cloneGroups(list) {
  return (list || []).map((g) => ({
    id: g.id ?? nextTempId(),
    code: g.code,
    name: g.name,
    is_multi: Number(g.is_multi) ? 1 : 0,
    required: Number(g.required) ? 1 : 0,
    items: (g.items || []).map((it) => ({
      id: it.id ?? nextTempId(),
      name: it.name,
      price_diff: Number(it.price_diff) || 0,
      is_default: Number(it.is_default) ? 1 : 0,
    })),
  }));
}

function draftState() {
  const f = prodForm.value;
  return {
    id: f.id,
    category_id: f.category_id || 0,
    name: f.name,
    price: f.price === '' || f.price == null ? '' : Number(f.price),
    barcode: f.barcode || '',
    emoji: f.emoji,
    color: f.color,
    is_available: !!f.is_available,
    use_custom_specs: !!f.use_custom_specs,
    use_custom_options: !!f.use_custom_options,
    product_specs: (f.product_specs || []).map((s) => ({
      name: s.name,
      price_diff: Number(s.price_diff) || 0,
    })),
    product_option_groups: (f.product_option_groups || []).map((g) => ({
      code: g.code,
      name: g.name,
      is_multi: Number(g.is_multi) ? 1 : 0,
      required: Number(g.required) ? 1 : 0,
      items: (g.items || []).map((it) => ({
        name: it.name,
        price_diff: Number(it.price_diff) || 0,
        is_default: Number(it.is_default) ? 1 : 0,
      })),
    })),
  };
}

function captureSnapshot() {
  draftSnapshot.value = JSON.stringify(draftState());
}

function isDirty() {
  return JSON.stringify(draftState()) !== draftSnapshot.value;
}

function requestClose() {
  if (isDirty() && !confirm('捨棄未儲存的變更？')) return;
  prodModal.value = false;
}

function onProdModalUpdate(v) {
  if (v) prodModal.value = true;
  else requestClose();
}

function resetEditUi() {
  newSpecName.value = '';
  newSpecPrice.value = 0;
  editingSpecId.value = null;
  dragFrom.value = null;
  expandedGroupId.value = null;
  editingGroupId.value = null;
  editingItemId.value = null;
  newItemName.value = '';
  newItemPrice.value = 0;
  newItemDefault.value = false;
}

function openProduct(p = null) {
  resetEditUi();
  prodForm.value = p
    ? {
        id: p.id,
        category_id: p.category_id || 0,
        name: p.name,
        price: p.price,
        barcode: p.barcode || '',
        emoji: p.emoji || '🍽️',
        color: p.color || '#f59e0b',
        is_available: Number(p.is_available) === 1,
        use_custom_specs: Number(p.use_custom_specs) === 1,
        product_specs: cloneSpecs(p.product_specs),
        use_custom_options: Number(p.use_custom_options) === 1,
        product_option_groups: cloneGroups(p.product_option_groups),
      }
    : {
        id: null,
        category_id: catalog.categories[0]?.id || 0,
        name: '', price: '', barcode: '',
        emoji: '🍽️', color: '#f59e0b', is_available: true,
        use_custom_specs: false, product_specs: [],
        use_custom_options: false, product_option_groups: [],
      };
  captureSnapshot();
  prodModal.value = true;
}

function toggleCustomSpecs(on) {
  if (on) {
    if (!(prodForm.value.product_specs || []).length) {
      prodForm.value.product_specs = cloneSpecs(categoryDefaultSpecs.value);
    }
    prodForm.value.use_custom_specs = true;
  } else {
    prodForm.value.use_custom_specs = false;
  }
}

function addProductTag() {
  const name = String(newSpecName.value || '').trim();
  if (!name) {
    toast.error('請輸入規格名稱');
    return;
  }
  prodForm.value.product_specs = [
    ...(prodForm.value.product_specs || []),
    { id: nextTempId(), name, price_diff: Number(newSpecPrice.value) || 0 },
  ];
  prodForm.value.use_custom_specs = true;
  newSpecName.value = '';
  newSpecPrice.value = 0;
}

function startEditSpec(spec) {
  editingSpecId.value = spec.id;
  editName.value = spec.name;
  editPrice.value = Number(spec.price_diff) || 0;
}
function cancelEditSpec() {
  editingSpecId.value = null;
}
function saveEditSpec() {
  if (editingSpecId.value == null) return;
  const name = String(editName.value || '').trim();
  if (!name) {
    toast.error('請輸入規格名稱');
    return;
  }
  prodForm.value.product_specs = (prodForm.value.product_specs || []).map((s) => (
    s.id === editingSpecId.value
      ? { ...s, name, price_diff: Number(editPrice.value) || 0 }
      : s
  ));
  editingSpecId.value = null;
}

function deleteProductTag(spec) {
  prodForm.value.product_specs = (prodForm.value.product_specs || []).filter((s) => s.id !== spec.id);
  if (editingSpecId.value === spec.id) editingSpecId.value = null;
}

function onDragStart(i, e) {
  dragFrom.value = i;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(i));
}
function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}
function onDrop(toIdx, e) {
  e.preventDefault();
  const fromIdx = dragFrom.value;
  dragFrom.value = null;
  if (fromIdx == null || fromIdx === toIdx) return;
  const list = [...(prodForm.value.product_specs || [])];
  const [moved] = list.splice(fromIdx, 1);
  list.splice(toIdx, 0, moved);
  prodForm.value.product_specs = list;
}

function toggleCustomOptions(on) {
  if (on) {
    if (!(prodForm.value.product_option_groups || []).length) {
      prodForm.value.product_option_groups = cloneGroups(categoryDefaultOptionGroups.value);
    }
    prodForm.value.use_custom_options = true;
  } else {
    prodForm.value.use_custom_options = false;
  }
}

function startEditGroup(g) {
  editingGroupId.value = g.id;
  editGroupCode.value = g.code;
  editGroupName.value = g.name;
  editGroupMulti.value = Number(g.is_multi) === 1;
  editGroupRequired.value = Number(g.required) === 1;
}
function cancelEditGroup() {
  editingGroupId.value = null;
}
function saveEditGroup() {
  if (editingGroupId.value == null) return;
  const code = String(editGroupCode.value || '').trim();
  const name = String(editGroupName.value || '').trim();
  if (!code || !name) {
    toast.error('請輸入選項組代碼與名稱');
    return;
  }
  prodForm.value.product_option_groups = (prodForm.value.product_option_groups || []).map((g) => (
    g.id === editingGroupId.value
      ? {
          ...g,
          code,
          name,
          is_multi: editGroupMulti.value ? 1 : 0,
          required: editGroupRequired.value ? 1 : 0,
        }
      : g
  ));
  editingGroupId.value = null;
}
function deleteGroup(g) {
  if (!confirm(`確定刪除選項組「${g.name}」？`)) return;
  prodForm.value.product_option_groups = (prodForm.value.product_option_groups || []).filter((x) => x.id !== g.id);
  if (expandedGroupId.value === g.id) expandedGroupId.value = null;
  if (editingGroupId.value === g.id) editingGroupId.value = null;
}
function onGroupDragStart(i, e) {
  groupDragFrom.value = i;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(i));
}
function onDragOverOpt(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}
function onGroupDrop(toIdx, e) {
  e.preventDefault();
  const fromIdx = groupDragFrom.value;
  groupDragFrom.value = null;
  if (fromIdx == null || fromIdx === toIdx) return;
  const list = [...(prodForm.value.product_option_groups || [])];
  const [moved] = list.splice(fromIdx, 1);
  list.splice(toIdx, 0, moved);
  prodForm.value.product_option_groups = list;
}

function addItem(group) {
  const name = String(newItemName.value || '').trim();
  if (!name) {
    toast.error('請輸入選項名稱');
    return;
  }
  const isDefault = newItemDefault.value;
  prodForm.value.product_option_groups = (prodForm.value.product_option_groups || []).map((g) => {
    if (g.id !== group.id) return g;
    let items = [...(g.items || [])];
    if (isDefault) items = items.map((it) => ({ ...it, is_default: 0 }));
    items.push({
      id: nextTempId(),
      name,
      price_diff: Number(newItemPrice.value) || 0,
      is_default: isDefault ? 1 : 0,
    });
    return { ...g, items };
  });
  newItemName.value = '';
  newItemPrice.value = 0;
  newItemDefault.value = false;
}
function startEditItem(it) {
  editingItemId.value = it.id;
  editItemName.value = it.name;
  editItemPrice.value = Number(it.price_diff) || 0;
  editItemDefault.value = Number(it.is_default) === 1;
}
function cancelEditItem() {
  editingItemId.value = null;
}
function saveEditItem(group) {
  if (editingItemId.value == null) return;
  const name = String(editItemName.value || '').trim();
  if (!name) {
    toast.error('請輸入選項名稱');
    return;
  }
  const isDefault = editItemDefault.value;
  prodForm.value.product_option_groups = (prodForm.value.product_option_groups || []).map((g) => {
    if (g.id !== group.id) return g;
    const items = (g.items || []).map((it) => {
      if (it.id === editingItemId.value) {
        return {
          ...it,
          name,
          price_diff: Number(editItemPrice.value) || 0,
          is_default: isDefault ? 1 : 0,
        };
      }
      if (isDefault) return { ...it, is_default: 0 };
      return it;
    });
    return { ...g, items };
  });
  editingItemId.value = null;
}
function deleteItem(group, it) {
  prodForm.value.product_option_groups = (prodForm.value.product_option_groups || []).map((g) => {
    if (g.id !== group.id) return g;
    return { ...g, items: (g.items || []).filter((x) => x.id !== it.id) };
  });
  if (editingItemId.value === it.id) editingItemId.value = null;
}
function onItemDragStart(i, e) {
  itemDragFrom.value = i;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(i));
}
function onItemDrop(group, toIdx, e) {
  e.preventDefault();
  const fromIdx = itemDragFrom.value;
  itemDragFrom.value = null;
  if (fromIdx == null || fromIdx === toIdx) return;
  prodForm.value.product_option_groups = (prodForm.value.product_option_groups || []).map((g) => {
    if (g.id !== group.id) return g;
    const list = [...(g.items || [])];
    const [moved] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, moved);
    return { ...g, items: list };
  });
}

function nestedPayload(f) {
  const payload = {};
  if (f.use_custom_specs) {
    payload.specs = (f.product_specs || []).map((s) => ({
      name: String(s.name || '').trim(),
      price_diff: Number(s.price_diff) || 0,
    }));
  }
  if (f.use_custom_options) {
    payload.option_groups = (f.product_option_groups || []).map((g) => ({
      code: String(g.code || '').trim(),
      name: String(g.name || '').trim(),
      is_multi: Number(g.is_multi) ? 1 : 0,
      required: Number(g.required) ? 1 : 0,
      items: (g.items || []).map((it) => ({
        name: String(it.name || '').trim(),
        price_diff: Number(it.price_diff) || 0,
        is_default: Number(it.is_default) ? 1 : 0,
      })),
    }));
  }
  return payload;
}

async function saveProduct() {
  const f = prodForm.value;
  if (!f.name.trim() || f.price === '') {
    toast.error('請輸入名稱與價格');
    return;
  }
  try {
    const payload = {
      category_id: f.category_id || null,
      name: f.name.trim(),
      price: Number(f.price),
      barcode: f.barcode || null,
      emoji: f.emoji,
      color: f.color,
      is_available: f.is_available ? 1 : 0,
      use_custom_specs: f.use_custom_specs ? 1 : 0,
      use_custom_options: f.use_custom_options ? 1 : 0,
      ...nestedPayload(f),
    };
    if (f.id) await api.put(`/products/${f.id}`, payload);
    else await api.post('/products', payload);
    captureSnapshot();
    prodModal.value = false;
    await catalog.loadAll();
    toast.success('菜品已儲存');
  } catch (e) {
    toast.error(e.message);
  }
}
async function deleteProduct(p) {
  if (!confirm(`確定刪除菜品「${p.name}」？`)) return;
  try {
    await api.del(`/products/${p.id}`);
    await catalog.loadAll();
    toast.success('菜品已刪除');
  } catch (e) {
    toast.error(e.message);
  }
}
async function toggleAvailable(p) {
  try {
    await api.put(`/products/${p.id}`, { is_available: Number(p.is_available) === 1 ? 0 : 1 });
    await catalog.loadAll();
  } catch (e) {
    toast.error(e.message);
  }
}

const products = computed(() => {
  let list = catalog.products;
  if (!showAll.value) list = list.filter((p) => Number(p.is_available) === 1);
  if (filterCat.value) list = list.filter((p) => p.category_id === filterCat.value);
  const kw = keyword.value.trim();
  if (kw) list = list.filter((p) => p.name.includes(kw) || (p.barcode || '').includes(kw));
  // 上架中在前，已下架在後；同狀態維持 id 順序
  return [...list].sort((a, b) => {
    const av = Number(a.is_available) === 1 ? 0 : 1;
    const bv = Number(b.is_available) === 1 ? 0 : 1;
    if (av !== bv) return av - bv;
    return Number(a.id) - Number(b.id);
  });
});

onMounted(async () => {
  try {
    await catalog.loadAll();
  } catch (e) {
    toast.error(e.message);
  }
});
</script>

<template>
  <div class="h-full overflow-y-auto p-5">
    <div class="flex items-center gap-2 mb-3 flex-wrap">
      <select v-model="filterCat" class="input !w-40">
        <option :value="0">全部分類</option>
        <option v-for="c in catalog.categories" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
      <input v-model="keyword" class="input !w-56" placeholder="搜尋名稱 / 條碼…" />
      <label class="flex items-center gap-1.5 text-sm text-gray-500 cursor-pointer">
        <input v-model="showAll" type="checkbox" class="accent-brand-500" />顯示已下架
      </label>
      <div class="flex-1" />
      <button class="btn-primary" @click="openProduct()">＋ 新增菜品</button>
    </div>

    <div class="card overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-xs text-gray-400 border-b bg-gray-50">
            <th class="py-2.5 px-4">菜品</th>
            <th class="py-2.5 px-4">分類</th>
            <th class="py-2.5 px-4">價格</th>
            <th class="py-2.5 px-4">規格</th>
            <th class="py-2.5 px-4 text-center">狀態</th>
            <th class="py-2.5 px-4 text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in products" :key="p.id" class="border-b border-gray-50 hover:bg-gray-50">
            <td class="py-2.5 px-4">
              <div class="flex items-center gap-2">
                <span
                  class="w-8 h-8 rounded-lg flex items-center justify-center text-base shrink-0"
                  :style="{ background: (p.color || '#f59e0b') + '22' }"
                >{{ p.emoji || '🍽️' }}</span>
                <div class="min-w-0">
                  <div class="font-extrabold truncate">{{ p.name }}</div>
                  <div v-if="p.barcode" class="text-[11px] text-gray-400">{{ p.barcode }}</div>
                </div>
              </div>
            </td>
            <td class="py-2.5 px-4 text-gray-500">
              {{ catalog.categories.find((c) => c.id === p.category_id)?.name || '—' }}
            </td>
            <td class="py-2.5 px-4 font-bold">{{ fmtMoney(p.price, catalog.currency) }}</td>
            <td class="py-2.5 px-4 text-xs text-gray-500">
              <span v-if="Number(p.use_custom_specs)">自訂 {{ (p.product_specs || []).length }}</span>
              <span v-else>繼承</span>
            </td>
            <td class="py-2.5 px-4 text-center">
              <button
                class="text-xs font-bold px-2 py-0.5 rounded-full"
                :class="Number(p.is_available) === 1 ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-400'"
                @click="toggleAvailable(p)"
              >
                {{ Number(p.is_available) === 1 ? '上架' : '下架' }}
              </button>
            </td>
            <td class="py-2.5 px-4 text-right whitespace-nowrap">
              <button class="btn-ghost btn-sm" @click="openProduct(p)">編輯</button>
              <button class="btn-ghost btn-sm !text-red-500 ml-1" @click="deleteProduct(p)">刪除</button>
            </td>
          </tr>
          <tr v-if="!products.length">
            <td colspan="6" class="py-10 text-center text-gray-300">尚無菜品</td>
          </tr>
        </tbody>
      </table>
    </div>

    <Modal
      :model-value="prodModal"
      :title="prodForm.id ? '編輯菜品' : '新增菜品'"
      width="max-w-2xl"
      @update:model-value="onProdModalUpdate"
    >
      <div class="space-y-4">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="label">名稱 *</label>
            <input v-model="prodForm.name" class="input" placeholder="菜品名稱" />
          </div>
          <div>
            <label class="label">分類</label>
            <select v-model="prodForm.category_id" class="input">
              <option v-for="c in catalog.categories" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="label">價格 *</label>
            <input v-model="prodForm.price" type="number" min="0" class="input" placeholder="0" />
          </div>
          <div>
            <label class="label">條碼（選填）</label>
            <input v-model="prodForm.barcode" class="input" placeholder="條碼編號" />
          </div>
        </div>

        <div>
          <label class="label">圖示（emoji）</label>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="e in EMOJI_LIST"
              :key="e"
              class="w-9 h-9 rounded-lg border-2 text-lg leading-none"
              :class="prodForm.emoji === e ? 'border-brand-500 bg-brand-50' : 'border-gray-200'"
              @click="prodForm.emoji = e"
            >
              {{ e }}
            </button>
          </div>
        </div>

        <div>
          <label class="label">標記顏色</label>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="c in COLOR_LIST"
              :key="c"
              class="w-8 h-8 rounded-full border-2 transition"
              :class="prodForm.color === c ? 'border-gray-800 scale-110' : 'border-transparent'"
              :style="{ background: c }"
              @click="prodForm.color = c"
            />
          </div>
        </div>

        <div class="border-t border-gray-100 pt-3">
          <div class="flex items-center justify-between mb-2">
            <label class="label !mb-0">規格</label>
            <div class="flex items-center gap-3">
              <span v-if="prodForm.use_custom_specs" class="text-xs text-gray-400">點擊編輯 · 拖曳排序 · 儲存後才寫入</span>
              <label class="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                <input
                  type="checkbox"
                  class="accent-brand-500"
                  :checked="prodForm.use_custom_specs"
                  @change="toggleCustomSpecs($event.target.checked)"
                />
                覆寫分類預設
              </label>
            </div>
          </div>

          <!-- 繼承分類：唯讀預覽 -->
          <div v-if="!prodForm.use_custom_specs" class="space-y-2">
            <div
              v-for="s in categoryDefaultSpecs"
              :key="s.id"
              class="rounded-xl border border-gray-100 bg-gray-50 px-2.5 py-2 flex items-center gap-2"
            >
              <span class="flex-1 text-sm font-bold text-gray-500 truncate">
                {{ s.name }}
                <span v-if="Number(s.price_diff)" class="ml-1 text-xs font-normal text-brand-600">
                  {{ Number(s.price_diff) > 0 ? '+' : '' }}{{ fmtMoney(s.price_diff, catalog.currency) }}
                </span>
              </span>
            </div>
            <p v-if="!categoryDefaultSpecs.length" class="text-xs text-gray-300 py-1">分類尚無預設規格</p>
          </div>

          <!-- 覆寫：可編輯／拖曳列表（僅草稿） -->
          <div v-else class="space-y-2">
            <div
              v-for="(s, i) in prodForm.product_specs"
              :key="s.id"
              class="rounded-xl border border-gray-200 bg-white"
              :class="dragFrom === i ? 'opacity-60' : ''"
              :draggable="editingSpecId !== s.id"
              @dragstart="onDragStart(i, $event)"
              @dragover="onDragOver"
              @drop="onDrop(i, $event)"
            >
              <div v-if="editingSpecId === s.id" class="flex flex-wrap items-center gap-2 p-2.5" @click.stop>
                <input v-model="editName" class="input !py-1.5 !text-sm flex-1 min-w-[8rem]" placeholder="名稱" @keydown.enter.prevent="saveEditSpec" />
                <input v-model.number="editPrice" type="number" class="input !py-1.5 !text-sm !w-24" placeholder="加價" @keydown.enter.prevent="saveEditSpec" />
                <button type="button" class="btn-primary btn-sm" @click="saveEditSpec">確定</button>
                <button type="button" class="btn-ghost btn-sm" @click="cancelEditSpec">取消</button>
              </div>
              <div v-else class="flex items-center gap-2 px-2.5 py-2 cursor-grab active:cursor-grabbing">
                <span class="text-gray-300 text-xs select-none" title="拖曳排序">⋮⋮</span>
                <button
                  type="button"
                  class="flex-1 text-left text-sm font-bold text-gray-700 truncate"
                  @click="startEditSpec(s)"
                >
                  {{ s.name }}
                  <span v-if="Number(s.price_diff)" class="ml-1 text-xs font-normal text-brand-600">
                    {{ Number(s.price_diff) > 0 ? '+' : '' }}{{ fmtMoney(s.price_diff, catalog.currency) }}
                  </span>
                </button>
                <button type="button" class="btn-ghost btn-sm !text-red-500 !px-2" title="刪除" @click.stop="deleteProductTag(s)">×</button>
              </div>
            </div>

            <p v-if="!prodForm.product_specs.length" class="text-xs text-gray-300 py-1">尚無規格</p>

            <div class="flex gap-1.5 items-center pt-1">
              <input
                v-model="newSpecName"
                class="input !py-1.5 !text-sm flex-1"
                placeholder="新增規格名稱"
                @keydown.enter.prevent="addProductTag"
              />
              <input
                v-model.number="newSpecPrice"
                type="number"
                class="input !py-1.5 !text-sm !w-24"
                placeholder="加價"
                @keydown.enter.prevent="addProductTag"
              />
              <button type="button" class="btn-ghost btn-sm" @click="addProductTag">＋</button>
            </div>
          </div>
        </div>

        <!-- 選項組覆寫 -->
        <div v-if="hasCategoryOptionGroups || prodForm.use_custom_options" class="border-t border-gray-100 pt-3">
          <div class="flex items-center justify-between mb-2">
            <label class="label !mb-0">選項組</label>
            <div class="flex items-center gap-3">
              <label class="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                <input
                  type="checkbox"
                  class="accent-brand-500"
                  :checked="prodForm.use_custom_options"
                  @change="toggleCustomOptions($event.target.checked)"
                />
                覆寫分類選項
              </label>
            </div>
          </div>

          <div v-if="!prodForm.use_custom_options" class="space-y-2">
            <div
              v-for="g in categoryDefaultOptionGroups"
              :key="g.id"
              class="rounded-xl border border-gray-100 bg-gray-50 px-2.5 py-2"
            >
              <div class="text-sm font-bold text-gray-500">{{ g.name }}</div>
              <div class="text-[11px] text-gray-400 mt-0.5">
                {{ g.code }} · {{ (g.items || []).map((it) => it.name).join('、') || '無選項' }}
              </div>
            </div>
            <p v-if="!categoryDefaultOptionGroups.length" class="text-xs text-gray-300 py-1">分類尚無選項組</p>
          </div>

          <div v-else class="space-y-2">
            <div
              v-for="(g, gi) in prodForm.product_option_groups"
              :key="g.id"
              class="rounded-xl border border-gray-200 bg-white"
              :class="groupDragFrom === gi ? 'opacity-60' : ''"
            >
              <div v-if="editingGroupId === g.id" class="space-y-2 p-2.5" @click.stop>
                <div class="flex flex-wrap gap-2">
                  <input v-model="editGroupCode" class="input !py-1.5 !text-sm !w-28" placeholder="代碼" />
                  <input v-model="editGroupName" class="input !py-1.5 !text-sm flex-1 min-w-[8rem]" placeholder="名稱" />
                </div>
                <div class="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                  <label class="flex items-center gap-1 cursor-pointer">
                    <input v-model="editGroupMulti" type="checkbox" class="accent-brand-500" />多選
                  </label>
                  <label class="flex items-center gap-1 cursor-pointer">
                    <input v-model="editGroupRequired" type="checkbox" class="accent-brand-500" />必選
                  </label>
                  <div class="flex-1" />
                  <button type="button" class="btn-primary btn-sm" @click="saveEditGroup">確定</button>
                  <button type="button" class="btn-ghost btn-sm" @click="cancelEditGroup">取消</button>
                </div>
              </div>
              <div
                v-else
                class="flex items-center gap-2 px-2.5 py-2"
                draggable="true"
                @dragstart="onGroupDragStart(gi, $event)"
                @dragover="onDragOverOpt"
                @drop="onGroupDrop(gi, $event)"
              >
                <span class="text-gray-300 text-xs cursor-grab">⋮⋮</span>
                <button type="button" class="flex-1 text-left" @click="expandedGroupId = expandedGroupId === g.id ? null : g.id">
                  <div class="text-sm font-bold text-gray-700">{{ g.name }}</div>
                  <div class="text-[11px] text-gray-400">
                    {{ g.code }} · {{ Number(g.is_multi) ? '多選' : '單選' }} · {{ (g.items || []).length }} 項
                  </div>
                </button>
                <button type="button" class="btn-ghost btn-sm" @click.stop="startEditGroup(g)">編輯</button>
                <button type="button" class="btn-ghost btn-sm !text-red-500 !px-2" @click.stop="deleteGroup(g)">×</button>
              </div>

              <div v-if="expandedGroupId === g.id && editingGroupId !== g.id" class="border-t border-gray-100 px-2.5 py-2 space-y-1.5 bg-gray-50/80">
                <div
                  v-for="(it, ii) in g.items || []"
                  :key="it.id"
                  class="rounded-lg border border-gray-200 bg-white"
                  :draggable="editingItemId !== it.id"
                  @dragstart="onItemDragStart(ii, $event)"
                  @dragover="onDragOverOpt"
                  @drop="onItemDrop(g, ii, $event)"
                >
                  <div v-if="editingItemId === it.id" class="flex flex-wrap items-center gap-2 p-2" @click.stop>
                    <input v-model="editItemName" class="input !py-1 !text-sm flex-1 min-w-[6rem]" @keydown.enter.prevent="saveEditItem(g)" />
                    <input v-model.number="editItemPrice" type="number" class="input !py-1 !text-sm !w-20" @keydown.enter.prevent="saveEditItem(g)" />
                    <label class="flex items-center gap-1 text-xs text-gray-500">
                      <input v-model="editItemDefault" type="checkbox" class="accent-brand-500" />預設
                    </label>
                    <button type="button" class="btn-primary btn-sm" @click="saveEditItem(g)">確定</button>
                    <button type="button" class="btn-ghost btn-sm" @click="cancelEditItem">取消</button>
                  </div>
                  <div v-else class="flex items-center gap-2 px-2 py-1.5 cursor-grab">
                    <span class="text-gray-300 text-xs">⋮⋮</span>
                    <button type="button" class="flex-1 text-left text-sm font-bold text-gray-700 truncate" @click="startEditItem(it)">
                      {{ it.name }}
                      <span v-if="Number(it.price_diff)" class="ml-1 text-xs font-normal text-brand-600">
                        {{ Number(it.price_diff) > 0 ? '+' : '' }}{{ fmtMoney(it.price_diff, catalog.currency) }}
                      </span>
                    </button>
                    <button type="button" class="btn-ghost btn-sm !text-red-500 !px-2" @click.stop="deleteItem(g, it)">×</button>
                  </div>
                </div>
                <div class="flex flex-wrap gap-1.5 items-center pt-1">
                  <input v-model="newItemName" class="input !py-1 !text-sm flex-1 min-w-[6rem]" placeholder="新增選項" @keydown.enter.prevent="addItem(g)" />
                  <input v-model.number="newItemPrice" type="number" class="input !py-1 !text-sm !w-20" placeholder="加價" @keydown.enter.prevent="addItem(g)" />
                  <label class="flex items-center gap-1 text-xs text-gray-500">
                    <input v-model="newItemDefault" type="checkbox" class="accent-brand-500" />預設
                  </label>
                  <button type="button" class="btn-ghost btn-sm" @click="addItem(g)">＋</button>
                </div>
              </div>
            </div>
            <p v-if="!prodForm.product_option_groups.length" class="text-xs text-gray-300 py-1">尚無選項組</p>
          </div>
        </div>

        <label class="flex items-center gap-2 text-sm font-bold text-gray-600 cursor-pointer">
          <input v-model="prodForm.is_available" type="checkbox" class="accent-brand-500" />上架銷售
        </label>
      </div>
      <template #footer>
        <button class="btn-ghost" @click="requestClose">取消</button>
        <button class="btn-primary" @click="saveProduct">儲存</button>
      </template>
    </Modal>
  </div>
</template>

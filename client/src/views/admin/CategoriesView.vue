<script setup>
/* option-groups-ui — draft-then-commit */
import { onMounted, ref } from 'vue';
import { api } from '@shared/api';
import { useCatalogStore } from '@shared/stores/catalog';
import { useToastStore } from '@shared/stores/toast';
import Modal from '@shared/components/Modal.vue';
import { fmtMoney } from '@shared/utils/format';

const catalog = useCatalogStore();
const toast = useToastStore();

const catModal = ref(false);
const catForm = ref({ id: null, name: '', sort_order: 0, include_drink_step: false });
/** 彈窗內規格清單（可拖曳排序） */
const modalSpecs = ref([]);
const newSpecName = ref('');
const newSpecPrice = ref(0);
const editingSpecId = ref(null);
const editName = ref('');
const editPrice = ref(0);
const dragFrom = ref(null);

/** 選項組 */
const modalGroups = ref([]);
const expandedGroupId = ref(null);
const newGroupCode = ref('');
const newGroupName = ref('');
const newGroupMulti = ref(false);
const newGroupRequired = ref(true);
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

function cloneSpecs(list) {
  return (list || []).map((s) => ({ ...s }));
}
function cloneGroups(list) {
  return (list || []).map((g) => ({
    ...g,
    items: (g.items || []).map((it) => ({ ...it })),
  }));
}

function draftState() {
  return {
    id: catForm.value.id,
    name: catForm.value.name,
    sort_order: Number(catForm.value.sort_order) || 0,
    include_drink_step: !!catForm.value.include_drink_step,
    specs: modalSpecs.value.map((s) => ({
      name: s.name,
      price_diff: Number(s.price_diff) || 0,
    })),
    option_groups: modalGroups.value.map((g) => ({
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
  catModal.value = false;
}

function onCatModalUpdate(v) {
  if (v) catModal.value = true;
  else requestClose();
}

function specsPreview(cat) {
  const names = (cat.specs || []).map((s) => s.name).filter(Boolean);
  return names.length ? names.join('、') : '—';
}
function groupsPreview(cat) {
  const names = (cat.option_groups || []).map((g) => g.name).filter(Boolean);
  return names.length ? names.join('、') : '—';
}

function openCat(cat = null) {
  editingSpecId.value = null;
  newSpecName.value = '';
  newSpecPrice.value = 0;
  dragFrom.value = null;
  editingGroupId.value = null;
  editingItemId.value = null;
  expandedGroupId.value = null;
  newGroupCode.value = '';
  newGroupName.value = '';
  newGroupMulti.value = false;
  newGroupRequired.value = true;
  newItemName.value = '';
  newItemPrice.value = 0;
  newItemDefault.value = false;
  if (cat) {
    catForm.value = {
      id: cat.id,
      name: cat.name,
      sort_order: cat.sort_order,
      include_drink_step: Number(cat.include_drink_step) === 1,
    };
    modalSpecs.value = cloneSpecs(cat.specs);
    modalGroups.value = cloneGroups(cat.option_groups);
  } else {
    catForm.value = {
      id: null,
      name: '',
      sort_order: catalog.categories.length + 1,
      include_drink_step: false,
    };
    modalSpecs.value = [];
    modalGroups.value = [];
  }
  captureSnapshot();
  catModal.value = true;
}

function nestedPayload() {
  return {
    specs: modalSpecs.value.map((s) => ({
      name: String(s.name || '').trim(),
      price_diff: Number(s.price_diff) || 0,
    })),
    option_groups: modalGroups.value.map((g) => ({
      code: String(g.code || '').trim(),
      name: String(g.name || '').trim(),
      is_multi: Number(g.is_multi) ? 1 : 0,
      required: Number(g.required) ? 1 : 0,
      items: (g.items || []).map((it) => ({
        name: String(it.name || '').trim(),
        price_diff: Number(it.price_diff) || 0,
        is_default: Number(it.is_default) ? 1 : 0,
      })),
    })),
  };
}

async function saveCat() {
  if (!catForm.value.name.trim()) {
    toast.error('請輸入分類名稱');
    return;
  }
  try {
    const payload = {
      name: catForm.value.name.trim(),
      sort_order: catForm.value.sort_order,
      include_drink_step: catForm.value.include_drink_step ? 1 : 0,
      ...nestedPayload(),
    };
    if (catForm.value.id) await api.put(`/categories/${catForm.value.id}`, payload);
    else await api.post('/categories', payload);
    captureSnapshot();
    catModal.value = false;
    await catalog.loadAll();
    toast.success('分類已儲存');
  } catch (e) {
    toast.error(e.message);
  }
}

async function deleteCat(cat) {
  if (!confirm(`確定刪除分類「${cat.name}」？該分類下菜品將全部下架。`)) return;
  try {
    await api.del(`/categories/${cat.id}`);
    await catalog.loadAll();
    toast.success('分類已刪除');
  } catch (e) {
    toast.error(e.message);
  }
}

function addSpec() {
  const name = String(newSpecName.value || '').trim();
  if (!name) {
    toast.error('請輸入規格名稱');
    return;
  }
  modalSpecs.value = [
    ...modalSpecs.value,
    { id: nextTempId(), name, price_diff: Number(newSpecPrice.value) || 0 },
  ];
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
  modalSpecs.value = modalSpecs.value.map((s) => (
    s.id === editingSpecId.value
      ? { ...s, name, price_diff: Number(editPrice.value) || 0 }
      : s
  ));
  editingSpecId.value = null;
}

function deleteSpec(spec) {
  modalSpecs.value = modalSpecs.value.filter((s) => s.id !== spec.id);
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
  const list = [...modalSpecs.value];
  const [moved] = list.splice(fromIdx, 1);
  list.splice(toIdx, 0, moved);
  modalSpecs.value = list;
}

/* ---- 選項組 ---- */
function addGroup() {
  const code = String(newGroupCode.value || '').trim();
  const name = String(newGroupName.value || '').trim();
  if (!code || !name) {
    toast.error('請輸入選項組代碼與名稱');
    return;
  }
  const id = nextTempId();
  modalGroups.value = [
    ...modalGroups.value,
    {
      id,
      code,
      name,
      is_multi: newGroupMulti.value ? 1 : 0,
      required: newGroupRequired.value ? 1 : 0,
      items: [],
    },
  ];
  newGroupCode.value = '';
  newGroupName.value = '';
  newGroupMulti.value = false;
  newGroupRequired.value = true;
  expandedGroupId.value = id;
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
  modalGroups.value = modalGroups.value.map((g) => (
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
  modalGroups.value = modalGroups.value.filter((x) => x.id !== g.id);
  if (expandedGroupId.value === g.id) expandedGroupId.value = null;
  if (editingGroupId.value === g.id) editingGroupId.value = null;
}
function onGroupDragStart(i, e) {
  groupDragFrom.value = i;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(i));
}
function onGroupDrop(toIdx, e) {
  e.preventDefault();
  const fromIdx = groupDragFrom.value;
  groupDragFrom.value = null;
  if (fromIdx == null || fromIdx === toIdx) return;
  const list = [...modalGroups.value];
  const [moved] = list.splice(fromIdx, 1);
  list.splice(toIdx, 0, moved);
  modalGroups.value = list;
}

function addItem(group) {
  const name = String(newItemName.value || '').trim();
  if (!name) {
    toast.error('請輸入選項名稱');
    return;
  }
  const isDefault = newItemDefault.value;
  modalGroups.value = modalGroups.value.map((g) => {
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
  modalGroups.value = modalGroups.value.map((g) => {
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
  modalGroups.value = modalGroups.value.map((g) => {
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
  modalGroups.value = modalGroups.value.map((g) => {
    if (g.id !== group.id) return g;
    const list = [...(g.items || [])];
    const [moved] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, moved);
    return { ...g, items: list };
  });
}

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
    <div class="flex items-center mb-4">
      <p class="text-sm text-gray-500">共 {{ catalog.categories.length }} 個分類 · 規格／選項組於編輯彈窗管理</p>
      <div class="flex-1" />
      <button class="btn-primary" @click="openCat()">＋ 新增分類</button>
    </div>

    <div class="card overflow-x-auto">
      <table class="w-full text-sm table-fixed">
        <thead>
          <tr class="text-left text-xs text-gray-400 border-b bg-gray-50">
            <th class="py-2.5 px-4 w-16">排序</th>
            <th class="py-2.5 px-4 w-40">分類名稱</th>
            <th class="py-2.5 px-4 w-20">菜品數</th>
            <th class="py-2.5 px-4">規格</th>
            <th class="py-2.5 px-4">選項組</th>
            <th class="py-2.5 px-4 w-28 text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in catalog.categories" :key="c.id" class="border-b border-gray-50 hover:bg-gray-50">
            <td class="py-2.5 px-4 text-gray-500">{{ c.sort_order }}</td>
            <td class="py-2.5 px-4 font-extrabold truncate">{{ c.name }}</td>
            <td class="py-2.5 px-4 text-gray-500">{{ c.product_count }}</td>
            <td class="py-2.5 px-4 text-gray-500 text-xs truncate max-w-0" :title="specsPreview(c)">
              {{ specsPreview(c) }}
            </td>
            <td class="py-2.5 px-4 text-gray-500 text-xs truncate max-w-0" :title="groupsPreview(c)">
              {{ groupsPreview(c) }}
              <span v-if="Number(c.include_drink_step) === 1" class="text-amber-600"> · 飲品</span>
            </td>
            <td class="py-2.5 px-4 text-right whitespace-nowrap">
              <button class="btn-ghost btn-sm" @click="openCat(c)">編輯</button>
              <button class="btn-ghost btn-sm !text-red-500 ml-1" @click="deleteCat(c)">刪除</button>
            </td>
          </tr>
          <tr v-if="!catalog.categories.length">
            <td colspan="6" class="py-10 text-center text-gray-300">尚無分類，請先新增</td>
          </tr>
        </tbody>
      </table>
    </div>

    <Modal
      :model-value="catModal"
      :title="catForm.id ? '編輯分類' : '新增分類'"
      width="max-w-2xl"
      @update:model-value="onCatModalUpdate"
    >
      <div class="space-y-4">
        <div>
          <label class="label">分類名稱</label>
          <input v-model="catForm.name" class="input" placeholder="例如：飲品" />
        </div>
        <div>
          <label class="label">排序（數字越小越前面）</label>
          <input v-model.number="catForm.sort_order" type="number" class="input" />
        </div>
        <label class="flex items-center gap-2 text-sm font-bold text-gray-600 cursor-pointer">
          <input v-model="catForm.include_drink_step" type="checkbox" class="accent-brand-500" />
          套餐含跟餐飲品步驟
        </label>

        <!-- 選項組（置於規格上方，避免長規格列表把區塊藏在捲動下方） -->
        <div class="border-t border-gray-100 pt-3">
          <div class="flex items-center justify-between mb-2">
            <label class="label !mb-0">選項組</label>
            <span class="text-xs text-gray-400">麵類／辣度／餡料等 · 儲存後才寫入</span>
          </div>
          <div class="space-y-2">
            <div
              v-for="(g, gi) in modalGroups"
              :key="g.id"
              class="rounded-xl border border-gray-200 bg-white"
              :class="groupDragFrom === gi ? 'opacity-60' : ''"
            >
              <div
                v-if="editingGroupId === g.id"
                class="space-y-2 p-2.5"
                @click.stop
              >
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
                @dragover="onDragOver"
                @drop="onGroupDrop(gi, $event)"
              >
                <span class="text-gray-300 text-xs select-none cursor-grab">⋮⋮</span>
                <button type="button" class="flex-1 text-left" @click="expandedGroupId = expandedGroupId === g.id ? null : g.id">
                  <div class="text-sm font-bold text-gray-700">{{ g.name }}</div>
                  <div class="text-[11px] text-gray-400">
                    {{ g.code }} · {{ Number(g.is_multi) ? '多選' : '單選' }} · {{ Number(g.required) ? '必選' : '選填' }}
                    · {{ (g.items || []).length }} 項
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
                  :class="itemDragFrom === ii ? 'opacity-60' : ''"
                  :draggable="editingItemId !== it.id"
                  @dragstart="onItemDragStart(ii, $event)"
                  @dragover="onDragOver"
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
                      <span v-if="Number(it.is_default)" class="ml-1 text-[10px] text-emerald-600">預設</span>
                    </button>
                    <button type="button" class="btn-ghost btn-sm !text-red-500 !px-2" @click.stop="deleteItem(g, it)">×</button>
                  </div>
                </div>
                <p v-if="!(g.items || []).length" class="text-xs text-gray-300 py-1">尚無選項</p>
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

            <p v-if="!modalGroups.length" class="text-xs text-gray-300 py-1">尚無選項組</p>

            <div class="rounded-xl border border-dashed border-gray-300 p-2.5 space-y-2">
              <div class="flex flex-wrap gap-2">
                <input v-model="newGroupCode" class="input !py-1.5 !text-sm !w-28" placeholder="代碼 e.g. noodle" />
                <input v-model="newGroupName" class="input !py-1.5 !text-sm flex-1 min-w-[8rem]" placeholder="名稱 e.g. 麵類" @keydown.enter.prevent="addGroup" />
              </div>
              <div class="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                <label class="flex items-center gap-1 cursor-pointer">
                  <input v-model="newGroupMulti" type="checkbox" class="accent-brand-500" />多選
                </label>
                <label class="flex items-center gap-1 cursor-pointer">
                  <input v-model="newGroupRequired" type="checkbox" class="accent-brand-500" />必選
                </label>
                <div class="flex-1" />
                <button type="button" class="btn-ghost btn-sm" @click="addGroup">＋ 新增選項組</button>
              </div>
            </div>
          </div>
        </div>

        <div class="border-t border-gray-100 pt-3">
          <div class="flex items-center justify-between mb-2">
            <label class="label !mb-0">規格</label>
            <span class="text-xs text-gray-400">點擊編輯 · 拖曳排序 · 儲存後才寫入</span>
          </div>

          <div class="space-y-2">
            <div
              v-for="(s, i) in modalSpecs"
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
                <button type="button" class="btn-ghost btn-sm !text-red-500 !px-2" title="刪除" @click.stop="deleteSpec(s)">×</button>
              </div>
            </div>

            <p v-if="!modalSpecs.length" class="text-xs text-gray-300 py-1">尚無規格</p>

            <div class="flex gap-1.5 items-center pt-1">
              <input
                v-model="newSpecName"
                class="input !py-1.5 !text-sm flex-1"
                placeholder="新增規格名稱"
                @keydown.enter.prevent="addSpec"
              />
              <input
                v-model.number="newSpecPrice"
                type="number"
                class="input !py-1.5 !text-sm !w-24"
                placeholder="加價"
                @keydown.enter.prevent="addSpec"
              />
              <button type="button" class="btn-ghost btn-sm" @click="addSpec">＋</button>
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <button class="btn-ghost" @click="requestClose">取消</button>
        <button class="btn-primary" @click="saveCat">儲存</button>
      </template>
    </Modal>
  </div>
</template>

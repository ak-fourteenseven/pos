<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';
import { useCatalogStore } from '../stores/catalog';
import { useToastStore } from '../stores/toast';
import Modal from '../components/Modal.vue';
import { COLOR_LIST, EMOJI_LIST, fmtMoney } from '../utils/format';

const catalog = useCatalogStore();
const toast = useToastStore();

const keyword = ref('');
const filterCat = ref(0); // 0 = 全部
const showAll = ref(true);

/* ---------------- 分類 ---------------- */
const catModal = ref(false);
const catForm = ref({ id: null, name: '', sort_order: 0 });

function openCat(cat = null) {
  catForm.value = cat
    ? { id: cat.id, name: cat.name, sort_order: cat.sort_order }
    : { id: null, name: '', sort_order: catalog.categories.length + 1 };
  catModal.value = true;
}
async function saveCat() {
  if (!catForm.value.name.trim()) {
    toast.error('請輸入分類名稱');
    return;
  }
  try {
    if (catForm.value.id) {
      await api.put(`/categories/${catForm.value.id}`, catForm.value);
    } else {
      await api.post('/categories', catForm.value);
    }
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

/* ---------------- 菜品 ---------------- */
const prodModal = ref(false);
const prodForm = ref({
  id: null, category_id: 0, name: '', price: '', barcode: '',
  emoji: '🍽️', color: '#f59e0b', specs: [], is_available: 1,
});

function openProduct(p = null) {
  prodForm.value = p
    ? {
        id: p.id,
        category_id: p.category_id || 0,
        name: p.name,
        price: p.price,
        barcode: p.barcode || '',
        emoji: p.emoji || '🍽️',
        color: p.color || '#f59e0b',
        specs: catalog.parseSpecs(p),
        is_available: Number(p.is_available),
      }
    : {
        id: null,
        category_id: catalog.categories[0]?.id || 0,
        name: '', price: '', barcode: '',
        emoji: '🍽️', color: '#f59e0b', specs: [], is_available: 1,
      };
  prodModal.value = true;
}
function addSpecRow() {
  prodForm.value.specs.push({ name: '', diff: 0 });
}
function removeSpecRow(i) {
  prodForm.value.specs.splice(i, 1);
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
      specs: f.specs.filter((s) => s.name.trim()),
      is_available: f.is_available ? 1 : 0,
    };
    if (f.id) await api.put(`/products/${f.id}`, payload);
    else await api.post('/products', payload);
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
  return list;
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
    <div class="flex gap-5 h-full">
      <!-- 左：分類 -->
      <div class="w-56 shrink-0">
        <div class="card p-4">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-extrabold">菜品分類</h3>
            <button class="btn-primary btn-sm" @click="openCat()">＋ 新增</button>
          </div>
          <ul class="space-y-1">
            <li
              v-for="c in catalog.categories"
              :key="c.id"
              class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold cursor-pointer"
              :class="filterCat === c.id ? 'bg-brand-50 text-brand-700' : 'hover:bg-gray-50'"
              @click="filterCat = filterCat === c.id ? 0 : c.id"
            >
              <span class="flex-1 truncate">{{ c.name }}</span>
              <span class="text-xs text-gray-400">{{ c.product_count }}</span>
              <button class="text-gray-300 hover:text-brand-500" title="編輯" @click.stop="openCat(c)">✎</button>
              <button class="text-gray-300 hover:text-red-500" title="刪除" @click.stop="deleteCat(c)">✕</button>
            </li>
          </ul>
        </div>
      </div>

      <!-- 右：菜品列表 -->
      <div class="flex-1 min-w-0 flex flex-col">
        <div class="flex items-center gap-2 mb-3 flex-wrap">
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
                <th class="py-2.5 px-4">條碼</th>
                <th class="py-2.5 px-4 text-center">狀態</th>
                <th class="py-2.5 px-4 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in products" :key="p.id" class="border-b border-gray-50 hover:bg-gray-50">
                <td class="py-2.5 px-4">
                  <div class="flex items-center gap-2">
                    <span class="text-xl">{{ p.emoji }}</span>
                    <span class="font-bold">{{ p.name }}</span>
                  </div>
                </td>
                <td class="py-2.5 px-4 text-gray-500">{{ p.category_name || '未分類' }}</td>
                <td class="py-2.5 px-4 font-bold text-brand-600">{{ fmtMoney(p.price, catalog.currency) }}</td>
                <td class="py-2.5 px-4 text-gray-400 text-xs">
                  {{ catalog.parseSpecs(p).map((s) => s.name).join(' / ') || '—' }}
                </td>
                <td class="py-2.5 px-4 text-gray-400 text-xs">{{ p.barcode || '—' }}</td>
                <td class="py-2.5 px-4 text-center">
                  <button
                    class="chip"
                    :class="Number(p.is_available) === 1 ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'"
                    @click="toggleAvailable(p)"
                  >
                    {{ Number(p.is_available) === 1 ? '上架中' : '已下架' }}
                  </button>
                </td>
                <td class="py-2.5 px-4 text-right whitespace-nowrap">
                  <button class="btn-ghost btn-sm" @click="openProduct(p)">編輯</button>
                  <button class="btn-ghost btn-sm !text-red-500 ml-1" @click="deleteProduct(p)">刪除</button>
                </td>
              </tr>
              <tr v-if="!products.length">
                <td colspan="7" class="py-10 text-center text-gray-300">沒有符合的菜品</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- 分類彈窗 -->
    <Modal v-model="catModal" title="分類" width="max-w-sm">
      <div class="space-y-4">
        <div>
          <label class="label">分類名稱</label>
          <input v-model="catForm.name" class="input" placeholder="例如：飲品" />
        </div>
        <div>
          <label class="label">排序（數字越小越前面）</label>
          <input v-model.number="catForm.sort_order" type="number" class="input" />
        </div>
      </div>
      <template #footer>
        <button class="btn-ghost" @click="catModal = false">取消</button>
        <button class="btn-primary" @click="saveCat">儲存</button>
      </template>
    </Modal>

    <!-- 菜品彈窗 -->
    <Modal v-model="prodModal" :title="prodForm.id ? '編輯菜品' : '新增菜品'" width="max-w-xl">
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

        <div>
          <div class="flex items-center justify-between mb-1">
            <label class="label !mb-0">規格（選填，價格差異為加價）</label>
            <button class="btn-ghost btn-sm" @click="addSpecRow">＋ 新增規格</button>
          </div>
          <div v-for="(s, i) in prodForm.specs" :key="i" class="flex gap-2 mb-2">
            <input v-model="s.name" class="input" placeholder="規格名稱，如：大杯" />
            <input v-model.number="s.diff" type="number" class="input !w-28" placeholder="加價 ±" />
            <button class="btn-ghost btn-sm !text-red-500" @click="removeSpecRow(i)">刪除</button>
          </div>
        </div>

        <label class="flex items-center gap-2 text-sm font-bold text-gray-600 cursor-pointer">
          <input v-model="prodForm.is_available" type="checkbox" class="accent-brand-500" />上架銷售
        </label>
      </div>
      <template #footer>
        <button class="btn-ghost" @click="prodModal = false">取消</button>
        <button class="btn-primary" @click="saveProduct">儲存</button>
      </template>
    </Modal>
  </div>
</template>

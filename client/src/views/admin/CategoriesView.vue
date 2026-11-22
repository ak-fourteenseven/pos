<script setup>
import { onMounted, ref } from 'vue';
import { api } from '@shared/api';
import { useCatalogStore } from '@shared/stores/catalog';
import { useToastStore } from '@shared/stores/toast';
import Modal from '@shared/components/Modal.vue';

const catalog = useCatalogStore();
const toast = useToastStore();

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
      <p class="text-sm text-gray-500">共 {{ catalog.categories.length }} 個分類</p>
      <div class="flex-1" />
      <button class="btn-primary" @click="openCat()">＋ 新增分類</button>
    </div>

    <div class="card overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-xs text-gray-400 border-b bg-gray-50">
            <th class="py-2.5 px-4">排序</th>
            <th class="py-2.5 px-4">分類名稱</th>
            <th class="py-2.5 px-4">菜品數</th>
            <th class="py-2.5 px-4 text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in catalog.categories" :key="c.id" class="border-b border-gray-50 hover:bg-gray-50">
            <td class="py-2.5 px-4 text-gray-500">{{ c.sort_order }}</td>
            <td class="py-2.5 px-4 font-extrabold">{{ c.name }}</td>
            <td class="py-2.5 px-4 text-gray-500">{{ c.product_count }}</td>
            <td class="py-2.5 px-4 text-right whitespace-nowrap">
              <button class="btn-ghost btn-sm" @click="openCat(c)">編輯</button>
              <button class="btn-ghost btn-sm !text-red-500 ml-1" @click="deleteCat(c)">刪除</button>
            </td>
          </tr>
          <tr v-if="!catalog.categories.length">
            <td colspan="4" class="py-10 text-center text-gray-300">尚無分類，請先新增</td>
          </tr>
        </tbody>
      </table>
    </div>

    <Modal v-model="catModal" :title="catForm.id ? '編輯分類' : '新增分類'" width="max-w-sm">
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
  </div>
</template>

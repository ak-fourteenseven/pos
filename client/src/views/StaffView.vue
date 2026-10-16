<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../api';
import { useAuthStore } from '../stores/auth';
import { useToastStore } from '../stores/toast';
import Modal from '../components/Modal.vue';

const auth = useAuthStore();
const toast = useToastStore();

const staffs = ref([]);
const modal = ref(false);
const form = ref({ id: null, username: '', name: '', role: 'cashier', password: '' });

onMounted(load);

async function load() {
  try {
    staffs.value = await api.get('/staff');
  } catch (e) {
    toast.error(e.message);
  }
}

function openForm(s = null) {
  form.value = s
    ? { id: s.id, username: s.username, name: s.name, role: s.role, password: '' }
    : { id: null, username: '', name: '', role: 'cashier', password: '' };
  modal.value = true;
}

async function save() {
  const f = form.value;
  if (!f.username.trim() || !f.name.trim()) {
    toast.error('請填寫帳號與姓名');
    return;
  }
  if (!f.id && !f.password) {
    toast.error('請設定初始密碼');
    return;
  }
  try {
    if (f.id) {
      await api.put(`/staff/${f.id}`, {
        name: f.name, role: f.role, ...(f.password ? { password: f.password } : {}),
      });
    } else {
      await api.post('/staff', { username: f.username.trim(), name: f.name, role: f.role, password: f.password });
    }
    modal.value = false;
    await load();
    toast.success('員工資料已儲存');
  } catch (e) {
    toast.error(e.message);
  }
}

async function toggleActive(s) {
  try {
    await api.put(`/staff/${s.id}`, { is_active: Number(s.is_active) === 1 ? 0 : 1 });
    await load();
  } catch (e) {
    toast.error(e.message);
  }
}

async function resetPwd(s) {
  if (!confirm(`確定將「${s.name}」的密碼重設為 123456？`)) return;
  try {
    await api.put(`/staff/${s.id}`, { password: '123456' });
    toast.success('密碼已重設為 123456');
  } catch (e) {
    toast.error(e.message);
  }
}

async function remove(s) {
  if (!confirm(`確定刪除員工「${s.name}」？`)) return;
  try {
    await api.del(`/staff/${s.id}`);
    await load();
    toast.success('員工已刪除');
  } catch (e) {
    toast.error(e.message);
  }
}
</script>

<template>
  <div class="h-full overflow-y-auto p-5">
    <div class="flex items-center mb-4">
      <p class="text-sm text-gray-500">店長擁有全部權限；收銀員僅能使用收銀台、桌台與報表查詢。</p>
      <div class="flex-1" />
      <button class="btn-primary" @click="openForm()">＋ 新增員工</button>
    </div>

    <div class="card overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-xs text-gray-400 border-b bg-gray-50">
            <th class="py-2.5 px-4">帳號</th>
            <th class="py-2.5 px-4">姓名</th>
            <th class="py-2.5 px-4">角色</th>
            <th class="py-2.5 px-4 text-center">狀態</th>
            <th class="py-2.5 px-4 text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in staffs" :key="s.id" class="border-b border-gray-50 hover:bg-gray-50">
            <td class="py-2.5 px-4 font-bold">{{ s.username }}</td>
            <td class="py-2.5 px-4">{{ s.name }}<span v-if="s.id === auth.user?.id" class="chip bg-brand-100 text-brand-600 ml-2">目前登入</span></td>
            <td class="py-2.5 px-4">
              <span class="chip" :class="s.role === 'manager' ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-600'">
                {{ s.role === 'manager' ? '店長' : '收銀員' }}
              </span>
            </td>
            <td class="py-2.5 px-4 text-center">
              <button
                class="chip cursor-pointer"
                :class="Number(s.is_active) === 1 ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'"
                @click="toggleActive(s)"
              >
                {{ Number(s.is_active) === 1 ? '啟用' : '停用' }}
              </button>
            </td>
            <td class="py-2.5 px-4 text-right whitespace-nowrap">
              <button class="btn-ghost btn-sm" @click="openForm(s)">編輯</button>
              <button class="btn-ghost btn-sm" @click="resetPwd(s)">重設密碼</button>
              <button class="btn-ghost btn-sm !text-red-500" @click="remove(s)">刪除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Modal v-model="modal" :title="form.id ? '編輯員工' : '新增員工'" width="max-w-sm">
      <div class="space-y-4">
        <div>
          <label class="label">帳號 *</label>
          <input v-model="form.username" class="input" :disabled="!!form.id" placeholder="登入帳號" />
        </div>
        <div>
          <label class="label">姓名 *</label>
          <input v-model="form.name" class="input" placeholder="員工姓名" />
        </div>
        <div>
          <label class="label">角色</label>
          <select v-model="form.role" class="input">
            <option value="manager">店長（全部權限）</option>
            <option value="cashier">收銀員</option>
          </select>
        </div>
        <div>
          <label class="label">{{ form.id ? '重設密碼（留空則不修改）' : '初始密碼 *' }}</label>
          <input v-model="form.password" type="text" class="input" placeholder="至少 4 位" />
        </div>
      </div>
      <template #footer>
        <button class="btn-ghost" @click="modal = false">取消</button>
        <button class="btn-primary" @click="save">儲存</button>
      </template>
    </Modal>
  </div>
</template>

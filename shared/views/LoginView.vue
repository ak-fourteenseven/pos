<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@shared/stores/auth';
import { useToastStore } from '@shared/stores/toast';

const props = defineProps({
  /** 登录成功后的跳转目标 */
  redirect: { type: String, default: '/' },
  heading: { type: String, default: '本地 POS 收銀系統' },
  sub: { type: String, default: '資料儲存於本地 SQLite · 斷網可用 · 無雲端訂閱' },
  hint: { type: String, default: '店長 admin（完整權限） · 收銀員 cashier / cashier2' },
  /** 后台登录：仅店长账号可进入 */
  managerOnly: { type: Boolean, default: false },
});

const auth = useAuthStore();
const toast = useToastStore();
const router = useRouter();

const username = ref('admin');
const password = ref('123456');
const loading = ref(false);

async function onSubmit() {
  if (!username.value || !password.value) {
    toast.error('請輸入帳號與密碼');
    return;
  }
  loading.value = true;
  try {
    const u = await auth.login(username.value.trim(), password.value);
    if (props.managerOnly && u.role !== 'manager') {
      auth.logout();
      toast.error('後台管理僅限店長帳號登入');
      return;
    }
    toast.success(`歡迎，${u.name}`);
    router.push(props.redirect);
  } catch (e) {
    toast.error(e.message);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="h-full flex items-center justify-center bg-gradient-to-br from-brand-500 via-brand-600 to-amber-700 p-4">
    <div class="w-full max-w-md">
      <div class="text-center mb-8">
        <div class="text-6xl">🍽️</div>
        <h1 class="mt-3 text-3xl font-extrabold text-white">{{ heading }}</h1>
        <p class="mt-2 text-brand-100 text-sm">{{ sub }}</p>
      </div>

      <form class="bg-white rounded-2xl shadow-2xl p-7 space-y-5" @submit.prevent="onSubmit">
        <div>
          <label class="label">帳號</label>
          <input v-model="username" class="input" placeholder="請輸入帳號" autocomplete="username" />
        </div>
        <div>
          <label class="label">密碼</label>
          <input v-model="password" type="password" class="input" placeholder="請輸入密碼" autocomplete="current-password" />
        </div>
        <button type="submit" class="btn-primary w-full py-3 text-base" :disabled="loading">
          {{ loading ? '登入中…' : '登入' }}
        </button>

        <div class="pt-2 border-t border-gray-100 text-xs text-gray-400 space-y-1">
          <p class="font-bold text-gray-500">測試帳號（初始密碼皆為 123456）</p>
          <p>{{ hint }}</p>
        </div>
      </form>
    </div>
  </div>
</template>

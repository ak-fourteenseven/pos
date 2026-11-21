<script setup>
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@shared/stores/auth';
import { useCatalogStore } from '@shared/stores/catalog';

const router = useRouter();
const auth = useAuthStore();
const catalog = useCatalogStore();

onMounted(() => {
  catalog.loadAll().catch(() => {});
});

function goPos() {
  router.push('/pos');
}

function goAdmin() {
  router.push('/admin/reports');
}

function logout() {
  auth.logout();
  router.push('/login');
}
</script>

<template>
  <div class="h-full flex flex-col items-center justify-center bg-gradient-to-br from-brand-500 via-brand-600 to-amber-700 p-6">
    <div class="w-full max-w-2xl text-center mb-10">
      <div class="text-6xl">🍽️</div>
      <h1 class="mt-3 text-3xl font-extrabold text-white">{{ catalog.storeName || '本地 POS' }}</h1>
      <p class="mt-2 text-brand-100 text-sm">
        {{ auth.user?.name }}（{{ auth.user?.role === 'manager' ? '店長' : '收銀員' }}）· 選擇要進入的功能
      </p>
    </div>

    <div class="w-full max-w-2xl grid gap-4" :class="auth.isManager ? 'sm:grid-cols-2' : 'sm:grid-cols-1 max-w-md'">
      <button
        type="button"
        class="bg-white rounded-2xl shadow-xl p-8 text-left hover:scale-[1.02] transition focus:outline-none focus:ring-4 focus:ring-white/40"
        @click="goPos"
      >
        <div class="text-4xl">🧾</div>
        <div class="mt-3 text-xl font-extrabold text-gray-900">收銀台</div>
        <p class="mt-1 text-sm text-gray-500">點餐、結帳、桌台與今日訂單</p>
      </button>

      <button
        v-if="auth.isManager"
        type="button"
        class="bg-white rounded-2xl shadow-xl p-8 text-left hover:scale-[1.02] transition focus:outline-none focus:ring-4 focus:ring-white/40"
        @click="goAdmin"
      >
        <div class="text-4xl">⚙️</div>
        <div class="mt-3 text-xl font-extrabold text-gray-900">後台管理</div>
        <p class="mt-1 text-sm text-gray-500">報表、菜品、桌台、員工與系統設定</p>
      </button>
    </div>

    <button type="button" class="mt-10 text-sm font-bold text-brand-100 hover:text-white transition" @click="logout">
      登出
    </button>
  </div>
</template>

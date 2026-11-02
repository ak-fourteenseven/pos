<script setup>
import { computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@shared/stores/auth';
import { useCatalogStore } from '@shared/stores/catalog';
import { useToastStore } from '@shared/stores/toast';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const catalog = useCatalogStore();
const toast = useToastStore();

/** 后台管理：报表与所有设置项 */
const navAdmin = [
  { path: '/reports', title: '報表統計', icon: '📊' },
  { path: '/admin/products', title: '菜品管理', icon: '🍱' },
  { path: '/admin/tables', title: '桌台管理', icon: '🪑' },
  { path: '/admin/payments', title: '支付方式', icon: '💳' },
  { path: '/admin/staff', title: '員工管理', icon: '👥' },
  { path: '/admin/settings', title: '系統設定', icon: '⚙️' },
];

onMounted(async () => {
  try {
    await catalog.loadAll();
  } catch (e) {
    toast.error(e.message);
  }
});

function logout() {
  auth.logout();
  router.push('/login');
}

const pageTitle = computed(() => route.meta.title || '');
</script>

<template>
  <div class="h-full flex bg-gray-100">
    <!-- 側邊欄 -->
    <aside class="w-60 shrink-0 bg-gray-900 text-gray-300 flex flex-col">
      <div class="px-5 py-5 border-b border-gray-800">
        <div class="ico-lg">⚙️</div>
        <div class="mt-1 font-extrabold text-white leading-tight">{{ catalog.storeName }}</div>
        <div class="text-[11px] text-gray-500">後台管理</div>
      </div>

      <nav class="flex-1 overflow-y-auto py-4">
        <div class="px-4 mb-1 text-[11px] font-bold text-gray-500 uppercase tracking-wider">管理</div>
        <router-link
          v-for="n in navAdmin"
          :key="n.path"
          :to="n.path"
          class="flex items-center gap-3 mx-2 px-3 py-2.5 rounded-lg text-sm font-bold transition"
          :class="route.path.startsWith(n.path) ? 'bg-brand-500 text-white' : 'hover:bg-gray-800'"
        >
          <span class="ico">{{ n.icon }}</span>{{ n.title }}
        </router-link>
      </nav>

      <div class="px-5 py-3 border-t border-gray-800 text-[11px] text-gray-500">
        前台收銀請使用收銀台應用<br />資料儲存於本地 SQLite
      </div>
    </aside>

    <!-- 主區 -->
    <div class="flex-1 flex flex-col min-w-0">
      <header class="h-14 bg-white border-b border-gray-200 flex items-center px-5 gap-3 shrink-0">
        <h1 class="text-lg font-extrabold">{{ pageTitle }}</h1>
        <div class="flex-1" />
        <div class="chip bg-gray-100 text-gray-600">
          {{ auth.user?.name }}（店長）
        </div>
        <button class="btn-ghost btn-sm" @click="logout">登出</button>
      </header>

      <main class="flex-1 overflow-hidden">
        <router-view />
      </main>
    </div>
  </div>
</template>

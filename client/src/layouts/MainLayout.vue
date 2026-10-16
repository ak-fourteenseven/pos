<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useCatalogStore } from '../stores/catalog';
import { useShiftStore } from '../stores/shift';
import { useToastStore } from '../stores/toast';
import Modal from '../components/Modal.vue';
import { fmtMoney, fmtTime } from '../utils/format';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const catalog = useCatalogStore();
const shift = useShiftStore();
const toast = useToastStore();

const navFront = [
  { path: '/pos', title: '收銀台', icon: '🧾' },
  { path: '/tables', title: '桌台視圖', icon: '🪑' },
  { path: '/reports', title: '報表統計', icon: '📊' },
];
const navAdmin = [
  { path: '/admin/products', title: '菜品管理', icon: '🍱' },
  { path: '/admin/tables', title: '桌台管理', icon: '🪑' },
  { path: '/admin/payments', title: '支付方式', icon: '💳' },
  { path: '/admin/staff', title: '員工管理', icon: '👥' },
  { path: '/admin/settings', title: '系統設定', icon: '⚙️' },
];

const shiftModal = ref(false);
const closing = ref(false);

onMounted(async () => {
  try {
    await catalog.loadAll();
  } catch (e) {
    toast.error(e.message);
  }
  try {
    await shift.loadCurrent();
  } catch { /* 未登入時忽略 */ }
});

function logout() {
  auth.logout();
  router.push('/login');
}
async function openShift() {
  try {
    await shift.open();
  } catch (e) {
    toast.error(e.message);
  }
}
async function closeShift() {
  closing.value = true;
  try {
    const rec = await shift.close();
    shiftModal.value = false;
    toast.success(`結班完成，營業額 ${fmtMoney(rec.total_sales, catalog.currency)}`);
  } catch (e) {
    toast.error(e.message);
  } finally {
    closing.value = false;
  }
}

const pageTitle = computed(() => route.meta.title || '');
</script>

<template>
  <div class="h-full flex bg-gray-100">
    <!-- 側邊欄 -->
    <aside class="w-60 shrink-0 bg-gray-900 text-gray-300 flex flex-col">
      <div class="px-5 py-5 border-b border-gray-800">
        <div class="text-2xl">🍽️</div>
        <div class="mt-1 font-extrabold text-white leading-tight">{{ catalog.storeName }}</div>
        <div class="text-[11px] text-gray-500">本地 POS 收銀系統</div>
      </div>

      <nav class="flex-1 overflow-y-auto py-4">
        <div class="px-4 mb-1 text-[11px] font-bold text-gray-500 uppercase tracking-wider">前台</div>
        <router-link
          v-for="n in navFront"
          :key="n.path"
          :to="n.path"
          class="flex items-center gap-3 mx-2 px-3 py-2.5 rounded-lg text-sm font-bold transition"
          :class="route.path.startsWith(n.path) ? 'bg-brand-500 text-white' : 'hover:bg-gray-800'"
        >
          <span class="text-lg">{{ n.icon }}</span>{{ n.title }}
        </router-link>

        <template v-if="auth.isManager">
          <div class="px-4 mt-5 mb-1 text-[11px] font-bold text-gray-500 uppercase tracking-wider">後台管理</div>
          <router-link
            v-for="n in navAdmin"
            :key="n.path"
            :to="n.path"
            class="flex items-center gap-3 mx-2 px-3 py-2.5 rounded-lg text-sm font-bold transition"
            :class="route.path.startsWith(n.path) ? 'bg-brand-500 text-white' : 'hover:bg-gray-800'"
          >
            <span class="text-lg">{{ n.icon }}</span>{{ n.title }}
            <span class="ml-auto chip bg-gray-800 text-gray-400 text-[10px]">店長</span>
          </router-link>
        </template>
      </nav>

      <div class="px-5 py-3 border-t border-gray-800 text-[11px] text-gray-500">
        資料儲存於本地 SQLite<br />無需網路即可運作
      </div>
    </aside>

    <!-- 主區 -->
    <div class="flex-1 flex flex-col min-w-0">
      <header class="h-14 bg-white border-b border-gray-200 flex items-center px-5 gap-3 shrink-0">
        <h1 class="text-lg font-extrabold">{{ pageTitle }}</h1>
        <div class="flex-1" />
        <button
          class="btn-ghost btn-sm"
          :class="shift.current ? '!border-emerald-300 !text-emerald-600' : ''"
          @click="shiftModal = true"
        >
          <span class="w-2 h-2 rounded-full" :class="shift.current ? 'bg-emerald-500' : 'bg-gray-300'" />
          {{ shift.current ? `交接班中 ${fmtTime(shift.current.start_time)}` : '未開始交接班' }}
        </button>
        <div class="chip bg-gray-100 text-gray-600">
          {{ auth.user?.name }}（{{ auth.user?.role === 'manager' ? '店長' : '收銀員' }}）
        </div>
        <button class="btn-ghost btn-sm" @click="logout">登出</button>
      </header>

      <main class="flex-1 overflow-hidden">
        <router-view />
      </main>
    </div>

    <!-- 交接班彈窗 -->
    <Modal v-model="shiftModal" title="交接班" width="max-w-md">
      <template v-if="shift.current">
        <div class="text-sm text-gray-600 space-y-2">
          <p>本班開始時間：<b class="text-gray-800">{{ shift.current.start_time }}</b></p>
          <p class="text-gray-400 text-xs">結班後將自動統計本班營業額、現金收款與訂單數，並生成交接班報表。</p>
        </div>
      </template>
      <template v-else>
        <p class="text-sm text-gray-600">開始新班別後，本班的訂單將歸入此交接班記錄，方便日後對帳。</p>
      </template>
      <template #footer>
        <button v-if="!shift.current" class="btn-primary" @click="openShift">開始交接班</button>
        <button v-else class="btn-danger" :disabled="closing" @click="closeShift">
          {{ closing ? '結班中…' : '結束本班並結班' }}
        </button>
      </template>
    </Modal>
  </div>
</template>

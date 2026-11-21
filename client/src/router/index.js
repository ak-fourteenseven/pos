import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@shared/stores/auth';
import { useToastStore } from '@shared/stores/toast';

const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@shared/views/LoginView.vue'),
    meta: { title: '登入', public: true },
    props: { redirect: '/' },
  },
  {
    path: '/',
    name: 'dashboard',
    component: () => import('../views/DashboardView.vue'),
    meta: { title: '首頁' },
  },
  {
    path: '/pos',
    component: () => import('../layouts/PosLayout.vue'),
    children: [
      { path: '', name: 'pos', component: () => import('../views/PosView.vue'), meta: { title: '收銀台', icon: '🧾' } },
    ],
  },
  {
    path: '/tables',
    component: () => import('../layouts/PosLayout.vue'),
    children: [
      { path: '', name: 'tables', component: () => import('../views/TablesView.vue'), meta: { title: '桌台視圖', icon: '🪑' } },
    ],
  },
  {
    path: '/admin',
    component: () => import('../layouts/AdminLayout.vue'),
    meta: { requiresManager: true },
    redirect: '/admin/reports',
    children: [
      { path: 'reports', name: 'admin-reports', component: () => import('../views/admin/ReportsView.vue'), meta: { title: '報表統計', icon: '📊', requiresManager: true } },
      { path: 'products', name: 'admin-products', component: () => import('../views/admin/ProductsView.vue'), meta: { title: '菜品管理', icon: '🍱', requiresManager: true } },
      { path: 'tables', name: 'admin-tables', component: () => import('../views/admin/TablesAdminView.vue'), meta: { title: '桌台管理', icon: '🪑', requiresManager: true } },
      { path: 'payments', name: 'admin-payments', component: () => import('../views/admin/PaymentsView.vue'), meta: { title: '支付方式', icon: '💳', requiresManager: true } },
      { path: 'staff', name: 'admin-staff', component: () => import('../views/admin/StaffView.vue'), meta: { title: '員工管理', icon: '👥', requiresManager: true } },
      { path: 'settings', name: 'admin-settings', component: () => import('../views/admin/SettingsView.vue'), meta: { title: '系統設定', icon: '⚙️', requiresManager: true } },
    ],
  },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (!to.meta.public && !auth.user) return { path: '/login' };
  if (to.path === '/login' && auth.user) return { path: '/' };
  if (to.matched.some((r) => r.meta.requiresManager) && !auth.isManager) {
    const toast = useToastStore();
    toast.error('後台管理僅限店長帳號');
    return { path: '/' };
  }
  return true;
});

router.afterEach((to) => {
  document.title = `${to.meta.title || 'POS'} · 本地 POS`;
});

export default router;

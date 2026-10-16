import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/LoginView.vue'),
    meta: { title: '登入', public: true },
  },
  {
    path: '/',
    component: () => import('../layouts/MainLayout.vue'),
    redirect: '/pos',
    children: [
      { path: 'pos', name: 'pos', component: () => import('../views/PosView.vue'), meta: { title: '收銀台', icon: '🧾' } },
      { path: 'tables', name: 'tables', component: () => import('../views/TablesView.vue'), meta: { title: '桌台視圖', icon: '🪑' } },
      { path: 'reports', name: 'reports', component: () => import('../views/ReportsView.vue'), meta: { title: '報表統計', icon: '📊' } },
      { path: 'admin/products', name: 'admin-products', component: () => import('../views/ProductsView.vue'), meta: { title: '菜品管理', icon: '🍱', manager: true } },
      { path: 'admin/tables', name: 'admin-tables', component: () => import('../views/TablesAdminView.vue'), meta: { title: '桌台管理', icon: '🪑', manager: true } },
      { path: 'admin/payments', name: 'admin-payments', component: () => import('../views/PaymentsView.vue'), meta: { title: '支付方式', icon: '💳', manager: true } },
      { path: 'admin/staff', name: 'admin-staff', component: () => import('../views/StaffView.vue'), meta: { title: '員工管理', icon: '👥', manager: true } },
      { path: 'admin/settings', name: 'admin-settings', component: () => import('../views/SettingsView.vue'), meta: { title: '系統設定', icon: '⚙️', manager: true } },
    ],
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (!to.meta.public && !auth.user) return { path: '/login' };
  if (to.path === '/login' && auth.user) return { path: '/pos' };
  if (to.meta.manager && auth.user?.role !== 'manager') return { path: '/pos' };
  return true;
});

router.afterEach((to) => {
  const auth = useAuthStore();
  document.title = `${to.meta.title || '收銀台'} · ${auth.user ? '本地 POS' : '登入'}`;
});

export default router;

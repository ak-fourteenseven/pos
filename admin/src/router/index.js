import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@shared/stores/auth';

/** 后台管理应用：报表与所有设置项，仅店长可登录 */
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
    redirect: '/reports',
    children: [
      { path: 'reports', name: 'reports', component: () => import('../views/ReportsView.vue'), meta: { title: '報表統計', icon: '📊' } },
      { path: 'admin/products', name: 'admin-products', component: () => import('../views/ProductsView.vue'), meta: { title: '菜品管理', icon: '🍱' } },
      { path: 'admin/tables', name: 'admin-tables', component: () => import('../views/TablesAdminView.vue'), meta: { title: '桌台管理', icon: '🪑' } },
      { path: 'admin/payments', name: 'admin-payments', component: () => import('../views/PaymentsView.vue'), meta: { title: '支付方式', icon: '💳' } },
      { path: 'admin/staff', name: 'admin-staff', component: () => import('../views/StaffView.vue'), meta: { title: '員工管理', icon: '👥' } },
      { path: 'admin/settings', name: 'admin-settings', component: () => import('../views/SettingsView.vue'), meta: { title: '系統設定', icon: '⚙️' } },
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
  if (to.path === '/login' && auth.user) return { path: '/reports' };
  return true;
});

router.afterEach((to) => {
  document.title = `${to.meta.title || '後台管理'} · POS 後台`;
});

export default router;

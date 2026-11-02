import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@shared/stores/auth';

/** 前台收银应用：只保留收银台与桌台视图，后台功能在独立应用 */
const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@shared/views/LoginView.vue'),
    meta: { title: '登入', public: true },
  },
  {
    path: '/',
    component: () => import('../layouts/MainLayout.vue'),
    redirect: '/pos',
    children: [
      { path: 'pos', name: 'pos', component: () => import('../views/PosView.vue'), meta: { title: '收銀台', icon: '🧾' } },
      { path: 'tables', name: 'tables', component: () => import('../views/TablesView.vue'), meta: { title: '桌台視圖', icon: '🪑' } },
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
  return true;
});

router.afterEach((to) => {
  document.title = `${to.meta.title || '收銀台'} · 前台收銀`;
});

export default router;

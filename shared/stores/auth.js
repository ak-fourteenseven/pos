import { defineStore } from 'pinia';
import { api } from '../api';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: JSON.parse(localStorage.getItem('pos_user') || 'null'),
  }),
  getters: {
    isManager: (s) => s.user?.role === 'manager',
  },
  actions: {
    async login(username, password) {
      const u = await api.post('/login', { username, password });
      this.user = u;
      localStorage.setItem('pos_user', JSON.stringify(u));
      return u;
    },
    logout() {
      this.user = null;
      localStorage.removeItem('pos_user');
    },
  },
});

import { defineStore } from 'pinia';
import { api } from '../api';
import { useAuthStore } from './auth';
import { useToastStore } from './toast';

/** 交接班 store */
export const useShiftStore = defineStore('shift', {
  state: () => ({
    current: null, // { id, start_time, cashier_id, status }
    records: [],
  }),
  actions: {
    async loadCurrent() {
      if (!useAuthStore().user) return;
      this.current = await api.get('/shifts/current');
    },
    async open() {
      this.current = await api.post('/shifts/open');
      useToastStore().success('已開始交接班');
      return this.current;
    },
    async close() {
      if (!this.current) return null;
      const rec = await api.post(`/shifts/${this.current.id}/close`);
      this.current = null;
      useToastStore().success(`已結班：營業額 ${rec.total_sales}`);
      return rec;
    },
    async loadRecords() {
      this.records = await api.get('/shifts?limit=60');
    },
  },
});

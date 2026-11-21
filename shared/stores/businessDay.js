import { defineStore } from 'pinia';
import { api } from '../api';
import { useAuthStore } from './auth';
import { useToastStore } from './toast';

/** 營業日 store（開市 / 日結，per cashier） */
export const useBusinessDayStore = defineStore('businessDay', {
  state: () => ({
    current: null,
    latest: null,
    records: [],
    summary: null,
  }),
  actions: {
    async loadCurrent() {
      if (!useAuthStore().user) {
        this.current = null;
        return null;
      }
      this.current = await api.get('/business-days/current');
      return this.current;
    },
    async loadLatest() {
      if (!useAuthStore().user) {
        this.latest = null;
        return null;
      }
      this.latest = await api.get('/business-days/latest');
      return this.latest;
    },
    async open({ opening_cash = 0, business_date } = {}) {
      this.current = await api.post('/business-days/open', { opening_cash, business_date });
      this.latest = this.current;
      useToastStore().success(`已開市 · 營業日 ${this.current.business_date}`);
      return this.current;
    },
    async loadSummary(id) {
      const dayId = id || this.current?.id;
      if (!dayId) {
        this.summary = null;
        return null;
      }
      this.summary = await api.get(`/business-days/${dayId}/summary`);
      return this.summary;
    },
    async close({ counted_cash } = {}) {
      if (!this.current) return null;
      const rec = await api.post(`/business-days/${this.current.id}/close`, { counted_cash });
      this.current = null;
      this.summary = null;
      this.latest = rec;
      useToastStore().success(`日結完成 · 訂單 ${rec.order_count} · 營業額 ${rec.total_sales}`);
      return rec;
    },
    async reopen(id) {
      const dayId = id || this.latest?.id;
      if (!dayId) return null;
      this.current = await api.post(`/business-days/${dayId}/reopen`);
      this.latest = this.current;
      useToastStore().success(`已撤銷日結 · 營業日 ${this.current.business_date}`);
      return this.current;
    },
    async loadRecords() {
      this.records = await api.get('/business-days?limit=60');
    },
  },
});

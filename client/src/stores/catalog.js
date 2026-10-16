import { defineStore } from 'pinia';
import { api } from '../api';

/** 門店基礎資料：分類 / 菜品 / 桌台 / 支付方式 / 設定 */
export const useCatalogStore = defineStore('catalog', {
  state: () => ({
    categories: [],
    products: [],
    tables: [],
    payments: [],
    settings: {},
    loaded: false,
  }),
  getters: {
    availableProducts: (s) => s.products.filter((p) => Number(p.is_available) === 1),
    enabledPayments: (s) => s.payments.filter((p) => Number(p.is_enabled) === 1),
    serviceRate: (s) => Number(s.settings.service_fee_rate || 0),
    currency: (s) => s.settings.currency || 'NT$',
    storeName: (s) => s.settings.store_name || '本地 POS',
    parseSpecs: () => (p) => {
      try { return p.specs ? JSON.parse(p.specs) : []; } catch { return []; }
    },
  },
  actions: {
    async loadAll() {
      const [categories, products, tables, payments, settings] = await Promise.all([
        api.get('/categories'),
        api.get('/products?all=1'),
        api.get('/tables'),
        api.get('/payment-methods'),
        api.get('/settings'),
      ]);
      this.categories = categories;
      this.products = products;
      this.tables = tables;
      this.payments = payments;
      this.settings = settings;
      this.loaded = true;
    },
    async reloadTables() {
      this.tables = await api.get('/tables');
    },
  },
});

import { defineStore } from 'pinia';
import { api } from '../api';
import { useCatalogStore } from './catalog';
import { useToastStore } from './toast';

/**
 * 收銀台購物車
 * - 開台模式：orderId 不為 null，每次加菜/改動即時同步服務端
 * - 快餐/掛單模式：orderId 為 null，購物車暫存於前端，結帳時一次性建立訂單
 */
let tempSeq = 0;

export const usePosStore = defineStore('pos', {
  state: () => ({
    orderId: null,
    orderNo: '',
    tableId: null,
    tableNumber: '',
    items: [], // { id, product_id, name, emoji, color, price, qty, spec, remark, spec_diff }
    discount: 0,
    discountLabel: '',
    paymentMethod: 'cash',
    received: 0,
    heldOrders: [],
  }),
  getters: {
    catalog() { return useCatalogStore(); },
    count: (s) => s.items.reduce((sum, it) => sum + it.qty, 0),
    subtotal: (s) => s.items.reduce((sum, it) => sum + it.price * it.qty, 0),
    serviceFee(state) {
      return Math.round(state.subtotal * useCatalogStore().serviceRate);
    },
    total(state) {
      return Math.max(0, state.subtotal + state.serviceFee - state.discount);
    },
    change(state) {
      return Math.max(0, Number(state.received || 0) - state.total);
    },
    isTableMode: (s) => s.orderId != null,
  },
  actions: {
    reset() {
      this.orderId = null;
      this.orderNo = '';
      this.tableId = null;
      this.tableNumber = '';
      this.items = [];
      this.discount = 0;
      this.discountLabel = '';
      this.paymentMethod = 'cash';
      this.received = 0;
    },
    /** 開台後綁定服務端訂單 */
    bindOrder(order, tableNumber) {
      this.reset();
      this.orderId = order.id;
      this.orderNo = order.order_no;
      this.tableId = order.table_id;
      this.tableNumber = tableNumber || '';
      this.items = (order.items || []).map((it) => this.mapItem(it));
    },
    mapItem(it) {
      let options = null;
      try {
        options = it.options ? (typeof it.options === 'string' ? JSON.parse(it.options) : it.options) : null;
      } catch { options = null; }
      return {
        id: it.id,
        product_id: it.product_id,
        name: it.product_name,
        price: Number(it.price),
        qty: Number(it.quantity),
        spec: it.spec || '',
        remark: it.remark || '',
        item_type: it.item_type || 'simple',
        options,
      };
    },
    /** 一般單品（含舊版規格） */
    async addProduct(product, { spec = '', spec_diff = 0, remark = '', qty = 1 } = {}) {
      if (this.orderId) {
        const it = await api.post(`/orders/${this.orderId}/items`, {
          product_id: product.id, quantity: qty, spec, spec_diff, remark,
        });
        this.items.push(this.mapItem(it));
      } else {
        this.items.push({
          id: `t${++tempSeq}`,
          product_id: product.id,
          name: product.name,
          price: Number(product.price) + Number(spec_diff || 0),
          qty,
          spec,
          remark,
        });
      }
    },
    /** 套餐（向導結果）：unitPrice 為前端即時計算價，後端會覆核 */
    async addCombo(product, options, unitPrice, qty = 1) {
      if (this.orderId) {
        const it = await api.post(`/orders/${this.orderId}/items`, {
          product_id: product.id, quantity: qty, options,
        });
        this.items.push(this.mapItem(it));
      } else {
        this.items.push({
          id: `t${++tempSeq}`,
          product_id: product.id,
          name: product.name,
          price: Number(unitPrice),
          qty,
          spec: '',
          remark: '',
          item_type: 'combo',
          options,
        });
      }
    },
    /** 獨立飲品：temperature HOT/COLD，preferences 口味標籤 */
    async addDrink(product, { temperature, preferences = [] }, qty = 1) {
      const options = { drink: { product_id: product.id, name: product.name, temperature, preferences } };
      const tempLabel = temperature === 'HOT' ? '熱' : '凍';
      if (this.orderId) {
        const it = await api.post(`/orders/${this.orderId}/items`, {
          product_id: product.id, quantity: qty, options, spec: tempLabel,
        });
        this.items.push(this.mapItem(it));
      } else {
        this.items.push({
          id: `t${++tempSeq}`,
          product_id: product.id,
          name: product.name,
          price: Number(product.price), // 後端結帳時依時段覆核
          qty,
          spec: tempLabel,
          remark: preferences.join('、'),
          item_type: 'simple',
          options,
        });
      }
    },
    async setQty(item, qty) {
      const q = Number(qty);
      if (q <= 0) return this.removeItem(item);
      if (this.orderId && typeof item.id === 'number') {
        await api.put(`/orders/${this.orderId}/items/${item.id}`, { quantity: q, remark: item.remark || '' });
      }
      item.qty = q;
    },
    async updateItem(item, { remark, spec } = {}) {
      if (remark !== undefined) item.remark = remark;
      if (spec !== undefined) item.spec = spec;
      if (this.orderId && typeof item.id === 'number') {
        await api.put(`/orders/${this.orderId}/items/${item.id}`, { quantity: item.qty, remark: item.remark || '' });
      }
    },
    async removeItem(item) {
      if (this.orderId && typeof item.id === 'number') {
        await api.del(`/orders/${this.orderId}/items/${item.id}`);
      }
      this.items = this.items.filter((i) => i.id !== item.id);
    },
    clearItems() {
      this.items = [];
    },
    setDiscount(amount, label = '') {
      this.discount = Math.max(0, Number(amount) || 0);
      this.discountLabel = label;
    },
    setPayment(method) {
      this.paymentMethod = method;
      if (method !== 'cash') this.received = 0;
    },
    setReceived(v) {
      this.received = v;
    },
    /** 掛單（僅快餐/無桌台模式） */
    async hold() {
      if (!this.items.length) throw new Error('購物車為空，無可掛單');
      if (this.orderId) throw new Error('桌台訂單請直接結帳或作廢');
      const order = await api.post('/orders', {
        status: 'held',
        items: this.items.map((i) => this.itemPayload(i)),
      });
      this.reset();
      return order;
    },
    async loadHeld() {
      this.heldOrders = await api.get('/orders?status=held&limit=50');
    },
    /** 取單：把掛單載入購物車並刪除掛單記錄 */
    async resumeHeld(order) {
      const full = await api.get(`/orders/${order.id}`);
      this.reset();
      this.items = (full.items || []).map((it) => this.mapItem(it));
      await api.del(`/orders/${order.id}`);
      this.loadHeld();
    },
    /** 組裝傳給後端的明細 payload（含套餐選項） */
    itemPayload(i) {
      const payload = {
        product_id: i.product_id,
        quantity: i.qty,
        spec: i.spec || undefined,
        remark: i.remark || undefined,
      };
      if (i.options) payload.options = i.options;
      else if (i.spec_diff) payload.spec_diff = i.spec_diff;
      return payload;
    },
    /** 結帳：返回已結帳訂單 */
    async checkout() {
      if (!this.items.length) throw new Error('購物車為空');
      let orderId = this.orderId;
      if (!orderId) {
        const created = await api.post('/orders', {
          items: this.items.map((i) => this.itemPayload(i)),
        });
        orderId = created.id;
        // 以後端覆核後的價格刷新購物車（飲品時段價等以前端展示為準可能不一致）
        if (created.items && created.items.length) {
          this.items = created.items.map((it) => this.mapItem(it));
          this.orderId = orderId;
        }
      }
      if (this.paymentMethod === 'cash' && Number(this.received || 0) < this.total) {
        throw new Error(`收現金額不足（應收 ${this.total}）`);
      }
      const paid = await api.post(`/orders/${orderId}/pay`, {
        payment_method: this.paymentMethod,
        discount_amount: this.discount,
        received_amount: this.received,
      });
      this.reset();
      return paid;
    },
    /** 作廢進行中的訂單（店長） */
    async voidOrder() {
      if (!this.orderId) throw new Error('當前購物車尚未開台，無訂單可作廢');
      await api.post(`/orders/${this.orderId}/void`);
      this.reset();
    },
  },
});

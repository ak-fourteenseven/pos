import { acceptHMRUpdate, defineStore } from 'pinia';
import { api } from '@shared/api';
import { useCatalogStore } from '@shared/stores/catalog';
import { useToastStore } from '@shared/stores/toast';
import { paymentForTableArea } from '@shared/utils/format';

/**
 * 收銀台購物車
 * - 開台模式：orderId 不為 null，每次加菜/改動即時同步服務端；order_no 於首次下單送廚才發放
 * - 快餐/外帶模式：orderId 為 null，購物車暫存於前端，下單時一次性建立訂單並發號
 */
let tempSeq = 0;

export const usePosStore = defineStore('pos', {
  state: () => ({
    orderId: null,
    orderNo: '',
    tableId: null,
    tableNumber: '',
    /** 桌台用餐人數 */
    guestCount: 0,
    items: [], // { id, product_id, name, emoji, color, price, qty, spec, remark, spec_diff }
    /** 購物車目前選中的明細 id（單選；無選中為 null） */
    selectedItemId: null,
    discount: 0,
    discountLabel: '',
    paymentMethod: 'cash',
    received: 0,
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
    isTableMode: (s) => s.tableId != null,
    /** 是否已建立服務端訂單（開台或快餐下單後） */
    hasServerOrder: (s) => s.orderId != null,
    /** 尚未送廚的明細數量（>0 時需按「下單」送廚房） */
    pendingCount: (s) => s.items.filter((it) => !it.sent).length,
    /** 目前選中的購物車明細（找不到則視為未選） */
    selectedItem: (s) => {
      if (s.selectedItemId == null) return null;
      return s.items.find((it) => String(it.id) === String(s.selectedItemId)) || null;
    },
  },
  actions: {
    reset() {
      this.orderId = null;
      this.orderNo = '';
      this.tableId = null;
      this.tableNumber = '';
      this.guestCount = 0;
      this.items = [];
      this.selectedItemId = null;
      this.discount = 0;
      this.discountLabel = '';
      this.paymentMethod = 'cash';
      this.received = 0;
    },
    /** 選中購物車某一列（傳 item 或 id；傳 null 清除） */
    selectItem(itemOrId) {
      if (itemOrId == null) {
        this.selectedItemId = null;
        return;
      }
      const id = typeof itemOrId === 'object' ? itemOrId.id : itemOrId;
      this.selectedItemId = id;
    },
    /** 選中購物車最後一列（空車則清除） */
    selectLastItem() {
      const last = this.items[this.items.length - 1];
      this.selectedItemId = last ? last.id : null;
    },
    /** 若選中 id 已不在 items 中則改選最後一列（寬鬆比對，避免 number/string 不一致） */
    syncSelection() {
      if (this.selectedItemId == null) {
        this.selectLastItem();
        return;
      }
      if (!this.items.some((it) => String(it.id) === String(this.selectedItemId))) {
        this.selectLastItem();
      }
    },
    isSelected(itemOrId) {
      if (this.selectedItemId == null || itemOrId == null) return false;
      const id = typeof itemOrId === 'object' ? itemOrId.id : itemOrId;
      return String(this.selectedItemId) === String(id);
    },
    /** 依桌台區域套用預設支付（Keepta / foodpanda）；大廳等維持現金 */
    applyPaymentForTable(tableId) {
      if (!tableId) return;
      const t = useCatalogStore().tables.find((x) => Number(x.id) === Number(tableId));
      const platform = paymentForTableArea(t?.area);
      this.paymentMethod = platform || 'cash';
      if (platform) this.received = 0;
    },
    /** 開台後綁定服務端訂單；人數未設時回退桌台容納人數 */
    bindOrder(order, tableNumber) {
      this.reset();
      this.orderId = order.id;
      this.orderNo = order.order_no || '';
      this.tableId = order.table_id;
      this.tableNumber = tableNumber || '';
      const guests = Math.max(0, Number(order.guest_count) || 0);
      if (guests > 0) {
        this.guestCount = guests;
      } else {
        const t = useCatalogStore().tables.find((x) => Number(x.id) === Number(order.table_id));
        this.guestCount = Math.max(0, Number(t?.capacity) || 0);
      }
      this.items = (order.items || []).map((it) => this.mapItem(it));
      this.selectLastItem();
      this.applyPaymentForTable(order.table_id);
    },
    /** 改桌台用餐人數 */
    async setGuestCount(n) {
      const count = Math.max(0, Math.min(999, Math.floor(Number(n) || 0)));
      if (this.orderId) {
        const updated = await api.patch(`/orders/${this.orderId}`, { guest_count: count });
        this.guestCount = Math.max(0, Number(updated?.guest_count) || count);
        return this.guestCount;
      }
      this.guestCount = count;
      return count;
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
        sent: !!it.sent_at,
        sent_at: it.sent_at || null,
      };
    },
    /** 一般單品（含舊版規格） */
    async addProduct(product, { spec = '', spec_diff = 0, remark = '', qty = 1 } = {}) {
      if (this.orderId) {
        const it = await api.post(`/orders/${this.orderId}/items`, {
          product_id: product.id, quantity: qty, spec, spec_diff, remark,
        });
        const mapped = this.mapItem(it);
        this.items.push(mapped);
        this.selectItem(mapped);
      } else {
        const row = {
          id: `t${++tempSeq}`,
          product_id: product.id,
          name: product.name,
          price: Number(product.price) + Number(spec_diff || 0),
          qty,
          spec,
          remark,
        };
        this.items.push(row);
        this.selectItem(row);
      }
    },
    /** 套餐（向導結果）：unitPrice 為前端即時計算價，後端會覆核 */
    async addCombo(product, options, unitPrice, qty = 1) {
      if (this.orderId) {
        const it = await api.post(`/orders/${this.orderId}/items`, {
          product_id: product.id, quantity: qty, options,
        });
        const mapped = this.mapItem(it);
        this.items.push(mapped);
        this.selectItem(mapped);
      } else {
        const row = {
          id: `t${++tempSeq}`,
          product_id: product.id,
          name: product.name,
          price: Number(unitPrice),
          qty,
          spec: '',
          remark: '',
          item_type: 'combo',
          options,
        };
        this.items.push(row);
        this.selectItem(row);
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
        const mapped = this.mapItem(it);
        this.items.push(mapped);
        this.selectItem(mapped);
      } else {
        const row = {
          id: `t${++tempSeq}`,
          product_id: product.id,
          name: product.name,
          price: Number(product.price), // 後端結帳時依時段覆核
          qty,
          spec: tempLabel,
          remark: preferences.join('、'),
          item_type: 'simple',
          options,
        };
        this.items.push(row);
        this.selectItem(row);
      }
    },
    async setQty(item, qty) {
      const q = Number(qty);
      if (q <= 0) return this.removeItem(item);
      if (this.orderId && typeof item.id === 'number') {
        await api.put(`/orders/${this.orderId}/items/${item.id}`, { quantity: q, remark: item.remark || '' });
      }
      item.qty = q;
      this.selectItem(item);
    },
    async updateItem(item, { remark, spec } = {}) {
      if (remark !== undefined) item.remark = remark;
      if (spec !== undefined) item.spec = spec;
      if (this.orderId && typeof item.id === 'number') {
        await api.put(`/orders/${this.orderId}/items/${item.id}`, {
          quantity: item.qty,
          remark: item.remark || '',
          price: item.price,
        });
      }
    },
    /** 改單品單價（改價） */
    async setItemPrice(item, price) {
      const p = Math.max(0, Number(price) || 0);
      if (this.orderId && typeof item.id === 'number') {
        await api.put(`/orders/${this.orderId}/items/${item.id}`, {
          quantity: item.qty,
          remark: item.remark || '',
          price: p,
        });
      }
      item.price = p;
      this.selectItem(item);
    },
    async removeItem(item) {
      if (this.orderId && typeof item.id === 'number') {
        await api.del(`/orders/${this.orderId}/items/${item.id}`);
      }
      this.items = this.items.filter((i) => i.id !== item.id);
      this.selectLastItem();
    },
    clearItems() {
      this.items = [];
      this.selectedItemId = null;
    },
    setDiscount(amount, label = '') {
      this.discount = Math.max(0, Number(amount) || 0);
      this.discountLabel = label;
    },
    setPayment(method) {
      // 外賣桌區鎖定平台支付，不接受操作面板切換
      const t = useCatalogStore().tables.find((x) => Number(x.id) === Number(this.tableId));
      const platform = paymentForTableArea(t?.area);
      if (platform) {
        this.paymentMethod = platform;
        this.received = 0;
        return;
      }
      this.paymentMethod = method;
      if (method !== 'cash') this.received = 0;
    },
    setReceived(v) {
      this.received = v;
    },
    /** 組裝傳給後端的明細 payload（含套餐選項；price 保留改價後單價） */
    itemPayload(i) {
      const payload = {
        product_id: i.product_id,
        quantity: i.qty,
        price: Number(i.price),
        spec: i.spec || undefined,
        remark: i.remark || undefined,
      };
      if (i.options) payload.options = i.options;
      else if (i.spec_diff) payload.spec_diff = i.spec_diff;
      return payload;
    },
    /**
     * 下單（送廚房）：把未送廚明細標記送廚並取回廚房單。
     * 快餐/外帶模式會先建立訂單再送廚；已下過單的訂單則送加菜追加。
     * @returns {{ appended: boolean, sent_count: number, ticket: object }}
     */
    async submitOrder() {
      if (!this.items.length) throw new Error('購物車為空，無可下單');
      let orderId = this.orderId;
      if (!orderId) {
        const created = await api.post('/orders', {
          items: this.items.map((i) => this.itemPayload(i)),
        });
        orderId = created.id;
        this.orderId = orderId;
        this.orderNo = created.order_no || '';
        if (created.items && created.items.length) {
          this.items = created.items.map((it) => this.mapItem(it));
          this.selectLastItem();
        }
      }
      const res = await api.post(`/orders/${orderId}/submit`);
      if (res?.order_no) this.orderNo = res.order_no;
      // 以服務端狀態刷新購物車（明細帶上 sent_at）
      const full = await api.get(`/orders/${orderId}`);
      if (full) {
        if (full.order_no) this.orderNo = full.order_no;
        if (full.items) {
          this.items = full.items.map((it) => this.mapItem(it));
          this.selectLastItem();
        }
      }
      return res;
    },
    /** 廚房單（補印/重印：取該訂單已送廚的全部明細） */
    async kitchenTicket() {
      if (!this.orderId) throw new Error('尚未下單，無廚房單');
      return api.get(`/orders/${this.orderId}/ticket`);
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
          this.syncSelection();
        }
      }
      // 外賣桌區強制平台支付（與後端覆寫一致）
      const t = useCatalogStore().tables.find((x) => Number(x.id) === Number(this.tableId));
      const platformPay = paymentForTableArea(t?.area);
      const method = platformPay || this.paymentMethod;
      if (method === 'cash' && Number(this.received || 0) < this.total) {
        throw new Error(`收現金額不足（應收 ${this.total}）`);
      }
      const paid = await api.post(`/orders/${orderId}/pay`, {
        payment_method: method,
        discount_amount: this.discount,
        received_amount: this.received,
      });
      this.reset();
      return paid;
    },
    /**
     * 作廢／清台（店長）
     * 尚未發單號的草稿會被服務端刪除並清台；已發號則作廢。
     * @returns {{ abandoned?: boolean, cleared?: boolean, updated?: boolean }}
     */
    async voidOrder() {
      if (!this.orderId) throw new Error('當前購物車尚未開台，無訂單可作廢');
      const res = await api.post(`/orders/${this.orderId}/void`);
      this.reset();
      return res || {};
    },
    /** 分單：把選中明細拆到新訂單，可指定目標桌台 */
    async splitOrder(itemIds, tableId = null) {
      if (!this.orderId) throw new Error('尚未開單，無法分單');
      const res = await api.post(`/orders/${this.orderId}/split`, {
        item_ids: itemIds,
        table_id: tableId,
      });
      this.items = res.original.items.map((it) => this.mapItem(it));
      this.selectLastItem();
      return res.new_order;
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(usePosStore, import.meta.hot));
}

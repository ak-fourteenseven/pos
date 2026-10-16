import { defineStore } from 'pinia';

let seq = 0;

export const useToastStore = defineStore('toast', {
  state: () => ({ toasts: [] }),
  actions: {
    push(message, type = 'info') {
      const id = ++seq;
      this.toasts.push({ id, message, type });
      setTimeout(() => this.remove(id), 2800);
    },
    remove(id) {
      this.toasts = this.toasts.filter((t) => t.id !== id);
    },
    success(msg) { this.push(msg, 'success'); },
    error(msg) { this.push(msg, 'error'); },
  },
});

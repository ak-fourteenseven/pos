<script setup>
import { useToastStore } from './stores/toast';

const toast = useToastStore();
</script>

<template>
  <router-view />

  <!-- 全域輕提示 -->
  <div class="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 pointer-events-none">
    <transition-group name="toast">
      <div
        v-for="t in toast.toasts"
        :key="t.id"
        class="px-5 py-2.5 rounded-xl shadow-lg text-sm font-bold text-white"
        :class="{
          'bg-gray-800': t.type === 'info',
          'bg-emerald-500': t.type === 'success',
          'bg-red-500': t.type === 'error',
        }"
      >
        {{ t.message }}
      </div>
    </transition-group>
  </div>
</template>

<style>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-12px);
}
</style>

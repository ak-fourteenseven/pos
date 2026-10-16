<script setup>
import { onMounted, onUnmounted } from 'vue';

defineProps({
  modelValue: { type: [Boolean, Object], default: false },
  title: { type: String, default: '' },
  width: { type: String, default: 'max-w-lg' },
});
const emit = defineEmits(['close', 'update:modelValue']);

function close() {
  emit('update:modelValue', false);
  emit('close');
}
function onKey(e) {
  if (e.key === 'Escape') close();
}
onMounted(() => document.addEventListener('keydown', onKey));
onUnmounted(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <teleport to="body">
    <div v-if="modelValue" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-[2px]" @click="close" />
      <div class="relative bg-white rounded-2xl shadow-2xl w-full flex flex-col max-h-[90vh]" :class="width">
        <div class="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h3 class="text-lg font-extrabold">{{ title }}</h3>
          <button
            class="w-8 h-8 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 text-lg font-bold"
            @click="close"
          >
            ✕
          </button>
        </div>
        <div class="p-5 overflow-y-auto">
          <slot />
        </div>
        <div v-if="$slots.footer" class="px-5 py-4 border-t border-gray-100 flex justify-end gap-2 shrink-0">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </teleport>
</template>

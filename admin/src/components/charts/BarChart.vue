<script setup>
import { computed } from 'vue';

const props = defineProps({
  data: { type: Array, default: () => [] }, // [{ label, value }]
  color: { type: String, default: '#f97316' },
  height: { type: Number, default: 180 },
  format: { type: Function, default: (v) => v },
});

const max = computed(() => Math.max(...props.data.map((d) => Number(d.value) || 0), 1));
const pct = (v) => `${((Number(v) || 0) / max.value) * 100}%`;
</script>

<template>
  <div class="flex items-end gap-1.5 sm:gap-2" :style="{ height: height + 'px' }">
    <div v-for="(d, i) in data" :key="i" class="flex-1 flex flex-col justify-end items-center h-full min-w-0">
      <span class="text-[10px] font-bold text-gray-500 mb-1 truncate w-full text-center">{{ format(d.value) }}</span>
      <div class="w-full flex-1 flex items-end min-h-0">
        <div
          class="w-full rounded-t-md transition-all"
          :style="{ height: pct(d.value), background: color, minHeight: Number(d.value) > 0 ? '3px' : '0' }"
        />
      </div>
      <span class="text-[10px] text-gray-400 mt-1.5 truncate w-full text-center">{{ d.label }}</span>
    </div>
    <div v-if="!data.length" class="flex-1 flex items-center justify-center text-sm text-gray-300">暫無數據</div>
  </div>
</template>

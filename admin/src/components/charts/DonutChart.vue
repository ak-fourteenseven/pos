<script setup>
import { computed } from 'vue';

const props = defineProps({
  data: { type: Array, default: () => [] }, // [{ label, value, color }]
  size: { type: Number, default: 170 },
  centerLabel: { type: String, default: '' },
  centerSub: { type: String, default: '合計' },
});

const R = 40;
const C = 2 * Math.PI * R;

const total = computed(() => props.data.reduce((s, d) => s + (Number(d.value) || 0), 0));
const segs = computed(() => {
  let acc = 0;
  return props.data.map((d) => {
    const frac = total.value ? (Number(d.value) || 0) / total.value : 0;
    const seg = { ...d, frac, dash: frac * C, offset: -acc * C };
    acc += frac;
    return seg;
  });
});
</script>

<template>
  <div class="flex items-center gap-5 flex-wrap">
    <svg :width="size" :height="size" viewBox="0 0 100 100" class="shrink-0">
      <circle cx="50" cy="50" :r="R" fill="none" stroke="#f3f4f6" stroke-width="13" />
      <circle
        v-for="(s, i) in segs"
        :key="i"
        cx="50"
        cy="50"
        :r="R"
        fill="none"
        :stroke="s.color"
        stroke-width="13"
        :stroke-dasharray="`${s.dash} ${C - s.dash}`"
        :stroke-dashoffset="s.offset"
        transform="rotate(-90 50 50)"
      />
      <text x="50" y="47" text-anchor="middle" style="font-size: 11px; font-weight: 800" class="fill-gray-800">
        {{ centerLabel }}
      </text>
      <text x="50" y="60" text-anchor="middle" style="font-size: 7px" class="fill-gray-400">{{ centerSub }}</text>
    </svg>
    <ul class="space-y-2 text-sm">
      <li v-for="(s, i) in segs" :key="i" class="flex items-center gap-2">
        <span class="w-3 h-3 rounded-sm shrink-0" :style="{ background: s.color }" />
        <span class="font-bold text-gray-700">{{ s.label }}</span>
        <span class="text-gray-400 tabular-nums">{{ (s.frac * 100).toFixed(1) }}%</span>
      </li>
      <li v-if="!segs.length" class="text-gray-300">暫無數據</li>
    </ul>
  </div>
</template>

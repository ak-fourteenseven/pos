<script setup>
import { computed, useId } from 'vue';

const props = defineProps({
  data: { type: Array, default: () => [] }, // [{ label, value }]
  color: { type: String, default: '#f97316' },
  height: { type: Number, default: 200 },
});

const W = 600;
const H = 200;
const PAD = 10;
const gid = useId();

const points = computed(() => {
  const vals = props.data.map((d) => Number(d.value) || 0);
  const max = Math.max(...vals, 1);
  const n = props.data.length;
  return props.data.map((d, i) => ({
    label: d.label,
    value: Number(d.value) || 0,
    x: n === 1 ? W / 2 : PAD + (i * (W - PAD * 2)) / (n - 1),
    y: H - PAD - ((Number(d.value) || 0) / max) * (H - PAD * 2),
  }));
});
const linePath = computed(() =>
  points.value.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '));
const areaPath = computed(() => {
  if (!points.value.length) return '';
  const first = points.value[0];
  const last = points.value[points.value.length - 1];
  return `${linePath.value} L${last.x.toFixed(1)} ${H} L${first.x.toFixed(1)} ${H} Z`;
});
</script>

<template>
  <div>
    <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" class="w-full" :style="{ height: height + 'px' }">
      <defs>
        <linearGradient :id="gid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" :stop-color="color" stop-opacity="0.28" />
          <stop offset="100%" :stop-color="color" stop-opacity="0.02" />
        </linearGradient>
      </defs>
      <path v-if="areaPath" :d="areaPath" :fill="`url(#${gid})`" />
      <path
        v-if="linePath"
        :d="linePath"
        fill="none"
        :stroke="color"
        stroke-width="2.5"
        stroke-linejoin="round"
        stroke-linecap="round"
        vector-effect="non-scaling-stroke"
      />
      <circle
        v-for="(p, i) in points"
        :key="i"
        :cx="p.x"
        :cy="p.y"
        r="3"
        fill="#fff"
        :stroke="color"
        stroke-width="2"
        vector-effect="non-scaling-stroke"
      />
    </svg>
    <div class="flex mt-1">
      <span v-for="(d, i) in data" :key="i" class="flex-1 text-center text-[10px] text-gray-400 truncate">{{ d.label }}</span>
    </div>
  </div>
</template>

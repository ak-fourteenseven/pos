<script setup>
import Modal from '@shared/components/Modal.vue';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 廚房單：{ order_no, table_number, appended, created_at, food: [], bar: [] } */
  ticket: { type: Object, default: null },
  currency: { type: String, default: 'NT$' },
});
const emit = defineEmits(['close', 'update:modelValue']);

/** 關閉彈窗：同時通知父層 */
function onClose() {
  emit('update:modelValue', null);
  emit('close');
}
/** 瀏覽器列印（只列印 .print-area 區塊，見 shared/style.css） */
function print() {
  window.print();
}
</script>

<template>
  <Modal :model-value="modelValue" title="廚房單（後廚 / 水吧）" width="max-w-md" @close="onClose">
    <div v-if="ticket" class="print-area space-y-4">
      <div class="text-center space-y-1">
        <div class="font-extrabold text-lg flex items-center justify-center gap-1.5"><span class="ico">🍳</span>廚房單</div>
        <div class="text-xs text-gray-400">
          {{ ticket.order_no }}<span v-if="ticket.table_number"> · 桌台 {{ ticket.table_number }}</span> · {{ ticket.created_at }}
        </div>
        <span v-if="ticket.appended" class="chip bg-amber-100 text-amber-700">加菜追加</span>
        <span v-else class="chip bg-brand-100 text-brand-700">新單</span>
      </div>

      <div v-if="ticket.food.length" class="rounded-xl border border-gray-200 p-4">
        <div class="text-xs font-bold text-gray-400 mb-2">【後廚】</div>
        <pre class="text-sm font-mono whitespace-pre-wrap leading-relaxed">{{ ticket.food.join('\n') }}</pre>
      </div>

      <div v-if="ticket.bar.length" class="rounded-xl border border-gray-200 p-4">
        <div class="text-xs font-bold text-gray-400 mb-2">【水吧】</div>
        <pre class="text-sm font-mono whitespace-pre-wrap leading-relaxed">{{ ticket.bar.join('\n') }}</pre>
      </div>

      <div v-if="!ticket.food.length && !ticket.bar.length" class="text-center text-gray-300 py-6 text-sm">
        無明細
      </div>

      <p class="text-xs text-gray-400">
        實際硬體列印需在桌面殼（Tauri/Electron）接入 ESC/POS 印表機；此處為列印內容預覽。
      </p>
    </div>

    <template #footer>
      <button class="btn-ghost" @click="onClose">關閉</button>
      <button class="btn-primary" @click="print">🖨️ 列印</button>
    </template>
  </Modal>
</template>

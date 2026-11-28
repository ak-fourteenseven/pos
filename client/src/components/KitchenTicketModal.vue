<script setup>
import { ref } from 'vue';
import Modal from '@shared/components/Modal.vue';
import { sendPrintJob, wrapReceiptHtml, escapeHtml } from '@shared/utils/print';
import { useToastStore } from '@shared/stores/toast';
import { useCatalogStore } from '@shared/stores/catalog';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 廚房單：{ order_no, table_number, appended, created_at, food: [], bar: [] } */
  ticket: { type: Object, default: null },
  currency: { type: String, default: 'NT$' },
});
const emit = defineEmits(['close', 'update:modelValue']);
const toast = useToastStore();
const catalog = useCatalogStore();
const printing = ref(false);

/** 關閉彈窗：同時通知父層 */
function onClose() {
  emit('update:modelValue', null);
  emit('close');
}

function buildKitchenHtml(ticket) {
  const lines = [];
  lines.push(`<div class="center title">廚房單</div>`);
  lines.push(`<div class="center muted">${escapeHtml(ticket.order_no || '')}`
    + (ticket.table_number ? ` · 桌台 ${escapeHtml(ticket.table_number)}` : '')
    + (ticket.created_at ? ` · ${escapeHtml(ticket.created_at)}` : '')
    + `</div>`);
  lines.push(`<div class="center muted">${ticket.appended ? '加菜追加' : '新單'}</div>`);
  lines.push('<hr class="sep"/>');
  if (ticket.food?.length) {
    lines.push('<div class="muted">【後廚】</div>');
    lines.push(`<pre>${escapeHtml(ticket.food.join('\n'))}</pre>`);
  }
  if (ticket.bar?.length) {
    lines.push('<hr class="sep"/>');
    lines.push('<div class="muted">【水吧】</div>');
    lines.push(`<pre>${escapeHtml(ticket.bar.join('\n'))}</pre>`);
  }
  if (!ticket.food?.length && !ticket.bar?.length) {
    lines.push('<div class="center muted">無明細</div>');
  }
  return wrapReceiptHtml(lines.join('\n'), { title: '廚房單' });
}

function hasPrintPrinter() {
  return !!(catalog.settings.printer_print_only
    || catalog.settings.printer_kitchen
    || catalog.settings.printer_receipt
    || catalog.settings.printers_from_env === '1');
}

/** 送到 PRINTER_NAME（僅列印）；未設定則瀏覽器列印 */
async function print() {
  if (!props.ticket || printing.value) return;
  if (!hasPrintPrinter()) {
    window.print();
    return;
  }
  printing.value = true;
  try {
    const html = buildKitchenHtml(props.ticket);
    await sendPrintJob({
      role: 'kitchen',
      html,
      jobName: `kitchen-${props.ticket.order_no || 'ticket'}`,
      widthMm: 80,
      openDrawer: false,
    });
    toast.success('已送交列印');
  } catch (e) {
    toast.error(e.message || '列印失敗，改用瀏覽器列印');
    window.print();
  } finally {
    printing.value = false;
  }
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
        按「列印」送到 <span class="font-mono">PRINTER_NAME</span>（僅列印）；未設定或失敗時改開瀏覽器列印。
      </p>
    </div>

    <template #footer>
      <button class="btn-ghost" @click="onClose">關閉</button>
      <button class="btn-primary" :disabled="printing" @click="print">
        {{ printing ? '列印中…' : '🖨️ 列印' }}
      </button>
    </template>
  </Modal>
</template>

/**
 * 前端呼叫本機服務端列印（server/src/print → CUPS）。
 * 失敗時拋 Error；呼叫端可自行 fallback 到 window.print()。
 */
import { api } from '../api';

/**
 * @param {object} opts
 * @param {string} [opts.printer]
 * @param {'receipt'|'kitchen'|'bar'} [opts.role]
 * @param {boolean} [opts.openDrawer] 現金結賬時 true → OPEN_DRAWER_PRINTER_NAME
 * @param {string} [opts.html]
 * @param {string} [opts.text]
 * @param {string} [opts.jobName]
 * @param {number} [opts.copies]
 * @param {number} [opts.widthMm]
 */
export function sendPrintJob(opts) {
  return api.post('/print', opts);
}

export function fetchPrinters() {
  return api.get('/printers');
}

/** 測試列印：simulate=true 假裝成功；false 真實送交 */
export function testPrint({ simulate = false, openDrawer = true } = {}) {
  return api.post('/print/test', { simulate, openDrawer });
}

/** 將片段包成熱感紙寬度友善的 HTML */
export function wrapReceiptHtml(innerHtml, { title = '' } = {}) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<title>${escapeHtml(title)}</title>
<style>
  @page { margin: 3mm; size: 80mm auto; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif;
    font-size: 13px; color: #000; width: 74mm; margin: 0; padding: 0;
  }
  .center { text-align: center; }
  .muted { color: #444; font-size: 11px; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  .grow { flex: 1; min-width: 0; }
  .sep { border: none; border-top: 1px dashed #999; margin: 8px 0; }
  pre { font-family: ui-monospace, Menlo, "Courier New", monospace;
        font-size: 12px; white-space: pre-wrap; margin: 0; }
  .title { font-weight: 800; font-size: 16px; }
  .total { font-weight: 800; font-size: 14px; }
</style></head>
<body>${innerHtml}</body></html>`;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export { escapeHtml };

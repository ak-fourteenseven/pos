/**
 * POS 本機列印：依 server/.env 印表機名稱送交（Windows 生產機 / CUPS 開發機）。
 * OPEN_DRAWER_PRINTER_NAME — 列印並開錢箱
 * PRINTER_NAME — 僅列印
 */
const { listPrinters, submitBuffer } = require('./spooler');
const { htmlToPdf, resolveChromePath } = require('./htmlToPdf');
const { openCashDrawer } = require('./drawer');
const { getPrinterEnv, getConfiguredPrinters, resolveEnvPrinter } = require('./config');

/**
 * @param {object} job
 * @param {string} [job.printer]
 * @param {'receipt'|'kitchen'|'bar'} [job.role]
 * @param {boolean} [job.openDrawer]
 * @param {boolean} [job.simulate] true = HTML→PDF 後假裝送交成功（不碰真實印表機）
 * @param {string} [job.html]
 * @param {string} [job.text]
 * @param {string} [job.jobName]
 * @param {number} [job.copies]
 * @param {number} [job.widthMm]
 */
async function printJob(job = {}) {
  const simulate = !!job.simulate;
  const target = resolveEnvPrinter({
    printer: job.printer,
    role: job.role,
    openDrawer: !!job.openDrawer,
  });
  if (!target?.name) {
    throw new Error(
      '尚未設定印表機。請在 server/.env 設定 OPEN_DRAWER_PRINTER_NAME 與／或 PRINTER_NAME',
    );
  }

  const copies = Math.max(1, Math.min(99, Number(job.copies) || 1));
  const jobName = job.jobName || (job.role ? `POS-${job.role}` : 'POS-print');
  let printResult = null;
  let pdfBytes = 0;

  if (job.html != null && String(job.html).trim()) {
    const pdf = await htmlToPdf(String(job.html), { widthMm: job.widthMm });
    pdfBytes = pdf.length;
    if (simulate) {
      printResult = {
        jobId: `SIM-${Date.now()}`,
        printer: target.name,
        raw: 'simulated success (no spooler submit)',
        backend: 'simulate',
        pdfBytes,
      };
    } else {
      printResult = await submitBuffer({
        printer: target.name,
        buffer: pdf,
        ext: 'pdf',
        jobName,
        copies,
        mime: 'application/pdf',
      });
      printResult.pdfBytes = pdfBytes;
    }
  } else if (job.text != null && String(job.text).length) {
    const buf = Buffer.from(String(job.text), 'utf8');
    if (simulate) {
      printResult = {
        jobId: `SIM-${Date.now()}`,
        printer: target.name,
        raw: 'simulated success (no spooler submit)',
        backend: 'simulate',
        pdfBytes: 0,
      };
    } else {
      printResult = await submitBuffer({
        printer: target.name,
        buffer: buf,
        ext: 'txt',
        jobName,
        copies,
        mime: 'text/plain',
      });
    }
  } else if (!target.openDrawer) {
    throw new Error('請提供 html 或 text 列印內容');
  }

  let drawer = null;
  if (target.openDrawer) {
    if (simulate) {
      drawer = { printer: target.name, backend: 'simulate', jobId: `SIM-DRAWER-${Date.now()}` };
    } else {
      try {
        drawer = await openCashDrawer(target.name);
      } catch (e) {
        // 列印已成功時，開箱失敗仍回傳列印結果並附上警告
        drawer = { error: e.message };
      }
    }
  }

  return {
    ...(printResult || {}),
    printer: target.name,
    role: job.role || null,
    format: printResult ? (job.html ? 'pdf' : 'text') : null,
    simulate,
    openedDrawer: !!(drawer && !drawer.error),
    drawer,
  };
}

/** 測試用小票 HTML */
function buildTestReceiptHtml() {
  const now = new Date().toLocaleString('zh-HK', { hour12: false });
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
  body { font-family: sans-serif; font-size: 13px; width: 72mm; margin: 0; }
  .c { text-align: center; } .b { font-weight: 800; }
</style></head><body>
  <div class="c b">POS 測試列印</div>
  <div class="c">${now}</div>
  <hr/>
  <div>品項 A ×1　　$10</div>
  <div>品項 B ×2　　$20</div>
  <hr/>
  <div class="b">合計　　$30</div>
  <div class="c">— TEST —</div>
</body></html>`;
}

async function getPrintStatus() {
  const printers = await listPrinters().catch((e) => ({ error: e.message, list: [] }));
  const list = Array.isArray(printers) ? printers : printers.list;
  const configured = getConfiguredPrinters();
  const env = getPrinterEnv();
  return {
    platform: process.platform,
    printers: list,
    error: Array.isArray(printers) ? null : printers.error,
    chromePath: resolveChromePath(),
    env: {
      OPEN_DRAWER_PRINTER_NAME: env.openDrawerPrinter,
      PRINTER_NAME: env.printer,
    },
    configured,
  };
}

module.exports = {
  listPrinters,
  printJob,
  getPrintStatus,
  openCashDrawer,
  getPrinterEnv,
  getConfiguredPrinters,
  resolveEnvPrinter,
  buildTestReceiptHtml,
};

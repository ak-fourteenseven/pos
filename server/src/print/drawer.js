/**
 * 開錢箱：對印表機送 ESC/POS 脈衝（Epson 相容：ESC p 0 t1 t2）。
 * Windows：copy /b 到 \\localhost\印表機名稱
 * macOS/Linux：lp -o raw
 */
const { submitBuffer } = require('./spooler');

/** ESC p m t1 t2 — pin 2 (m=0), ~100ms on / ~500ms off */
const ESC_POS_OPEN_DRAWER = Buffer.from([0x1B, 0x70, 0x00, 0x19, 0xFA]);

/**
 * @param {string} printerName
 * @returns {Promise<{ printer: string, backend?: string }>}
 */
async function openCashDrawer(printerName) {
  const name = String(printerName || '').trim();
  if (!name) throw new Error('開錢箱需要印表機名稱（OPEN_DRAWER_PRINTER_NAME）');

  const result = await submitBuffer({
    printer: name,
    buffer: ESC_POS_OPEN_DRAWER,
    ext: 'bin',
    jobName: 'POS-open-drawer',
    copies: 1,
    raw: true,
  });
  return { printer: name, backend: result.backend, jobId: result.jobId };
}

module.exports = { openCashDrawer, ESC_POS_OPEN_DRAWER };

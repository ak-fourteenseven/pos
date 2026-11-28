/**
 * HTML → PDF（puppeteer-core + 本機 Chrome / Chromium）。
 * 不打包瀏覽器，安裝體積小；可用環境變數 CHROME_PATH / PW_CHROME_PATH 覆寫路徑。
 */
const fs = require('node:fs');

const CANDIDATE_PATHS = [
  process.env.CHROME_PATH,
  process.env.PW_CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

function resolveChromePath() {
  for (const p of CANDIDATE_PATHS) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch { /* ignore */ }
  }
  return null;
}

/**
 * @param {string} html
 * @param {{ widthMm?: number }} [opts]
 * @returns {Promise<Buffer>}
 */
async function htmlToPdf(html, opts = {}) {
  let puppeteer;
  try {
    puppeteer = require('puppeteer-core');
  } catch {
    throw new Error('未安裝 puppeteer-core，無法將 HTML 轉成 PDF');
  }

  const executablePath = resolveChromePath();
  if (!executablePath) {
    throw new Error(
      '找不到本機 Chrome/Chromium。請安裝 Google Chrome，或設定環境變數 CHROME_PATH',
    );
  }

  const widthMm = Number(opts.widthMm) > 0 ? Number(opts.widthMm) : 80;
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    const doc = String(html || '');
    const wrapped = /<html[\s>]/i.test(doc)
      ? doc
      : `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
          @page { margin: 4mm; size: ${widthMm}mm auto; }
          body { font-family: -apple-system, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif;
                 font-size: 12px; color: #111; width: ${widthMm - 8}mm; margin: 0; }
          pre { font-family: ui-monospace, Menlo, monospace; white-space: pre-wrap; margin: 0; }
        </style></head><body>${doc}</body></html>`;

    // avoid networkidle0 — local HTML has no network and can flake with "frame detached"
    await page.setContent(wrapped, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate(async () => {
      if (document.fonts?.ready) await document.fonts.ready;
    }).catch(() => {});
    const pdf = await page.pdf({
      printBackground: true,
      width: `${widthMm}mm`,
      // height auto: Chromium uses content; prefer preferCSSPageSize when @page is set
      preferCSSPageSize: true,
      margin: { top: '2mm', right: '2mm', bottom: '2mm', left: '2mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { htmlToPdf, resolveChromePath };

/**
 * CUPS 列印：以印表機名稱送交作業（macOS / Linux）。
 * 使用系統 lp / lpstat，無需原生 npm 套件，方便之後 Electron 一併打包。
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
      ...opts,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => { stdout += d; });
    child.stderr?.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || stdout.trim() || `${cmd} exited ${code}`));
    });
  });
}

/** @returns {Promise<{ name: string, isDefault: boolean }[]>} */
async function listPrinters() {
  let names = [];
  try {
    const { stdout } = await run('lpstat', ['-e']);
    names = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    try {
      const { stdout } = await run('lpstat', ['-a']);
      names = stdout.split(/\r?\n/)
        .map((line) => line.trim().split(/\s+/)[0])
        .filter(Boolean);
    } catch (e) {
      throw new Error(`無法列出印表機（請確認已安裝 CUPS）：${e.message}`);
    }
  }

  let defaultName = null;
  try {
    const { stdout } = await run('lpstat', ['-d']);
    const m = stdout.match(/destination:\s*(\S+)/i)
      || stdout.match(/目標[：:]\s*(\S+)/);
    if (m) defaultName = m[1];
  } catch { /* ignore */ }

  return names.map((name) => ({
    name,
    isDefault: defaultName != null && name === defaultName,
  }));
}

/**
 * 將檔案送交具名印表機。
 * @param {object} opts
 * @param {string} opts.printer
 * @param {string} opts.filePath
 * @param {string} [opts.jobName]
 * @param {number} [opts.copies]
 * @param {string} [opts.mime]  e.g. application/pdf, text/plain
 */
async function submitFile({ printer, filePath, jobName, copies = 1, mime }) {
  if (!printer || !String(printer).trim()) throw new Error('請指定印表機名稱');
  if (!filePath || !fs.existsSync(filePath)) throw new Error('列印檔案不存在');

  const args = ['-d', String(printer).trim()];
  if (jobName) args.push('-t', String(jobName).slice(0, 120));
  if (copies > 1) args.push('-n', String(Math.min(99, Number(copies) || 1)));
  if (mime) args.push('-o', `document-format=${mime}`);
  args.push(filePath);

  const { stdout, stderr } = await run('lp', args);
  const out = `${stdout}\n${stderr}`;
  // English: "request id is Printer-12 (...)" / Chinese CUPS: "要求ID為Printer-12（...）"
  const m = out.match(/request id is\s+(\S+)/i)
    || out.match(/要求ID為\s*(\S+?)(?:（|\(|\s|$)/)
    || out.match(/id is\s+(\S+)/i);
  return { jobId: m ? m[1].replace(/[）)]+$/, '') : null, printer: String(printer).trim(), raw: out.trim() };
}

/** 寫入暫存檔 → 送印 → 刪除暫存（成功或失敗都清） */
async function submitBuffer({ printer, buffer, ext, jobName, copies, mime }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-print-'));
  const filePath = path.join(dir, `job.${ext || 'bin'}`);
  try {
    fs.writeFileSync(filePath, buffer);
    return await submitFile({ printer, filePath, jobName, copies, mime });
  } finally {
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    try { fs.rmdirSync(dir); } catch { /* ignore */ }
  }
}

module.exports = { listPrinters, submitFile, submitBuffer, run };

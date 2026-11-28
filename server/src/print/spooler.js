/**
 * 跨平台送交列印（Windows 生產機為主；macOS/Linux 開發可用）。
 * 優先 print-it-now（Win/macOS/Linux PDF）；不足時退回 CUPS lp 或 Windows PowerShell。
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      windowsHide: true,
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

function tryPrintItNow() {
  try {
    return require('print-it-now');
  } catch {
    return null;
  }
}

async function listPrintersViaPrintItNow() {
  const pin = tryPrintItNow();
  if (!pin?.listPrinters) return null;
  const list = await pin.listPrinters();
  return (list || []).map((p) => ({
    name: p.name,
    isDefault: !!p.isDefault,
  }));
}

async function listPrintersWindows() {
  const ps = [
    '$ErrorActionPreference = "Stop"',
    'Get-CimInstance Win32_Printer | ForEach-Object {',
    '  "{0}`t{1}" -f $_.Name, $_.Default',
    '}',
  ].join('; ');
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-Command', ps]);
  return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [name, def] = line.split('\t');
    return { name, isDefault: String(def).toLowerCase() === 'true' };
  });
}

async function listPrintersCups() {
  let names = [];
  try {
    const { stdout } = await run('lpstat', ['-e']);
    names = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    const { stdout } = await run('lpstat', ['-a']);
    names = stdout.split(/\r?\n/).map((line) => line.trim().split(/\s+/)[0]).filter(Boolean);
  }
  let defaultName = null;
  try {
    const { stdout } = await run('lpstat', ['-d']);
    const m = stdout.match(/destination:\s*(\S+)/i) || stdout.match(/目標[：:]\s*(\S+)/);
    if (m) defaultName = m[1];
  } catch { /* ignore */ }
  return names.map((name) => ({
    name,
    isDefault: defaultName != null && name === defaultName,
  }));
}

/** @returns {Promise<{ name: string, isDefault: boolean }[]>} */
async function listPrinters() {
  const viaPin = await listPrintersViaPrintItNow().catch(() => null);
  if (viaPin && viaPin.length) return viaPin;

  if (process.platform === 'win32') {
    try {
      return await listPrintersWindows();
    } catch (e) {
      throw new Error(`無法列出 Windows 印表機：${e.message}`);
    }
  }
  try {
    return await listPrintersCups();
  } catch (e) {
    throw new Error(`無法列出印表機：${e.message}`);
  }
}

async function submitPdfViaPrintItNow({ printer, buffer, jobName, copies }) {
  const pin = tryPrintItNow();
  if (!pin?.printPdf) return null;
  const job = await pin.printPdf(buffer, {
    printer,
    jobName: jobName || 'POS-print',
    copies: copies || 1,
    scale: 'fit',
    color: 'monochrome',
  });
  return {
    jobId: job?.jobId != null ? String(job.jobId) : null,
    printer,
    raw: JSON.stringify(job || {}),
    backend: 'print-it-now',
  };
}

async function submitFileCups({ printer, filePath, jobName, copies, mime, raw }) {
  const args = ['-d', printer];
  if (jobName) args.push('-t', String(jobName).slice(0, 120));
  if (copies > 1) args.push('-n', String(Math.min(99, copies)));
  if (raw) args.push('-o', 'raw');
  else if (mime) args.push('-o', `document-format=${mime}`);
  args.push(filePath);
  const { stdout, stderr } = await run('lp', args);
  const out = `${stdout}\n${stderr}`;
  const m = out.match(/request id is\s+(\S+)/i)
    || out.match(/要求ID為\s*(\S+?)(?:（|\(|\s|$)/)
    || out.match(/id is\s+(\S+)/i);
  return {
    jobId: m ? m[1].replace(/[）)]+$/, '') : null,
    printer,
    raw: out.trim(),
    backend: 'cups',
  };
}

async function submitPdfWindowsSumatraOrShell({ printer, filePath, jobName }) {
  // 最後手段：用 PowerShell Start-Process -Verb PrintTo（可能彈窗，僅 fallback）
  const ps = [
    `$p = Join-Path $env:TEMP ('pos-print-' + [guid]::NewGuid().ToString() + '.pdf')`,
    `Copy-Item -LiteralPath ${JSON.stringify(filePath)} -Destination $p -Force`,
    `Start-Process -FilePath $p -Verb PrintTo -ArgumentList ${JSON.stringify(printer)} -WindowStyle Hidden`,
    `Start-Sleep -Seconds 2`,
    `Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue`,
    `"ok"`,
  ].join('; ');
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-Command', ps]);
  return {
    jobId: null,
    printer,
    raw: stdout.trim() || `PrintTo ${printer}`,
    backend: 'windows-printto',
    jobName,
  };
}

/**
 * @param {object} opts
 * @param {string} opts.printer
 * @param {Buffer} opts.buffer
 * @param {string} [opts.ext]
 * @param {string} [opts.jobName]
 * @param {number} [opts.copies]
 * @param {string} [opts.mime]
 * @param {boolean} [opts.raw]
 */
async function submitBuffer(opts) {
  const printer = String(opts.printer || '').trim();
  if (!printer) throw new Error('請指定印表機名稱');
  const copies = Math.max(1, Math.min(99, Number(opts.copies) || 1));
  const buffer = opts.buffer;
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('列印內容為空');

  const isPdf = opts.ext === 'pdf' || opts.mime === 'application/pdf'
    || buffer.slice(0, 5).toString() === '%PDF-';

  if (isPdf && !opts.raw) {
    const viaPin = await submitPdfViaPrintItNow({
      printer,
      buffer,
      jobName: opts.jobName,
      copies,
    }).catch((e) => {
      console.warn('[print] print-it-now failed:', e.message);
      return null;
    });
    if (viaPin) return viaPin;
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-print-'));
  const filePath = path.join(dir, `job.${opts.ext || (isPdf ? 'pdf' : 'bin')}`);
  try {
    fs.writeFileSync(filePath, buffer);
    if (process.platform === 'win32') {
      if (isPdf && !opts.raw) {
        return await submitPdfWindowsSumatraOrShell({
          printer,
          filePath,
          jobName: opts.jobName,
        });
      }
      // RAW：copy /b 到本機印表機分享路徑
      const share = `\\\\localhost\\${printer}`;
      await run('cmd.exe', ['/c', 'copy', '/b', filePath, share]);
      return { jobId: null, printer, raw: `copy /b → ${share}`, backend: 'windows-raw' };
    }
    return await submitFileCups({
      printer,
      filePath,
      jobName: opts.jobName,
      copies,
      mime: opts.mime,
      raw: !!opts.raw,
    });
  } finally {
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    try { fs.rmdirSync(dir); } catch { /* ignore */ }
  }
}

module.exports = { listPrinters, submitBuffer, run };

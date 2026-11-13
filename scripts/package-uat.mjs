/**
 * 一鍵打包 UAT 發佈包（pos-uat）：
 *  1. 構建兩個前端（client → public/client、admin → public/admin，admin 部署前綴 /admin/）
 *  2. esbuild 將服務端（含 express/cors 依賴）打包為單檔 bundle
 *  3. Node SEA（Single Executable Application）把 bundle 注入 node.exe 生成 pos.exe
 *  4. 組裝 pos-uat/：pos.exe + public + 啟動腳本 + 說明文件
 *
 * 產出結構：
 *  pos-uat/
 *  ├── pos.exe          ← 雙擊/啟動即運行（API+前台+後台，內含 node 運行時）
 *  ├── public/client    ← 前台收銀（http://localhost:3001）
 *  ├── public/admin     ← 後台管理（http://localhost:3001/admin）
 *  ├── 啟動POS.bat      ← 一鍵啟動並開瀏覽器
 *  ├── README-UAT.txt   ← 使用說明
 *  └── data/            ← 首次運行自動建立（SQLite 資料庫）
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import esbuild from 'esbuild';
import { inject } from 'postject';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const BUILD = path.join(ROOT, 'uat-build');
const OUT = path.join(ROOT, 'pos-uat');

/* SEA sentinel fuse 各 Node 版本不同（v20/22: fce626ab-…；v24: fce680ab2cc4…），
 * 直接從 node.exe 二進位中偵測實際的哨兵字串，避免版本差異造成注入失敗 */
function detectSeaFuse(nodeExePath) {
  const text = fs.readFileSync(nodeExePath).toString('latin1');
  const m = text.match(/NODE_SEA_FUSE_[0-9a-f]{32}/);
  if (!m) throw new Error('無法在 node.exe 中偵測到 SEA sentinel fuse，請確認 Node 版本 ≥ 20');
  return m[0];
}

function sh(cmd, opts = {}) {
  execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });
}

console.log('=== [1/4] 構建前端（client + admin） ===');
sh('npm --prefix client run build');
sh('npm --prefix admin run build', {
  env: { ...process.env, ADMIN_BASE_PATH: '/admin/' },
});

console.log('=== [2/4] esbuild 打包服務端（含依賴） ===');
fs.mkdirSync(BUILD, { recursive: true });
await esbuild.build({
  entryPoints: [path.join(ROOT, 'server/src/index.js')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: `node${process.versions.node.split('.')[0]}`,
  outfile: path.join(BUILD, 'server.cjs'),
  logLevel: 'warning',
  minify: false,
  sourcemap: false,
});

console.log('=== [3/4] Node SEA 生成 pos.exe ===');
fs.writeFileSync(path.join(BUILD, 'sea-config.json'), JSON.stringify({
  main: 'server.cjs',
  output: 'sea-prep.blob',
  disableExperimentalSEAWarning: true,
}, null, 2));
sh('node --experimental-sea-config sea-config.json', { cwd: BUILD });

const exeOut = path.join(BUILD, 'pos.exe');
fs.copyFileSync(process.execPath, exeOut);
const seaFuse = detectSeaFuse(process.execPath);
console.log(`    sentinel fuse: ${seaFuse}`);
await inject(
  exeOut,
  'NODE_SEA_BLOB',
  fs.readFileSync(path.join(BUILD, 'sea-prep.blob')),
  { sentinelFuse: seaFuse, help: false, overwrite: true },
);

console.log('=== [4/4] 組裝 pos-uat/ ===');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'public/client'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'public/admin'), { recursive: true });
fs.cpSync(exeOut, path.join(OUT, 'pos.exe'));
fs.cpSync(path.join(ROOT, 'client/dist'), path.join(OUT, 'public/client'), { recursive: true });
fs.cpSync(path.join(ROOT, 'admin/dist'), path.join(OUT, 'public/admin'), { recursive: true });

const BAT = `@echo off
chcp 65001 >nul
title POS UAT
cd /d %~dp0
echo [POS UAT] 服務啟動中...（關閉此視窗即停止服務）
echo   前台收銀  http://localhost:3001
echo   後台管理  http://localhost:3001/admin
start "" /b cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3001"
pos.exe
pause
`;
fs.writeFileSync(path.join(OUT, '啟動POS.bat'), BAT);

const README = `POS UAT 測試包
==================

一、內容物
  pos.exe        主程式（內含 Node 運行時 + 服務端 + 全部依賴，無需另裝 Node）
  public/client  前台收銀頁面資源
  public/admin   後台管理頁面資源
  啟動POS.bat    一鍵啟動（自動開啟瀏覽器）
  data/          SQLite 資料庫（首次運行自動建立）

二、啟動方式
  雙擊「啟動POS.bat」即可；或直接執行 pos.exe。
  - 前台收銀： http://localhost:3001
  - 後台管理： http://localhost:3001/admin （僅店長帳號 admin）
  - 預設帳號：admin / cashier / cashier2，密碼皆為 123456
  - 關閉命令列視窗 = 停止服務

三、資料與備份
  - 資料庫檔案：data\\pos.db（跟著本資料夾走，整包複製即可遷移）
  - 備份：後台管理 → 系統設定 → 備份（預設備份到 data\\backups）
  - 換埠：在 bat 內 pos.exe 前加一行 set PORT=8080

四、注意
  - 請勿同時運行兩個 pos.exe（SQLite 單檔獨佔寫入）
  - 若與開發模式同機使用，開發服務端佔用 3001 時請先關閉或改 UAT 埠
`;
fs.writeFileSync(path.join(OUT, 'README-UAT.txt'), README);

console.log('');
console.log('✅ UAT 包已完成：' + OUT);
console.log('   pos.exe / public / 啟動POS.bat / README-UAT.txt');

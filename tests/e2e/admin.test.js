/* 單一 SPA：首頁儀表板 + 後台權限端對端測試
 * 覆蓋：登入進入首頁、收銀台導航隔離、收銀員不可進後台、
 *       店長可進後台各頁、時段設定可儲存。
 */
const { chromium } = require('playwright-core');

const BASE = process.env.POS_E2E_BASE || 'http://localhost:5173';
const API = process.env.POS_E2E_API || 'http://localhost:3001/api';

const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${extra ? ' | ' + extra : ''}`);
}

async function api(p, method = 'GET', body, role = 'manager', uid = 1) {
  const res = await fetch(API + p, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-user-id': String(uid), 'x-role': role },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let j = null;
  try { j = await res.json(); } catch { j = null; }
  return { status: res.status, code: j?.code, data: j?.data, message: j?.message };
}

(async () => {
  const launchOpts = { headless: true };
  if (process.env.PW_CHROME_PATH) launchOpts.executablePath = process.env.PW_CHROME_PATH;
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const bodyText = async () => (await page.locator('body').textContent()) || '';
  const navText = async () => (await page.locator('aside').first().textContent()) || '';

  /* =============== A. 登入 → 首頁儀表板 → 收銀台 =============== */
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.removeItem('pos_user'));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('input[placeholder="請輸入帳號"]', 'admin');
  await page.fill('input[type="password"]', '123456');
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => {
    const p = new URL(url).pathname;
    return p === '/' || p === '';
  }, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const dash = await bodyText();
  check('A1 店長登入進入首頁', new URL(page.url()).pathname === '/', page.url());
  check('A2 首頁顯示收銀台與後台入口', dash.includes('收銀台') && dash.includes('後台管理'));

  await page.click('button:has-text("收銀台")');
  await page.waitForURL('**/pos', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const frontNav = await navText();
  check('A3 進入收銀台', page.url().includes('/pos'));
  check('A4 收銀台導航只有收銀台/桌台視圖', frontNav.includes('收銀台') && frontNav.includes('桌台視圖'));
  check('A5 收銀台不出現後台管理選單', !frontNav.includes('菜品管理') && !frontNav.includes('報表統計') && !frontNav.includes('系統設定'));

  /* =============== B. 收銀員不可進後台 =============== */
  await page.evaluate(() => localStorage.removeItem('pos_user'));
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[placeholder="請輸入帳號"]', 'cashier');
  await page.fill('input[type="password"]', '123456');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500);
  const cashierDash = await bodyText();
  check('B1 收銀員登入進入首頁', new URL(page.url()).pathname === '/', page.url());
  check('B2 收銀員首頁無後台入口', !cashierDash.includes('後台管理'));
  check('B2b 收銀員首頁有收銀台', cashierDash.includes('收銀台'));

  await page.goto(`${BASE}/admin/products`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  check('B3 收銀員無法進入後台路由', !page.url().includes('/admin/products') || !(await bodyText()).includes('菜品管理'), page.url());

  /* =============== C. 店長後台各頁 =============== */
  await page.evaluate(() => localStorage.removeItem('pos_user'));
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[placeholder="請輸入帳號"]', 'admin');
  await page.fill('input[type="password"]', '123456');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500);
  await page.click('button:has-text("後台管理")');
  await page.waitForURL('**/admin/reports', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(2000);
  check('C1 店長進入後台報表', page.url().includes('/admin/reports'));
  const adminNav = await navText();
  check('C2 後台導航含報表與各設定', adminNav.includes('報表統計') && adminNav.includes('菜品管理')
    && adminNav.includes('桌台管理') && adminNav.includes('支付方式') && adminNav.includes('員工管理') && adminNav.includes('系統設定'));
  check('C3 報表頁顯示營業額', (await bodyText()).includes('總營業額'));

  const pages = [
    ['菜品管理', '/admin/products', '菜品'],
    ['桌台管理', '/admin/tables', '桌台'],
    ['支付方式', '/admin/payments', '支付'],
    ['員工管理', '/admin/staff', '員工'],
    ['系統設定', '/admin/settings', '系統設定'],
  ];
  for (const [label, path, kw] of pages) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    check(`C4 後台${label}頁可載入`, (await bodyText()).includes(kw));
  }

  // 時段設定可儲存（後台）
  const coldInput = page.locator('table tbody tr').first().locator('input[type="number"]').first();
  const original = await coldInput.inputValue();
  await coldInput.fill('8');
  await page.locator('button:has-text("儲存時段設定")').click();
  await page.waitForTimeout(1200);
  const after = (await api('/time-slots')).data;
  check('C5 後台時段設定可儲存', Number(after[0].drink_cold_extra) === 8, `got=${after[0].drink_cold_extra}`);
  await coldInput.fill(original);
  await page.locator('button:has-text("儲存時段設定")').click();
  await page.waitForTimeout(1200);
  const restored = (await api('/time-slots')).data;
  check('C6 後台時段設定可還原', Number(restored[0].drink_cold_extra) === Number(original),
    `expect=${original} got=${restored[0].drink_cold_extra}`);

  // 收銀台仍可正常操作
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.click('button:has-text("收銀台")');
  await page.waitForURL('**/pos', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);
  check('C7 收銀台可正常進入', (await bodyText()).includes('購物車'));

  console.log('\n===== 測試結果 =====');
  const failed = results.filter((r) => !r.ok);
  console.log(`通過 ${results.length - failed.length}/${results.length}`);
  if (failed.length) failed.forEach((f) => console.log(`  ✗ ${f.name} ${f.extra}`));
  if (errors.length) {
    console.log('\n===== 頁面錯誤 =====');
    [...new Set(errors)].slice(0, 10).forEach((e) => console.log(e));
  } else {
    console.log('頁面無 JS 錯誤');
  }
  await browser.close();
  process.exit(failed.length || errors.length ? 1 : 0);
})().catch((e) => { console.error('E2E 執行失敗:', e); process.exit(2); });

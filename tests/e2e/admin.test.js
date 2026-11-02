/* 後台管理 app 端對端測試
 * 覆蓋：前後台分離（前台只有收銀台/桌台視圖，無後台路由）、
 *       後台登入權限（收銀員不可登入）、後台各頁面可載入、時段設定可儲存。
 */
const { chromium } = require('playwright-core');

const CLIENT = process.env.POS_E2E_BASE || 'http://localhost:5173';
const ADMIN = process.env.POS_E2E_ADMIN || 'http://localhost:5175';
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

  /* =============== A. 前台 app：只剩收銀台 + 桌台視圖 =============== */
  await page.goto(CLIENT, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.removeItem('pos_user'));
  await page.goto(CLIENT, { waitUntil: 'networkidle' });
  await page.fill('input[placeholder="請輸入帳號"]', 'admin');
  await page.fill('input[type="password"]', '123456');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/pos', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const frontNav = await navText();
  check('A1 前台登入成功', page.url().includes('/pos'));
  check('A2 前台導航只有收銀台/桌台視圖', frontNav.includes('收銀台') && frontNav.includes('桌台視圖'));
  check('A3 前台不出現後台管理選單', !frontNav.includes('菜品管理') && !frontNav.includes('報表統計') && !frontNav.includes('系統設定'));

  // 前台 app 已无后台路由
  await page.goto(`${CLIENT}/admin/products`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const lost = (await bodyText());
  check('A4 前台無後台路由（被重定向）', !lost.includes('菜品管理') || !page.url().includes('/admin/products'), page.url());

  /* =============== B. 後台 app：登入與頁面 =============== */
  await page.goto(ADMIN, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.removeItem('pos_user'));
  await page.goto(ADMIN, { waitUntil: 'networkidle' });
  check('B1 後台登入頁可開啟', (await bodyText()).includes('後台管理'));

  // 收銀員不可登入後台
  await page.fill('input[placeholder="請輸入帳號"]', 'cashier');
  await page.fill('input[type="password"]', '123456');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500);
  check('B2 收銀員無法登入後台', (await bodyText()).includes('僅限店長帳號'));
  check('B3 收銀員登入後仍停留登入頁', page.url().includes('/login') || page.url() === `${ADMIN}/`, page.url());

  // 店長登入後台
  await page.fill('input[placeholder="請輸入帳號"]', 'admin');
  await page.fill('input[type="password"]', '123456');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/reports', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(2000);
  check('B4 店長登入後台進入報表', page.url().includes('/reports'));
  const adminNav = await navText();
  check('B5 後台導航含報表與各設定', adminNav.includes('報表統計') && adminNav.includes('菜品管理')
    && adminNav.includes('桌台管理') && adminNav.includes('支付方式') && adminNav.includes('員工管理') && adminNav.includes('系統設定'));
  check('B6 報表頁顯示營業額', (await bodyText()).includes('總營業額'));

  const pages = [
    ['菜品管理', '/admin/products', '菜品'],
    ['桌台管理', '/admin/tables', '桌台'],
    ['支付方式', '/admin/payments', '支付'],
    ['員工管理', '/admin/staff', '員工'],
    ['系統設定', '/admin/settings', '系統設定'],
  ];
  for (const [label, path, kw] of pages) {
    await page.goto(`${ADMIN}${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    check(`B7 後台${label}頁可載入`, (await bodyText()).includes(kw));
  }

  // 時段設定可儲存（後台）
  const coldInput = page.locator('table tbody tr').first().locator('input[type="number"]').first();
  const original = await coldInput.inputValue();
  await coldInput.fill('8');
  await page.locator('button:has-text("儲存時段設定")').click();
  await page.waitForTimeout(1200);
  const after = (await api('/time-slots')).data;
  check('B8 後台時段設定可儲存', Number(after[0].drink_cold_extra) === 8, `got=${after[0].drink_cold_extra}`);
  await coldInput.fill(original);
  await page.locator('button:has-text("儲存時段設定")').click();
  await page.waitForTimeout(1200);
  const restored = (await api('/time-slots')).data;
  check('B9 後台時段設定可還原', Number(restored[0].drink_cold_extra) === Number(original),
    `expect=${original} got=${restored[0].drink_cold_extra}`);

  // 前台收銀 app 仍可正常操作（前後台互不影響）
  await page.goto(CLIENT, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.removeItem('pos_user'));
  await page.goto(CLIENT, { waitUntil: 'networkidle' });
  await page.fill('input[placeholder="請輸入帳號"]', 'admin');
  await page.fill('input[type="password"]', '123456');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/pos', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);
  check('B10 前台收銀不受後台影響', (await bodyText()).includes('購物車'));

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

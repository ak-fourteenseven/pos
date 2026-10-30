/* 套餐嚮導「無法關閉/退出點單」Bug 回歸測試
 * 覆蓋：取消按鈕 / 右上角 ✕ / ESC / 點背景 四種關閉方式、
 *       關閉後購物車不誤加商品、關閉後可重新開啟並正常下單、
 *       獨立飲品彈窗與小食口味彈窗皆可取消。
 *
 * 執行前：服務端 3001、前端 5173 需已啟動；並安裝 playwright-core
 *   npm i -D playwright-core
 *   node tests/e2e/wizard-close.test.js
 * 若瀏覽器為自訂路徑，設定環境變數 PW_CHROME_PATH。
 */
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright-core');

const BASE = process.env.POS_E2E_BASE || 'http://localhost:5173';
const SHOT_DIR = path.join(__dirname, '..', '..', '.e2e-shots');
const SHOT = (n) => path.join(SHOT_DIR, `${n}.png`);

const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${extra ? ' | ' + extra : ''}`);
}

(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const launchOpts = { headless: true };
  if (process.env.PW_CHROME_PATH) launchOpts.executablePath = process.env.PW_CHROME_PATH;
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const wait = async (fn, ms = 5000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await fn()) return true;
      await page.waitForTimeout(120);
    }
    return false;
  };
  const cart = () => page.locator('aside:has-text("購物車")');
  const cartText = async () => (await cart().textContent()) || '';
  /** 依商品名稱定位對應的彈窗（Modal 標題為商品名） */
  const modalOf = (name) => page.locator(`.fixed:has(h3:has-text("${name}"))`);
  const isOpen = (name) => modalOf(name).count();
  /** 菜品網格按鈕 */
  const menuBtn = (name) => page.locator('section button', { hasText: name }).first();

  // 登入
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.removeItem('pos_user'));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('input[placeholder="請輸入帳號"]', 'admin');
  await page.fill('input[type="password"]', '123456');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/pos', { timeout: 8000 });
  await page.waitForTimeout(1500);

  const COMBO = '招牌酸麻辣';

  // 1. 開啟湯底套餐嚮導
  await menuBtn(COMBO).click();
  check('湯底套餐嚮導可開啟', await wait(async () => (await isOpen(COMBO)) > 0));
  check('嚮導顯示步驟指示', (await modalOf(COMBO).textContent()).includes('Step 1/4'));

  // 2. 按「取消」可關閉
  await modalOf(COMBO).locator('button:has-text("取消")').click();
  check('按「取消」可退出點單', await wait(async () => (await isOpen(COMBO)) === 0));
  check('取消後購物車為空', !(await cartText()).includes(COMBO));

  // 3. 右上角 ✕ 可關閉
  await menuBtn(COMBO).click();
  await wait(async () => (await isOpen(COMBO)) > 0);
  await modalOf(COMBO).locator('button:has-text("✕")').click();
  check('按 ✕ 可退出點單', await wait(async () => (await isOpen(COMBO)) === 0));

  // 4. ESC 可關閉
  await menuBtn(COMBO).click();
  await wait(async () => (await isOpen(COMBO)) > 0);
  await page.keyboard.press('Escape');
  check('按 ESC 可退出點單', await wait(async () => (await isOpen(COMBO)) === 0));

  // 5. 點背景遮罩可關閉
  await menuBtn(COMBO).click();
  await wait(async () => (await isOpen(COMBO)) > 0);
  await page.mouse.click(15, 15);
  check('點背景可退出點單', await wait(async () => (await isOpen(COMBO)) === 0));
  check('多次取消後購物車仍為空', !(await cartText()).includes(COMBO));
  await page.screenshot({ path: SHOT('15-wizard-cancel') });

  // 6. 關閉後可重新開啟並正常完成下單
  await menuBtn(COMBO).click();
  check('可再次開啟嚮導', await wait(async () => (await isOpen(COMBO)) > 0));
  const stepTxt = async () => (await modalOf(COMBO).textContent()) || '';
  check('重新開啟回到 Step 1', (await stepTxt()).includes('Step 1/4'));
  await modalOf(COMBO).locator('button:has-text("下一步")').click();
  await page.waitForTimeout(200);
  check('可切換至 Step 2 辣度', (await stepTxt()).includes('Step 2/4'));
  await modalOf(COMBO).locator('button:has-text("下一步")').click();
  await page.waitForTimeout(200);
  check('可切換至 Step 3 配料', (await stepTxt()).includes('Step 3/4'));
  await modalOf(COMBO).locator('button:has-text("下一步")').click();
  await page.waitForTimeout(200);
  check('可切換至 Step 4 飲品', (await stepTxt()).includes('Step 4/4'));
  await modalOf(COMBO).locator('button:has-text("加入購物車")').click();
  check('加入購物車後彈窗自動關閉', await wait(async () => (await isOpen(COMBO)) === 0));
  check('關閉後仍可正常完成下單', (await cartText()).includes(COMBO));

  // 7. 獨立飲品彈窗可關閉
  await menuBtn('檸檬茶').click();
  check('飲品彈窗可開啟', await wait(async () => (await isOpen('檸檬茶')) > 0));
  await modalOf('檸檬茶').locator('button:has-text("取消")').click();
  check('飲品彈窗可取消', await wait(async () => (await isOpen('檸檬茶')) === 0));
  check('取消飲品未加入購物車', !(await cartText()).includes('檸檬茶'));

  // 8. 小食口味彈窗可關閉
  await menuBtn('麻辣牛柏葉').click();
  check('小食口味彈窗可開啟', await wait(async () => (await isOpen('麻辣牛柏葉')) > 0));
  await modalOf('麻辣牛柏葉').locator('button:has-text("取消")').click();
  check('小食口味彈窗可取消', await wait(async () => (await isOpen('麻辣牛柏葉')) === 0));
  check('取消小食未加入購物車', !(await cartText()).includes('麻辣牛柏葉'));

  console.log('\n===== 測試結果 =====');
  const failed = results.filter((r) => !r.ok);
  console.log(`通過 ${results.length - failed.length}/${results.length}`);
  if (errors.length) {
    console.log('\n===== 頁面錯誤 =====');
    [...new Set(errors)].slice(0, 10).forEach((e) => console.log(e));
  } else {
    console.log('頁面無 JS 錯誤');
  }
  await browser.close();
  process.exit(failed.length || errors.length ? 1 : 0);
})().catch((e) => { console.error('E2E 執行失敗:', e.message); process.exit(2); });

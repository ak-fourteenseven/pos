/* POS 整合回歸測試（套餐點餐 + 基礎功能 + 權限 + 後台設定）
 * 執行前：服務端 3001、前端 5173 需已啟動；並安裝 playwright-core
 *   npm i -D playwright-core
 *   node tests/e2e/regression.test.js
 */
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright-core');

const BASE = process.env.POS_E2E_BASE || 'http://localhost:5173';
const API = process.env.POS_E2E_API || 'http://localhost:3001/api';
const SHOT_DIR = path.join(__dirname, '..', '..', '.e2e-shots');
const SHOT = (n) => path.join(SHOT_DIR, `${n}.png`);

const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${extra ? ' | ' + extra : ''}`);
}

/* ---------------- API 工具 ---------------- */
async function api(p, { method = 'GET', body, role = 'manager', uid = 1 } = {}) {
  const res = await fetch(API + p, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-user-id': String(uid), 'x-role': role },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, code: json?.code, data: json?.data, message: json?.message };
}
const moneyNum = (s) => Number(String(s || '').replace(/[^0-9.\-]/g, '')) || 0;
const pad2 = (n) => String(n).padStart(2, '0');
function slotNow(slots) {
  const d = new Date();
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return slots.find((s) => hm >= s.start_time && hm < s.end_time) || null;
}
function expectedDrinkPrice(base, temp, slot) {
  if (!slot) return base;
  if (Number(slot.drink_all_free) === 1) return 0;
  if (temp === 'HOT' && Number(slot.drink_hot_free) === 1) return 0;
  if (temp === 'COLD') return base + (Number(slot.drink_cold_extra) || 0);
  return base;
}

(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const launchOpts = { headless: true };
  if (process.env.PW_CHROME_PATH) launchOpts.executablePath = process.env.PW_CHROME_PATH;
  const browser = await chromium.launch(launchOpts);
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const wait = async (fn, ms = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await fn()) return true;
      await page.waitForTimeout(120);
    }
    return false;
  };
  const cart = () => page.locator('aside:has-text("購物車")');
  const cartText = async () => (await cart().textContent()) || '';
  const modalOf = (name) => page.locator(`.fixed:has(h3:has-text("${name}"))`);
  const menuBtn = (name) => page.locator('section button', { hasText: name }).first();
  const bodyText = async () => (await page.locator('body').textContent()) || '';

  async function login(u = 'admin', p = '123456') {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.removeItem('pos_user'));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.fill('input[placeholder="請輸入帳號"]', u);
    await page.fill('input[type="password"]', p);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/pos', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1200);
  }

  /* =============== 預備：菜單 / 時段 / 價格 =============== */
  const menu = (await api('/menu')).data;
  const slots = (await api('/time-slots')).data;
  const nowSlot = slotNow(slots);
  const cat = (n) => menu.categories.find((c) => c.name === n);
  const combo = cat('湯底套餐').products.find((p) => p.name === '清湯');
  const toppingStep = combo.steps.find((s) => s.code === 'topping');
  const drinkList = menu.drinks;
  console.log(`目前時段：${nowSlot ? nowSlot.name + ' ' + nowSlot.start_time + '-' + nowSlot.end_time : '非營業時段'}\n`);

  /* =============== A. 登入與權限 =============== */
  await login('admin', '123456');
  check('A1 管理員登入成功', page.url().includes('/pos'));
  check('A2 收銀台顯示購物車', (await bodyText()).includes('購物車'));

  const badLogin = await api('/login', { method: 'POST', body: { username: 'admin', password: 'wrong' } });
  check('A3 密碼錯誤被拒（401）', badLogin.status === 401, `status=${badLogin.status}`);

  await login('cashier', '123456');
  await page.goto(`${BASE}/admin/products`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  check('A4 收銀員無權進入後台（自動跳回 /pos）', page.url().includes('/pos'), page.url());
  const forbidden = await api('/time-slots', { method: 'PUT', body: { slots: [] }, role: 'cashier', uid: 2 });
  check('A5 收銀員呼叫後台 API 回 403', forbidden.status === 403, `status=${forbidden.status}`);

  /* =============== B. 套餐點餐主流程 =============== */
  await login('admin', '123456');
  await menuBtn('清湯').click();
  check('B1 清湯嚮導可開啟', await wait(async () => (await modalOf('清湯').count()) > 0));
  const wizardText = async () => (await modalOf('清湯').textContent()) || '';
  check('B2 清湯跳過辣度步驟（Step 1/3）', (await wizardText()).includes('Step 1/3'));
  check('B3 初始畫面不含辣度', !(await wizardText()).includes('辣度'));

  await modalOf('清湯').locator('button:has-text("上海麵")').click();
  await page.waitForTimeout(250);
  await modalOf('清湯').locator('button:has-text("下一步")').click();
  await page.waitForTimeout(300);
  check('B4 選麵類後進入 Step 2（配料）', (await wizardText()).includes('Step 2/3'));

  const topA = toppingStep.items[0];
  const topB = toppingStep.items[1];
  await modalOf('清湯').locator(`button:has-text("${topA.name}")`).click();
  await modalOf('清湯').locator(`button:has-text("${topB.name}")`).click();
  await page.waitForTimeout(250);
  const expectSub = Number(combo.price) + Number(topA.price_diff || 0) + Number(topB.price_diff || 0);
  const subTxt = await modalOf('清湯').locator('.text-brand-600.text-lg').first().textContent();
  check('B5 加料階梯價小計正確', moneyNum(subTxt) === expectSub,
    `ui=${moneyNum(subTxt)} expect=${expectSub} (base=${combo.price} +${topA.price_diff} +${topB.price_diff})`);

  await modalOf('清湯').locator('button:has-text("下一步")').click();
  await page.waitForTimeout(250);
  check('B6 進入 Step 3 飲品', (await wizardText()).includes('Step 3/3'));

  const drink = drinkList.find((d) => d.name === '奶茶');
  await modalOf('清湯').locator(`button:has-text("${drink.name}")`).click();
  await page.waitForTimeout(250);
  const expectDrink = expectedDrinkPrice(Number(drink.price), 'HOT', nowSlot);
  const expectTotal = expectSub + expectDrink;
  const totalTxt = await modalOf('清湯').locator('.text-brand-600.text-lg').first().textContent();
  check('B7 套餐小計含飲品時段價', moneyNum(totalTxt) === expectTotal,
    `ui=${moneyNum(totalTxt)} expect=${expectTotal} (slot=${nowSlot ? nowSlot.name : 'none'})`);

  await modalOf('清湯').locator('button:has-text("加入購物車")').click();
  await wait(async () => (await modalOf('清湯').count()) === 0);
  check('B8 加入購物車後彈窗關閉', (await modalOf('清湯').count()) === 0);
  const ct = await cartText();
  check('B9 購物車顯示套餐與加料', ct.includes('清湯') && ct.includes(`加料: ${topA.name}、${topB.name}`));

  /* =============== C. 折扣 / 收現 / 結帳 =============== */
  await cart().locator('button:has-text("折扣")').first().click();
  await page.waitForTimeout(300);
  await page.locator('.fixed button:has-text("套用")').click();
  await page.waitForTimeout(400);
  const expectDiscount = Math.round(expectTotal * 0.05);
  const expectPay = expectTotal - expectDiscount;
  const totalShown = moneyNum(await cart().locator('.text-2xl.font-extrabold.text-brand-600').first().textContent());
  check('C1 95 折折扣金額正確', totalShown === expectPay, `ui=${totalShown} expect=${expectPay}`);

  await page.fill('input[placeholder="收現金額"]', '1');
  await page.waitForTimeout(200);
  await cart().locator('button:has-text("結帳")').click();
  await page.waitForTimeout(900);
  check('C2 收現不足被阻擋', (await bodyText()).includes('收現金額不足'));

  await cart().locator('button:has-text("剛好")').click();
  await page.waitForTimeout(300);
  await cart().locator('button:has-text("結帳")').click();
  await page.waitForTimeout(1500);
  const receiptOpen = await page.locator('.fixed:has(h3:has-text("結帳完成"))').count();
  check('C3 結帳成功並顯示小票', receiptOpen > 0);
  const orderNo = ((await bodyText()).match(/POS\d{8}-\d{4}/) || [])[0] || '';
  const custTab = await page.locator('.fixed:has(h3:has-text("結帳完成"))').textContent();
  check('C4 顧客收銀單含套餐與單號', custTab.includes('清湯') && !!orderNo, orderNo);

  await page.locator('.fixed:has(h3:has-text("結帳完成")) button:has-text("廚房單（後廚/水吧）")').click();
  await page.waitForTimeout(400);
  const kitchen = await page.locator('.fixed:has(h3:has-text("結帳完成")) pre').first().textContent();
  check('C5 廚房單含【廚房】分區', kitchen.includes('【廚房】'));
  check('C6 廚房單含【水吧】分區與飲品', kitchen.includes('【水吧】') && kitchen.includes(drink.name));
  check('C7 廚房單含麵類與加料', kitchen.includes('麵: 上海麵') && kitchen.includes('加料:'));
  await page.screenshot({ path: SHOT('16-kitchen-receipt') });
  await page.locator('.fixed:has(h3:has-text("結帳完成")) button:has-text("完成")').click();
  await page.waitForTimeout(600);

  /* =============== D. 後端覆核 =============== */
  const latest = (await api('/orders?limit=5')).data[0];
  const orderRes = await api(`/orders/${latest.id}`);
  const oi = orderRes.data.items[0];
  const o = typeof oi.options === 'string' ? JSON.parse(oi.options) : oi.options;
  check('D1 後端覆核套餐單價', Number(oi.price) === expectTotal, `backend=${oi.price} expect=${expectTotal}`);
  check('D2 後端保存麵類/加料/飲品選項', !!o.noodle && !!o.toppings && !!o.drink);
  check('D3 後端覆核飲品時段價', Number(o.drink.final_price) === expectDrink,
    `backend=${o.drink.final_price} expect=${expectDrink}`);
  check('D4 訂單狀態為已結帳', latest.status === 'completed', latest.status);

  /* =============== E. 掛單 / 取單 =============== */
  await menuBtn('薯條').click();
  await page.waitForTimeout(500);
  check('E1 一般商品可加入購物車', (await cartText()).includes('薯條'));
  await page.locator('button:has-text("掛單")').click();
  await page.waitForTimeout(1000);
  check('E2 掛單後購物車清空', !(await cartText()).includes('薯條'));
  await page.locator('button:has-text("取單（")').click();
  await page.waitForTimeout(600);
  await page.locator('.fixed button:has-text("取單")').last().click();
  await page.waitForTimeout(900);
  check('E3 取單後商品回到購物車', (await cartText()).includes('薯條'));

  /* =============== F. 桌台模式 =============== */
  await page.goto(`${BASE}/tables`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const openBtn = page.locator('button:has-text("開台")').first();
  if (await openBtn.count()) {
    await openBtn.click();
    await page.waitForTimeout(1500);
    check('F1 開台後進入桌台模式', (await bodyText()).includes('桌台'), page.url());
    await menuBtn('燒賣').click();
    await page.waitForTimeout(700);
    check('F2 桌台模式可加菜', (await cartText()).includes('燒賣'));
    await cart().locator('button:has-text("剛好")').click();
    await page.waitForTimeout(200);
    await cart().locator('button:has-text("結帳")').click();
    await page.waitForTimeout(1500);
    const tOrder = (await api('/orders?limit=1')).data[0];
    check('F3 桌台訂單結帳成功', tOrder.status === 'completed' && !!tOrder.table_number,
      `status=${tOrder.status} table=${tOrder.table_number}`);
    const closeBtn = page.locator('.fixed:has(h3:has-text("結帳完成")) button:has-text("完成")');
    if (await closeBtn.count()) await closeBtn.click();
    await page.waitForTimeout(500);
  } else {
    check('F1 開台後進入桌台模式', false, '沒有可用桌台');
    check('F2 桌台模式可加菜', false);
    check('F3 桌台訂單結帳成功', false);
  }

  /* =============== G. 報表 / 後台 =============== */
  await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const rtxt = await bodyText();
  check('G1 報表頁可載入', rtxt.includes('總營業額') || rtxt.includes('日結單'), page.url());

  await page.goto(`${BASE}/admin/settings`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  check('G2 後台設定頁可載入', (await bodyText()).includes('時段設定'));
  const row = page.locator('table tbody tr').first();
  const coldInput = row.locator('input[type="number"]').first();
  const original = await coldInput.inputValue();
  await coldInput.fill('9');
  await page.locator('button:has-text("儲存時段設定")').click();
  await page.waitForTimeout(1200);
  const afterSlots = (await api('/time-slots')).data;
  check('G3 時段設定可儲存', Number(afterSlots[0].drink_cold_extra) === 9,
    `expect=9 got=${afterSlots[0].drink_cold_extra}`);
  await coldInput.fill(original);
  await page.locator('button:has-text("儲存時段設定")').click();
  await page.waitForTimeout(1200);
  const restored = (await api('/time-slots')).data;
  check('G4 時段設定可還原', Number(restored[0].drink_cold_extra) === Number(original),
    `expect=${original} got=${restored[0].drink_cold_extra}`);
  await page.screenshot({ path: SHOT('17-settings-timeslots') });

  /* =============== 結果 =============== */
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

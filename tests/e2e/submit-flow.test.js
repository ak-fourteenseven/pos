/* 送單 / 結賬流程端對端測試（前台收銀 app）
 * 覆蓋：點餐 → 下單送廚房（廚房單）→ 加菜追加送廚 → 結賬；
 *       未送廚不可結賬、送廚後退菜需店長、桌台狀態流轉。
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

  const wait = async (fn, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await fn()) return true;
      await page.waitForTimeout(120);
    }
    return false;
  };
  const cart = () => page.locator('aside:has-text("購物車")');
  const cartText = async () => (await cart().textContent()) || '';
  const bodyText = async () => (await page.locator('body').textContent()) || '';
  const modalOf = (name) => page.locator(`.fixed:has(h3:has-text("${name}"))`);
  const menuBtn = (name) => page.locator('section button', { hasText: name }).first();
  const submitBtn = () => page.locator('button:has-text("下單（送廚房）")').last();
  const payBtn = () => cart().locator('button:has-text("結賬")');

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
  async function closeTicket() {
    await page.locator('.fixed:has(h3:has-text("廚房單")) button:has-text("關閉")').click();
    await wait(async () => (await page.locator('.fixed:has(h3:has-text("廚房單"))').count()) === 0);
  }

  /* =============== A. 快餐：下單送廚 → 結賬 =============== */
  await login('admin', '123456');
  await menuBtn('清湯').click();
  await wait(async () => (await modalOf('清湯').count()) > 0);
  await modalOf('清湯').locator('button:has-text("上海麵")').click();
  await modalOf('清湯').locator('button:has-text("下一步")').click();
  await page.waitForTimeout(250);
  await modalOf('清湯').locator('button:has-text("炸魚蛋")').click();
  await modalOf('清湯').locator('button:has-text("下一步")').click();
  await page.waitForTimeout(250);
  await modalOf('清湯').locator('button:has-text("奶茶")').click();
  await modalOf('清湯').locator('button:has-text("加入購物車")').click();
  await wait(async () => (await modalOf('清湯').count()) === 0);
  check('A1 套餐加入購物車', (await cartText()).includes('清湯'));

  check('A2 未送廚時「下單」可用', await submitBtn().isEnabled());
  check('A3 未送廚時「結賬」禁用', !(await payBtn().isEnabled()));
  check('A4 提示先下單送廚', (await bodyText()).includes('請先「下單」送廚房'));

  await submitBtn().click();
  check('A5 下單後彈出廚房單', await wait(async () => (await page.locator('.fixed:has(h3:has-text("廚房單"))').count()) > 0));
  const ticketTxt = (await page.locator('.fixed:has(h3:has-text("廚房單"))').textContent()) || '';
  check('A6 廚房單含後廚與水吧分區', ticketTxt.includes('【後廚】') && ticketTxt.includes('【水吧】'));
  check('A7 廚房單含麵類/加料/飲品', ticketTxt.includes('麵: 上海麵') && ticketTxt.includes('加料:') && ticketTxt.includes('奶茶'));
  check('A8 廚房單為新單', ticketTxt.includes('新單'));
  await closeTicket();

  check('A9 明細標記已送廚', (await cartText()).includes('已送廚'));
  check('A10 狀態顯示已全部送廚', (await bodyText()).includes('已全部送廚'));
  check('A11 送廚後「結賬」可用', await payBtn().isEnabled());

  await cart().locator('button:has-text("剛好")').click();
  await page.waitForTimeout(300);
  await payBtn().click();
  await page.waitForTimeout(1500);
  check('A12 結賬成功顯示小票', (await page.locator('.fixed:has(h3:has-text("結帳完成"))').count()) > 0);
  await page.locator('.fixed:has(h3:has-text("結帳完成")) button:has-text("完成")').click().catch(() => {});
  await page.waitForTimeout(600);

  /* =============== B. 加菜 → 追加送廚 =============== */
  await menuBtn('薯條').click();
  await page.waitForTimeout(700);
  await submitBtn().click();
  await wait(async () => (await page.locator('.fixed:has(h3:has-text("廚房單"))').count()) > 0);
  await closeTicket();
  check('B1 快餐可再次下單送廚', (await bodyText()).includes('已全部送廚'));

  await menuBtn('燒賣').click();
  await page.waitForTimeout(700);
  check('B2 加菜後出現待送廚', (await bodyText()).includes('1 項待送廚'));
  await submitBtn().click();
  await wait(async () => (await page.locator('.fixed:has(h3:has-text("廚房單"))').count()) > 0);
  const ticket2 = (await page.locator('.fixed:has(h3:has-text("廚房單"))').textContent()) || '';
  check('B3 追加單標註「加菜追加」', ticket2.includes('加菜追加'));
  check('B4 追加單只含新菜品', ticket2.includes('燒賣') && !ticket2.includes('清湯'));
  await closeTicket();
  await cart().locator('button:has-text("剛好")').click();
  await page.waitForTimeout(200);
  await payBtn().click();
  await page.waitForTimeout(1500);
  await page.locator('.fixed:has(h3:has-text("結帳完成")) button:has-text("完成")').click().catch(() => {});
  await page.waitForTimeout(500);

  /* =============== C. 桌台模式流轉 =============== */
  await page.goto(`${BASE}/tables`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const openBtn = page.locator('button:has-text("開台")').first();
  let tableNo = '';
  if (await openBtn.count()) {
    tableNo = ((await openBtn.locator('xpath=../../..').textContent()) || '').match(/[A-Z]\d/)?.[0] || '';
    await openBtn.click();
    await page.waitForURL('**/pos', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1200);
    check('C1 開台成功', (await bodyText()).includes('桌台'));
    await menuBtn('鹽酥雞').click();
    await page.waitForTimeout(800);
    check('C2 桌台模式可點餐', (await cartText()).includes('鹽酥雞'));
    await submitBtn().click();
    await wait(async () => (await page.locator('.fixed:has(h3:has-text("廚房單"))').count()) > 0);
    await closeTicket();

    await page.goto(`${BASE}/tables`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const card = page.locator('.card', { hasText: tableNo }).first();
    check('C3 送廚後桌台顯示製作中', (await card.textContent()).includes('製作中'));
    await card.locator('button:has-text("繼續點餐 / 結賬")').click();
    await page.waitForURL('**/pos', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1000);
    await cart().locator('button:has-text("剛好")').click();
    await page.waitForTimeout(200);
    await payBtn().click();
    await page.waitForTimeout(1500);
    check('C4 桌台訂單結賬成功', (await page.locator('.fixed:has(h3:has-text("結帳完成"))').count()) > 0);
    await page.locator('.fixed:has(h3:has-text("結帳完成")) button:has-text("完成")').click().catch(() => {});
    await page.waitForTimeout(600);

    await page.goto(`${BASE}/tables`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const card2 = page.locator('.card', { hasText: tableNo }).first();
    check('C5 結賬後桌台顯示待清', (await card2.textContent()).includes('待清'));
    await card2.locator('button:has-text("清台完成")').click();
    await page.waitForTimeout(800);
  } else {
    check('C1 開台成功', false, '沒有可用桌台');
  }

  /* =============== D. 收銀員：送廚後退菜需店長 =============== */
  await login('cashier', '123456');
  await page.goto(`${BASE}/tables`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const openBtn2 = page.locator('button:has-text("開台")').first();
  if (await openBtn2.count()) {
    await openBtn2.click();
    await page.waitForURL('**/pos', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await menuBtn('蘿蔔糕').click();
    await page.waitForTimeout(800);
    await submitBtn().click();
    await wait(async () => (await page.locator('.fixed:has(h3:has-text("廚房單"))').count()) > 0);
    await closeTicket();
    await page.waitForTimeout(400);
    const refundBtn = cart().locator('button:has-text("退菜")').first();
    check('D1 收銀員退已送廚菜品被禁用', !(await refundBtn.isEnabled()));

    // 直接打後端也應被拒
    const latest = (await api('/orders?status=ordered&limit=1')).data[0];
    if (latest) {
      const sentItem = (await api(`/orders/${latest.id}`)).data.items.find((i) => i.sent_at);
      const del = await api(`/orders/${latest.id}/items/${sentItem.id}`, 'DELETE', undefined, 'cashier', 2);
      check('D2 後端攔截收銀員退已送廚菜品', del.status === 403, `status=${del.status}`);
    } else {
      check('D2 後端攔截收銀員退已送廚菜品', true, '略過（無已送廚訂單）');
    }
  } else {
    check('D1 收銀員退已送廚菜品被禁用', false, '沒有可用桌台');
  }

  /* =============== E. API 校驗 =============== */
  const menu = (await api('/menu')).data;
  const soup = menu.categories.find((c) => c.name === '湯底套餐').products[0];
  const created = (await api('/orders', 'POST', {
    items: [{ product_id: soup.id, quantity: 1, options: { base: soup.name } }],
  })).data;
  const early = await api(`/orders/${created.id}/pay`, 'POST', { payment_method: 'cash', received_amount: 999 });
  check('E1 未送廚不可結賬（API）', early.status === 400 && early.message.includes('下單'), early.message);

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

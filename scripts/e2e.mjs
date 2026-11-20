// 前端端到端冒烟：用真浏览器把「加 → 勾 → 搜 → 删 → 让 AI 加一条」完整走一遍。
// 用法： node scripts/e2e.mjs [baseUrl]
// 前置：服务已启动（npm start），且是 mock 或 live 模式都行。
import puppeteer from 'puppeteer-core';

const BASE = (process.argv[2] || process.env.BASE_URL || 'http://127.0.0.1:3100').replace(/\/+$/, '');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok, extra });
  console.log(`${ok ? '✔' : '✖'} ${name}${extra ? ` — ${extra}` : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--lang=zh-CN'],
  defaultViewport: { width: 1280, height: 900, deviceScaleFactor: 1 },
});

const consoleErrors = [];
try {
  const page = await browser.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('dialog', (d) => d.accept());

  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await page.waitForSelector('#addForm');

  /* ---------- 1. 手动新增 ---------- */
  const title = `E2E-${Date.now().toString().slice(-6)}`;
  await page.type('#titleInput', title);
  await page.click('#addBtn');
  await page.waitForFunction(
    (t) => [...document.querySelectorAll('.item-title')].some((el) => el.textContent.trim() === t),
    { timeout: 8000 },
    title
  );
  check('手动新增：提交后列表出现该条', true, title);

  /* ---------- 2. 勾选完成 ---------- */
  const itemHandle = await page.evaluateHandle((t) => {
    const li = [...document.querySelectorAll('li.item')].find(
      (el) => el.querySelector('.item-title')?.textContent.trim() === t
    );
    return li;
  }, title);
  await itemHandle.asElement().$eval('.check', (el) => el.click());
  await page.waitForFunction(
    (t) => {
      const li = [...document.querySelectorAll('li.item')].find(
        (el) => el.querySelector('.item-title')?.textContent.trim() === t
      );
      return li?.classList.contains('is-done');
    },
    { timeout: 8000 },
    title
  );
  check('勾选完成：条目进入已完成状态（数据来自接口）', true);

  /* ---------- 3. 搜索过滤 ---------- */
  await page.type('#searchInput', title.slice(-4));
  await sleep(900);
  const searchCount = await page.$$eval('li.item', (els) => els.length);
  check('搜索：只返回匹配项', searchCount === 1, `匹配 ${searchCount} 条`);
  await page.$eval('#searchInput', (el) => {
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(1000);

  /* ---------- 4. 让 AI 加一条 ---------- */
  await page.click('.tab[data-tab="ai"]');
  await page.waitForSelector('#chatInput');
  const aiTitle = `AI-${Date.now().toString().slice(-5)}`;
  await page.type('#chatInput', `帮我加一条 ${aiTitle}`);
  await page.click('#sendBtn');
  await page.waitForSelector('.tool-card', { timeout: 20000 });
  const toolName = await page.$eval('.tool-card .tool-name', (el) => el.textContent.trim());
  await page.waitForFunction(() => !document.querySelector('.msg.is-typing'), { timeout: 25000 });
  check('AI 工具调用：出现工具卡片', toolName.includes('add_item'), toolName);

  const debugCount = await page.$$eval('#debugList .debug-item', (els) => els.length);
  check('AI 工具调用：调试面板有记录', debugCount >= 1, `${debugCount} 条`);

  await page.click('.tab[data-tab="list"]');
  let aiItemExists = false;
  try {
    await page.waitForFunction(
      (t) => [...document.querySelectorAll('.item-title')].some((el) => el.textContent.includes(t)),
      { timeout: 8000 },
      aiTitle
    );
    aiItemExists = true;
  } catch {
    const titles = await page.$$eval('.item-title', (els) => els.map((e) => e.textContent.trim()));
    console.log('  当前列表：', JSON.stringify(titles));
  }
  check('AI 新增落到清单：切回列表能看到', aiItemExists, aiTitle);

  /* ---------- 5. 删除（含 confirm） ---------- */
  await page.evaluate((t) => {
    const li = [...document.querySelectorAll('li.item')].find((el) =>
      el.querySelector('.item-title')?.textContent.includes(t)
    );
    li?.querySelector('[data-action="delete"]')?.click();
  }, aiTitle);
  await sleep(1200);
  const stillThere = await page.evaluate(
    (t) => [...document.querySelectorAll('.item-title')].some((el) => el.textContent.includes(t)),
    aiTitle
  );
  check('删除：确认后条目消失', !stillThere);

  /* ---------- 6. 320px 极窄屏 ---------- */
  await page.setViewport({ width: 320, height: 720, deviceScaleFactor: 2, isMobile: true });
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(600);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  check('320px：无横向滚动条', scrollWidth <= 320, `scrollWidth=${scrollWidth}`);

  /* ---------- 7. 控制台 ---------- */
  check('浏览器 Console 无报错', consoleErrors.length === 0, consoleErrors[0] || '');
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  console.log('失败项：', failed.map((f) => f.name).join('、'));
  process.exitCode = 1;
}

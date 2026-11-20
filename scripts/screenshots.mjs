// 证据截图脚本：用本机 Edge + puppeteer-core 无头跑一遍真实页面。
// 用法： node scripts/screenshots.mjs [baseUrl]
// 产出： docs/evidence/*.png
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = (process.argv[2] || process.env.BASE_URL || 'http://127.0.0.1:3100').replace(/\/+$/, '');
const OUT = path.resolve('docs/evidence');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

fs.mkdirSync(OUT, { recursive: true });

const shot = async (page, name, opts = {}) => {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, ...opts });
  console.log('  ✔', name);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--lang=zh-CN', '--force-color-profile=srgb'],
  defaultViewport: { width: 1280, height: 860, deviceScaleFactor: 1 },
});

const consoleIssues = [];
try {
  const page = await browser.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') consoleIssues.push(`console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => consoleIssues.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => consoleIssues.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));

  console.log('1) 桌面端清单页');
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await page.waitForSelector('.item, .state');
  await sleep(400);
  await shot(page, '01-desktop-list.png');

  console.log('2) 筛选 + 搜索');
  await page.click('.chip[data-filter="pending"]');
  await sleep(700);
  await shot(page, '02-desktop-filter-pending.png');
  await page.click('.chip[data-filter="all"]');
  await sleep(500);

  console.log('3) AI 助手 + 工具调用');
  await page.click('.tab[data-tab="ai"]');
  await page.waitForSelector('#chatInput');
  await page.type('#chatInput', '帮我加一条明天交实验报告', { delay: 15 });
  await page.click('#sendBtn');
  await page.waitForSelector('.tool-card', { timeout: 15000 });
  await page.waitForFunction(() => !document.querySelector('.msg.is-typing'), { timeout: 20000 });
  await sleep(500);
  await shot(page, '03-ai-tool-call.png');

  console.log('4) 回到清单看新条目');
  await page.click('.tab[data-tab="list"]');
  await sleep(800);
  await shot(page, '04-list-after-ai-add.png');

  console.log('5) 手机端 375px（清单 + AI）');
  const mobile = await browser.newPage();
  await mobile.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await mobile.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await mobile.waitForSelector('.item');
  await sleep(500);
  await shot(mobile, '05-mobile-list.png');
  const scrollWidth = await mobile.evaluate(() => document.documentElement.scrollWidth);
  console.log('   375px scrollWidth =', scrollWidth);
  await mobile.click('.tab[data-tab="ai"]');
  await sleep(400);
  await shot(mobile, '06-mobile-ai.png');
  await mobile.close();

  console.log('6) loading 态（拦截列表请求延迟 1.8s）');
  const slow = await browser.newPage();
  await slow.setRequestInterception(true);
  slow.on('request', async (req) => {
    if (req.url().includes('/api/items') && req.method() === 'GET') {
      await sleep(1800);
    }
    req.continue().catch(() => {});
  });
  slow.goto(BASE + '/').catch(() => {});
  await sleep(900);
  await shot(slow, '07-state-loading.png');
  await slow.close();

  console.log('7) error 态（拦截列表请求并 abort）');
  const broken = await browser.newPage();
  await broken.setRequestInterception(true);
  broken.on('request', (req) => {
    if (req.url().includes('/api/items') && req.method() === 'GET') {
      req.abort('failed').catch(() => {});
    } else {
      req.continue().catch(() => {});
    }
  });
  await broken.goto(BASE + '/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await sleep(1200);
  await shot(broken, '08-state-error.png');
  await broken.close();

  console.log('8) 真 404 页面');
  const notFound = await browser.newPage();
  const resp = await notFound.goto(BASE + '/not-exist', { waitUntil: 'networkidle2' });
  console.log('   /not-exist status =', resp?.status());
  await sleep(300);
  await shot(notFound, '10-404-page.png');
  await notFound.close();
} finally {
  await browser.close();
}

if (consoleIssues.length) {
  console.log('\n⚠ 浏览器侧问题：');
  for (const line of consoleIssues) console.log('  -', line);
  process.exitCode = 0; // 截图仍然有效，问题记录在案
} else {
  console.log('\n✔ Console 无报错、无失败请求');
}

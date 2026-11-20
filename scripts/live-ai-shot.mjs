// 在线上 Pages 上真发一句话，截「工具调用成功」的现场
// 用法：node scripts/live-ai-shot.mjs [url] [out.png]
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const url = process.argv[2] || 'https://y-yanxia.github.io/web-phase5-yyx/';
const out = process.argv[3] || 'docs/evidence/15-live-ai-tool-call.png';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--lang=zh-CN'],
  defaultViewport: { width: 1280, height: 900, deviceScaleFactor: 1 },
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.click('.tab[data-tab="ai"]');
  await page.waitForSelector('#chatInput', { timeout: 20000 });

  const title = `线上实测-${Date.now().toString().slice(-4)}`;
  await page.type('#chatInput', `帮我加一条明天交实验报告 ${title}`);
  await page.click('#sendBtn');

  await page.waitForSelector('.tool-card', { timeout: 40000 });
  await page.waitForFunction(() => !document.querySelector('.msg.is-typing'), { timeout: 60000 });
  await sleep(800);

  const toolName = await page.$eval('.tool-card .tool-name', (el) => el.textContent.trim());
  const toolResult = await page.$eval('.tool-card .tool-result', (el) => el.textContent.trim());

  await page.screenshot({ path: out });
  console.log('saved', out);
  console.log('工具卡片:', toolName, '|', toolResult);
  console.log('pageerrors:', errors.length, errors[0] ? `| ${errors[0]}` : '');
} finally {
  await browser.close();
}

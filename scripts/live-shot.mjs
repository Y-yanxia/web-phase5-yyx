// 截一张线上 Pages 的真实样子（没有后端时的提示是否清楚）
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const url = process.argv[2] || 'https://y-yanxia.github.io/web-phase5-yyx/';
const out = process.argv[3] || 'docs/evidence/13-pages-live.png';

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--lang=zh-CN'],
  defaultViewport: { width: 1280, height: 860, deviceScaleFactor: 1 },
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: out });
  console.log('saved', out, '| pageerrors:', errors.length);
  console.log('正文片段:', (await page.$eval('#listState', (el) => el.innerText)).slice(0, 160).replace(/\n/g, ' '));
} finally {
  await browser.close();
}

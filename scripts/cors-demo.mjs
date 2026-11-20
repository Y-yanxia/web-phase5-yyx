// 复现并截取 CORS 报错：前端跑在 5055，后端在 3100，且后端白名单里没有 5055。
// 用法：node scripts/cors-demo.mjs [outName]
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const OUT = path.resolve('docs/evidence');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const url = process.argv[2] || 'http://127.0.0.1:5055/?api=http://127.0.0.1:3100';
const name = process.argv[3] || '11-cors-error.png';

fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--lang=zh-CN'],
  defaultViewport: { width: 1180, height: 760, deviceScaleFactor: 1 },
});

const logs = [];
try {
  const page = await browser.newPage();
  page.on('console', (m) => logs.push(`[console.${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} :: ${r.failure()?.errorText}`));

  await page.goto(url, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: path.join(OUT, name) });
  console.log('已截图', path.join(OUT, name));
} finally {
  await browser.close();
}

console.log('\n浏览器 Console 原文：');
for (const line of logs) console.log(line);
fs.writeFileSync(path.join(OUT, name.replace('.png', '.log.txt')), logs.join('\n'), 'utf8');

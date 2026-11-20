// 截一张线上 Pages 的真实样子（可选切到 AI 面板）
// 用法：node scripts/live-shot.mjs [url] [out.png] [tab=list|ai]
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const url = process.argv[2] || 'https://y-yanxia.github.io/web-phase5-yyx/';
const out = process.argv[3] || 'docs/evidence/13-pages-live.png';
const tab = process.argv[4] || 'list';

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

  if (tab === 'ai') {
    await page.click('.tab[data-tab="ai"]');
    await new Promise((r) => setTimeout(r, 600));
  }

  await page.screenshot({ path: out });
  console.log('saved', out, '| pageerrors:', errors.length);
  const snippet = await page.evaluate(() => {
    if (!document.querySelector('#panel-ai').hidden) {
      const el = document.querySelector('#chatInput');
      return `input.disabled=${el?.disabled} placeholder=${el?.placeholder}`;
    }
    return (document.querySelector('#listState')?.innerText || '').slice(0, 100).replace(/\n/g, ' ');
  });
  console.log('片段:', snippet);
} finally {
  await browser.close();
}

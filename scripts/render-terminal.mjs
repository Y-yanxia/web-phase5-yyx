// 把纯文本输出渲染成「终端截图」，用于证据包里的接口测试截图。
// 用法：node scripts/render-terminal.mjs docs/evidence/api-smoke.txt docs/evidence/09-api-smoke.png
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const src = process.argv[2] || 'docs/evidence/api-smoke.txt';
const out = process.argv[3] || 'docs/evidence/09-api-smoke.png';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const text = fs.readFileSync(src, 'utf8');
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

// 按状态码上色，读图和读日志一样快
const colored = text
  .split('\n')
  .map((line) => {
    if (/^\s*(2\d\d)\s/.test(line)) return esc(line).replace(/(2\d\d)(\s)/, '<span class="ok">$1</span>$2');
    if (/^\s*(4\d\d)\s/.test(line)) return esc(line).replace(/(4\d\d)(\s)/, '<span class="warn">$1</span>$2');
    if (/^\s*(5\d\d)\s/.test(line)) return esc(line).replace(/(5\d\d)(\s)/, '<span class="err">$1</span>$2');
    if (line.startsWith('#')) return `<span class="dim">${esc(line)}</span>`;
    return esc(line);
  })
  .join('\n');

const html = `<!doctype html><meta charset="utf-8">
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 22px; background: #10141a; }
  .win {
    width: max-content; min-width: 1040px; border-radius: 10px; overflow: hidden;
    border: 1px solid #2a323d; box-shadow: 0 20px 60px -20px #000;
    font-family: "Cascadia Code", Consolas, monospace; font-size: 13px;
  }
  .bar { display: flex; gap: 7px; padding: 10px 12px; background: #1b2129; align-items: center; }
  .dot { width: 11px; height: 11px; border-radius: 50%; }
  .r { background: #ff5f57 } .y { background: #febc2e } .g { background: #28c840 }
  .title { margin-left: 10px; color: #7d8896; font-size: 12px; }
  pre { margin: 0; padding: 16px 18px; color: #d7dee8; line-height: 1.55; }
  .ok { color: #4ade80 } .warn { color: #fbbf24 } .err { color: #f87171 } .dim { color: #64748b }
</style>
<div class="win">
  <div class="bar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span>
    <span class="title">powershell — node scripts/smoke.mjs</span></div>
  <pre>${colored}</pre>
</div>`;

const file = path.resolve('.cache', 'terminal.html');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, html, 'utf8');

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--force-color-profile=srgb'],
  defaultViewport: { width: 1180, height: 800, deviceScaleFactor: 2 },
});
try {
  const page = await browser.newPage();
  await page.goto('file:///' + file.replace(/\\/g, '/'), { waitUntil: 'load' });
  const el = await page.$('.win');
  await el.screenshot({ path: out });
  console.log('已生成', out);
} finally {
  await browser.close();
}

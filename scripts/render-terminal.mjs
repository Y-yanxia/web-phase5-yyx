// 把纯文本输出渲染成「终端截图」，用于证据包里的接口测试截图。
// 用法：node scripts/render-terminal.mjs docs/evidence/api-smoke.txt docs/evidence/09-api-smoke.png
//
// 为什么要渲成图片：答辩要的是「看得见的证据」，但纯文本截图容易被怀疑是手抄；
// 同一份文本由脚本渲成终端样式，命令能重跑、状态码有颜色，一眼就能看懂。
//
// 用法（默认值就是 npm run shots:terminal 那一套）：
// node scripts/render-terminal.mjs [输入.txt] [输出.png]
//
// 前置条件：不用起服务；只要本机 Edge，和一份已经跑出来的文本；
// 通常是先 node scripts/smoke.mjs 生成 docs/evidence/api-smoke.txt。
// 产物：默认是 docs/evidence/09-api-smoke.png
// 中间 HTML 落在 .cache/terminal.html，方便复查
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

// 源文本和输出都给默认值：零参数就能复现文档里的 09 号图
const src = process.argv[2] || 'docs/evidence/api-smoke.txt';
const out = process.argv[3] || 'docs/evidence/09-api-smoke.png';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

// 先读文本再渲：两步分开，txt 留着可复查，图随时能重出
const text = fs.readFileSync(src, 'utf8');
// 先转义再拼 HTML：接口返回里可能有尖括号，不能被当成标签
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

// 按状态码上色，读图和读日志一样快
// 2xx 绿、4xx 黄、5xx 红：评委扫一眼就能定位异常那几条，不用逐行读
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

// 手搓一个终端窗口：标题栏 + 红黄绿圆点，看起来才像真的命令行截图
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

// 中间 HTML 落 .cache：能复查，也不进版本库，不污染仓库
const file = path.resolve('.cache', 'terminal.html');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, html, 'utf8');

// deviceScaleFactor 2：两倍图放大看状态码不糊，放进文档也清楚
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--force-color-profile=srgb'],
  defaultViewport: { width: 1180, height: 800, deviceScaleFactor: 2 },
});
try {
  const page = await browser.newPage();
  // 用 file:// 直开本地 HTML：不用起服务，渲染结果也稳定
  await page.goto('file:///' + file.replace(/\\/g, '/'), { waitUntil: 'load' });
  // 只截这个窗口元素：不带黑边，插进文档比例正好
  const el = await page.$('.win');
  await el.screenshot({ path: out });
  console.log('已生成', out);
} finally {
  await browser.close();
}

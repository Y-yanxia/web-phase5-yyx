// 复现并截取 CORS 报错：前端跑在 5055，后端在 3100，且后端白名单里没有 5055。
// 用法：node scripts/cors-demo.mjs [outName]
// 实际参数是 [页面url] [输出文件名]：第一个决定打哪个后端，第二个决定存哪张图
//
// 解决什么问题：把「前端 5055、后端 3100、白名单里没有 5055」这次跨域事故变成可重复的操作，
// 顺手把浏览器 Console 的原始报错原样存下来，截图之外还有文字证据。
//
// 怎么故意制造跨域失败：
// 1. 用 static-server.mjs 把 public/ 起在 5055，页面就换了源；
// 2. 地址后面带 ?api=http://127.0.0.1:3100，让页面去请求另一个域；
// 3. 后端 ALLOWED_ORIGINS 里故意不含 5055，响应就没有 ACAO 头，浏览器直接拦。
//
// 用法（两个终端，顺序别反）：
// node scripts/static-server.mjs 5055
// node scripts/cors-demo.mjs [页面url] [输出文件名]
//
// 前置条件：后端 3100 活着且白名单不含 5055；本机 Edge 在固定路径。
// 产物：docs/evidence/11-cors-error.png
// 同名的 .log.txt 存 Console 原文，图看不清就看文本
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

// 截图和日志都进 docs/evidence：README 的索引和文档都从这个目录取图
const OUT = path.resolve('docs/evidence');
// 用系统自带 Edge：puppeteer-core 不带浏览器，再装 Chromium 太占地方
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
// 默认就指到跨域现场：5055 的页面打 3100 的接口，参数都不用传
const url = process.argv[2] || 'http://127.0.0.1:5055/?api=http://127.0.0.1:3100';
// 默认文件名对齐证据编号：11 是失败那张，12 是修好之后那张
const name = process.argv[3] || '11-cors-error.png';

// 目录可能被清过，先建好，别等截图时才报 ENOENT
fs.mkdirSync(OUT, { recursive: true });

// 无头跑：不弹窗，也不会被人手误关掉，适合反复出证据
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--lang=zh-CN'],
  defaultViewport: { width: 1180, height: 760, deviceScaleFactor: 1 },
});

// 三个事件都收：跨域时 console 有红字，requestfailed 有原因，pageerror 可能先炸
const logs = [];
try {
  const page = await browser.newPage();
  // Console 原文是这次取证的主角：报错里明写「没有 ACAO 头」，直接指向白名单
  page.on('console', (m) => logs.push(`[console.${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  // 被 CORS 拦掉的请求走 requestfailed，错误文本一般是 net::ERR_FAILED
  page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} :: ${r.failure()?.errorText}`));

  // 等网络静默：失败请求和错误提示都要落页面，截出来才是完整现场
  await page.goto(url, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));
  // 截图只证明页面进了错误态，Console 原文另存文本，别一张图当全部证据
  await page.screenshot({ path: path.join(OUT, name) });
  console.log('已截图', path.join(OUT, name));
} finally {
  await browser.close();
}

// 同时打到终端和文件：截图看不清长报错，文本才方便搜索和粘贴
console.log('\n浏览器 Console 原文：');
for (const line of logs) console.log(line);
// 日志和图片同名：11-cors-error.png 配 11-cors-error.log.txt，找起来不费劲
fs.writeFileSync(path.join(OUT, name.replace('.png', '.log.txt')), logs.join('\n'), 'utf8');

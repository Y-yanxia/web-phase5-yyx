// 截一张线上 Pages 的真实样子（可选切到 AI 面板）
// 用法：node scripts/live-shot.mjs [url] [out.png] [tab=list|ai]
//
// 解决什么问题：本地页面和线上 Pages 不是一回事，交付要一张「线上真能打开」的图。
//
// 用法（三个参数都可省，默认就是线上地址 + 列表页）：
// node scripts/live-shot.mjs [页面url] [输出png] [list|ai]
//
// 前置条件：Pages 已部署；要看 AI 页就保证后端活着，否则输入框是禁用的。
// 产物：docs/evidence/13-pages-live.png，终端打印 pageerror 数和一段页面文本。
import puppeteer from 'puppeteer-core';

// 本机 Edge 的安装路径：puppeteer-core 不带浏览器，只能借系统的
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
// 默认值就是线上 Pages：不带参数也能一直产出证据
const url = process.argv[2] || 'https://y-yanxia.github.io/web-phase5-yyx/';
// 输出跟 README 的 13 号证据对齐，文档里直接引用这个文件名
const out = process.argv[3] || 'docs/evidence/13-pages-live.png';
// 第三个参数只决定页签：一个脚本同时覆盖列表页和 AI 页两张图
const tab = process.argv[4] || 'list';

// 无头模式：跑完就退，不留下一个要人手动关的窗口
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--lang=zh-CN'],
  defaultViewport: { width: 1280, height: 860, deviceScaleFactor: 1 },
});
try {
  const page = await browser.newPage();
  // 只收 pageerror：线上白屏最常见的原因就是脚本抛了异常
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // 等网络静默：Pages 走 CDN，本地那套超时习惯要放宽到 60 秒
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  // 再补 1.2 秒：列表是接口回来后才渲染，立刻截只会截到空态
  await new Promise((r) => setTimeout(r, 1200));

  // 要 AI 页就先切页签，多等 600ms 让切换动画走完
  if (tab === 'ai') {
    await page.click('.tab[data-tab="ai"]');
    await new Promise((r) => setTimeout(r, 600));
  }

  // 截当前视口：保留页面真实样子，不做裁剪
  await page.screenshot({ path: out });
  console.log('saved', out, '| pageerrors:', errors.length);
  // 再抽一段文字：截图之外留个可搜索的记录，方便比对是不是线上数据
  const snippet = await page.evaluate(() => {
    // AI 页重点看输入框：后端断开时它是 disabled，这行能证明兜底生效
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

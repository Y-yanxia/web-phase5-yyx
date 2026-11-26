// 在线上 Pages 上真发一句话，截「工具调用成功」的现场
// 用法：node scripts/live-ai-shot.mjs [url] [out.png]
//
// 解决什么问题：本地截的图证明不了线上，这里在真 Pages + 真隧道 + 真模型上
// 发一句话，把「工具真的被调用」这一刻截下来当关键证据。
//
// 用法（无参数也能跑，默认就是线上地址）：
// node scripts/live-ai-shot.mjs [页面url] [输出png]
//
// 前置条件：Pages 已部署、API_BASE 指向活着的后端、后端配了真 Key；
// 本机能出国访问 GitHub Pages，走隧道时首包比较慢，耐心等。
// 产物：docs/evidence/15-live-ai-tool-call.png，终端打印工具名和结果。
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
// 默认就是线上 Pages：本脚本的用途只有取证，不做通用工具
const url = process.argv[2] || 'https://y-yanxia.github.io/web-phase5-yyx/';
// 输出对齐 README 的 15 号证据：跑一次就是一张能直接放进文档的图
const out = process.argv[3] || 'docs/evidence/15-live-ai-tool-call.png';

// 只留一个极短的 sleep：等条件为主，它只负责补渲染的最后一下
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 无头 Edge：不弹窗、不用人工干预，适合反复出证据
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--lang=zh-CN'],
  defaultViewport: { width: 1280, height: 900, deviceScaleFactor: 1 },
});
try {
  const page = await browser.newPage();
  // 线上出问题没人开 F12，报错必须自己收集并打到终端
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  // 线上首包要等 CDN 和隧道，60 秒超时是本地习惯的十倍
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  // 直接切 AI 页：这个脚本只关心对话链路
  await page.click('.tab[data-tab="ai"]');
  // 等输入框出现：顺带确认 AI 面板已渲染，后端没连上时它是 disabled
  await page.waitForSelector('#chatInput', { timeout: 20000 });

  // 标题带尾号：截图和数据库里那条能对上，事后也好清理
  const title = `线上实测-${Date.now().toString().slice(-4)}`;
  // 一句自然的指令：验证的是模型会不会主动调工具
  await page.type('#chatInput', `帮我加一条明天交实验报告 ${title}`);
  await page.click('#sendBtn');

  // 真模型 + 隧道，给 40 秒；卡片出现才算工具调用成功
  await page.waitForSelector('.tool-card', { timeout: 40000 });
  // 等流式结束：停在半句时截图，说服力会打折
  await page.waitForFunction(() => !document.querySelector('.msg.is-typing'), { timeout: 60000 });
  await sleep(800);

  const toolName = await page.$eval('.tool-card .tool-name', (el) => el.textContent.trim());
  const toolResult = await page.$eval('.tool-card .tool-result', (el) => el.textContent.trim());

  // 截当前视口：工具卡片、回复、调用记录尽量同框，一图讲完整个链路
  await page.screenshot({ path: out });
  console.log('saved', out);
  console.log('工具卡片:', toolName, '|', toolResult);
  console.log('pageerrors:', errors.length, errors[0] ? `| ${errors[0]}` : '');
} finally {
  await browser.close();
}

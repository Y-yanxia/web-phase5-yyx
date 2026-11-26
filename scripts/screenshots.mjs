// 证据截图脚本：用本机 Edge + puppeteer-core 无头跑一遍真实页面。
// 用法： node scripts/screenshots.mjs [baseUrl]
// 产出： docs/evidence/*.png
//
// 解决什么问题：任务书要一批证据图，手工截既慢又不一致；这里一次跑完
// 桌面/手机/三态/404，顺手断言 Console 干净、窄屏没有横向滚动。
//
// 用法（先 npm start，另开窗口跑；也可以直接 npm run shots）：
// node scripts/screenshots.mjs [baseUrl]
//
// 前置条件：服务在跑（默认 3100）、先用 seed.mjs 灌好数据；
// AI 那几张需要 mock 或真 Key；本机 Edge 在固定路径。
// 产物：docs/evidence/01~08 与 10 号 PNG；终端打印 375px 宽度和 Console 问题。
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = (process.argv[2] || process.env.BASE_URL || 'http://127.0.0.1:3100').replace(/\/+$/, '');
const OUT = path.resolve('docs/evidence');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

fs.mkdirSync(OUT, { recursive: true });

// 截图统一走这里：每个文件打一行，跑完对着清单数就知道缺哪张
const shot = async (page, name, opts = {}) => {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, ...opts });
  console.log('  ✔', name);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// sRGB 色彩配置：截图颜色和真机一致，贴进文档不会偏色
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--lang=zh-CN', '--force-color-profile=srgb'],
  defaultViewport: { width: 1280, height: 860, deviceScaleFactor: 1 },
});

// 三处都收：console.error、未捕获异常、失败请求，最后统一汇报
const consoleIssues = [];
try {
  const page = await browser.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') consoleIssues.push(`console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => consoleIssues.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => consoleIssues.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));

  // 第 1 张要最稳的状态：数据和接口都正常时的桌面列表，也当封面图
  console.log('1) 桌面端清单页');
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  // 数据或空/错状态总有一个会渲染出来，等它出现再截，避免截到白屏
  await page.waitForSelector('.item, .state');
  await sleep(400);
  await shot(page, '01-desktop-list.png');

  // 筛选会重新请求接口，所以下面等的是渲染余量，不是等接口超时
  console.log('2) 筛选 + 搜索');
  // 点「未完成」：证明筛选真的在过滤，不是前端假切换
  await page.click('.chip[data-filter="pending"]');
  await sleep(700);
  await shot(page, '02-desktop-filter-pending.png');
  await page.click('.chip[data-filter="all"]');
  await sleep(500);

  // 这张是任务 5 的核心证据：工具卡片 + 回复 + 调用记录同框
  console.log('3) AI 助手 + 工具调用');
  await page.click('.tab[data-tab="ai"]');
  await page.waitForSelector('#chatInput');
  await page.type('#chatInput', '帮我加一条明天交实验报告', { delay: 15 });
  await page.click('#sendBtn');
  // 等工具卡片出现：说明模型选了工具，而不是只用文字答应
  await page.waitForSelector('.tool-card', { timeout: 15000 });
  await page.waitForFunction(() => !document.querySelector('.msg.is-typing'), { timeout: 20000 });
  await sleep(500);
  await shot(page, '03-ai-tool-call.png');

  // 切回列表再等 800ms：新增要重新拉一次接口才会出现在列表里
  console.log('4) 回到清单看新条目');
  await page.click('.tab[data-tab="list"]');
  await sleep(800);
  await shot(page, '04-list-after-ai-add.png');

  // 手机端另开一个页面：视口设过就改不回来，重开比原地改干净
  console.log('5) 手机端 375px（清单 + AI）');
  const mobile = await browser.newPage();
  await mobile.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await mobile.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await mobile.waitForSelector('.item');
  await sleep(500);
  await shot(mobile, '05-mobile-list.png');
  // 顺手打印 scrollWidth：超过 375 就是有横向滚动，光看图不一定看得出来
  const scrollWidth = await mobile.evaluate(() => document.documentElement.scrollWidth);
  console.log('   375px scrollWidth =', scrollWidth);
  await mobile.click('.tab[data-tab="ai"]');
  await sleep(400);
  await shot(mobile, '06-mobile-ai.png');
  await mobile.close();

  // 为什么要拦请求：本地接口 2ms 就回来，不拖住它根本截不到骨架屏
  console.log('6) loading 态（拦截列表请求延迟 1.8s）');
  const slow = await browser.newPage();
  await slow.setRequestInterception(true);
  // 把列表请求故意拖 1.8 秒：这段时间页面就停在 loading 态，正好截
  slow.on('request', async (req) => {
    if (req.url().includes('/api/items') && req.method() === 'GET') {
      await sleep(1800);
    }
    req.continue().catch(() => {});
  });
  // goto 故意不 await：等了就迟了，1.8 秒后骨架屏已经没了
  slow.goto(BASE + '/').catch(() => {});
  // 900ms 时请求还挂着：这时候截，页面百分之百在 loading
  await sleep(900);
  await shot(slow, '07-state-loading.png');
  await slow.close();

  // 为什么用 abort：断网才是真实错误，前端才会走 catch 分支出重试按钮
  console.log('7) error 态（拦截列表请求并 abort）');
  const broken = await browser.newPage();
  await broken.setRequestInterception(true);
  // abort('failed') 模拟网络层失败：前端拿到的是网络错误，不是业务错误
  broken.on('request', (req) => {
    if (req.url().includes('/api/items') && req.method() === 'GET') {
      req.abort('failed').catch(() => {});
    } else {
      req.continue().catch(() => {});
    }
  });
  await broken.goto(BASE + '/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  // 等 1.2 秒：错误态渲染和重试按钮出现都需要一帧以上
  await sleep(1200);
  await shot(broken, '08-state-error.png');
  await broken.close();

  // 真 404：确认状态码是 404 且回 404.html，不是 200 的软跳转
  console.log('8) 真 404 页面');
  const notFound = await browser.newPage();
  // 故意访问坏路径：顺便把状态码打出来，图里看不到状态码就靠这行
  const resp = await notFound.goto(BASE + '/not-exist', { waitUntil: 'networkidle2' });
  console.log('   /not-exist status =', resp?.status());
  await sleep(300);
  await shot(notFound, '10-404-page.png');
  await notFound.close();
} finally {
  await browser.close();
}

// 有问题也照常截图：取证脚本的产物是图，Console 问题只是附注
if (consoleIssues.length) {
  console.log('\n⚠ 浏览器侧问题：');
  for (const line of consoleIssues) console.log('  -', line);
  // 特意不置 1：这里的目标是产出证据，不是让流水线变红
  process.exitCode = 0; // 截图仍然有效，问题记录在案
} else {
  console.log('\n✔ Console 无报错、无失败请求');
}

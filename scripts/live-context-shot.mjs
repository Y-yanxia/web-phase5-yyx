// 线上跑 4 轮对话，证明上下文接得上；顺便抓一次真实的 /api/chat 请求体（证明前端不带 Key）
// 用法：node scripts/live-context-shot.mjs
//
// 解决什么问题：多轮上下文是「会话」能力的核心，mock 证明不了模型真记得住；
// 这里在线上连说 4 轮，最后一句必须靠第 1 轮的内容才答得对。
//
// 用法（无参数，地址固定指向线上 Pages）：
// node scripts/live-context-shot.mjs
//
// 前置条件：Pages 可用、API_BASE 指向活着的后端、后端配了真 Key；
// 4 轮都要等模型回完，整趟大约 1~2 分钟，别中途关窗口。
// 产物：docs/evidence/18-live-context-4rounds.png
// 终端同时打印第 4 轮回复和请求体，文字也能当证据
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
// 地址写死：这是线上取证脚本，不需要做成通用工具
const url = 'https://y-yanxia.github.io/web-phase5-yyx/';
// 输出对齐 README 的 18 号证据，文件名固定方便文档引用
const out = 'docs/evidence/18-live-context-4rounds.png';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--lang=zh-CN'],
  defaultViewport: { width: 1280, height: 1000, deviceScaleFactor: 1 },
});

// 抓请求体是为了证明前端只发消息、不带 Key，这是任务 4 的关键证据
let chatRequestBody = null;

try {
  const page = await browser.newPage();
  // 只记 /api/chat 的 POST：其他请求和这条证据无关，记了反而吵
  page.on('request', (req) => {
    if (req.url().includes('/api/chat') && req.method() === 'POST') chatRequestBody = req.postData();
  });

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.click('.tab[data-tab="ai"]');
  await page.waitForSelector('#chatInput', { timeout: 20000 });

  // 每轮都等到「打字结束 + 工具结果落地」，否则下一句会插进上一轮
  const ask = async (text, waitMs = 30000) => {
    await page.type('#chatInput', text);
    await page.click('#sendBtn');
    // 等流式结束：没结束就发下一句，上下文顺序会乱
    await page.waitForFunction(() => !document.querySelector('.msg.is-typing'), { timeout: waitMs });
    // 等工具卡片的结果落地
    // 卡片先显示「执行中」，等它变成真结果，才算这一轮真的完成
    await page.waitForFunction(
      () => !document.querySelector('.tool-card .tool-result')?.textContent.includes('执行中'),
      { timeout: waitMs }
    );
    await sleep(400);
  };

  // 四轮是刻意设计的：建 → 再建 → 查询 → 反问第一句，只有答对才证明接上了
  await ask('帮我加一条明天交实验报告');
  await ask('再帮我加一条周五复习复变函数');
  await ask('我还有哪些没做完');
  await ask('我刚才第一句说了什么');

  // 截当前视口：把第 4 轮的现场拍下来，评委一眼能看出上下文是连续的
  await page.screenshot({ path: out });
  console.log('saved', out);

  // 把第 4 轮回复打出来：截图之外再给一行文字证据
  const lastReply = await page.evaluate(() => {
    const bodies = [...document.querySelectorAll('.msg-assistant .msg-body')];
    return bodies.at(-1)?.textContent?.trim() || '';
  });
  console.log('第 4 轮回复:', lastReply.slice(0, 120));
  // 请求体里没有 key，就是「前端不碰 Key」这条最直接的证据
  console.log('POST /api/chat 请求体:', chatRequestBody);
} finally {
  await browser.close();
}

// 线上跑 4 轮对话，证明上下文接得上；顺便抓一次真实的 /api/chat 请求体（证明前端不带 Key）
// 用法：node scripts/live-context-shot.mjs
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const url = 'https://y-yanxia.github.io/web-phase5-yyx/';
const out = 'docs/evidence/18-live-context-4rounds.png';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--lang=zh-CN'],
  defaultViewport: { width: 1280, height: 1000, deviceScaleFactor: 1 },
});

let chatRequestBody = null;

try {
  const page = await browser.newPage();
  page.on('request', (req) => {
    if (req.url().includes('/api/chat') && req.method() === 'POST') chatRequestBody = req.postData();
  });

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.click('.tab[data-tab="ai"]');
  await page.waitForSelector('#chatInput', { timeout: 20000 });

  const ask = async (text, waitMs = 30000) => {
    await page.type('#chatInput', text);
    await page.click('#sendBtn');
    await page.waitForFunction(() => !document.querySelector('.msg.is-typing'), { timeout: waitMs });
    // 等工具卡片的结果落地
    await page.waitForFunction(
      () => !document.querySelector('.tool-card .tool-result')?.textContent.includes('执行中'),
      { timeout: waitMs }
    );
    await sleep(400);
  };

  await ask('帮我加一条明天交实验报告');
  await ask('再帮我加一条周五复习复变函数');
  await ask('我还有哪些没做完');
  await ask('我刚才第一句说了什么');

  await page.screenshot({ path: out });
  console.log('saved', out);

  const lastReply = await page.evaluate(() => {
    const bodies = [...document.querySelectorAll('.msg-assistant .msg-body')];
    return bodies.at(-1)?.textContent?.trim() || '';
  });
  console.log('第 4 轮回复:', lastReply.slice(0, 120));
  console.log('POST /api/chat 请求体:', chatRequestBody);
} finally {
  await browser.close();
}

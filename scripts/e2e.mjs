// 前端端到端冒烟：用真浏览器把「加 → 勾 → 搜 → 删 → 让 AI 加一条」完整走一遍。
// 用法： node scripts/e2e.mjs [baseUrl]
// 前置：服务已启动（npm start），且是 mock 或 live 模式都行。
//
// 解决什么问题：接口测试证明不了页面能不能点，这里用真浏览器把关键路径走一遍，
// 哪一步的 DOM 没按预期变化就直接算失败，最后给出 9 项通过情况。
//
// 用法（先 npm start 起服务，再另开窗口跑）：
// node scripts/e2e.mjs [baseUrl]
// BASE_URL=https://xxx.trycloudflare.com node scripts/e2e.mjs
//
// 前置条件：服务在跑（mock 或 live 都行）；本机 Edge 在固定路径；线上跑要留足超时。
// 产物：只打终端，不落文件；全过退出码 0，有失败则 1，CI 只看这个。
import puppeteer from 'puppeteer-core';

// 优先用命令行参数，其次环境变量：同一份用例能打本地也能打线上
const BASE = (process.argv[2] || process.env.BASE_URL || 'http://127.0.0.1:3100').replace(/\/+$/, '');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
// sleep 只留给没有稳定 DOM 条件可等的地方，其余一律等条件
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 结果先攒着：中途有失败也继续跑，一次能看到所有问题
const results = [];
// 断言统一走 check：打印和统计用同一份数据，输出不会自相矛盾
const check = (name, ok, extra = '') => {
  results.push({ name, ok, extra });
  console.log(`${ok ? '✔' : '✖'} ${name}${extra ? ` — ${extra}` : ''}`);
};

// 新无头模式渲染和真浏览器一致：e2e 通过才敢说线上也能点
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--lang=zh-CN'],
  defaultViewport: { width: 1280, height: 900, deviceScaleFactor: 1 },
});

// 顺手收集控制台错误：最后一并断言，不用人再去开 F12
const consoleErrors = [];
try {
  const page = await browser.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  // 删除会弹 confirm：不自动点确定，用例会卡在对话框上
  page.on('dialog', (d) => d.accept());

  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  // 等表单出现：首屏脚本执行完页面才可交互，早一步就点空
  await page.waitForSelector('#addForm');

  /* ---------- 1. 手动新增 ---------- */
  // 标题带时间戳尾号：避免上次残留的数据让断言假通过
  const title = `E2E-${Date.now().toString().slice(-6)}`;
  await page.type('#titleInput', title);
  await page.click('#addBtn');
  // 等这条真的出现在列表里：线上走隧道要 2~3 秒，等条件比 sleep 稳
  await page.waitForFunction(
    (t) => [...document.querySelectorAll('.item-title')].some((el) => el.textContent.trim() === t),
    { timeout: 8000 },
    title
  );
  check('手动新增：提交后列表出现该条', true, title);

  /* ---------- 2. 勾选完成 ---------- */
  // 按标题定位 li：列表里本来就有一堆条目，只有文本是唯一的
  const itemHandle = await page.evaluateHandle((t) => {
    const li = [...document.querySelectorAll('li.item')].find(
      (el) => el.querySelector('.item-title')?.textContent.trim() === t
    );
    return li;
  }, title);
  // 直接触发 DOM click：勾选框小、被动画盖住时按坐标点会失败
  await itemHandle.asElement().$eval('.check', (el) => el.click());
  await page.waitForFunction(
    (t) => {
      const li = [...document.querySelectorAll('li.item')].find(
        (el) => el.querySelector('.item-title')?.textContent.trim() === t
      );
      // 等 is-done 类出现：说明接口真回了并重渲染，不是前端乐观更新
      return li?.classList.contains('is-done');
    },
    { timeout: 8000 },
    title
  );
  check('勾选完成：条目进入已完成状态（数据来自接口）', true);

  /* ---------- 3. 搜索过滤 ---------- */
  // 搜标题后四位就够唯一：顺便验证搜索是子串匹配，不是整串相等
  await page.type('#searchInput', title.slice(-4));
  // 线上经过隧道时单次请求 2~3 秒，用「等条件」而不是「睡固定时间」
  // 这是本脚本最重要的一条纪律：线上 2~3 秒的延迟，睡 1 秒永远不够；
  // 等条件既不会误判，本地跑也不用白等，比固定 sleep 快得多。
  let searchCount = -1;
  try {
    await page.waitForFunction(() => document.querySelectorAll('li.item').length === 1, { timeout: 20000 });
    searchCount = 1;
  } catch {
    // 超时也要把实际条数读出来：失败信息得告诉人「几条」，不是只说超时
    searchCount = await page.$$eval('li.item', (els) => els.length);
  }
  check('搜索：只返回匹配项', searchCount === 1, `匹配 ${searchCount} 条`);
  // 清空搜索要手动派发 input：直接改 value 不会触发页面自己的监听
  await page.$eval('#searchInput', (el) => {
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // 等列表回到多条再往下走：否则下一步会误判成「搜索没生效」
  await page.waitForFunction(() => document.querySelectorAll('li.item').length > 1, { timeout: 20000 }).catch(() => {});

  /* ---------- 4. 让 AI 加一条 ---------- */
  // 切到 AI 页：工具调用是任务 5 的核心，必须端到端走通
  await page.click('.tab[data-tab="ai"]');
  await page.waitForSelector('#chatInput');
  // AI 那条也用时间戳：之后要按标题找到它再删，不能和旧数据重名
  const aiTitle = `AI-${Date.now().toString().slice(-5)}`;
  // 用真人会说的句子，不是直接调接口：验证的是模型会不会选工具
  await page.type('#chatInput', `帮我加一条 ${aiTitle}`);
  await page.click('#sendBtn');
  // 等工具卡片出现：说明它真调了工具，而不是只用嘴答应
  await page.waitForSelector('.tool-card', { timeout: 20000 });
  const toolName = await page.$eval('.tool-card .tool-name', (el) => el.textContent.trim());
  // 等打字机停下：流式没结束时断言，会看到半截状态
  await page.waitForFunction(() => !document.querySelector('.msg.is-typing'), { timeout: 25000 });
  check('AI 工具调用：出现工具卡片', toolName.includes('add_item'), toolName);

  // 调试面板是答辩要展示的调用记录，顺手断言它真的有内容
  const debugCount = await page.$$eval('#debugList .debug-item', (els) => els.length);
  check('AI 工具调用：调试面板有记录', debugCount >= 1, `${debugCount} 条`);

  // 切回列表：确认工具调用的结果真的落库，不是只在聊天里演
  await page.click('.tab[data-tab="list"]');
  let aiItemExists = false;
  try {
    await page.waitForFunction(
      (t) => [...document.querySelectorAll('.item-title')].some((el) => el.textContent.includes(t)),
      { timeout: 8000 },
      aiTitle
    );
    aiItemExists = true;
  } catch {
    const titles = await page.$$eval('.item-title', (els) => els.map((e) => e.textContent.trim()));
    console.log('  当前列表：', JSON.stringify(titles));
  }
  check('AI 新增落到清单：切回列表能看到', aiItemExists, aiTitle);

  /* ---------- 5. 删除（含 confirm） ---------- */
  // 删除走页面上的按钮：验证的是 UI 交互，不是直接发 DELETE
  await page.evaluate((t) => {
    const li = [...document.querySelectorAll('li.item')].find((el) =>
      el.querySelector('.item-title')?.textContent.includes(t)
    );
    li?.querySelector('[data-action="delete"]')?.click();
  }, aiTitle);
  // 这段没有稳定的 DOM 条件可等：confirm 弹窗 + 请求往返，先给 1.2 秒
  await sleep(1200);
  // 等条目消失；超时就再查一次，区分「没删掉」和「删慢了」
  let stillThere = true;
  try {
    await page.waitForFunction(
      (t) => ![...document.querySelectorAll('.item-title')].some((el) => el.textContent.includes(t)),
      { timeout: 20000 },
      aiTitle
    );
    stillThere = false;
  } catch {
    stillThere = await page.evaluate(
      (t) => [...document.querySelectorAll('.item-title')].some((el) => el.textContent.includes(t)),
      aiTitle
    );
  }
  check('删除：确认后条目消失', !stillThere);

  /* ---------- 6. 320px 极窄屏 ---------- */
  // 320px 是最窄的主流宽度：横向滚动条是移动端最常见的布局事故
  await page.setViewport({ width: 320, height: 720, deviceScaleFactor: 2, isMobile: true });
  // 重新加载再量：排除「只是当前 DOM 没换」的假象
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(600);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  check('320px：无横向滚动条', scrollWidth <= 320, `scrollWidth=${scrollWidth}`);

  /* ---------- 7. 控制台 ---------- */
  // 控制台干净才算整体健康：单独一条，别让它淹没在其他断言里
  check('浏览器 Console 无报错', consoleErrors.length === 0, consoleErrors[0] || '');
} finally {
  await browser.close();
}

// 用退出码表达结果：CI 只看这个，不用去解析中文输出
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  console.log('失败项：', failed.map((f) => f.name).join('、'));
  process.exitCode = 1;
}

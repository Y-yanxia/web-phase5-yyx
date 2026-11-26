// 接口冒烟测试：把任务2 的验收动作「curl 调一遍并截图」脚本化。
// 用法：node scripts/smoke.mjs [baseUrl]
// 产物：docs/evidence/api-smoke.txt（再由 render-terminal.mjs 渲成截图）
//
// 解决什么问题：任务 2 要求逐条 curl 再截图，11 条手敲既慢又会漏；
// 这里用脚本一次打完，把状态码、耗时、返回摘要排成表格。
//
// 用法（先 npm start 起服务）：
// node scripts/smoke.mjs [baseUrl]        # 或 npm run smoke
//
// 前置条件：服务在跑（默认 3100）；?fail=1 演示开关只在非 production 生效。
// 产物：docs/evidence/api-smoke.txt
// 再用 render-terminal.mjs 渲成 09 号截图
import fs from 'node:fs';
import path from 'node:path';

const BASE = (process.argv[2] || process.env.BASE_URL || 'http://127.0.0.1:3100').replace(/\/+$/, '');
// 输出固定进 docs/evidence：渲染脚本和文档索引都认这个路径
const OUT = path.resolve('docs/evidence');

// 中文是双宽字符：按显示宽度补齐，终端里表格才不会歪
// 宽度算错，渲成图片后列会错位，读者会以为是数据出了问题
const width = (s) =>
  [...String(s)].reduce((n, ch) => n + (/[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? 2 : 1), 0);
// 左右各一个补齐函数：数字列靠右、文字列靠左，表格才像样
const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - width(s)));
const padS = (s, n) => ' '.repeat(Math.max(0, n - width(s))) + String(s);

// 记下创建出来的那条：后面 PUT/PATCH/DELETE 都要用它的 id
let created = null;
const rows = [];

// 所有请求都走这里：顺手量耗时、抓状态码，省得每条再写一遍
async function hit(method, urlPath, body) {
  const started = Date.now();
  const res = await fetch(BASE + urlPath, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  // 耗时也进表格：本地几毫秒说明走的是真接口，不是前端假数据
  const ms = Date.now() - started;
  const text = await res.text();
  // 摘要压成一行再截断：长 JSON 会把表格行撑爆，图就没法看了
  let summary = text.replace(/\s+/g, ' ');
  if (summary.length > 96) summary = summary.slice(0, 96) + '…';
  rows.push({ method, path: urlPath, status: res.status, ms, summary });
  return { res, text };
}

// 先打一行标题和 base：截图里要能看出这一次打的是哪个环境
console.log(`# 接口冒烟测试  base=${BASE}\n`);

// 第一步先读列表：它通了，后面的写操作才有意义
await hit('GET', '/api/items');
await hit('GET', '/api/items/stats');

// 建一条带中文和日期的：顺便验证 UTF-8 请求体没被压坏
const c = await hit('POST', '/api/items', { title: '冒烟测试：交实验报告', due: '2026-11-25' });
try {
  // 解析失败也算正常：创建挂了后面照样跑，先看整体再定位
  created = JSON.parse(c.text).data;
} catch {
  created = null;
}

// 故意少传 title：验收要求 400 + 人话，不能是 500
await hit('POST', '/api/items', { due: '2026-11-25' });
// PUT 和 PATCH 都打一遍：同一段逻辑两个动词，不能只测一个
await hit('PUT', `/api/items/${created?.id ?? 1}`, { done: 1 });
await hit('PATCH', `/api/items/${created?.id ?? 1}`, { title: '冒烟测试：改名' });
// 连删两次：第一次正常，第二次必须 404，说明对不存在的数据有明确语义
await hit('DELETE', `/api/items/${created?.id ?? 1}`);
await hit('DELETE', `/api/items/${created?.id ?? 1}`);
// ?fail=1 是演示开关：证明错误也回 JSON，服务不会崩
await hit('GET', '/api/items?fail=1');
// 两个 404 形状不同：接口回 JSON、页面回 HTML，调用方不用猜
await hit('GET', '/api/not-exist');
await hit('GET', '/not-exist');

// 手拼表头：不引依赖，格式固定，渲染脚本才敢按行上色
const header = [
  pad('方法', 8),
  pad('路径', 24),
  pad('状态', 6),
  padS('耗时', 8),
  '  返回摘要',
].join('');
// 每行固定列宽：渲成图片时列不会歪，长文本在上面已经截断
const lines = [
  `# 接口冒烟测试   ${new Date().toLocaleString('zh-CN')}`,
  `# base = ${BASE}`,
  '',
  header,
  '─'.repeat(120),
  ...rows.map((r) =>
    [pad(r.method, 8), pad(r.path, 24), pad(r.status, 6), padS(r.ms + ' ms', 8), '  ' + r.summary].join('')
  ),
  '─'.repeat(120),
  '',
  // 最后统计 2xx/4xx/5xx：一眼看出这轮是不是全绿，异常集中在哪
  `共 ${rows.length} 条请求；2xx ${rows.filter((r) => r.status < 300).length} 条，` +
    `4xx ${rows.filter((r) => r.status >= 400 && r.status < 500).length} 条，` +
    `5xx ${rows.filter((r) => r.status >= 500).length} 条（?fail=1 为演示开关，预期 500）`,
];

const text = lines.join('\n');
console.log(text);
fs.mkdirSync(OUT, { recursive: true });
// 落盘而不是只打印：render-terminal.mjs 要读这个文件才能出图
fs.writeFileSync(path.join(OUT, 'api-smoke.txt'), text + '\n', 'utf8');
console.log(`\n已写入 ${path.join(OUT, 'api-smoke.txt')}`);

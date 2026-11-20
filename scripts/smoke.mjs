// 接口冒烟测试：把任务2 的验收动作「curl 调一遍并截图」脚本化。
// 用法：node scripts/smoke.mjs [baseUrl]
// 产物：docs/evidence/api-smoke.txt（再由 render-terminal.mjs 渲成截图）
import fs from 'node:fs';
import path from 'node:path';

const BASE = (process.argv[2] || process.env.BASE_URL || 'http://127.0.0.1:3100').replace(/\/+$/, '');
const OUT = path.resolve('docs/evidence');

// 中文是双宽字符：按显示宽度补齐，终端里表格才不会歪
const width = (s) =>
  [...String(s)].reduce((n, ch) => n + (/[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? 2 : 1), 0);
const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - width(s)));
const padS = (s, n) => ' '.repeat(Math.max(0, n - width(s))) + String(s);

let created = null;
const rows = [];

async function hit(method, urlPath, body) {
  const started = Date.now();
  const res = await fetch(BASE + urlPath, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const ms = Date.now() - started;
  const text = await res.text();
  let summary = text.replace(/\s+/g, ' ');
  if (summary.length > 96) summary = summary.slice(0, 96) + '…';
  rows.push({ method, path: urlPath, status: res.status, ms, summary });
  return { res, text };
}

console.log(`# 接口冒烟测试  base=${BASE}\n`);

await hit('GET', '/api/items');
await hit('GET', '/api/items/stats');

const c = await hit('POST', '/api/items', { title: '冒烟测试：交实验报告', due: '2026-11-25' });
try {
  created = JSON.parse(c.text).data;
} catch {
  created = null;
}

await hit('POST', '/api/items', { due: '2026-11-25' });
await hit('PUT', `/api/items/${created?.id ?? 1}`, { done: 1 });
await hit('PATCH', `/api/items/${created?.id ?? 1}`, { title: '冒烟测试：改名' });
await hit('DELETE', `/api/items/${created?.id ?? 1}`);
await hit('DELETE', `/api/items/${created?.id ?? 1}`);
await hit('GET', '/api/items?fail=1');
await hit('GET', '/api/not-exist');
await hit('GET', '/not-exist');

const header = [
  pad('方法', 8),
  pad('路径', 24),
  pad('状态', 6),
  padS('耗时', 8),
  '  返回摘要',
].join('');
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
  `共 ${rows.length} 条请求；2xx ${rows.filter((r) => r.status < 300).length} 条，` +
    `4xx ${rows.filter((r) => r.status >= 400 && r.status < 500).length} 条，` +
    `5xx ${rows.filter((r) => r.status >= 500).length} 条（?fail=1 为演示开关，预期 500）`,
];

const text = lines.join('\n');
console.log(text);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'api-smoke.txt'), text + '\n', 'utf8');
console.log(`\n已写入 ${path.join(OUT, 'api-smoke.txt')}`);

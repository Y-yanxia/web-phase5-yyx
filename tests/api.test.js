// 接口自动化测试：不连真实模型（MOCK_AI=1），只验证「接口契约 + 数据真的落库」。
// 运行：npm test
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';
process.env.MOCK_AI = '1';
process.env.NODE_ENV = 'development';

const { createApp } = await import('../server/app.js');

const app = createApp();
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

test.after(() => server.close());

const call = async (path, { method = 'GET', body } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
};

test('GET /api/health 返回运行状态', async () => {
  const { status, json } = await call('/api/health');
  assert.equal(status, 200);
  assert.equal(json.code, 0);
  assert.equal(json.data.status, 'up');
  assert.equal(json.data.mode, 'mock');
});

test('GET /api/items 初始为空列表', async () => {
  const { status, json } = await call('/api/items');
  assert.equal(status, 200);
  assert.deepEqual(json.data.items, []);
});

test('POST /api/items 创建成功并返回完整条目', async () => {
  const { status, json } = await call('/api/items', {
    method: 'POST',
    body: { title: '交实验报告', due: '2026-11-25' },
  });
  assert.equal(status, 200);
  assert.equal(json.code, 0);
  assert.equal(json.data.title, '交实验报告');
  assert.equal(json.data.done, 0);
  assert.equal(json.data.due, '2026-11-25');
  assert.ok(json.data.id > 0);
});

test('POST 少传 title 返回 400，并且服务不崩', async () => {
  const { status, json } = await call('/api/items', { method: 'POST', body: { due: '2026-11-25' } });
  assert.equal(status, 400);
  assert.equal(json.code, 40001);
  assert.match(json.msg, /title/);

  // 关键：出错之后服务还活着
  const health = await call('/api/health');
  assert.equal(health.status, 200);
});

test('POST due 格式错误返回 400', async () => {
  const { status, json } = await call('/api/items', { method: 'POST', body: { title: 'x', due: '2026/11/25' } });
  assert.equal(status, 400);
  assert.equal(json.code, 40004);
});

test('PUT 修改 done 与 title', async () => {
  const created = await call('/api/items', { method: 'POST', body: { title: '复习复变' } });
  const id = created.json.data.id;

  const updated = await call(`/api/items/${id}`, { method: 'PUT', body: { done: 1 } });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.data.done, 1);

  const renamed = await call(`/api/items/${id}`, { method: 'PUT', body: { title: '复习复变第 3 章' } });
  assert.equal(renamed.json.data.title, '复习复变第 3 章');
  assert.equal(renamed.json.data.done, 1, '没传 done 时不能被重置');
});

test('PATCH 等价于 PUT（前端勾选用它）', async () => {
  const created = await call('/api/items', { method: 'POST', body: { title: '小组会' } });
  const id = created.json.data.id;
  const patched = await call(`/api/items/${id}`, { method: 'PATCH', body: { done: 1 } });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.data.done, 1);
});

test('PUT 空 body 返回 400', async () => {
  const created = await call('/api/items', { method: 'POST', body: { title: '空更新' } });
  const { status, json } = await call(`/api/items/${created.json.data.id}`, { method: 'PUT', body: {} });
  assert.equal(status, 400);
  assert.equal(json.code, 40006);
});

test('DELETE 删除成功，再删一次返回 404', async () => {
  const created = await call('/api/items', { method: 'POST', body: { title: '待删除' } });
  const id = created.json.data.id;

  const first = await call(`/api/items/${id}`, { method: 'DELETE' });
  assert.equal(first.status, 200);
  assert.equal(first.json.data.id, id);

  const second = await call(`/api/items/${id}`, { method: 'DELETE' });
  assert.equal(second.status, 404);
  assert.equal(second.json.code, 40401);
});

test('id 不合法返回 400 而不是 500', async () => {
  const { status, json } = await call('/api/items/abc', { method: 'DELETE' });
  assert.equal(status, 400);
  assert.equal(json.code, 40002);
});

test('GET ?fail=1 的开发开关返回 500 JSON', async () => {
  const { status, json } = await call('/api/items?fail=1');
  assert.equal(status, 500);
  assert.equal(json.code, 50001);
  assert.equal(json.data, null);
});

test('未知接口返回 JSON 404，不掉进 HTML', async () => {
  const { status, json } = await call('/api/not-exist');
  assert.equal(status, 404);
  assert.equal(json.code, 40400);
});

test('stats 统计与列表一致', async () => {
  const stats = (await call('/api/items/stats')).json.data;
  const list = (await call('/api/items')).json.data.items;
  assert.equal(stats.total, list.length);
  assert.equal(Number(stats.done) + Number(stats.pending), Number(stats.total));
});

test('对话接口：一句话 -> 真的调了工具 -> 数据库真的多了一条', async () => {
  const before = (await call('/api/items')).json.data.total;

  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: 't-chat', message: '帮我加一条明天交实验报告' }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);

  const text = await res.text();
  const events = text
    .split('\n\n')
    .map((chunk) => chunk.split('\n').find((l) => l.startsWith('data:')))
    .filter(Boolean)
    .map((line) => JSON.parse(line.slice(5)));

  const toolCall = events.find((e) => e.type === 'tool_call');
  assert.ok(toolCall, '应当有 tool_call 事件');
  assert.equal(toolCall.name, 'add_item');
  assert.equal(toolCall.args.title, '明天交实验报告');

  const toolResult = events.find((e) => e.type === 'tool_result');
  assert.equal(toolResult.result.ok, true);

  assert.equal(events.at(-1).type, 'done');

  const after = (await call('/api/items')).json.data;
  assert.equal(after.total, before + 1, '数据库必须真的多一条');
  assert.ok(after.items.some((i) => i.title === '明天交实验报告'));
});

// 任务 4 要求「连续 3 轮上下文」：用同一 sessionId 连说三句，第四句问第一句说了什么
test('连续多轮：第 4 轮能引用第 1 轮的内容', async () => {
  const ask = async (message) => {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 't-ctx', message }),
    });
    const text = await res.text();
    return text
      .split('\n\n')
      .map((c) => c.split('\n').find((l) => l.startsWith('data:')))
      .filter(Boolean)
      .map((l) => JSON.parse(l.slice(5)))
      .filter((e) => e.type === 'delta')
      .map((e) => e.text)
      .join('');
  };

  await ask('帮我加一条明天交实验报告');
  await ask('再帮我加一条周五复习复变函数');
  await ask('我还有哪些没做完');
  const reply = await ask('我刚才第一句说了什么');

  assert.match(reply, /实验报告/, `第 4 轮应当引用第 1 轮，实际回复：${reply}`);
});

// 「把它勾掉」这种代词需要上下文才能消解
test('代词指代：说「把它勾掉」能完成最近新增的那条', async () => {
  const created = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: 't-pron', message: '帮我加一条还图书馆的书' }),
  }).then((r) => r.text());
  assert.match(created, /add_item/);

  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: 't-pron', message: '把它勾掉' }),
  });
  const text = await res.text();
  assert.match(text, /complete_item/, '应当调用 complete_item');

  const items = (await call('/api/items')).json.data.items;
  const target = items.find((i) => i.title.includes('还图书馆'));
  assert.equal(target.done, 1);
});

// 接口自动化测试：不连真实模型（MOCK_AI=1），只验证「接口契约 + 数据真的落库」。
// 运行：npm test
//
// 在链路里的位置：这是整条 HTTP 链路的黑盒测试——起一个真的 app、真的监听端口，
// 用 fetch 打过去，断言「路由 + 校验 + 错误中间件 + 数据层」合起来的表现。
// 与 worker 版的差异：这里测的是 Express 后端；Worker 起不了本地服务，那边只做语法检查。
import test from 'node:test';
import assert from 'node:assert/strict';

// 必须在 import 服务端代码之前设好：config.js 一加载就会读这几个变量。
// DB_FILE=':memory:' 让这次运行用一个全新的内存库，不碰 data/app.db，
// 也不会把开发时的数据写脏、跑完自动消失，测试可以反复跑。
process.env.DB_FILE = ':memory:';
// mock 模式：工具调用走规则匹配，不需要真 Key、不花钱、结果可复现
process.env.MOCK_AI = '1';
process.env.NODE_ENV = 'development';

// 用 await import 而不是顶部静态 import：静态 import 会被提升到文件最前面，
// 那样环境变量还没赋值，db.js 就已经按默认路径把真实数据库打开了
const { createApp } = await import('../server/app.js');

const app = createApp();
// 端口传 0 = 让系统挑一个空闲端口，不会和本机 3000 的开发服务抢
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

// 测试结束关掉监听，否则 node 进程会一直挂着不退出
test.after(() => server.close());

// 统一请求小工具：只回 { status, json }，让用例能同时断言 HTTP 状态码和业务 code
const call = async (path, { method = 'GET', body } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // 服务端正常都回 JSON；万一掉进 HTML 错误页，catch 成 null 让断言更早炸出来
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
};

// 健康检查是部署平台和验收脚本的第一个探针：200 + code 0，还要能看出当前是 mock 模式
test('GET /api/health 返回运行状态', async () => {
  const { status, json } = await call('/api/health');
  assert.equal(status, 200);
  assert.equal(json.code, 0);
  assert.equal(json.data.status, 'up');
  assert.equal(json.data.mode, 'mock');
});

// 内存库刚建好，列表必须是空数组：顺带验证查询没被上一个用例的数据污染
test('GET /api/items 初始为空列表', async () => {
  const { status, json } = await call('/api/items');
  assert.equal(status, 200);
  assert.deepEqual(json.data.items, []);
});

// 正常创建：断言返回整个条目（id/title/done/due 都在），前端拿到就能直接渲染
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

// 少传必填字段是最常见的客户端 bug：必须 400 + 40001 + 提示里带字段名，
// 而且错完之后服务还得活着——所以紧接着再打一次 health 当证据。
// 校验失败属于预期路径，不该变成 500，更不该把进程带走。
test('POST 少传 title 返回 400，并且服务不崩', async () => {
  const { status, json } = await call('/api/items', { method: 'POST', body: { due: '2026-11-25' } });
  assert.equal(status, 400);
  assert.equal(json.code, 40001);
  assert.match(json.msg, /title/);

  // 关键：出错之后服务还活着
  const health = await call('/api/health');
  assert.equal(health.status, 200);
});

// 只认 YYYY-MM-DD：'2026/11/25' 这类必须在入库前挡掉，用 40004 和缺字段区分开
test('POST due 格式错误返回 400', async () => {
  const { status, json } = await call('/api/items', { method: 'POST', body: { title: 'x', due: '2026/11/25' } });
  assert.equal(status, 400);
  assert.equal(json.code, 40004);
});

// PUT 是部分更新：只传 done 不能把 title 冲掉，只传 title 也不能把 done 重置
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

// PATCH 和 PUT 等价：前端勾选复选框时发的是 PATCH，两条路径行为必须一致
test('PATCH 等价于 PUT（前端勾选用它）', async () => {
  const created = await call('/api/items', { method: 'POST', body: { title: '小组会' } });
  const id = created.json.data.id;
  const patched = await call(`/api/items/${id}`, { method: 'PATCH', body: { done: 1 } });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.data.done, 1);
});

// 一个字段都没传的 PUT 没有意义：明确回 40006，别静默 200 让人以为改了
test('PUT 空 body 返回 400', async () => {
  const created = await call('/api/items', { method: 'POST', body: { title: '空更新' } });
  const { status, json } = await call(`/api/items/${created.json.data.id}`, { method: 'PUT', body: {} });
  assert.equal(status, 400);
  assert.equal(json.code, 40006);
});

// 删除要回被删掉的那一条；再删一次必须 404，不能是 200 的假成功
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

// 路径 id 不是数字要走 400：'abc' 直接进 SQL 会让驱动抛错，最后变成 500
test('id 不合法返回 400 而不是 500', async () => {
  const { status, json } = await call('/api/items/abc', { method: 'DELETE' });
  assert.equal(status, 400);
  assert.equal(json.code, 40002);
});

// ?fail=1 是开发时故意制造失败的开关：验证前端错误分支拿到的是 JSON，不会是 HTML
test('GET ?fail=1 的开发开关返回 500 JSON', async () => {
  const { status, json } = await call('/api/items?fail=1');
  assert.equal(status, 500);
  assert.equal(json.code, 50001);
  assert.equal(json.data, null);
});

// 未知 /api 路径必须回 JSON 404（40400），前端 res.json() 才不会解析失败
test('未知接口返回 JSON 404，不掉进 HTML', async () => {
  const { status, json } = await call('/api/not-exist');
  assert.equal(status, 404);
  assert.equal(json.code, 40400);
});

// stats 是页面上「共 N 条 / 待办 M 条」的来源，必须和列表查询的结果完全对得上
test('stats 统计与列表一致', async () => {
  const stats = (await call('/api/items/stats')).json.data;
  const list = (await call('/api/items')).json.data.items;
  assert.equal(stats.total, list.length);
  assert.equal(Number(stats.done) + Number(stats.pending), Number(stats.total));
});

// 对话接口：一句话 -> 真的调了工具 -> 数据库真的多了一条
// 这是整条 AI 链路的核心契约：模型不能只「答应」，必须真的调 add_item 把数据写进去
test('对话接口：一句话 -> 真的调了工具 -> 数据库真的多了一条', async () => {
  // 先记下当前总数，后面用差值证明是新写的一条，而不是老数据
  const before = (await call('/api/items')).json.data.total;

  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: 't-chat', message: '帮我加一条明天交实验报告' }),
  });
  // 先确认响应真的是流：content-type 不对的话，后面按 SSE 解析就没意义了
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);

  // 按 \n\n 切：SSE 一条事件以空行结束；
  // 每块里可能有 event:/id:/注释行，只挑 data: 那行，再切掉 5 个字符的前缀
  const text = await res.text();
  const events = text
    .split('\n\n')
    .map((chunk) => chunk.split('\n').find((l) => l.startsWith('data:')))
    .filter(Boolean) // 心跳/空块没有 data: 行，先滤掉，否则下一步 JSON.parse 会崩
    .map((line) => JSON.parse(line.slice(5)));

  // 断言工具名和参数：证明「帮我加一条」这类指令词没进库，标题被清洗过了
  const toolCall = events.find((e) => e.type === 'tool_call');
  assert.ok(toolCall, '应当有 tool_call 事件');
  assert.equal(toolCall.name, 'add_item');
  assert.equal(toolCall.args.title, '明天交实验报告');

  // 工具返回 ok:true 才算真的写库成功，而不是模型嘴上说了一句成功
  const toolResult = events.find((e) => e.type === 'tool_result');
  assert.equal(toolResult.result.ok, true);

  // 最后一条必须是 done：前端靠它收尾、关掉 loading 状态
  assert.equal(events.at(-1).type, 'done');

  // 光看事件不够，还要回查列表：数据库真的多了一条同名记录才算过
  const after = (await call('/api/items')).json.data;
  assert.equal(after.total, before + 1, '数据库必须真的多一条');
  assert.ok(after.items.some((i) => i.title === '明天交实验报告'));
});

// 任务 4 要求「连续 3 轮上下文」：用同一 sessionId 连说三句，第四句问第一句说了什么
// 同一个 sessionId 才会共享历史；worker 版对应的就是 D1 里的 chat_messages 表
test('连续多轮：第 4 轮能引用第 1 轮的内容', async () => {
  const ask = async (message) => {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 't-ctx', message }),
    });
    const text = await res.text();
    // 只拼 delta：tool_call/tool_result/meta 都是过程事件，这里只关心文字回复
    return text
      .split('\n\n')
      .map((c) => c.split('\n').find((l) => l.startsWith('data:')))
      .filter(Boolean)
      .map((l) => JSON.parse(l.slice(5)))
      .filter((e) => e.type === 'delta')
      .map((e) => e.text)
      .join('');
  };

  // 四句话共用 't-ctx' 这个 sessionId，历史才连得上
  await ask('帮我加一条明天交实验报告');
  await ask('再帮我加一条周五复习复变函数');
  await ask('我还有哪些没做完');
  const reply = await ask('我刚才第一句说了什么');

  // 回复里提到「实验报告」，说明第 1 轮真的进了上下文，模型不是每轮从零开始
  assert.match(reply, /实验报告/, `第 4 轮应当引用第 1 轮，实际回复：${reply}`);
});

// 「把它勾掉」这种代词需要上下文才能消解
// 验证的是历史不仅存下来了，还被真的回填进了模型上下文，否则模型不知道「它」指谁
test('代词指代：说「把它勾掉」能完成最近新增的那条', async () => {
  const created = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: 't-pron', message: '帮我加一条还图书馆的书' }),
  }).then((r) => r.text());
  // 先确认「新增」走的是工具调用，不是模型嘴上答应
  assert.match(created, /add_item/);

  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: 't-pron', message: '把它勾掉' }),
  });
  const text = await res.text();
  assert.match(text, /complete_item/, '应当调用 complete_item');

  // 最终以数据库为准：done 变成 1 才算完成，事件里出现 complete_item 还不够
  const items = (await call('/api/items')).json.data.items;
  const target = items.find((i) => i.title.includes('还图书馆'));
  assert.equal(target.done, 1);
});

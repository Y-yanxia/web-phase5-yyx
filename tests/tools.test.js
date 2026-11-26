// 工具层单元测试：不经过 HTTP，直接验证 JSON Schema 执行器的边界。
// 运行：node tests/tools.test.js
//
// 在链路里的位置：这一层是「模型说要调 → 服务端真的做」的落地点，
// 上面是 chat.js 的 tool_calls，下面是 db.js；跳过 HTTP 直连，出错定位最快。
// 与 worker 版的差异：测的是 server/ai/tools.js 的同步版。worker/tools.js 逐行对齐，
// 但执行器是 async、又起不了本地 Worker 进程，那边只做 node --check。
process.env.DB_FILE = ':memory:';
process.env.MOCK_AI = '1';

// 用 await import 而不是顶部静态 import：静态 import 会被提升到文件最前面，
// 那样环境变量还没赋值，db.js 就已经按默认路径把真实数据库打开了
const { executeTool, TOOL_DEFINITIONS } = await import('../server/ai/tools.js');
const { clearAllItems, listItems } = await import('../server/db.js');

import test from 'node:test';
import assert from 'node:assert/strict';

// 每个用例前清空表：用例之间不共享数据，单独跑某一条也能过
test.beforeEach(() => clearAllItems());

// 工具清单是模型能看到的全部能力：数量、名字、描述长度都锁住，以后改动先被这里拦住
test('工具定义里有 3 个工具，且都带 required 之外的描述', () => {
  assert.equal(TOOL_DEFINITIONS.length, 3);
  const names = TOOL_DEFINITIONS.map((t) => t.function.name).sort();
  assert.deepEqual(names, ['add_item', 'complete_item', 'query_items']);
  for (const t of TOOL_DEFINITIONS) {
    // 描述太短模型就判断不出什么时候该调，20 字是这条契约的底线
    assert.ok(t.function.description.length > 20, `${t.function.name} 的 description 太短`);
  }
});

// 正常新增：要真写库（下面 listItems 能查到），并返回 id 和规范化后的 due
test('add_item 真的写库，返回 id 和标题', () => {
  const r = executeTool('add_item', { title: '交实验报告', due: '2026-11-25' });
  assert.equal(r.ok, true);
  assert.ok(r.data.id > 0);
  assert.equal(r.data.due, '2026-11-25');
  assert.equal(listItems().length, 1);
});

// 脏输入不崩：空标题回 ok:false + 可读 error，同时库里不能多出一条脏数据
test('add_item 标题为空时返回失败而不是抛异常', () => {
  const r = executeTool('add_item', { title: '   ' });
  assert.equal(r.ok, false);
  assert.match(r.error, /title/);
  assert.equal(listItems().length, 0);
});

// done 过滤：0 只看未完成、1 只看已完成，两边加起来正好等于总数
test('query_items 按 done 过滤', () => {
  executeTool('add_item', { title: 'A' });
  executeTool('add_item', { title: 'B' });
  const b = executeTool('add_item', { title: 'C' });
  executeTool('complete_item', { keyword: 'C' });

  const open = executeTool('query_items', { done: 0 });
  const done = executeTool('query_items', { done: 1 });

  assert.equal(open.data.total, 2);
  assert.equal(done.data.total, 1);
  assert.equal(done.data.items[0].id, b.data.id);
});

// 关键词走 SQL 的 LIKE，ASCII 大小写不敏感：搜 'math' 能命中 'Math'
test('query_items 按关键词过滤，不区分大小写的外文也能搜', () => {
  executeTool('add_item', { title: '复习 Math 第三章' });
  executeTool('add_item', { title: '交实验报告' });
  const r = executeTool('query_items', { keyword: 'math' });
  assert.equal(r.data.total, 1);
});

// 多条命中取最新（id 最大），summary 里要说明命中几条，避免「悄悄改错」
test('complete_item 命中最新的那条，并说明命中了几条', () => {
  executeTool('add_item', { title: '交物理实验报告' });
  const second = executeTool('add_item', { title: '交数据结构实验报告' });
  const r = executeTool('complete_item', { keyword: '实验报告' });

  assert.equal(r.ok, true);
  assert.equal(r.data.id, second.data.id, '多条命中时完成最新一条');
  assert.match(r.summary, /命中 2 条/);
});

// 找不到不是异常：回 ok:false + 可读原因，模型才能据此向用户解释
test('complete_item 找不到时给出可读原因', () => {
  const r = executeTool('complete_item', { keyword: '不存在的事' });
  assert.equal(r.ok, false);
  assert.match(r.error, /没有找到/);
});

// 模型可能编出不存在的工具名：默认分支必须兜住，回明确错误而不是抛异常
test('未知工具不崩，返回明确错误', () => {
  const r = executeTool('drop_database', {});
  assert.equal(r.ok, false);
  assert.match(r.error, /未知工具/);
});

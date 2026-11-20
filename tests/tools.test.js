// 工具层单元测试：不经过 HTTP，直接验证 JSON Schema 执行器的边界。
// 运行：node tests/tools.test.js
process.env.DB_FILE = ':memory:';
process.env.MOCK_AI = '1';

const { executeTool, TOOL_DEFINITIONS } = await import('../server/ai/tools.js');
const { clearAllItems, listItems } = await import('../server/db.js');

import test from 'node:test';
import assert from 'node:assert/strict';

test.beforeEach(() => clearAllItems());

test('工具定义里有 3 个工具，且都带 required 之外的描述', () => {
  assert.equal(TOOL_DEFINITIONS.length, 3);
  const names = TOOL_DEFINITIONS.map((t) => t.function.name).sort();
  assert.deepEqual(names, ['add_item', 'complete_item', 'query_items']);
  for (const t of TOOL_DEFINITIONS) {
    assert.ok(t.function.description.length > 20, `${t.function.name} 的 description 太短`);
  }
});

test('add_item 真的写库，返回 id 和标题', () => {
  const r = executeTool('add_item', { title: '交实验报告', due: '2026-11-25' });
  assert.equal(r.ok, true);
  assert.ok(r.data.id > 0);
  assert.equal(r.data.due, '2026-11-25');
  assert.equal(listItems().length, 1);
});

test('add_item 标题为空时返回失败而不是抛异常', () => {
  const r = executeTool('add_item', { title: '   ' });
  assert.equal(r.ok, false);
  assert.match(r.error, /title/);
  assert.equal(listItems().length, 0);
});

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

test('query_items 按关键词过滤，不区分大小写的外文也能搜', () => {
  executeTool('add_item', { title: '复习 Math 第三章' });
  executeTool('add_item', { title: '交实验报告' });
  const r = executeTool('query_items', { keyword: 'math' });
  assert.equal(r.data.total, 1);
});

test('complete_item 命中最新的那条，并说明命中了几条', () => {
  executeTool('add_item', { title: '交物理实验报告' });
  const second = executeTool('add_item', { title: '交数据结构实验报告' });
  const r = executeTool('complete_item', { keyword: '实验报告' });

  assert.equal(r.ok, true);
  assert.equal(r.data.id, second.data.id, '多条命中时完成最新一条');
  assert.match(r.summary, /命中 2 条/);
});

test('complete_item 找不到时给出可读原因', () => {
  const r = executeTool('complete_item', { keyword: '不存在的事' });
  assert.equal(r.ok, false);
  assert.match(r.error, /没有找到/);
});

test('未知工具不崩，返回明确错误', () => {
  const r = executeTool('drop_database', {});
  assert.equal(r.ok, false);
  assert.match(r.error, /未知工具/);
});

// 给远端（FC / 任意部署）灌演示数据：先清空，再插入 6 条有代表性的
// 用法：node scripts/seed-remote.mjs https://xxx.fcapp.run
const base = (process.argv[2] || 'http://127.0.0.1:3100').replace(/\/+$/, '');

const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

const rows = [
  ['交数据结构实验报告', 0, day(1)],
  ['复习复变函数第 3 章', 0, day(3)],
  ['小组会：定下周分工', 0, day(0)],
  ['把课程表同步到日历', 1, null],
  ['还图书馆借的《深入理解计算机系统》', 0, day(-2)],
  ['给社团公众号排版', 1, day(-1)],
];

const api = async (path, opts = {}) => {
  const res = await fetch(base + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.code !== 0) throw new Error(`${path} -> ${res.status} ${JSON.stringify(body)}`);
  return body.data;
};

console.log('目标', base);
const before = await api('/api/items');
for (const item of before.items) {
  await api(`/api/items/${item.id}`, { method: 'DELETE' });
}
console.log('已清空', before.items.length, '条');

for (const [title, done, due] of rows) {
  const payload = { title };
  if (due) payload.due = due;
  const created = await api('/api/items', { method: 'POST', body: JSON.stringify(payload) });
  if (done) await api(`/api/items/${created.id}`, { method: 'PATCH', body: JSON.stringify({ done: 1 }) });
  console.log(' +', created.id, title, done ? '(已完成)' : '');
}

const after = await api('/api/items');
console.log('完成：', after.total, '条');

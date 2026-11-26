// 给远端（FC / 任意部署）灌演示数据：先清空，再插入 6 条有代表性的
// 用法：node scripts/seed-remote.mjs https://xxx.fcapp.run
//
// 解决什么问题：远端（函数计算 / 隧道 / 云主机）没有本地库文件可改，
// 只能走 HTTP 接口一条条灌；这个脚本把远端数据摆成和本地演示一样。
//
// 用法：
// node scripts/seed-remote.mjs https://xxx.fcapp.run
// 不带参数就打本机 http://127.0.0.1:3100
//
// 前置条件：目标后端活着、本机能访问到；脚本只发请求，不需要本地起服务。
// 产物：目标端的 items 表（6 条），终端打印清空条数和最终总数。
const base = (process.argv[2] || 'http://127.0.0.1:3100').replace(/\/+$/, '');

// 日期算成 YYYY-MM-DD：和接口、前端约定一致，跨时区也不会差一天
const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

// 和本地 seed 用同一组数据：两边截图放一起看不出差别
const rows = [
  ['交数据结构实验报告', 0, day(1)],
  ['复习复变函数第 3 章', 0, day(3)],
  ['小组会：定下周分工', 0, day(0)],
  ['把课程表同步到日历', 1, null],
  ['还图书馆借的《深入理解计算机系统》', 0, day(-2)],
  ['给社团公众号排版', 1, day(-1)],
];

// 统一走这个封装：HTTP 200 但 code 不是 0 也算失败，立刻抛出来
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
// 为什么先清空：远端是长期在跑的服务，历次 demo 的脏数据会让条数对不上；
// 重复跑脚本还会翻倍，先清后插，截图里的数字才和说明一致。
const before = await api('/api/items');
// 逐条删而不是重建：远端没有库文件权限，只能老老实实走接口
for (const item of before.items) {
  await api(`/api/items/${item.id}`, { method: 'DELETE' });
}
console.log('已清空', before.items.length, '条');

for (const [title, done, due] of rows) {
  // 没有截止日期就不带 due：少塞一个空字段，服务端和日志里都干净
  const payload = { title };
  if (due) payload.due = due;
  const created = await api('/api/items', { method: 'POST', body: JSON.stringify(payload) });
  // done 单独 PATCH：创建接口只收 title/due，勾选要走更新接口
  if (done) await api(`/api/items/${created.id}`, { method: 'PATCH', body: JSON.stringify({ done: 1 }) });
  // 每条打一行：远端慢的时候，能看出卡在哪一条上
  console.log(' +', created.id, title, done ? '(已完成)' : '');
}

// 最后再查一次：确认真的落了 6 条，而不是请求报错被吞掉
const after = await api('/api/items');
console.log('完成：', after.total, '条');

// 演示数据：把库清空后插入一组「有说服力」的条目（逾期 / 今天 / 明天 / 已完成）。
// 用法：node scripts/seed.mjs
//
// 解决什么问题：空库截图没内容、AI 也问不出东西；这个脚本把库摆成
// 「逾期 / 今天 / 未来 / 已完成」都有的样子，一屏能讲完所有状态。
//
// 用法（在项目根目录）：
// node scripts/seed.mjs        # 等同于 npm run seed
//
// 前置条件：Node 24（node:sqlite 是内置的）；表结构建好——跑过一次 npm start 即可；
// 服务在跑也能写（WAL 模式），但前端要刷新才看得到新数据。
// 产物：直接改 data/app.db，终端打印插入条数；不产生别的文件。
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// 直接写库文件：绕开接口，一次把状态摆成想要的样子，列表页立刻好看
const dbFile = path.resolve('data/app.db');
// node:sqlite 是 Node 24 内置的：不装原生依赖，换机器也不会装不上
const db = new DatabaseSync(dbFile);

// 日期统一算成 YYYY-MM-DD：接口和前端都按这个格式比，别自己写别的
const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

// 先清空再插：重复跑不会越插越多，截图里的条数永远是固定的 6 条
db.exec('DELETE FROM items');
// 预编译一条 INSERT：循环里只换参数，比每次拼 SQL 快也更安全
// created_at 交给 SQLite 本地时间：和 server/db.js 的默认值保持一致
const insert = db.prepare(
  "INSERT INTO items (title, done, due, created_at) VALUES (?, ?, ?, datetime('now','localtime'))"
);

// 六条覆盖四种状态：逾期、今天、未完成、已完成，答辩一屏能讲完
const rows = [
  ['交数据结构实验报告', 0, day(1)],
  ['复习复变函数第 3 章', 0, day(3)],
  ['小组会：定下周分工', 0, day(0)],
  ['把课程表同步到日历', 1, null],
  ['还图书馆借的《深入理解计算机系统》', 0, day(-2)],
  ['给社团公众号排版', 1, day(-1)],
];

// 一条条插：出错时能看出是哪条，比一条大 INSERT 好排查
for (const [title, done, due] of rows) insert.run(title, done, due);

// 打印条数和路径：确认写的是哪个库，别把数据灌到别处去了
console.log('seeded', rows.length, 'items ->', dbFile);

// 演示数据：把库清空后插入一组「有说服力」的条目（逾期 / 今天 / 明天 / 已完成）。
// 用法：node scripts/seed.mjs
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dbFile = path.resolve('data/app.db');
const db = new DatabaseSync(dbFile);

const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

db.exec('DELETE FROM items');
const insert = db.prepare(
  "INSERT INTO items (title, done, due, created_at) VALUES (?, ?, ?, datetime('now','localtime'))"
);

const rows = [
  ['交数据结构实验报告', 0, day(1)],
  ['复习复变函数第 3 章', 0, day(3)],
  ['小组会：定下周分工', 0, day(0)],
  ['把课程表同步到日历', 1, null],
  ['还图书馆借的《深入理解计算机系统》', 0, day(-2)],
  ['给社团公众号排版', 1, day(-1)],
];

for (const [title, done, due] of rows) insert.run(title, done, due);

console.log('seeded', rows.length, 'items ->', dbFile);

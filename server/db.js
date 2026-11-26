/**
 * 数据层：建表、预编译语句、以及清单的全部读写，全走 Node 内置的 node:sqlite。
 * 链路位置：routes/items.js 和 ai/tools.js 都只调这里，其他文件不写 SQL。
 * 对外导出：db 句柄，以及 listItems/getItem/createItem/updateItem/
 * deleteItem/getStats/clearAllItems。
 * 坑：SQLite 没有布尔类型，done 统一用 0/1；开 WAL 后目录里会多出
 * -wal/-shm 文件，属于正常现象，别当成脏文件删了。
 */
// 数据层：只用 Node 24 内置的 node:sqlite，不装 better-sqlite3。
// [讲解点] 内置模块不需要编译原生代码，Render 那种免费容器里不会因为
// python/gyp 缺失而装包失败——这是上一版踩过、这一版直接绕开的坑。
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

// 首次启动时 data/ 可能还不存在，先递归建目录，不然打开库文件会失败
if (config.dbFile !== ':memory:') {
  fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
}

// 同步 API：Express 单线程用着最省心，查询都是毫秒级，不会真的堵住事件循环
export const db = new DatabaseSync(config.dbFile);

// WAL：读写不互相阻塞，SSE 长连接占着时也能正常增删
// busy_timeout：锁冲突最多等 3 秒再报错，别立刻抛 SQLITE_BUSY
// created_at 存 localtime：前端拿来直接展示，不用再换算时区
// done 是列表最常用的过滤条件，顺手建个索引（数据量小的时候可有可无）
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 3000;
  CREATE TABLE IF NOT EXISTS items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT    NOT NULL,
    done       INTEGER NOT NULL DEFAULT 0,
    due        TEXT,
    created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_items_done ON items(done);
`);

// 启动时一次性预编译：省掉每次解析 SQL 的开销，参数化也顺带防住注入
const stmt = {
  // :done / :q 传 null 就表示「不过滤」，一条语句覆盖全部/只看完成/只看未完成
  // 排序：未完成的排前面，同组内最新的在前
  list: db.prepare(`
    SELECT id, title, done, due, created_at
    FROM items
    WHERE (:done IS NULL OR done = :done)
      AND (:q IS NULL OR title LIKE :like)
    ORDER BY done ASC, id DESC
    LIMIT :limit
  `),
  get: db.prepare('SELECT id, title, done, due, created_at FROM items WHERE id = ?'),
  insert: db.prepare(
    'INSERT INTO items (title, done, due) VALUES (?, 0, ?) RETURNING id, title, done, due, created_at'
  ),
  remove: db.prepare('DELETE FROM items WHERE id = ?'),
  // COALESCE 兜底：空表时 SUM 是 null，前端拿到 null 会显示成空白
  stats: db.prepare(`
    SELECT
      COUNT(*)                                             AS total,
      COALESCE(SUM(CASE WHEN done = 1 THEN 1 ELSE 0 END), 0) AS done,
      COALESCE(SUM(CASE WHEN done = 0 THEN 1 ELSE 0 END), 0) AS pending
    FROM items
  `),
  clear: db.prepare('DELETE FROM items'),
};

// SQLite 没有布尔类型，进出都统一转成 0/1，前端不用做二次判断
// due 的 undefined 统一成 null，前端拿到的字段类型才稳定
const normalize = (row) =>
  row ? { ...row, done: row.done ? 1 : 0, due: row.due ?? null } : null;

// 查列表：done 为 null 查全部，q 为空不筛标题，limit 有硬上限
export function listItems({ done = null, q = '', limit = 200 } = {}) {
  const rows = stmt.list.all({
    done,
    // q 空串要转成 null，否则 :q IS NULL 不成立，结果会变成「一条都查不到」
    q: q || null,
    like: q ? `%${q}%` : null,
    // 夹到 1~500：前端传 0、负数或 999999 都不会出事
    limit: Math.min(Math.max(Number(limit) || 200, 1), 500),
  });
  return rows.map(normalize);
}

// 主键查一条：找不到返回 null，由路由层决定是 404 还是忽略
export function getItem(id) {
  return normalize(stmt.get.get(Number(id)));
}

// 新增：title 必填已在上层校验，这里再 trim 一次兜底；done 固定从 0 开始
export function createItem({ title, due = null }) {
  return normalize(stmt.insert.get(String(title).trim(), due ? String(due).trim() : null));
}

// 只更新传进来的字段：undefined 表示「没提这个字段」，要原样保留
// 做法是先读当前行再合并，只改 patch 里出现的字段，避免整行被覆盖
export function updateItem(id, patch = {}) {
  const current = getItem(id);
  if (!current) return null;

  const next = {
    // 用 !== undefined 判断而不是真值判断：空字符串是用户真的传了空值，该被校验拦住
    title: patch.title !== undefined ? String(patch.title).trim() : current.title,
    done: patch.done !== undefined ? (patch.done ? 1 : 0) : current.done,
    // due 传 null 或空串都按「清空截止日期」处理，前端清空日期框就是发 ''
    due: patch.due !== undefined ? (patch.due ? String(patch.due).trim() : null) : current.due,
  };

  // 三个字段固定整行更新，不动态拼 SQL，省心也不容易出注入
  db.prepare('UPDATE items SET title = ?, done = ?, due = ? WHERE id = ?').run(
    next.title,
    next.done,
    next.due,
    current.id
  );
  return getItem(current.id);
}

// 先读后删：返回被删的那条，路由层靠它区分「删掉了」和「本来就没有」
export function deleteItem(id) {
  const current = getItem(id);
  if (!current) return null;
  stmt.remove.run(current.id);
  return current;
}

// 统计：和列表同一张表，口径自然一致；COALESCE 保证空表时是 0 而不是 null
export function getStats() {
  return stmt.stats.get();
}

// 仅测试用：每个用例之间清空，避免互相污染
export function clearAllItems() {
  stmt.clear.run();
}

// 默认导出把 db 和常用方法打成一包，测试里也可以按需具名引入
export default { db, listItems, getItem, createItem, updateItem, deleteItem, getStats, clearAllItems };

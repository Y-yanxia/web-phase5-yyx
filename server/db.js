// 数据层：只用 Node 24 内置的 node:sqlite，不装 better-sqlite3。
// [讲解点] 内置模块不需要编译原生代码，Render 那种免费容器里不会因为
// python/gyp 缺失而装包失败——这是上一版踩过、这一版直接绕开的坑。
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

if (config.dbFile !== ':memory:') {
  fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
}

export const db = new DatabaseSync(config.dbFile);

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

const stmt = {
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
const normalize = (row) =>
  row ? { ...row, done: row.done ? 1 : 0, due: row.due ?? null } : null;

export function listItems({ done = null, q = '', limit = 200 } = {}) {
  const rows = stmt.list.all({
    done,
    q: q || null,
    like: q ? `%${q}%` : null,
    limit: Math.min(Math.max(Number(limit) || 200, 1), 500),
  });
  return rows.map(normalize);
}

export function getItem(id) {
  return normalize(stmt.get.get(Number(id)));
}

export function createItem({ title, due = null }) {
  return normalize(stmt.insert.get(String(title).trim(), due ? String(due).trim() : null));
}

// 只更新传进来的字段：undefined 表示「没提这个字段」，要原样保留
export function updateItem(id, patch = {}) {
  const current = getItem(id);
  if (!current) return null;

  const next = {
    title: patch.title !== undefined ? String(patch.title).trim() : current.title,
    done: patch.done !== undefined ? (patch.done ? 1 : 0) : current.done,
    due: patch.due !== undefined ? (patch.due ? String(patch.due).trim() : null) : current.due,
  };

  db.prepare('UPDATE items SET title = ?, done = ?, due = ? WHERE id = ?').run(
    next.title,
    next.done,
    next.due,
    current.id
  );
  return getItem(current.id);
}

export function deleteItem(id) {
  const current = getItem(id);
  if (!current) return null;
  stmt.remove.run(current.id);
  return current;
}

export function getStats() {
  return stmt.stats.get();
}

// 仅测试用：每个用例之间清空，避免互相污染
export function clearAllItems() {
  stmt.clear.run();
}

export default { db, listItems, getItem, createItem, updateItem, deleteItem, getStats, clearAllItems };

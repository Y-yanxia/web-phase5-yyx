-- Cloudflare D1 初始化脚本
-- 本地：npx wrangler d1 execute onelist --local --file=worker/schema.sql
-- 线上：npx wrangler d1 execute onelist --remote --file=worker/schema.sql

CREATE TABLE IF NOT EXISTS items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT    NOT NULL,
  done       INTEGER NOT NULL DEFAULT 0,
  due        TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_items_done ON items(done);

-- 对话历史落 D1：Worker 是无状态的，不能像本机那样放内存 Map
CREATE TABLE IF NOT EXISTS chat_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT    NOT NULL,
  role       TEXT    NOT NULL,
  content    TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(session_id, id);

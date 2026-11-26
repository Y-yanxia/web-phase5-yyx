-- Cloudflare D1 初始化脚本
-- 本地：npx wrangler d1 execute onelist --local --file=worker/schema.sql
-- 线上：npx wrangler d1 execute onelist --remote --file=worker/schema.sql
--
-- 在链路里的位置：worker/db.js 里所有 SQL 都默认这两张表已存在，
-- 所以部署前必须先跑一遍这个文件（.github/workflows/worker.yml 就是这么排的）。
-- 与 Express 版的差异：那边启动时 db.exec() 顺手建表；D1 的表结构得单独用 wrangler 建。
-- IF NOT EXISTS 让脚本可以重复执行，不会因为表已存在而中断。

-- 待办条目：done 用 0/1 存，SQLite 没有布尔类型，前端也直接吃 0/1
CREATE TABLE IF NOT EXISTS items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT    NOT NULL,
  done       INTEGER NOT NULL DEFAULT 0,
  -- 可选截止日期，YYYY-MM-DD 字符串；不传就是 NULL，别存空字符串
  due        TEXT,
  -- 默认值建表时就写好，插入语句不用每次自己算时间
  created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 列表默认按 done 过滤和排序，这个索引让「只看未完成」不用全表扫
CREATE INDEX IF NOT EXISTS idx_items_done ON items(done);

-- 对话历史落 D1：Worker 是无状态的，不能像本机那样放内存 Map
CREATE TABLE IF NOT EXISTS chat_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 前端生成的会话 id，多轮上下文全靠它关联
  session_id TEXT    NOT NULL,
  -- 'user' / 'assistant'，原样回填成模型 messages 里的角色
  role       TEXT    NOT NULL,
  content    TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- loadHistory 固定查 WHERE session_id = ? ORDER BY id DESC LIMIT ?，
-- 这个复合索引正好覆盖它：会话再多也是按索引倒着走几行
CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(session_id, id);

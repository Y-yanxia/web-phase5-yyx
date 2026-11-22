# Cloudflare Workers 版后端（免费、地址固定、数据持久）

> 代码已经写好并提交在 `worker/` 目录，`wrangler.toml` 也配好了。
> **只差一步**：需要一个 Cloudflare 账号的 API Token 来执行部署（免费注册，不需要银行卡）。
> 部署完把 `API_BASE` 指向 `https://onelist-api.<你的子域>.workers.dev` 即可，前端一行都不用改。

## 为什么要有这一版

| 方案 | 花钱 | 地址 | 数据 |
|---|---|---|---|
| 本机 + 隧道（当前线上） | 0 | 每次重启会变 | 本机 SQLite，持久 |
| 阿里云 FC（已试） | 0 | 固定 | 实例回收即清空 |
| **Cloudflare Workers + D1** | 0 | **固定** | **D1，持久** |

Workers 免费额度：每天 10 万次请求、D1 5 GB / 500 万行读，个人项目远远够用。

## 代码结构

```
worker/
├─ index.js     # 路由 / CORS / 参数校验（和 Express 版行为一致）
├─ db.js        # D1 数据层 + 对话历史表操作
├─ tools.js     # add_item / query_items / complete_item 三个工具
├─ chat.js      # SSE 流式 + 两轮工具循环 + 历史裁剪
└─ schema.sql   # 建表语句
wrangler.toml   # Worker 配置（D1 绑定、环境变量）
.github/workflows/worker.yml  # 建表 → 推密钥 → 部署
```

## 部署步骤（10 分钟，需要 Cloudflare 账号）

### 1. 注册并拿两个值

1. <https://dash.cloudflare.com/sign-up> 注册（邮箱 + 密码，**不需要卡**），并完成邮箱验证
2. 右上角菜单 → **Copy account ID**，记下
3. <https://dash.cloudflare.com/profile/api-tokens> → **Create Token** → 选模板 **Edit Cloudflare Workers**（含 Workers Scripts 与 D1 的 Edit 权限）→ Create → 复制 Token

### 2. 创建 D1 并回填 database_id

```bash
npx wrangler d1 create onelist
# 输出里有一行 database_id = "xxxxxxxx-xxxx-..."
# 把 wrangler.toml 里的 REPLACE_WITH_D1_ID 换掉
```

### 3. 建表 + 推 Key + 部署

```bash
npx wrangler d1 execute onelist --remote --file=worker/schema.sql
npx wrangler secret put DEEPSEEK_API_KEY      # 粘贴 sk-...
npx wrangler deploy
```

部署完会打印 `https://onelist-api.<你的子域>.workers.dev`。

### 4. 接前端

仓库 Settings → Variables → `API_BASE` 改成这个地址 → 重跑 `Deploy static site to Pages`。

### 或者：全自动（GitHub Actions）

把 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`DEEPSEEK_API_KEY` 三个值加进仓库 Secrets，
之后每次推 `main` 就会自动建表、部署：

```bash
gh secret set CLOUDFLARE_API_TOKEN ...
```

推送 `worker/` 或 `wrangler.toml` 时 `.github/workflows/worker.yml` 自动触发。

## 本地调试

```bash
npm i -g wrangler
npx wrangler d1 execute onelist --local --file=worker/schema.sql
npx wrangler dev          # http://localhost:8787
```

前端用 `http://localhost:8787` 当 `API_BASE` 就能联调（记得把 `http://localhost:3000` 加进 `ALLOWED_ORIGINS`）。

## 与 Express 版的差异（答辩可讲）

| 点 | Express 版 | Worker 版 |
|---|---|---|
| 运行模型 | 常驻进程 | 无状态、按请求调度 |
| 数据库 | `node:sqlite` 本地文件 | D1（SQLite 兼容，走 HTTP） |
| 会话上下文 | 进程内 `Map` | 落 D1 的 `chat_messages` 表 |
| 流式 | `res.write` | `TransformStream` + `ReadableStream` |
| 部署 | 任意 Node 主机 | `wrangler deploy` |

**关键改动**：会话历史不能放内存了（每次请求可能是不同 isolate），所以加了一张表，
按 `session_id` 取最近 N 条再裁掉旧的——这也是 Serverless 架构最典型的坑。

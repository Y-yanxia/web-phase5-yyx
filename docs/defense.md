# 答辩速记卡

> 现场抽 3 题：① 为什么这样设计 ② 打开任意文件讲清某段代码 ③ 哪里最容易坏、你怎么发现的。
> 这页是照着念也能过的版本，每条都给了代码位置。

---

## 一、为什么这样设计（60 秒）

**一句话**：选型只服从三个约束——任务书限制、免费额度、我能不能讲清楚。

| 决定 | 理由 | 如果重来 |
|---|---|---|
| 原生 HTML/CSS/JS | 任务书不鼓励框架；这周要讲清「点击 → fetch → 渲染」全过程 | 不改 |
| 单页 + 两个 Tab | 任务书允许 Tab；省掉路由和多页状态同步 | 不改 |
| Express + `node:sqlite` | Node 24 内置 SQLite，免编译原生模块，免费容器里不会装包失败 | 数据量大再换 better-sqlite3 |
| SSE 而不是 WebSocket | 对话是单向流，SSE 自带断线重连语义，浏览器 `EventSource`/`fetch` 都能收 | 要双向（协同编辑）才用 WS |
| 前端 Pages + 后端 Render | Pages 只能放静态文件，后端要长连接跑 SSE | 不改 |
| 模型层可切换 live/mock | 没 Key 也能演示完整数据链路；有 Key 自动切真模型 | 不改 |

**为什么不做登录**：课程范围是「四者打通」，加鉴权会吃掉两天，且与考点无关。已在 README「已知问题」里写明。

---

## 二、打开任意文件讲代码（选一段，20 秒讲完）

### A. `server/ai/agent.js` 的 `liveAgent()` —— 工具调用的两轮循环

```
第 1 轮：模型返回 tool_calls → 后端真的执行 executeTool → 结果以 role:"tool" 回填
第 2 轮：带着工具结果再请求一次 → 模型用自然语言总结
最多 3 轮：防止模型反复要工具导致死循环 + 烧钱
```

要讲的三个细节：

1. **坏 JSON 不抛异常**：`JSON.parse` 失败时把错误当成一次「失败的工具结果」回填，让模型自己改参数（`agent.js` 里 `parseError` 分支）。
2. **事件外发**：执行前后分别 `send({type:'tool_call'})` 和 `send({type:'tool_result'})`，前端才能画出「调了什么、传了什么、结果如何」。
3. **模型与执行解耦**：模型看不见 SQL，只拿到 JSON 结果。这条边界既是安全边界，也是 mock 模式能复用同一套执行器的原因。

### B. `server/routes/chat.js` 的断开感知 —— 「停止生成」背后

```js
res.on('close', () => { if (!res.writableEnded) controller.abort(); });
```

- SSE 是**单向**的：浏览器断开时不会通知服务端。
- 监听 `res` 的 `close`（不是 `req` 的）：`req` 的 `close` 在请求体读完就触发，会把正常请求误杀。
- `controller.abort()` 掐的是**到 DeepSeek 的上游 fetch**，用户点停止后不再计费。

### C. `server/config.js` —— 唯一读环境变量的地方

- 全项目只有这里碰 `process.env`，其他模块只认 `config` 对象。
- 自己写了 20 行 `.env` 解析，不引 dotenv：少一个依赖，部署时少一个可能装不上的包。
- `aiMode` 由「有没有 Key」推导出来，业务代码不需要判断环境。

### D. `public/app.js` 的 `loadItems()` —— 三态怎么来的

`state.loading` / `state.error` / `state.items.length` 三个状态驱动同一块 DOM：
骨架屏 → 空态 / 错误 + 重试 → 列表。请求失败时**不清空表单**、不白屏，错误文案直接来自后端 `msg`。

---

## 三、哪里最容易坏，怎么发现的（这题是加分项）

按「最容易坏」排序，每条都给事故记录：

| # | 位置 | 现象 | 发现方式 |
|---|---|---|---|
| 1 | SSE 断开感知 | 每个请求都被自己掐断，只收到 `aborted` | 联调时 curl 正常、浏览器异常，对比才定位到 `req.on('close')` |
| 2 | 跨域预检 | 前端 5055 调 3100，Network 里请求直接 CORS error | 故意分域跑一次，把 Console 原文存进证据 |
| 3 | 工具选择 | 「还有哪些没做完」被识别成「标记完成」 | 手动试出来的，关键词「做完」命中了错误分支 |
| 4 | 可选字段 | 不传 due 反而 400 | `npm test` 抓的，肉眼没看出来 |
| 5 | 免费实例 | 重启后数据没了 | 部署后验证「重启进程数据还在」才暴露 |

**共同规律**：都不是业务逻辑错，而是**边界**错——连接的生命周期、跨域策略、意图优先级、`undefined` 与 `null`、临时文件系统。

完整复盘：`docs/incidents.md`（五起，现象 → 定位 → 修复 → 验证）。

---

## 四、可能被追问的 8 个问题

| 问题 | 怎么答 |
|---|---|
| mock 模式算不算作弊？ | 不算：它只替换「模型」这一层，工具执行器和数据库完全一样。页面和 README 都明确标注「离线演示」，没有假装接了模型；配 Key 后同一条链路走真模型 |
| 为什么不用 WebSocket？ | 对话是单向流；SSE 用普通 HTTP，反代/防火墙更友好，还能直接用 `fetch` + `ReadableStream` 处理 POST 参数 |
| SQLite 能撑住并发吗？ | 单机、WAL 模式、写少读多够用；多实例部署要换 Postgres（README 已知问题第 3 条） |
| Key 会不会泄漏到前端？ | Key 只在 `server/ai/deepseek.js` 的请求头里；F12 Network 里 chat 请求体只有 `sessionId` 和 `message`；`.env` 在 `.gitignore` 第一行 |
| 模型要是不调工具呢？ | 五步排查：描述太短 → 没加 required → 没给强制语 → 温度太高 → 用了 reasoner 模型。已写进 `docs/incidents.md` 事故 3 |
| 工具死循环怎么办？ | `MAX_ROUNDS = 3`，超了就返回兜底话术；每轮都会把工具结果写进 messages |
| 上下文太长怎么办？ | `HISTORY_LIMIT` 默认 8 条，超出丢最早的；system 提示词永远保留 |
| 有什么没做完？ | 没鉴权、没多端同步、免费实例数据不持久；三件都写进 README「已知问题」，不是没想到，是权衡后没做 |

---

## 五、如果现场要改代码（3 分钟小任务）

| 要求 | 改哪里 |
|---|---|
| 加一个「按截止日期排序」 | `server/db.js` 的 `listItems` 改 `ORDER BY`；前端不用动 |
| 加一个 `delete_item` 工具 | `server/ai/tools.js` 加定义 + `executeTool` 分支，模型自动可用 |
| 把 Tab 换成前进/后退也能走 | 加 `hashchange` 监听，`switchTab` 里已有 `history.replaceState` |
| 让错误态可重试 | `public/app.js` 的 `showState({ onAction: loadItems })` 已经接好 |

---

## 六、开场 30 秒（背下来）

> 我们组每天口头派活，容易漏。所以做了个能听懂人话的待办清单：
> 手动能增删改查，动嘴也能——说「帮我加一条明天交实验报告」，模型会真的去数据库里插一条，再把结果说给你听。
> 技术上是原生前端 + Express + SQLite，SSE 流式，模型通过 function calling 调三个工具。
> 下面我演示一遍，然后讲两个我踩过的坑。

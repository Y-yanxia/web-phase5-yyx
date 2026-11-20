# 接入真实大模型（DeepSeek）

> 当前仓库默认跑在**离线演示模式**（没配 Key）。这份文档是「拿到 Key 之后怎么切」的操作单，
> 全程不改业务代码。

---

## 1. 申请 Key（约 3 分钟）

1. 打开 <https://platform.deepseek.com/>，手机号注册 / 登录
2. 左侧 **API Keys** → **创建 API Key** → 名字随便（比如 `onelist-dev`）
3. **立刻复制**（`sk-` 开头，只显示一次），存到密码管理器
4. 新账号一般有赠送额度；左侧「用量信息」能看到余额

> 已有智谱 / 通义 / 火山方舟的 Key 也能用，只要平台兼容 OpenAI 的 `/chat/completions` 协议，
> 改 `DEEPSEEK_BASE_URL` 和 `DEEPSEEK_MODEL` 即可（工具调用要用支持 `tools` 的模型）。

## 2. 配置

本地 `.env`（在项目根目录，和 `.env.example` 同级）：

```bash
DEEPSEEK_API_KEY=sk-你的真实key
DEEPSEEK_MODEL=deepseek-chat
```

重启服务：

```bash
npm start
```

启动日志会从

```
AI 模式   离线演示（未配置 DEEPSEEK_API_KEY）
```

变成

```
AI 模式   DeepSeek / deepseek-chat
```

页面右上角的 AI 页也会显示「已接入 deepseek-chat · 支持工具调用」，小圆点从黄色变绿色。

## 3. 五分钟验收清单

| # | 动作 | 期望 |
|---|---|---|
| 1 | 说「帮我加一条明天交实验报告」 | 文字**逐字**出现；出现 `add_item` 卡片；清单多一条；数据库真的多一行 |
| 2 | 说「我还有哪些没做完」 | 调 `query_items`，条数与清单一致，不编造 |
| 3 | 说「把实验报告勾掉」 | 调 `complete_item`，那条变已完成 |
| 4 | 连续问三轮，第 3 轮问「我第一句说了什么」 | 能引用第 1 轮内容（证明上下文生效） |
| 5 | 生成中点「停止生成」 | 立刻停；服务端日志能看到上游被 abort |
| 6 | 把 Key 改成 `sk-invalid` 重启，再发一句 | 页面显示「模型 Key 无效或已过期」，不是白屏 |

第 1 条的命令行版（能直接看到 SSE 原始事件）：

```bash
curl -N -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"s1","message":"帮我加一条明天交实验报告"}'
```

看三样东西：`"type":"delta"`（流式）、`"type":"tool_call"`（模型要调工具）、
`"type":"done"`（收尾）。

## 4. Key 安全（任务书明确要求）

| 检查项 | 怎么证明 |
|---|---|
| `.env` 不进仓库 | `.gitignore` 第一行就是 `.env`；`git status` 里看不到它 |
| 仓库里搜不到 Key | `git log -p | findstr "sk-"` 无结果；GitHub 代码搜索 `sk-` 无结果 |
| 前端拿不到 Key | Key 只出现在 `server/ai/deepseek.js` 的请求头里；F12 → Network 里 chat 请求体只有 `sessionId` 和 `message` |
| 平台侧配置 | Render 的 Environment 面板里加，界面显示为掩码 |

不小心提交了怎么办：

1. 立刻去 <https://platform.deepseek.com/api_keys> **删除**那个 Key（这一步最重要，历史记录删不干净）
2. 重新生成一个
3. 用 `git filter-repo` 或 BFG 清历史（个人仓库也可以直接删库重建）

## 5. 没有 Key 时会发生什么

`config.aiMode = 'mock'`，`server/ai/agent.js` 里的 `mockAgent()` 接管：

- 用正则判断意图（新增 / 查询 / 完成），调用**同一套** `executeTool()`
- 数据链路完全一样，所以「说一句话 → 数据库多一条」是真的
- 只替换了「模型」这一层：文字是按模板拼的，不是模型生成的

页面和 README 都会明确标注「离线演示模式」，不会假装接了模型。

## 6. 切回 mock（临时演示）

```bash
MOCK_AI=1 npm start
```

即使配了 Key 也会走规则模式，适合没网 / 没额度时彩排。

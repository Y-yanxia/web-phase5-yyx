# 接口文档

> 四要素齐全：方法、路径、参数、返回示例。
> 所有接口统一返回 `{ code, data, msg }`：`code === 0` 表示成功，其余见文末错误码表。

Base URL：本地 `http://localhost:3000`，线上 `https://<你的服务>.onrender.com`

---

## 1. 清单

### GET `/api/items`

列表，按「未完成在前、id 倒序」返回。

| 参数 | 位置 | 必填 | 类型 | 说明 |
|---|---|---|---|---|
| `done` | query | 否 | `0` \| `1` | 只看未完成 / 已完成；不传为全部 |
| `q` | query | 否 | string | 标题关键词，最长 50 字 |
| `limit` | query | 否 | number | 默认 200，范围 1–500 |
| `fail` | query | 否 | `1` | **开发开关**：强制返回 500，用于截「错误态」；生产环境自动关闭 |

```bash
curl "http://localhost:3000/api/items?done=0&q=实验"
```

```json
{
  "code": 0,
  "data": {
    "items": [
      { "id": 3, "title": "交数据结构实验报告", "done": 0, "due": "2026-11-21", "created_at": "2026-11-20 17:37:47" }
    ],
    "total": 1
  },
  "msg": "ok"
}
```

---

### GET `/api/items/stats`

| 参数 | 位置 | 必填 | 说明 |
|---|---|---|---|
| —— | —— | —— | 无参数 |

```json
{ "code": 0, "data": { "total": 6, "done": 2, "pending": 4 }, "msg": "ok" }
```

---

### POST `/api/items`

| 参数 | 位置 | 必填 | 类型 | 校验 |
|---|---|---|---|---|
| `title` | body | **是** | string | 去空格后 1–200 字 |
| `due` | body | 否 | string | `YYYY-MM-DD`，不传 = 无截止日期 |

```bash
curl -X POST http://localhost:3000/api/items \
  -H "Content-Type: application/json" \
  -d '{"title":"交实验报告","due":"2026-11-25"}'
```

成功：

```json
{
  "code": 0,
  "data": { "id": 7, "title": "交实验报告", "done": 0, "due": "2026-11-25", "created_at": "2026-11-20 17:40:12" },
  "msg": "创建成功"
}
```

失败（HTTP 400，注意**不是 500**，且服务不会崩）：

```json
{ "code": 40001, "data": null, "msg": "缺少必填字段：title" }
```

---

### PUT / PATCH `/api/items/:id`

| 参数 | 位置 | 必填 | 类型 | 校验 |
|---|---|---|---|---|
| `id` | path | 是 | integer | 正整数，否则 400 |
| `title` | body | 否 | string | 同 POST |
| `done` | body | 否 | `0` \| `1` | 只接受这四种写法：`0 1 "0" "1"`（也接受布尔） |
| `due` | body | 否 | string \| null | `YYYY-MM-DD`；传 `null` 表示清空 |

三个字段至少要传一个，否则 400（`code: 40006`）。未传的字段保持原值。

```bash
curl -X PATCH http://localhost:3000/api/items/7 \
  -H "Content-Type: application/json" -d '{"done":1}'
```

```json
{ "code": 0, "data": { "id": 7, "title": "交实验报告", "done": 1, "due": "2026-11-25", "created_at": "…" }, "msg": "更新成功" }
```

---

### DELETE `/api/items/:id`

| 参数 | 位置 | 必填 | 类型 |
|---|---|---|---|
| `id` | path | 是 | integer |

```json
{ "code": 0, "data": { "id": 7, "title": "交实验报告", "done": 1, "due": "2026-11-25" }, "msg": "删除成功" }
```

不存在时 HTTP 404：

```json
{ "code": 40401, "data": null, "msg": "条目不存在" }
```

---

## 2. 对话

### POST `/api/chat`（SSE）

| 参数 | 位置 | 必填 | 类型 | 说明 |
|---|---|---|---|---|
| `sessionId` | body | 否 | string | 同一会话传同一个值，才有上下文；不传则服务端生成 |
| `message` | body | **是** | string | 1–2000 字 |

响应头：`Content-Type: text/event-stream`，`X-Accel-Buffering: no`。

事件流（每条 `data: {json}`，空行分隔）：

| `type` | 载荷 | 含义 |
|---|---|---|
| `meta` | `{sessionId, mode, model}` | 开始时告诉前端当前模式 |
| `delta` | `{text}` | 一小段文字，前端追加到气泡 |
| `tool_call` | `{id, name, args, malformed?}` | 模型决定调工具（前端显示卡片） |
| `tool_result` | `{id, name, result}` | 工具真实执行结果 |
| `done` | `{elapsedMs, chars}` | 正常结束 |
| `aborted` | `{elapsedMs?}` | 用户点了「停止生成」 |
| `error` | `{code, msg}` | 可读错误（Key 无效 / 限流 / 余额不足 / 上游故障） |

```bash
curl -N -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"s-demo","message":"帮我加一条明天交实验报告"}'
```

```
data: {"type":"meta","sessionId":"s-demo","mode":"mock"}
data: {"type":"delta","text":"好"}
data: {"type":"tool_call","id":"mock_ab12","name":"add_item","args":{"title":"明天交实验报告","due":"2026-11-21"}}
data: {"type":"tool_result","id":"mock_ab12","name":"add_item","result":{"ok":true,"data":{"id":9,…},"summary":"已新增 #9「明天交实验报告」"}}
data: {"type":"delta","text":"已经记下了 #9「明天交实验报告」…"}
data: {"type":"done","elapsedMs":884,"chars":31}
```

`message` 为空 → HTTP 400 `{code:40001}`（不是 SSE，前端会走普通 JSON 分支）。

---

### GET `/api/chat/meta`

```json
{ "code": 0, "data": { "mode": "mock", "model": "rule-based-demo", "historyLimit": 8 }, "msg": "ok" }
```

### DELETE `/api/chat/session/:id`

```json
{ "code": 0, "data": null, "msg": "已重置会话" }
```

---

## 3. 运维

### GET `/api/health`

```json
{
  "code": 0,
  "data": { "status": "up", "mode": "mock", "uptime": 326, "stats": { "total": 6, "done": 2, "pending": 4 } },
  "msg": "ok"
}
```

---

## 4. 错误码

| HTTP | code | 场景 |
|---|---|---|
| 400 | 40001 | 缺少必填字段 / 类型不对（title、message） |
| 400 | 40002 | 路径参数 id 不合法 |
| 400 | 40003 | title 超过 200 字 |
| 400 | 40004 | due 不是 `YYYY-MM-DD` |
| 400 | 40005 | done 不是 0/1 |
| 400 | 40006 | PUT/PATCH 一个字段都没传 |
| 400 | 40010 | 请求体不是合法 JSON |
| 404 | 40400 | 接口不存在（JSON，不是 HTML） |
| 404 | 40401 | 条目不存在 |
| 413 | 41300 | 请求体超过 32KB |
| 500 | 50000 | 未预期异常（统一兜底，不泄漏堆栈） |
| 500 | 50001 | `?fail=1` 演示开关 |

模型侧错误通过 SSE 的 `error` 事件下发，`code` 为 `AI_AUTH` / `AI_BALANCE` / `AI_RATE_LIMIT` / `AI_UPSTREAM` / `AI_NETWORK`。

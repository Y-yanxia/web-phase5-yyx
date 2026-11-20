# 证据截图索引

> 全部由 `npm run shots` 自动生成（无头 Edge + puppeteer-core），
> 同一脚本会断言：Console 无报错、无失败请求、375px 无横向滚动。

| 文件 | 内容 | 对应任务 |
|---|---|---|
| `01-desktop-list.png` | 桌面端清单页（1280×860） | 任务 1 |
| `02-desktop-filter-pending.png` | 点「未完成」筛选后的列表 | 任务 1/3 |
| `03-ai-tool-call.png` | AI 说「帮我加一条…」→ 工具卡片 + 回复 + 调用记录 | 任务 5（核心证据） |
| `04-list-after-ai-add.png` | 切回清单，AI 新增的那条真的在里面 | 任务 5/6 |
| `05-mobile-list.png` | 手机 375×812（DPR 2），无横向滚动条 | 任务 1 |
| `06-mobile-ai.png` | 手机端 AI 页 | 任务 1/4 |
| `07-state-loading.png` | loading 态（拦截请求延迟 1.8s 截的） | 任务 3 |
| `08-state-error.png` | error 态 + 重试按钮（拦截请求 abort） | 任务 3 |
| `09-api-smoke.png` | 11 条接口的真实状态码/耗时表格 | 任务 2 |
| `10-404-page.png` | 真 404 页面（HTTP 404，非软跳转） | 任务 1 |
| `11-cors-error.png` | 跨域被拦：页面进入错误态 | 任务 3（事故 1） |
| `11-cors-error.log.txt` | 上面那张图对应的 Console 原文 | 任务 3 |
| `12-cors-fixed.png` | 白名单加上来源后，同一页面恢复正常 | 任务 3 |
| `13-pages-live.png` | 线上 Pages 真实截图（Pages 前端 + 隧道后端，数据来自真接口） | 任务 1/6 |
| `14-pages-ai-offline.png` | 后端断开时的兜底：AI 输入框被禁用并说明原因 | 任务 4/6 |
| `15-live-ai-tool-call.png` | **线上**说一句话 → 工具卡片 → 数据库真的多一条 | 任务 5（关键证据） |
| `16-restart-persistence.png` | 杀掉进程重启：uptime 归零但数据仍在（5 条逐条一致） | 任务 2（落盘） |
| `17-state-empty.png` | 空态（线上，清空数据后） | 任务 3（三态之一） |
| `18-live-context-4rounds.png` | 线上连说 4 轮，第 4 轮准确引用第 1 轮 | 任务 4（上下文） |
| `19-key-safety.png` | Key 安全四道检查：.gitignore / 历史 / 前端 / 线上请求体 | 任务 4（Key 安全） |
| `key-safety.txt` | 上面那张图的原始命令与输出 | 任务 4 |
| `restart-persistence.txt` | 16 的原始命令与输出 | 任务 2 |
| `e2e.txt` | 浏览器端到端冒烟输出（9/9，本地） | 任务 3/6 |
| `api-smoke.txt` | 冒烟测试的纯文本输出（09 的源数据） | 任务 2 |

## 重新生成

```bash
npm start                 # 一个窗口跑服务（默认 3000，被占就 PORT=3100）
npm run seed              # 塞演示数据
npm run smoke             # 出 api-smoke.txt（需服务在跑）
npm run shots             # 出 01–08、10
node scripts/render-terminal.mjs docs/evidence/api-smoke.txt docs/evidence/09-api-smoke.png
```

CORS 那组图的复现步骤：

```bash
node scripts/static-server.mjs 5055                    # 前端跑在 5055
# 后端不带 5055 白名单
node scripts/cors-demo.mjs                             # → 11-cors-error.png
# 后端 ALLOWED_ORIGINS 加上 5055 重启
node scripts/cors-demo.mjs "http://127.0.0.1:5055/?api=http://127.0.0.1:3100" "12-cors-fixed.png"
```

# 生成《项目速答卡》Word：三个高频问题的标准答案
# 用法：<python> docs/build_quickref_docx.py
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn

OUT = r"C:\Users\Lenovo\Documents\deepseek-harness\default-workspace\web-phase5-yyx\项目速答卡.docx"

CN_BODY = "宋体"
CN_HEAD = "微软雅黑"
MONO = "Consolas"
INK = RGBColor(0x1A, 0x1A, 0x1A)
MUTED = RGBColor(0x66, 0x66, 0x66)
ACCENT = RGBColor(0xC9, 0x4A, 0x26)


def set_font(run, name=CN_BODY, size=None, bold=None, color=None, mono=False):
    run.font.name = MONO if mono else name
    run._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), name)
    if size:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if color is not None:
        run.font.color.rgb = color


def para(text="", size=10.5, bold=False, color=INK, indent=0.0, space_after=5, align=None):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.line_spacing = 1.3
    if indent:
        p.paragraph_format.left_indent = Cm(indent)
    if align is not None:
        p.alignment = align
    if text:
        r = p.add_run(text)
        set_font(r, size=size, bold=bold, color=color)
    return p


def h1(text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(14)
    p.paragraph_format.space_after = Pt(6)
    r = p.add_run(text)
    set_font(r, name=CN_HEAD, size=14, bold=True, color=INK)


def quote(text, size=10.5):
    """引用块：左侧缩进 + 暖色，像"可以直接念的话"。"""
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Cm(0.7)
    p.paragraph_format.space_after = Pt(8)
    p.paragraph_format.line_spacing = 1.35
    r = p.add_run(text)
    set_font(r, size=size, color=RGBColor(0x22, 0x22, 0x22))
    return p


def table(headers, rows, widths):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, h in enumerate(headers):
        cell = t.rows[0].cells[i]
        cell.text = ""
        p = cell.paragraphs[0]
        p.paragraph_format.space_after = Pt(1)
        r = p.add_run(h)
        set_font(r, name=CN_HEAD, size=9, bold=True)
    for row in rows:
        cells = t.add_row().cells
        for i, val in enumerate(row):
            cells[i].text = ""
            p = cells[i].paragraphs[0]
            p.paragraph_format.space_after = Pt(1)
            p.paragraph_format.line_spacing = 1.2
            mono = val.startswith("`") and val.endswith("`")
            r = p.add_run(val.strip("`"))
            set_font(r, size=8.5, mono=mono)
    for row in t.rows:
        for i, w in enumerate(widths):
            row.cells[i].width = Cm(w)
    doc.add_paragraph().paragraph_format.space_after = Pt(0)
    return t


doc = Document()
sec = doc.sections[0]
sec.left_margin = Cm(2.0)
sec.right_margin = Cm(2.0)
sec.top_margin = Cm(1.8)
sec.bottom_margin = Cm(1.8)

normal = doc.styles["Normal"]
normal.font.name = CN_BODY
normal.font.size = Pt(10.5)
normal._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), CN_BODY)

# ---------------- 标题 ----------------
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.space_after = Pt(2)
r = p.add_run("项目速答卡")
set_font(r, name=CN_HEAD, size=24, bold=True, color=INK)

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.space_after = Pt(4)
r = p.add_run("三个高频问题 · 答辩前 5 分钟看这一页")
set_font(r, name=CN_HEAD, size=10.5, color=MUTED)

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.space_after = Pt(12)
r = p.add_run("一句话清单（OneList）｜https://github.com/Y-yanxia/web-phase5-yyx")
set_font(r, size=9, color=MUTED)

# ============================================================
# 问题一：四条流水线
# ============================================================
h1("问题一：那四个 yml 是干什么的？")

para("标准答法（一句话）：", size=10, bold=True, color=MUTED)
quote("这四个 yml 让 GitHub 在我每次推送代码时自动做四件事：跑测试、把网页上线、打容器镜像、部署备用后端，"
      "完成后在提交记录上留一个绿勾。")

para("口语版（更自然）：", size=10, bold=True, color=MUTED)
quote("可以理解成我请了四个自动工人，代码一提交它们就分别去检查、上线、打包、备份，干完给我盖个绿勾——"
      "提交历史里那些勾就是过程证据。")

para("正式版（收尾用）：", size=10, bold=True, color=MUTED)
quote("这是四条 CI/CD 流水线，把测试、前端发布、镜像构建、备用后端部署都交给 GitHub 自动执行，"
      "把质量检查和上线动作固化成流程。")

para("四个文件分别是什么：", size=10, bold=True, color=MUTED)
table(
    ["文件", "什么时候跑", "做什么"],
    [
        ["`ci.yml`", "每次 push / PR", "装依赖 + 跑 24 条测试（16 接口 + 8 工具），坏约定立刻变红"],
        ["`pages.yml`", "推 main", "复制 public/ → 注入 API_BASE 变量 → 发布到 GitHub Pages（前端上线）"],
        ["`docker.yml`", "推 main / tag", "构建镜像 → 推到 ghcr 与阿里云 ACR → 容器内跑冒烟（健康检查/新增/400）"],
        ["`worker.yml`", "改 worker/", "建 D1 表 → 推模型 Key → 部署 Cloudflare Worker（没配密钥就跳过）"],
    ],
    widths=[2.6, 3.4, 10.4],
)

# ============================================================
# 问题二：每一部分干什么
# ============================================================
h1("问题二：仓库里每一部分是干什么的？")

table(
    ["部分", "一句话概括"],
    [
        ["`public/`", "前端页面：让用户看见并操作清单，不用编译，浏览器直接跑"],
        ["`server/`", "后端全部代码：收请求、校验参数、读写数据库、调大模型"],
        ["`worker/`", "同一套接口的另一种实现，准备跑在云端函数上，不依赖你的电脑"],
        ["`tests/`", "24 条自动化测试，改完代码跑一次就知道有没有破坏原来的约定"],
        ["`scripts/`", "辅助脚本：灌数据、打接口、自动点页面、截图取证、掉线后恢复线上"],
        ["`docs/`", "所有说明与证据：接口表、抓包、事故复盘、周记、答辩稿"],
        ["`.github/workflows/`", "四条自动化流水线：测试、上线、打包、部署"],
        ["`README.md`", "项目门面：简介、技术栈、运行步骤、截图、已知问题——老师先看这个"],
        ["`package.json`", "依赖清单 + 命令入口（npm start / test / e2e / smoke）"],
        ["`package-lock.json`", "锁死依赖版本，保证别人装出和你一模一样的环境"],
        ["`.env.example`", "环境变量模板，告诉你需要配哪些值，但值是空的"],
        ["`.env`", "真实 Key，只在本机、被 git 忽略——所以仓库里看不到它"],
        ["`.gitignore`", "提交黑名单：node_modules、.env、数据库文件都不上传"],
        ["`.gitattributes`", "统一换行符、标记图片为二进制，避免无意义的整文件 diff"],
        ["`Dockerfile`", "把应用打成镜像，一条命令在任何装了 Docker 的机器上跑起来"],
        ["`.dockerignore`", "构建镜像时排除无关文件，让镜像更小、构建更快"],
        ["`docker-compose.yml`", "一键起服务：端口、环境变量、数据卷、健康检查都写好"],
        ["`render.yaml`", "给 Render 的部署描述，做了模板但因要绑卡没启用"],
        ["`wrangler.toml`", "给 Cloudflare 的配置，声明数据库绑定与环境变量，等配密钥"],
        ["`*.code-workspace`", "VS Code 工作区：7 个任务 + 2 个调试配置，打开即用"],
        ["`答辩话术.docx`", "打印版答辩稿：开场、演示、三问、追问、禁忌"],
    ],
    widths=[4.2, 11.8],
)

para("总纲（接在上面这句后面）：", size=10, bold=True, color=MUTED)
quote("代码分三层：能跑的（public/server）、能验的（tests/scripts/workflows）、能讲清的（docs/README/答辩稿）——"
      "配置只负责让这三层在不同机器上都成立。")

# ============================================================
# 问题三：关键代码在哪
# ============================================================
h1("问题三：关键代码在哪里？")

para("一、工具调用（最核心，必考）", size=11, bold=True, color=ACCENT)
table(
    ["看点", "位置", "它解决什么"],
    [
        ["两轮工具循环 liveAgent()", "server/ai/agent.js:L270", "模型要工具 → 后端执行 → 结果回填 → 再问一次拿人话；最多 3 轮防死循环"],
        ["工具定义 TOOL_DEFINITIONS", "server/ai/tools.js:L15", "description 是给模型的“使用说明书”，写不清它就不调用"],
        ["执行器 executeTool()", "server/ai/tools.js:L91", "唯一真正改库的地方；模型只“说”，不执行"],
        ["日期注入 currentDatePrompt()", "server/ai/agent.js:L30", "模型不知道今天几号，会把“明天”算错"],
        ["流解析 streamCompletion()", "server/ai/deepseek.js:L44", "把 SSE 拆成文字增量与工具参数分片（arguments 是拼起来的）"],
    ],
    widths=[4.6, 4.4, 7.0],
)

para("二、流式对话与“停止生成”", size=11, bold=True, color=ACCENT)
table(
    ["看点", "位置", "它解决什么"],
    [
        ["断开感知 res.on('close')", "server/routes/chat.js:L95", "用户点停止时浏览器只是断开，服务端要主动掐上游（省 token）"],
        ["SSE 三件套", "server/routes/chat.js:L85", "no-transform + X-Accel-Buffering + 心跳，防反向代理缓冲"],
        ["前端流解析 readSse()", "public/app.js:L568", "按空行切事件、buffer 拼半包"],
        ["发消息 sendMessage()", "public/app.js:L602", "工具卡片、AbortController、错误气泡"],
    ],
    widths=[4.6, 4.4, 7.0],
)

para("三、接口与数据", size=11, bold=True, color=ACCENT)
table(
    ["看点", "位置", "它解决什么"],
    [
        ["中间件顺序", "server/app.js:L24", "CORS 必须在路由前；错误处理必须最后且四个参数"],
        ["全局错误兜底", "server/app.js:L74", "任何异常都回 JSON，不甩 HTML 堆栈"],
        ["asyncHandler", "server/lib/http.js:L20", "Express 4 不捕获 async rejection，不包会崩进程"],
        ["参数校验 parseDue", "server/routes/items.js:L48", "undefined / null / '' 三态，漏一个就“不填日期反而 400”"],
        ["建表与查询", "server/db.js:L32", "node:sqlite + WAL + 预编译语句，一个文件就是库"],
        ["三态渲染 renderList()", "public/app.js:L247", "loading / empty / error+重试 的判断顺序"],
    ],
    widths=[4.6, 4.4, 7.0],
)

para("四、只记五个（现场最可能被点开）", size=11, bold=True, color=ACCENT)
for i, line in enumerate([
    "agent.js 的 liveAgent()：工具循环，整个项目最值钱的一段",
    "chat.js 的 res.on('close')：停止生成背后的原理",
    "http.js 的 asyncHandler：为什么不包会崩",
    "items.js 的 parseDue：真实 bug 的修复痕迹",
    "app.js 的 renderList()：三态与“数据来自接口”",
], start=1):
    p = doc.add_paragraph(style="List Number")
    p.paragraph_format.space_after = Pt(2)
    r = p.add_run(line)
    set_font(r, size=10)

# ---------------- 使用建议 ----------------
h1("用法建议")

for line in [
    "答辩前 5 分钟：只看「问题一的标准答法」和「只记五个」，其余当备用。",
    "被问“讲讲这段代码”：先说它解决什么问题，再讲实现，最后补一句踩过的坑。",
    "被问没准备的问题：承认“这块没验证过”，说出你的理解，比硬编安全。",
    "链接说明：表中位置是“文件:行号”，在 GitHub 仓库里对应文件直接跳到该行。",
]:
    p = doc.add_paragraph(style="List Bullet")
    p.paragraph_format.space_after = Pt(2)
    r = p.add_run(line)
    set_font(r, size=10)

# ============================================================
# 附录：逐文件作用
# ============================================================
doc.add_page_break()
h1("附录：每个文件是干什么的")

para("public/ — 前端（浏览器直接跑）", size=11, bold=True, color=ACCENT)
table(
    ["文件", "作用"],
    [
        ["`index.html`", "页面骨架：头部、两个 Tab、清单面板、AI 面板、页脚"],
        ["`style.css`", "全部样式：设计变量、组件样式、375px 适配"],
        ["`app.js`", "全部交互：状态管理、渲染、fetch、SSE 流式、工具卡片"],
        ["`config.js`", "API 地址配置（本地同源；部署时被 Actions 注入线上地址）"],
        ["`404.html`", "真 404 页（服务端返回 404 状态码，不是软跳转）"],
    ],
    widths=[4.6, 11.4],
)

para("server/ — 后端", size=11, bold=True, color=ACCENT)
table(
    ["文件", "作用"],
    [
        ["`index.js`", "进程入口：监听端口、打印启动信息、优雅退出"],
        ["`app.js`", "中间件流水线：CORS → JSON → 日志 → 路由 → 静态 → 404 → 错误兜底"],
        ["`config.js`", "配置中心：唯一读 .env / 环境变量的地方"],
        ["`db.js`", "数据层：建表、WAL、预编译语句，所有 SQL 都在这"],
        ["`lib/http.js`", "统一返回 ok/fail、asyncHandler、手写 CORS 中间件"],
        ["`lib/errors.js`", "业务错误类型（带状态码与业务码）"],
        ["`routes/items.js`", "清单 CRUD + 四个参数校验函数"],
        ["`routes/chat.js`", "SSE 对话入口：响应头、心跳、断开感知、错误事件"],
        ["`ai/deepseek.js`", "调 DeepSeek、解析上游流、把错误翻译成人话"],
        ["`ai/agent.js`", "会话上下文 + 两轮工具循环（liveAgent）+ 无 Key 时的 mock"],
        ["`ai/tools.js`", "三个工具的 JSON Schema + 唯一真正改库的执行器"],
    ],
    widths=[4.6, 11.4],
)

para("worker/ — 另一套后端（Cloudflare Workers + D1）", size=11, bold=True, color=ACCENT)
table(
    ["文件", "作用"],
    [
        ["`index.js`", "Worker 路由入口：手写路由、CORS、参数校验（与 Express 版同语义）"],
        ["`db.js`", "D1 数据层：全异步 API，多了对话历史表操作"],
        ["`chat.js`", "Worker 版 SSE（TransformStream）+ 工具循环，历史落 D1"],
        ["`tools.js`", "Worker 版工具定义与执行器"],
        ["`schema.sql`", "建 items 与 chat_messages 两张表"],
    ],
    widths=[4.6, 11.4],
)

para("tests/ — 自动化测试", size=11, bold=True, color=ACCENT)
table(
    ["文件", "作用"],
    [
        ["`api.test.js`", "16 条：创建/校验/更新/删除/404/400/统计/SSE 全链路/多轮上下文"],
        ["`tools.test.js`", "8 条：工具执行器边界（空标题、未知工具、多条命中、过滤）"],
    ],
    widths=[4.6, 11.4],
)

para("scripts/ — 开发与取证脚本", size=11, bold=True, color=ACCENT)
table(
    ["文件", "作用"],
    [
        ["`seed.mjs`", "给本地库灌 6 条演示数据"],
        ["`seed-remote.mjs`", "给任意部署（隧道 / FC）灌数据"],
        ["`smoke.mjs`", "打 11 条真实 HTTP 请求，输出状态码 / 耗时表"],
        ["`e2e.mjs`", "真浏览器端到端 9 项（新增/勾选/搜索/AI/删除/320px/无报错）"],
        ["`screenshots.mjs`", "无头 Edge 截全部证据图（01–08、10）"],
        ["`render-terminal.mjs`", "把文本渲染成“终端截图”（09 接口表）"],
        ["`cors-demo.mjs`", "故意制造跨域失败并抓 Console 原文（11/12 对比图）"],
        ["`static-server.mjs`", "起静态服务器，复现“前后端分域”场景"],
        ["`live-shot.mjs`", "截线上页面（13 号图）"],
        ["`live-ai-shot.mjs`", "线上发一句话，截工具调用现场（15 号图）"],
        ["`live-context-shot.mjs`", "线上连说 4 轮，证明上下文接得上（18 号图）"],
        ["`accept-task2.ps1`", "任务 2 验收：curl 逐条执行、暂停截图、自动判读"],
        ["`start-online.ps1`", "手动一键：起服务 + 隧道，打印公网地址"],
        ["`auto-online.ps1`", "开机自恢复：服务 + 隧道 + 自动改 API_BASE + 重跑 Pages"],
        ["`set-api-base.mjs`", "用 Node 改仓库变量并触发 Pages（PowerShell 的 HTTPS 在这台机器上是坏的）"],
    ],
    widths=[4.6, 11.4],
)

para("一句话记住它们的关系：", size=10, bold=True, color=MUTED)
quote("public/ 让用户看得见；server/ 让请求跑得通（app 串路由、routes 校验、db 落库）；"
      "worker/ 是同一件事的另一种做法；tests/ 保证改了不坏；scripts/ 保证能证明、能恢复。", size=10)

doc.save(OUT)
print("saved:", OUT)

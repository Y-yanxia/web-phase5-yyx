# 生成《答辩话术》Word 文档
# 用法：<python> docs/build_defense_docx.py
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn

OUT = r"C:\Users\Lenovo\Documents\deepseek-harness\default-workspace\web-phase5-yyx\答辩话术.docx"

CN_BODY = "宋体"
CN_HEAD = "微软雅黑"
MONO = "Consolas"
GRAY = RGBColor(0x33, 0x33, 0x33)
MUTED = RGBColor(0x66, 0x66, 0x66)
ACCENT = RGBColor(0xC9, 0x4A, 0x26)


def set_font(run, name=CN_BODY, size=None, bold=None, color=None, mono=False):
    font_name = MONO if mono else name
    run.font.name = font_name
    run._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), name)
    if size:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if color is not None:
        run.font.color.rgb = color


def para(text="", size=10.5, bold=False, color=GRAY, indent=0.0, space_after=6,
         align=None, style=None, italic=False):
    p = doc.add_paragraph(style=style)
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.line_spacing = 1.35
    if indent:
        p.paragraph_format.left_indent = Cm(indent)
    if align is not None:
        p.alignment = align
    if text:
        r = p.add_run(text)
        set_font(r, size=size, bold=bold, color=color)
        r.italic = italic
    return p


def speak(text):
    """口语稿：缩进 + 深灰，方便照着念"""
    return para(text, size=11, color=RGBColor(0x1a, 0x1a, 0x1a), indent=0.6, space_after=8)


def h1(text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(16)
    p.paragraph_format.space_after = Pt(7)
    r = p.add_run(text)
    set_font(r, name=CN_HEAD, size=15, bold=True, color=RGBColor(0x11, 0x11, 0x11))
    return p


def h2(text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(10)
    p.paragraph_format.space_after = Pt(4)
    r = p.add_run(text)
    set_font(r, name=CN_HEAD, size=12, bold=True, color=ACCENT)
    return p


def bullet(text, bold_prefix=None):
    p = doc.add_paragraph(style="List Bullet")
    p.paragraph_format.space_after = Pt(3)
    p.paragraph_format.line_spacing = 1.3
    if bold_prefix:
        r = p.add_run(bold_prefix)
        set_font(r, size=10.5, bold=True)
    r = p.add_run(text)
    set_font(r, size=10.5)
    return p


def table(headers, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr = t.rows[0].cells
    for i, h in enumerate(headers):
        hdr[i].text = ""
        p = hdr[i].paragraphs[0]
        p.paragraph_format.space_after = Pt(2)
        r = p.add_run(h)
        set_font(r, name=CN_HEAD, size=9.5, bold=True)
    for row in rows:
        cells = t.add_row().cells
        for i, val in enumerate(row):
            cells[i].text = ""
            p = cells[i].paragraphs[0]
            p.paragraph_format.space_after = Pt(2)
            p.paragraph_format.line_spacing = 1.25
            r = p.add_run(val)
            mono = val.startswith("`") and val.endswith("`")
            set_font(r, size=9, mono=mono)
            if mono:
                r.text = val.strip("`")
    if widths:
        for row in t.rows:
            for i, w in enumerate(widths):
                row.cells[i].width = Cm(w)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return t


doc = Document()
sec = doc.sections[0]
sec.left_margin = Cm(2.2)
sec.right_margin = Cm(2.2)
sec.top_margin = Cm(2.0)
sec.bottom_margin = Cm(2.0)

normal = doc.styles["Normal"]
normal.font.name = CN_BODY
normal.font.size = Pt(10.5)
normal._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), CN_BODY)

# ---------------- 封面 ----------------
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.space_after = Pt(2)
r = p.add_run("26 级第五阶段 · 答辩话术")
set_font(r, name=CN_HEAD, size=22, bold=True, color=RGBColor(0x11, 0x11, 0x11))

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.space_after = Pt(14)
r = p.add_run("一句话清单 —— 能用自然语言操作的待办清单")
set_font(r, name=CN_HEAD, size=11, color=MUTED)

table(
    ["项", "内容"],
    [
        ["项目", "一句话清单（OneList）：手动增删改查 + 自然语言操作"],
        ["技术栈", "原生 HTML/CSS/JS · Node 24 + Express · SQLite · DeepSeek · SSE + function calling"],
        ["线上地址", "https://y-yanxia.github.io/web-phase5-yyx/"],
        ["仓库", "https://github.com/Y-yanxia/web-phase5-yyx"],
        ["验收口径", "任务书原文：能跑（有线上链接）、能讲（对着代码说清每一行）"],
    ],
    widths=[2.6, 13.4],
)

para("答辩前 10 分钟自检", size=11, bold=True, color=RGBColor(0x11, 0x11, 0x11))
bullet("线上页面能打开、列表能加载（打不开就先刷新 / 等 10 分钟 CDN）")
bullet("演示数据已灌好：至少 1 条未完成、1 条已完成、1 条逾期")
bullet("记录好工具调用截图、三态截图，万一现场网络卡可以拿图讲")
bullet("手机也能打开一次（老师常问「手机上能用吗」）")

# ---------------- 一、开场 ----------------
h1("一、开场（30 秒，背下来）")

speak("老师好，我做的是一个能用自然语言操作的待办清单，叫「一句话清单」。")
speak("平时记待办最烦的是步骤太多：打开 App、找输入框、打字、选日期。我想把它压成一句话——"
      "对着页面说「帮我加一条明天交实验报告」，模型判断要调工具，后端真的往数据库里插一条，"
      "再把结果用中文说给我听。手动增删改查也都保留，不用 AI 也能当普通清单用。")
speak("技术上：前端是原生 HTML/CSS/JS，后端 Node + Express + SQLite，模型接的 DeepSeek，"
      "用 SSE 做流式、用 function calling 做工具调用。")

# ---------------- 二、演示 ----------------
h1("二、2 分钟演示（边说边点，别沉默）")

table(
    ["时间", "你说什么", "你点什么"],
    [
        ["0:00–0:15", "先看手动路径：我加一条「周五前交实验报告」", "输入框打字 → 添加"],
        ["0:15–0:30", "刷新一下，数据还在——因为写在 SQLite 文件里，不在内存", "F5"],
        ["0:30–0:50", "勾选完成、按状态筛选、搜索，都是打接口拿数据，页面里没有写死的数组", "勾选 → 切筛选 → 搜索"],
        ["0:50–1:20", "切到 AI：我说一句话，注意看它调了什么", "切 AI Tab → 说「帮我加一条明天交实验报告」"],
        ["1:20–1:40", "这里出现工具卡片 add_item(...)，下面是执行结果；调试面板也留了记录", "指工具卡片 + 调试面板"],
        ["1:40–1:55", "切回清单——真的多了一条。这不是模型编的，是后端执行完 SQL 的返回", "切清单 Tab"],
        ["1:55–2:00", "整条链路：自然语言 → 模型选工具 → 后端执行 → 结果回填 → 模型总结", "——"],
    ],
    widths=[2.2, 8.2, 5.6],
)

para("如果现场网络慢：提前开好页面、灌好数据；说一句「后端在我本机，走隧道，首包会慢两三秒」，"
     "不要一句话不说干等。", size=9.5, color=MUTED)

# ---------------- 三、问题一 ----------------
h1("三、问题一：为什么这样设计（60–90 秒）")

speak("我的选型只服从三个约束：任务书的限制、免费额度、我能不能讲清楚。")
speak("前端选原生三件套，因为任务书不鼓励上框架；而且这周的目标是把「点击 → fetch → 渲染」这条链讲明白，"
      "Vue 会把它藏起来。")
speak("单页加两个 Tab，任务书允许用 Tab 面板切换，我就不做路由了，省下的时间给了工具调用。")
speak("后端 Node + Express，前后端同一门语言，SSE 转发写起来最顺。")
speak("数据库是 SQLite，用的是 Node 24 内置的 node:sqlite，不是 better-sqlite3——后者是原生模块，"
      "在免费容器里要编译，很容易装不上；内置模块零依赖，npm install 只装 express 一个包。")
speak("流式用 SSE 不用 WebSocket，因为对话是单向流，SSE 就是普通 HTTP，反向代理和防火墙都友好。")
speak("数据结构就一张 items 表：id、title、done、due、created_at。done 用 0/1 是因为 SQLite 没有布尔；"
      "created_at 交给数据库默认值，接口层不用管时间，少一个出错的地方。")
speak("一句话总结：没有用什么先进技术，用的都是能被讲清楚的技术。")

# ---------------- 四、问题二 ----------------
h1("四、问题二：打开任意文件讲一段代码（90 秒，选一条）")

h2("路线 A（推荐）：server/ai/agent.js 的 liveAgent()")
speak("这段是工具调用的核心，是个最多跑三轮的循环。第一轮我把 system 提示词、历史消息、"
      "用户这句话一起发给模型，并且带上三个工具的 JSON Schema。模型如果只想聊天，就直接返回文字，循环结束。")
speak("如果它返回 tool_calls，说明它要调工具。我先把它这条 assistant 消息（带 tool_calls）压进 messages，"
      "然后逐个执行——执行的是我自己的 executeTool()，模型碰不到数据库。")
speak("执行完，我把结果以 role 为 tool 的身份塞回去，再请求一次。第二轮模型就能看着工具结果说人话了。")
para("三个值得讲的细节：", size=10.5, bold=True)
bullet("坏 JSON 不抛异常——解析失败时当成一次「失败的工具结果」回填，让模型自己改参数，而不是把请求挂掉。")
bullet("执行前后各发一个 SSE 事件（tool_call / tool_result），前端才画得出「调了什么、传了什么、结果如何」。")
bullet("最多三轮，最后一轮如果模型还要工具就不再给机会，避免死循环烧钱。")

h2("路线 B：server/routes/chat.js 的断开感知")
speak("SSE 是单向的：用户点停止时，浏览器只是把连接断开，服务端不会收到通知。所以我监听响应的 close，"
      "判断 writableEnded——响应还没写完就被关了，就是用户主动断的，这时 abort 掉到 DeepSeek 的上游请求。"
      "不掐的话，用户看着已经停了，其实模型还在生成，钱还在烧。")
speak("这里有个坑：一开始我监听的是 req 的 close，结果每个正常请求刚进来就被判定成断开——"
      "因为 Node 里 req 的 close 在请求体读完时就触发，不是连接断开才触发。")

h2("路线 C：server/config.js")
speak("全项目只有这一个文件读 process.env，别的模块只认 config 对象。好处是「有哪些配置项」一眼可见，"
      "也不会某个文件偷偷写死 localhost。.env 解析是我自己写的 20 行，不引 dotenv——"
      "少一个依赖，部署时少一个可能装不上的包。")

# ---------------- 五、问题三 ----------------
h1("五、问题三：哪里最容易坏，怎么发现的（90 秒）")

speak("我踩了五个坑，挑两个最硬的讲。")
para("第一个：SSE 被自己掐断", size=10.5, bold=True)
speak("前端只收到 meta 和 aborted，一个字都没流出来；但用 curl 直接打接口是正常的。定位到 req.on('close')——"
      "Node 的 IncomingMessage 在请求体读完时就触发 close，所以每个正常请求都被当成用户取消。"
      "改成监听 res 的 close，并加 writableEnded 判断。")
para("第二个：工具选错", size=10.5, bold=True)
speak("我说「我还有哪些没做完」，它却调了「标记完成」，返回「没找到包含……的条目」。原因是意图判断的正则里"
      "「做完」先命中了完成分支。修法三步：先判查询再判完成、加否定词（没做完/未完成/还没）、"
      "这类问法自动带 done 为 0。")
para("另外三个一句话带过：", size=10.5, bold=True)
bullet("CORS 预检没过：白名单没加前端端口，Console 原文存进了事故记录。")
bullet("可选字段 undefined 漏判：不传日期反而 400，是自动化测试抓出来的。")
bullet("模型不知道今天几号：把「明天」算成 2026-06-11，改成每次请求把当前日期拼进 system 提示词。")
speak("共同规律：都不是业务逻辑错，是边界错——连接的生命周期、跨域策略、意图优先级、"
      "undefined/null/空串的三态。完整复盘在 docs/incidents.md，每条都有现象、定位、修复、验证。")

# ---------------- 六、追问 ----------------
h1("六、可能被追问（快问快答）")

table(
    ["老师可能问", "你怎么答"],
    [
        ["为什么不用 Vue / React？", "任务书不建议；这周要能讲清 DOM 和请求，框架会把这两层藏起来"],
        ["为什么用 SSE 不用 WebSocket？", "对话单向流；SSE 是普通 HTTP，反代友好，还能用 fetch 带 POST 参数"],
        ["SQLite 能撑住并发吗？", "单机、WAL、写少读多够用；要多实例就得换 Postgres，写在「已知问题」里"],
        ["Key 会不会泄漏到前端？", "只在服务端请求头；F12 看 chat 请求体只有 sessionId 和 message；仓库全历史零命中"],
        ["模型不调工具怎么办？", "五步排查：描述太短 → 没加 required → 没给强制语 → 温度太高 → 用了 reasoner 模型"],
        ["工具死循环怎么办？", "最多三轮，超了返回兜底话术"],
        ["上下文太长怎么办？", "HISTORY_LIMIT 为 8，超出丢最早的；system 永远保留"],
        ["为什么有 mock 模式？", "没 Key 时规则模拟，但走同一套执行器和同一张表，数据链路是真的；配 Key 自动切真模型"],
        ["数据会丢吗？", "本机 SQLite 不会；免费云（如 FC）实例回收会清空，要挂 NAS，我实测过"],
        ["有什么没做完？", "没鉴权、没多端同步、线上后端是隧道（关机就断）。都写进「已知问题」，是权衡后没做"],
    ],
    widths=[5.2, 10.8],
)

# ---------------- 七、现场改 ----------------
h1("七、如果老师让现场改代码")

table(
    ["要求", "改哪里"],
    [
        ["加「按截止日期排序」", "server/db.js 的 listItems 改 ORDER BY，前端不用动"],
        ["加一个 delete_item 工具", "server/ai/tools.js 加定义 + executeTool 分支，模型自动可用"],
        ["让错误态能重试", "public/app.js 的 showState（onAction 已经接好）"],
        ["限制单条标题长度", "server/routes/items.js 的 MAX_TITLE"],
        ["加一个统计接口", "db.js 已有 getStats，app.js 挂个路由即可"],
    ],
    widths=[5.6, 10.4],
)

# ---------------- 八、收尾 ----------------
h1("八、收尾（20 秒）")

speak("这周最大的收获不是学会了哪个库，而是搞清楚了一件事：模型不会「干」，它只会「说」。"
      "真正把事做成的是那圈工具循环，和后面几条老老实实的 SQL。"
      "页面能打开只是开始，能讲清每一次请求才算入门。")

h1("九、别说的话")

bullet("「这段是 AI 写的，我不太清楚」——任务书明说讲不清就重写。")
bullet("「本地能跑，线上没部署」——验收第一条就是线上链接。")
bullet("「CORS 我关了浏览器安全策略」——正确做法是服务端加响应头。")
bullet("「SQLite 只能单机所以没做」——要说清「为什么这个场景够用」。")
bullet("不确定就承认：「这块我还没验证过，我的理解是……回去补一下」，比硬编好。")

doc.save(OUT)
print("saved:", OUT)

# 任务 2 验收脚本：四条命令，逐条按回车，方便一条一张截图
#
# 用法（在 web-phase5-yyx 目录下）：
#   1) 另开一个窗口： npm start
#   2) powershell -ExecutionPolicy Bypass -File .\scripts\accept-task2.ps1
#      只想跑一遍看结果、不要暂停： 加 -NoPause
#
# 为什么用 --data-binary @文件 而不是 -d '{"...中文..."}'：
#   Windows PowerShell 把参数交给原生程序时用的是系统 ANSI 编码（中文 Windows 是 GBK），
#   中文 JSON 会被压成 GBK 字节，服务端按 UTF-8 解析就失败，返回 400「请求体不是合法 JSON」。
#   把 JSON 写成 UTF-8 文件再用 --data-binary @file 发，才是干净的做法。

# 解决什么问题：任务 2 要交「四条命令 + 截图」，手敲容易漏步骤，也容易把中文弄坏。
# 这个脚本把顺序固定好：先打印命令再执行，每条停一下，你只管截图。
#
# 前置条件：
# · 后端必须先起：另开一个窗口 npm start，默认端口 3100，脚本默认打这里
# · 端口或地址不一样就传 -Base，例如 -Base http://127.0.0.1:3200
# · 不用装 curl：Windows 10 以后自带 curl.exe；PowerShell 5.1 直接能跑
#
# 产物：脚本不截图，图要自己截；中间请求体都落在 .cache 目录下
# body-create.json 和 body-missing-title.json 就是真正发出去的字节
# 脚本末尾会把判读结果打出来，照着它决定补哪张图就行。
param([switch]$NoPause, [string]$Base = "http://localhost:3100")

$ErrorActionPreference = 'Stop'
# 临时 JSON 放 .cache：项目里就这个目录是垃圾堆，不进 git 也不挡眼睛
$tmp = Join-Path $PSScriptRoot "..\.cache"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

# 写文件用不带 BOM 的 UTF-8：curl 发的是文件字节，多三个 BOM 就成非法 JSON
function Write-JsonFile($path, $json) {
    [IO.File]::WriteAllText($path, $json, [Text.UTF8Encoding]::new($false))
}

# 先打印命令再执行：截图里带着命令，评委才知道这条结果是怎么来的
function Show-Step($title, $cmd) {
    Write-Host ""
    Write-Host ("=" * 80) -ForegroundColor DarkGray
    Write-Host "  $title" -ForegroundColor Cyan
    Write-Host ("=" * 80) -ForegroundColor DarkGray
    Write-Host "PS> $cmd" -ForegroundColor Yellow
    Write-Host ""
}

# 默认每条停一下等人截图；-NoPause 是快速自查模式，不停顿直接跑完
function Pause-IfNeeded($msg) {
    if (-not $NoPause) { Read-Host "`n$msg" | Out-Null }
}

# 统一走 -i 保留状态行和响应头：400 还是 200，全看第一行
function Invoke-Curl($args_) {
    $raw = & curl.exe -s -i --max-time 15 @args_
    $text = ($raw -join "`n")
    Write-Host $text
    $index = $text.IndexOf('{')
    if ($index -ge 0) {
        try { return ($text.Substring($index) | ConvertFrom-Json) } catch { return $null }
    }
    return $null
}

# 0. 先确认服务活着
# 探活失败就 exit 1：别让人对着一屏 ECONNREFUSED 去找原因
try {
    $null = Invoke-WebRequest -Uri "$Base/api/health" -UseBasicParsing -TimeoutSec 5
} catch {
    Write-Host "服务没起来（$Base）。先在另一个窗口跑 npm start，再回来运行本脚本。" -ForegroundColor Red
    exit 1
}

# 1. GET 列表
# ① 最基础的一条：同源、无参数，它挂了说明服务根本没起来
Show-Step "① GET 列表（期望 200）" "curl.exe -i `"$Base/api/items`""
$null = Invoke-Curl @('-i', "$Base/api/items")
Pause-IfNeeded "截好图按回车"

# 2. POST 新增（UTF-8 文件）
$bodyFile = Join-Path $tmp 'body-create.json'
# 中文标题写进 UTF-8 文件再从文件发：绕开控制台的 GBK 转换，别用 -d
Write-JsonFile $bodyFile '{"title":"周五前交实验报告","due":"2026-11-25"}'
Show-Step "② POST 新增（期望 200）" "curl.exe -i -X POST `"$Base/api/items`" -H `"Content-Type: application/json`" --data-binary `"@$bodyFile`""
$created = Invoke-Curl @('-i', '-X', 'POST', "$Base/api/items", '-H', 'Content-Type: application/json', '--data-binary', "@$bodyFile")
Pause-IfNeeded "截好图按回车"

# 3. DELETE 删除刚建的那条
# 用返回里的 id 去删：不猜 id，也不会误删别的数据
$id = $created.data.id
Show-Step "③ DELETE 删除（期望 200）" "curl.exe -i -X DELETE `"$Base/api/items/$id`""
$null = Invoke-Curl @('-i', '-X', 'DELETE', "$Base/api/items/$id")
Pause-IfNeeded "截好图按回车"

# 4. 故意少传 title —— 必须 400 + 「缺少必填字段」，不能是 500
# 故意只传 due 不传 title：验收要求是 400 + 人话，不是 500 + 堆栈
$badFile = Join-Path $tmp 'body-missing-title.json'
Write-JsonFile $badFile '{"due":"2026-11-25"}'
Show-Step "④ 故意少传 title（期望 400，不是 500）" "curl.exe -i -X POST `"$Base/api/items`" -H `"Content-Type: application/json`" --data-binary `"@$badFile`""
$bad = Invoke-Curl @('-i', '-X', 'POST', "$Base/api/items", '-H', 'Content-Type: application/json', '--data-binary', "@$badFile")
Pause-IfNeeded "截好图按回车"

# 5. 出错后再打一次 health，证明服务没崩
# ⑤ 是收尾：400 之后进程还活着，才说明错误被当业务结果处理了
Show-Step "⑤ 出错之后服务还活着（期望 200）" "curl.exe -i `"$Base/api/health`""
$null = Invoke-Curl @('-i', "$Base/api/health")

# 自动判读
Write-Host ""
Write-Host "自动判读：" -ForegroundColor Green
# 判读看 code 不看 HTTP 状态：接口约定 code=0 才算真成功
if ($created -and $created.code -eq 0) { Write-Host "  ✅ ② 创建成功，id=$($created.data.id)" } else { Write-Host "  ❌ ② 创建失败" -ForegroundColor Red }
if ($bad -and $bad.code -eq 40001) { Write-Host "  ✅ ④ 返回 400 +「缺少必填字段：title」，符合预期" }
# 40010 是 JSON 解析失败：说明中文被 GBK 压坏了，不是接口的锅
elseif ($bad -and $bad.code -eq 40010) { Write-Host "  ⚠️ ④ 返回的是「请求体不是合法 JSON」——中文 JSON 编码问题，改用 --data-binary @文件" -ForegroundColor Yellow }
else { Write-Host "  ❌ ④ 不是预期的 400/40001" -ForegroundColor Red }

Write-Host ""
# 把要交的图提前列清楚：两张必交、一张加分，截完对着勾就行
Write-Host "两张成绩单怎么截：" -ForegroundColor Green
Write-Host "  · 图一：①②③ 任意一张（能看到 HTTP/1.1 200 OK + `"code`":0）"
Write-Host "  · 图二：④（必须看到 HTTP/1.1 400 Bad Request + `"code`":40001 + 缺少必填字段：title）"
Write-Host "  · 加分：再截 ⑤，证明 400 之后服务没崩"

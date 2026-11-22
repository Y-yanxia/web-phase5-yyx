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

param([switch]$NoPause, [string]$Base = "http://localhost:3100")

$ErrorActionPreference = 'Stop'
$tmp = Join-Path $PSScriptRoot "..\.cache"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

function Write-JsonFile($path, $json) {
    [IO.File]::WriteAllText($path, $json, [Text.UTF8Encoding]::new($false))
}

function Show-Step($title, $cmd) {
    Write-Host ""
    Write-Host ("=" * 80) -ForegroundColor DarkGray
    Write-Host "  $title" -ForegroundColor Cyan
    Write-Host ("=" * 80) -ForegroundColor DarkGray
    Write-Host "PS> $cmd" -ForegroundColor Yellow
    Write-Host ""
}

function Pause-IfNeeded($msg) {
    if (-not $NoPause) { Read-Host "`n$msg" | Out-Null }
}

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
try {
    $null = Invoke-WebRequest -Uri "$Base/api/health" -UseBasicParsing -TimeoutSec 5
} catch {
    Write-Host "服务没起来（$Base）。先在另一个窗口跑 npm start，再回来运行本脚本。" -ForegroundColor Red
    exit 1
}

# 1. GET 列表
Show-Step "① GET 列表（期望 200）" "curl.exe -i `"$Base/api/items`""
$null = Invoke-Curl @('-i', "$Base/api/items")
Pause-IfNeeded "截好图按回车"

# 2. POST 新增（UTF-8 文件）
$bodyFile = Join-Path $tmp 'body-create.json'
Write-JsonFile $bodyFile '{"title":"周五前交实验报告","due":"2026-11-25"}'
Show-Step "② POST 新增（期望 200）" "curl.exe -i -X POST `"$Base/api/items`" -H `"Content-Type: application/json`" --data-binary `"@$bodyFile`""
$created = Invoke-Curl @('-i', '-X', 'POST', "$Base/api/items", '-H', 'Content-Type: application/json', '--data-binary', "@$bodyFile")
Pause-IfNeeded "截好图按回车"

# 3. DELETE 删除刚建的那条
$id = $created.data.id
Show-Step "③ DELETE 删除（期望 200）" "curl.exe -i -X DELETE `"$Base/api/items/$id`""
$null = Invoke-Curl @('-i', '-X', 'DELETE', "$Base/api/items/$id")
Pause-IfNeeded "截好图按回车"

# 4. 故意少传 title —— 必须 400 + 「缺少必填字段」，不能是 500
$badFile = Join-Path $tmp 'body-missing-title.json'
Write-JsonFile $badFile '{"due":"2026-11-25"}'
Show-Step "④ 故意少传 title（期望 400，不是 500）" "curl.exe -i -X POST `"$Base/api/items`" -H `"Content-Type: application/json`" --data-binary `"@$badFile`""
$bad = Invoke-Curl @('-i', '-X', 'POST', "$Base/api/items", '-H', 'Content-Type: application/json', '--data-binary', "@$badFile")
Pause-IfNeeded "截好图按回车"

# 5. 出错后再打一次 health，证明服务没崩
Show-Step "⑤ 出错之后服务还活着（期望 200）" "curl.exe -i `"$Base/api/health`""
$null = Invoke-Curl @('-i', "$Base/api/health")

# 自动判读
Write-Host ""
Write-Host "自动判读：" -ForegroundColor Green
if ($created -and $created.code -eq 0) { Write-Host "  ✅ ② 创建成功，id=$($created.data.id)" } else { Write-Host "  ❌ ② 创建失败" -ForegroundColor Red }
if ($bad -and $bad.code -eq 40001) { Write-Host "  ✅ ④ 返回 400 +「缺少必填字段：title」，符合预期" }
elseif ($bad -and $bad.code -eq 40010) { Write-Host "  ⚠️ ④ 返回的是「请求体不是合法 JSON」——中文 JSON 编码问题，改用 --data-binary @文件" -ForegroundColor Yellow }
else { Write-Host "  ❌ ④ 不是预期的 400/40001" -ForegroundColor Red }

Write-Host ""
Write-Host "两张成绩单怎么截：" -ForegroundColor Green
Write-Host "  · 图一：①②③ 任意一张（能看到 HTTP/1.1 200 OK + `"code`":0）"
Write-Host "  · 图二：④（必须看到 HTTP/1.1 400 Bad Request + `"code`":40001 + 缺少必填字段：title）"
Write-Host "  · 加分：再截 ⑤，证明 400 之后服务没崩"

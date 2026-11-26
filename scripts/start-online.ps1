# 一键恢复线上：起后端 + 起云端隧道，并自动把公网地址复制到剪贴板
#
# 用法：双击本文件，或在项目目录执行
#   powershell -ExecutionPolicy Bypass -File .\scripts\start-online.ps1
#
# 做完三件事后脚本自己退出，隧道在后台继续跑：
#   1. 后端没起就起一个
#   2. 起 Cloudflare 快速隧道
#   3. 打印公网地址 + 存到 .cache\cf\last-url.txt + 复制到剪贴板

# 解决什么问题：电脑重启后线上前端打不开 API，需要一个「点一下就能恢复」的入口。
# 它做三件事：后端没起就起一个 → 起 Cloudflare 快速隧道 → 打印并复制公网地址。
#
# 怎么用：直接双击，或在项目目录执行下面这条；跑完脚本退出，隧道留在后台。
# powershell -ExecutionPolicy Bypass -File .\scripts\start-online.ps1
#
# 和 auto-online.ps1 的区别：本脚本是「手动急救」，人跑一次、拿到地址就结束；
# auto-online 是「开机自启」，常驻看门狗、掉线自动重启、还自动改 GitHub 变量。
#
# 前置条件：
# · 依赖已装（node_modules 在）；后端没起会自动拉一个在 3100
# · 端口被占就传 -Port 3200，脚本和隧道会用同一个端口
# · .cache\cf\cloudflared.exe 要在，缺了脚本会给下载地址再退出
#
# 产物：.cache\cf\last-url.txt 存公网地址
# tunnel-live.log 是隧道日志；地址还会顺手复制到剪贴板
param([int]$Port = 3100)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$cfDir = Join-Path $root '.cache\cf'
New-Item -ItemType Directory -Force -Path $cfDir | Out-Null
# 路径先算清楚：后面下载提示和启动都要用它，别写两遍
$cf = Join-Path $cfDir 'cloudflared.exe'
$log = Join-Path $cfDir 'tunnel-live.log'
$urlFile = Join-Path $cfDir 'last-url.txt'

Write-Host ''
Write-Host '  一句话清单 · 恢复线上' -ForegroundColor Cyan
Write-Host '  -----------------------------' -ForegroundColor DarkGray

# ---------- 1. 后端 ----------
# 先探活：两个 node 抢 3100 只会互相顶掉，能复用就复用
$alive = $false
try {
    $null = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
    $alive = $true
    Write-Host '  [1/3] 后端已在运行' -ForegroundColor Green
} catch { }

if (-not $alive) {
    Write-Host '  [1/3] 启动后端...' -ForegroundColor Yellow
    # 隐藏窗口：这脚本是给人看结果的，不需要再开个黑框
    Start-Process -FilePath 'node' -ArgumentList 'server/index.js' -WorkingDirectory $root -WindowStyle Hidden
    # 轮询等健康检查通过：起服务要几百毫秒到几秒，起完就往下走会失败
    for ($i = 0; $i -lt 25; $i++) {
        Start-Sleep -Milliseconds 700
        try {
            $null = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
            $alive = $true
            break
        } catch { }
    }
    if (-not $alive) {
        # 起不来就停在这：端口被占和没装依赖是最常见的两个原因，下面已经写了
        Write-Host '  后端没起来。先手动跑 npm start 看报错。' -ForegroundColor Red
        Write-Host '  常见原因：端口被占（可加 -Port 3200）、没装依赖（npm install）'
        Read-Host '按回车退出'
        exit 1
    }
    Write-Host '  [1/3] 后端已就绪' -ForegroundColor Green
}

# ---------- 2. 隧道 ----------
# 缺 cloudflared 也没法硬跑：把国内镜像地址直接给出来，省一次搜索
if (-not (Test-Path $cf)) {
    Write-Host '  [2/3] 缺少 cloudflared.exe' -ForegroundColor Red
    Write-Host '        国内镜像下载后保存到：'
    Write-Host "        $cf"
    Write-Host '        https://gh-proxy.com/https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
    Read-Host '按回车退出'
    exit 1
}

Write-Host '  [2/3] 启动隧道...' -ForegroundColor Yellow
# 先删旧日志：留着上一轮的地址会被当成这一轮的，剪贴板就复制错了
Remove-Item $log -ErrorAction SilentlyContinue
# 后台跑：脚本要退出，隧道还得继续转发请求
Start-Process -FilePath $cf -ArgumentList @(
    'tunnel', '--url', "http://127.0.0.1:$Port", '--no-autoupdate', '--logfile', $log
) -WindowStyle Hidden | Out-Null

# ---------- 3. 等地址 ----------
# 地址只出现在日志里，所以循环读日志，抓第一个 trycloudflare 域名
$url = $null
for ($i = 0; $i -lt 45; $i++) {
    Start-Sleep -Milliseconds 1000
    if (Test-Path $log) {
        $m = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches | Select-Object -First 1
        if ($m) { $url = $m.Matches[0].Value; break }
    }
}

Write-Host ''
# 45 秒还没地址就认输：给日志路径比让人干等更有用
if (-not $url) {
    Write-Host '  [3/3] 没拿到地址，看日志：' -ForegroundColor Red
    Write-Host "        $log"
    Read-Host '按回车退出'
    exit 1
}

# 落盘一份：窗口关了以后还能查到这次用的是哪个地址
Set-Content -Path $urlFile -Value $url -Encoding ascii
# 剪贴板在远程会话里可能不可用，失败也不该影响主流程
try { Set-Clipboard -Value $url } catch { }

Write-Host '  [3/3] 好了，公网地址：' -ForegroundColor Green
Write-Host ''
Write-Host "        $url" -ForegroundColor Cyan
Write-Host ''
Write-Host '  已复制到剪贴板，也存到了：' -ForegroundColor DarkGray
Write-Host "  $urlFile" -ForegroundColor DarkGray
Write-Host ''
# 两条路都写清楚：让 AI 改（自动），或者自己去 Settings 改（手动）
Write-Host '  接下来二选一：' -ForegroundColor Yellow
Write-Host '    A. 把地址发给 AI，让它更新 API_BASE 并重跑 Pages'
Write-Host '    B. 自己改：'
Write-Host '       https://github.com/Y-yanxia/web-phase5-yyx/settings/variables/actions'
Write-Host '       把 API_BASE 改成上面的地址，再去 Actions 重跑 Deploy static site to Pages'
Write-Host ''
Write-Host '  验证：打开 https://y-yanxia.github.io/web-phase5-yyx/ 能加载出列表就成了'
Write-Host ''
Read-Host '按回车关闭本窗口（隧道会继续在后台跑）'

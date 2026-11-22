# 一键恢复线上：起后端 + 起云端隧道，并自动把公网地址复制到剪贴板
#
# 用法：双击本文件，或在项目目录执行
#   powershell -ExecutionPolicy Bypass -File .\scripts\start-online.ps1
#
# 做完三件事后脚本自己退出，隧道在后台继续跑：
#   1. 后端没起就起一个
#   2. 起 Cloudflare 快速隧道
#   3. 打印公网地址 + 存到 .cache\cf\last-url.txt + 复制到剪贴板

param([int]$Port = 3100)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$cfDir = Join-Path $root '.cache\cf'
New-Item -ItemType Directory -Force -Path $cfDir | Out-Null
$cf = Join-Path $cfDir 'cloudflared.exe'
$log = Join-Path $cfDir 'tunnel-live.log'
$urlFile = Join-Path $cfDir 'last-url.txt'

Write-Host ''
Write-Host '  一句话清单 · 恢复线上' -ForegroundColor Cyan
Write-Host '  -----------------------------' -ForegroundColor DarkGray

# ---------- 1. 后端 ----------
$alive = $false
try {
    $null = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
    $alive = $true
    Write-Host '  [1/3] 后端已在运行' -ForegroundColor Green
} catch { }

if (-not $alive) {
    Write-Host '  [1/3] 启动后端...' -ForegroundColor Yellow
    Start-Process -FilePath 'node' -ArgumentList 'server/index.js' -WorkingDirectory $root -WindowStyle Hidden
    for ($i = 0; $i -lt 25; $i++) {
        Start-Sleep -Milliseconds 700
        try {
            $null = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
            $alive = $true
            break
        } catch { }
    }
    if (-not $alive) {
        Write-Host '  后端没起来。先手动跑 npm start 看报错。' -ForegroundColor Red
        Write-Host '  常见原因：端口被占（可加 -Port 3200）、没装依赖（npm install）'
        Read-Host '按回车退出'
        exit 1
    }
    Write-Host '  [1/3] 后端已就绪' -ForegroundColor Green
}

# ---------- 2. 隧道 ----------
if (-not (Test-Path $cf)) {
    Write-Host '  [2/3] 缺少 cloudflared.exe' -ForegroundColor Red
    Write-Host '        国内镜像下载后保存到：'
    Write-Host "        $cf"
    Write-Host '        https://gh-proxy.com/https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
    Read-Host '按回车退出'
    exit 1
}

Write-Host '  [2/3] 启动隧道...' -ForegroundColor Yellow
Remove-Item $log -ErrorAction SilentlyContinue
Start-Process -FilePath $cf -ArgumentList @(
    'tunnel', '--url', "http://127.0.0.1:$Port", '--no-autoupdate', '--logfile', $log
) -WindowStyle Hidden | Out-Null

# ---------- 3. 等地址 ----------
$url = $null
for ($i = 0; $i -lt 45; $i++) {
    Start-Sleep -Milliseconds 1000
    if (Test-Path $log) {
        $m = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches | Select-Object -First 1
        if ($m) { $url = $m.Matches[0].Value; break }
    }
}

Write-Host ''
if (-not $url) {
    Write-Host '  [3/3] 没拿到地址，看日志：' -ForegroundColor Red
    Write-Host "        $log"
    Read-Host '按回车退出'
    exit 1
}

Set-Content -Path $urlFile -Value $url -Encoding ascii
try { Set-Clipboard -Value $url } catch { }

Write-Host '  [3/3] 好了，公网地址：' -ForegroundColor Green
Write-Host ''
Write-Host "        $url" -ForegroundColor Cyan
Write-Host ''
Write-Host '  已复制到剪贴板，也存到了：' -ForegroundColor DarkGray
Write-Host "  $urlFile" -ForegroundColor DarkGray
Write-Host ''
Write-Host '  接下来二选一：' -ForegroundColor Yellow
Write-Host '    A. 把地址发给 AI，让它更新 API_BASE 并重跑 Pages'
Write-Host '    B. 自己改：'
Write-Host '       https://github.com/Y-yanxia/web-phase5-yyx/settings/variables/actions'
Write-Host '       把 API_BASE 改成上面的地址，再去 Actions 重跑 Deploy static site to Pages'
Write-Host ''
Write-Host '  验证：打开 https://y-yanxia.github.io/web-phase5-yyx/ 能加载出列表就成了'
Write-Host ''
Read-Host '按回车关闭本窗口（隧道会继续在后台跑）'

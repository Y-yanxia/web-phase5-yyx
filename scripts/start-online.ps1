# 一键把本地服务挂到公网（免费，不需要账号）
# 用法：右键“使用 PowerShell 运行”，或在项目目录执行
#   powershell -ExecutionPolicy Bypass -File .\scripts\start-online.ps1
#
# 它会做三件事：
#   1. 后端没起就起一个（npm start 等价）
#   2. 起 Cloudflare 快速隧道，把本地端口映射成 https 地址
#   3. 把公网地址打印出来（把它填进仓库变量 API_BASE 即可）

param([int]$Port = 3100)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

# ---------- 1. 后端 ----------
$alive = $false
try {
    $null = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
    $alive = $true
} catch { $alive = $false }

if ($alive) {
    Write-Host "后端已在运行：http://127.0.0.1:$Port" -ForegroundColor Green
} else {
    Write-Host "启动后端..." -ForegroundColor Cyan
    Start-Process -FilePath "node" -ArgumentList "server/index.js" -WorkingDirectory $root -WindowStyle Minimized
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 800
        try {
            $null = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
            $alive = $true
            break
        } catch { }
    }
    if (-not $alive) {
        Write-Host "后端没起来，先手动跑 npm start 看看报错。" -ForegroundColor Red
        exit 1
    }
    Write-Host "后端已就绪" -ForegroundColor Green
}

# ---------- 2. 隧道 ----------
$cf = Join-Path $root '.cache\cf\cloudflared.exe'
if (-not (Test-Path $cf)) {
    Write-Host "缺少 cloudflared.exe。" -ForegroundColor Red
    Write-Host "下载（国内可用镜像）：" -ForegroundColor Yellow
    Write-Host "  https://gh-proxy.com/https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
    Write-Host "存到：$cf"
    exit 1
}

Write-Host ""
Write-Host "启动隧道，等 10~20 秒会出现 https://xxxx.trycloudflare.com ..." -ForegroundColor Cyan
Write-Host "把这个地址更新到 GitHub 仓库变量 API_BASE，再重跑 Pages 工作流即可。" -ForegroundColor Yellow
Write-Host ""

& $cf tunnel --url "http://127.0.0.1:$Port" --no-autoupdate

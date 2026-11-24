# 开机自动恢复线上：起后端 → 起隧道 → 拿新地址 → 自动更新 GitHub 变量并重跑 Pages
#
# 设计要点：
#   · 由“启动”文件夹里的快捷方式在登录后调用（隐藏窗口）
#   · 隧道地址每次开机都会变，所以脚本自己调 GitHub API 把 API_BASE 改掉
#   · GitHub token 从 Windows 凭据管理器（Git Credential Manager）现取，不落盘
#   · 隧道进程退出会自动重启，脚本本身常驻

param(
    [int]$Port = 3100,
    [string]$Repo = 'Y-yanxia/web-phase5-yyx'
)

$ErrorActionPreference = 'Continue'
# Windows PowerShell 5.1 默认用 TLS 1.0，GitHub 只收 1.2，不设这行会报“连接被关闭”
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$cfDir = Join-Path $root '.cache\cf'
New-Item -ItemType Directory -Force -Path $cfDir | Out-Null
$cf = Join-Path $cfDir 'cloudflared.exe'
$cfLog = Join-Path $cfDir 'auto-tunnel.log'
$appLog = Join-Path $cfDir 'auto-online.log'
$urlFile = Join-Path $cfDir 'last-url.txt'

function Write-Log([string]$msg) {
    $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    Add-Content -Path $appLog -Value $line -Encoding utf8
}

function Test-Backend {
    try {
        $null = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 3
        return $true
    } catch { return $false }
}

function Get-GitHubToken {
    # 从 Git Credential Manager 取已保存的 github.com 凭据（不写入磁盘）
    try {
        $git = (Get-Command git -ErrorAction Stop).Source
        $gitRoot = Split-Path (Split-Path $git -Parent) -Parent
        $candidates = @(
            (Join-Path $gitRoot 'ucrt64\bin\git-credential-manager.exe'),
            (Join-Path $gitRoot 'mingw64\bin\git-credential-manager.exe')
        )
        $gcm = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
        if (-not $gcm) { return $null }

        $input = "protocol=https`nhost=github.com`n`n"
        $out = ($input | & $gcm get 2>$null) -split "`n"
        $pw = ($out | Where-Object { $_ -match '^password=' }) -replace '^password=', ''
        return $pw.Trim()
    } catch {
        return $null
    }
}

function Update-Frontend([string]$url) {
    $token = Get-GitHubToken
    if (-not $token) { Write-Log '取不到 GitHub token，跳过前端切换'; return }

    $headers = @{
        Authorization          = "Bearer $token"
        'User-Agent'           = 'onelist-auto'
        Accept                 = 'application/vnd.github+json'
        'X-GitHub-Api-Version' = '2022-11-28'
        'Content-Type'         = 'application/json'
    }

    # 注意：这台机器的 PowerShell/.NET HTTPS 栈不可用（握手失败），
    # 所以真正发请求交给 Node（node 的 fetch 走自己的 TLS 实现，正常）。
    try {
        $env:GITHUB_TOKEN = $token
        $node = (Get-Command node -ErrorAction Stop).Source
        $out = & $node (Join-Path $root 'scripts\set-api-base.mjs') $Repo $url 2>&1
        Write-Log ("更新 GitHub：" + (($out | Select-Object -Last 3) -join ' | '))
    } catch {
        Write-Log "更新 GitHub 失败：$($_.Exception.Message)"
    }
}

Write-Log '==== 开机自恢复开始 ===='

# ---------- 后端 ----------
if (Test-Backend) {
    Write-Log "后端已在运行（端口 $Port）"
} else {
    Write-Log '启动后端…'
    Start-Process -FilePath 'node' -ArgumentList 'server/index.js' -WorkingDirectory $root -WindowStyle Hidden
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 800
        if (Test-Backend) { break }
    }
    if (Test-Backend) { Write-Log '后端就绪' } else { Write-Log '后端没起来，检查 npm start 的报错' }
}

# ---------- 隧道：常驻 + 掉线重启 ----------
if (-not (Test-Path $cf)) {
    Write-Log "缺少 $cf，退出"
    Read-Host '按回车退出'
    exit 1
}

while ($true) {
    Remove-Item $cfLog -ErrorAction SilentlyContinue
    Write-Log '启动隧道…'
    $proc = Start-Process -FilePath $cf -ArgumentList @(
        'tunnel', '--url', "http://127.0.0.1:$Port", '--protocol', 'http2', '--no-autoupdate', '--logfile', $cfLog
    ) -PassThru -WindowStyle Hidden

    $url = $null
    for ($i = 0; $i -lt 90; $i++) {
        Start-Sleep -Milliseconds 1000
        if (Test-Path $cfLog) {
            $m = Select-String -Path $cfLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches | Select-Object -First 1
            if ($m) { $url = $m.Matches[0].Value; break }
        }
        if ($proc.HasExited) { break }
    }

    if ($url) {
        Write-Log "隧道地址：$url"
        Set-Content -Path $urlFile -Value $url -Encoding ascii
        Start-Sleep -Seconds 3
        Update-Frontend $url
    } else {
        Write-Log '没拿到隧道地址，10 秒后重试'
    }

    # 常驻监控：quick tunnel 可能被云端清理（日志出现 Tunnel not found），
    # 但进程不一定退出，所以这里主动看门狗，连续两次异常就重启隧道。
    $bad = 0
    while (-not $proc.HasExited) {
        Start-Sleep -Seconds 60
        $tail = Get-Content $cfLog -Tail 20 -ErrorAction SilentlyContinue
        if (($tail -join "`n") -match 'Tunnel not found') {
            $bad++
            Write-Log "隧道异常（Tunnel not found）第 $bad 次"
            if ($bad -ge 2) {
                Write-Log '主动重启隧道'
                try { $proc.Kill() } catch { }
                break
            }
        } else {
            $bad = 0
        }
    }

    if (-not $proc.HasExited) { $proc.WaitForExit() }
    Write-Log '隧道退出，5 秒后重启'
    Start-Sleep -Seconds 5
}

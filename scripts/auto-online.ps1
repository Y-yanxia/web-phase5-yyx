# 开机自动恢复线上：起后端 → 起隧道 → 拿新地址 → 自动更新 GitHub 变量并重跑 Pages
#
# 设计要点：
#   · 由“启动”文件夹里的快捷方式在登录后调用（隐藏窗口）
#   · 隧道地址每次开机都会变，所以脚本自己调 GitHub API 把 API_BASE 改掉
#   · GitHub token 从 Windows 凭据管理器（Git Credential Manager）现取，不落盘
#   · 隧道进程退出会自动重启，脚本本身常驻

# 解决什么问题：quick tunnel 每次开机都换地址，Pages 上写死的 API_BASE 当天就废。
# 这个脚本登录后自动跑完整条链：起后端 → 起隧道 → 改 GitHub 变量 → 重跑 Pages。
#
# 怎么用：一般做成快捷方式丢进「启动」文件夹，开机自动跑，不用手动敲。
# 手动调试：powershell -ExecutionPolicy Bypass -File .\scripts\auto-online.ps1
# 端口不是 3100 就加 -Port 3200；仓库换人就加 -Repo owner/repo。
#
# 前置条件：
# · Node 24 和依赖已装（node_modules 在），否则后端根本起不来
# · .cache\cf\cloudflared.exe 已下载好，缺了脚本会直接退出
# · Git Credential Manager 里存过 github.com 凭据，脚本靠它现取 token
# · 不用先起服务：脚本自己探活，没起就帮你拉一个
#
# 产物（都在 .cache\cf\，出问题就翻这三个文件）：
# · auto-online.log 本脚本日志，每行带时间戳
# · auto-tunnel.log 是 cloudflared 的原文日志，隧道地址就在里面
# · last-url.txt 最后一次的隧道地址，人工排查时唯一线索
param(
    [int]$Port = 3100,
    [string]$Repo = 'Y-yanxia/web-phase5-yyx'
)

$ErrorActionPreference = 'Continue'
# Windows PowerShell 5.1 默认用 TLS 1.0，GitHub 只收 1.2，不设这行会报“连接被关闭”
# 但这台机器的 .NET HTTPS 本身是坏的，所以真正发请求还是交给 Node
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
# 快捷方式可能从任意目录唤起，先把项目根算出来再切过去
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

# 派生产物全塞 .cache\cf：日志、exe、地址一处打包，排查时不用满地找
$cfDir = Join-Path $root '.cache\cf'
New-Item -ItemType Directory -Force -Path $cfDir | Out-Null
$cf = Join-Path $cfDir 'cloudflared.exe'
$cfLog = Join-Path $cfDir 'auto-tunnel.log'
$appLog = Join-Path $cfDir 'auto-online.log'
$urlFile = Join-Path $cfDir 'last-url.txt'

# 无人值守的脚本只能靠日志复盘，所以每行都必须带时间戳
function Write-Log([string]$msg) {
    $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    Add-Content -Path $appLog -Value $line -Encoding utf8
}

# 探 /api/health 而不是看进程名：进程活着不等于端口真的能服务
function Test-Backend {
    try {
        $null = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 3
        return $true
    } catch { return $false }
}

# token 不落盘：GitHub 扫到明文 token 会直接吊销，只能现取现用
function Get-GitHubToken {
    # 从 Git Credential Manager 取已保存的 github.com 凭据（不写入磁盘）
    try {
        # GCM 是跟着 Git 装的，路径随安装方式变，所以从 git.exe 反推
        $git = (Get-Command git -ErrorAction Stop).Source
        $gitRoot = Split-Path (Split-Path $git -Parent) -Parent
        $candidates = @(
            # 两个常见 bin 目录都试一遍，都找不到就返回 null 让上层跳过
            (Join-Path $gitRoot 'ucrt64\bin\git-credential-manager.exe'),
            (Join-Path $gitRoot 'mingw64\bin\git-credential-manager.exe')
        )
        $gcm = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
        if (-not $gcm) { return $null }

        # GCM 的 get 协议：stdin 给 host，stdout 里挑 password= 那行
        $input = "protocol=https`nhost=github.com`n`n"
        $out = ($input | & $gcm get 2>$null) -split "`n"
        # token 就藏在 password 字段里，读它比让用户再输一遍省事
        $pw = ($out | Where-Object { $_ -match '^password=' }) -replace '^password=', ''
        return $pw.Trim()
    } catch {
        return $null
    }
}

# 更新 GitHub 只做两件事：改变量、重跑 Pages，逻辑都复用 Node 脚本
function Update-Frontend([string]$url) {
    $token = Get-GitHubToken
    if (-not $token) { Write-Log '取不到 GitHub token，跳过前端切换'; return }

    # 头先备着：GitHub 要 token 和版本头，缺一个就 401/403（真正调用在 Node 里）
    $headers = @{
        Authorization          = "Bearer $token"
        'User-Agent'           = 'onelist-auto'
        Accept                 = 'application/vnd.github+json'
        'X-GitHub-Api-Version' = '2022-11-28'
        'Content-Type'         = 'application/json'
    }

    # 注意：这台机器的 PowerShell/.NET HTTPS 栈不可用（握手失败），
    # 所以真正发请求交给 Node（node 的 fetch 走自己的 TLS 实现，正常）。
    # 顺带也复用 set-api-base.mjs：改变量和重跑 Pages 只维护一份逻辑
    try {
        $env:GITHUB_TOKEN = $token
        $node = (Get-Command node -ErrorAction Stop).Source
        $out = & $node (Join-Path $root 'scripts\set-api-base.mjs') $Repo $url 2>&1
        Write-Log ("更新 GitHub：" + (($out | Select-Object -Last 3) -join ' | '))
    } catch {
        # 失败只记日志不往外抛：隧道已经通了，地址还能手改，别把整条链带崩
        Write-Log "更新 GitHub 失败：$($_.Exception.Message)"
    }
}

Write-Log '==== 开机自恢复开始 ===='

# ---------- 后端 ----------
# 后端没起就拉一个，已经起了就复用，绝不重复起（抢端口还开两份库）
if (Test-Backend) {
    Write-Log "后端已在运行（端口 $Port）"
} else {
    Write-Log '启动后端…'
    # 隐藏窗口：开机自启要是弹黑框，用户第一反应就是把它关掉
    Start-Process -FilePath 'node' -ArgumentList 'server/index.js' -WorkingDirectory $root -WindowStyle Hidden
    # 最多等约 32 秒：冷启动要读配置、开库，起完立刻打肯定失败
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 800
        if (Test-Backend) { break }
    }
    # 起不来也往下走：隧道和日志先留着，人回来能看到卡在哪一步
    if (Test-Backend) { Write-Log '后端就绪' } else { Write-Log '后端没起来，检查 npm start 的报错' }
}

# ---------- 隧道：常驻 + 掉线重启 ----------
# 缺 cloudflared 就停：一直重试只会刷满日志，什么也修不好
if (-not (Test-Path $cf)) {
    Write-Log "缺少 $cf，退出"
    Read-Host '按回车退出'
    exit 1
}

# 常驻循环：quick tunnel 会被云端清理，脚本得负责把它重新拉起来
while ($true) {
    # 每轮先清日志：不然会读到上一轮的地址，GitHub 变量就改错了
    Remove-Item $cfLog -ErrorAction SilentlyContinue
    Write-Log '启动隧道…'
    # --protocol http2 更稳，--no-autoupdate 防止自动更新把 exe 换坏
    $proc = Start-Process -FilePath $cf -ArgumentList @(
        'tunnel', '--url', "http://127.0.0.1:$Port", '--protocol', 'http2', '--no-autoupdate', '--logfile', $cfLog
    ) -PassThru -WindowStyle Hidden

    # 地址只打在 cloudflared 日志里，所以只能盯日志抓 trycloudflare 域名
    $url = $null
    for ($i = 0; $i -lt 90; $i++) {
        Start-Sleep -Milliseconds 1000
        if (Test-Path $cfLog) {
            $m = Select-String -Path $cfLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches | Select-Object -First 1
            if ($m) { $url = $m.Matches[0].Value; break }
        }
        # 进程都退了就别干等，直接进下一轮重启
        if ($proc.HasExited) { break }
    }

    # 先写 URL 文件再改 GitHub：出问题时它是唯一的人工线索
    if ($url) {
        Write-Log "隧道地址：$url"
        Set-Content -Path $urlFile -Value $url -Encoding ascii
        # 隧道刚起来还不稳，等 3 秒再让 Pages 打过来，能少几次首屏 502
        Start-Sleep -Seconds 3
        Update-Frontend $url
    } else {
        # 没地址多半是网络被墙或 DNS 坏了，等 10 秒重来比人工干预快
        Write-Log '没拿到隧道地址，10 秒后重试'
    }

    # 常驻监控：quick tunnel 可能被云端清理（日志出现 Tunnel not found），
    # 但进程不一定退出，所以这里主动看门狗，连续两次异常就重启隧道。
    # 看日志是因为进程会假活：进程还在，隧道其实已经被云端判死了
    $bad = 0
    while (-not $proc.HasExited) {
        # 60 秒看一次：太勤刷日志，太疏断线后要等很久才恢复
        Start-Sleep -Seconds 60
        $tail = Get-Content $cfLog -Tail 20 -ErrorAction SilentlyContinue
        # 连续两次才算坏：一次可能只是抖动，重启反而打断刚恢复的连接
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

    # 进程没退说明是我们主动 kill 的，等它收摊，别留僵尸
    if (-not $proc.HasExited) { $proc.WaitForExit() }
    # 固定歇 5 秒：立刻重启容易撞上 Cloudflare 的限流
    Write-Log '隧道退出，5 秒后重启'
    Start-Sleep -Seconds 5
}

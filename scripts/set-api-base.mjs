// 更新仓库变量 API_BASE 并重跑 Pages 工作流
// 用法：GITHUB_TOKEN=xxx node scripts/set-api-base.mjs <owner/repo> <url>
//
// 解决什么问题：隧道地址每次重启都变，Pages 构建时读的 API_BASE 也得跟着换；
// 手点 Settings 太慢还容易改漏，这里一次做完「改变量 + 重跑 Pages」。
//
// 用法（token 从环境变量读：别写进命令行历史，更别提交）：
// GITHUB_TOKEN=xxx node scripts/set-api-base.mjs owner/repo https://xxx.trycloudflare.com
//
// 前置条件：token 要有这个仓库 Actions variables 的写权限；
// 仓库变量 API_BASE 要先在 Settings 里建好，不存在时 PATCH 会 404。
//
// 为什么要单独用 Node 发请求：这台机器的 PowerShell/.NET HTTPS 握手是坏的，
// 用 PowerShell 调 api.github.com 只会「连接被关闭」；Node 自带 TLS 实现，正常。
// 产物：远端变量被改 + 触发一次 Pages 工作流；本地不产生任何文件。
const [repo, url] = process.argv.slice(2);
// token 只从环境变量读：不进代码、不进 git，日志里也不会带
const token = process.env.GITHUB_TOKEN;

// 两个参数硬检查：repo 拼错就会去改别人的仓库，宁可先报错
if (!repo || !url) {
  console.error('usage: GITHUB_TOKEN=... node scripts/set-api-base.mjs <owner/repo> <url>');
  process.exit(1);
}
// 没 token 就别发请求了：401 的报错信息远不如这一句清楚
if (!token) {
  console.error('missing GITHUB_TOKEN');
  process.exit(1);
}

// GitHub 现在要求显式版本头：缺 X-GitHub-Api-Version 会被拒
const H = {
  Authorization: `Bearer ${token}`,
  'User-Agent': 'onelist-auto',
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
};

// 先改变量：不改变量只重跑 Pages，前端拿到的还是旧地址
const patch = await fetch(`https://api.github.com/repos/${repo}/actions/variables/API_BASE`, {
  method: 'PATCH',
  headers: H,
  body: JSON.stringify({ name: 'API_BASE', value: url }),
});
// 打印状态码：401/403/404 一眼能分出是 token、权限还是变量没建
console.log('PATCH API_BASE ->', patch.status);
// 失败时把 GitHub 的原文打出来：比只给状态码好定位
if (!patch.ok) {
  console.error(await patch.text());
  process.exit(1);
}

// 只改变量不会自动重建：必须再 dispatch 一次工作流才生效
const dispatch = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/pages.yml/dispatches`, {
  method: 'POST',
  headers: H,
  // 固定 main：Pages 工作流就在默认分支，dispatch 别的分支会跑空
  body: JSON.stringify({ ref: 'main' }),
});
console.log('dispatch Pages ->', dispatch.status);
if (!dispatch.ok) {
  console.error(await dispatch.text());
  process.exit(1);
}

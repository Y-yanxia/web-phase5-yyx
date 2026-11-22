// 更新仓库变量 API_BASE 并重跑 Pages 工作流
// 用法：GITHUB_TOKEN=xxx node scripts/set-api-base.mjs <owner/repo> <url>
const [repo, url] = process.argv.slice(2);
const token = process.env.GITHUB_TOKEN;

if (!repo || !url) {
  console.error('usage: GITHUB_TOKEN=... node scripts/set-api-base.mjs <owner/repo> <url>');
  process.exit(1);
}
if (!token) {
  console.error('missing GITHUB_TOKEN');
  process.exit(1);
}

const H = {
  Authorization: `Bearer ${token}`,
  'User-Agent': 'onelist-auto',
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
};

const patch = await fetch(`https://api.github.com/repos/${repo}/actions/variables/API_BASE`, {
  method: 'PATCH',
  headers: H,
  body: JSON.stringify({ name: 'API_BASE', value: url }),
});
console.log('PATCH API_BASE ->', patch.status);
if (!patch.ok) {
  console.error(await patch.text());
  process.exit(1);
}

const dispatch = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/pages.yml/dispatches`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({ ref: 'main' }),
});
console.log('dispatch Pages ->', dispatch.status);
if (!dispatch.ok) {
  console.error(await dispatch.text());
  process.exit(1);
}

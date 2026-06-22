/**
 * SnowLuma 头衔管理 WebUI - 公共工具函数
 */

/** POST JSON 请求 */
async function apiPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
}

/** GET 请求 */
async function apiGet(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Unauthorized');
  return res.json();
}

/** 拆分中文逗号 / 英文逗号分隔的列表 */
function splitList(val) {
  return val.split(/[，,]/).map(function (s) { return s.trim(); }).filter(Boolean);
}

/** Toast 提示 */
function showToast(msg, ok) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast ' + (ok ? 'toast-ok' : 'toast-err') + ' show';
  setTimeout(function () { el.classList.remove('show'); }, 2000);
}

/** 登出 */
async function doLogout() {
  await fetch('/api/logout', { method: 'POST' });
  location.reload();
}

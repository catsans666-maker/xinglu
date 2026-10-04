/* 行路台灣 中繼站（Cloudflare Worker）
 * 用途：把 TDX、TomTom 金鑰藏在這裡，網頁打開就能用；順便快取資料，減少 TDX 429。
 * 金鑰放在 Cloudflare 後台 → 這個 Worker → 設定 → 變數和密碼：
 *   TDX_ID       TDX Client Id
 *   TDX_SECRET   TDX Client Secret
 *   TOMTOM_KEY   TomTom API 金鑰
 * 路徑：
 *   /tdx/v2/...                → https://tdx.transportdata.tw/api/basic/v2/...
 *   /tomtom/{style}/{z}/{x}/{y}.png → TomTom 即時路況圖磚
 *   /tomtom-map/{main|night}/{z}/{x}/{y}.png → TomTom 底圖（中文）
 *   /health                    → 檢查金鑰有沒有設好
 *   /                          → 網頁本身（從 GitHub 抓最新的 index.html），所以這個網址就是行路台灣
 */
const ALLOWED_ORIGINS = ['https://catsans666-maker.github.io', 'http://localhost:8000', 'http://127.0.0.1:8000'];
const SITE = 'https://catsans666-maker.github.io/';
const TDX_BASE = 'https://tdx.transportdata.tw/api/basic';
const PAGE_URL = 'https://raw.githubusercontent.com/catsans666-maker/xinglu/main/index.html';
const TOKEN_URL = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';

// 快取秒數：即時資料短、站點線型長
function ttlFor(path) {
  if (/LiveBoard|EstimatedTimeOfArrival|Availability|LiveTraffic|RealTime/i.test(path)) return 15;
  if (/DailyTimetable/i.test(path)) return 600;
  return 6 * 3600;
}

let token = null, tokenExp = 0;   // 同一個 Worker 執行個體內共用 token
async function getToken(env, force) {
  if (!force && token && Date.now() < tokenExp - 60000) return token;
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_credentials&client_id=${encodeURIComponent(env.TDX_ID)}&client_secret=${encodeURIComponent(env.TDX_SECRET)}`,
  });
  if (!r.ok) throw new Error('token ' + r.status);
  const j = await r.json();
  token = j.access_token; tokenExp = Date.now() + (j.expires_in || 3600) * 1000;
  return token;
}

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
const json = (o, status, h) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...h } });

async function cached(request, ctx, ttl, make) {
  const cache = caches.default;
  const key = new Request(new URL(request.url).toString(), { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await make();
  if (res.ok) {
    const copy = new Response(res.body, res);
    copy.headers.set('Cache-Control', `public, max-age=${ttl}`);
    ctx.waitUntil(cache.put(key, copy.clone()));
    return copy;
  }
  return res;
}

async function handleTdx(url, request, env, ctx) {
  if (!env.TDX_ID || !env.TDX_SECRET) return json({ error: '中繼站還沒設定 TDX_ID／TDX_SECRET' }, 500);
  const path = url.pathname.slice('/tdx'.length);
  if (!/^\/v[0-9]\//.test(path)) return json({ error: '路徑錯誤' }, 400);
  const target = TDX_BASE + path + url.search;
  return cached(request, ctx, ttlFor(path), async () => {
    let tok = await getToken(env, false);
    let r = await fetch(target, { headers: { authorization: `Bearer ${tok}`, 'Accept-Encoding': 'gzip' } });
    if (r.status === 401) { tok = await getToken(env, true); r = await fetch(target, { headers: { authorization: `Bearer ${tok}` } }); }
    return new Response(r.body, { status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'application/json' } });
  });
}

async function handleTomTom(url, request, env, ctx) {
  if (!env.TOMTOM_KEY) return new Response('no key', { status: 500 });
  const m = url.pathname.match(/^\/tomtom\/(relative0|relative0-dark|relative|absolute)\/(\d+)\/(\d+)\/(\d+)\.png$/);
  if (!m) return new Response('bad path', { status: 400 });
  const target = `https://api.tomtom.com/traffic/map/4/tile/flow/${m[1]}/${m[2]}/${m[3]}/${m[4]}.png?key=${encodeURIComponent(env.TOMTOM_KEY)}&tileSize=512`;
  return cached(request, ctx, 60, async () => {
    const r = await fetch(target, { headers: { Referer: SITE } });   // 金鑰有開網域白名單也能用
    return new Response(r.body, { status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'image/png' } });
  });
}

async function handlePage(request, ctx) {
  return cached(request, ctx, 60, async () => {
    const r = await fetch(PAGE_URL, { cf: { cacheTtl: 60 } });
    if (!r.ok) return new Response('網頁抓不到（GitHub 回 ' + r.status + '）', { status: 502, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    return new Response(r.body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  });
}

async function handleTomTomMap(url, request, env, ctx) {
  if (!env.TOMTOM_KEY) return new Response('no key', { status: 500 });
  const m = url.pathname.match(/^\/tomtom-map\/(main|night)\/(\d+)\/(\d+)\/(\d+)\.png$/);
  if (!m) return new Response('bad path', { status: 400 });
  const target = `https://api.tomtom.com/map/1/tile/basic/${m[1]}/${m[2]}/${m[3]}/${m[4]}.png?key=${encodeURIComponent(env.TOMTOM_KEY)}&tileSize=512&language=zh-TW&view=Unified`;
  return cached(request, ctx, 86400, async () => {
    const r = await fetch(target, { headers: { Referer: SITE } });
    return new Response(r.body, { status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'image/png' } });
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return handlePage(request, ctx);
    const origin = request.headers.get('Origin') || '';
    const sites = [...ALLOWED_ORIGINS, url.origin];   // 網頁就放在中繼站本身時，同網址也算自己人
    const allowed = sites.includes(origin);
    const isTile = url.pathname.startsWith('/tomtom/') || url.pathname.startsWith('/tomtom-map/');
    // 同網址的請求、<img> 載入的圖磚，常常不帶 Origin；改看 Referer
    const ref = request.headers.get('Referer') || '';
    const okRef = sites.some((o) => ref.startsWith(o + '/'));
    if (request.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers: allowed ? cors(origin) : {} });
    if (url.pathname === '/health') {
      return json({ tdx: !!(env.TDX_ID && env.TDX_SECRET), tomtom: !!env.TOMTOM_KEY }, 200, allowed ? cors(origin) : {});
    }
    // 只讓自己的網站用（擋掉別的網站盜用；直接用程式打的人擋不住，但門檻高很多）
    if (!(allowed || okRef)) return json({ error: '不允許的來源' }, 403);
    const h = allowed ? cors(origin) : { 'Access-Control-Allow-Origin': '*' };
    let res;
    try {
      if (url.pathname.startsWith('/tdx/')) res = await handleTdx(url, request, env, ctx);
      else if (url.pathname.startsWith('/tomtom-map/')) res = await handleTomTomMap(url, request, env, ctx);
      else if (isTile) res = await handleTomTom(url, request, env, ctx);
      else res = json({ error: '找不到' }, 404);
    } catch (e) {
      res = json({ error: '中繼站錯誤：' + (e.message || e) }, 502);
    }
    const out = new Response(res.body, res);
    Object.entries(h).forEach(([k, v]) => out.headers.set(k, v));
    return out;
  },
};

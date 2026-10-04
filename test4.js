// 中繼站：沒自己的金鑰時改走中繼站；自己的金鑰優先
const assert = require('assert');
const C = require('./core.js');
(async () => {
  const store = new Map();
  const ls = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  let relay = '';
  const calls = [];
  let reply = () => ({ status: 200, ok: true, json: async () => ['ok'] });
  const cl = C.createClient({ storage: ls, gapMs: 1, retry429: [], relay: () => relay, fetch: async (url, o) => { calls.push({ url, o }); return reply(url, o); } });
  assert.ok(!cl.ready());
  await assert.rejects(cl.get('/v2/a'), (e) => e.kind === 'nokey');
  relay = 'https://r.example.workers.dev/';
  assert.ok(cl.ready() && cl.usingRelay());
  assert.deepStrictEqual(await cl.get('/v2/Rail/TRA/Station', { $top: 1 }), ['ok']);
  assert.strictEqual(calls[0].url, 'https://r.example.workers.dev/tdx/v2/Rail/TRA/Station?%24format=JSON&%24top=1');
  assert.ok(!calls[0].o.headers, '走中繼站不送 token');
  reply = () => ({ status: 500, ok: false, json: async () => ({ error: '中繼站還沒設定 TDX_ID／TDX_SECRET' }) });
  await assert.rejects(cl.get('/v2/b'), (e) => e.kind === 'relay' && e.message.includes('TDX_ID'));
  // 自己的金鑰優先
  cl.setKey('me', 'sec');
  assert.ok(!cl.usingRelay());
  let n = 0;
  reply = (url) => (n++ === 0 ? { status: 200, ok: true, json: async () => ({ access_token: 'T', expires_in: 9999 }) } : { status: 200, ok: true, json: async () => ['direct'] });
  assert.deepStrictEqual(await cl.get('/v2/c'), ['direct']);
  assert.ok(calls.at(-1).url.startsWith(C.BASE) && calls.at(-1).o.headers.authorization === 'Bearer T');
  assert.strictEqual(C.tomtomRelayUrl('https://r.dev/', true), 'https://r.dev/tomtom/relative-delay/{z}/{x}/{y}.png');
  assert.strictEqual(C.tomtomRelayUrl('', false), null);
  console.log('中繼站用戶端測試通過');
})().catch((e) => { console.error('失敗', e); process.exit(1); });

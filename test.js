const assert = require('assert');
const C = require('./core.js');
const store = new Map();
const ls = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k,v)=>store.set(k,String(v)), removeItem: k=>store.delete(k) };
let calls = [], script = [];
const resp = (status, body) => ({ status, ok: status < 400, json: async () => body });
const fetchMock = async (url, opt) => { calls.push(url); const f = script.shift(); if (!f) throw new Error('no script for '+url); return f(url,opt); };
(async () => {
  // 純函式
  assert.deepStrictEqual(C.wktToGeometry('LINESTRING(121.5 25.0, 121.6 25.1)'), {type:'LineString',coordinates:[[121.5,25],[121.6,25.1]]});
  const m = C.wktToGeometry('MULTILINESTRING((121.5 25.0,121.6 25.1),(121.7 25.2, 121.8 25.3))');
  assert.strictEqual(m.type,'MultiLineString'); assert.strictEqual(m.coordinates.length,2);
  assert.strictEqual(C.wktToGeometry('POINT(1 2)'), null);
  const tp = C.COUNTIES.find(c=>c.code==='Taipei'), ntp = C.COUNTIES.find(c=>c.code==='NewTaipei'), hc=C.COUNTIES.find(c=>c.code==='Hsinchu');
  assert.ok(C.addressInCounty('100230台北市中正區北平西路3號', tp));
  assert.ok(!C.addressInCounty('220新北市板橋區', tp));
  assert.ok(C.addressInCounty('220新北市板橋區', ntp));
  assert.ok(!C.addressInCounty('302新竹縣竹北市', hc));
  assert.strictEqual(C.COUNTIES.length, 22);
  assert.deepStrictEqual(C.busEtaText({StopStatus:0,EstimateTime:30}), {text:'進站中',level:'now'});
  assert.deepStrictEqual(C.busEtaText({StopStatus:0,EstimateTime:150}), {text:'2 分',level:'soon'});
  assert.deepStrictEqual(C.busEtaText({StopStatus:0,EstimateTime:900}), {text:'15 分',level:'later'});
  assert.strictEqual(C.busEtaText({StopStatus:3}).text,'末班已過');
  assert.strictEqual(C.busEtaText(undefined).text,'—');
  const now = new Date(2026,9,3,14,30);
  const up = C.thsrUpcoming([
    {TrainNo:'0603',Direction:0,DepartureTime:'14:20',EndingStationName:{Zh_tw:'左營'}},
    {TrainNo:'0605',Direction:0,DepartureTime:'14:45',EndingStationName:{Zh_tw:'左營'}},
    {TrainNo:'0604',Direction:1,DepartureTime:'15:05',EndingStationName:{Zh_tw:'南港'}},
    {TrainNo:'0609',Direction:0,DepartureTime:'14:35',EndingStationName:{Zh_tw:'臺南'}},
  ], now);
  assert.deepStrictEqual(up[0].map(x=>x.no), ['0609','0605']);
  assert.deepStrictEqual(up[1].map(x=>x.no), ['0604']);
  assert.strictEqual(C.ymd(now),'2026-10-03');
  assert.deepStrictEqual(C.pos({PositionLon:0,PositionLat:0}), null);

  // 用戶端
  const cl = C.createClient({ storage: ls, fetch: fetchMock, gapMs: 1, retry429: [] });
  await assert.rejects(cl.get('/v2/x'), e => e.kind === 'nokey');
  cl.setKey(' id1 ', ' sec ');
  assert.strictEqual(cl.buildUrl('/v2/Bike/Station/City/Taipei',{$top:1}), C.BASE+'/v2/Bike/Station/City/Taipei?%24format=JSON&%24top=1');
  script.push((u,o)=>{ assert.ok(o.body.includes('client_id=id1')); return resp(200,{access_token:'T1',expires_in:86400}); });
  script.push((u,o)=>{ assert.strictEqual(o.headers.authorization,'Bearer T1'); return resp(200,[{a:1}]); });
  assert.deepStrictEqual(await cl.get('/v2/a',null,60), [{a:1}]);
  // 快取命中不再呼叫
  const n0 = calls.length; await cl.get('/v2/a',null,60); assert.strictEqual(calls.length, n0);
  // 401 → 換 token 重試
  script.push(()=>resp(401,{}));
  script.push(()=>resp(200,{access_token:'T2',expires_in:86400}));
  script.push((u,o)=>{ assert.strictEqual(o.headers.authorization,'Bearer T2'); return resp(200,[2]); });
  assert.deepStrictEqual(await cl.get('/v2/b'), [2]);
  // 429 / 404 / 網路錯誤 分類，且佇列不卡死
  script.push(()=>resp(429,{}));
  script.push(()=>resp(404,{}));
  script.push(()=>{ throw new TypeError('Failed to fetch'); });
  script.push(()=>resp(200,['ok']));
  const r = await Promise.allSettled([cl.get('/v2/c'), cl.get('/v2/d'), cl.get('/v2/e'), cl.get('/v2/f')]);
  assert.strictEqual(r[0].reason.kind,'quota'); assert.strictEqual(r[1].reason.kind,'notfound');
  assert.strictEqual(r[2].reason.kind,'network'); assert.deepStrictEqual(r[3].value,['ok']);
  // 錯誤 token
  cl.setKey('bad','bad');
  script.push(()=>resp(401,{error:'invalid_client'}));
  await assert.rejects(cl.get('/v2/g'), e => e.kind==='auth');
  assert.ok(cl.log.length > 5 && !JSON.stringify(cl.log).includes('sec'));
  // 中文路線名編碼
  assert.ok(C.EP.busEta('City/Taipei','紅30').endsWith('%E7%B4%8530'));
  console.log('全部測試通過', calls.length, '次模擬呼叫');
})().catch(e=>{ console.error('失敗', e); process.exit(1); });

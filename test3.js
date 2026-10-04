// Dispatch 新增的函式＋這次新增的 429 重試、TomTom 網址
const assert = require('assert');
const C = require('./core.js');
(async () => {
  // inPolygon / countyAt
  const sq = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]] };
  assert.ok(C.inPolygon([1, 1], sq));
  assert.ok(!C.inPolygon([5, 5], sq), '洞裡不算');
  assert.ok(!C.inPolygon([11, 1], sq));
  const mp = { type: 'MultiPolygon', coordinates: [[[[20, 20], [21, 20], [21, 21], [20, 21], [20, 20]]], sq.coordinates] };
  assert.ok(C.inPolygon([20.5, 20.5], mp) && C.inPolygon([1, 1], mp));
  const feats = [{ geometry: sq, properties: { code: 'A' } }, { geometry: mp, properties: { code: 'B' } }];
  assert.strictEqual(C.countyAt([1, 1], feats), 'A');
  assert.strictEqual(C.countyAt([20.5, 20.5], feats), 'B');
  assert.strictEqual(C.countyAt([50, 50], feats), null);
  // metroAdultFare
  assert.strictEqual(C.metroAdultFare({ Fares: [{ FareClass: 4, Price: 12 }, { FareClass: 1, TicketType: 1, Price: 25 }] }), 25);
  assert.strictEqual(C.metroAdultFare({ Fares: [{ FareClass: 1, Price: 20 }] }), 20);
  assert.strictEqual(C.metroAdultFare({}), null);
  // busFareInfo：307 型態（一個緩衝區＝兩段）
  const stops = ['撫遠街', 'A', 'B', '萬大國小', 'C', '中和國稅局', 'D', '板橋'];
  const fare = [{ SectionFares: [{ Fares: [{ FareClass: 1, TicketType: 1, Price: 15 }], BufferZones: [{ Direction: 0, FareBufferZoneOrigin: { StopName: '萬大國小' }, FareBufferZoneDestination: { StopName: '中和國稅局' } }] }] }];
  let f = C.busFareInfo(fare, 0, stops, 0, 7);
  assert.strictEqual(f.per, 15); assert.strictEqual(f.total, 2); assert.strictEqual(f.ride, 2, '跨過整個緩衝區＝兩段');
  f = C.busFareInfo(fare, 0, stops, 0, 4);
  assert.strictEqual(f.ride, 1, '下車在緩衝區內＝一段');
  f = C.busFareInfo(fare, 0, stops, 4, 7);
  assert.strictEqual(f.ride, 1, '上車在緩衝區內＝一段');
  assert.deepStrictEqual(C.busFareInfo([{ IsFreeBus: 1 }], 0), { free: true });
  assert.strictEqual(C.busFareInfo([], 0), null);
  // metroTravel：A-B-C 一條線，B 與 X 同名（轉乘），X-Y 另一條線
  const rows = [
    { TravelTimes: [{ FromStationID: 'L1', ToStationID: 'L2', FromStationName: { Zh_tw: '甲' }, ToStationName: { Zh_tw: '乙' }, RunTime: 120, StopTime: 30 },
      { FromStationID: 'L2', ToStationID: 'L3', FromStationName: { Zh_tw: '乙' }, ToStationName: { Zh_tw: '丙' }, RunTime: 100, StopTime: 20 }] },
    { TravelTimes: [{ FromStationID: 'M1', ToStationID: 'M2', FromStationName: { Zh_tw: '乙' }, ToStationName: { Zh_tw: '丁' }, RunTime: 200, StopTime: 0 }] },
  ];
  assert.deepStrictEqual(C.metroTravel(rows, '甲', '丙'), { sec: 270, transfers: 0 });
  assert.deepStrictEqual(C.metroTravel(rows, '甲', '丁'), { sec: 150 + 300 + 200, transfers: 1 });
  assert.deepStrictEqual(C.metroTravel(rows, '丁', '甲'), { sec: 650, transfers: 1 }, '反方向一樣');
  assert.strictEqual(C.metroTravel(rows, '甲', '不存在'), null);
  // fmtAddr
  assert.strictEqual(C.fmtAddr({ city: '新北市', suburb: '泰山區', road: '貴子路', house_number: '69' }), '新北市泰山區貴子路69號');
  assert.strictEqual(C.fmtAddr({ city: '台北市', suburb: '中正區', road: '忠孝西路' }), '臺北市中正區忠孝西路');
  assert.strictEqual(C.fmtAddr(null), '');
  // TomTom
  assert.strictEqual(C.tomtomFlowUrl('', false), null);
  assert.strictEqual(C.tomtomFlowUrl('ab c', false), 'https://api.tomtom.com/traffic/map/4/tile/flow/relative-delay/{z}/{x}/{y}.png?key=ab%20c&tileSize=512&thickness=4');
  assert.ok(C.tomtomFlowUrl('k', true).includes('/relative-delay/'));
  assert.strictEqual(C.tomtomMapUrl('k', false), 'https://api.tomtom.com/map/1/tile/basic/main/{z}/{x}/{y}.png?key=k&tileSize=512&language=zh-TW&view=Unified');
  assert.ok(C.tomtomMapUrl('k', true).includes('/basic/night/'));
  assert.strictEqual(C.tomtomMapUrl('', true), null);
  assert.strictEqual(C.tomtomMapRelayUrl('https://r.dev/', true), 'https://r.dev/tomtom-map/night/{z}/{x}/{y}.png');
  // 429：等一下重試成功、通知等待秒數、重試用完才報錯
  const store = new Map();
  const ls = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const resp = (status, body) => ({ status, ok: status < 400, json: async () => body });
  let script = [];
  const waits = [];
  const cl = C.createClient({ storage: ls, fetch: async () => script.shift()(), gapMs: 1, slowGapMs: 1, retry429: [5, 6, 7], onThrottle: (ms) => waits.push(ms) });
  cl.setKey('id', 'sec');
  script.push(() => resp(200, { access_token: 'T', expires_in: 86400 }));
  script.push(() => resp(429, {}));
  script.push(() => resp(429, {}));
  script.push(() => resp(200, ['ok']));
  assert.deepStrictEqual(await cl.get('/v2/x'), ['ok']);
  assert.deepStrictEqual(waits, [5, 6]);
  script.push(() => resp(429, {})); script.push(() => resp(429, {})); script.push(() => resp(429, {})); script.push(() => resp(429, {}));
  await assert.rejects(cl.get('/v2/y'), (e) => e.kind === 'quota');
  assert.deepStrictEqual(waits, [5, 6, 5, 6, 7]);
  script.push(() => resp(200, ['after']));
  assert.deepStrictEqual(await cl.get('/v2/z'), ['after'], '報錯後佇列不卡死');
  console.log('Dispatch 新函式＋429＋TomTom 測試通過');
})().catch((e) => { console.error('失敗', e); process.exit(1); });

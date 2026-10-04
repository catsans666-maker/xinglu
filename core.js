/* ====== 核心邏輯：TDX 介接、資料轉換（不碰 DOM，可在 node 測試） ====== */
(function (root) {
  'use strict';

  const BASE = 'https://tdx.transportdata.tw/api/basic';
  const TOKEN_URL = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';

  // ---- 22 縣市：TDX 城市代碼、中文名、預設視角（[經度,緯度], 縮放） ----
  const COUNTIES = [
    { code: 'Taipei', name: '臺北市', c: [121.55, 25.06], z: 11.4, metro: ['TRTC', 'TYMC'] },
    { code: 'NewTaipei', name: '新北市', c: [121.6, 25.0], z: 9.5, metro: ['TRTC', 'NTDLRT', 'NTALRT', 'NTMC', 'TYMC'] },
    { code: 'Keelung', name: '基隆市', c: [121.72, 25.12], z: 11.5, metro: [] },
    { code: 'Taoyuan', name: '桃園市', c: [121.22, 24.93], z: 10.2, metro: ['TYMC'] },
    { code: 'Hsinchu', name: '新竹市', c: [120.96, 24.79], z: 11.8, metro: [] },
    { code: 'HsinchuCounty', name: '新竹縣', c: [121.15, 24.7], z: 9.9, metro: [] },
    { code: 'MiaoliCounty', name: '苗栗縣', c: [120.95, 24.48], z: 9.8, metro: [] },
    { code: 'Taichung', name: '臺中市', c: [120.85, 24.23], z: 9.6, metro: ['TMRT'] },
    { code: 'ChanghuaCounty', name: '彰化縣', c: [120.48, 23.99], z: 10.1, metro: [] },
    { code: 'NantouCounty', name: '南投縣', c: [120.98, 23.84], z: 9.2, metro: [] },
    { code: 'YunlinCounty', name: '雲林縣', c: [120.4, 23.71], z: 10, metro: [] },
    { code: 'Chiayi', name: '嘉義市', c: [120.45, 23.48], z: 12.2, metro: [] },
    { code: 'ChiayiCounty', name: '嘉義縣', c: [120.55, 23.45], z: 9.7, metro: [] },
    { code: 'Tainan', name: '臺南市', c: [120.32, 23.15], z: 9.8, metro: [] },
    { code: 'Kaohsiung', name: '高雄市', c: [120.55, 22.95], z: 9.2, metro: ['KRTC', 'KLRT'] },
    { code: 'PingtungCounty', name: '屏東縣', c: [120.62, 22.55], z: 9.2, metro: [] },
    { code: 'YilanCounty', name: '宜蘭縣', c: [121.65, 24.6], z: 9.8, metro: [] },
    { code: 'HualienCounty', name: '花蓮縣', c: [121.4, 23.75], z: 8.8, metro: [] },
    { code: 'TaitungCounty', name: '臺東縣', c: [121.05, 22.85], z: 8.8, metro: [] },
    { code: 'PenghuCounty', name: '澎湖縣', c: [119.6, 23.57], z: 10.3, metro: [] },
    { code: 'KinmenCounty', name: '金門縣', c: [118.37, 24.45], z: 11, metro: [] },
    { code: 'LienchiangCounty', name: '連江縣', c: [119.95, 26.16], z: 10.4, metro: [] },
  ];

  // 捷運／輕軌營運代碼 → 顯示名稱、預設顏色（TDX 沒給顏色時用）
  const METRO_OPS = {
    TRTC: { name: '臺北捷運', color: '#0070bd' },
    TYMC: { name: '桃園機場捷運', color: '#8246af' },
    NTDLRT: { name: '淡海輕軌', color: '#d6006f' },
    NTALRT: { name: '安坑輕軌', color: '#c3b091' },
    NTMC: { name: '新北捷運', color: '#ffdb00' },
    TMRT: { name: '臺中捷運', color: '#8ec31f' },
    KRTC: { name: '高雄捷運', color: '#e2211c' },
    KLRT: { name: '高雄輕軌', color: '#7cbd52' },
  };

  // 所有 API 路徑集中在這裡；TDX 改版時只改這裡
  const EP = {
    metroStation: (op) => `/v2/Rail/Metro/Station/${op}`,
    metroShape: (op) => `/v2/Rail/Metro/Shape/${op}`,
    metroLine: (op) => `/v2/Rail/Metro/Line/${op}`,
    metroLive: (op) => `/v2/Rail/Metro/LiveBoard/${op}`,
    traStation: () => `/v2/Rail/TRA/Station`,
    traLive: (id) => `/v2/Rail/TRA/LiveBoard/Station/${id}`,
    thsrStation: () => `/v2/Rail/THSR/Station`,
    thsrDaily: (id, date) => `/v2/Rail/THSR/DailyTimetable/Station/${id}/${date}`,
    bikeStation: (city) => `/v2/Bike/Station/City/${city}`,
    bikeAvail: (city) => `/v2/Bike/Availability/City/${city}`,
    busRoute: (scope) => `/v2/Bus/Route/${scope}`,
    busStops: (scope, r) => `/v2/Bus/StopOfRoute/${scope}/${encodeURIComponent(r)}`,
    busShape: (scope, r) => `/v2/Bus/Shape/${scope}/${encodeURIComponent(r)}`,
    busEta: (scope, r) => `/v2/Bus/EstimatedTimeOfArrival/${scope}/${encodeURIComponent(r)}`,
    // 票價／行車時間（2026/10/4 實測 200）
    metroFare: (op) => `/v2/Rail/Metro/ODFare/${op}`,
    metroTime: (op) => `/v2/Rail/Metro/S2STravelTime/${op}`,
    busFare: (scope, r) => `/v2/Bus/RouteFare/${scope}/${encodeURIComponent(r)}`,
  };

  // ---- 點在不在多邊形裡（GeoJSON Polygon／MultiPolygon，射線法） ----
  function inRing(pt, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function inPolygon(pt, geom) {
    if (!geom) return false;
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
    return polys.some((rings) => rings.length && inRing(pt, rings[0]) && !rings.slice(1).some((h) => inRing(pt, h)));
  }
  // 從縣市邊界找出某點所在縣市代碼；不在任何縣市（海上）回 null
  function countyAt(pt, features) {
    const f = (features || []).find((x) => inPolygon(pt, x.geometry));
    return f ? f.properties.code : null;
  }

  // ---- 票價 ----
  // 捷運：ODFare 的 Fares 裡 FareClass 1＝全票（台北車站→板橋 25 元，與現行票價相符）
  function metroAdultFare(odRow) {
    const f = (odRow?.Fares || []).find((x) => x.FareClass === 1 && (x.TicketType === 1 || x.TicketType == null));
    return f ? f.Price : null;
  }
  // 公車段次票：每段全票價、全線分幾段、這趟跨了幾段
  //   stopNames：目前方向的站名（依站序）；from/to：上下車站在 stopNames 的索引
  function busFareInfo(fareRows, dir, stopNames, from, to) {
    const rows = fareRows || [];
    if (!rows.length) return null;
    if (rows.some((r) => r.IsFreeBus === 1)) return { free: true };
    const row = rows.find((r) => (r.SectionFares || []).some((s) => (s.BufferZones || []).some((z) => z.Direction === dir))) || rows[0];
    const sec = (row.SectionFares || [])[0];
    if (!sec) return { unsupported: true };
    const per = (sec.Fares || []).find((x) => x.FareClass === 1 && x.TicketType === 1) || (sec.Fares || []).find((x) => x.FareClass === 1);
    if (!per) return { unsupported: true };
    const zones = (sec.BufferZones || []).filter((z) => z.Direction == null || z.Direction === dir || !(sec.BufferZones || []).some((y) => y.Direction === dir));
    const total = zones.length + 1;
    let ride = null;
    if (from != null && to != null && stopNames) {
      ride = 1;
      let known = true;
      zones.forEach((z) => {
        const a = stopNames.indexOf(z.FareBufferZoneOrigin?.StopName), b = stopNames.indexOf(z.FareBufferZoneDestination?.StopName);
        if (a < 0 || b < 0) { known = false; return; }
        const lo = Math.min(a, b), hi = Math.max(a, b);
        if (from < lo && to > hi) ride++;
      });
      if (!known) ride = null;
    }
    return { per: per.Price, total, ride, zones: zones.map((z) => [z.FareBufferZoneOrigin?.StopName, z.FareBufferZoneDestination?.StopName]) };
  }

  // ---- 捷運行車時間：S2STravelTime 建圖，同名不同代碼的站視為轉乘（轉乘時間用估計值） ----
  function metroTravel(rows, fromName, toName, transferSec = 300) {
    const adj = new Map(), nameOf = new Map();
    const add = (a, b, w) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push([b, w]); };
    (rows || []).forEach((r) => (r.TravelTimes || []).forEach((t) => {
      const w = (t.RunTime || 0) + (t.StopTime || 0);
      add(t.FromStationID, t.ToStationID, w); add(t.ToStationID, t.FromStationID, w);
      nameOf.set(t.FromStationID, zh(t.FromStationName)); nameOf.set(t.ToStationID, zh(t.ToStationName));
    }));
    const byName = new Map();
    nameOf.forEach((n, id) => { if (!byName.has(n)) byName.set(n, []); byName.get(n).push(id); });
    byName.forEach((ids) => ids.forEach((a) => ids.forEach((b) => { if (a !== b) add(a, b, transferSec + 0.001); })));
    const starts = byName.get(fromName) || [], goals = new Set(byName.get(toName) || []);
    if (!starts.length || !goals.size) return null;
    const best = new Map(starts.map((s) => [s, 0])), xfer = new Map(starts.map((s) => [s, 0]));
    const todo = new Set(starts);
    while (todo.size) {
      let u = null;
      todo.forEach((v) => { if (u == null || best.get(v) < best.get(u)) u = v; });
      todo.delete(u);
      if (goals.has(u)) return { sec: Math.round(best.get(u)), transfers: xfer.get(u) };
      (adj.get(u) || []).forEach(([v, w]) => {
        const d = best.get(u) + w;
        if (!best.has(v) || d < best.get(v)) { best.set(v, d); xfer.set(v, xfer.get(u) + (w % 1 ? 1 : 0)); todo.add(v); }
      });
    }
    return null;
  }

  // ---- Nominatim 地址 → 台灣慣用寫法（縣市＋區＋路＋門牌） ----
  function fmtAddr(a) {
    if (!a) return '';
    const city = a.city || a.county || a.state || '';
    const dist = a.suburb || a.city_district || a.town || a.district || '';
    const road = a.road || a.pedestrian || a.footway || '';
    const no = a.house_number ? (/號$/.test(a.house_number) ? a.house_number : a.house_number + '號') : '';
    return normTW([city, dist, road, no].filter(Boolean).join(''));
  }

  // ---- 小工具 ----
  const normTW = (s) => (s || '').replace(/台/g, '臺');
  const zh = (o) => (o && (o.Zh_tw || o.zh_tw)) || (typeof o === 'string' ? o : '');
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  // 地址屬於哪個縣市（用中文名比對，台/臺 視為相同）
  function addressInCounty(addr, county) {
    return normTW(addr).includes(county.name);
  }

  // WKT → GeoJSON 幾何（支援 LINESTRING / MULTILINESTRING）
  function wktToGeometry(wkt) {
    if (!wkt || typeof wkt !== 'string') return null;
    const s = wkt.trim().toUpperCase();
    const parseLine = (txt) => txt.split(',').map((p) => p.trim().split(/\s+/).map(Number).slice(0, 2))
      .filter((p) => p.length === 2 && p.every(Number.isFinite));
    if (s.startsWith('MULTILINESTRING')) {
      const inner = wkt.slice(wkt.indexOf('(') + 1, wkt.lastIndexOf(')'));
      const parts = inner.match(/\(([^()]*)\)/g) || [];
      const coords = parts.map((p) => parseLine(p.slice(1, -1))).filter((l) => l.length > 1);
      return coords.length ? { type: 'MultiLineString', coordinates: coords } : null;
    }
    if (s.startsWith('LINESTRING')) {
      const inner = wkt.slice(wkt.indexOf('(') + 1, wkt.lastIndexOf(')'));
      const c = parseLine(inner);
      return c.length > 1 ? { type: 'LineString', coordinates: c } : null;
    }
    return null;
  }

  // 公車到站文字＋狀態等級
  function busEtaText(e) {
    if (!e) return { text: '—', level: 'none' };
    const st = e.StopStatus;
    if (st === 1) return { text: '尚未發車', level: 'none' };
    if (st === 2) return { text: '交管不停靠', level: 'none' };
    if (st === 3) return { text: '末班已過', level: 'none' };
    if (st === 4) return { text: '今日未營運', level: 'none' };
    const sec = e.EstimateTime;
    if (sec == null) return { text: '—', level: 'none' };
    if (sec <= 60) return { text: '進站中', level: 'now' };
    const m = Math.floor(sec / 60);
    if (m <= 3) return { text: `${m} 分`, level: 'soon' };
    return { text: `${m} 分`, level: 'later' };
  }

  // 高鐵：從當日時刻表挑出「現在之後」的班次，依方向分組
  function thsrUpcoming(rows, now, perDir = 6) {
    const mins = now.getHours() * 60 + now.getMinutes();
    const toMin = (t) => { const [h, m] = (t || '').split(':').map(Number); return h * 60 + m; };
    const out = { 0: [], 1: [] };
    (rows || []).forEach((r) => {
      const info = r.DailyTrainInfo || r;
      const st = r.StopTime || r;
      const dep = st.DepartureTime || st.ArrivalTime;
      if (!dep || toMin(dep) < mins) return;
      const dir = info.Direction === 1 ? 1 : 0;
      out[dir].push({ no: info.TrainNo, dep, end: zh(info.EndingStationName) });
    });
    [0, 1].forEach((d) => { out[d].sort((a, b) => toMin(a.dep) - toMin(b.dep)); out[d] = out[d].slice(0, perDir); });
    return out;
  }

  // ---- TDX 用戶端：token 快取、排隊節流、錯誤分類、呼叫紀錄 ----
  function createClient(opts) {
    const store = opts.storage;           // 類 localStorage 物件
    const fetchFn = opts.fetch;
    const log = [];                       // 最近呼叫紀錄（給診斷面板）
    const listeners = new Set();
    const cache = new Map();              // 記憶體快取：url → {t, data}
    let queue = Promise.resolve();
    const GAP_MS = opts.gapMs ?? 500;     // 每次呼叫間隔，避免撞額度（300ms 實測會撞到 429）
    const RETRY = opts.retry429 ?? [5000, 10000, 20000];   // 429 時依序等多久再試
    const SLOW_GAP = opts.slowGapMs ?? 1500;               // 被擋過之後 60 秒內放慢節奏
    let slowUntil = 0;
    const gap = () => (Date.now() < slowUntil ? Math.max(GAP_MS, SLOW_GAP) : GAP_MS);

    const sget = (k) => { try { return store.getItem(k); } catch { return null; } };
    const sset = (k, v) => { try { store.setItem(k, v); } catch { /* 存不了就算了 */ } };
    const sdel = (k) => { try { store.removeItem(k); } catch { /* 忽略 */ } };

    function getKey() {
      return { id: sget('tdx.id') || '', secret: sget('tdx.secret') || '' };
    }
    // 中繼站：沒填自己的金鑰時，經過中繼站（金鑰藏在那邊）
    const relay = () => (typeof opts.relay === 'function' ? opts.relay() : opts.relay || '').replace(/\/$/, '');
    const usingRelay = () => !getKey().id && !!relay();
    const ready = () => !!getKey().id || !!relay();
    function setKey(id, secret) {
      sset('tdx.id', id.trim()); sset('tdx.secret', secret.trim()); sdel('tdx.token'); sdel('tdx.exp');
    }
    function record(entry) {
      log.unshift({ t: new Date(), ...entry });
      if (log.length > 40) log.pop();
      listeners.forEach((fn) => fn(log));
    }

    class TdxError extends Error {
      constructor(kind, msg, status) { super(msg); this.kind = kind; this.status = status; }
    }

    async function getToken(force) {
      const tok = sget('tdx.token');
      const exp = Number(sget('tdx.exp') || 0);
      if (!force && tok && Date.now() < exp - 60000) return tok;
      const { id, secret } = getKey();
      if (!id || !secret) throw new TdxError('nokey', '尚未設定 TDX 金鑰');
      let res;
      try {
        res = await fetchFn(TOKEN_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: `grant_type=client_credentials&client_id=${encodeURIComponent(id)}&client_secret=${encodeURIComponent(secret)}`,
        });
      } catch (e) {
        record({ url: 'TOKEN', status: 'ERR', ms: 0, note: String(e.message || e) });
        throw new TdxError('network', '取得 token 失敗：連不上 TDX（網路或瀏覽器擋跨網域）');
      }
      record({ url: 'TOKEN', status: res.status, ms: 0 });
      if (!res.ok) throw new TdxError('auth', `金鑰驗證失敗（HTTP ${res.status}），請檢查 Client Id／Secret`, res.status);
      const j = await res.json();
      sset('tdx.token', j.access_token);
      sset('tdx.exp', String(Date.now() + (j.expires_in || 3600) * 1000));
      return j.access_token;
    }

    // 組網址：自動加 $format=JSON，其餘 OData 參數照給
    function buildUrl(path, params) {
      const q = Object.assign({ $format: 'JSON' }, params || {});
      const qs = Object.entries(q).filter(([, v]) => v != null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
      return `${BASE}${path}?${qs}`;
    }

    async function rawGet(url, retried, n429 = 0) {
      const viaRelay = usingRelay();
      if (!viaRelay && !getKey().id) throw new TdxError('nokey', '尚未設定 TDX 金鑰');
      const token = viaRelay ? null : await getToken(false);
      const target = viaRelay ? url.replace(BASE, relay() + '/tdx') : url;
      const t0 = Date.now();
      let res;
      try {
        res = await fetchFn(target, viaRelay ? {} : { headers: { authorization: `Bearer ${token}`, 'Accept-Encoding': 'gzip' } });
      } catch (e) {
        record({ url: target, status: 'ERR', ms: Date.now() - t0, note: String(e.message || e) });
        throw new TdxError('network', viaRelay ? '連不上中繼站（網路斷線，或中繼站網址錯誤）' : '連線失敗（網路斷線，或瀏覽器擋跨網域）');
      }
      record({ url: target, status: res.status, ms: Date.now() - t0 });
      if (viaRelay && (res.status === 403 || res.status === 500 || res.status === 502)) {
        let msg = ''; try { msg = (await res.json()).error || ''; } catch { /* 不是 JSON */ }
        throw new TdxError('relay', `中繼站錯誤（HTTP ${res.status}）${msg ? '：' + msg : ''}`, res.status);
      }
      if (res.status === 401 && !retried && !viaRelay) { await getToken(true); return rawGet(url, true, n429); }
      // 429＝呼叫太密（TDX 依會員方案限制頻率，確切上限不知道；實測連打 3～4 次就會被擋約 20～30 秒）
      //   等 5、10、20 秒各重試一次，還是不行才報錯。排隊是一個接一個，所以重試期間其他呼叫也會等，不會越打越多
      if (res.status === 429) slowUntil = Date.now() + 60000;
      if (res.status === 429 && n429 < RETRY.length) {
        opts.onThrottle?.(RETRY[n429]);
        await new Promise((r) => setTimeout(r, RETRY[n429]));
        return rawGet(url, retried, n429 + 1);
      }
      if (res.status === 429) throw new TdxError('quota', '超過 TDX 呼叫額度，稍等再試', 429);
      if (res.status === 404) throw new TdxError('notfound', '這個資料 TDX 沒有提供（404）', 404);
      if (!res.ok) throw new TdxError('http', `TDX 回應錯誤 HTTP ${res.status}`, res.status);
      return res.json();
    }

    // get：排隊執行；ttl 秒內同網址直接用快取
    function get(path, params, ttl = 0) {
      const url = buildUrl(path, params);
      const hit = cache.get(url);
      if (ttl > 0 && hit && Date.now() - hit.t < ttl * 1000) return Promise.resolve(hit.data);
      // 資料一到就交出去；間隔只拿來延後「下一個」呼叫（原本連結果也一起晚 0.5～1.5 秒才出來）
      const job = queue.then(() => rawGet(url, false));
      const sleep = () => new Promise((r) => setTimeout(r, gap()));
      queue = job.then(sleep, sleep);
      return job.then((data) => { cache.set(url, { t: Date.now(), data }); return data; });
    }

    return { get, getKey, setKey, getToken, log, onLog: (fn) => listeners.add(fn), buildUrl, TdxError, ready, usingRelay, relay };
  }

  // ---- 資料轉 GeoJSON ----
  const pos = (p) => (p && Number.isFinite(p.PositionLon) && Number.isFinite(p.PositionLat) && p.PositionLon !== 0)
    ? [p.PositionLon, p.PositionLat] : null;

  function pointsFC(rows, mapFn) {
    const features = [];
    (rows || []).forEach((r) => { const f = mapFn(r); if (f && f.geometry && f.geometry.coordinates) features.push(f); });
    return { type: 'FeatureCollection', features };
  }

  // ---- 幾何：距離（公尺）、點到折線距離、沿線插值 ----
  const R = 6371008.8;
  const rad = (d) => d * Math.PI / 180;
  function dist(a, b) {
    const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  // 點到線段距離：在當地做等距投影（短距離誤差可忽略）
  function distToLine(p, coords) {
    if (!coords || coords.length < 2) return Infinity;
    const kx = Math.cos(rad(p[1])) * R * Math.PI / 180, ky = R * Math.PI / 180;
    let best = Infinity;
    for (let i = 0; i < coords.length - 1; i++) {
      const ax = (coords[i][0] - p[0]) * kx, ay = (coords[i][1] - p[1]) * ky;
      const bx = (coords[i + 1][0] - p[0]) * kx, by = (coords[i + 1][1] - p[1]) * ky;
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
      const x = ax + t * dx, y = ay + t * dy;
      best = Math.min(best, Math.hypot(x, y));
    }
    return best;
  }
  // 點投影到折線上：s＝從起點沿線走幾公尺、d＝離線多遠（測速照相用：判斷「在前方路線上多遠」）
  function projectOnLine(p, coords) {
    if (!coords || coords.length < 2) return { s: 0, d: Infinity };
    const kx = Math.cos(rad(p[1])) * R * Math.PI / 180, ky = R * Math.PI / 180;
    let best = { s: 0, d: Infinity }, acc = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      const ax = (coords[i][0] - p[0]) * kx, ay = (coords[i][1] - p[1]) * ky;
      const bx = (coords[i + 1][0] - p[0]) * kx, by = (coords[i + 1][1] - p[1]) * ky;
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, len = Math.sqrt(L);
      const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (d < best.d) best = { s: acc + t * len, d };
      acc += len;
    }
    return best;
  }
  // 沿折線走 m 公尺後的位置與方位角
  function alongLine(coords, m) {
    let acc = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      const d = dist(coords[i], coords[i + 1]);
      if (acc + d >= m) {
        const t = d ? (m - acc) / d : 0;
        const p = [coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t, coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t];
        return { p, bearing: bearing(coords[i], coords[i + 1]), done: false };
      }
      acc += d;
    }
    const n = coords.length;
    return { p: coords[n - 1], bearing: n > 1 ? bearing(coords[n - 2], coords[n - 1]) : 0, done: true };
  }
  function bearing(a, b) {
    const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
    const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  function fmtDist(m) {
    if (!Number.isFinite(m)) return '—';
    if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} 公尺`;
    return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} 公里`;
  }
  function fmtDur(s) {
    const m = Math.max(1, Math.round(s / 60));
    if (m < 60) return `${m} 分鐘`;
    return `${Math.floor(m / 60)} 小時 ${m % 60} 分`;
  }

  // ---- 導航指示（OSRM 轉彎 → 中文＋圖示代號） ----
  const MOD = {
    left: '左轉', right: '右轉', 'slight left': '靠左', 'slight right': '靠右',
    'sharp left': '向左急轉', 'sharp right': '向右急轉', uturn: '迴轉', straight: '直行',
  };
  function maneuverText(step) {
    const m = (step && step.maneuver) || {};
    // Google 路線本身就有中文指示，直接用
    if (step && step.instr) return { text: m.type === 'arrive' ? '抵達目的地' : step.instr, icon: m.type === 'arrive' ? 'arrive' : m.type === 'roundabout' ? 'roundabout' : (m.modifier || 'straight'), name: step.name || '' };
    const mod = m.modifier || 'straight';
    const name = step.name || step.ref || '';
    const into = name ? `，進入${name}` : '';
    let text, icon = mod;
    switch (m.type) {
      case 'depart': text = name ? `沿${name}出發` : '出發'; icon = 'straight'; break;
      case 'arrive': text = '抵達目的地'; icon = 'arrive'; break;
      case 'new name': text = name ? `繼續沿${name}` : '繼續直行'; icon = 'straight'; break;
      case 'continue': text = (mod === 'straight' ? '繼續直行' : MOD[mod] || '繼續') + into; break;
      case 'merge': text = `匯入${name || '道路'}`; break;
      case 'on ramp': text = `駛入匝道${name ? '往' + name : ''}`; break;
      case 'off ramp': text = `駛出匝道${into}`; break;
      case 'fork': text = `於岔路${/left/.test(mod) ? '靠左' : /right/.test(mod) ? '靠右' : '直行'}${into}`; break;
      case 'end of road': text = `路底${/left/.test(mod) ? '左轉' : '右轉'}${into}`; break;
      case 'roundabout': case 'rotary': text = `進入圓環，從第 ${m.exit || 1} 個出口離開${into}`; icon = 'roundabout'; break;
      case 'exit roundabout': case 'exit rotary': text = `駛出圓環${into}`; break;
      default: text = (MOD[mod] || '繼續') + into;
    }
    return { text, icon, name };
  }


  // ---- Google Routes（Route 類別）→ 跟 OSRM 一樣的格式，導航程式不用改 ----
  // Google maneuver 代號 → OSRM 的 type／modifier
  function googleManeuver(g) {
    const k = String(g || '').toUpperCase();
    const side = /LEFT/.test(k) ? 'left' : /RIGHT/.test(k) ? 'right' : 'straight';
    if (k === 'DEPART') return { type: 'depart', modifier: 'straight' };
    if (/ROUNDABOUT/.test(k)) return { type: 'roundabout', modifier: side };
    if (/UTURN/.test(k)) return { type: 'turn', modifier: 'uturn' };
    if (/SHARP/.test(k)) return { type: 'turn', modifier: 'sharp ' + side };
    if (/SLIGHT|KEEP/.test(k)) return { type: 'turn', modifier: 'slight ' + side };
    if (/FORK/.test(k)) return { type: 'fork', modifier: 'slight ' + side };
    if (/RAMP/.test(k)) return { type: 'on ramp', modifier: 'slight ' + side };
    if (/MERGE/.test(k)) return { type: 'merge', modifier: 'straight' };
    if (/TURN/.test(k)) return { type: 'turn', modifier: side };
    if (k === 'NAME_CHANGE') return { type: 'new name', modifier: 'straight' };
    return { type: 'continue', modifier: 'straight' };
  }
  // LatLng／LatLngAltitude／{lat,lng} 都吃
  const llOf = (p) => {
    if (!p) return null;
    const lat = typeof p.lat === 'function' ? p.lat() : p.lat ?? p.latitude;
    const lng = typeof p.lng === 'function' ? p.lng() : p.lng ?? p.longitude;
    return Number.isFinite(lat) && Number.isFinite(lng) ? [lng, lat] : null;
  };
  const txt = (v) => (v == null ? '' : typeof v === 'string' ? v : v.text || '');
  const secOf = (o) => (o.durationMillis != null ? o.durationMillis / 1000 : o.staticDurationMillis != null ? o.staticDurationMillis / 1000 : 0);
  const VEHICLE = { BUS: '公車', INTERCITY_BUS: '客運', TROLLEYBUS: '公車', SUBWAY: '捷運', METRO_RAIL: '捷運', LIGHT_RAIL: '輕軌', TRAM: '輕軌', MONORAIL: '捷運',
    HEAVY_RAIL: '火車', COMMUTER_TRAIN: '火車', RAIL: '火車', HIGH_SPEED_TRAIN: '高鐵', LONG_DISTANCE_TRAIN: '火車', FERRY: '渡輪', CABLE_CAR: '纜車', GONDOLA_LIFT: '纜車', FUNICULAR: '纜車', SHARE_TAXI: '計程車' };
  function fromGoogleRoute(r) {
    const coords = (r.path || []).map(llOf).filter(Boolean);
    const steps = [], segs = [];
    (r.legs || []).forEach((leg) => (leg.steps || []).forEach((st) => {
      const sc = (st.path || []).map(llOf).filter(Boolean);
      const ni = st.navigationInstruction || {};
      const dist = st.distanceMeters || 0, dur = secOf(st);
      const td = st.transitDetails;
      if (td) {
        const line = td.transitLine || {}, veh = line.vehicle || {};
        const vt = String(veh.type || '').toUpperCase();
        segs.push({ kind: 'transit', vehicle: VEHICLE[vt] || txt(veh.name) || '大眾運輸', vtype: vt,
          line: line.nameShort || line.shortName || line.name || '', lineName: line.name || '', color: line.color || '#0a84ff', textColor: line.textColor || '#fff',
          from: td.departureStop?.name || '', to: td.arrivalStop?.name || '', fromP: llOf(td.departureStop?.location), toP: llOf(td.arrivalStop?.location),
          stops: td.stopCount || 0, headsign: td.headsign || '', dep: td.departureTime || null, arr: td.arrivalTime || null,
          depText: txt(td.localizedValues?.departureTime?.time || td.localizedValues?.departureTime), coords: sc, distance: dist, duration: dur });
        return;
      }
      const last = segs[segs.length - 1];
      if (last && last.kind === 'walk') { last.distance += dist; last.duration += dur; last.coords.push(...sc); last.n++; }
      else segs.push({ kind: 'walk', distance: dist, duration: dur, coords: sc.slice(), n: 1 });
      steps.push({ maneuver: { ...googleManeuver(ni.maneuver), location: sc[0] || coords[0] }, instr: ni.instructions || '', name: '', distance: dist, duration: dur });
    }));
    if (coords.length) {
      if (!steps.length || steps[0].maneuver.type !== 'depart') steps.unshift({ maneuver: { type: 'depart', modifier: 'straight', location: coords[0] }, instr: '出發', name: '', distance: 0, duration: 0 });
      else steps[0].maneuver.type = 'depart';
      steps.push({ maneuver: { type: 'arrive', modifier: 'straight', location: coords[coords.length - 1] }, instr: '抵達目的地', name: '', distance: 0, duration: 0 });
    }
    const fare = txt(r.localizedValues?.transitFare) || txt(r.travelAdvisory?.transitFare?.text) || null;
    return { coords, steps, segs, distance: r.distanceMeters || 0, duration: secOf(r),
      durText: txt(r.localizedValues?.duration), fare, src: 'google' };
  }

  // ---- YouTube 網址解析 ----
  function parseYouTube(input) {
    const s = (input || '').trim();
    if (/^[\w-]{11}$/.test(s)) return { videoId: s };
    let u;
    try { u = new URL(s.startsWith('http') ? s : 'https://' + s); } catch { return null; }
    const host = u.hostname.replace(/^www\.|^m\.|^music\./, '');
    const list = u.searchParams.get('list') || undefined;
    let id;
    if (host === 'youtu.be') id = u.pathname.slice(1, 12);
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      id = u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|live|embed|v)\/([\w-]{11})/) || [])[1];
    } else return null;
    if (id && !/^[\w-]{11}$/.test(id)) id = undefined;
    if (!id && !list) return null;
    return { videoId: id, listId: list };
  }

  // ---- 天氣代碼（Open-Meteo WMO）→ 中文＋圖示 ----
  function weatherInfo(code) {
    if (code === 0) return { text: '晴', icon: 'sun' };
    if (code <= 2) return { text: '晴時多雲', icon: 'partly' };
    if (code === 3) return { text: '陰', icon: 'cloud' };
    if (code === 45 || code === 48) return { text: '霧', icon: 'fog' };
    if (code >= 51 && code <= 57) return { text: '毛毛雨', icon: 'rain' };
    if (code >= 61 && code <= 67) return { text: '雨', icon: 'rain' };
    if (code >= 71 && code <= 77) return { text: '雪', icon: 'snow' };
    if (code >= 80 && code <= 82) return { text: '陣雨', icon: 'rain' };
    if (code >= 95) return { text: '雷雨', icon: 'storm' };
    return { text: '—', icon: 'cloud' };
  }

  // ---- TomTom 即時路況圖磚（Traffic Flow raster，版本 4） ----
  function tomtomFlowUrl(key, dark) {
    if (!key) return null;
    return `https://api.tomtom.com/traffic/map/4/tile/flow/relative-delay/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}&tileSize=512&thickness=4`;
  }

  // TomTom 底圖（Map Display raster）：中文標籤、512px 圖塞進 256 格＝手機上清楚；view=Unified（中立畫法）
  function tomtomMapUrl(key, dark) {
    if (!key) return null;
    return `https://api.tomtom.com/map/1/tile/basic/${dark ? 'night' : 'main'}/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}&tileSize=512&language=zh-TW&view=Unified`;
  }
  function tomtomMapRelayUrl(relay, dark) {
    if (!relay) return null;
    return `${relay.replace(/\/$/, '')}/tomtom-map/${dark ? 'night' : 'main'}/{z}/{x}/{y}.png`;
  }
  function tomtomRelayUrl(relay, dark) {
    if (!relay) return null;
    return `${relay.replace(/\/$/, '')}/tomtom/relative-delay/{z}/{x}/{y}.png`;
  }

  const Core = {
    COUNTIES, METRO_OPS, EP, BASE, TOKEN_URL,
    normTW, zh, ymd, addressInCounty, wktToGeometry, busEtaText, thsrUpcoming, createClient, pos, pointsFC,
    dist, distToLine, projectOnLine, alongLine, bearing, fmtDist, fmtDur, maneuverText, parseYouTube, weatherInfo,
    inPolygon, countyAt, metroAdultFare, busFareInfo, metroTravel, fmtAddr, tomtomFlowUrl, tomtomRelayUrl, tomtomMapUrl, tomtomMapRelayUrl,
    googleManeuver, fromGoogleRoute, llOf,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.Core = Core;
})(typeof window !== 'undefined' ? window : globalThis);

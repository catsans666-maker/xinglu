/* ====== 介面：地圖、交通圖層、抽屜、導航、YouTube、時間天氣 ====== */
(function () {
  'use strict';
  const C = window.Core;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isWide = () => window.innerWidth >= 900;
  const isMobileDevice = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

  // ---------- 儲存（被擋時不讓整頁掛掉） ----------
  const LS = {
    getItem(k) { try { return localStorage.getItem(k); } catch { return null; } },
    setItem(k, v) { try { localStorage.setItem(k, v); } catch { /* 忽略 */ } },
    removeItem(k) { try { localStorage.removeItem(k); } catch { /* 忽略 */ } },
  };
  // TDX 被擋（429）時跳提示，讓人知道不是當機，是在等
  // 中繼站網址：設定裡填的優先，其次是網頁裡寫死的 window.XINGLU_RELAY（在 index.html 最上面改）
  //   網頁直接從中繼站（*.workers.dev）打開時，中繼站就是自己
  const selfRelay = /\.workers\.dev$/.test(location.hostname) ? location.origin : '';
  const relayUrl = () => (LS.getItem('relay') || window.XINGLU_RELAY || selfRelay || '').trim().replace(/\/$/, '');
  const tdx = C.createClient({ storage: LS, fetch: (...a) => fetch(...a), relay: relayUrl, onThrottle: (ms) => toast(`TDX 呼叫太密被擋，${Math.round(ms / 1000)} 秒後自動重試`) });

  // 非 TDX 的外部呼叫也記進連線紀錄
  function logExt(url, status, note) {
    tdx.log.unshift({ t: new Date(), url, status, ms: 0, note });
    if (tdx.log.length > 40) tdx.log.pop();
    if (!$('#logDlg').hidden) renderLog();
  }
  async function getJSON(url, label) {
    let r;
    try { r = await fetch(url); } catch (e) { logExt(url, 'ERR', String(e.message || e)); throw new Error(`${label}連線失敗`); }
    logExt(url, r.status);
    if (!r.ok) throw new Error(`${label}回應錯誤（HTTP ${r.status}）`);
    return r.json();
  }

  // 靜態資料快取在本機，省 TDX 額度
  async function cachedGet(path, params, days) {
    const key = 'c:' + tdx.buildUrl(path, params);
    try {
      const raw = localStorage.getItem(key);
      if (raw) { const o = JSON.parse(raw); if (Date.now() - o.t < days * 864e5) return o.d; }
    } catch { /* 快取壞了就重抓 */ }
    const d = await tdx.get(path, params);
    try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), d })); } catch { /* 容量滿就不存 */ }
    return d;
  }

  const LINE_COLORS = { BL: '#0070bd', R: '#e3002c', G: '#008659', O: '#f8b61c', BR: '#c48c31', Y: '#fedb00', A: '#8246af', V: '#d6006f', K: '#c3b091', C: '#7cbd52', LB: '#5bb5e6' };
  const linePrefix = (id) => (id || '').replace(/\d+[A-Za-z]?$/, '');   // BL12→BL、R22A→R、A14a→A
  const lineColor = (op, id) => LINE_COLORS[linePrefix(id)] || C.METRO_OPS[op]?.color || '#666';
  const LINE_NAMES = {
    'TRTC:BL': '板南線', 'TRTC:R': '淡水信義線', 'TRTC:G': '松山新店線', 'TRTC:O': '中和新蘆線', 'TRTC:BR': '文湖線',
    'TYMC:A': '機場捷運', 'NTMC:Y': '環狀線', 'NTMC:LB': '三鶯線', 'NTDLRT:V': '淡海輕軌', 'NTALRT:K': '安坑輕軌',   // LB＝三鶯線是推論（站代碼字首）
    'KRTC:R': '紅線', 'KRTC:O': '橘線', 'KLRT:C': '環狀輕軌', 'TMRT:G': '綠線',
  };
  const lineName = (op, ln) => LINE_NAMES[op + ':' + ln] || `${C.METRO_OPS[op]?.name || op} ${ln} 線`;
  const LAYER_NAMES = { metro: '捷運', tra: '台鐵', thsr: '高鐵', bike: 'YouBike', bus: '公車' };
  const LAYER_IDS = {
    metro: ['metro-lines', 'metro-st', 'metro-st-label'], tra: ['tra-st', 'tra-st-label'], thsr: ['thsr-st', 'thsr-st-label'],
    bike: ['bike-cluster', 'bike-pt', 'bike-cluster-n'], bus: ['bus-line', 'bus-st'],
  };

  // ---------- 狀態 ----------
  const S = {
    // YouBike 預設不畫（那堆黃色數字圈太雜），選「YouBike」才顯示
    county: null, layers: { metro: true, tra: true, thsr: true, bike: false, bus: true }, status: {},
    metroByOp: {}, bus: null, timers: [], view: 'home', qMode: 'place',
    nav: null, me: null, voice: LS.getItem('voice') !== '0',
  };

  // ---------- 圖示 ----------
  const ICON = {
    straight: '<path d="M12 21V4M6 10l6-6 6 6"/>',
    right: '<path d="M6 21v-8a4 4 0 0 1 4-4h10M15 4l5 5-5 5"/>',
    'slight right': '<path d="M8 21v-7l9-9M10 5h7v7"/>',
    'sharp right': '<path d="M7 3v9a5 5 0 0 0 5 5h0l6-6M18 17v-6h-6"/>',
    uturn: '<path d="M16 21V9a5 5 0 0 0-10 0v4M2.5 10 6 13.5 9.5 10"/>',
    roundabout: '<circle cx="12" cy="10" r="5"/><path d="M12 15v6M17 10h4M18 6l3 4-3 4"/>',
    arrive: '<path d="M12 21s-7-6.3-7-12a7 7 0 0 1 14 0c0 5.7-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  };
  function arrowSvg(icon) {
    const left = /left/.test(icon);
    const key = icon.replace('left', 'right');
    const body = ICON[key] || ICON[icon] || ICON.straight;
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"${left ? ' style="transform:scaleX(-1)"' : ''}>${body}</svg>`;
  }
  const WX = {
    sun: '<circle cx="12" cy="12" r="4.5" fill="#ffcc00"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" stroke="#ffcc00" stroke-width="2" stroke-linecap="round"/>',
    partly: '<circle cx="9" cy="9" r="4" fill="#ffcc00"/><path d="M8 20h9a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.4 1.8A3.2 3.2 0 0 0 8 20z" fill="currentColor" opacity=".85"/>',
    cloud: '<path d="M7 19h10a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.5 2A3.6 3.6 0 0 0 7 19z" fill="currentColor" opacity=".85"/>',
    fog: '<path d="M4 9h16M3 13h18M5 17h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    rain: '<path d="M7 15h10a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.5 2A3.6 3.6 0 0 0 7 15z" fill="currentColor" opacity=".85"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3" stroke="#0a84ff" stroke-width="2" stroke-linecap="round"/>',
    snow: '<path d="M7 15h10a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.5 2A3.6 3.6 0 0 0 7 15z" fill="currentColor" opacity=".85"/><circle cx="8" cy="19" r="1.2" fill="currentColor"/><circle cx="12" cy="20" r="1.2" fill="currentColor"/><circle cx="16" cy="19" r="1.2" fill="currentColor"/>',
    storm: '<path d="M7 14h10a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.5 2A3.6 3.6 0 0 0 7 14z" fill="currentColor" opacity=".85"/><path d="M13 14l-3 4h4l-2 4" stroke="#ffcc00" stroke-width="2" fill="none" stroke-linejoin="round"/>',
  };

  // ======================================================
  // 地圖
  // ======================================================
  // 底圖：預設內政部國土測繪中心「臺灣通用電子地圖」（政府官方、台灣在地道路與門牌最完整）
  //   三種底圖都放在同一個樣式裡，切換只改顯示，不必重載交通圖層
  const NLSC = (layer) => `https://wmts.nlsc.gov.tw/wmts/${layer}/default/GoogleMapsCompatible/{z}/{y}/{x}`;
  const BASEMAPS = {
    tomtom: { name: 'TomTom 地圖', note: '商業圖資・最新、全中文、深色有夜間版', attr: '© TomTom' },
    emap: { name: '臺灣通用電子地圖', note: '內政部國土測繪中心・資料較新', attr: '© 內政部國土測繪中心' },
    photo: { name: '正射航照（衛星）', note: '內政部國土測繪中心', attr: '© 內政部國土測繪中心' },
    vector: { name: '向量地圖', note: 'OpenStreetMap・旋轉時字保持正、深色好看', attr: '© OpenStreetMap · OpenFreeMap' },
    osm: { name: 'OpenStreetMap', note: '全球開放地圖', attr: '© OpenStreetMap' },
  };
  const RASTERS = ['tomtom', 'emap', 'photo', 'osm'];
  // TomTom 底圖：有自己的 TomTom 金鑰或中繼站才有
  const hasTT = () => !!(LS.getItem('tt.key') || relayUrl());
  const ttMapUrl = (dark) => (LS.getItem('tt.key') ? C.tomtomMapUrl(LS.getItem('tt.key'), dark) : C.tomtomMapRelayUrl(relayUrl(), dark));
  const BASE_STYLE = {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      emap: { type: 'raster', tiles: [NLSC('EMAP')], tileSize: 256, maxzoom: 19 },
      photo: { type: 'raster', tiles: [NLSC('PHOTO2')], tileSize: 256, maxzoom: 19 },
      osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19 },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#eef0f2' } },
      { id: 'bm-emap', type: 'raster', source: 'emap', layout: { visibility: 'none' } },
      { id: 'bm-photo', type: 'raster', source: 'photo', layout: { visibility: 'none' } },
      { id: 'bm-osm', type: 'raster', source: 'osm', layout: { visibility: 'none' } },
    ],
  };
  let hasGlyphs = true, map;
  // ---------- Google 地圖（有金鑰就用 Google；沒有就用開放地圖） ----------
  const gCfg = () => ({ key: (LS.getItem('g.key') || window.XINGLU_GOOGLE?.key || '').trim(), mapId: (LS.getItem('g.mapId') || window.XINGLU_GOOGLE?.mapId || '').trim() });
  let G = false;                        // Google 地圖載入成功才會變 true
  const MK = () => (G ? GM.Marker : maplibregl.Marker);
  const GBASES = { roadmap: { name: '地圖', note: 'Google 地圖・店家、餐廳、便利商店' }, hybrid: { name: '衛星', note: 'Google 衛星空照＋路名' } };
  let gBase = GBASES[LS.getItem('g.base')] ? LS.getItem('g.base') : 'roadmap';
  let gTraffic = null;                  // google.maps.TrafficLayer
  // ---------- Google 錯誤翻成白話（Google 只會在 console 印英文代號） ----------
  const SITE_RULE = () => location.origin + (location.pathname.replace(/[^/]*$/, '') || '/') + '*';
  const G_ERR = {
    ApiNotActivatedMapError: () => '「Maps JavaScript API」還沒啟用',
    ApiProjectMapError: () => '金鑰所屬專案沒啟用 Maps JavaScript API，或還沒開帳單',
    BillingNotEnabledMapError: () => '專案還沒開帳單：Google 規定要綁卡（每月免費額度內不收錢）',
    RefererNotAllowedMapError: () => `金鑰的「網站限制」沒包含這個網址，請加入 ${SITE_RULE()}`,
    InvalidKeyMapError: () => '金鑰錯了（複製時少字或多了空白）',
    MissingKeyMapError: () => '沒有帶金鑰',
    ExpiredKeyMapError: () => '金鑰過期或被刪掉了，重新建一把',
    DeletedApiProjectMapError: () => '金鑰所屬的專案被刪除了',
    OverQuotaMapError: () => '超過用量上限（你設的每日上限或免費額度）',
    ApiTargetBlockedMapError: () => '金鑰的「API 限制」沒勾 Maps JavaScript API',
  };
  S.gErr = null;
  ['error', 'warn'].forEach((lv) => {
    const orig = console[lv].bind(console);
    console[lv] = (...a) => {
      try {
        const m = String(a[0] || '').match(/Google Maps JavaScript API (?:error|warning): (\w+)/);
        if (m && G_ERR[m[1]] && !S.gErr) {
          S.gErr = { code: m[1], msg: G_ERR[m[1]]() };
          logExt('Google 地圖', 'ERR', m[1]);
          setTimeout(() => toast('Google 地圖：' + S.gErr.msg + '（設定 → 檢查 Google 設定）'), 0);
        }
      } catch { /* 不影響原本的 console */ }
      return orig(...a);
    };
  });
  // Places／Routes 的錯誤訊息 → 白話
  function gHint(e, api) {
    const m = String((e && (e.message || e)) || '');
    if (/has not been used|is disabled|SERVICE_DISABLED|not been enabled/i.test(m)) return `「${api}」還沒啟用`;
    if (/API_KEY_SERVICE_BLOCKED|blocked|not authorized to use this API/i.test(m)) return `金鑰的「API 限制」沒勾「${api}」`;
    if (/billing/i.test(m)) return '專案還沒開帳單';
    if (/referer|referrer|API_KEY_HTTP_REFERRER_BLOCKED/i.test(m)) return `金鑰的「網站限制」沒加 ${SITE_RULE()}`;
    if (/quota|RESOURCE_EXHAUSTED|OVER_QUERY_LIMIT/i.test(m)) return '超過用量上限（每日上限或免費額度）';
    if (/API key not valid|INVALID_ARGUMENT.*key|API_KEY_INVALID/i.test(m)) return '金鑰錯了';
    return m.slice(0, 140) || '不明錯誤';
  }
  // 沒選過底圖：有 TomTom 就用 TomTom（最新），沒有就用國土測繪
  let basemap = BASEMAPS[LS.getItem('basemap')] ? LS.getItem('basemap') : (hasTT() ? 'tomtom' : 'emap');
  // 「旋轉或深色時自動換向量圖」：國土測繪是圖片地圖，地圖一轉字就跟著轉、深色只能反轉顏色；向量圖沒有這兩個問題
  let autoVec = LS.getItem('autoVec') !== '0';
  S.vecIds = []; S.vecHidden = new Set(); S.effBase = null; S.rotVec = false;
  const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');
  const isDark = () => document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : darkMQ.matches;

  // 向量圖的文字一律優先顯示中文（OpenStreetMap 在台灣的 name 就是中文）
  const ZH_NAME = ['coalesce', ['get', 'name:zh-Hant'], ['get', 'name'], ['get', 'name:zh'], ['get', 'name_en']];
  const VEC_URL = 'https://tiles.openfreemap.org/styles/liberty';
  async function loadStyle() {
    const st = JSON.parse(JSON.stringify(BASE_STYLE));
    if (hasTT()) {
      S.ttMapUrl = ttMapUrl(isDark());
      st.sources.ttmap = { type: 'raster', tiles: [S.ttMapUrl], tileSize: 256, maxzoom: 22 };
      st.layers.splice(1, 0, { id: 'bm-tomtom', type: 'raster', source: 'ttmap', layout: { visibility: 'none' } });
    }
    // 向量圖（OpenFreeMap）併進同一個樣式，預設隱藏；載不到就只用國土測繪
    try {
      const r = await fetch(VEC_URL);
      logExt(VEC_URL, r.status);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const lib = await r.json();
      Object.entries(lib.sources || {}).forEach(([k, v]) => { if (!st.sources[k]) st.sources[k] = v; });
      if (lib.sprite) st.sprite = lib.sprite;
      if (lib.glyphs) st.glyphs = lib.glyphs;
      const vl = (lib.layers || []).map((l) => {
        const c = JSON.parse(JSON.stringify(l));
        c.id = 'v-' + l.id;
        c.layout = c.layout || {};
        if (c.layout.visibility === 'none') S.vecHidden.add(c.id);
        c.layout.visibility = 'none';
        if (c.type === 'symbol' && c.layout['text-field'] && /name/.test(JSON.stringify(c.layout['text-field']))) c.layout['text-field'] = ZH_NAME;
        // 店家、餐廳早一級顯示（原本要拉到很近才出現）
        if (/^poi_r(1|7|20)$/.test(l.id) && c.minzoom) c.minzoom = Math.max(13, c.minzoom - 1.5);
        return c;
      });
      st.layers.push(...vl);
      S.vecIds = vl.map((l) => l.id);
    } catch (e) {
      logExt(VEC_URL, 'ERR', String(e.message || e));
      S.vecIds = [];
      if (basemap === 'vector') toast('向量地圖載入失敗，改用臺灣通用電子地圖');
    }
    const eff = effBase();
    S.effBase = eff;
    st.layers.forEach((l) => {
      if (l.id.startsWith('bm-')) l.layout.visibility = l.id === 'bm-' + eff ? 'visible' : 'none';
      else if (l.id.startsWith('v-') && eff === 'vector' && !S.vecHidden.has(l.id)) l.layout.visibility = 'visible';
    });
    return st;
  }
  // 實際要顯示的底圖：使用者選的，再套「旋轉／深色自動換向量圖」
  function effBase() {
    const hasVec = S.vecIds.length > 0;
    const b = basemap === 'tomtom' && !hasTT() ? 'emap' : basemap;
    if (b === 'vector') return hasVec ? 'vector' : 'emap';
    if (b === 'photo' || !hasVec || !autoVec) return b;
    if (b === 'tomtom') return S.rotVec ? 'vector' : 'tomtom';   // TomTom 深色有夜間版，不必換
    if (isDark() || S.rotVec) return 'vector';
    return b;
  }
  // TomTom 底圖圖層：金鑰剛填好、或深淺色切換（main↔night）時重建
  function ensureTomTomBase() {
    if (!map || !map.getLayer('bm-emap')) return;
    const url = hasTT() ? ttMapUrl(isDark()) : null;
    if (url && map.getSource('ttmap') && S.ttMapUrl === url) return;
    const wasVisible = S.effBase === 'tomtom';
    if (map.getLayer('bm-tomtom')) map.removeLayer('bm-tomtom');
    if (map.getSource('ttmap')) map.removeSource('ttmap');
    S.ttMapUrl = url;
    if (!url) return;
    map.addSource('ttmap', { type: 'raster', tiles: [url], tileSize: 256, maxzoom: 22 });
    map.addLayer({ id: 'bm-tomtom', type: 'raster', source: 'ttmap', layout: { visibility: wasVisible ? 'visible' : 'none' } }, 'bm-emap');
  }
  function applyBase() {
    if (G) {
      if (map) map._g.setMapTypeId(gBase);
      S.effBase = gBase;
      applyTraffic(); updAttr();
      if (!$('#layerPop').hidden) renderLayerPop();
      return;
    }
    if (!map || !map.getLayer('bm-emap')) return;
    ensureTomTomBase();
    const eff = effBase();
    if (eff !== S.effBase) {
      S.effBase = eff;
      RASTERS.forEach((b) => { if (map.getLayer('bm-' + b)) map.setLayoutProperty('bm-' + b, 'visibility', b === eff ? 'visible' : 'none'); });
      S.vecIds.forEach((id) => { if (map.getLayer(id) && !S.vecHidden.has(id)) map.setLayoutProperty(id, 'visibility', eff === 'vector' ? 'visible' : 'none'); });
    }
    updAttr();
    applyPalette();
    applyTraffic();
    if (!$('#layerPop').hidden) renderLayerPop();
  }
  // 地圖轉超過 3° 就換向量圖，轉回 0.5° 以內才換回（避免在邊界來回閃）
  function onRotateBase() {
    if (G) return;
    const b = Math.abs(map.getBearing());
    const want = S.rotVec ? b > 0.5 : b > 3;
    if (want !== S.rotVec) { S.rotVec = want; applyBase(); }
  }
  function setBasemap(k) {
    if (G) { if (!GBASES[k]) return; gBase = k; LS.setItem('g.base', k); applyBase(); renderLayerPop(); return; }
    if (!BASEMAPS[k]) return;
    basemap = k; LS.setItem('basemap', k);
    applyBase();
    renderLayerPop();
  }
  function updAttr() {
    if (G) { $('#attr').textContent = 'TDX'; return; }   // Google 地圖自己會在角落標示來源
    const parts = [BASEMAPS[S.effBase || basemap].attr];
    if (S.traffic && map?.getLayer('traffic')) parts.push('© TomTom');
    parts.push('TDX');
    $('#attr').textContent = [...new Set(parts)].join(' · ');
  }

  // 深色模式：電子地圖用「亮度反轉＋色相轉 180°」做成深色版（只在關掉自動向量圖時才會用到）
  const PAL = {
    light: { bg: '#eef0f2', text: '#1c1c1e', halo: '#ffffff' },
    dark: { bg: '#1c1c1e', text: '#f2f2f7', halo: '#1c1c1e' },
  };
  // 向量圖配色：仿 Apple 地圖（淺色／深色各一套）
  const VPAL = {
    light: { bg: '#f4f2ed', water: '#a3d3f5', green: '#cfe7bf', wood: '#c2e0b0', urban: '#efece6', building: '#e3e0da', road: '#ffffff', casing: '#d9d6d0', major: '#fde293', majorCase: '#e6c46a', text: '#3a3a3c', halo: '#ffffff', rail: '#c7c3bc' },
    dark: { bg: '#1c1c1e', water: '#11314d', green: '#1f3326', wood: '#1b2e21', urban: '#232325', building: '#2c2c2e', road: '#3a3a3c', casing: '#2a2a2c', major: '#6b5b2e', majorCase: '#4a3f21', text: '#e5e5ea', halo: '#1c1c1e', rail: '#48484a' },
  };
  function applyVecPalette(dark) {
    const P = dark ? VPAL.dark : VPAL.light;
    const set = (id, k, v) => { try { map.setPaintProperty(id, k, v); } catch { /* 該圖層沒有這個屬性 */ } };
    S.vecIds.forEach((id) => {
      const l = map.getLayer(id); if (!l) return;
      const n = id.slice(2);
      if (l.type === 'background') set(id, 'background-color', P.bg);
      else if (l.type === 'fill') {
        if (/water|ocean|lake|river/.test(n)) set(id, 'fill-color', P.water);
        else if (/wood|forest/.test(n)) set(id, 'fill-color', P.wood);
        else if (/park|grass|landcover|meadow|farmland|scrub|garden|cemetery/.test(n)) set(id, 'fill-color', P.green);
        else if (/building/.test(n)) set(id, 'fill-color', P.building);
        else if (/landuse|residential|aeroway|pier/.test(n)) set(id, 'fill-color', P.urban);
      } else if (l.type === 'fill-extrusion') set(id, 'fill-extrusion-color', P.building);
      else if (l.type === 'line') {
        if (/water|river|stream|canal/.test(n)) set(id, 'line-color', P.water);
        else if (/rail|transit/.test(n)) set(id, 'line-color', P.rail);
        else if (/motorway|trunk/.test(n)) set(id, 'line-color', /casing/.test(n) ? P.majorCase : P.major);
        else if (/road|highway|street|minor|primary|secondary|tertiary|service|track|path|link/.test(n)) set(id, 'line-color', /casing/.test(n) ? P.casing : P.road);
      } else if (l.type === 'symbol') { set(id, 'text-color', P.text); set(id, 'text-halo-color', P.halo); }
    });
  }
  function applyPalette() {
    if (!map || G) return;
    const dark = isDark();
    const P = dark ? PAL.dark : PAL.light;
    const set = (id, k, v) => { try { if (map.getLayer(id)) map.setPaintProperty(id, k, v); } catch { /* 該圖層沒有這個屬性 */ } };
    set('bg', 'background-color', S.effBase === 'vector' ? (dark ? VPAL.dark.bg : VPAL.light.bg) : P.bg);
    ['bm-emap', 'bm-osm'].forEach((id) => {
      set(id, 'raster-brightness-min', dark ? 0.86 : 0);
      set(id, 'raster-brightness-max', dark ? 0.08 : 1);
      set(id, 'raster-hue-rotate', dark ? 180 : 0);
      set(id, 'raster-saturation', dark ? -0.35 : 0);
    });
    set('bm-photo', 'raster-brightness-max', dark ? 0.8 : 1);
    if (S.effBase === 'vector') applyVecPalette(dark);
    ['county-label', 'metro-st-label', 'tra-st-label', 'thsr-st-label'].forEach((id) => { set(id, 'text-color', P.text); set(id, 'text-halo-color', P.halo); });
  }

  // ---------- 即時路況（TomTom Traffic Flow，綠＝順、黃＝慢、紅＝塞） ----------
  const ttKey = () => LS.getItem('tt.key') || '';
  const trafficOk = () => G || !!(ttKey() || relayUrl());
  // 沒選過就預設開（有金鑰或中繼站時）
  S.traffic = LS.getItem('traffic') == null ? trafficOk() : LS.getItem('traffic') === '1';
  const trafficUrl = () => (ttKey() ? C.tomtomFlowUrl(ttKey(), isDark()) : C.tomtomRelayUrl(relayUrl(), isDark()));
  function ensureTrafficLayer() {
    const url = trafficUrl();
    if (!url) return false;
    if (map.getSource('traffic') && S.trafficUrl === url) return true;
    if (map.getLayer('traffic')) map.removeLayer('traffic');
    if (map.getSource('traffic')) map.removeSource('traffic');
    map.addSource('traffic', { type: 'raster', tiles: [url], tileSize: 256, minzoom: 0, maxzoom: 22 });
    // 只畫「比平常慢」的路段（黃／紅），順暢的路不畫綠線，地圖才不會被蓋滿；換縮放層級時淡入淡出
    map.addLayer({ id: 'traffic', type: 'raster', source: 'traffic', minzoom: 7, paint: { 'raster-opacity': 0.85, 'raster-fade-duration': 350 } }, 'route-case');
    S.trafficUrl = url; S.ttErr = false;
    return true;
  }
  function applyTraffic() {
    if (G) {
      if (!map) return;
      if (S.traffic && !gTraffic) gTraffic = new google.maps.TrafficLayer({ autoRefresh: true });
      if (gTraffic) gTraffic.setMap(S.traffic ? map._g : null);
      return;
    }
    if (!map || !map.getLayer('route-case')) return;
    if (S.traffic && ensureTrafficLayer()) map.setLayoutProperty('traffic', 'visibility', 'visible');
    else if (map.getLayer('traffic')) map.setLayoutProperty('traffic', 'visibility', 'none');
    updAttr();
  }
  function toggleTraffic() {
    if (!trafficOk()) { toast('先在設定填 TomTom 金鑰或中繼站網址'); openSettings(); return; }
    S.traffic = !S.traffic; LS.setItem('traffic', S.traffic ? '1' : '0');
    applyTraffic(); renderLayerPop();
  }
  // 用一張台北的路況圖磚測金鑰（圖片載入不受跨網域限制）
  function testTomTom(key) {
    return new Promise((res) => {
      const z = 12, lon = 121.52, lat = 25.05, n = 2 ** z;
      const x = Math.floor((lon + 180) / 360 * n);
      const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
      const url = C.tomtomFlowUrl(key, false).replace('{z}', z).replace('{x}', x).replace('{y}', y);
      const img = new Image();
      const t = setTimeout(() => { logExt('TomTom 測試圖磚', 'ERR', '逾時'); res(false); }, 10000);
      img.onload = () => { clearTimeout(t); logExt('TomTom 測試圖磚', 200); res(true); };
      img.onerror = () => { clearTimeout(t); logExt('TomTom 測試圖磚', 'ERR', '金鑰錯誤或額度用完'); res(false); };
      img.src = url;
    });
  }

  // 跟隨中，如果程式要把地圖移去別的地方（看搜尋結果、路線、站點），就先停止跟隨，
  //   不然下一筆 GPS 進來又會把地圖拉回你身上
  function guardCamera() {
    ['easeTo', 'flyTo', 'fitBounds'].forEach((k) => {
      const orig = map[k].bind(map);
      map[k] = (a, b) => {
        if (S.track !== 'off' && !S.nav?.active) {
          const c = k === 'fitBounds' ? null : a && a.center;
          const cc = c ? (Array.isArray(c) ? c : [c.lng, c.lat]) : null;
          if (k === 'fitBounds' || (cc && ME.cur && C.dist(cc, ME.cur) > 60)) setTrack('off');
        }
        return orig(a, b);
      };
    });
  }
  function bindMapCommon() {
    guardCamera();
    map.on('load', onMapLoad);
    map.on('dragstart', () => {
      if (S.nav?.active) { S.nav.follow = false; $('#follow').hidden = false; }
      else if (S.track !== 'off') setTrack('off');
    });
    map.on('rotate', () => { updCompass(); onRotateBase(); });
    map.once('load', firstLocate);
  }
  async function initGoogle(gc) {
    await GM.load(gc.key, { onAuthFail: () => { toast('Google 金鑰被拒：檢查網域限制、帳單、有沒有開 Maps JavaScript API'); logExt('Google 地圖', 'ERR', '金鑰驗證失敗'); } });
    logExt('Google 地圖程式', 200);
    G = true;
    S.traffic = LS.getItem('traffic') !== '0';   // Google 路況免費，預設開
    map = new GM.Map({
      container: 'map', center: [120.95, 23.75], zoom: isWide() ? 6.8 : 6.0,
      maxBounds: [[115.5, 20.5], [124.5, 27.3]], mapId: gc.mapId || 'DEMO_MAP_ID', dark: isDark(), mapTypeId: gBase,
    });
    document.body.classList.add('gmap');
    window.__xlmap = map;   // 方便除錯
    bindMapCommon();
    map.on('poiclick', (e) => openPlaceId(e.placeId));
  }
  async function initMap() {
    const gc = gCfg();
    if (gc.key && window.GM) {
      try { await initGoogle(gc); return; } catch (e) { G = false; logExt('Google 地圖', 'ERR', String(e.message || e)); toast((e.message || 'Google 地圖載入失敗') + '，先用開放地圖'); }
    }
    const style = await loadStyle();
    map = new maplibregl.Map({
      container: 'map', style, center: [120.95, 23.75], zoom: isWide() ? 6.8 : 6.0,
      maxBounds: [[115.5, 20.5], [124.5, 27.3]], attributionControl: false, pitchWithRotate: true,
      localIdeographFontFamily: '"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif',
    });
    bindMapCommon();
    map.on('rotatestart', (e) => { if (e.originalEvent && !S.nav?.active && S.track === 'heading') setTrack('off'); });
    map.on('error', (e) => {
      if (e.sourceId === 'traffic' && !S.ttErr) { S.ttErr = true; toast('即時路況載入失敗：TomTom 金鑰錯誤或額度用完'); logExt('TomTom 路況圖磚', 'ERR', String(e.error?.message || '')); }
    });
  }
  const emptyFC = () => ({ type: 'FeatureCollection', features: [] });

  // ---------- 站點圖示（SVG 畫成圖片給地圖用；2 倍解析度，手機上才清楚） ----------
  const GLYPH = {
    train: (c) => `<rect x="13" y="10" width="14" height="15.5" rx="4" fill="#fff"/><rect x="15.4" y="12.6" width="9.2" height="5" rx="1.3" fill="${c}"/><circle cx="16.6" cy="21.6" r="1.35" fill="${c}"/><circle cx="23.4" cy="21.6" r="1.35" fill="${c}"/><path d="M15.5 26.5l-2.2 3.2M24.5 26.5l2.2 3.2" stroke="#fff" stroke-width="2.1" stroke-linecap="round"/>`,
    hsr: (c) => `<path d="M10.5 24.5c0-6 3.6-12.5 10.5-12.5 5 0 8.5 3.3 8.5 7.5v5z" fill="#fff"/><path d="M13.6 18.6c1-2.4 3.2-4.2 6-4.2v4.2z" fill="${c}"/><path d="M11 28h18" stroke="#fff" stroke-width="2.1" stroke-linecap="round"/>`,
    bike: () => '<g fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.2" cy="24" r="4.6"/><circle cx="26.8" cy="24" r="4.6"/><path d="M13.2 24l4.6-8.4h6.4l2.6 8.4M17.8 15.6l3.4 8.4h-8M15.6 13.4h4"/></g>',
  };
  const badge = (shape, fill, glyph) => `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
    ${shape === 'round' ? `<circle cx="20" cy="21" r="17.5" fill="rgba(0,0,0,.22)"/><circle cx="20" cy="20" r="16.5" fill="${fill}" stroke="#fff" stroke-width="3"/>`
      : `<rect x="3.5" y="4.5" width="33" height="33" rx="10" fill="rgba(0,0,0,.22)"/><rect x="3.5" y="3.5" width="33" height="33" rx="10" fill="${fill}" stroke="#fff" stroke-width="3"/>`}
    ${glyph}</svg>`;
  function addSvgImage(id, svg) {
    return new Promise((res) => {
      const img = new Image(40, 40);
      img.onload = () => { try { if (!map.hasImage(id)) map.addImage(id, img, { pixelRatio: 2 }); } catch { /* 忽略 */ } res(); };
      img.onerror = () => res();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }
  function loadIcons() {
    const metroColors = new Set([...Object.values(LINE_COLORS), ...Object.values(C.METRO_OPS).map((o) => o.color), '#666']);
    const jobs = [...metroColors].map((c) => addSvgImage('metro-' + c, badge('round', c, GLYPH.train(c))));
    jobs.push(addSvgImage('tra', badge('square', '#1b3a8c', GLYPH.train('#1b3a8c'))));
    jobs.push(addSvgImage('thsr', badge('square', '#e8730c', GLYPH.hsr('#e8730c'))));
    jobs.push(addSvgImage('cam-arrow', '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><path d="M20 5 31 30 20 24 9 30z" fill="#e60012" stroke="#fff" stroke-width="3" stroke-linejoin="round"/></svg>'));
    CAM_ICONS.forEach((v) => jobs.push(addSvgImage('cam-' + v, `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="21" r="17.5" fill="rgba(0,0,0,.25)"/><circle cx="20" cy="20" r="16.5" fill="#fff" stroke="#e60012" stroke-width="5"/>${v ? `<text x="20" y="25.5" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="${v >= 100 ? 13 : 15}" fill="#111">${v}</text>` : '<rect x="12" y="15" width="16" height="11" rx="2" fill="#111"/><circle cx="20" cy="20.5" r="3.4" fill="#fff"/><circle cx="20" cy="20.5" r="1.8" fill="#111"/>'}</svg>`)));
    [['ok', '#34c759'], ['low', '#ff9500'], ['empty', '#ff3b30'], ['na', '#8e8e93']].forEach(([k, c]) => jobs.push(addSvgImage('bike-' + k, badge('round', c, GLYPH.bike()))));
    return Promise.all(jobs);
  }

  async function onMapLoad() {
    await loadIcons();
    map.addSource('county', { type: 'geojson', data: emptyFC(), promoteId: 'code' });
    // 縣市邊界只拿來「用定位判斷你在哪個縣市」，不畫在地圖上、也不能點選
    S.countyFeats = [];

    map.addSource('route', { type: 'geojson', data: emptyFC() });
    map.addLayer({ id: 'route-case', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 6, 16, 14] } });
    map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['coalesce', ['get', 'color'], '#0a84ff'], 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3.5, 16, 9] } });

    map.addSource('metro-lines', { type: 'geojson', data: emptyFC() });
    map.addLayer({ id: 'metro-lines', type: 'line', source: 'metro-lines', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2, 14, 5] } });
    // 站點：圓形／圓角方形徽章（捷運依路線色，台鐵深藍方塊，高鐵橘色方塊，YouBike 依可借車數變色）
    const iconSize = (lo, hi) => ['interpolate', ['linear'], ['zoom'], 9, lo, 15, hi];
    map.addSource('metro-st', { type: 'geojson', data: emptyFC() });
    map.addLayer({ id: 'metro-st', type: 'symbol', source: 'metro-st', layout: {
      'icon-image': ['concat', 'metro-', ['get', 'color']], 'icon-size': iconSize(0.55, 1.05),
      'icon-allow-overlap': true, 'icon-padding': 0, 'symbol-sort-key': 1 } });
    map.addSource('tra-st', { type: 'geojson', data: emptyFC() });
    map.addLayer({ id: 'tra-st', type: 'symbol', source: 'tra-st', layout: { 'icon-image': 'tra', 'icon-size': iconSize(0.6, 1.1), 'icon-allow-overlap': true } });
    map.addSource('thsr-st', { type: 'geojson', data: emptyFC() });
    map.addLayer({ id: 'thsr-st', type: 'symbol', source: 'thsr-st', layout: { 'icon-image': 'thsr', 'icon-size': iconSize(0.75, 1.2), 'icon-allow-overlap': true } });
    map.addSource('bike', { type: 'geojson', data: emptyFC(), cluster: true, clusterRadius: 50, clusterMaxZoom: 15 });
    // 群集：白底＋黃框的小膠囊，數字深色（取代原本整顆亮黃色大圓）
    map.addLayer({ id: 'bike-cluster', type: 'circle', source: 'bike', filter: ['has', 'point_count'], paint: {
      'circle-color': 'rgba(255,255,255,0.94)', 'circle-stroke-color': '#f5b800', 'circle-stroke-width': 2.5,
      'circle-radius': ['step', ['get', 'point_count'], 11, 20, 13.5, 100, 16] } });
    map.addLayer({ id: 'bike-pt', type: 'symbol', source: 'bike', filter: ['!', ['has', 'point_count']], layout: {
      'icon-image': ['case', ['<', ['get', 'rent'], 0], 'bike-na', ['==', ['get', 'rent'], 0], 'bike-empty', ['<=', ['get', 'rent'], 3], 'bike-low', 'bike-ok'],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 13, 0.6, 17, 1], 'icon-allow-overlap': true } });
    map.addSource('bus-line', { type: 'geojson', data: emptyFC() });
    map.addLayer({ id: 'bus-line', type: 'line', source: 'bus-line', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#30b0c7', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3.5, 16, 7], 'line-opacity': 0.92 } });
    map.addSource('bus-st', { type: 'geojson', data: emptyFC() });
    map.addLayer({ id: 'bus-st', type: 'circle', source: 'bus-st', paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3.5, 16, 6.5],
      'circle-color': ['match', ['get', 'level'], 'now', '#ff3b30', 'soon', '#ff9500', 'later', '#30b0c7', '#ffffff'],
      'circle-stroke-color': ['match', ['get', 'level'], 'none', '#30b0c7', '#ffffff'], 'circle-stroke-width': 2 } });

    // 測速照相（限速標誌）與搜尋結果紅點
    map.addSource('speedcam', { type: 'geojson', data: emptyFC() });
    map.addLayer({ id: 'speedcam-dir', type: 'symbol', source: 'speedcam', minzoom: 14, filter: ['has', 'dir'], layout: { 'icon-image': 'cam-arrow', 'icon-rotate': ['get', 'dir'], 'icon-rotation-alignment': 'map', 'icon-offset': [0, -30], 'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.6, 17, 0.85], 'icon-allow-overlap': true, visibility: SC.on ? 'visible' : 'none' } });
    map.addLayer({ id: 'speedcam', type: 'symbol', source: 'speedcam', minzoom: 12.5, layout: { 'icon-image': ['concat', 'cam-', ['to-string', ['get', 'icon']]], 'icon-size': ['interpolate', ['linear'], ['zoom'], 12.5, 0.55, 16, 0.85], 'icon-allow-overlap': true, visibility: SC.on ? 'visible' : 'none' } });
    map.addSource('search', { type: 'geojson', data: emptyFC() });
    map.addLayer({ id: 'search-pt', type: 'circle', source: 'search', paint: { 'circle-radius': 7, 'circle-color': '#ff3b30', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 } });
    if (hasGlyphs) {
      const font = ['Noto Sans Regular'];
      const lab = (id, src, minzoom, dy) => map.addLayer({ id, type: 'symbol', source: src, minzoom,
        layout: { 'text-field': ['get', 'name'], 'text-font': font, 'text-size': 12, 'text-offset': [0, dy], 'text-anchor': 'top', 'text-optional': true, 'text-max-width': 8 },
        paint: { 'text-color': '#1c1c1e', 'text-halo-color': '#fff', 'text-halo-width': 1.8 } });
      if (!G) { lab('metro-st-label', 'metro-st', 13.5, 1.3); lab('tra-st-label', 'tra-st', 11, 1.4); lab('thsr-st-label', 'thsr-st', 8, 1.5); }
      map.addLayer({ id: 'bike-cluster-n', type: 'symbol', source: 'bike', filter: ['has', 'point_count'], layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': font, 'text-size': 11, 'text-allow-overlap': true }, paint: { 'text-color': '#5c4400' } });
    }
    // 預設關掉的圖層（YouBike）先藏起來
    Object.keys(S.layers).forEach((k) => { if (!S.layers[k]) (LAYER_IDS[k] || []).forEach((id) => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none'); }); });
    setFocus(S.focus);   // 預設不畫任何路線
    applyBase();
    applyTraffic();
    applySpeedcam();
    bindMapEvents();
    loadCounties();
  }

  // ---------- 縣市邊界 ----------
  function bboxOf(g) {
    let b = [Infinity, Infinity, -Infinity, -Infinity];
    const walk = (a) => { if (typeof a[0] === 'number') b = [Math.min(b[0], a[0]), Math.min(b[1], a[1]), Math.max(b[2], a[0]), Math.max(b[3], a[1])]; else a.forEach(walk); };
    if (!g || !g.coordinates) return null;
    walk(g.coordinates);
    return Number.isFinite(b[0]) ? b : null;
  }
  async function loadCounties() {
    const url = 'https://cdn.jsdelivr.net/npm/taiwan-atlas@2021.9.20/counties-10t.json';
    try {
      const topo = await getJSON(url, '縣市邊界');
      const key = Object.keys(topo.objects || {}).find((k) => /count/i.test(k)) || Object.keys(topo.objects || {})[0];
      const fc = topojson.feature(topo, topo.objects[key]);
      const feats = [];
      fc.features.forEach((f) => {
        const p = f.properties || {};
        const cty = C.COUNTIES.find((c) => c.name === C.normTW(p.COUNTYNAME || p.name || p.NAME || ''));
        const bb = bboxOf(f.geometry);
        if (!cty || !bb || bb[0] < 115 || bb[2] > 125) return;
        cty.bbox = bb;
        feats.push({ type: 'Feature', geometry: f.geometry, properties: { code: cty.code, name: cty.name } });
      });
      if (feats.length < 15) throw new Error('縣市資料不完整');
      S.countyFeats = feats;
      map.getSource('county').setData({ type: 'FeatureCollection', features: feats });
    } catch (e) {
      toast('縣市邊界載入失敗，改用最近的縣市中心判斷');
    }
    autoCounty();
  }

  // ---------- 用定位自動判斷縣市（沒有「選縣市」這一步） ----------
  //   有定位用定位；沒有就用地圖中心。地圖拖到別的縣市時也會自動換。
  function countyFor(p) {
    const code = C.countyAt(p, S.countyFeats);
    if (code) return code;
    // 邊界沒載到或點在海上：取最近的縣市中心
    let best = null, bd = Infinity;
    C.COUNTIES.forEach((c) => { const d = C.dist(p, c.c); if (d < bd) { bd = d; best = c.code; } });
    return bd < 60000 ? best : null;
  }
  function autoCounty(p) {
    const pt = p || S.me || (map ? map.getCenter().toArray() : null);
    if (!pt) return;
    const code = countyFor(pt);
    if (code && (!S.county || S.county.code !== code)) selectCounty(code, { fly: false });
  }

  // ---------- 地圖點擊 ----------
  function bindMapEvents() {
    // 地圖拖到別的縣市（拉近到市區程度時）自動換縣市資料
    map.on('moveend', () => { if (!S.nav?.active && map.getZoom() >= 10.5 && S.track === 'off') autoCounty(map.getCenter().toArray()); });
    map.on('click', (e) => {
      $('#layerPop').hidden = true;
      const order = ['search-pt', 'bus-st', 'bike-pt', 'bike-cluster', 'speedcam', 'thsr-st', 'tra-st', 'metro-st', 'metro-lines'];
      const hits = map.queryRenderedFeatures(e.point, { layers: order.filter((l) => map.getLayer(l)) });
      if (hits.length) {
        hits.sort((a, b) => order.indexOf(a.layer.id) - order.indexOf(b.layer.id));
        const f = hits[0];
        if (f.layer.id === 'bike-cluster') {
          map.getSource('bike').getClusterExpansionZoom(f.properties.cluster_id).then((z) => map.easeTo({ center: f.geometry.coordinates, zoom: z }));
          return;
        }
        if (f.layer.id === 'metro-lines') return openLine(f.properties.op, f.properties.line);   // 點捷運線＝選這條線
        if (f.layer.id === 'search-pt') { const r = S.searchRows?.[f.properties.i]; if (r) openPlace(r); return; }
        if (f.layer.id === 'speedcam') { const q = f.properties; toast(`測速照相${q.limit ? `・限速 ${q.limit}` : ''}${q.dirTxt ? '・' + q.dirTxt : ''}${q.addr ? '・' + q.addr : ''}${q.src === 'o' ? '・資料：開放街圖（非官方）' : ''}`); return; }
        return openFeature(f.layer.id, f.properties, f.geometry.coordinates);
      }
    });
    ['metro-st', 'tra-st', 'thsr-st', 'bike-pt', 'bike-cluster', 'bus-st', 'metro-lines'].forEach((l) => {
      map.on('mouseenter', l, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', l, () => { map.getCanvas().style.cursor = ''; });
    });
  }

  // ======================================================
  // 交通資料（TDX）
  // ======================================================
  async function selectCounty(code, opts = {}) {
    const cty = C.COUNTIES.find((c) => c.code === code);
    if (!cty) return;
    S.county = cty;
    if (S.view !== 'bus') clearBus();
    if (opts.fly) {
      if (cty.bbox) map.fitBounds([[cty.bbox[0], cty.bbox[1]], [cty.bbox[2], cty.bbox[3]]], { padding: fitPad(), duration: 900 });
      else map.flyTo({ center: cty.c, zoom: cty.z, duration: 900 });
    }
    if (S.qMode) setQMode(S.qMode);   // 更新搜尋框提示文字裡的縣市名
    if (!tdx.ready()) {
      ['metro', 'tra', 'thsr', 'bike'].forEach((k) => setStatus(k, 'nokey'));
      if (S.view === 'home') showHome();
      openSettings('先設定 TDX 金鑰，才能載入即時交通資料。');
      return;
    }
    // 有金鑰了：清掉之前的「缺金鑰」狀態（現在是選了才載，不會馬上被新狀態蓋掉）
    ['metro', 'tra', 'thsr', 'bike'].forEach((k) => { if (S.status[k]?.s === 'nokey') S.status[k] = {}; });
    if (S.view === 'home') showHome();
    // 不再一次載全部（會撞 TDX 頻率限制）；選了哪種交通才載哪種
    S.loadedFor = {};
    const v = S.view || '';
    if (v.startsWith('near:') && LOADERS[v.slice(5)]) ensure(v.slice(5));
    if (S.focus && ['metro', 'line', 'station'].includes(S.focus.kind)) ensure('metro');
  }
  // 需要時才載入某種交通資料；同一縣市載過就不重載（YouBike 可借數 60 秒後才重抓）
  const LOADERS = { metro: (c) => loadMetro(c), tra: (c) => loadTra(c), thsr: (c) => loadThsr(c), bike: (c) => loadBike(c) };
  const inflight = {};
  function ensure(k) {
    const cty = S.county;
    if (!cty || !LOADERS[k] || !tdx.ready()) return Promise.resolve();
    const done = (S.loadedFor || {})[k];
    const fresh = done && done.code === cty.code && (k !== 'bike' || Date.now() - done.t < 60000);
    if (fresh && S.status[k]?.s !== 'err') return Promise.resolve();
    const key = k + ':' + cty.code;
    if (inflight[key]) return inflight[key];
    inflight[key] = Promise.resolve(LOADERS[k](cty)).finally(() => {
      delete inflight[key];
      if (S.county === cty && S.status[k]?.s !== 'err') (S.loadedFor = S.loadedFor || {})[k] = { code: cty.code, t: Date.now() };
    });
    return inflight[key];
  }
  function fitPad() {
    if (isWide()) return { top: 80, bottom: 40, left: 400, right: 80 };
    return { top: 120, bottom: Math.round(sheetHeight() + 30), left: 30, right: 30 };
  }
  function setStatus(k, s, n) {
    S.status[k] = { s, n };
    renderLayerPop();
    if (S.view === 'home') renderHomeStatus();
    if (S.view === 'near:' + k && s !== 'loading') nearStations(k);   // 資料到了就把「附近」清單補上
  }
  function handleErr(k, e) { setStatus(k, 'err'); toast(`${LAYER_NAMES[k]}：${e.message || e}`); }

  async function loadMetro(cty) {
    if (!cty.metro.length) { setStatus('metro', 'none'); renderMetro(); return; }
    setStatus('metro', 'loading');
    let ok = 0, lastErr = null;
    for (const op of cty.metro) {
      if (S.metroByOp[op]) { ok++; continue; }
      try {
        const [st, sh] = await Promise.all([
          cachedGet(C.EP.metroStation(op), { $select: 'StationID,StationName,StationPosition' }, 7),
          cachedGet(C.EP.metroShape(op), null, 7).catch(() => []),
        ]);
        const stations = C.pointsFC(st, (r) => {
          const p = C.pos(r.StationPosition); if (!p) return null;
          return { type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: { kind: 'metro', op, id: r.StationID, name: C.zh(r.StationName), color: lineColor(op, r.StationID) } };
        });
        const lines = { type: 'FeatureCollection', features: (sh || []).map((r) => {
          const g = C.wktToGeometry(r.Geometry); if (!g) return null;
          return { type: 'Feature', geometry: g, properties: { op, line: r.LineID, color: lineColor(op, r.LineID) } };
        }).filter(Boolean) };
        S.metroByOp[op] = { stations, lines };
        ok++;
      } catch (e) {
        if (e.kind === 'notfound') continue;
        lastErr = e;   // 一個系統失敗不影響其他系統，照樣畫出已載入的
      }
    }
    if (S.county !== cty) return;
    if (!ok && lastErr) { renderMetro(); handleErr('metro', lastErr); return; }
    if (lastErr) toast(`部分捷運系統載入失敗：${lastErr.message || lastErr}`);
    renderMetro();
    setStatus('metro', ok ? 'ok' : 'none', cty.metro.reduce((s, op) => s + (S.metroByOp[op]?.stations.features.length || 0), 0));
  }
  function renderMetro() {
    const st = [], ln = [];
    (S.county ? S.county.metro : []).forEach((op) => { const m = S.metroByOp[op]; if (m) { st.push(...m.stations.features); ln.push(...m.lines.features); } });
    // 同名站只畫一顆；lines 記下這站屬於哪些線（例如台北車站＝,BL,R,），選線亮顯時用
    const byKey = new Map();
    st.forEach((f) => {
      const k = f.properties.op + f.properties.name, l = linePrefix(f.properties.id);
      if (!byKey.has(k)) byKey.set(k, { ...f, properties: { ...f.properties, lines: ',' } });
      const g = byKey.get(k);
      if (!g.properties.lines.includes(',' + l + ',')) g.properties.lines += l + ',';
    });
    map.getSource('metro-st').setData({ type: 'FeatureCollection', features: [...byKey.values()] });
    map.getSource('metro-lines').setData({ type: 'FeatureCollection', features: ln });
    setFocus(S.focus);
  }

  // ---------- 地圖上要畫什麼：預設什麼路線都不畫，需要時才顯示 ----------
  //   null           首頁：只有你的位置，不畫任何路線、站點
  //   {kind:'metro'} 選了「捷運」：畫捷運站，但不畫路線
  //   {kind:'line', op, line}       選了一條線：只畫這條線和它的站
  //   {kind:'station', op, lines}   點／搜尋到某站：只畫經過這站的線和那些線的站
  //   {kind:'tra'|'thsr'|'bike'|'bus'}  只畫那一種
  const NONE = ['!', true], ALL = ['!', false];   // 「全不畫／全畫」的篩選運算式（['==',1,0] 會被當成舊式篩選而報錯）
  function setFocus(f) {
    S.focus = f || null;
    if (!map || !map.getLayer('metro-lines')) return;
    const k = f?.kind;
    const lines = k === 'line' ? [f.line] : k === 'station' ? (f.lines || []) : null;
    const lineF = lines && lines.length ? ['all', ['==', ['get', 'op'], f.op], ['in', ['get', 'line'], ['literal', lines]]] : NONE;
    const stF = k === 'metro' ? ALL
      : lines && lines.length ? ['all', ['==', ['get', 'op'], f.op], ['any', ...lines.map((l) => ['in', ',' + l + ',', ['get', 'lines']])]]
      : NONE;
    const filt = (id, v) => { if (map.getLayer(id)) map.setFilter(id, v); };
    filt('metro-lines', lineF);
    filt('metro-st', stF); filt('metro-st-label', stF);
    filt('tra-st', k === 'tra' ? ALL : NONE); filt('tra-st-label', k === 'tra' ? ALL : NONE);
    filt('thsr-st', k === 'thsr' ? ALL : NONE); filt('thsr-st-label', k === 'thsr' ? ALL : NONE);
    if (map.getLayer('metro-lines')) map.setPaintProperty('metro-lines', 'line-width', ['interpolate', ['linear'], ['zoom'], 9, 3, 14, 7]);
  }
  function setLayer(k, on) { if (!!S.layers[k] !== on) toggleLayer(k); }
  async function loadTra(cty) {
    setStatus('tra', 'loading');
    try {
      const rows = await cachedGet(C.EP.traStation(), { $select: 'StationID,StationName,StationPosition,StationAddress' }, 7);
      const toF = (r) => {
        const p = C.pos(r.StationPosition); if (!p) return null;
        return { type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: { kind: 'tra', id: r.StationID, name: C.zh(r.StationName) } };
      };
      S.traAllFC = C.pointsFC(rows, toF);   // 「附近的台鐵站」不受縣市界線限制
      const fc = C.pointsFC(rows.filter((r) => C.addressInCounty(r.StationAddress, cty)), toF);
      if (S.county !== cty) return;
      map.getSource('tra-st').setData(fc);
      setStatus('tra', fc.features.length ? 'ok' : 'none', fc.features.length);
    } catch (e) { handleErr('tra', e); }
  }
  async function loadThsr(cty) {
    setStatus('thsr', 'loading');
    try {
      const rows = await cachedGet(C.EP.thsrStation(), null, 30);
      const toF = (r) => {
        const p = C.pos(r.StationPosition); if (!p) return null;
        return { type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: { kind: 'thsr', id: r.StationID, name: '高鐵' + C.zh(r.StationName) } };
      };
      S.thsrAllFC = C.pointsFC(rows, toF);
      const fc = C.pointsFC(rows.filter((r) => C.addressInCounty(r.StationAddress, cty)), toF);
      if (S.county !== cty) return;
      map.getSource('thsr-st').setData(fc);
      setStatus('thsr', fc.features.length ? 'ok' : 'none', fc.features.length);
    } catch (e) { handleErr('thsr', e); }
  }
  async function loadBike(cty) {
    setStatus('bike', 'loading');
    S.bikeFC = null;
    map.getSource('bike').setData(emptyFC());
    try {
      const st = await cachedGet(C.EP.bikeStation(cty.code), { $select: 'StationUID,StationName,StationPosition,BikesCapacity' }, 3);
      if (S.county !== cty) return;
      const av = await tdx.get(C.EP.bikeAvail(cty.code), { $select: 'StationUID,AvailableRentBikes,AvailableReturnBikes,AvailableRentBikesDetail,ServiceStatus,UpdateTime' }, 60);
      if (S.county !== cty) return;
      const avMap = new Map(av.map((a) => [a.StationUID, a]));
      const fc = C.pointsFC(st, (r) => {
        const p = C.pos(r.StationPosition); if (!p) return null;
        const a = avMap.get(r.StationUID);
        return { type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: {
          kind: 'bike', id: r.StationUID, name: C.zh(r.StationName).replace(/^YouBike\s*\d(\.\d)?_/i, ''),
          cap: r.BikesCapacity ?? -1, rent: a ? a.AvailableRentBikes : -1, ret: a ? a.AvailableReturnBikes : -1 } };
      });
      map.getSource('bike').setData(fc);
      S.bikeFC = fc;
      setStatus('bike', fc.features.length ? 'ok' : 'none', fc.features.length);
    } catch (e) {
      if (e.kind === 'notfound') { setStatus('bike', 'none'); return; }
      handleErr('bike', e);
    }
  }

  // ---------- 圖層彈出 ----------
  function statusBadge(k) {
    const st = S.status[k] || {};
    if (st.s === 'loading') return '<span class="spin" aria-label="載入中"></span>';
    if (st.s === 'err') return '<span class="badge e">錯誤</span>';
    if (st.s === 'nokey') return '<span class="badge e">缺金鑰</span>';
    if (st.s === 'none') return '<span class="badge">無資料</span>';
    if (st.s === 'ok' && st.n != null) return `<span class="badge">${st.n}</span>`;
    return '';
  }
  function renderLayerPop() {
    if (G) {
      $('#layerPop').innerHTML = Object.keys(LAYER_NAMES).map((k) => `<button class="lrow" data-k="${k}" role="switch" aria-checked="${S.layers[k]}"><i class="dot d-${k}"></i><span class="grow">${LAYER_NAMES[k]}</span>${statusBadge(k)}<span class="sw ${S.layers[k] ? 'on' : ''}"></span></button>`).join('')
        + `<button class="lrow" data-traffic="1" role="switch" aria-checked="${S.traffic}"><i class="dot d-traffic"></i><span class="grow">即時路況<small class="lnote">Google・綠順、黃慢、紅塞</small></span><span class="sw ${S.traffic ? 'on' : ''}"></span></button>`
        + speedcamRow()
        + '<div class="lhead">底圖</div>'
        + Object.entries(GBASES).map(([k, b]) => `<button class="lrow" data-bm="${k}" role="radio" aria-checked="${k === gBase}"><span class="grow">${b.name}<small class="lnote">${b.note}</small></span>${k === gBase ? '<span class="chk">✓</span>' : ''}</button>`).join('');
      return;
    }
    const auto = S.effBase === 'vector' && basemap !== 'vector' ? `暫時改用向量地圖（${isDark() ? '深色模式' : '地圖旋轉中'}）` : '';
    $('#layerPop').innerHTML = Object.keys(LAYER_NAMES).map((k) => `<button class="lrow" data-k="${k}" role="switch" aria-checked="${S.layers[k]}"><i class="dot d-${k}"></i><span class="grow">${LAYER_NAMES[k]}</span>${statusBadge(k)}<span class="sw ${S.layers[k] ? 'on' : ''}"></span></button>`).join('')
      + `<button class="lrow" data-traffic="1" role="switch" aria-checked="${S.traffic}"><i class="dot d-traffic"></i><span class="grow">即時路況<small class="lnote">${trafficOk() ? 'TomTom・只標出變慢的路：黃慢、紅塞' : '要先在設定填 TomTom 金鑰'}</small></span><span class="sw ${S.traffic ? 'on' : ''}"></span></button>`
      + speedcamRow()
      + '<div class="lhead">底圖</div>'
      + Object.entries(BASEMAPS).filter(([k]) => (k !== 'vector' || S.vecIds.length) && (k !== 'tomtom' || hasTT())).map(([k, b]) => `<button class="lrow" data-bm="${k}" role="radio" aria-checked="${k === basemap}"><span class="grow">${b.name}<small class="lnote">${k === basemap && auto ? auto : b.note}</small></span>${k === basemap ? '<span class="chk">✓</span>' : ''}</button>`).join('')
      + (S.vecIds.length ? `<button class="lrow" data-auto="1" role="switch" aria-checked="${autoVec}"><span class="grow">旋轉或深色時自動換向量圖<small class="lnote">圖片地圖一轉字就倒，深色只能反轉顏色</small></span><span class="sw ${autoVec ? 'on' : ''}"></span></button>` : '');
  }
  function toggleLayer(k) {
    S.layers[k] = !S.layers[k];
    (LAYER_IDS[k] || []).forEach((id) => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', S.layers[k] ? 'visible' : 'none'); });
    renderLayerPop();
  }

  // ======================================================
  // 抽屜（手機三段：收合／一半／全開；電腦為左側欄）
  // ======================================================
  const sheet = () => $('#sheet');
  function detentPx(d) {
    const vh = window.innerHeight;
    if (d === 'peek' && document.body.classList.contains('navigating')) return navBarH();
    if (d === 'peek') return $('#srow').offsetHeight + 18 + 6 + (parseFloat(getComputedStyle(sheet()).paddingBottom) || 0);
    if (d === 'full') return Math.round(vh * 0.86);
    return Math.round(vh * 0.46);
  }
  function navBarH() {
    const nb = $('#sheetBody .navbar');
    return (nb ? nb.offsetHeight : 48) + 18 + 16 + (parseFloat(getComputedStyle(sheet()).paddingBottom) || 0);
  }
  function sheetHeight() { return isWide() ? 0 : sheet().getBoundingClientRect().height; }
  function setDetent(d) {
    const el = sheet();
    el.dataset.d = d;
    if (isWide()) { el.style.height = ''; el.classList.toggle('collapsed', d === 'peek'); updateSheetVar(); return; }
    el.style.height = detentPx(d) + 'px';
    updateSheetVar();
  }
  function updateSheetVar() {
    const h = isWide() ? 0 : (sheet().dataset.d === 'peek' ? detentPx('peek') : detentPx(sheet().dataset.d)) + 8;
    document.documentElement.style.setProperty('--sheet-h', h + 'px');
    document.body.classList.toggle('sheet-tall', !isWide() && sheet().dataset.d !== 'peek');
    layoutYT();
  }
  function bindSheetDrag() {
    const el = sheet();
    let y0 = 0, h0 = 0, t0 = 0, dragging = false, moved = false;
    const start = (e) => {
      if (isWide()) return;
      if (e.target.closest('input,button:not(.grab),select,a')) return;
      dragging = true; moved = false; y0 = e.clientY; h0 = el.getBoundingClientRect().height; t0 = performance.now();
      el.classList.add('dragging');
      el.setPointerCapture?.(e.pointerId);
    };
    const move = (e) => {
      if (!dragging) return;
      const dy = e.clientY - y0;
      if (Math.abs(dy) > 4) moved = true;
      el.style.height = Math.max(detentPx('peek'), Math.min(detentPx('full'), h0 - dy)) + 'px';
    };
    const end = (e) => {
      if (!dragging) return;
      dragging = false; el.classList.remove('dragging');
      const h = el.getBoundingClientRect().height;
      const v = (e.clientY - y0) / Math.max(1, performance.now() - t0);  // 正值 = 往下
      const ds = ['peek', 'half', 'full'];
      let pick;
      if (!moved) pick = el.dataset.d === 'peek' ? 'half' : el.dataset.d;   // 點一下：收合時展開
      else if (Math.abs(v) > 0.5) { const i = ds.indexOf(el.dataset.d); pick = ds[Math.max(0, Math.min(2, i + (v > 0 ? -1 : 1)))]; }
      else pick = ds.reduce((a, b) => (Math.abs(detentPx(a) - h) < Math.abs(detentPx(b) - h) ? a : b));
      setDetent(pick);
    };
    $('#grab').addEventListener('pointerdown', start);
    $('#srow').addEventListener('pointerdown', start);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    $('#grab').addEventListener('click', () => { if (isWide()) setDetent(sheet().dataset.d === 'peek' ? 'half' : 'peek'); });
    window.addEventListener('resize', () => setDetent(sheet().dataset.d));
  }

  function setBody(html, view) {
    stopTimers();
    S.view = view;
    S.backFn = null;   // 「返回」預設回首頁；要回上一頁的畫面自己再設
    $('#sheetBody').innerHTML = html;
    $('#sheetBody').scrollTop = 0;
    if (sheet().dataset.d === 'peek' && view !== 'nav' && view !== 'home') setDetent('half');
  }
  function stopTimers() { S.timers.forEach(clearInterval); S.timers = []; }
  const backBtn = '<button class="back" data-act="home" aria-label="返回"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></button>';
  const loading = '<p class="muted" style="padding:12px 2px">讀取中…</p>';
  const errBox = (e) => `<p class="err" style="padding:12px 2px">${esc(e.message || e)}</p>`;
  const hm = (t) => (t || '').slice(0, 5);

  // ======================================================
  // 首頁：打開 → 用定位找出你在哪 → 選交通方式 → 列出附近的站
  //   （沒有「選縣市」；縣市由定位自動判斷）
  // ======================================================
  const MODE_BTNS = [
    { k: 'metro', name: '捷運', ico: 'train', color: '#0070bd' },
    { k: 'bus', name: '公車', ico: 'bus', color: '#30b0c7' },
    { k: 'tra', name: '台鐵', ico: 'train', color: '#1b3a8c' },
    { k: 'thsr', name: '高鐵', ico: 'hsr', color: '#e8730c' },
    { k: 'bike', name: 'YouBike', ico: 'bike', color: '#f5b800' },
  ];
  const MODE_SVG = {
    train: '<rect x="6" y="3" width="12" height="14" rx="3.5"/><path d="M8.5 6.5h7v4h-7z" fill="var(--c)"/><path d="M8 20l2-3M16 20l-2-3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    bus: '<rect x="5" y="3" width="14" height="15" rx="3"/><path d="M7.5 6h9v5h-9z" fill="var(--c)"/><path d="M7.5 20v-2M16.5 20v-2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
    hsr: '<path d="M3 16c0-6 4-11 10-11 4.5 0 8 3 8 7v4z"/><path d="M6.5 11c1-2.2 3-3.6 5.5-3.6V11z" fill="var(--c)"/><path d="M4 20h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    bike: '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="16" r="3.6"/><circle cx="18" cy="16" r="3.6"/><path d="M6 16l4-7.5h5.5l2.5 7.5M10 8.5l3 7.5H6M8.3 6.5h3.4"/></g>',
  };
  function showHome() {
    if (S.nav?.active) return renderNavBar();
    setFocus(null);
    const where = S.placeLabel || (S.county ? S.county.name : '');
    const head = S.me
      ? `<div class="ph"><div class="tag">你在</div><h2>${esc(where || '定位中…')}</h2>${S.placeLabel && S.county ? '' : ''}</div>`
      : S.locFail
        ? `<div class="ph"><div class="tag">沒有定位</div><h2>${esc(where || '找不到你的位置')}</h2><small>${esc(S.locFail)}</small><div class="acts"><button class="btn pri" data-act="relocate">重新定位</button></div></div>`
        : '<div class="ph"><div class="tag">開始</div><h2>定位中…</h2><small>第一次會跳出「允許定位」，請按允許</small></div>';
    setBody(`${head}
      <div class="sec"><h3>要看哪種交通？</h3><div class="modes" id="modeGrid"></div></div>
      <div class="sec"><h3>我的地點</h3><div id="myPlaces"></div></div>
      ${!tdx.ready() ? '<div class="sec"><div class="list"><button class="item" data-act="settings"><span class="grow"><span class="t1">設定 TDX 金鑰</span><div class="t2">沒有金鑰就看不到即時交通資料</div></span><span class="muted">›</span></button></div></div>' : ''}
      <p class="fine" style="margin-top:14px">上方搜尋可找地點、店家、地址，或直接打公車號碼（例如 307）。</p>`, 'home');
    renderHomeStatus();
    renderMyPlaces();
  }
  function renderHomeStatus() {
    const box = $('#modeGrid'); if (!box) return;
    box.innerHTML = MODE_BTNS.map((m) => {
      const none = m.k === 'metro' && S.county && !S.county.metro.length;
      return `<button class="mode" data-mode="${m.k}" style="--c:${m.color}" ${none ? 'disabled' : ''}>
        <span class="mi"><svg viewBox="0 0 24 24" fill="currentColor">${MODE_SVG[m.ico]}</svg></span>
        <span class="mn">${m.name}</span><span class="ms">${none ? '本縣市沒有' : m.k === 'bus' ? '附近站牌' : (statusBadge(m.k) || '')}</span></button>`;
    }).join('');
  }
  function openMode(k) {
    if (!S.county) { toast(S.me ? '還在判斷你所在的縣市，稍等一下' : '還沒定位到你，請允許定位或把地圖移到你要看的地方'); return; }
    setLayer('bike', k === 'bike');   // YouBike 只在選 YouBike 時畫，其他時候地圖保持乾淨
    if (k === 'metro') return searchMetro('');
    if (k === 'bus') return busNearby();
    ensure(k);
    return nearStations(k);
  }
  const refPoint = () => S.me || map.getCenter().toArray();
  const refLabel = () => (S.me ? '你' : '地圖中心');

  // 台鐵／高鐵／YouBike：附近的站，由近到遠
  function nearStations(k) {
    const title = { tra: '附近的台鐵站', thsr: '附近的高鐵站', bike: '附近的 YouBike' }[k];
    const head = `${backBtn}<div class="ph"><div class="tag"><i class="dot d-${k}"></i>${LAYER_NAMES[k]}</div><h2>${title}</h2></div>`;
    const fc = k === 'tra' ? S.traAllFC : k === 'thsr' ? S.thsrAllFC : S.bikeFC;
    const st = S.status[k] || {};
    setFocus({ kind: k });
    if (!fc) {
      setBody(`${head}${st.s === 'err' ? '<p class="err">載入失敗，請稍後再試（可在設定 → 連線紀錄看原因）。</p>' : st.s === 'none' ? '<p class="muted">這個縣市沒有資料。</p>' : loading}`, 'near:' + k);
      return;
    }
    const ref = refPoint();
    const rows = fc.features.map((f) => ({ f, d: C.dist(ref, f.geometry.coordinates) })).sort((a, b) => a.d - b.d).slice(0, k === 'bike' ? 30 : 12);
    const extra = (p) => k === 'bike'
      ? `<span class="bk"><b class="${p.rent === 0 ? 'z' : p.rent <= 3 ? 'l' : ''}">${p.rent < 0 ? '—' : p.rent}</b><small>可借</small></span><span class="bk"><b>${p.ret < 0 ? '—' : p.ret}</b><small>可還</small></span>`
      : '';
    setBody(`${head}<div class="list">${rows.map((r, i) => `<button class="item" data-i="${i}"><i class="dot d-${k}"></i><span class="grow"><span class="t1">${esc(r.f.properties.name)}</span><div class="t2">${C.fmtDist(r.d)}</div></span>${extra(r.f.properties)}<span class="muted">›</span></button>`).join('')}</div>
      <p class="fine">依離${refLabel()}的距離，由近到遠</p>`, 'near:' + k);
    $('#sheetBody').querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => {
      const f = rows[+b.dataset.i].f;
      map.easeTo({ center: f.geometry.coordinates, zoom: Math.max(map.getZoom(), 15.5) });
      openFeature(k === 'bike' ? 'bike-pt' : k + '-st', f.properties, f.geometry.coordinates);
    }));
  }

  // 公車：附近站牌（雙北要同時查臺北市與新北市的資料，兩邊的公車會互相跨區）
  const busCities = () => (['Taipei', 'NewTaipei'].includes(S.county.code) ? ['Taipei', 'NewTaipei'] : [S.county.code]);
  async function busNearby() {
    if (!tdx.ready()) return openSettings('先設定 TDX 金鑰才能查公車。');
    setFocus({ kind: 'bus' });
    setBody(`${backBtn}<div class="ph"><div class="tag"><i class="dot d-bus"></i>公車</div><h2>附近的站牌</h2><small>點站牌看每條路線還要幾分鐘到</small></div><div id="rBody">${loading}</div>`, 'near:bus');
    const ref = refPoint();
    try {
      const sf = `nearby(${ref[1].toFixed(5)},${ref[0].toFixed(5)},500)`;
      const all = [];
      for (const city of busCities()) {
        const rows = await tdx.get(`/v2/Bus/Station/City/${city}`, { $spatialFilter: sf, $select: 'StationUID,StationName,StationPosition,Stops' }, 120).catch((e) => { if (e.kind === 'notfound') return []; throw e; });
        rows.forEach((r) => all.push({ city, r }));
      }
      // 同名、相距 30 公尺內的視為同一站牌（雙北兩邊資料重複）
      const groups = [];
      all.forEach(({ city, r }) => {
        const p = C.pos(r.StationPosition); if (!p) return;
        const name = C.zh(r.StationName);
        let g = groups.find((x) => x.name === name && C.dist(x.p, p) < 30);
        if (!g) { g = { name, p, d: C.dist(ref, p), stops: [], routes: new Set() }; groups.push(g); }
        (r.Stops || []).forEach((s) => { g.stops.push({ city, uid: s.StopUID, routeUID: s.RouteUID, route: C.zh(s.RouteName) }); g.routes.add(C.zh(s.RouteName)); });
      });
      groups.sort((a, b) => a.d - b.d);
      if (!$('#rBody') || S.view !== 'near:bus') return;
      if (!groups.length) { $('#rBody').innerHTML = '<p class="muted">附近 500 公尺內沒有公車站牌。</p>'; return; }
      $('#rBody').innerHTML = `<div class="list">${groups.slice(0, 25).map((g, i) => {
        const rs = [...g.routes].sort((a, b) => a.length - b.length || a.localeCompare(b, 'zh-TW'));
        return `<button class="item" data-i="${i}"><i class="dot d-bus"></i><span class="grow"><span class="t1">${esc(g.name)}</span><div class="t2">${rs.slice(0, 8).map(esc).join('、')}${rs.length > 8 ? ` 等 ${rs.length} 條` : ''}</div></span><span class="t2 num">${C.fmtDist(g.d)}</span><span class="muted">›</span></button>`;
      }).join('')}</div><p class="fine">依離${refLabel()}的距離，由近到遠</p>`;
      $('#rBody').querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => openBusStop(groups[+b.dataset.i])));
    } catch (e) { if ($('#rBody')) $('#rBody').innerHTML = errBox(e); }
  }
  // 站牌：每條路線「往哪裡、還要幾分」（台北等公車那種）
  async function openBusStop(g) {
    S.panelDest = { name: g.name, p: g.p }; S.saveDest = { name: g.name + '（公車站）', p: g.p };
    map.easeTo({ center: g.p, zoom: Math.max(map.getZoom(), 16) });
    setBody(`${backBtn}<div class="ph"><div class="tag"><i class="dot d-bus"></i>公車站牌</div><h2>${esc(g.name)}</h2><small id="busTick" class="fine"></small><div class="acts">${navBtn}${saveBtn}</div></div><div id="saveBox" hidden></div><div id="pBody">${loading}</div>`, 'busstop');
    const load = async () => {
      try {
        const rowsOut = [];
        for (const city of [...new Set(g.stops.map((s) => s.city))]) {
          const stops = g.stops.filter((s) => s.city === city);
          const uids = [...new Set(stops.map((s) => s.uid))];
          // 路線起訖站名：整個縣市一次抓、存本機 7 天（省 TDX 額度）
          const [eta, routes] = await Promise.all([
            tdx.get(C.EP.busEta(`City/${city}`, '').replace(/\/$/, ''), { $filter: uids.map((u) => `StopUID eq '${u}'`).join(' or '), $select: 'StopUID,RouteUID,RouteName,Direction,EstimateTime,StopStatus' }, 20),
            cachedGet(C.EP.busRoute(`City/${city}`), { $select: 'RouteUID,RouteName,DepartureStopNameZh,DestinationStopNameZh' }, 7).catch(() => []),
          ]);
          const rmap = new Map(routes.map((r) => [r.RouteUID, r]));
          eta.forEach((e) => { const r = rmap.get(e.RouteUID); rowsOut.push({ city, e, r }); });
        }
        if (S.view !== 'busstop' || !$('#pBody')) return;
        // 同一路線同方向只留一筆；依到站時間排序（沒時間的排後面）
        const seen = new Set();
        const list = rowsOut.filter(({ e }) => { const k = e.RouteUID + '|' + e.Direction; if (seen.has(k)) return false; seen.add(k); return true; })
          .map((x) => ({ ...x, t: C.busEtaText(x.e), sec: x.e.EstimateTime ?? Infinity }))
          .sort((a, b) => a.sec - b.sec || C.zh(a.e.RouteName).localeCompare(C.zh(b.e.RouteName), 'zh-TW'));
        if (!list.length) { $('#pBody').innerHTML = '<p class="muted">這個站牌目前沒有到站資料。</p>'; return; }
        $('#pBody').innerHTML = `<ul class="rows">${list.map((x, i) => {
          const to = x.r ? (x.e.Direction === 1 ? x.r.DepartureStopNameZh : x.r.DestinationStopNameZh) : '';
          return `<li class="tap" data-i="${i}"><b class="rt">${esc(C.zh(x.e.RouteName))}</b><span class="grow">${to ? '往 ' + esc(to) : ''}</span><span class="eta ${x.t.level}">${esc(x.t.text)}</span></li>`;
        }).join('')}</ul><p class="fine">點路線看全線站序、票價與所需時間。</p>`;
        if ($('#busTick')) $('#busTick').textContent = '更新於 ' + new Date().toLocaleTimeString('zh-TW', { hour12: false }) + '・每 30 秒自動更新';
        $('#pBody').querySelectorAll('[data-i]').forEach((li) => li.addEventListener('click', () => {
          const x = list[+li.dataset.i];
          if (x.r) openRoute(`City/${x.city}`, x.r, x.e.Direction === 1 ? 1 : 0, g.name);
        }));
      } catch (e) { if ($('#pBody')) $('#pBody').innerHTML = errBox(e); }
    };
    await load();
    S.timers.push(setInterval(() => { if (!document.hidden && S.view === 'busstop') load(); }, 30000));
  }

  // ======================================================
  // 我的地點：把常去的地方存起來，用標籤分類（住家、工作、喜愛，也能自訂）
  //   只存在這台裝置（localStorage），不會上傳
  // ======================================================
  const DEFAULT_TAGS = ['住家', '工作', '喜愛'];
  const TAG_COLORS = { 住家: '#34c759', 工作: '#5856d6', 喜愛: '#ff2d55' };
  const tagColor = (t) => TAG_COLORS[t] || ['#ff9500', '#30b0c7', '#af52de', '#a2845e', '#007aff'][[...t].reduce((a, c) => a + c.charCodeAt(0), 0) % 5];
  const Places = {
    all() { try { return JSON.parse(LS.getItem('places') || '[]'); } catch { return []; } },
    save(list) { LS.setItem('places', JSON.stringify(list)); },
    tags() {
      const t = new Set(DEFAULT_TAGS);
      try { JSON.parse(LS.getItem('placeTags') || '[]').forEach((x) => t.add(x)); } catch { /* 忽略 */ }
      this.all().forEach((p) => t.add(p.tag));
      return [...t];
    },
    addTag(t) { const l = this.tags().filter((x) => !DEFAULT_TAGS.includes(x)); if (!l.includes(t)) l.push(t); LS.setItem('placeTags', JSON.stringify(l)); },
    find(d) { return this.all().find((x) => C.dist(x.p, d.p) < 30); },
    add(d, tag, name) {
      const l = this.all().filter((x) => C.dist(x.p, d.p) >= 30);
      l.unshift({ id: Date.now().toString(36), name: name || d.name, p: d.p, tag, addr: d.addr || '' });
      this.save(l);
    },
    remove(id) { this.save(this.all().filter((x) => x.id !== id)); },
  };
  const saveBtn = '<button class="btn" data-act="savePlace" title="存成我的地點"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3.2l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.6l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/></svg>存</button>';
  // 存地點的小面板（在目前頁面上方展開）
  function openSaveBox(d) {
    const box = $('#saveBox'); if (!box || !d) return;
    const had = Places.find(d);
    let tag = had?.tag || '喜愛';
    const draw = () => {
      box.hidden = false;
      box.innerHTML = `<div class="savebox">
        <label class="fine" for="spName">名稱</label><input id="spName" class="inp" value="${esc(had?.name || d.name)}" maxlength="40">
        <div class="fine" style="margin:8px 0 4px">標籤</div>
        <div class="chips tags">${Places.tags().map((t) => `<button class="chip tag ${t === tag ? 'on' : ''}" data-tag="${esc(t)}" style="--c:${tagColor(t)}"><i></i>${esc(t)}</button>`).join('')}
          <button class="chip" data-newtag="1">＋ 自訂標籤</button></div>
        <div class="newtag" hidden><input id="spTag" class="inp" placeholder="新標籤名稱，例如：健身房、爸媽家" maxlength="12"><button class="btn" data-sv="tag">加入</button></div>
        <div class="acts"><button class="btn pri" data-sv="ok">${had ? '更新' : '存起來'}</button>${had ? '<button class="btn red" data-sv="del">移除</button>' : ''}<button class="btn" data-sv="no">取消</button></div></div>`;
      box.querySelectorAll('[data-tag]').forEach((b) => b.addEventListener('click', () => { tag = b.dataset.tag; draw(); }));
      box.querySelector('[data-newtag]').addEventListener('click', () => { box.querySelector('.newtag').hidden = false; $('#spTag').focus(); });
      const addTag = () => {
        const t = $('#spTag').value.trim().slice(0, 12);
        if (!t) return;
        const nm = $('#spName').value;
        Places.addTag(t); tag = t; draw(); $('#spName').value = nm;
      };
      box.querySelector('[data-sv="tag"]').addEventListener('click', addTag);
      $('#spTag').addEventListener('keydown', (e) => { if (e.key === 'Enter') addTag(); });
      box.querySelector('[data-sv="ok"]').addEventListener('click', () => {
        Places.add(d, tag, $('#spName').value.trim() || d.name);
        box.hidden = true; toast(`已存到「${tag}」`);
      });
      box.querySelector('[data-sv="del"]')?.addEventListener('click', () => { Places.remove(had.id); box.hidden = true; toast('已移除'); });
      box.querySelector('[data-sv="no"]').addEventListener('click', () => { box.hidden = true; });
    };
    draw();
  }
  // 首頁「我的地點」：可依標籤篩選，點了直接規劃路線
  function renderMyPlaces() {
    const box = $('#myPlaces'); if (!box) return;
    const list = Places.all();
    if (!list.length) { box.innerHTML = '<p class="fine">搜尋地點或點站牌後，按「存」就能把常去的地方存起來，用「住家／工作／喜愛」或自訂標籤分類。</p>'; return; }
    const tags = [...new Set(list.map((p) => p.tag))];
    const f = S.placeTag && tags.includes(S.placeTag) ? S.placeTag : '';
    const ref = S.me || (map ? map.getCenter().toArray() : null);
    const shown = list.filter((p) => !f || p.tag === f);
    box.innerHTML = `<div class="chips tags">${['', ...tags].map((t) => `<button class="chip tag ${t === f ? 'on' : ''}" data-pt="${esc(t)}" style="--c:${t ? tagColor(t) : 'var(--blue)'}">${t ? '<i></i>' : ''}${esc(t || '全部')}</button>`).join('')}
        <button class="chip" data-pedit="1">${S.placeEdit ? '完成' : '編輯'}</button></div>
      <div class="list" style="margin-top:8px">${shown.map((p) => `<div class="item"><i class="dot" style="background:${tagColor(p.tag)}"></i>
        <button class="grow" data-pid="${p.id}" style="text-align:left"><span class="t1">${esc(p.name)}</span><div class="t2">${esc(p.tag)}${ref ? '・' + C.fmtDist(C.dist(ref, p.p)) : ''}${p.addr && p.addr !== p.name ? '・' + esc(p.addr) : ''}</div></button>
        ${S.placeEdit ? `<button class="lnk" data-pdel="${p.id}" style="color:var(--red)">刪除</button>` : '<span class="muted">›</span>'}</div>`).join('')}</div>`;
    box.querySelectorAll('[data-pt]').forEach((b) => b.addEventListener('click', () => { S.placeTag = b.dataset.pt; renderMyPlaces(); }));
    box.querySelector('[data-pedit]').addEventListener('click', () => { S.placeEdit = !S.placeEdit; renderMyPlaces(); });
    box.querySelectorAll('[data-pdel]').forEach((b) => b.addEventListener('click', () => { Places.remove(b.dataset.pdel); renderMyPlaces(); }));
    box.querySelectorAll('[data-pid]').forEach((b) => b.addEventListener('click', () => {
      const p = list.find((x) => x.id === b.dataset.pid);
      if (p) previewRoute({ name: p.name, p: p.p, addr: p.addr });
    }));
  }

  // 位置名稱（反查地址，到路名）：位置變動超過 300 公尺才重查，避免太常打 Nominatim
  let lastGeo = null, lastGeoT = 0;
  async function updatePlaceLabel(p) {
    if (lastGeo && C.dist(lastGeo, p) < 300) return;
    if (Date.now() - lastGeoT < 20000) return;
    lastGeo = p; lastGeoT = Date.now();
    try {
      const j = await getJSON(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=17&accept-language=zh-TW&lat=${p[1].toFixed(5)}&lon=${p[0].toFixed(5)}`, '地址反查');
      const a = j.address || {};
      S.placeLabel = C.fmtAddr({ ...a, house_number: undefined }) || S.placeLabel;
      if (S.view === 'home') showHome();
    } catch { /* 查不到就只顯示縣市 */ }
  }

  // ======================================================
  // 站點面板
  // ======================================================
  function openFeature(layer, p, coords) {
    if (layer === 'bus-st') return focusBusStop(p.uid);
    const dest = { name: p.name, p: coords };
    if (p.kind === 'metro') return openMetro(p, dest);
    if (p.kind === 'tra') return openTra(p, dest);
    if (p.kind === 'thsr') return openThsr(p, dest);
    if (p.kind === 'bike') return openBike(p, dest);
  }
  const navBtn = '<button class="btn pri" data-act="navhere"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.6 3.4 3.7 10.3c-.8.3-.7 1.4.1 1.6l6.8 1.6 1.6 6.8c.2.8 1.3.9 1.6.1z"/></svg>路線</button>';
  function panel(tag, color, title, sub, bodyId, dest) {
    S.panelDest = dest; S.saveDest = dest;
    return `${backBtn}<div class="ph"><div class="tag"><i class="dot" style="background:${color}"></i>${esc(tag)}</div><h2>${esc(title)}</h2>${sub ? `<small>${esc(sub)}</small>` : ''}<div class="acts">${navBtn}${saveBtn}</div></div><div id="saveBox" hidden></div><div id="${bodyId}">${loading}</div>`;
  }

  async function openMetro(p, dest) {
    setBody(panel(C.METRO_OPS[p.op]?.name || p.op, p.color, p.name, p.id, 'pBody', dest)
      + `<div class="sec"><h3>到哪一站？</h3><div class="fare-pick"><select id="mDest" aria-label="目的站"><option value="">選目的站，看票價和所需時間</option></select></div><div id="mFare"></div></div>`, 'panel');
    fillMetroDest(p);
    // 地圖只畫經過這站的線（例如台北車站＝板南線＋淡水信義線）
    const stLines = [...new Set((S.metroByOp[p.op]?.stations.features || []).filter((f) => f.properties.name === p.name).map((f) => linePrefix(f.properties.id)))];
    setFocus({ kind: 'station', op: p.op, lines: stLines.length ? stLines : [linePrefix(p.id)] });
    // 一打開就算「從你最近的站到這站」要多少錢、多久；下拉選單可改成「從這站到別站」
    const near = nearestMetro(p.op);
    if (near && near.name !== p.name) showMetroFare(near, p, `從離你最近的「${near.name}」到這站`);
    try {
      const rows = await tdx.get(C.EP.metroLive(p.op), { $filter: `StationName/Zh_tw eq '${p.name.replace(/'/g, "''")}'` }, 20);
      if (!rows.length) {
        const h = new Date().getHours();
        $('#pBody').innerHTML = `<p class="muted">${h >= 0 && h < 6 ? '現在是捷運非營運時間（約 0～6 點），沒有即時列車。' : '此站目前沒有即時列車資料（部分捷運系統 TDX 不提供即時到站）。'}</p>`;
        return;
      }
      $('#pBody').innerHTML = `<ul class="rows">${rows.map((r) => {
        const m = r.EstimateTime;
        const lv = m == null ? 'none' : m <= 1 ? 'now' : m <= 3 ? 'soon' : 'later';
        return `<li><span class="ln" style="--c:${lineColor(p.op, r.LineID)}">${esc(r.LineID || '')}</span><span class="grow">往 ${esc(C.zh(r.DestinationStationName) || r.TripHeadSign || '')}</span><span class="eta ${lv}">${m == null ? '—' : m <= 1 ? '進站' : m + ' 分'}</span></li>`;
      }).join('')}</ul><p class="fine">TDX 捷運 LiveBoard；時間單位依規格為分鐘。</p>`;
    } catch (e) { $('#pBody').innerHTML = e.kind === 'notfound' ? '<p class="muted">此捷運系統 TDX 未提供即時到站。</p>' : errBox(e); }
  }
  // 捷運票價＋所需時間：同一個營運系統內（例如北捷到北捷）
  function fillMetroDest(p) {
    const sel = $('#mDest'); if (!sel) return;
    const feats = S.metroByOp[p.op]?.stations.features || [];
    const seen = new Set([p.name]);
    const opts = feats.filter((f) => { const n = f.properties.name; if (seen.has(n)) return false; seen.add(n); return true; })
      .sort((a, b) => a.properties.id.localeCompare(b.properties.id, 'en', { numeric: true }));
    sel.insertAdjacentHTML('beforeend', opts.map((f) => `<option value="${esc(f.properties.id)}">${esc(f.properties.name)}（${esc(f.properties.id)}）</option>`).join(''));
    sel.addEventListener('change', () => { const f = opts.find((x) => x.properties.id === sel.value); if (f) showMetroFare(p, f.properties); });
  }

  // 一條捷運線：只亮這條線；列出每一站「從你最近的站出發要多少錢、多久」
  async function openLine(op, line) {
    const all = S.metroByOp[op]?.stations.features || [];
    const num = (id) => parseFloat(id.replace(/^[A-Z]+/, '')) || 0;
    const seen = new Set();
    const sts = all.filter((f) => linePrefix(f.properties.id) === line)
      .sort((a, b) => num(a.properties.id) - num(b.properties.id))
      .filter((f) => { if (seen.has(f.properties.name)) return false; seen.add(f.properties.name); return true; });
    if (!sts.length) return;
    const color = lineColor(op, line + '1');
    setFocus({ kind: 'line', op, line });
    setLayer('bike', false);
    const bb = bboxOf({ coordinates: sts.map((f) => f.geometry.coordinates) });
    if (bb) map.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: fitPad(), duration: 800, maxZoom: 14 });
    let from = nearestMetro(op) || sts[0].properties;
    const fromOpts = [...new Map(all.map((f) => [f.properties.name, f.properties])).values()].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
    setBody(`${backBtn}<div class="ph"><div class="tag"><i class="dot" style="background:${color}"></i>${esc(C.METRO_OPS[op]?.name || op)}</div><h2 style="color:${color}">${esc(lineName(op, line))}</h2>
      <small>共 ${sts.length} 站・地圖只亮這條線</small></div>
      <div class="fare-pick"><label class="fine" for="lnFrom">從哪一站出發（預設離你最近）</label><select id="lnFrom">${fromOpts.map((s) => `<option value="${esc(s.id)}" ${s.name === from.name ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
      <ol class="line-st" id="lnBody" style="--c:${color}">${sts.map((f, i) => `<li data-i="${i}"><button class="grow">${esc(f.properties.name)}<small>${esc(f.properties.id)}</small></button><span class="q" data-q="${i}"><span class="spin"></span></span></li>`).join('')}</ol>
      <p class="fine">票價＝單程全票；時間＝TDX 站間行駛＋停站時間，轉乘每次另估 5 分鐘，不含等車。</p>`, 'line');
    $('#lnBody').querySelectorAll('li[data-i] button').forEach((b) => b.addEventListener('click', () => {
      const f = sts[+b.parentElement.dataset.i];
      map.easeTo({ center: f.geometry.coordinates, zoom: Math.max(map.getZoom(), 15) });
      openMetro(f.properties, { name: f.properties.name, p: f.geometry.coordinates });
    }));
    const fill = async () => {
      const data = await metroData(from);
      if (S.view !== 'line' || !$('#lnBody')) return;
      sts.forEach((f, i) => {
        const el = $(`#lnBody [data-q="${i}"]`); if (!el) return;
        if (f.properties.name === from.name) { el.innerHTML = '<b class="here">出發站</b>'; return; }
        const q = metroQuote(data, from, f.properties.name);
        el.innerHTML = `<b>${q.fare != null ? q.fare + ' 元' : '—'}</b><small>${q.min != null ? '約 ' + q.min + ' 分' + (q.time.transfers ? `・轉 ${q.time.transfers}` : '') : '—'}</small>`;
      });
      if (data.fareErr || data.timeErr) toast(data.fareErr || data.timeErr);
    };
    $('#lnFrom').addEventListener('change', (e) => {
      from = fromOpts.find((s) => s.id === e.target.value) || from;
      $('#lnBody').querySelectorAll('.q').forEach((q) => { q.innerHTML = '<span class="spin"></span>'; });
      fill();
    });
    fill();
  }
  // 捷運清單上方的「路線」選擇（選了才亮顯那條線）
  function lineChips() {
    const seen = new Set(), chips = [];
    (S.county?.metro || []).forEach((op) => (S.metroByOp[op]?.stations.features || []).forEach((f) => {
      const ln = linePrefix(f.properties.id), k = op + ':' + ln;
      if (!ln || seen.has(k)) return; seen.add(k);
      chips.push({ op, ln, name: lineName(op, ln), color: lineColor(op, f.properties.id) });
    }));
    return chips.length ? `<div class="sec"><h3>選一條線（地圖只亮那條線）</h3><div class="chips lines">${chips.map((c) => `<button class="chip ln" data-op="${c.op}" data-ln="${c.ln}" style="--c:${c.color}"><i></i>${esc(c.name)}</button>`).join('')}</div></div>` : '';
  }
  // 從 from 站到 to 站（同一個營運系統）：全票票價、所需時間、轉乘次數。票價與行車時間表都存本機 7 天
  async function metroData(from) {
    const out = { fareRows: null, tt: null, fareErr: '', timeErr: '' };
    try { out.fareRows = await cachedGet(C.EP.metroFare(from.op), { $filter: `OriginStationID eq '${from.id}'`, $select: 'OriginStationID,DestinationStationID,DestinationStationName,Fares' }, 7); }
    catch (e) { out.fareErr = e.kind === 'notfound' ? '這個系統 TDX 沒提供票價' : (e.message || String(e)); }
    try { out.tt = await cachedGet(C.EP.metroTime(from.op), null, 7); }
    catch (e) { out.timeErr = e.kind === 'notfound' ? '這個系統 TDX 沒提供行車時間' : (e.message || String(e)); }
    return out;
  }
  function metroQuote(data, from, toName) {
    const q = { fare: null, time: null, fareErr: data.fareErr, timeErr: data.timeErr };
    if (data.fareRows) {
      const ids = new Set((S.metroByOp[from.op]?.stations.features || []).filter((f) => f.properties.name === toName).map((f) => f.properties.id));
      const row = data.fareRows.find((r) => ids.has(r.DestinationStationID)) || data.fareRows.find((r) => C.zh(r.DestinationStationName) === toName);
      q.fare = row ? C.metroAdultFare(row) : null;
      if (q.fare == null) q.fareErr = 'TDX 沒有這兩站的票價';
    }
    if (data.tt) {
      q.time = C.metroTravel(data.tt, from.name, toName);
      if (!q.time) q.timeErr = '算不出時間（TDX 行車時間缺這段）';
    }
    q.min = q.time ? Math.max(1, Math.round(q.time.sec / 60)) : null;
    return q;
  }
  // 同系統裡離你最近的站（當票價、時間的出發站）
  function nearestMetro(op) {
    const ref = S.me; if (!ref) return null;
    let best = null, bd = Infinity;
    (S.metroByOp[op]?.stations.features || []).forEach((f) => { const d = C.dist(ref, f.geometry.coordinates); if (d < bd) { bd = d; best = f.properties; } });
    return best ? { ...best, d: bd } : null;
  }
  async function showMetroFare(p, to, title) {
    const box = $('#mFare'); if (!box) return;
    box.innerHTML = loading;
    const q = metroQuote(await metroData(p), p, to.name);
    const out = { fare: q.fare, time: q.time, fareErr: q.fareErr, timeErr: q.timeErr };
    if (!$('#mFare')) return;
    const min = q.min;
    box.innerHTML = `<p class="fine" style="margin:0 0 4px">${esc(title || `${p.name} → ${to.name}`)}</p><div class="tsum">
      <div><small>票價（全票）</small><b>${out.fare != null ? out.fare + ' 元' : '—'}</b>${out.fareErr ? `<small class="muted">${esc(out.fareErr)}</small>` : ''}</div>
      <div><small>所需時間</small><b>${min != null ? '約 ' + min + ' 分' : '—'}</b>${out.timeErr ? `<small class="muted">${esc(out.timeErr)}</small>` : ''}</div>
      <div><small>轉乘</small><b>${out.time ? (out.time.transfers ? out.time.transfers + ' 次' : '不用轉') : '—'}</b></div></div>
      <p class="fine">時間＝TDX 站間行駛＋停站時間${out.time?.transfers ? '，每次轉乘另估 5 分鐘（含走路），不含等車' : '，不含等車'}。票價為單程全票。</p>`;
  }
  async function openTra(p, dest) {
    setFocus({ kind: 'tra' });
    setBody(panel('臺鐵', '#1b3a8c', p.name, p.id, 'pBody', dest), 'panel');
    const load = async () => {
      try {
        const rows = await tdx.get(C.EP.traLive(p.id), null, 30);
        if (!$('#pBody')) return;
        if (!rows.length) { $('#pBody').innerHTML = '<p class="muted">目前沒有即將進站的列車。</p>'; return; }
        const tk = (r) => r.ScheduledDepartureTime || r.ScheduledArrivalTime || '';
        rows.sort((a, b) => tk(a).localeCompare(tk(b)));
        $('#pBody').innerHTML = `<ul class="rows">${rows.map((r) => {
          const d = r.DelayTime || 0;
          return `<li><span class="t">${esc(hm(tk(r)))}</span><span class="grow"><b>${esc(C.zh(r.TrainTypeName).replace(/\(.*\)/, ''))}</b> ${esc(r.TrainNo)}<div class="fine">往 ${esc(C.zh(r.EndingStationName))}・${r.Direction === 0 ? '順行' : '逆行'}</div></span><span class="eta ${d > 0 ? 'now' : 'later'}">${d > 0 ? '晚 ' + d + ' 分' : '準點'}</span></li>`;
        }).join('')}</ul><p class="fine">台鐵 LiveBoard 只列近期班次，每分鐘更新。</p>`;
      } catch (e) { if ($('#pBody')) $('#pBody').innerHTML = errBox(e); }
    };
    load();
    S.timers.push(setInterval(() => { if (!document.hidden) load(); }, 60000));
  }
  async function openThsr(p, dest) {
    setFocus({ kind: 'thsr' });
    setBody(panel('高鐵', '#e8730c', p.name, '', 'pBody', dest), 'panel');
    try {
      const up = C.thsrUpcoming(await tdx.get(C.EP.thsrDaily(p.id, C.ymd(new Date())), null, 600), new Date(), 6);
      const col = (t, list) => `<div><div class="sec"><h3>${t}</h3></div>${list.length ? `<ul class="rows">${list.map((x) => `<li><span class="t">${esc(x.dep)}</span><span class="grow">${esc(x.no)}・${esc(x.end)}</span></li>`).join('')}</ul>` : '<p class="muted">今日已無班次</p>'}</div>`;
      $('#pBody').innerHTML = `<div class="cols">${col('南下', up[0])}${col('北上', up[1])}</div><p class="fine">依今日時刻表；誤點以高鐵公告為準。</p>`;
    } catch (e) { $('#pBody').innerHTML = errBox(e); }
  }
  async function openBike(p, dest) {
    const render = (rent, ret, detail, upd) => {
      const lv = rent < 0 ? '' : rent === 0 ? 'now' : rent <= 3 ? 'soon' : 'later';
      return `<div class="big2"><div class="stat ${lv}"><b>${rent < 0 ? '—' : rent}</b><span>可借</span></div><div class="stat"><b>${ret < 0 ? '—' : ret}</b><span>可還</span></div></div>
        ${detail ? `<p class="muted">一般 ${detail.GeneralBikes ?? '—'} 台・電輔 ${detail.ElectricBikes ?? '—'} 台</p>` : ''}
        <p class="fine">${upd ? '更新於 ' + esc(new Date(upd).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })) : ''}</p>
        <button class="btn" id="bikeRefresh">重新整理</button>`;
    };
    setBody(panel('YouBike', '#ffcc00', p.name, p.cap > 0 ? `總車位 ${p.cap}` : '', 'pBody', dest), 'panel');
    $('#pBody').innerHTML = render(p.rent, p.ret);
    const refresh = async () => {
      try {
        const rows = await tdx.get(C.EP.bikeAvail(S.county.code), { $filter: `StationUID eq '${p.id}'` }, 20);
        const a = rows[0];
        if ($('#pBody')) $('#pBody').innerHTML = a ? render(a.AvailableRentBikes, a.AvailableReturnBikes, a.AvailableRentBikesDetail, a.UpdateTime) : '<p class="muted">查無此站即時資料</p>';
      } catch (e) { if ($('#pBody')) $('#pBody').innerHTML = errBox(e); }
    };
    refresh();
  }

  // ======================================================
  // 搜尋：地點（Nominatim）、公車（TDX）
  // ======================================================
  function setQMode(m) {
    S.qMode = m;
    const narrow = document.body.classList.contains('pip') && !isWide();
    $('#q').placeholder = narrow ? '搜尋' : G ? '搜尋地點、店家或公車' : '搜尋地點或公車號碼';
  }
  // 公車號碼：307、紅31、藍1、小1、F612、幹線 1、9025 …（「307公車」也算）
  const isBusQuery = (q) => /^((紅|藍|綠|橘|棕|黃|小|內科|市民|幹線|跳)\s*)?[A-Za-z]?\d{1,4}[A-Za-z]?(副|區|延|直達車|區間車)?(公車|路)?$/.test(q.replace(/\s+/g, ''));
  // 捷運：搜站名；不打字就列出附近的站，依距離由近到遠
  async function searchMetro(q) {
    const head = (t) => `${backBtn}<div class="ph"><div class="tag"><i class="dot d-metro"></i>捷運</div><h2>${esc(t)}</h2></div>`;
    if (!S.county) { toast('還沒定位到你，請允許定位或把地圖移到要看的地方'); return showHome(); }
    if (!S.county.metro.length) { setBody(`${head(S.county.name)}<p class="muted">這個縣市沒有捷運或輕軌。</p>`, 'search'); return; }
    if (!tdx.ready()) return openSettings('先設定 TDX 金鑰才能查捷運。');
    setFocus({ kind: 'metro' });   // 只畫捷運站，不畫路線；選了線或站才畫線
    setBody(`${head(q || '附近的捷運站')}<div id="lnChips"></div><div class="sec"><h3>${q ? '找到的站' : '離你最近的站'}</h3><div id="rBody">${loading}</div></div>`, 'search');
    await ensure('metro');
    if (!q && $('#lnChips')) {
      $('#lnChips').innerHTML = lineChips();
      $('#lnChips').querySelectorAll('.chip.ln').forEach((b) => b.addEventListener('click', () => openLine(b.dataset.op, b.dataset.ln)));
    }
    const me = await quickPos();
    const ref = me || map.getCenter().toArray();
    const nz = (s) => s.replace(/臺/g, '台').replace(/\s/g, '');   // 台／臺 視為相同
    const key = nz(q).replace(/站$/, '');
    const seen = new Set(), list = [];
    S.county.metro.forEach((op) => (S.metroByOp[op]?.stations.features || []).forEach((f) => {
      const p = f.properties;
      if (key && !nz(p.name).includes(key)) return;
      const k = p.op + p.name; if (seen.has(k)) return; seen.add(k);
      list.push({ f, d: C.dist(ref, f.geometry.coordinates) });
    }));
    list.sort((a, b) => a.d - b.d);
    const rows = list.slice(0, 40);
    if (!$('#rBody')) return;
    if (!rows.length) { $('#rBody').innerHTML = '<p class="muted">找不到這個站名。</p>'; return; }
    $('#rBody').innerHTML = `<div class="list">${rows.map((r, i) => {
      const p = r.f.properties;
      return `<button class="item" data-i="${i}"><i class="dot" style="background:${p.color}"></i><span class="grow"><span class="t1">${esc(p.name)}</span><div class="t2">${esc(C.METRO_OPS[p.op]?.name || p.op)}</div></span><span class="t2 num">${C.fmtDist(r.d)}</span><span class="muted">›</span></button>`;
    }).join('')}</div><p class="fine">依離${me ? '你' : '地圖中心'}的距離，由近到遠</p>`;
    $('#rBody').querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => {
      const f = rows[+b.dataset.i].f;
      map.easeTo({ center: f.geometry.coordinates, zoom: Math.max(map.getZoom(), 15) });
      openMetro(f.properties, { name: f.properties.name, p: f.geometry.coordinates });
    }));
  }
  // 仿 Google／Apple 地圖：以你的位置（拿不到就用地圖中心）為準，
  // 先找附近約 20 公里內，太少再補全台，最後依距離由近到遠排。
  function quickPos() {
    if (S.me || !navigator.geolocation) return Promise.resolve(S.me || null);
    // 自己計時：權限視窗沒人按時，瀏覽器的 timeout 不會開始算，搜尋會卡住
    return new Promise((res) => {
      const t = setTimeout(() => res(null), 4000);
      navigator.geolocation.getCurrentPosition(
        (g) => { clearTimeout(t); S.me = [g.coords.longitude, g.coords.latitude]; placeMe(S.me); startPosWatch(); res(S.me); },
        () => { clearTimeout(t); res(null); }, { timeout: 4000, maximumAge: 60000 });
    });
  }
  async function searchPlaces(q) {
    const me = await quickPos();
    const ref = me || (map ? map.getCenter().toArray() : [121.5, 25.05]);
    const refLbl = me ? '你' : '地圖中心';
    const base = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=tw&accept-language=zh-TW&q=${encodeURIComponent(q)}`;
    const d = 0.2;
    const vb = `&viewbox=${ref[0] - d},${ref[1] + d},${ref[0] + d},${ref[1] - d}`;
    const near = await getJSON(`${base}&limit=40${vb}&bounded=1`, '地點搜尋');
    let rows = near;
    if (near.length < 5) {
      await new Promise((r) => setTimeout(r, 1100)); // Nominatim 規定每秒最多 1 次
      const far = await getJSON(`${base}&limit=20${vb}`, '地點搜尋');
      const seen = new Set(near.map((r) => r.place_id));
      rows = near.concat(far.filter((r) => !seen.has(r.place_id)));
    }
    // 門牌查不到時（開放地圖常常沒收門牌），退一步查「路／巷」，至少定位到那條路
    if (!rows.length && /[號巷弄]/.test(q)) {
      for (const q2 of [q.replace(/\d+(之\d+)?\s*號.*$/, ''), q.replace(/\d+\s*[巷弄].*$/, '')]) {
        if (!q2 || q2 === q) continue;
        await new Promise((r) => setTimeout(r, 1100));
        const b2 = base.replace(/q=[^&]*$/, 'q=' + encodeURIComponent(q2));
        rows = await getJSON(`${b2}&limit=20${vb}`, '地點搜尋');
        if (rows.length) break;
      }
    }
    rows.forEach((r) => { r._d = C.dist(ref, [+r.lon, +r.lat]); });
    rows.sort((a, b) => a._d - b._d);
    return { rows, refLbl };
  }
  async function runSearch() {
    const q = $('#q').value.trim();
    if (!q) return;
    $('#q').blur();
    if (isBusQuery(q) && tdx.ready() && S.county) return searchBus(q.replace(/(公車|路)$/, '').replace(/\s+/g, ''), S.busScope || 'City');
    if (G) return runGoogleSearch(q);
    setBody(`${backBtn}<div class="ph"><div class="tag">地點</div><h2>${esc(q)}</h2></div><div id="rBody">${loading}</div>`, 'search');
    try {
      const { rows, refLbl } = await searchPlaces(q);
      if (!rows.length) { $('#rBody').innerHTML = '<p class="muted">找不到這個地點，換個寫法試試（例如加上縣市或路名）。</p>'; return; }
      // 地址寫成台灣慣用格式：縣市＋區＋路（＋門牌）。有查門牌但資料只到路段時，明講
      const askedNo = /\d+\s*號/.test(q);
      const KIND = { house: '門牌', building: '建築', road: '道路', primary: '道路', secondary: '道路', tertiary: '道路', residential: '道路', unclassified: '道路', bus_stop: '公車站', station: '車站' };
      const label = (r) => {
        const a = r.address || {};
        const addr = C.fmtAddr(a) || r.display_name.split(',').slice(0, 4).reverse().join('').replace(/\s/g, '');
        const isRoad = (r.category === 'highway' || r.class === 'highway') && /^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|service|living_street|pedestrian|footway|road)$/.test(r.type);
        const street = C.fmtAddr({ road: a.road || a.pedestrian || a.footway, house_number: a.house_number });
        const nm = r.name && !isRoad && r.name !== a.house_number ? r.name : (street || r.name || addr);
        const poi = !!(r.name && !isRoad && r.name !== a.house_number);
        return { nm, addr, kind: KIND[r.type] || (isRoad ? '道路' : ''), exact: !!a.house_number, isRoad, poi };
      };
      const exact = rows.some((r) => r.address?.house_number);
      $('#rBody').innerHTML = `${askedNo && !exact ? '<p class="note">開放地圖資料沒有收錄這個門牌，下面先列出同一條路的位置（會定位到路段，不是門口）。</p>' : ''}
        <div class="list">${rows.map((r, i) => {
          const L = label(r);
          return `<button class="item" data-i="${i}"><span class="grow"><span class="t1">${esc(L.nm)}${L.kind ? ` <span class="kind">${L.kind}</span>` : ''}</span><div class="t2">${esc(L.addr)}</div></span><span class="t2 num">${C.fmtDist(r._d)}</span><span class="muted">›</span></button>`;
        }).join('')}</div><p class="fine">依離${refLbl}的距離，由近到遠・地點資料：OpenStreetMap Nominatim</p>`;
      const places = rows.map((r) => { const L = label(r); return { name: L.poi ? L.nm : L.exact ? L.addr : L.nm, p: [+r.lon, +r.lat], addr: L.addr, type: L.kind }; });
      showSearchPins(places);
      S.searchBack = () => runSearch();
      $('#rBody').querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => openPlace(places[+b.dataset.i])));
    } catch (e) { $('#rBody').innerHTML = errBox(e); }
  }
  async function runGoogleSearch(q) {
    setBody(`${backBtn}<div class="ph"><div class="tag">搜尋</div><h2>${esc(q)}</h2></div><div id="rBody">${loading}</div>`, 'search');
    try {
      const { rows, refLbl } = S.lastG && S.lastG.q === q ? S.lastG : { q, ...(await searchGoogle(q)) };
      S.lastG = { q, rows, refLbl };
      if (!$('#rBody')) return;
      if (!rows.length) { $('#rBody').innerHTML = '<p class="muted">找不到，換個寫法試試（例如加上縣市或路名）。</p>'; return; }
      showSearchPins(rows);
      S.searchBack = () => runGoogleSearch(q);
      if (rows.length === 1) return openPlace(rows[0]);
      const pts = rows.map((r) => r.p);
      const bb = bboxOf({ coordinates: pts });
      if (bb) map.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: fitPad(), duration: 700, maxZoom: 16 });
      $('#rBody').innerHTML = `<div class="list">${rows.map((r, i) => `<button class="item" data-i="${i}"><span class="grow"><span class="t1">${esc(r.name)}${r.type ? ` <span class="kind">${esc(r.type)}</span>` : ''}</span><div class="t2">${esc(r.addr)}</div></span><span class="t2 num">${C.fmtDist(r._d)}</span><span class="muted">›</span></button>`).join('')}</div><p class="fine">距離是離${refLbl}・地點資料：Google</p>`;
      $('#rBody').querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => openPlace(rows[+b.dataset.i])));
    } catch (e) { logExt('Google 地點搜尋', 'ERR', String(e.message || e)); if ($('#rBody')) $('#rBody').innerHTML = errBox(new Error('Google 搜尋失敗：' + gHint(e, 'Places API (New)'))); }
  }

  async function searchBus(q, scopeKind) {
    if (!S.county && scopeKind !== 'InterCity') { toast('還沒定位到你，請允許定位或把地圖移到要看的地方'); return showHome(); }
    if (!tdx.ready()) return openSettings('先設定 TDX 金鑰才能查公車。');
    S.busScope = scopeKind;
    // 市區公車：雙北一起查（臺北市、新北市的公車互相跨區，在新莊也搭得到 307）
    const scopes = scopeKind === 'InterCity' ? ['InterCity'] : busCities().map((c) => `City/${c}`);
    const cityLbl = S.county ? (busCities().length > 1 ? '雙北市區' : S.county.name + '市區') : '市區';
    setBody(`${backBtn}<div class="ph"><div class="tag">公車</div><h2>「${esc(q)}」</h2>
      <div class="acts"><div class="seg" id="busScope"><button data-s="City" class="${scopeKind !== 'InterCity' ? 'on' : ''}" ${S.county ? '' : 'disabled'}>${esc(cityLbl)}</button><button data-s="InterCity" class="${scopeKind === 'InterCity' ? 'on' : ''}">公路客運</button></div></div></div><div id="rBody">${loading}</div>`, 'search');
    $('#busScope').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => searchBus(q, b.dataset.s)));
    try {
      const rows = [];
      for (const scope of scopes) {
        const rs = await tdx.get(C.EP.busRoute(scope), { $filter: `contains(RouteName/Zh_tw,'${q.replace(/'/g, "''")}')`, $select: 'RouteUID,RouteName,DepartureStopNameZh,DestinationStopNameZh', $top: 40 }, 300)
          .catch((e) => { if (e.kind === 'notfound') return []; throw e; });
        rs.forEach((r) => rows.push({ ...r, _scope: scope }));
      }
      if (!$('#rBody')) return;
      if (!rows.length) { $('#rBody').innerHTML = '<p class="muted">找不到路線，試試切換「市區／公路客運」。</p>'; return; }
      rows.sort((a, b) => C.zh(a.RouteName).length - C.zh(b.RouteName).length || C.zh(a.RouteName).localeCompare(C.zh(b.RouteName), 'zh-TW'));
      const cityName = (sc) => (scopes.length > 1 ? (C.COUNTIES.find((c) => 'City/' + c.code === sc)?.name || '') : '');
      $('#rBody').innerHTML = `<div class="list">${rows.map((r, i) => `<button class="item" data-i="${i}"><b style="min-width:62px;font-size:17px;color:var(--teal)">${esc(C.zh(r.RouteName))}</b><span class="grow t2">${esc(r.DepartureStopNameZh || '')} ⇄ ${esc(r.DestinationStopNameZh || '')}${cityName(r._scope) ? `<br><small>${esc(cityName(r._scope))}公車</small>` : ''}</span><span class="muted">›</span></button>`).join('')}</div>`;
      $('#rBody').querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => { const r = rows[+b.dataset.i]; openRoute(r._scope, r); }));
    } catch (e) { $('#rBody').innerHTML = errBox(e); }
  }

  // 公車路線：站序＋每站到站時間＋票價＋（選上下車站後）所需時間
  //   boardName：從站牌點進來時，預設把那站當上車站
  async function openRoute(scope, route, dir = 0, boardName) {
    const name = C.zh(route.RouteName);
    if (!S.layers.bus) toggleLayer('bus');
    setFocus({ kind: 'bus' });   // 看公車時，捷運線淡化、YouBike 收起來
    setLayer('bike', false);
    setBody(`${backBtn}<div class="ph"><div class="tag"><i class="dot d-bus"></i>公車</div><h2>${esc(name)}</h2>
      <div class="acts" style="width:100%"><div class="seg" style="width:100%"><button data-d="0" class="${dir === 0 ? 'on' : ''}" style="flex:1">往 ${esc(route.DestinationStopNameZh || '去程')}</button><button data-d="1" class="${dir === 1 ? 'on' : ''}" style="flex:1">往 ${esc(route.DepartureStopNameZh || '返程')}</button></div></div>
      <small id="busTick" class="fine"></small></div><div id="busFare" class="fare"></div><div id="busTrip" class="trip" hidden></div><div id="sBody">${loading}</div>`, 'bus');
    $('#sheetBody').querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => {
      const bn = S.bus && S.bus.board != null ? S.bus.stops[S.bus.board].name : boardName;
      openRoute(scope, route, +b.dataset.d, bn);
    }));
    try {
      const f = `RouteUID eq '${route.RouteUID}'`;
      // 站序、線形很少變：存本機 3 天，重看同一條路線就不用再打 TDX（額度很緊）
      const stopsAll = await cachedGet(C.EP.busStops(scope, name), { $filter: f }, 3);
      const sor = stopsAll.find((s) => s.Direction === dir) || stopsAll[0];
      if (!sor) { $('#sBody').innerHTML = '<p class="muted">查無站序資料。</p>'; return; }
      const shapes = await cachedGet(C.EP.busShape(scope, name), { $filter: f }, 3).catch(() => []);
      const shp = shapes.find((s) => s.Direction === dir) || shapes[0];
      const stops = sor.Stops.map((s) => ({ uid: s.StopUID, name: C.zh(s.StopName), p: C.pos(s.StopPosition) }));
      // 預設上車站：指定的站名 → 否則離你 800 公尺內最近的站
      let board = boardName ? stops.findIndex((s) => s.name === boardName) : -1;
      if (board < 0 && S.me) {
        let bd = 800;
        stops.forEach((s, i) => { if (s.p) { const d = C.dist(S.me, s.p); if (d < bd) { bd = d; board = i; } } });
      }
      S.bus = { scope, route, dir, stops, eta: new Map(), board: board >= 0 ? board : null, alight: null, fare: null };
      loadBusFare(S.bus);
      const g = shp ? C.wktToGeometry(shp.Geometry) : null;
      map.getSource('bus-line').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: g || { type: 'LineString', coordinates: stops.map((s) => s.p).filter(Boolean) }, properties: {} }] });
      const pts = stops.map((s) => s.p).filter(Boolean);
      if (pts.length) { const bb = bboxOf({ coordinates: pts }); map.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: fitPad(), duration: 800, maxZoom: 15 }); }
      await refreshEta();
      S.timers.push(setInterval(() => { if (!document.hidden) refreshEta(); }, 30000));
    } catch (e) { $('#sBody').innerHTML = errBox(e); }
  }
  async function refreshEta() {
    const b = S.bus; if (!b) return;
    try {
      const rows = await tdx.get(C.EP.busEta(b.scope, C.zh(b.route.RouteName)), { $filter: `RouteUID eq '${b.route.RouteUID}' and Direction eq ${b.dir}`, $select: 'StopUID,Direction,EstimateTime,StopStatus' }, 15);
      b.eta = new Map(rows.map((r) => [r.StopUID, r]));
      if ($('#busTick')) $('#busTick').textContent = '更新於 ' + new Date().toLocaleTimeString('zh-TW', { hour12: false }) + '・每 30 秒自動更新';
    } catch (e) { if ($('#busTick')) $('#busTick').textContent = '到站時間更新失敗：' + (e.message || e); }
    if (S.bus !== b || !$('#sBody')) return;
    renderBusStops(b);
  }
  function renderBusStops(b) {
    const items = b.stops.map((s) => ({ ...s, ...C.busEtaText(b.eta.get(s.uid)) }));
    const tag = (i) => (i === b.board ? '<span class="tp on">上車</span>' : i === b.alight ? '<span class="tp off">下車</span>' : '');
    const inTrip = (i) => b.board != null && b.alight != null && i > b.board && i < b.alight;
    // 每一站：從上車站坐到這站要多少錢、多久（時間＝兩站即時預估相減）
    const names = b.stops.map((s) => s.name);
    const eB = b.board != null ? b.eta.get(b.stops[b.board].uid)?.EstimateTime : null;
    const sub = (i) => {
      if (b.board == null || i <= b.board) return '';
      const fi = b.fareRows ? C.busFareInfo(b.fareRows, b.dir, names, b.board, i) : null;
      const fare = !fi ? '' : fi.free ? '免費' : fi.unsupported ? '' : fi.ride != null ? `${fi.per * fi.ride} 元` : `${fi.per} 元起`;
      const z = b.eta.get(b.stops[i].uid)?.EstimateTime;
      const t = eB != null && z != null && z > eB ? `約 ${Math.max(1, Math.round((z - eB) / 60))} 分` : '';
      return fare || t ? `<span class="sub">${[fare, t].filter(Boolean).join('・')}</span>` : '';
    };
    $('#sBody').innerHTML = `<p class="fine" style="margin:2px 0 6px">點一站設為上車站，之後每站都會顯示「坐到這站多少錢、多久」；再點後面的站設為下車站。</p>
      <ol class="stops">${items.map((s, i) => `<li data-i="${i}" class="${i === b.board || i === b.alight ? 'sel' : ''}${inTrip(i) ? ' mid' : ''}"><span class="eta ${s.level}">${esc(s.text)}</span><button class="grow">${esc(s.name)}${sub(i)}</button>${tag(i)}</li>`).join('')}</ol>`;
    $('#sBody').querySelectorAll('li[data-i] button').forEach((btn) => btn.addEventListener('click', () => pickBusStop(+btn.parentElement.dataset.i)));
    map.getSource('bus-st').setData(C.pointsFC(items, (s) => s.p ? { type: 'Feature', geometry: { type: 'Point', coordinates: s.p }, properties: { uid: s.uid, name: s.name, level: s.level } } : null));
    renderBusTrip(b);
    if (!b.scrolled && b.board != null) { b.scrolled = true; $(`#sBody li[data-i="${b.board}"]`)?.scrollIntoView({ block: 'center' }); }
  }
  function pickBusStop(i) {
    const b = S.bus; if (!b) return;
    if (b.board == null || i <= b.board || (b.alight != null)) { b.board = i; b.alight = null; }
    else b.alight = i;
    const s = b.stops[i];
    if (s.p) map.easeTo({ center: s.p, zoom: Math.max(map.getZoom(), 15.5) });
    renderBusStops(b);
  }
  async function loadBusFare(b) {
    try {
      b.fareRows = await cachedGet(C.EP.busFare(b.scope, C.zh(b.route.RouteName)), null, 7);
    } catch (e) { b.fareRows = null; b.fareErr = e.kind === 'notfound' ? 'TDX 沒有這條路線的票價資料' : (e.message || String(e)); }
    if (S.bus === b && $('#sBody .stops')) renderBusStops(b); else if (S.bus === b) renderBusTrip(b);
  }
  // 票價列＋行程摘要（上車→下車：等車時間、坐車時間、票價）
  function renderBusTrip(b) {
    const names = b.stops.map((s) => s.name);
    const fi = b.fareRows ? C.busFareInfo(b.fareRows, b.dir, names, b.board, b.alight) : null;
    const fareEl = $('#busFare');
    if (fareEl) {
      fareEl.innerHTML = b.fareErr ? `<span class="muted">票價：${esc(b.fareErr)}</span> <button class="lnk" id="fareRetry">重試</button>`
        : !b.fareRows ? '<span class="muted">票價讀取中…</span>'
        : !fi ? '<span class="muted">票價：TDX 沒有資料</span>'
        : fi.free ? '<b>免費公車</b>'
        : fi.unsupported ? '<span class="muted">此路線不是段次計費（例如依里程），票價請以業者公告為準</span>'
        : `<b>全票 ${fi.per} 元</b><span>／段・全線 ${fi.total} 段${fi.zones.length ? `（緩衝區：${fi.zones.map((z) => esc(z[0]) + '～' + esc(z[1])).join('、')}）` : ''}</span>`;
      $('#fareRetry')?.addEventListener('click', () => { b.fareErr = ''; b.fareRows = null; renderBusTrip(b); loadBusFare(b); });
    }
    const tripEl = $('#busTrip'); if (!tripEl) return;
    if (b.board == null) { tripEl.hidden = true; return; }
    tripEl.hidden = false;
    const from = b.stops[b.board], to = b.alight != null ? b.stops[b.alight] : null;
    const eFrom = b.eta.get(from.uid), eTo = to ? b.eta.get(to.uid) : null;
    const wait = C.busEtaText(eFrom);
    let ride = '';
    if (to) {
      const a = eFrom?.EstimateTime, z = eTo?.EstimateTime;
      ride = a != null && z != null && z > a ? `約 ${Math.max(1, Math.round((z - a) / 60))} 分` : '目前沒有即時預估，算不出時間';
    }
    const price = fi && !fi.free && !fi.unsupported && to
      ? (fi.ride != null ? `${fi.per * fi.ride} 元${fi.ride > 1 ? `（${fi.ride} 段）` : ''}` : `${fi.per} 元起（是否跨段無法判斷）`)
      : fi?.free ? '免費' : '';
    tripEl.innerHTML = `<div class="tl"><span class="tp on">上車</span><b>${esc(from.name)}</b><span class="eta ${wait.level}">${esc(wait.text)}</span></div>
      ${to ? `<div class="tl"><span class="tp off">下車</span><b>${esc(to.name)}</b></div>
      <div class="tsum"><div><small>坐車時間</small><b>${esc(ride)}</b></div><div><small>票價（全票）</small><b>${esc(price || '—')}</b></div><div><small>站數</small><b>${b.alight - b.board} 站</b></div></div>`
      : '<p class="fine">再點後面的一站當下車站。</p>'}`;
  }
  function focusBusStop(uid) {
    const i = S.bus?.stops.findIndex((x) => x.uid === uid);
    if (i == null || i < 0) return;
    const s = S.bus.stops[i];
    if (s.p) map.easeTo({ center: s.p, zoom: Math.max(map.getZoom(), 15.5) });
    const li = $(`#sBody li[data-i="${i}"]`);
    if (li) { li.scrollIntoView({ block: 'center', behavior: 'smooth' }); li.classList.add('hl'); setTimeout(() => li.classList.remove('hl'), 1600); }
  }
  function clearBus() {
    S.bus = null;
    map?.getSource('bus-line')?.setData(emptyFC());
    map?.getSource('bus-st')?.setData(emptyFC());
  }

  // ======================================================
  // 地點資料卡（像 Google 地圖：搜尋或點店家 → 資料卡 → 路線）
  // ======================================================
  const PLACE_FIELDS = ['id', 'displayName', 'formattedAddress', 'location', 'primaryTypeDisplayName'];
  // 評分、營業時間、電話、照片是 Google 計價較高的欄位：只有打開資料卡才抓
  const DETAIL_FIELDS = ['rating', 'userRatingCount', 'regularOpeningHours', 'utcOffsetMinutes', 'nationalPhoneNumber', 'websiteURI', 'googleMapsURI', 'photos', 'businessStatus'];
  const cleanAddr = (a) => String(a || '').replace(/^\d{3,6}\s*/, '').replace(/^(台灣|臺灣)/, '').trim();
  const placeObj = (pl) => ({ id: pl.id, name: pl.displayName || '', addr: cleanAddr(pl.formattedAddress), p: C.llOf(pl.location), type: pl.primaryTypeDisplayName || '', g: pl });
  async function openPlaceId(id) {
    if (!G || !id) return;
    const { Place } = await google.maps.importLibrary('places');
    openPlace({ id, name: '', addr: '', p: null, g: new Place({ id, requestedLanguage: 'zh-TW' }) });
  }
  const svgI = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ICO_SV = svgI('<circle cx="12" cy="5" r="2.5"/><path d="M9 21l1-7-2-1 1.5-4.5h5L16 13l-2 1 1 7M4 18c0 1.7 3.6 3 8 3s8-1.3 8-3"/>');
  function openPlace(d) {
    S.place = d;
    setFocus(null);
    setDetent('half');
    const draw = () => {
      if (S.place !== d) return;
      const dest = d.p ? { name: d.name, p: d.p, addr: d.addr } : null;
      S.saveDest = dest; S.panelDest = dest;
      const g = d.full ? d.g : null;
      const meta = [];
      if (g?.rating) meta.push(`<span class="star">${g.rating.toFixed(1)} ★</span><span>(${(g.userRatingCount || 0).toLocaleString()})</span>`);
      if (d.type) meta.push(`<span>${esc(d.type)}</span>`);
      if (d.openNow != null) meta.push(d.openNow ? '<span class="open">營業中</span>' : '<span class="shut">休息中</span>');
      else if (g?.businessStatus === 'CLOSED_TEMPORARILY') meta.push('<span class="shut">暫停營業</span>');
      else if (g?.businessStatus === 'CLOSED_PERMANENTLY') meta.push('<span class="shut">永久歇業</span>');
      if (d.p && S.me) meta.push(`<span>${C.fmtDist(C.dist(S.me, d.p))}</span>`);
      const wk = g?.regularOpeningHours?.weekdayDescriptions || [];
      const today = wk[(new Date().getDay() + 6) % 7];
      let photo = '';
      try { if (g?.photos?.length) photo = `<img class="pphoto" alt="" loading="lazy" src="${esc(g.photos[0].getURI({ maxHeight: 400 }))}">`; } catch { /* 沒照片 */ }
      setBody(`${backBtn}<div class="ph"><div class="tag">${esc(d.type || '地點')}</div><h2>${esc(d.name || '載入中…')}</h2>${d.addr ? `<small>${esc(d.addr)}</small>` : ''}
        ${meta.length ? `<div class="pmeta">${meta.join('<span>・</span>')}</div>` : ''}
        <div class="acts">${dest ? '<button class="btn go" id="pcRoute">路線</button>' : ''}${G && dest ? `<button class="btn" id="pcSv">${ICO_SV}街景</button>` : ''}${dest ? saveBtn : ''}</div></div>
        <div id="saveBox" hidden></div>${photo}
        <div class="sec" id="pcMore">${d.full || !G || !d.g ? '' : loading}
          ${today || g?.nationalPhoneNumber || g?.websiteURI || g?.googleMapsURI ? `<div class="list">
            ${today ? `<details class="item" style="display:block"><summary class="t1" style="cursor:pointer">今天 ${esc(today.replace(/^[^:：]+[:：]\s*/, ''))}</summary><div class="t2" style="margin-top:6px;line-height:1.7">${wk.map(esc).join('<br>')}</div></details>` : ''}
            ${g?.nationalPhoneNumber ? `<a class="item" href="tel:${esc(g.nationalPhoneNumber.replace(/\s/g, ''))}"><span class="grow t1">${esc(g.nationalPhoneNumber)}</span><span class="muted">撥打</span></a>` : ''}
            ${g?.websiteURI ? `<a class="item" href="${esc(g.websiteURI)}" target="_blank" rel="noopener"><span class="grow t1" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(g.websiteURI.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</span><span class="muted">網站</span></a>` : ''}
            ${g?.googleMapsURI ? `<a class="item" href="${esc(g.googleMapsURI)}" target="_blank" rel="noopener"><span class="grow t1">在 Google 地圖看評論、照片</span><span class="muted">›</span></a>` : ''}
          </div>` : ''}</div>`, 'place');
      if (S.searchBack) S.backFn = S.searchBack;
      $('#pcRoute')?.addEventListener('click', () => previewRoute(dest));
      $('#pcSv')?.addEventListener('click', () => openStreetView(d.p));
    };
    draw();
    if (d.p) { setDestPin(d.p); map.easeTo({ center: d.p, zoom: Math.max(map.getZoom(), 16), padding: isWide() ? { left: 380 } : { bottom: sheetHeight() } }); }
    if (G && d.g && !d.full) {
      (async () => {
        try {
          await d.g.fetchFields({ fields: [...PLACE_FIELDS, ...DETAIL_FIELDS] });
          logExt('Google 地點資料', 200);
          Object.assign(d, placeObj(d.g), { full: true });
          try { d.openNow = d.g.regularOpeningHours ? await d.g.isOpen() : null; } catch { d.openNow = null; }
          if (S.place !== d) return;
          draw();
          if (d.p) { setDestPin(d.p); map.easeTo({ center: d.p, zoom: Math.max(map.getZoom(), 16) }); }
        } catch (e) {
          logExt('Google 地點資料', 'ERR', String(e.message || e));
          d.full = true;
          if (S.place === d) { draw(); if ($('#pcMore')) $('#pcMore').insertAdjacentHTML('afterbegin', errBox(new Error('地點詳細資料載入失敗：' + gHint(e, 'Places API (New)')))); }
        }
      })();
    }
  }

  // ---------- 街景（Google） ----------
  async function openStreetView(p) {
    if (!G || !p) return;
    try {
      const { StreetViewService, StreetViewPanorama } = await google.maps.importLibrary('streetView');
      const svc = new StreetViewService();
      const r = await svc.getPanorama({ location: { lat: p[1], lng: p[0] }, radius: 80, preference: 'nearest', source: 'outdoor' });
      $('#sv').hidden = false;
      const loc = r.data.location.latLng;
      const heading = google.maps.geometry ? google.maps.geometry.spherical.computeHeading(loc, new google.maps.LatLng(p[1], p[0])) : 0;
      S.pano = new StreetViewPanorama($('#svPano'), { pano: r.data.location.pano, pov: { heading, pitch: 0 }, addressControl: true, fullscreenControl: false, motionTracking: false, motionTrackingControl: false, zoomControl: false, panControl: false });
      logExt('Google 街景', 200);
    } catch (e) {
      logExt('Google 街景', 'ERR', String(e.message || e));
      toast('這裡附近沒有街景');
    }
  }

  // ---------- Google 地點搜尋（按「搜尋」才查，不會邊打邊查） ----------
  async function searchGoogle(q) {
    const { Place } = await google.maps.importLibrary('places');
    const me = await quickPos();
    const ref = me || map.getCenter().toArray();
    const { places } = await Place.searchByText({
      textQuery: q, fields: PLACE_FIELDS, language: 'zh-TW', region: 'tw', maxResultCount: 15,
      locationBias: { center: { lat: ref[1], lng: ref[0] }, radius: 30000 },
    });
    logExt('Google 地點搜尋', 200);
    const rows = (places || []).map(placeObj).filter((r) => r.p);
    rows.forEach((r) => { r._d = C.dist(ref, r.p); });
    return { rows, refLbl: me ? '你' : '地圖中心' };
  }
  // 搜尋結果插在地圖上（紅點），點了開資料卡
  function showSearchPins(rows) {
    if (!map.getSource('search')) return;
    map.getSource('search').setData({ type: 'FeatureCollection', features: rows.map((r, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: r.p }, properties: { i } })) });
    S.searchRows = rows;
  }
  function clearSearchPins() { if (map?.getSource('search')) map.getSource('search').setData(emptyFC()); S.searchRows = null; S.searchBack = null; }

  // ---------- 測速照相 ----------
  //   資料：警政署「測速執法設置點」＋國道固定式測速，GitHub 每天自動更新成 data/speedcam.json
  const CAM_ICONS = [0, 30, 40, 50, 60, 70, 80, 90, 100, 110];   // 有畫好的限速標誌，其他速限用通用相機圖示
  const SC = { list: null, loading: null, on: LS.getItem('speedcam') !== '0', near: null };
  const SPEEDCAM_URL = /github\.io$/.test(location.hostname) ? 'data/speedcam.json' : 'https://catsans666-maker.github.io/xinglu/data/speedcam.json';
  function loadSpeedcam() {
    if (SC.list) return Promise.resolve(SC.list);
    if (!SC.loading) {
      SC.loading = getJSON(SPEEDCAM_URL, '測速照相資料').then((j) => {
        SC.list = (j.cams || []).map((c) => {
          const src = c[5] || 'g';
          // 開放街圖的 direction 有人標「相機朝向」、有人標「車流方向」，不可靠 → 只用政府資料的方向
          const d = src === 'g' ? C.camDir(c[3]) : { deg: null, both: false };
          return { p: [c[0], c[1]], limit: c[2] || 0, dir: c[3] || '', addr: c[4] || '', src, deg: d.deg, both: d.both };
        });
        SC.updated = j.updated;
        if (map?.getSource('speedcam')) map.getSource('speedcam').setData({ type: 'FeatureCollection', features: SC.list.map((c) => {
          // 有方向的：標誌往行車方向的右側（台灣靠右）挪 9 公尺，同一點兩個方向的才分得開；旁邊再畫箭頭
          const p = c.deg != null ? C.offsetPt(c.p, c.deg + 90, 9) : c.p;
          const props = { limit: c.limit, icon: CAM_ICONS.includes(c.limit) ? c.limit : 0, addr: c.addr, dirTxt: c.both ? '雙向' : C.DIR_NAME(c.deg), src: c.src };
          if (c.deg != null) props.dir = c.deg;
          return { type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: props };
        }) });
        if (!$('#layerPop').hidden) renderLayerPop();
        return SC.list;
      }).catch((e) => { SC.loading = null; SC.err = true; throw e; });
    }
    return SC.loading;
  }
  function speedcamRow() {
    const note = SC.err ? '資料還沒準備好' : SC.list ? `${SC.list.length.toLocaleString()} 處・${SC.updated || ''} 更新・導航時語音提醒` : '導航時前方 500 公尺語音提醒';
    return `<button class="lrow" data-cam="1" role="switch" aria-checked="${SC.on}"><i class="dot" style="background:#e60012"></i><span class="grow">測速照相<small class="lnote">${note}</small></span><span class="sw ${SC.on ? 'on' : ''}"></span></button>`;
  }
  function applySpeedcam() {
    if (!map?.getLayer('speedcam')) return;
    ['speedcam', 'speedcam-dir'].forEach((id) => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', SC.on ? 'visible' : 'none'); });
    if (SC.on) loadSpeedcam().catch(() => toast('測速照相資料載入失敗'));
  }
  function toggleSpeedcam() {
    SC.on = !SC.on; LS.setItem('speedcam', SC.on ? '1' : '0');
    applySpeedcam(); renderLayerPop();
    if (!SC.on) $('#hudCam').hidden = true;
  }
  // 導航中每次定位更新：找「沿著路線往前 600 公尺內」的測速點（轉彎後的也算）
  function routeCams(N) {
    if (N.camFor === N.route) return N.cams;
    const co = N.route.coords;
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    co.forEach(([x, y]) => { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); });
    const m = 0.001;
    N.cams = SC.list.filter((c) => c.p[0] > w - m && c.p[0] < e + m && c.p[1] > s - m && c.p[1] < n + m)
      .map((c) => ({ c, pr: C.projectOnLine(c.p, co) })).filter((x) => x.pr.d < 30)
      .filter((x) => {   // 有方向的測速，只算跟你同方向的（對向車道的不提醒）
        if (x.c.deg == null || x.c.both) return true;
        const i = Math.min(x.pr.i, co.length - 2);
        const segB = C.bearing(co[i], co[i + 1]);
        return Math.abs(((x.c.deg - segB + 540) % 360) - 180) <= 60;
      })
      .map((x) => ({ c: x.c, s: x.pr.s }));
    N.camFor = N.route;
    return N.cams;
  }
  function checkSpeedcam(p, brg, kmh) {
    const N = S.nav;
    const box = $('#hudCam');
    if (!SC.on || !SC.list || !N || !['car', 'scooter'].includes(N.mode)) { box.hidden = true; return; }
    const cams = routeCams(N);
    const me = C.projectOnLine(p, N.route.coords).s;
    let best = null;
    cams.forEach((x) => { const d = x.s - me; if (d > -10 && d <= 600 && (!best || d < best.d)) best = { c: x.c, d }; });
    if (!best || best.d < 10) { box.hidden = true; return; }
    const { c, d } = best;
    box.hidden = false;
    $('#hudCamLim').textContent = c.limit || '!';
    $('#hudCamD').textContent = `前方 ${C.fmtDist(d)}`;
    const over = c.limit && kmh > c.limit;
    box.classList.toggle('over', !!over);
    const key = c.p.join(',');
    N.camSaid = N.camSaid || {};
    if (d <= 500 && !N.camSaid[key]) { N.camSaid[key] = 1; speak(`前方${C.fmtDist(d)}有測速照相${c.limit ? `，限速${c.limit}` : ''}`); }
    if (over && d <= 250 && !N.camSaid[key + 'o']) { N.camSaid[key + 'o'] = 1; speak(`超速，限速${c.limit}`); }
  }

  // ---------- Google 路線（Routes：開車、機車、步行、大眾運輸） ----------
  const GMODE = { car: 'DRIVING', scooter: 'TWO_WHEELER', foot: 'WALKING', transit: 'TRANSIT' };
  async function gRoute(from, to, mode) {
    const { Route } = await google.maps.importLibrary('routes');
    const req = {
      origin: { lat: from[1], lng: from[0] }, destination: { lat: to[1], lng: to[0] }, travelMode: GMODE[mode],
      language: 'zh-TW', region: 'tw', fields: ['path', 'legs', 'distanceMeters', 'durationMillis', 'localizedValues'],
    };
    if (mode === 'car' || mode === 'scooter') req.routingPreference = 'TRAFFIC_AWARE';
    if (mode === 'transit') { req.computeAlternativeRoutes = true; req.departureTime = new Date(); }
    let res;
    try { res = await Route.computeRoutes(req); } catch (e) { logExt('Google 路線（' + mode + '）', 'ERR', String(e.message || e)); throw new Error('Google 路線規劃失敗：' + gHint(e, 'Routes API')); }
    logExt('Google 路線（' + mode + '）', 200);
    const rs = (res.routes || []).map(C.fromGoogleRoute).filter((r) => r.coords.length);
    if (!rs.length) throw new Error(mode === 'transit' ? '這段沒有大眾運輸可搭（或末班車已過）' : '找不到可行路線');
    return rs;
  }

  // 大眾運輸：公車段配上 TDX 即時到站
  async function liveBusEta(seg) {
    if (!tdx.ready() || !seg.fromP || !seg.line || !/公車|客運/.test(seg.vehicle)) return null;
    const line = seg.line.replace(/'/g, "''");
    const scopes = [...(S.county ? busCities().map((c) => `City/${c}`) : []), 'InterCity'];
    for (const scope of scopes) {
      let sor;
      try { sor = await cachedGet(C.EP.busStops(scope, seg.line), { $filter: `RouteName/Zh_tw eq '${line}'`, $select: 'RouteUID,RouteName,Direction,Stops' }, 3); } catch { continue; }
      for (const r of sor || []) {
        const st = (r.Stops || []).map((s) => ({ uid: s.StopUID, p: C.pos(s.StopPosition), name: C.zh(s.StopName) }));
        const near = (pt, lim) => { let bi = -1, bd = lim; st.forEach((s, i) => { if (s.p) { const d = C.dist(pt, s.p); if (d < bd) { bd = d; bi = i; } } }); return bi; };
        const a = near(seg.fromP, 200), b = seg.toP ? near(seg.toP, 400) : -1;
        if (a < 0 || (b >= 0 && b <= a)) continue;   // 方向不對
        const rows = await tdx.get(C.EP.busEta(scope, seg.line), { $filter: `RouteUID eq '${r.RouteUID}' and Direction eq ${r.Direction} and StopUID eq '${st[a].uid}'`, $select: 'StopUID,EstimateTime,StopStatus,NextBusTime' }, 15);
        return { ...C.busEtaText(rows[0]), stop: st[a].name };
      }
    }
    return null;
  }
  const hhmm = (t) => (t ? new Date(t).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false }) : '');
  const ICO_WALK = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="13" cy="4" r="2"/><path d="M10.5 8.5 8 21h2.2l1.6-7 2.2 2.2V21h2v-6.5l-2.3-2.3.7-3.2A6 6 0 0 0 19 12v-2a4 4 0 0 1-3.4-2l-1-1.6a2 2 0 0 0-2.4-.8L7 7.6V12h2V9z"/></svg>';
  function transitTimes(r) {
    const first = r.segs.find((s) => s.kind === 'transit');
    let start = Date.now();
    if (first?.dep) { const before = r.segs.slice(0, r.segs.indexOf(first)).reduce((a, s) => a + s.duration, 0); start = new Date(first.dep).getTime() - before * 1000; }
    return { start, end: start + r.duration * 1000 };
  }
  function drawTransitOnMap(r) {
    const feats = r.segs.filter((s) => s.coords.length > 1).map((s) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: s.coords }, properties: { color: s.kind === 'walk' ? '#8e8e93' : s.color } }));
    map.getSource('route').setData({ type: 'FeatureCollection', features: feats.length ? feats : [{ type: 'Feature', geometry: { type: 'LineString', coordinates: r.coords }, properties: {} }] });
    const bb = bboxOf({ coordinates: r.coords });
    if (bb) map.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: fitPad(), duration: 800, maxZoom: 16 });
  }
  function renderTransitList(T) {
    const box = $('#rtBody'); if (!box) return;
    drawTransitOnMap(T.routes[0]);
    $('#rt-transit') && ($('#rt-transit').textContent = C.fmtDur(T.routes[0].duration));
    box.innerHTML = `<div class="list">${T.routes.map((r, i) => {
      const t = transitTimes(r);
      const walkMin = Math.round(r.segs.filter((s) => s.kind === 'walk').reduce((a, s) => a + s.duration, 0) / 60);
      const first = r.segs.find((s) => s.kind === 'transit');
      const chips = r.segs.filter((s) => s.kind === 'transit' || s.duration > 90).map((s) => (s.kind === 'walk'
        ? `<span class="wchip">${ICO_WALK}${Math.max(1, Math.round(s.duration / 60))}</span>`
        : `<span class="lchip" style="background:${esc(s.color)};color:${esc(s.textColor)}">${esc(s.vehicle)} ${esc(s.line)}</span>`)).join('<span class="sep">›</span>');
      return `<button class="item topt" data-i="${i}"><div class="t1"><b>${C.fmtDur(r.duration)}</b>　<span class="num">${hhmm(t.start)}–${hhmm(t.end)}</span>${r.fare ? `<span class="t2">・${esc(r.fare)}</span>` : ''}</div>
        <div class="segrow">${chips || `<span class="wchip">${ICO_WALK}全程步行</span>`}</div>
        <div class="t2">${first ? `${hhmm(first.dep)} 從 ${esc(first.from)} 上車・` : ''}步行共 ${walkMin} 分</div></button>`;
    }).join('')}</div><p class="fine">路線與時刻：Google。公車另查 TDX 即時到站。</p>`;
    box.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => renderTransitDetail(T, +b.dataset.i)));
  }
  function renderTransitDetail(T, i) {
    const r = T.routes[i], box = $('#rtBody'); if (!box) return;
    drawTransitOnMap(r);
    S.backFn = () => { previewRoute(T.dest, 'transit', T); };
    const t = transitTimes(r);
    box.innerHTML = `<div class="sec route-sum"><b>${C.fmtDur(r.duration)}</b><div>${hhmm(t.start)} 出發・${hhmm(t.end)} 抵達${r.fare ? '・' + esc(r.fare) : ''}</div></div>
      <ol class="tl">${r.segs.map((s, k) => (s.kind === 'walk'
        ? `<li class="walk"><div class="t1">步行 ${Math.max(1, Math.round(s.duration / 60))} 分鐘</div><div class="t2">${C.fmtDist(s.distance)}</div></li>`
        : `<li style="--c:${esc(s.color)}"><div class="t1"><span class="lchip" style="background:${esc(s.color)};color:${esc(s.textColor)}">${esc(s.vehicle)} ${esc(s.line)}</span> ${s.headsign ? '往 ' + esc(s.headsign) : ''}</div>
            <div class="t2">${hhmm(s.dep)} ${esc(s.from)} 上車</div>
            <div class="t2">搭 ${s.stops} 站・${Math.max(1, Math.round(s.duration / 60))} 分鐘</div>
            <span class="live far" id="live-${k}" ${/公車|客運/.test(s.vehicle) && tdx.ready() ? '' : 'hidden'}>即時到站：查詢中…</span>
            <div class="t2">${hhmm(s.arr)} ${esc(s.to)} 下車</div></li>`)).join('')}
        <li style="--c:#ff3b30;padding-bottom:0"><div class="t1">${esc(T.dest.name)}</div></li></ol>
      ${r.segs[0]?.kind === 'walk' && r.segs[0].distance > 80 ? '<div class="acts"><button class="btn go wide" id="walkNav">步行導航到上車處</button></div>' : ''}
      <p class="fine">時刻是 Google 的預估；公車「即時到站」來自 TDX。</p>`;
    $('#walkNav')?.addEventListener('click', () => {
      const s = r.segs.find((x) => x.kind === 'transit');
      const p = s?.fromP || r.segs[0].coords[r.segs[0].coords.length - 1];
      previewRoute({ name: s ? s.from : T.dest.name, p, addr: '' }, 'foot');
    });
    r.segs.forEach(async (s, k) => {
      if (s.kind !== 'transit' || !/公車|客運/.test(s.vehicle) || !tdx.ready()) return;
      const el = () => $('#live-' + k);
      try {
        const e = await liveBusEta(s);
        if (!el()) return;
        if (!e) { el().textContent = 'TDX 查不到這條路線的即時資料'; return; }
        el().textContent = `即時：${e.stop} ${e.text}`;
        el().classList.toggle('far', e.level !== 'now' && e.level !== 'soon');
      } catch (err) { if (el()) el().textContent = '即時到站查詢失敗'; }
    });
  }

  // ======================================================
  // 導航（Google：開車／機車／步行；OSRM：自行車，沒有 Google 時全用 OSRM）
  // ======================================================
  const MODES = {
    car: { name: '開車', url: 'https://routing.openstreetmap.de/routed-car/route/v1/driving/', reach: 30, warn: [600, 150], zoom: 16.3, sim: 11 },
    scooter: { name: '機車', reach: 25, warn: [400, 100], zoom: 16.6, sim: 9 },
    bike: { name: '自行車', url: 'https://routing.openstreetmap.de/routed-bike/route/v1/driving/', reach: 20, warn: [200, 50], zoom: 17, sim: 4.5 },
    foot: { name: '步行', url: 'https://routing.openstreetmap.de/routed-foot/route/v1/driving/', reach: 15, warn: [120, 30], zoom: 17.5, sim: 1.4 },
  };
  // 路線頁上方一直顯示的交通方式
  const RT_TABS = [
    ['transit', '大眾運輸', '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="3" width="14" height="15" rx="3"/><path d="M7.5 6h9v5h-9z" fill="var(--cell)"/><path d="M7.5 20v-2M16.5 20v-2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>'],
    ['car', '開車', '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 11l1.6-4.5A2 2 0 0 1 8.5 5h7a2 2 0 0 1 1.9 1.5L19 11a2 2 0 0 1 1 1.7V18h-2.5v1.5h-2V18h-7v1.5h-2V18H4v-5.3A2 2 0 0 1 5 11zm2.2 0h9.6l-1.2-3.6a.6.6 0 0 0-.6-.4H9a.6.6 0 0 0-.6.4zM7 15.5a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6zm10 0a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6z"/></svg>'],
    ['scooter', '機車', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="17" r="2.6"/><circle cx="18" cy="17" r="2.6"/><path d="M8.6 17h6.8l1.2-5.5H12M16.6 11.5 15 5h-2.5M4 13.5h5l1.5 3.5"/></svg>'],
    ['bike', '自行車', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="16" r="3.6"/><circle cx="18" cy="16" r="3.6"/><path d="M6 16l4-7.5h5.5l2.5 7.5M10 8.5l3 7.5H6M8.3 6.5h3.4"/></svg>'],
    ['foot', '步行', ICO_WALK],
  ];
  async function fetchRoute(from, to, mode) {
    if (G && GMODE[mode]) return (await gRoute(from, to, mode))[0];
    if (!MODES[mode].url) throw new Error('機車路線要用 Google 地圖金鑰（Google 有台灣機車模式，不會帶你上國道、快速道路）');
    const url = `${MODES[mode].url}${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson&steps=true`;
    const j = await getJSON(url, '路線規劃');
    const r = j.routes && j.routes[0];
    if (!r) throw new Error('找不到可行路線');
    const steps = r.legs.flatMap((l) => l.steps).map((s) => ({ maneuver: s.maneuver, name: s.name, ref: s.ref, distance: s.distance, duration: s.duration }));
    return { coords: r.geometry.coordinates, steps, distance: r.distance, duration: r.duration, src: 'osrm' };
  }
  function getOrigin() {
    return new Promise((resolve) => {
      if (S.me) return resolve({ p: S.me, real: true });
      const fallback = () => resolve({ p: map.getCenter().toArray(), real: false });
      if (!navigator.geolocation) return fallback();
      navigator.geolocation.getCurrentPosition((g) => { S.me = [g.coords.longitude, g.coords.latitude]; placeMe(S.me); resolve({ p: S.me, real: true }); }, fallback, { enableHighAccuracy: true, timeout: 7000, maximumAge: 30000 });
    });
  }
  let destMarker;
  function setDestPin(p) {
    if (!destMarker) { const el = document.createElement('div'); el.className = 'pin'; destMarker = new (MK())({ element: el, anchor: 'bottom' }); }
    destMarker.setLngLat(p).addTo(map);
  }
  // 路線頁：上方固定五種交通方式，下面是這種方式怎麼走
  async function previewRoute(dest, mode, cachedTransit) {
    mode = mode || (S.nav && S.nav.mode) || LS.getItem('rtMode') || 'car';
    if (!RT_TABS.some((t) => t[0] === mode)) mode = 'car';
    LS.setItem('rtMode', mode);
    setDetent('half');
    S.saveDest = dest;
    setFocus(null);
    const fromPlace = S.place && S.place.p && C.dist(S.place.p, dest.p) < 5 ? S.place : null;
    setBody(`<div class="rthead">${backBtn}<div class="grow"><div class="tag">路線</div><h2>到 ${esc(dest.name)}</h2></div>${saveBtn}</div>
      <div id="saveBox" hidden></div>
      <div class="rtabs" id="modeSeg">${RT_TABS.map(([m, n, ico]) => `<button data-m="${m}" class="${m === mode ? 'on' : ''}">${ico}<span>${n}</span><small id="rt-${m}"></small></button>`).join('')}</div>
      <div id="rtBody">${loading}</div>`, 'route');
    if (fromPlace) S.backFn = () => openPlace(fromPlace);
    $('#modeSeg').querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => { if (b.dataset.m !== mode) previewRoute(dest, b.dataset.m); }));
    setDestPin(dest.p);
    const body = () => $('#rtBody');
    try {
      const o = await getOrigin();
      if (mode === 'transit') {
        S.nav = null;
        if (!G) { body().innerHTML = '<p class="note">大眾運輸轉乘（公車＋捷運＋火車怎麼接）要用 Google 地圖金鑰，在設定頁填。<br>沒有金鑰時：首頁的捷運、公車可以查單一路線和即時到站。</p>'; map.getSource('route').setData(emptyFC()); return; }
        const T = cachedTransit || { dest, o, routes: await gRoute(o.p, dest.p, 'transit') };
        if (!body()) return;
        S.transit = T;
        renderTransitList(T);
        return;
      }
      const rt = await fetchRoute(o.p, dest.p, mode);
      S.nav = { dest, mode, route: rt, cur: 0, active: false, origin: o };
      map.getSource('route').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: rt.coords }, properties: {} });
      const bb = bboxOf({ coordinates: rt.coords });
      map.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: fitPad(), duration: 800, maxZoom: 16 });
      const eta = new Date(Date.now() + rt.duration * 1000);
      if (!body()) return;
      if ($('#rt-' + mode)) $('#rt-' + mode).textContent = C.fmtDur(rt.duration);
      const src = rt.src === 'google' ? (mode === 'scooter' ? 'Google 機車模式（避開國道、快速道路），含即時路況' : mode === 'foot' ? 'Google' : 'Google，含即時路況')
        : 'OSRM（routing.openstreetmap.de），不含即時路況';
      body().innerHTML = `<div class="sec route-sum"><b>${C.fmtDur(rt.duration)}</b><div>${C.fmtDist(rt.distance)}・${eta.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })} 抵達</div></div>
        ${o.real ? '' : '<p class="fine">沒有取得你的位置，起點暫用地圖中心。</p>'}
        <div class="acts"><button class="btn go wide" id="goBtn">出發</button><button class="btn" id="simBtn">模擬</button></div>
        <div class="sec"><h3>轉彎清單</h3><div class="list">${rt.steps.slice(1).map((s) => { const m = C.maneuverText(s); return `<div class="item"><span style="width:26px;color:var(--blue)">${arrowSvg(m.icon)}</span><span class="grow"><span class="t1">${esc(m.text)}</span></span><span class="t2 num">${s.distance ? C.fmtDist(s.distance) : ''}</span></div>`; }).join('')}</div></div>
        <p class="fine">路線：${src}。${mode === 'scooter' ? '機車請依現場標誌兩段式左轉。' : ''}</p>`;
      $('#goBtn').addEventListener('click', () => startNav(false));
      $('#simBtn').addEventListener('click', () => startNav(true));
    } catch (e) { if (body()) body().innerHTML = errBox(e); }
  }

  function startNav(sim) {
    const N = S.nav; if (!N) return;
    if (!sim) startCompass();   // 按「出發」當下要指南針權限（iPhone 規定要在點按時要）
    if (SC.on && ['car', 'scooter'].includes(N.mode)) loadSpeedcam().catch(() => {});
    N.active = true; N.sim = sim; N.cur = 0; N.follow = true; N.off = 0; N.lastReroute = 0; N.said = {}; N.simM = 0;
    $('#turn').hidden = false;
    $('#hudSpeed').hidden = false;
    document.body.classList.add('navigating');
    setDetent('peek');
    renderNavBar();
    speak(`開始導航，前往${N.dest.name}`);
    if (sim) {
      N.simTimer = setInterval(() => {
        N.simM += MODES[N.mode].sim * 4 * 0.5;   // 4 倍速，每 0.5 秒
        const a = C.alongLine(N.route.coords, N.simM);
        onPosition(a.p, MODES[N.mode].sim * 4, a.bearing);
      }, 500);
    } else if (navigator.geolocation) {
      N.watch = navigator.geolocation.watchPosition(
        (g) => onPosition([g.coords.longitude, g.coords.latitude], g.coords.speed, g.coords.heading, g.coords.accuracy),
        (err) => toast(err.code === 1 ? '定位被拒絕，請在設定允許定位' : '定位失敗：' + err.message),
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
    }
    onPosition(N.origin.p, 0, null);
    layoutCtrl();
  }

  function onPosition(p, speed, heading, acc) {
    const N = S.nav; if (!N || !N.active) return;
    const prev = N.last;
    N.last = p; S.me = p; placeMe(p);
    const steps = N.route.steps, cfg = MODES[N.mode];
    // 推進到下一個轉彎
    let ni = N.cur + 1;
    while (ni < steps.length && C.dist(p, steps[ni].maneuver.location) < cfg.reach) { N.cur = ni; ni++; }
    if (ni >= steps.length || steps[N.cur].maneuver.type === 'arrive') return finishNav(true);
    const next = steps[ni];
    const dNext = C.dist(p, next.maneuver.location);
    // 偏離路線就重算
    if (!N.sim && (acc == null || acc < 50)) {
      N.off = C.distToLine(p, N.route.coords) > 50 ? N.off + 1 : 0;
      if (N.off >= 3 && Date.now() - N.lastReroute > 15000) reroute(p);
    }
    // 轉彎卡
    const m = C.maneuverText(next);
    $('#turnIco').innerHTML = arrowSvg(m.icon);
    $('#turnDist').textContent = C.fmtDist(dNext);
    $('#turnText').textContent = m.text;
    const after = steps[ni + 1];
    if (after) { const m2 = C.maneuverText(after); $('#turnNext').hidden = false; $('#turnNext').innerHTML = `然後 ${arrowSvg(m2.icon)} <span>${esc(m2.text)}</span>`; } else $('#turnNext').hidden = true;
    layoutCtrl();
    // 語音：遠、近各提醒一次
    const key = ni;
    if (dNext <= cfg.warn[0] && dNext > cfg.warn[1] && !N.said[key + 'f']) { N.said[key + 'f'] = 1; speak(`${C.fmtDist(dNext)}後，${m.text}`); }
    if (dNext <= cfg.warn[1] && !N.said[key + 'n']) { N.said[key + 'n'] = 1; N.said[key + 'f'] = 1; speak(m.text); }
    // 剩餘
    let rest = dNext; for (let k = ni; k < steps.length; k++) rest += steps[k].distance;
    N.restM = rest; N.restS = rest / Math.max(0.5, N.route.distance / N.route.duration);
    renderNavBar();
    // 速度
    const v = speed != null && speed >= 0 ? speed : (prev && N.lastT ? C.dist(prev, p) / ((Date.now() - N.lastT) / 1000) : 0);
    N.lastT = Date.now();
    $('#hudSpeedN').textContent = Math.round((v || 0) * 3.6);
    S.navKmh = (v || 0) * 3.6;
    // 鏡頭跟隨
    // 方向：在動就用 GPS 方向；停下來（等紅燈）GPS 方向不準，改用手機指南針
    const gpsH = heading != null && !Number.isNaN(heading) && (N.sim || (v || 0) > 1.5) ? heading : null;
    const brg = gpsH ?? (!N.sim && compassOn && S.hdg != null ? S.hdg
      : (prev && C.dist(prev, p) > 3 ? C.bearing(prev, p) : map.getBearing()));
    setMeHeading(brg);
    checkSpeedcam(p, brg, S.navKmh || 0);
    if (N.follow && !N.camReady) {
      // 第一次（或按「回到導航」）：轉到導航視角；之後每一格由藍點動畫帶著鏡頭走
      map.easeTo({ center: p, bearing: brg, pitch: 50, zoom: cfg.zoom, duration: 700, padding: navPad() });
      N.camReady = true;
    }
  }
  async function reroute(p) {
    const N = S.nav; N.lastReroute = Date.now(); N.off = 0;
    toast('已偏離路線，重新規劃');
    try {
      const rt = await fetchRoute(p, N.dest.p, N.mode);
      N.route = rt; N.cur = 0; N.said = {};
      map.getSource('route').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: rt.coords }, properties: {} });
    } catch (e) { toast(e.message || String(e)); }
  }
  function renderNavBar() {
    const N = S.nav; if (!N || !N.active) return;
    const arr = new Date(Date.now() + (N.restS ?? N.route.duration) * 1000);
    const html = `<div class="navbar"><div class="grow"><div class="l1"><b>${arr.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })}</b><span class="lbl">抵達</span></div><div class="l2">${C.fmtDur(N.restS ?? N.route.duration)}・${C.fmtDist(N.restM ?? N.route.distance)}${N.sim ? '・模擬' : ''}</div></div><button class="btn red" data-act="endnav">結束</button></div>`;
    if (S.view !== 'nav') { stopTimers(); S.view = 'nav'; }
    $('#sheetBody').innerHTML = html;
    $('#sheetBody').style.visibility = 'visible';
    if (!isWide()) { const b = $('#sheetBody'); b.style.paddingTop = '2px'; }
    // 手機：收合時直接把導航列放進搜尋列的位置
    document.body.classList.add('navigating');
    $('#srow').hidden = true;
    setDetent(isWide() ? 'half' : 'peek');
    sheet().style.height = isWide() ? '' : navBarH() + 'px';
    document.documentElement.style.setProperty('--sheet-h', (isWide() ? 0 : sheet().getBoundingClientRect().height + 8) + 'px');
  }
  function finishNav(arrived) {
    const N = S.nav; if (!N) return;
    N.active = false;
    clearInterval(N.simTimer);
    if (N.watch != null) navigator.geolocation.clearWatch(N.watch);
    if (arrived) speak('已抵達目的地');
    toast(arrived ? `已抵達 ${N.dest.name}` : '已結束導航');
    $('#turn').hidden = true; $('#follow').hidden = true; $('#hudSpeed').hidden = true; $('#hudCam').hidden = true;
    map.getSource('route').setData(emptyFC());
    destMarker?.remove();
    map.easeTo({ pitch: 0, bearing: 0, duration: 600, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
    document.body.classList.remove('navigating');
    $('#srow').hidden = false;
    $('#sheetBody').style.paddingTop = '';
    $('#sheetBody').style.visibility = '';
    S.nav = null;
    layoutCtrl();
    setDetent(isWide() ? 'half' : 'peek');
    showHome();
  }

  // 語音：講話時把內嵌 YouTube 音量壓低
  function speak(text) {
    if (!S.voice || !('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-TW'; u.rate = 1.05;
      const v = speechSynthesis.getVoices().find((x) => /zh[-_]TW/i.test(x.lang));
      if (v) u.voice = v;
      if (YT.player?.setVolume) { YT.player.setVolume(25); u.onend = u.onerror = () => YT.player?.setVolume(100); }
      speechSynthesis.speak(u);
    } catch { /* 有些瀏覽器不支援 */ }
  }

  // ======================================================
  // 位置
  // ======================================================
  let meMarker;
  // ---------- 我的位置：平順移動 ----------
  //   GPS 大約每秒一筆，直接跳會一格一格的。改成：新的一筆進來時，從「畫面上的位置」
  //   用動畫走到新位置，時間＝兩筆之間的間隔，所以看起來是連續移動（Apple／Google 地圖也是這樣做）。
  //   方向（指南針／行進方向）也做平滑，不會抖。鏡頭跟隨在同一個動畫裡做，跟藍點同步。
  const ME = { cur: null, from: null, to: null, t0: 0, dur: 1000, lastFix: 0, hdg: null, hdgTo: null, raf: 0 };
  window.__xlME = ME;   // 除錯用
  function placeMe(p) {
    if (!meMarker) {
      const el = document.createElement('div'); el.className = 'me'; el.innerHTML = '<i class="cone"></i>';
      // rotationAlignment: 'map' → setRotation 給的是真實方位（0＝北），地圖轉了也對
      meMarker = new (MK())({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' });
      if (S.hdg != null) { el.classList.add('hdg'); meMarker.setRotation(S.hdg); }
      meMarker.setLngLat(p).addTo(map);
    }
    moveMe(p);
  }
  function moveMe(p) {
    const now = performance.now();
    if (!ME.cur || C.dist(ME.cur, p) > 400) {          // 第一筆、或跳很遠（例如從粗略定位變精準）：直接過去
      ME.cur = p.slice(); ME.from = p.slice(); ME.to = p.slice(); ME.t0 = now; ME.dur = 1;
    } else {
      if (ME.to && C.dist(ME.to, p) < 1) { ME.lastFix = now; return; }   // 站著不動時 GPS 小抖動不理它
      const gap = ME.lastFix ? now - ME.lastFix : 1000;
      ME.from = ME.cur.slice(); ME.to = p.slice(); ME.t0 = now;
      ME.dur = Math.max(250, Math.min(gap * 1.1, 1200));   // 剛好在下一筆進來時走到，看起來是連續的
    }
    ME.lastFix = now;
    kickMe();
  }
  function setMeHeading(h) {
    if (h == null || Number.isNaN(h)) return;
    ME.hdgTo = (h + 360) % 360;
    if (ME.hdg == null) ME.hdg = ME.hdgTo;
    if (meMarker) meMarker.getElement().classList.add('hdg');
    kickMe();
  }
  function kickMe() { if (!ME.raf) ME.raf = requestAnimationFrame(meFrame); }
  const navPad = () => (isWide() ? { left: 380, top: 120, right: 0, bottom: 0 } : { top: 140, bottom: sheetHeight(), left: 0, right: 0 });
  function meFrame(now) {
    ME.raf = 0;
    let busy = false;
    if (ME.to) {
      const k = Math.min(1, (now - ME.t0) / ME.dur);
      ME.cur = [ME.from[0] + (ME.to[0] - ME.from[0]) * k, ME.from[1] + (ME.to[1] - ME.from[1]) * k];
      if (k < 1) busy = true;
      if (meMarker) meMarker.setLngLat(ME.cur);
    }
    if (ME.hdgTo != null) {
      const d = ((ME.hdgTo - ME.hdg + 540) % 360) - 180;
      if (Math.abs(d) > 0.4) { ME.hdg = (ME.hdg + d * 0.2 + 360) % 360; busy = true; } else ME.hdg = ME.hdgTo;
      if (meMarker) meMarker.setRotation(ME.hdg);
    }
    // 鏡頭跟著藍點走（地圖自己在動畫或使用者在拖的時候不搶）
    if (ME.cur && map && !(map.isMoving && map.isMoving())) {
      const N = S.nav;
      if (N?.active) { if (N.follow && N.camReady) map.jumpTo({ center: ME.cur, bearing: ME.hdg ?? map.getBearing(), padding: navPad() }); }
      else if (S.track === 'follow') map.jumpTo({ center: ME.cur });
      else if (S.track === 'heading') map.jumpTo({ center: ME.cur, ...(ME.hdg != null ? { bearing: ME.hdg } : {}) });
    }
    if (busy) kickMe();
  }

  // ======================================================
  // 跟隨與指南針（仿 Apple 地圖）
  //   定位鈕：點 1 下＝跟著你（北朝上）→ 點 2 下＝地圖跟著你面向的方向轉 → 再點＝回北朝上
  //   拖動地圖就停止跟隨；轉過地圖時右側出現指南針，點一下回北朝上
  // ======================================================
  S.track = 'off'; S.hdg = null;
  let posWatch = null, compassOn = false, compassAsked = false, lastRot = 0;
  const LOC_ICON = {
    off: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M20.6 3.4 3.7 10.3c-.8.3-.7 1.4.1 1.6l6.8 1.6 1.6 6.8c.2.8 1.3.9 1.6.1L20.6 3.4z"/></svg>',
    follow: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.6 3.4 3.7 10.3c-.8.3-.7 1.4.1 1.6l6.8 1.6 1.6 6.8c.2.8 1.3.9 1.6.1L20.6 3.4z"/></svg>',
    heading: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5 4.6 20.2c-.3.7.5 1.4 1.2 1L12 17.6l6.2 3.6c.7.4 1.5-.3 1.2-1z"/></svg>',
  };
  function setTrack(m) {
    S.track = m;
    const b = $('#bLoc');
    b.dataset.mode = m;
    b.innerHTML = LOC_ICON[m];
    b.setAttribute('aria-label', m === 'off' ? '我的位置' : m === 'follow' ? '跟隨中（再點一下：地圖跟著你的方向轉）' : '方向跟隨中（再點一下：北朝上）');
    if (m === 'follow' && Math.abs(map.getBearing()) > 0.5) map.easeTo({ bearing: 0, duration: 400 });
    if (m === 'heading' && S.hdg != null) map.easeTo({ center: S.me || map.getCenter(), bearing: S.hdg, duration: 400 });
    updCompass();
  }
  function updCompass() {
    const el = $('#bNorth'); if (!el || !map) return;
    const b = map.getBearing();
    const show = Math.abs(b) > 0.5 || S.track === 'heading';
    if (el.hidden === show) { el.hidden = !show; layoutCtrl(); }
    el.firstElementChild.style.transform = `rotate(${-b}deg)`;
  }
  function resetNorth() {
    if (S.nav?.active) { S.nav.follow = false; $('#follow').hidden = false; }
    if (S.track === 'heading') setTrack('follow');
    map.easeTo({ bearing: 0, duration: 500 });
  }
  const screenAngle = () => (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  function onOrient(e) {
    let h = null;
    if (e.webkitCompassHeading != null && e.webkitCompassHeading >= 0) h = e.webkitCompassHeading; // iPhone
    else if (e.absolute && e.alpha != null) h = 360 - e.alpha;                                       // Android
    if (h == null) return;
    compassOn = true;
    setHeading((h + screenAngle() + 360) % 360);
  }
  // iPhone 規定要在「點按當下」要指南針權限，所以由定位鈕的點擊直接呼叫
  function startCompass() {
    if (compassAsked) return;
    compassAsked = true;
    const listen = () => {
      if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onOrient);
      else window.addEventListener('deviceorientation', onOrient);
    };
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission()
        .then((r) => { if (r === 'granted') listen(); else toast('沒有指南針權限，改用移動方向'); })
        .catch(() => { compassAsked = false; });
    } else listen();
  }
  function setHeading(h) {
    S.hdg = h;
    if (S.nav?.active) return;   // 導航中用行進方向
    setMeHeading(h);
  }
  // 即時 GPS 持續追蹤。高精度拿不到（桌機沒有 GPS 晶片會逾時）就退回一般精度
  function startPosWatch(hi = true) {
    if (posWatch != null || !navigator.geolocation) return;
    posWatch = navigator.geolocation.watchPosition((g) => {
      if (S.nav?.active) return;   // 導航中由導航自己處理
      S.me = [g.coords.longitude, g.coords.latitude];
      placeMe(S.me);             // 藍點動畫＋鏡頭跟隨都在這裡面
      autoCounty(S.me);          // 移動到別的縣市就自動換
      updatePlaceLabel(S.me);    // 「你在」顯示的路名
      const gh = g.coords.heading;
      if (!compassOn && gh != null && !Number.isNaN(gh) && (g.coords.speed || 0) > 1) setHeading(gh);
    }, (e) => {
      if (hi && (e.code === 2 || e.code === 3)) { navigator.geolocation.clearWatch(posWatch); posWatch = null; startPosWatch(false); }
    }, { enableHighAccuracy: hi, maximumAge: 0, timeout: 15000 });
  }
  // 單次定位：先高精度，逾時退回一般精度
  function getPos() {
    return new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, (e) => {
      if (e.code !== 2 && e.code !== 3) return rej(e);
      navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
    }, { enableHighAccuracy: true, timeout: 5000, maximumAge: 5000 }));
  }

  // 打開網頁就定位：找出你在哪 → 自動判斷縣市、載入附近交通資料、地圖移到你身邊
  async function firstLocate() {
    if (!navigator.geolocation) { S.locFail = '這個瀏覽器不支援定位'; if (S.view === 'home') showHome(); return; }
    try {
      const g = await getPos();
      const p = [g.coords.longitude, g.coords.latitude];
      S.me = p; S.locFail = '';
      placeMe(p);
      startPosWatch();
      map.flyTo({ center: p, zoom: 15.5, bearing: 0, duration: 1200 });
      setTrack('follow');        // 預設跟著你走；拖地圖就停，按定位鈕再跟
      autoCounty(p);
      updatePlaceLabel(p);
      loadWeather();
      if (S.view === 'home') showHome();
    } catch (err) {
      S.locFail = err.code === 1 ? '定位被拒絕：請在瀏覽器網址列左邊的設定允許「位置」，再按重新定位'
        : '定位失敗，可以按重新定位，或先把地圖移到你要看的地方';
      if (S.view === 'home') showHome();
    }
  }

  function locate() {
    if (S.nav?.active) { S.nav.follow = true; S.nav.camReady = false; $('#follow').hidden = true; return; }
    if (!navigator.geolocation) return toast('這個瀏覽器不支援定位');
    startCompass();
    if (S.track === 'follow') {
      setTrack('heading');
      if (!compassOn) toast('這台裝置沒有指南針訊號，開始移動後會依 GPS 方向轉');
      return;
    }
    if (S.track === 'heading') return setTrack('follow');
    const go = (p) => {
      S.me = p; placeMe(p);
      map.flyTo({ center: p, zoom: Math.max(map.getZoom(), 15), bearing: 0 });
      setTrack('follow');
      startPosWatch();
      loadWeather();
    };
    if (S.me && posWatch != null) return go(S.me);   // 即時 GPS 已在跑，直接用
    getPos().then((g) => go([g.coords.longitude, g.coords.latitude]),
      (err) => toast(err.code === 1 ? '定位被拒絕，請在瀏覽器設定允許定位' : '定位失敗：' + err.message));
  }

  // ======================================================
  // 左上：時間、天氣
  // ======================================================
  const WD = '日一二三四五六';
  function tick() {
    const d = new Date();
    $('#hudTime').textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    $('#hudDate').textContent = `${d.getMonth() + 1}月${d.getDate()}日 週${WD[d.getDay()]}`;
  }
  async function loadWeather() {
    const p = S.me || (map ? map.getCenter().toArray() : [121.5, 25.05]);
    try {
      const j = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${p[1].toFixed(3)}&longitude=${p[0].toFixed(3)}&current=temperature_2m,weather_code&timezone=auto`, '天氣');
      const w = C.weatherInfo(j.current.weather_code);
      $('#hudWx').innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${WX[w.icon]}</svg><span class="num">${Math.round(j.current.temperature_2m)}°</span><span>${w.text}</span>`;
    } catch { $('#hudWx').textContent = ''; }
  }

  // ======================================================
  // 右下：YouTube（子母畫面或內嵌）
  // ======================================================
  const YT = { player: null, apiP: null, recent: [] };
  try { YT.recent = JSON.parse(LS.getItem('yt.recent') || '[]'); } catch { YT.recent = []; }
  const ytMode = () => { const m = LS.getItem('yt.mode') || 'auto'; return m === 'auto' ? (isMobileDevice ? 'pip' : 'embed') : m; };

  function applyYtMode() {
    const pip = ytMode() === 'pip';
    const pipHidden = LS.getItem('pip.hide') === '1';
    document.body.classList.toggle('pip', pip);
    document.body.classList.toggle('pip-left', LS.getItem('pip.side') === 'left');
    $('#pipZone').classList.toggle('playing', !!YT.pipPlaying);
    setQMode(S.qMode);
    $('#pipZone').hidden = !pip || pipHidden;
    if (pip) { $('#yt').hidden = true; $('#ytFab').hidden = !pipHidden; }
    else {
      if (!YT.everOpened) { $('#yt').hidden = false; YT.everOpened = true; renderYtList(); }
      $('#ytFab').hidden = !$('#yt').hidden;
    }
    layoutYT();
  }
  function layoutYT() {
    const tall = document.body.classList.contains('sheet-tall');
    // 手機抽屜拉高時，YouTube 卡與子母畫面區先讓開
    $('#yt').style.visibility = tall && !isWide() ? 'hidden' : '';
    $('#pipZone').style.visibility = tall && !isWide() ? 'hidden' : '';
  }
  function openYouTubeApp() {
    const t0 = Date.now();
    YT.wentOut = t0;
    location.href = 'youtube://';
    setTimeout(() => { if (!document.hidden && Date.now() - t0 < 2500) window.open('https://m.youtube.com/', '_blank'); }, 1200);
  }
  function loadYtApi() {
    if (YT.apiP) return YT.apiP;
    YT.apiP = new Promise((resolve, reject) => {
      if (window.YT && window.YT.Player) return resolve(window.YT);
      window.onYouTubeIframeAPIReady = () => resolve(window.YT);
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => { YT.apiP = null; reject(new Error('YouTube 播放器載入失敗')); };
      document.head.appendChild(s);
    });
    return YT.apiP;
  }
  async function playYt(item) {
    $('#ybox').hidden = false; $('#ytPick').hidden = true; $('#ytPlay').hidden = false;
    $('#yt').classList.remove('mini');
    try {
      const api = await loadYtApi();
      const vars = { playsinline: 1, rel: 0, modestbranding: 1, autoplay: 1 };
      if (item.listId) { vars.listType = 'playlist'; vars.list = item.listId; }
      if (YT.player && YT.player.loadVideoById && item.videoId && !item.listId) { YT.player.loadVideoById(item.videoId); }
      else {
        if (YT.player?.destroy) YT.player.destroy();
        $('#ybox').innerHTML = '<div id="ytPlayer"></div>';
        YT.player = new api.Player('ytPlayer', {
          videoId: item.videoId, playerVars: vars,
          events: {
            onStateChange: (e) => {
              const d = YT.player.getVideoData ? YT.player.getVideoData() : {};
              if (d && d.title) { $('#ytTitle').textContent = d.title; remember({ videoId: d.video_id || item.videoId, listId: item.listId, title: d.title }); }
              $('#ytPlay').innerHTML = e.data === 1 ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>' : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
            },
            onError: (e) => toast(e.data === 150 || e.data === 101 ? '這部影片不允許嵌入播放' : e.data === 153 ? 'YouTube 要求網址來源（請放到 GitHub Pages 再開）' : 'YouTube 播放錯誤 ' + e.data),
          },
        });
      }
      $('#ytTitle').textContent = item.title || 'YouTube';
    } catch (e) { toast(e.message || String(e)); }
  }
  function remember(it) {
    if (!it.videoId && !it.listId) return;
    YT.recent = [it, ...YT.recent.filter((x) => !(x.videoId === it.videoId && x.listId === it.listId))].slice(0, 8);
    LS.setItem('yt.recent', JSON.stringify(YT.recent));
  }
  function renderYtList(results) {
    const list = results || YT.recent;
    $('#ytList').innerHTML = list.length ? `<div class="list">${list.map((x, i) => `<button class="item" data-i="${i}">${x.videoId ? `<img src="https://i.ytimg.com/vi/${esc(x.videoId)}/default.jpg" alt="">` : ''}<span class="grow"><span class="t1">${esc(x.title || x.videoId || x.listId)}</span>${x.channel ? `<div class="t2">${esc(x.channel)}</div>` : ''}</span></button>`).join('')}</div>`
      : '<p class="fine">貼上影片或播放清單連結。在設定填 YouTube 搜尋金鑰後，也能直接打關鍵字搜尋。</p>';
    $('#ytList').querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => playYt(list[+b.dataset.i])));
  }
  async function ytSubmit() {
    const q = $('#ytQ').value.trim(); if (!q) return;
    const parsed = C.parseYouTube(q);
    if (parsed) { $('#ytQ').value = ''; return playYt(parsed); }
    const key = LS.getItem('yt.key');
    if (!key) { renderYtList(); toast('要用關鍵字搜尋，請先在設定填 YouTube 搜尋金鑰；或直接貼連結'); return; }
    $('#ytList').innerHTML = '<p class="muted">搜尋中…</p>';
    try {
      const j = await getJSON(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=10&videoEmbeddable=true&q=${encodeURIComponent(q)}&key=${encodeURIComponent(key)}`, 'YouTube 搜尋');
      renderYtList((j.items || []).map((it) => ({ videoId: it.id.videoId, title: it.snippet.title, channel: it.snippet.channelTitle })));
    } catch (e) { $('#ytList').innerHTML = `<p class="err">${esc(e.message)}（金鑰錯誤或今日額度用完）</p>`; }
  }

  // ======================================================
  // 設定、紀錄、歡迎頁、提示
  // ======================================================
  // 檢查中繼站：金鑰有沒有設好
  async function checkRelay(show) {
    const r = relayUrl();
    const say = (t, cls) => { if (show) { $('#relayMsg').textContent = t; $('#relayMsg').className = 'fine ' + (cls || ''); } };
    if (!r) { say('沒有中繼站：TDX、TomTom 要自己填金鑰。'); return false; }
    try {
      const j = await getJSON(r + '/health', '中繼站');
      if (j.tdx && j.tomtom) { say('中繼站正常：TDX、TomTom 金鑰都有設定。', 'okc'); return true; }
      const miss = [!j.tdx && 'TDX_ID／TDX_SECRET', !j.tomtom && 'TOMTOM_KEY'].filter(Boolean).join('、');
      say(`中繼站連得上，但還沒設定：${miss}`, 'err');
      if (!show) toast(`中繼站還沒設定：${miss}`);
      return !!j.tdx;
    } catch (e) { say(`連不上中繼站：${e.message || e}`, 'err'); if (!show) toast('連不上中繼站，交通資料可能載不到'); return false; }
  }
  function openDialog(id) { const d = document.getElementById(id); d.hidden = false; }
  function closeDialog(id) { document.getElementById(id).hidden = true; }
  function openSettings(msg) {
    const k = tdx.getKey();
    $('#kId').value = k.id; $('#kSecret').value = k.secret;
    $('#ytMode').value = LS.getItem('yt.mode') || 'auto';
    $('#ytKey').value = LS.getItem('yt.key') || '';
    $('#ttKey').value = ttKey();
    $('#gKey').value = LS.getItem('g.key') || ''; $('#gMapId').value = LS.getItem('g.mapId') || '';
    $('#gKey').placeholder = window.XINGLU_GOOGLE?.key ? '內建金鑰（要換才填）' : 'AIza…';
    $('#gOrigin').textContent = SITE_RULE();
    $('#gMsg').textContent = S.gErr ? 'Google 地圖有問題：' + S.gErr.msg : G ? '目前使用 Google 地圖。清空＝改回開放地圖。' : gCfg().key ? 'Google 地圖載入失敗，請看「連線紀錄」。' : '有 Google 金鑰：地圖、店家、街景、大眾運輸與機車路線都用 Google。';
    $('#relay').value = LS.getItem('relay') || '';
    $('#relay').placeholder = window.XINGLU_RELAY ? '內建：' + window.XINGLU_RELAY.replace(/^https?:\/\//, '') : 'https://….workers.dev';
    if (!msg && tdx.usingRelay()) { $('#kMsg').textContent = '目前經過中繼站取得資料，不用填。要改用自己的金鑰再填。'; $('#kMsg').className = 'fine okc'; }
    $('#voiceSw').classList.toggle('on', S.voice); $('#voiceSw').setAttribute('aria-checked', S.voice);
    if (msg) { $('#kMsg').textContent = msg; $('#kMsg').className = 'fine'; }
    openDialog('setDlg');
  }
  // 「檢查 Google 設定」：三個 API 各打一次最便宜的請求，哪個不行、怎麼修，直接講
  async function checkGoogle() {
    const box = $('#gMsg');
    const typed = $('#gKey').value.trim();
    const key = typed || gCfg().key;
    const out = [];
    const show = () => { box.className = 'fine'; box.innerHTML = out.join('<br>'); };
    const ok = (t) => out.push(`<span class="ok">✓</span> ${esc(t)}`);
    const bad = (t, h) => out.push(`<span class="bad">✗</span> ${esc(t)}：${esc(h)}`);
    if (!key) { box.textContent = '還沒填金鑰。照下面「怎麼申請」做完，把 AIza 開頭的金鑰貼上來。'; return; }
    if (!/^AIza[\w-]{30,}$/.test(key)) { box.textContent = '金鑰格式不對：Google 金鑰是 AIza 開頭、約 39 個字。'; return; }
    if (G && typed && typed !== gCfg().key) { box.textContent = '你改了金鑰：先按「儲存並重新載入」，再檢查。'; return; }
    box.textContent = '檢查中…（約 5 秒）';
    if (!window.google?.maps?.Map) {
      try { await GM.load(key); } catch (e) { box.textContent = '✗ 連不到 Google（網路問題，或這個瀏覽器擋了 Google）'; return; }
    }
    if (!G) {   // 還沒用 Google 地圖：開一張看不見的小地圖，讓 Google 驗證金鑰
      const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:-9999px;width:50px;height:50px';
      document.body.appendChild(d);
      try { new google.maps.Map(d, { center: { lat: 25.05, lng: 121.52 }, zoom: 10 }); } catch { /* 錯誤會從 console 抓到 */ }
      await new Promise((r) => setTimeout(r, 3000));
      d.remove();
    }
    if (S.gErr) bad('Maps JavaScript API', S.gErr.msg); else ok('Maps JavaScript API（地圖）');
    try {
      const { Place } = await google.maps.importLibrary('places');
      await Place.searchByText({ textQuery: '台北車站', fields: ['id'], maxResultCount: 1 });
      ok('Places API (New)（搜尋、店家）');
    } catch (e) { bad('Places API (New)', gHint(e, 'Places API (New)')); logExt('檢查 Places', 'ERR', String(e.message || e)); }
    try {
      const { Route } = await google.maps.importLibrary('routes');
      await Route.computeRoutes({ origin: { lat: 25.0478, lng: 121.517 }, destination: { lat: 25.046, lng: 121.52 }, travelMode: 'WALKING', fields: ['distanceMeters'] });
      ok('Routes API（開車、機車、大眾運輸路線）');
    } catch (e) { bad('Routes API', gHint(e, 'Routes API')); logExt('檢查 Routes', 'ERR', String(e.message || e)); }
    out.push(gCfg().mapId || $('#gMapId').value.trim() ? 'Map ID：已填' : 'Map ID：沒填（可以用；要導航轉向、傾斜再去建）');
    if (!G && !S.gErr && typed && typed !== (LS.getItem('g.key') || '')) out.push('都通過的話，按「儲存並重新載入」就會換成 Google 地圖。');
    show();
  }
  async function saveKey() {
    const id = $('#kId').value, sec = $('#kSecret').value;
    if (!id.trim() || !sec.trim()) { $('#kMsg').textContent = 'Client Id 和 Client Secret 都要填。'; $('#kMsg').className = 'fine err'; return; }
    tdx.setKey(id, sec);
    $('#kMsg').textContent = '測試中…'; $('#kMsg').className = 'fine';
    try {
      await tdx.getToken(true);
      await tdx.get(C.EP.bikeStation('Taipei'), { $top: 1, $select: 'StationUID' });
      $('#kMsg').textContent = '連線成功，金鑰已存在這台裝置。'; $('#kMsg').className = 'fine okc';
      if (S.county) { const c = S.county.code; S.county = null; selectCounty(c); } else showHome();
    } catch (e) { $('#kMsg').textContent = e.message || String(e); $('#kMsg').className = 'fine err'; }
  }
  function renderLog() {
    $('#logList').innerHTML = tdx.log.length ? tdx.log.map((l) => {
      const ok = typeof l.status === 'number' && l.status < 400;
      const u = String(l.url).replace(C.BASE, '').replace(/\$format=JSON&?/, '').replace(/key=[^&]+/, 'key=***');
      let du = u; try { du = decodeURIComponent(u); } catch { /* 保持原樣 */ }
      return `<li><b class="${ok ? 'okc' : 'err'}">${esc(l.status)}</b><span class="muted num">${esc(l.t.toLocaleTimeString('zh-TW', { hour12: false }))}</span><code>${esc(du)}</code>${l.note ? `<em>${esc(l.note)}</em>` : ''}</li>`;
    }).join('') : '<li class="muted">還沒有呼叫紀錄</li>';
  }
  async function copyLog() {
    const txt = tdx.log.map((l) => `${l.t.toISOString()} ${l.status} ${String(l.url).replace(C.BASE, '').replace(/key=[^&]+/, 'key=***')} ${l.note || ''}`).join('\n');
    try { await navigator.clipboard.writeText(txt); toast('已複製紀錄'); }
    catch { const ta = $('#logText'); ta.hidden = false; ta.value = txt; ta.select(); toast('請手動複製下方文字'); }
  }
  let toastT;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3600);
  }
  function showWelcome(v) { $('#welcome').hidden = !v; if (!v) LS.setItem('welcomed', '1'); }

  // 右側按鈕組跟著轉彎卡往下移
  function layoutCtrl() {
    const top = parseFloat(getComputedStyle($('#hud')).top) || 10;
    const turn = $('#turn');
    // 轉彎卡寬度＝時間卡右邊到螢幕右緣（手機）
    if (isWide()) sheet().style.top = ($('#hud').getBoundingClientRect().bottom + 10) + 'px';
    if (!isWide()) turn.style.width = Math.max(200, window.innerWidth - $('#hud').getBoundingClientRect().right - 8 - 12) + 'px';
    else turn.style.width = '';
    const y = turn.hidden ? top : turn.getBoundingClientRect().bottom + 10;
    $('#ctrl').style.top = y + 'px';
    $('#layerPop').style.top = y + 'px';
  }

  // ======================================================
  // 綁定
  // ======================================================
  function bindUI() {
    // 抽屜內所有按鈕用委派
    $('#sheetBody').addEventListener('click', (e) => {
      const md = e.target.closest('[data-mode]'); if (md) return openMode(md.dataset.mode);
      const a = e.target.closest('[data-act]'); if (!a) return;
      const act = a.dataset.act;
      if (act === 'relocate') { S.locFail = ''; showHome(); return firstLocate(); }
      if (act === 'savePlace') return openSaveBox(S.saveDest);
      if (act === 'home' && S.backFn) { const f = S.backFn; S.backFn = null; if (!S.nav?.active) { map.getSource('route').setData(emptyFC()); if (S.nav) S.nav = null; } return f(); }
      if (act === 'home') { clearBus(); clearSearchPins(); S.place = null; S.lastG = null; if (!S.nav?.active) { map.getSource('route').setData(emptyFC()); destMarker?.remove(); S.nav = null; } showHome(); }
      if (act === 'settings') openSettings();
      if (act === 'navhere' && S.panelDest) previewRoute(S.panelDest);
      if (act === 'endnav') finishNav(false);
    });
    $('#svClose').addEventListener('click', () => { $('#sv').hidden = true; S.pano = null; $('#svPano').innerHTML = ''; });
    // 注音／拼音輸入時，按「確認」選字不能當成送出：選字中或剛選完 300ms 內的送出一律忽略，要再按一次「搜尋」
    let composing = false, compEnd = 0;
    $('#q').addEventListener('compositionstart', () => { composing = true; });
    $('#q').addEventListener('compositionend', () => { composing = false; compEnd = Date.now(); });
    $('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.isComposing || e.keyCode === 229)) e.preventDefault(); });
    $('#qForm').addEventListener('submit', (e) => {
      e.preventDefault();
      if (composing || Date.now() - compEnd < 300) return;
      runSearch();
    });
    $('#q').addEventListener('focus', () => { if (!isWide() && sheet().dataset.d === 'peek') setDetent('half'); });
    document.addEventListener('focusout', (e) => { if (e.target.matches?.('input,textarea,select')) setTimeout(() => window.scrollTo(0, 0), 60); });

    $('#bLayers').addEventListener('click', () => { renderLayerPop(); $('#layerPop').hidden = !$('#layerPop').hidden; layoutCtrl(); });
    $('#layerPop').addEventListener('click', (e) => {
      const r = e.target.closest('.lrow'); if (!r) return;
      if (r.dataset.k) toggleLayer(r.dataset.k);
      if (r.dataset.bm) setBasemap(r.dataset.bm);
      if (r.dataset.traffic) toggleTraffic();
      if (r.dataset.cam) toggleSpeedcam();
      if (r.dataset.auto) { autoVec = !autoVec; LS.setItem('autoVec', autoVec ? '1' : '0'); applyBase(); renderLayerPop(); }
    });
    $('#b3d').addEventListener('click', () => {
      const on = map.getPitch() < 20;
      map.easeTo({ pitch: on ? 60 : 0, bearing: on ? -18 : 0, duration: 700 });
      $('#b3d').classList.toggle('on', on);
    });
    $('#bLoc').addEventListener('click', locate);
    $('#bNorth').addEventListener('click', resetNorth);
    $('#bSet').addEventListener('click', () => openSettings());
    $('#follow').addEventListener('click', () => { if (S.nav) { S.nav.follow = true; S.nav.camReady = false; $('#follow').hidden = true; if (S.nav.last) onPosition(S.nav.last, null, null); } });

    // 設定
    $('#kSave').addEventListener('click', saveKey);
    $('#kClear').addEventListener('click', () => { tdx.setKey('', ''); $('#kId').value = ''; $('#kSecret').value = ''; $('#kMsg').textContent = '已清除金鑰。'; });
    $('#ytMode').addEventListener('change', (e) => { LS.setItem('yt.mode', e.target.value); LS.removeItem('pip.hide'); applyYtMode(); });
    $('#relaySave').addEventListener('click', async () => {
      const v = $('#relay').value.trim().replace(/\/$/, '');
      if (v && !/^https:\/\//.test(v)) { $('#relayMsg').textContent = '網址要以 https:// 開頭。'; $('#relayMsg').className = 'fine err'; return; }
      if (v) LS.setItem('relay', v); else LS.removeItem('relay');
      const ok = await checkRelay(true);
      if (ok) { S.trafficUrl = null; if (!LS.getItem('basemap')) basemap = 'tomtom'; applyBase(); if (S.county) { const c = S.county.code; S.county = null; selectCounty(c); } else showHome(); }
    });
    $('#gCheck').addEventListener('click', checkGoogle);
    $('#gSave').addEventListener('click', () => {
      const k = $('#gKey').value.trim(), id = $('#gMapId').value.trim();
      if (k && !/^AIza[\w-]{30,}$/.test(k)) { $('#gMsg').textContent = '金鑰格式不對：Google 金鑰是 AIza 開頭、約 39 個字。'; $('#gMsg').className = 'fine err'; return; }
      if (k) LS.setItem('g.key', k); else LS.removeItem('g.key');
      if (id) LS.setItem('g.mapId', id); else LS.removeItem('g.mapId');
      $('#gMsg').textContent = '重新載入中…'; $('#gMsg').className = 'fine';
      setTimeout(() => location.reload(), 300);
    });
    $('#ttSave').addEventListener('click', async () => {
      const v = $('#ttKey').value.trim();
      if (!v) { LS.removeItem('tt.key'); S.traffic = false; LS.setItem('traffic', '0'); applyTraffic(); $('#ttMsg').textContent = '已清除 TomTom 金鑰。'; $('#ttMsg').className = 'fine'; return; }
      $('#ttMsg').textContent = '測試中…'; $('#ttMsg').className = 'fine';
      const ok = await testTomTom(v);
      if (!ok) { $('#ttMsg').textContent = '測試失敗：金鑰錯誤、額度用完，或沒有網路。'; $('#ttMsg').className = 'fine err'; return; }
      LS.setItem('tt.key', v);
      S.traffic = true; LS.setItem('traffic', '1'); S.trafficUrl = null;
      if (!LS.getItem('basemap')) basemap = 'tomtom';
      applyBase();
      applyTraffic(); renderLayerPop();
      $('#ttMsg').textContent = '連線成功，已開啟即時路況（圖層選單可關）。'; $('#ttMsg').className = 'fine okc';
    });
    $('#ytKey').addEventListener('change', (e) => { const v = e.target.value.trim(); if (v) LS.setItem('yt.key', v); else LS.removeItem('yt.key'); });
    $('#voiceSw').addEventListener('click', () => { S.voice = !S.voice; LS.setItem('voice', S.voice ? '1' : '0'); $('#voiceSw').classList.toggle('on', S.voice); $('#voiceSw').setAttribute('aria-checked', S.voice); if (S.voice) speak('語音提示已開啟'); });
    $('#openLog').addEventListener('click', () => { closeDialog('setDlg'); renderLog(); openDialog('logDlg'); });
    $('#logCopy').addEventListener('click', copyLog);
    $('#clearCache').addEventListener('click', () => {
      try { Object.keys(localStorage).filter((k) => k.startsWith('c:')).forEach((k) => localStorage.removeItem(k)); } catch { /* 忽略 */ }
      S.metroByOp = {}; S.loadedFor = {}; toast('已清除站點快取');
    });
    $('#reWelcome').addEventListener('click', () => { closeDialog('setDlg'); showWelcome(true); });
    document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeDialog(b.dataset.close)));
    document.querySelectorAll('.dlg').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.hidden = true; }));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { document.querySelectorAll('.dlg').forEach((d) => { d.hidden = true; }); $('#layerPop').hidden = true; } });

    // 歡迎頁
    $('#wKey').addEventListener('click', () => { showWelcome(false); if (!tdx.ready()) openSettings(); });
    $('#wSkip').addEventListener('click', () => showWelcome(false));

    // YouTube
    $('#pipOpen').addEventListener('click', openYouTubeApp);
    // 影片小視窗在哪一邊由 iOS 決定（使用者拖到哪就在哪），網頁讀不到；讓你自己切左右，抽屜跟著讓位
    $('#pipSide').addEventListener('click', () => { LS.setItem('pip.side', LS.getItem('pip.side') === 'left' ? 'right' : 'left'); applyYtMode(); });
    // 從 YouTube App 回來＝影片多半已經縮成小視窗在播：把虛線框和說明收起來
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || !YT.wentOut || Date.now() - YT.wentOut < 1500) return;
      YT.wentOut = 0; YT.pipPlaying = true; applyYtMode();
    });
    $('#pipHide').addEventListener('click', () => { LS.setItem('pip.hide', '1'); applyYtMode(); });
    $('#ytFab').addEventListener('click', () => {
      if (ytMode() === 'pip') return openYouTubeApp();
      $('#yt').hidden = false; $('#ytFab').hidden = true; $('#yt').classList.remove('mini'); renderYtList();
    });
    $('#ytForm').addEventListener('submit', (e) => { e.preventDefault(); ytSubmit(); });
    $('#ytSwap').addEventListener('click', () => { $('#ytPick').hidden = !$('#ytPick').hidden; $('#yt').classList.remove('mini'); renderYtList(); });
    $('#ytSize').addEventListener('click', () => { const s = { s: 'm', m: 'l', l: 's' }[$('#yt').dataset.size] || 'm'; $('#yt').dataset.size = s; });
    $('#ytMin').addEventListener('click', () => $('#yt').classList.toggle('mini'));
    $('#ytClose').addEventListener('click', () => { try { YT.player?.stopVideo(); } catch { /* 忽略 */ } $('#yt').hidden = true; $('#ytFab').hidden = false; });
    $('#ytPlay').addEventListener('click', () => { const p = YT.player; if (!p?.getPlayerState) return; p.getPlayerState() === 1 ? p.pauseVideo() : p.playVideo(); });

    darkMQ.addEventListener?.('change', () => applyBase());
    tdx.onLog(() => { if (!$('#logDlg').hidden) renderLog(); });
  }

  // ======================================================
  // 啟動
  // ======================================================
  bindUI();
  bindSheetDrag();
  setQMode('place');
  tick(); setInterval(tick, 5000);
  applyYtMode();
  showHome();
  setDetent(isWide() ? 'half' : 'peek');
  layoutCtrl();
  if (typeof maplibregl === 'undefined') toast('地圖程式庫載入失敗，請確認網路');
  else initMap().then(() => { loadWeather(); setInterval(loadWeather, 15 * 60000); });
  if (relayUrl() && !tdx.getKey().id) checkRelay(false);
  if (tdx.ready()) { $('#wKey').textContent = '開始使用'; }
  if (LS.getItem('welcomed') !== '1') showWelcome(true);
  else if (!tdx.ready()) setTimeout(() => openSettings('輸入 TDX 金鑰後，才看得到即時交通資料。'), 500);
})();

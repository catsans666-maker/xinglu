/* 行路台灣：Google 地圖轉接層
 * 介面照 MapLibre 的寫法（addSource／addLayer／easeTo…），底下換成 google.maps。
 * 這樣 ui.js 原本畫站點、路線、導航鏡頭的程式幾乎不用改。
 * 縮放層級：MapLibre 的圖磚是 512px，Google 是 256px → Google 縮放 = MapLibre 縮放 + 1。
 */
(function (root) {
  'use strict';
  const ZOFF = 1;

  // ---------- MapLibre 運算式（只做 ui.js 有用到的） ----------
  function ev(e, f, z) {
    if (!Array.isArray(e)) return e;
    const p = f.properties || {};
    const [op, ...a] = e;
    const v = (x) => ev(x, f, z);
    switch (op) {
      case 'get': return p[a[0]];
      case 'has': return a[0] in p;
      case 'literal': return a[0];
      case 'zoom': return z;
      case '!': return !v(a[0]);
      case '==': return v(a[0]) === v(a[1]);
      case '!=': return v(a[0]) !== v(a[1]);
      case '<': return v(a[0]) < v(a[1]);
      case '<=': return v(a[0]) <= v(a[1]);
      case '>': return v(a[0]) > v(a[1]);
      case '>=': return v(a[0]) >= v(a[1]);
      case 'all': return a.every((x) => v(x));
      case 'any': return a.some((x) => v(x));
      case 'in': { const n = v(a[0]), h = v(a[1]); return h == null ? false : typeof h === 'string' ? h.includes(n) : h.includes(n); }
      case 'concat': return a.map((x) => v(x) ?? '').join('');
      case 'coalesce': for (const x of a) { const r = v(x); if (r != null) return r; } return null;
      case 'to-string': return String(v(a[0]) ?? '');
      case 'case': {
        for (let i = 0; i + 1 < a.length; i += 2) if (v(a[i])) return v(a[i + 1]);
        return v(a[a.length - 1]);
      }
      case 'match': {
        const x = v(a[0]);
        for (let i = 1; i + 1 < a.length; i += 2) {
          const k = a[i];
          if (Array.isArray(k) ? k.includes(x) : k === x) return v(a[i + 1]);
        }
        return v(a[a.length - 1]);
      }
      case 'step': {
        const x = v(a[0]);
        let r = v(a[1]);
        for (let i = 2; i + 1 < a.length; i += 2) if (x >= a[i]) r = v(a[i + 1]);
        return r;
      }
      case 'interpolate': {
        // ['interpolate', ['linear'], input, z0, v0, z1, v1, ...]
        const x = v(a[1]);
        const st = a.slice(2);
        if (x <= st[0]) return v(st[1]);
        for (let i = 0; i + 3 < st.length; i += 2) {
          if (x <= st[i + 2]) {
            const t = (x - st[i]) / (st[i + 2] - st[i]);
            return v(st[i + 1]) + (v(st[i + 3]) - v(st[i + 1])) * t;
          }
        }
        return v(st[st.length - 1]);
      }
      default: return null;
    }
  }
  const usesZoom = (x) => JSON.stringify(x || null).includes('"zoom"');

  // 'rgba(…)' → Google 要的顏色＋透明度
  function color(c, fallback = '#000') {
    if (c == null) return { c: fallback, o: 1 };
    const m = String(c).match(/^rgba?\(([^)]+)\)$/i);
    if (!m) return { c: String(c), o: 1 };
    const [r, g, b, al] = m[1].split(',').map((x) => parseFloat(x));
    const hex = '#' + [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
    return { c: hex, o: Number.isFinite(al) ? al : 1 };
  }

  // GeoJSON 統一成 Feature 陣列
  function featuresOf(d) {
    if (!d) return [];
    if (d.type === 'FeatureCollection') return d.features || [];
    if (d.type === 'Feature') return [d];
    if (d.coordinates) return [{ type: 'Feature', geometry: d, properties: {} }];
    return [];
  }
  const LL = (c) => ({ lat: c[1], lng: c[0] });

  // ---------- 麥卡托世界座標（Google 縮放） ----------
  function toWorld(lng, lat, gz) {
    const s = 256 * 2 ** gz;
    const sin = Math.min(Math.max(Math.sin(lat * Math.PI / 180), -0.9999), 0.9999);
    return [(lng + 180) / 360 * s, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s];
  }
  function fromWorld(x, y, gz) {
    const s = 256 * 2 ** gz;
    const lng = x / s * 360 - 180;
    const n = Math.PI - 2 * Math.PI * y / s;
    return [lng, 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))];
  }

  // ---------- 群集（固定網格，平移時不會跳） ----------
  function clusterize(feats, mlZoom, radius, maxZoom) {
    if (mlZoom > maxZoom) return feats.map((f, i) => ({ f, key: 'p' + i }));
    const zq = Math.floor(mlZoom * 2) / 2;
    const grid = new Map();
    feats.forEach((f, i) => {
      const c = f.geometry && f.geometry.coordinates;
      if (!c) return;
      // MapLibre 的 512px 世界座標（clusterRadius 用的就是這個單位）
      const [x, y] = toWorld(c[0], c[1], zq).map((n) => n * 2);
      const k = Math.floor(x / radius) + ':' + Math.floor(y / radius);
      let g = grid.get(k);
      if (!g) { g = { k, list: [], sx: 0, sy: 0 }; grid.set(k, g); }
      g.list.push(i); g.sx += c[0]; g.sy += c[1];
    });
    const out = [];
    grid.forEach((g) => {
      if (g.list.length === 1) { const i = g.list[0]; out.push({ f: feats[i], key: 'p' + i }); return; }
      const n = g.list.length;
      out.push({
        key: 'c' + zq + ':' + g.k,
        f: { type: 'Feature', geometry: { type: 'Point', coordinates: [g.sx / n, g.sy / n] },
          properties: { cluster: true, cluster_id: zq + ':' + g.k, point_count: n, point_count_abbreviated: n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n) } },
      });
    });
    return out;
  }

  // ---------- HTML 標記（我的位置、目的地圖釘） ----------
  class Marker {
    constructor(o = {}) {
      this._el = o.element || document.createElement('div');
      this._anchor = o.anchor || 'center';
      this._mapAlign = o.rotationAlignment === 'map';
      this._rot = 0; this._p = null; this._m = null; this._g = null;
      // 外層負責定位，裡層（使用者的元素）負責旋轉
      this._wrap = document.createElement('div');
      this._wrap.style.cssText = 'position:absolute;pointer-events:auto;';
      this._wrap.appendChild(this._el);
    }
    getElement() { return this._el; }
    setLngLat(p) { this._p = Array.isArray(p) ? p : [p.lng, p.lat]; this._place(); return this; }
    getLngLat() { return this._p ? { lng: this._p[0], lat: this._p[1] } : null; }
    setRotation(d) { this._rot = d || 0; this._spin(); return this; }
    _spin() {
      const h = this._mapAlign && this._m ? this._m.getBearing() : 0;
      this._el.style.transform = `rotate(${this._rot - h}deg)`;
    }
    addTo(map) {
      if (this._m === map) { this._place(); return this; }
      this.remove();
      this._m = map;
      const gm = google.maps;
      const shift = this._anchor === 'bottom' ? 'translate(-50%,-100%)' : 'translate(-50%,-50%)';
      if (map._adv) {
        // 有 Map ID：用 AdvancedMarker（地圖傾斜時位置也準）
        const box = document.createElement('div');
        box.style.cssText = this._anchor === 'bottom' ? '' : 'transform:translateY(50%)';
        box.appendChild(this._wrap);
        this._wrap.style.position = 'relative';
        this._g = new gm.marker.AdvancedMarkerElement({ map: map._g, content: box, position: this._p ? LL(this._p) : null, zIndex: 1000, gmpClickable: false });
      } else {
        const self = this;
        const ov = new gm.OverlayView();
        ov.onAdd = function () { this.getPanes().floatPane.appendChild(self._wrap); };
        ov.draw = function () {
          if (!self._p) return;
          const pt = this.getProjection().fromLatLngToDivPixel(new gm.LatLng(self._p[1], self._p[0]));
          if (!pt) return;
          self._wrap.style.left = pt.x + 'px'; self._wrap.style.top = pt.y + 'px';
          self._wrap.style.transform = shift;
        };
        ov.onRemove = function () { self._wrap.remove(); };
        ov.setMap(map._g);
        this._g = ov;
      }
      map._markers.add(this);
      this._spin();
      return this;
    }
    _place() {
      if (!this._g || !this._p) return;
      if (this._g instanceof google.maps.OverlayView) this._g.draw();
      else this._g.position = LL(this._p);
    }
    remove() {
      if (this._g) { if (this._g.setMap) this._g.setMap(null); else this._g.map = null; }
      if (this._m) this._m._markers.delete(this);
      this._g = null; this._m = null;
      return this;
    }
  }

  // ---------- 地圖 ----------
  class GMap {
    constructor(o) {
      const gm = google.maps;
      const el = typeof o.container === 'string' ? document.getElementById(o.container) : o.container;
      this._div = el;
      this._adv = !!(o.mapId && gm.marker && gm.marker.AdvancedMarkerElement);
      const opts = {
        center: LL(o.center || [121, 23.7]), zoom: (o.zoom ?? 7) + ZOFF,
        mapId: o.mapId || undefined, disableDefaultUI: true, gestureHandling: 'greedy', keyboardShortcuts: false,
        clickableIcons: true, isFractionalZoomEnabled: true, headingInteractionEnabled: true, tiltInteractionEnabled: true,
        mapTypeId: o.mapTypeId || 'roadmap', backgroundColor: o.dark ? '#1c1c1e' : '#eef0f2',
      };
      if (o.mapId && gm.ColorScheme) opts.colorScheme = o.dark ? gm.ColorScheme.DARK : gm.ColorScheme.LIGHT;
      if (o.maxBounds) opts.restriction = { latLngBounds: { west: o.maxBounds[0][0], south: o.maxBounds[0][1], east: o.maxBounds[1][0], north: o.maxBounds[1][1] }, strictBounds: false };
      this._g = new gm.Map(el, opts);
      this._src = {}; this._layers = []; this._img = {}; this._ev = {}; this._markers = new Set();
      this._hit = null; this._anim = null; this._loaded = false;
      const g = this._g;
      gm.event.addListenerOnce(g, 'idle', () => { this._loaded = true; this._fire('load', {}); });
      g.addListener('idle', () => { this._renderAll(true); this._fire('moveend', {}); });
      g.addListener('zoom_changed', () => { this._restyleZoom(); this._fire('zoom', {}); });
      g.addListener('dragstart', () => { this._stopAnim(); this._fire('dragstart', {}); this._fire('movestart', {}); });
      g.addListener('heading_changed', () => { this._markers.forEach((m) => m._spin()); this._fire('rotate', {}); });
      g.addListener('click', (e) => {
        if (e.placeId) {
          // 點 Google 的店家／地標：不要跳 Google 自己的小視窗，交給 ui.js 開資料卡
          e.stop();
          this._fire('poiclick', { placeId: e.placeId, lngLat: { lng: e.latLng.lng(), lat: e.latLng.lat() } });
          return;
        }
        this._hit = null;
        this._fire('click', this._evt(e));
      });
    }
    // 事件
    on(type, a, b) {
      if (typeof a === 'function') (this._ev[type] = this._ev[type] || []).push(a);
      // map.on('mouseenter', layerId, fn)：Google 的標記本身就會變手指，不用做
      void b;
      return this;
    }
    off(type, fn) { this._ev[type] = (this._ev[type] || []).filter((f) => f !== fn); return this; }
    once(type, fn) {
      if (type === 'load' && this._loaded) { setTimeout(() => fn({}), 0); return this; }
      const w = (e) => { this.off(type, w); fn(e); };
      return this.on(type, w);
    }
    _fire(type, e) { (this._ev[type] || []).slice().forEach((f) => { try { f(e); } catch (err) { console.error(err); } }); }
    _evt(e) {
      return { lngLat: e.latLng ? { lng: e.latLng.lng(), lat: e.latLng.lat() } : null, point: { x: e.pixel?.x || 0, y: e.pixel?.y || 0 }, originalEvent: e.domEvent };
    }

    // 鏡頭
    getZoom() { return (this._g.getZoom() ?? 7) - ZOFF; }
    getBearing() { return this._g.getHeading() || 0; }
    getPitch() { return this._g.getTilt() || 0; }
    getCenter() {
      const c = this._g.getCenter();
      const lng = c ? c.lng() : 121, lat = c ? c.lat() : 23.7;
      return { lng, lat, toArray: () => [lng, lat] };
    }
    getBounds() {
      const b = this._g.getBounds();
      if (!b) return null;
      const sw = b.getSouthWest(), ne = b.getNorthEast();
      return { getWest: () => sw.lng(), getSouth: () => sw.lat(), getEast: () => ne.lng(), getNorth: () => ne.lat(), toArray: () => [[sw.lng(), sw.lat()], [ne.lng(), ne.lat()]] };
    }
    getCanvas() { return this._div; }
    getContainer() { return this._div; }
    resize() { return this; }
    // padding：讓目標點落在「扣掉面板後」的可視範圍中央
    _padCenter(center, gz, heading, pad) {
      if (!pad || !center) return center;
      const dx = ((pad.left || 0) - (pad.right || 0)) / 2, dy = ((pad.top || 0) - (pad.bottom || 0)) / 2;
      if (!dx && !dy) return center;
      const r = (heading || 0) * Math.PI / 180;
      const wx = dx * Math.cos(r) - dy * Math.sin(r), wy = dx * Math.sin(r) + dy * Math.cos(r);
      const [x, y] = toWorld(center[0], center[1], gz);
      return fromWorld(x - wx, y - wy, gz);
    }
    _target(o) {
      const cur = this.getCenter();
      const gz = o.zoom != null ? o.zoom + ZOFF : this._g.getZoom();
      const heading = o.bearing != null ? o.bearing : this.getBearing();
      const tilt = o.pitch != null ? o.pitch : this.getPitch();
      let c = o.center ? (Array.isArray(o.center) ? o.center : [o.center.lng, o.center.lat]) : null;
      c = c ? this._padCenter(c, gz, heading, o.padding) : [cur.lng, cur.lat];
      return { c, gz, heading, tilt };
    }
    _stopAnim() { if (this._anim) { cancelAnimationFrame(this._anim); this._anim = null; } }
    jumpTo(o) { this._stopAnim(); const t = this._target(o); this._g.moveCamera({ center: LL(t.c), zoom: t.gz, heading: t.heading, tilt: t.tilt }); return this; }
    easeTo(o) {
      const dur = o.duration ?? 500;
      if (!dur || document.hidden) return this.jumpTo(o);
      this._stopAnim();
      const t = this._target(o);
      const c0 = this.getCenter(), z0 = this._g.getZoom(), h0 = this.getBearing(), t0 = this.getPitch();
      let dh = ((t.heading - h0 + 540) % 360) - 180;   // 走最短的方向轉
      const ease = o.easing || ((x) => 1 - (1 - x) ** 3);
      const start = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - start) / dur), e = ease(k);
        this._g.moveCamera({
          center: { lat: c0.lat + (t.c[1] - c0.lat) * e, lng: c0.lng + (t.c[0] - c0.lng) * e },
          zoom: z0 + (t.gz - z0) * e, heading: (h0 + dh * e + 360) % 360, tilt: t0 + (t.tilt - t0) * e,
        });
        this._anim = k < 1 ? requestAnimationFrame(step) : null;
      };
      this._anim = requestAnimationFrame(step);
      return this;
    }
    flyTo(o) { return this.easeTo({ duration: 1000, ...o }); }
    fitBounds(b, o = {}) {
      this._stopAnim();
      const pad = o.padding == null ? 40 : o.padding;
      const bounds = { west: b[0][0], south: b[0][1], east: b[1][0], north: b[1][1] };
      if (bounds.west === bounds.east && bounds.south === bounds.north) return this.easeTo({ center: b[0], zoom: o.maxZoom ?? 15 });
      this._g.fitBounds(bounds, typeof pad === 'number' ? pad : { top: pad.top || 0, bottom: pad.bottom || 0, left: pad.left || 0, right: pad.right || 0 });
      if (o.maxZoom != null) google.maps.event.addListenerOnce(this._g, 'idle', () => { if (this.getZoom() > o.maxZoom) this._g.setZoom(o.maxZoom + ZOFF); });
      return this;
    }

    // 圖片
    hasImage(id) { return id in this._img; }
    addImage(id, img, o = {}) {
      const w = (img.naturalWidth || img.width || 40) / (o.pixelRatio || 1);
      const h = (img.naturalHeight || img.height || 40) / (o.pixelRatio || 1);
      this._img[id] = { url: img.src, w, h };
    }

    // 資料來源
    addSource(id, spec) {
      const self = this;
      const s = {
        id, spec, data: featuresOf(spec.data), ver: 0,
        setData(d) { this.data = featuresOf(d); this.ver++; self._layers.filter((l) => l.source === id).forEach((l) => self._render(l, true)); return this; },
        getClusterExpansionZoom(cid) {
          const zq = parseFloat(String(cid).split(':')[0]) || self.getZoom();
          const z = Math.min((spec.clusterMaxZoom ?? 14) + 1, zq + 2);
          return Promise.resolve(z);
        },
        _data: () => s.data,
      };
      this._src[id] = s;
      return this;
    }
    getSource(id) { return this._src[id]; }
    removeSource(id) { delete this._src[id]; return this; }

    // 圖層
    addLayer(spec, before) {
      const l = { ...spec, layout: { ...(spec.layout || {}) }, paint: { ...(spec.paint || {}) }, objs: new Map() };
      l.visible = l.layout.visibility !== 'none';
      const i = before ? this._layers.findIndex((x) => x.id === before) : -1;
      if (i >= 0) this._layers.splice(i, 0, l); else this._layers.push(l);
      this._layers.forEach((x, k) => { x.z = k; });
      this._render(l, true);
      return this;
    }
    getLayer(id) { return this._layers.find((l) => l.id === id); }
    removeLayer(id) {
      const l = this.getLayer(id);
      if (l) { this._clear(l); this._layers = this._layers.filter((x) => x !== l); }
      return this;
    }
    setLayoutProperty(id, k, v) {
      const l = this.getLayer(id); if (!l) return;
      l.layout[k] = v;
      if (k === 'visibility') l.visible = v !== 'none';
      this._render(l, true);
    }
    getLayoutProperty(id, k) { const l = this.getLayer(id); return l ? l.layout[k] : undefined; }
    setPaintProperty(id, k, v) { const l = this.getLayer(id); if (!l) return; l.paint[k] = v; this._render(l, true); }
    setFilter(id, f) { const l = this.getLayer(id); if (!l) return; l.filter = f; this._render(l, true); }

    // 點擊命中（標記／線自己會收到點擊，這裡只回報剛剛點到的那個）
    queryRenderedFeatures(_pt, o = {}) {
      if (!this._hit) return [];
      if (o.layers && !o.layers.includes(this._hit.layer.id)) return [];
      return [this._hit];
    }

    // ----- 繪製 -----
    _zoomOk(l, z) { return (l.minzoom == null || z >= l.minzoom) && (l.maxzoom == null || z < l.maxzoom); }
    _clear(l) { l.objs.forEach((o) => o.setMap(null)); l.objs.clear(); }
    _renderAll(viewOnly) { this._layers.forEach((l) => { if (l.type === 'symbol' || l.type === 'circle' || viewOnly !== true) this._render(l, false); }); }
    _restyleZoom() {
      const z = this.getZoom();
      const zq = Math.round(z * 4) / 4;
      if (zq === this._lastZq) return;
      this._lastZq = zq;
      this._layers.forEach((l) => {
        if (!this._zoomOk(l, z) && l.objs.size) { this._clear(l); return; }
        if (l.type === 'line' && (usesZoom(l.paint) || l.objs.size === 0)) this._render(l, true);
      });
    }
    _render(l, force) {
      const src = this._src[l.source];
      const z = this.getZoom();
      if (!src || !l.visible || !this._zoomOk(l, z) || !['line', 'circle', 'symbol'].includes(l.type)) { this._clear(l); return; }
      if (l.type === 'symbol' && !l.layout['icon-image'] && !l.layout['text-field']) { this._clear(l); return; }
      const gm = google.maps;
      let feats = src.data;
      let items;
      if (src.spec.cluster && l.type !== 'line') items = clusterize(feats, z, src.spec.clusterRadius || 50, src.spec.clusterMaxZoom ?? 14);
      else items = feats.map((f, i) => ({ f, key: 'p' + i }));
      if (l.filter) items = items.filter((it) => ev(l.filter, it.f, z));
      // 點狀圖層只畫畫面附近的（YouBike 一個縣市上千站）
      if (l.type !== 'line') {
        const b = this._g.getBounds();
        if (b) {
          const sw = b.getSouthWest(), ne = b.getNorthEast();
          const mx = (ne.lng() - sw.lng()) * 0.3, my = (ne.lat() - sw.lat()) * 0.3;
          items = items.filter((it) => {
            const c = it.f.geometry && it.f.geometry.coordinates;
            return c && c[0] > sw.lng() - mx && c[0] < ne.lng() + mx && c[1] > sw.lat() - my && c[1] < ne.lat() + my;
          });
        }
      }
      const keyOf = (it) => src.ver + ':' + it.key;
      const want = new Set(items.map(keyOf));
      l.objs.forEach((o, k) => { if (!want.has(k)) { o.setMap(null); l.objs.delete(k); } });
      if (!force && l.type === 'line' && l.objs.size) return;
      items.forEach((it) => {
        const k = keyOf(it);
        let o = l.objs.get(k);
        const f = it.f;
        if (l.type === 'line') {
          const P = l.paint;
          const col = color(ev(P['line-color'], f, z), '#0a84ff');
          const op = ev(P['line-opacity'] ?? 1, f, z) * col.o;
          const opt = { strokeColor: col.c, strokeOpacity: op, strokeWeight: ev(P['line-width'] ?? 2, f, z), zIndex: l.z, clickable: true };
          const g = f.geometry || {};
          const paths = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
          if (!o) {
            o = { parts: paths.map((pp) => new gm.Polyline({ ...opt, path: pp.map(LL), map: this._g })), setMap(m) { this.parts.forEach((x) => x.setMap(m)); } };
            o.parts.forEach((pl) => pl.addListener('click', (e) => this._clickFeat(l, f, e)));
            l.objs.set(k, o);
          } else o.parts.forEach((pl) => pl.setOptions(opt));
          return;
        }
        const pos = LL(f.geometry.coordinates);
        let opt;
        if (l.type === 'circle') {
          const P = l.paint;
          const fill = color(ev(P['circle-color'] ?? '#000', f, z));
          const st = color(ev(P['circle-stroke-color'] ?? '#fff', f, z));
          opt = { icon: { path: gm.SymbolPath.CIRCLE, scale: ev(P['circle-radius'] ?? 5, f, z), fillColor: fill.c, fillOpacity: fill.o, strokeColor: st.c, strokeOpacity: st.o, strokeWeight: ev(P['circle-stroke-width'] ?? 0, f, z) } };
        } else {
          const L = l.layout;
          const imgId = L['icon-image'] ? ev(L['icon-image'], f, z) : null;
          const im = imgId && this._img[imgId];
          if (im) {
            const s = ev(L['icon-size'] ?? 1, f, z);
            opt = { icon: { url: im.url, scaledSize: new gm.Size(im.w * s, im.h * s), anchor: new gm.Point(im.w * s / 2, im.h * s / 2) } };
          } else if (L['text-field']) {
            const P = l.paint;
            opt = { icon: { path: 'M0 0', strokeOpacity: 0, scale: 1 }, label: { text: String(ev(L['text-field'], f, z) ?? ''), color: ev(P['text-color'] ?? '#1c1c1e', f, z), fontSize: (ev(L['text-size'] ?? 12, f, z)) + 'px', fontWeight: '600' } };
          } else return;
        }
        opt.zIndex = 100 + l.z;
        if (!o) {
          o = new gm.Marker({ ...opt, position: pos, map: this._g, optimized: true, clickable: !L_TEXT_ONLY(l) });
          o.addListener('click', (e) => this._clickFeat(l, f, e));
          l.objs.set(k, o);
        } else if (force || usesZoom(l.paint) || usesZoom(l.layout)) { o.setOptions(opt); o.setPosition(pos); }
      });
    }
    _clickFeat(l, f, e) {
      this._hit = { layer: { id: l.id }, properties: f.properties || {}, geometry: f.geometry };
      this._fire('click', this._evt(e));
      this._hit = null;
    }
  }
  const L_TEXT_ONLY = (l) => l.type === 'symbol' && !l.layout['icon-image'];

  // ---------- 載入 Google Maps JS ----------
  let loading = null;
  function load(key, opts = {}) {
    if (root.google && root.google.maps && root.google.maps.Map) return Promise.resolve(root.google.maps);
    if (loading) return loading;
    loading = new Promise((res, rej) => {
      const cb = '__xlGoogleReady';
      root[cb] = () => res(root.google.maps);
      root.gm_authFailure = () => { if (opts.onAuthFail) opts.onAuthFail(); };
      const s = document.createElement('script');
      const p = new URLSearchParams({ key, v: 'beta', language: 'zh-TW', region: 'TW', libraries: 'marker,places,routes,geometry', loading: 'async', callback: cb });
      s.src = 'https://maps.googleapis.com/maps/api/js?' + p.toString();
      s.async = true;
      s.onerror = () => { loading = null; rej(new Error('Google 地圖程式載入失敗')); };
      document.head.appendChild(s);
      setTimeout(() => rej(new Error('Google 地圖載入逾時')), 20000);
    });
    return loading;
  }

  const GM = { Map: GMap, Marker, load, _ev: ev, _clusterize: clusterize, _color: color, _toWorld: toWorld, _fromWorld: fromWorld };
  if (typeof module !== 'undefined' && module.exports) module.exports = GM;
  else root.GM = GM;
})(typeof window !== 'undefined' ? window : globalThis);

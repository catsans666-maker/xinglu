// 測試用的假 google.maps（沙盒連不到 Google）
(function(){
  const L = [];   // 所有事件
  function Ev(){ this._h = {}; }
  Ev.prototype.addListener = function(n, f){ (this._h[n] = this._h[n] || []).push(f); return { remove: () => { this._h[n] = this._h[n].filter((x) => x !== f); } }; };
  Ev.prototype._t = function(n, a){ (this._h[n] || []).slice().forEach((f) => f(a || {})); };
  class LatLng { constructor(a, b){ if (typeof a === 'object') { this._a = a.lat; this._b = a.lng; } else { this._a = a; this._b = b; } } lat(){ return this._a; } lng(){ return this._b; } }
  const ll = (p) => (p instanceof LatLng ? p : new LatLng(p.lat, p.lng));
  let idleT;
  class Map extends Ev {
    constructor(el, o){ super(); window.__gmap = this; this.el = el; this.o = o; this.c = ll(o.center); this.z = o.zoom; this.h = 0; this.t = 0; this.type = o.mapTypeId; this.fits = []; setTimeout(() => this._t('idle'), 30); }
    _idle(){ clearTimeout(idleT); idleT = setTimeout(() => this._t('idle'), 20); }
    getZoom(){ return this.z; } setZoom(z){ this.z = z; this._t('zoom_changed'); this._idle(); }
    getCenter(){ return this.c; } getHeading(){ return this.h; } getTilt(){ return this.t; } getDiv(){ return this.el; }
    getBounds(){ const d = 360 / 2 ** this.z * 3; return { getSouthWest: () => new LatLng(this.c.lat() - d, this.c.lng() - d), getNorthEast: () => new LatLng(this.c.lat() + d, this.c.lng() + d) }; }
    moveCamera(o){ if (o.center) this.c = ll(o.center); if (o.zoom != null && o.zoom !== this.z) { this.z = o.zoom; this._t('zoom_changed'); } if (o.heading != null && o.heading !== this.h) { this.h = o.heading; this._t('heading_changed'); } if (o.tilt != null) this.t = o.tilt; this._idle(); }
    fitBounds(b, p){ this.fits.push({ b, p }); this.c = new LatLng((b.south + b.north) / 2, (b.west + b.east) / 2); this.z = 15; this._t('zoom_changed'); this._idle(); }
    setMapTypeId(t){ this.type = t; }
  }
  const objs = { markers: [], lines: [] };
  class Marker extends Ev { constructor(o){ super(); this.o = o; this.map = o.map; objs.markers.push(this); } setMap(m){ this.map = m; } setOptions(o){ Object.assign(this.o, o); } setPosition(p){ this.o.position = p; } }
  class Polyline extends Ev { constructor(o){ super(); this.o = o; this.map = o.map; objs.lines.push(this); } setMap(m){ this.map = m; } setOptions(o){ Object.assign(this.o, o); } }
  class OverlayView { setMap(m){ if (m) { this.onAdd(); this.draw(); } else this.onRemove && this.onRemove(); } getPanes(){ return { floatPane: document.body }; } getProjection(){ return { fromLatLngToDivPixel: () => ({ x: 100, y: 100 }) }; } }
  class AdvancedMarkerElement { constructor(o){ this.content = o.content; this.position = o.position; this.map = o.map; } set map(m){ this._m = m; if (m) document.body.appendChild(this.content); else this.content && this.content.remove(); } get map(){ return this._m; } }
  class TrafficLayer { setMap(m){ window.__traffic = !!m; } }
  const event = { addListenerOnce: (o, n, f) => { const h = o.addListener(n, (a) => { h.remove(); f(a); }); return h; }, trigger: (o, n, a) => o._t(n, a) };
  // ---- 地點 ----
  const PL = {
    p1: { displayName: '台北101', formattedAddress: '110台灣台北市信義區信義路五段7號', location: new LatLng(25.034, 121.5645), primaryTypeDisplayName: '觀光景點', rating: 4.6, userRatingCount: 98765, nationalPhoneNumber: '02 8101 8800', websiteURI: 'https://www.taipei-101.com.tw/', googleMapsURI: 'https://maps.google.com/?cid=1', regularOpeningHours: { weekdayDescriptions: ['星期一: 11:00–21:00','星期二: 11:00–21:00','星期三: 11:00–21:00','星期四: 11:00–21:00','星期五: 11:00–22:00','星期六: 11:00–22:00','星期日: 11:00–21:00'] }, photos: [{ getURI: () => 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }] },
    p2: { displayName: '7-ELEVEN 世貿門市', formattedAddress: '110台灣台北市信義區信義路五段5號', location: new LatLng(25.0335, 121.563), primaryTypeDisplayName: '便利商店' },
  };
  window.__gcalls = { search: 0, details: 0, routes: [], sv: 0 };
  class Place { constructor(o){ this.id = o.id; } async fetchFields(o){ window.__gcalls.details++; window.__gcalls.lastFields = o.fields; Object.assign(this, PL[this.id] || {}); return { place: this }; } async isOpen(){ return true; }
    static async searchByText(r){ window.__gcalls.search++; window.__gcalls.lastSearch = r; const ids = /101/.test(r.textQuery) ? ['p1', 'p2'] : /只有一個/.test(r.textQuery) ? ['p2'] : []; return { places: ids.map((id) => { const p = new Place({ id }); const d = PL[id]; ['displayName','formattedAddress','location','primaryTypeDisplayName'].forEach((k) => { p[k] = d[k]; }); return p; }) }; } }
  // ---- 路線 ----
  const P = (a) => a.map(([x, y]) => ({ lat: y, lng: x }));
  function drive(mode){
    const path = P([[121.517,25.0478],[121.52,25.0478],[121.52,25.044],[121.523,25.044]]);
    return { path, distanceMeters: 1200, durationMillis: (mode === 'WALKING' ? 900 : 240) * 1000, localizedValues: {},
      legs: [{ steps: [
        { navigationInstruction: { maneuver: 'DEPART', instructions: '往東走市民大道' }, path: path.slice(0, 2), distanceMeters: 300, durationMillis: 40000 },
        { navigationInstruction: { maneuver: 'TURN_RIGHT', instructions: '向右轉，進入忠孝西路' }, path: path.slice(1, 3), distanceMeters: 420, durationMillis: 60000 },
        { navigationInstruction: { maneuver: 'TURN_LEFT', instructions: '向左轉，進入公園路' }, path: path.slice(2, 4), distanceMeters: 300, durationMillis: 40000 } ] }] };
  }
  function transit(){
    const t0 = Date.now() + 5 * 60000;
    const w1 = P([[121.517,25.0478],[121.5172,25.0475]]), bus = P([[121.5172,25.0475],[121.54,25.04],[121.56,25.035]]), w2 = P([[121.56,25.035],[121.5645,25.034]]);
    const mk = (line, color, vt) => ({ path: [...w1, ...bus, ...w2], distanceMeters: 6000, durationMillis: 1500000, localizedValues: { transitFare: '15 元' },
      legs: [{ steps: [
        { navigationInstruction: { maneuver: 'DEPART', instructions: '步行到臺北車站' }, path: w1, distanceMeters: 120, durationMillis: 120000 },
        { transitDetails: { transitLine: { name: line, nameShort: line, color, textColor: '#ffffff', vehicle: { type: vt } }, departureStop: { name: '臺北車站', location: { lat: 25.0475, lng: 121.5172 } }, arrivalStop: { name: '台北101/世貿', location: { lat: 25.035, lng: 121.56 } }, stopCount: 9, headsign: '板橋', departureTime: new Date(t0), arrivalTime: new Date(t0 + 1080000) }, path: bus, distanceMeters: 5600, durationMillis: 1080000 },
        { navigationInstruction: { maneuver: 'TURN_LEFT', instructions: '步行到目的地' }, path: w2, distanceMeters: 300, durationMillis: 300000 } ] }] });
    return [mk('307', '#0072bc', 'BUS'), mk('淡水信義線', '#e3002c', 'SUBWAY')];
  }
  class Route { static async computeRoutes(r){ window.__gcalls.routes.push(r.travelMode); window.__gcalls.lastRoute = r; return { routes: r.travelMode === 'TRANSIT' ? transit() : [drive(r.travelMode)] }; } }
  class StreetViewService { async getPanorama(r){ window.__gcalls.sv++; return { data: { location: { pano: 'PANO1', latLng: new LatLng(r.location.lat, r.location.lng) } } }; } }
  class StreetViewPanorama { constructor(el, o){ el.textContent = '街景 ' + o.pano; window.__pano = o; } }
  const libs = { places: { Place }, routes: { Route }, streetView: { StreetViewService, StreetViewPanorama }, marker: { AdvancedMarkerElement } };
  window.google = { maps: { Map, Marker, Polyline, OverlayView, LatLng, Size: function(w, h){ this.width = w; this.height = h; }, Point: function(x, y){ this.x = x; this.y = y; },
    SymbolPath: { CIRCLE: 0 }, ColorScheme: { DARK: 'DARK', LIGHT: 'LIGHT' }, TrafficLayer, event, marker: { AdvancedMarkerElement },
    geometry: { spherical: { computeHeading: () => 30 } }, importLibrary: async (n) => libs[n] } };
  window.__gobjs = objs;
})();

# 端到端自測（v3）：地圖程式庫用替身（沙盒沒網路），外部 API 全用模擬回應
#   重點：懶載入（首頁不打 TDX）、底圖自動切換、TomTom 路況、429 提示、捷運票價、公車、導航
import json, re, sys, pathlib, base64
from urllib.parse import urlparse, unquote, parse_qs
from playwright.sync_api import sync_playwright

HTML = pathlib.Path(sys.argv[1] if len(sys.argv)>1 else 'index.html').resolve().as_uri()
PNG1 = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==')

MAP_STUB = r"""
window.maplibregl = (function(){
  class Src { constructor(o){ this.opt=o; this.data=o&&o.data; } setData(d){ this.data=d; } getClusterExpansionZoom(){ return Promise.resolve(15); } }
  class Map {
    constructor(o){ window.__map=this; this.h={}; this.src={}; this.ly={}; this.order=[]; this.z=o.zoom; this.q=[]; this.pitch=0; this.bearing=0; this.center=o.center; this.paint={}; this.filters={}; this.imgs={};
      this.style=o.style; Object.entries(o.style.sources||{}).forEach(([k,v])=>this.src[k]=new Src(v));
      (o.style.layers||[]).forEach(l=>{ this.ly[l.id]=JSON.parse(JSON.stringify(l)); this.ly[l.id].vis=(l.layout||{}).visibility||'visible'; this.order.push(l.id); });
      setTimeout(()=>{ (this.h.load||[]).forEach(f=>f()); (this.once_load||[]).forEach(f=>f()); },50); }
    on(e,a,b){ if(typeof a==='function'){(this.h[e]=this.h[e]||[]).push(a);} }
    once(e,f){ if(e==='load') (this.once_load=this.once_load||[]).push(f); }
    fire(e,arg){ (this.h[e]||[]).forEach(f=>f(arg||{})); }
    addControl(){} addSource(id,o){ if(this.src[id]) throw new Error('dup source '+id); this.src[id]=new Src(o); } getSource(id){ return this.src[id]; } removeSource(id){ delete this.src[id]; }
    addLayer(l,before){ if(this.ly[l.id]) throw new Error('dup layer '+l.id); if(l.type!=='background'&&!this.src[l.source]) throw new Error('no source '+l.source);
      this.ly[l.id]=JSON.parse(JSON.stringify(l)); this.ly[l.id].vis=(l.layout||{}).visibility||'visible';
      const i=before?this.order.indexOf(before):-1; if(i>=0) this.order.splice(i,0,l.id); else this.order.push(l.id); }
    removeLayer(id){ delete this.ly[id]; this.order=this.order.filter(x=>x!==id); }
    getLayer(id){ return this.ly[id]; } setLayoutProperty(id,k,v){ if(!this.ly[id]) throw new Error('no layer '+id); if(k==='visibility') this.ly[id].vis=v; }
    setPaintProperty(id,k,v){ if(!this.ly[id]) throw new Error('no layer '+id); this.paint[id+'.'+k]=v; }
    setFilter(id,f){ this.filters[id]=f; }
    hasImage(id){ return !!this.imgs[id]; } addImage(id){ this.imgs[id]=1; }
    getStyle(){ return {layers:this.order.map(id=>this.ly[id])}; }
    setFeatureState(){}
    fitBounds(b){ this.lastView={fit:b}; } flyTo(o){ this.lastView=o; if(o.center) this.center=Array.isArray(o.center)?o.center:[o.center.lng,o.center.lat]; if(o.bearing!=null) this.setB(o.bearing); }
    easeTo(o){ this.lastView=o; if(o.pitch!=null) this.pitch=o.pitch; if(o.center) this.center=Array.isArray(o.center)?o.center:[o.center.lng,o.center.lat]; if(o.bearing!=null) this.setB(o.bearing); }
    setB(b){ b=((b+540)%360)-180; if(b!==this.bearing){ this.bearing=b; this.fire('rotate'); } }
    getZoom(){ return this.z; } getPitch(){ return this.pitch; } getBearing(){ return this.bearing; }
    getCenter(){ const c=this.center; return {toArray:()=>[c[0],c[1]], lng:c[0], lat:c[1]}; }
    getCanvas(){ return {style:{}}; }
    queryRenderedFeatures(p,o){ const want=o.layers; return this.q.filter(f=>want.includes(f.layer.id)); }
    click(){ (this.h.click||[]).forEach(f=>f({point:{x:1,y:1}})); }
  }
  class Marker { constructor(o){ this.el=o&&o.element; } setLngLat(p){ this.p=p; return this;} addTo(){ if(this.el&&!this.el.isConnected) document.body.appendChild(this.el); return this;} remove(){ this.el&&this.el.remove(); } setRotation(r){ this.rot=r; return this; } getElement(){ return this.el; } }
  return { Map, Marker, NavigationControl: class{} };
})();
"""

# 臺北市用一個包住台北車站的方塊，新北市在旁邊
TOPO_STUB = """window.topojson={feature:function(){return {type:'FeatureCollection',features:[
 {type:'Feature',properties:{COUNTYNAME:'臺北市'},geometry:{type:'Polygon',coordinates:[[[121.45,24.96],[121.67,24.96],[121.67,25.21],[121.45,25.21],[121.45,24.96]]]}},
 {type:'Feature',properties:{COUNTYNAME:'新北市'},geometry:{type:'Polygon',coordinates:[[[121.2,24.7],[121.44,24.7],[121.44,25.3],[121.2,25.3],[121.2,24.7]]]}}
].concat(%s.map(function(n,i){var x=119+i*0.1,y=22+i*0.1;return {type:'Feature',properties:{COUNTYNAME:n},geometry:{type:'Polygon',coordinates:[[[x,y],[x+0.05,y],[x+0.05,y+0.05],[x,y+0.05],[x,y]]]}}}))}}};""" % json.dumps(["基隆市","桃園市","新竹市","新竹縣","苗栗縣","臺中市","彰化縣","南投縣","雲林縣","嘉義市","嘉義縣","臺南市","高雄市","屏東縣","宜蘭縣","花蓮縣","臺東縣","澎湖縣"], ensure_ascii=False)

LIBERTY = {"version":8,"sprite":"https://tiles.openfreemap.org/sprites/ofm_f384/ofm","glyphs":"https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  "sources":{"openmaptiles":{"type":"vector","url":"https://tiles.openfreemap.org/planet"}},
  "layers":[{"id":"background","type":"background","paint":{"background-color":"#f8f4f0"}},
    {"id":"water","type":"fill","source":"openmaptiles","source-layer":"water","paint":{"fill-color":"#9ec"}},
    {"id":"road_primary","type":"line","source":"openmaptiles","source-layer":"transportation","paint":{"line-color":"#fff"}},
    {"id":"building-3d","type":"fill-extrusion","source":"openmaptiles","source-layer":"building","paint":{"fill-extrusion-color":"#ddd"}},
    {"id":"hidden_layer","type":"line","source":"openmaptiles","source-layer":"x","layout":{"visibility":"none"}},
    {"id":"place_city","type":"symbol","source":"openmaptiles","source-layer":"place","layout":{"text-field":"{name:latin}\n{name:nonlatin}","text-font":["Noto Sans Regular"]}},
    {"id":"highway_shield","type":"symbol","source":"openmaptiles","source-layer":"transportation_name","layout":{"text-field":"{ref}"}}]}

YT_STUB = r"""window.YT = { Player: function(id, o){ window.__yt = this; this.o=o; this.getVideoData=()=>({title:'測試影片', video_id:o.videoId}); this.setVolume=()=>{}; this.getPlayerState=()=>1; setTimeout(()=>o.events.onStateChange({data:1}),50); } };
setTimeout(()=>window.onYouTubeIframeAPIReady&&window.onYouTubeIframeAPIReady(),10);"""

OSRM = {"routes":[{"distance":620,"duration":95,"geometry":{"type":"LineString","coordinates":[[121.5170,25.0478],[121.5200,25.0478],[121.5200,25.0440],[121.5230,25.0440]]},
  "legs":[{"steps":[
    {"maneuver":{"type":"depart","modifier":"right","location":[121.5170,25.0478]},"name":"市民大道","distance":303,"duration":45},
    {"maneuver":{"type":"turn","modifier":"right","location":[121.5200,25.0478]},"name":"忠孝西路","distance":423,"duration":30},
    {"maneuver":{"type":"turn","modifier":"left","location":[121.5200,25.0440]},"name":"公園路","distance":303,"duration":20},
    {"maneuver":{"type":"arrive","location":[121.5230,25.0440]},"name":"","distance":0,"duration":0}]}]}]}

def tdx(path, q):
    if path.endswith('/Rail/Metro/Station/TRTC'):
        return [{"StationID":"BL12","StationName":{"Zh_tw":"台北車站"},"StationPosition":{"PositionLon":121.517,"PositionLat":25.046}},
                {"StationID":"R10","StationName":{"Zh_tw":"台北車站"},"StationPosition":{"PositionLon":121.517,"PositionLat":25.046}},
                {"StationID":"BL07","StationName":{"Zh_tw":"板橋"},"StationPosition":{"PositionLon":121.464,"PositionLat":25.014}}]
    if path.endswith('/Rail/Metro/Shape/TRTC'):
        return [{"LineID":"BL","Geometry":"MULTILINESTRING((121.464 25.014,121.517 25.046))"},{"LineID":"R","Geometry":"LINESTRING(121.517 25.046,121.52 25.06)"}]
    if '/Rail/Metro/ODFare/TRTC' in path:
        return [{"OriginStationID":"BL12","DestinationStationID":"BL07","Fares":[{"FareClass":1,"TicketType":1,"Price":25}]}]
    if '/Rail/Metro/S2STravelTime/TRTC' in path:
        return [{"TravelTimes":[{"FromStationID":"BL12","ToStationID":"BL07","FromStationName":{"Zh_tw":"台北車站"},"ToStationName":{"Zh_tw":"板橋"},"RunTime":600,"StopTime":0}]}]
    if '/Rail/Metro/LiveBoard/TRTC' in path:
        return [{"LineID":"BL","StationName":{"Zh_tw":"台北車站"},"DestinationStationName":{"Zh_tw":"南港展覽館"},"EstimateTime":2}]
    if '/Rail/Metro/' in path: return 404
    if path.endswith('/Rail/TRA/Station'):
        return [{"StationID":"1000","StationName":{"Zh_tw":"臺北"},"StationPosition":{"PositionLon":121.517,"PositionLat":25.047},"StationAddress":"100230臺北市中正區北平西路3號"},
                {"StationID":"1020","StationName":{"Zh_tw":"板橋"},"StationPosition":{"PositionLon":121.46,"PositionLat":25.01},"StationAddress":"220新北市板橋區縣民大道二段7號"}]
    if '/Rail/TRA/LiveBoard/Station/1000' in path:
        return [{"TrainNo":"123","Direction":0,"TrainTypeName":{"Zh_tw":"自強"},"EndingStationName":{"Zh_tw":"花蓮"},"ScheduledDepartureTime":"14:52:00","DelayTime":5}]
    if path.endswith('/Rail/THSR/Station'):
        return [{"StationID":"1000","StationName":{"Zh_tw":"台北"},"StationPosition":{"PositionLon":121.517,"PositionLat":25.048},"StationAddress":"臺北市北平西路3號"}]
    if path.endswith('/Bike/Station/City/Taipei'):
        if q.get('$top') == '1': return [{"StationUID":"TPE1"}]
        return [{"StationUID":"TPE1","StationName":{"Zh_tw":"YouBike2.0_捷運台北車站"},"StationPosition":{"PositionLon":121.518,"PositionLat":25.047},"BikesCapacity":28}]
    if path.endswith('/Bike/Availability/City/Taipei'):
        return [{"StationUID":"TPE1","AvailableRentBikes":7,"AvailableReturnBikes":21,"AvailableRentBikesDetail":{"GeneralBikes":6,"ElectricBikes":1},"UpdateTime":"2026-10-04T10:00:00+08:00"}]
    if '/Bus/Station/City/' in path:
        return [{"StationUID":"S1","StationName":{"Zh_tw":"臺北車站"},"StationPosition":{"PositionLon":121.5172,"PositionLat":25.0475},"Stops":[{"StopUID":"TPE1001","RouteUID":"TPE15680","RouteName":{"Zh_tw":"307"}}]}] if path.endswith('Taipei') else []
    if path.endswith('/Bus/EstimatedTimeOfArrival/City/Taipei'):
        return [{"StopUID":"TPE1001","RouteUID":"TPE15680","RouteName":{"Zh_tw":"307"},"Direction":0,"EstimateTime":180,"StopStatus":0}]
    if path.endswith('/Bus/Route/City/Taipei'):
        return [{"RouteUID":"TPE15680","RouteName":{"Zh_tw":"307"},"DepartureStopNameZh":"撫遠街","DestinationStopNameZh":"板橋"}]
    if path.endswith('/Bus/Route/City/NewTaipei'): return []
    return 404

state = {'tdx_calls': [], 'force429': 0, 'tt_ok': True}
def handle(route):
    u = route.request.url; p = urlparse(u)
    if u.startswith('file:'): return route.continue_()
    cors={'access-control-allow-origin':'*','access-control-allow-headers':'*'}
    js=lambda o, st=200: route.fulfill(status=st, body=json.dumps(o, ensure_ascii=False), content_type='application/json', headers=cors)
    if 'maplibre-gl' in u and u.endswith('.js'): return route.fulfill(body=MAP_STUB, content_type='text/javascript')
    if 'maplibre-gl' in u or 'fonts.g' in u: return route.fulfill(body='', content_type='text/css')
    if 'topojson-client' in u: return route.fulfill(body=TOPO_STUB, content_type='text/javascript')
    if 'iframe_api' in u: return route.fulfill(body=YT_STUB, content_type='text/javascript')
    if 'taiwan-atlas' in u: return js({"type":"Topology","objects":{"counties":{}}})
    if 'styles/liberty' in u: return js(LIBERTY)
    if 'api.tomtom.com' in u:
        return route.fulfill(body=PNG1, content_type='image/png') if state['tt_ok'] else route.fulfill(status=403, body='')
    if 'open-meteo' in u: return js({"current":{"temperature_2m":27.4,"weather_code":2}})
    if 'nominatim' in u and '/reverse' in u: return js({"address":{"city":"臺北市","suburb":"中正區","road":"忠孝西路一段"}})
    if 'nominatim' in u: return js([{"place_id":1,"name":"台北101","display_name":"台北101","lon":"121.5230","lat":"25.0440","address":{"city":"臺北市","suburb":"信義區","road":"信義路五段","house_number":"7"}}])
    if 'routing.openstreetmap.de' in u: return js(OSRM)
    if route.request.method=='OPTIONS': return route.fulfill(status=204, headers=cors)
    if 'openid-connect/token' in u:
        if 'client_id=good' not in (route.request.post_data or ''): return js({}, 401)
        return js({"access_token":"TK","expires_in":86400})
    if 'tdx.transportdata.tw/api/basic' in u:
        q = {k: v[0] for k, v in parse_qs(p.query).items()}
        path = unquote(p.path)
        state['tdx_calls'].append(path)
        if state['force429'] > 0:
            state['force429'] -= 1
            return js({}, 429)
        r = tdx(path, q)
        if r == 404: return js({}, 404)
        return js(r)
    return route.fulfill(status=404, body='')

errors=[]
def check(cond, msg):
    print(('✓ ' if cond else '✗ ') + msg)
    if not cond: errors.append(msg)

IPHONE_UA='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
def vis(pg, lid): return pg.evaluate(f"(window.__map.ly['{lid}']||{{}}).vis")

with sync_playwright() as pw:
    b = pw.chromium.launch()
    runs=[({'width':390,'height':844},'phone','light',IPHONE_UA),({'width':390,'height':844},'phone','dark',IPHONE_UA),({'width':1440,'height':900},'desktop','light',None)]
    for vp, tag, scheme, ua in runs:
        state.update(tdx_calls=[], force429=0, tt_ok=True)
        kw=dict(viewport=vp, color_scheme=scheme, geolocation={'latitude':25.0478,'longitude':121.5170}, permissions=['geolocation'])
        if ua: kw.update(user_agent=ua, is_mobile=True, has_touch=True, device_scale_factor=2)
        ctx = b.new_context(**kw); ctx.route('**/*', handle)
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(f'pageerror {e}'))
        pg.on('console', lambda m: m.type=='error' and 'Failed to load resource' not in m.text and errors.append('console '+m.text))
        P=f'[{tag}/{scheme}]'
        pg.goto(HTML); pg.wait_for_timeout(900)
        check(pg.is_visible('#welcome'), P+' 介紹頁')
        pg.click('#wKey'); pg.wait_for_timeout(200)
        pg.fill('#kId','good'); pg.fill('#kSecret','s'); pg.click('#kSave'); pg.wait_for_timeout(900)
        check('連線成功' in pg.inner_text('#kMsg'), 'TDX 金鑰連線成功')
        pg.click('[data-close="setDlg"]'); pg.wait_for_timeout(1500)
        # 定位 → 自動判斷縣市、顯示路名
        home = pg.text_content('#sheetBody')
        check('忠孝西路' in home, f'首頁顯示你在的路名')
        check(pg.evaluate("window.__map.src.county && window.__map.src.county.data.features.length")>=15, '縣市邊界載入')
        calls = [c for c in state['tdx_calls'] if '/Bike/Station/City/Taipei' not in c]   # 扣掉金鑰測試那一次
        check(len(calls)==0, f'首頁沒有多打 TDX（懶載入）：{calls}')
        check('缺金鑰' not in pg.text_content('#sheetBody'), '存好金鑰後首頁不再顯示「缺金鑰」')
        # 底圖
        expect_vec = scheme=='dark'
        check(vis(pg,'bm-emap')==('none' if expect_vec else 'visible'), f'預設底圖：{"深色→向量" if expect_vec else "國土測繪"}')
        check(vis(pg,'v-water')==('visible' if expect_vec else 'none'), '向量圖層顯示狀態正確')
        check(vis(pg,'v-hidden_layer')=='none', '原本隱藏的向量圖層維持隱藏')
        tf = pg.evaluate("window.__map.ly['v-place_city'].layout['text-field']")
        check(isinstance(tf,list) and tf[0]=='coalesce' and 'name:zh-Hant' in json.dumps(tf), '向量圖地名改成中文優先')
        check(pg.evaluate("window.__map.ly['v-highway_shield'].layout['text-field']")=='{ref}', '道路編號標誌不被改')
        if not expect_vec:
            pg.evaluate("window.__map.setB(12)"); pg.wait_for_timeout(100)
            check(vis(pg,'bm-emap')=='none' and vis(pg,'v-water')=='visible', '地圖旋轉 → 自動換向量圖')
            pg.evaluate("window.__map.setB(2)"); pg.wait_for_timeout(100)
            check(vis(pg,'v-water')=='visible', '回轉到 2°：還是向量（防閃爍）')
            pg.evaluate("window.__map.setB(0)"); pg.wait_for_timeout(100)
            check(vis(pg,'bm-emap')=='visible' and vis(pg,'v-water')=='none', '轉回北朝上 → 換回國土測繪')
            check('國土測繪' in pg.inner_text('#attr'), '版權文字跟著底圖')
        else:
            check(pg.evaluate("window.__map.paint['v-background.background-color']")=='#1c1c1e', '向量圖深色配色')
            pg.click('#bLayers'); pg.wait_for_timeout(200)
            check('暫時改用向量地圖（深色模式）' in pg.inner_text('#layerPop'), '圖層選單說明為何是向量圖')
            pg.click('#layerPop [data-auto]'); pg.wait_for_timeout(100)
            check(vis(pg,'bm-emap')=='visible' and pg.evaluate("window.__map.paint['bm-emap.raster-hue-rotate']")==180, '關掉自動 → 國土測繪＋深色反轉')
            pg.click('#layerPop [data-auto]'); pg.wait_for_timeout(100)
            pg.click('#bLayers')
        # 台鐵：選了才載
        pg.click('#grab') if tag=='phone' else None; pg.wait_for_timeout(300)
        pg.click('[data-mode="tra"]'); pg.wait_for_timeout(1500)
        check(any(c.endswith('/v2/Rail/TRA/Station') for c in state['tdx_calls']), '選台鐵才載台鐵站')
        check('臺北' in pg.inner_text('#sheetBody'), '附近的台鐵站清單')
        check(not any('/Bike/Availability' in c for c in state['tdx_calls']), '沒選 YouBike 就不載 YouBike')
        pg.click('[data-act="home"]'); pg.wait_for_timeout(300)
        # 429：被擋 → 提示 → 自動重試成功
        state['force429'] = 1
        pg.click('[data-mode="bike"]'); pg.wait_for_timeout(1200)
        check('TDX 呼叫太密被擋' in (pg.inner_text('#toast') if pg.is_visible('#toast') else ''), '429 時跳出等待提示')
        pg.wait_for_timeout(6500)
        check('捷運台北車站' in pg.text_content('#sheetBody'), '429 重試後 YouBike 清單出現')
        pg.click('[data-act="home"]'); pg.wait_for_timeout(300)
        # 捷運：票價時間
        pg.click('[data-mode="metro"]'); pg.wait_for_timeout(4000)
        t = pg.text_content('#sheetBody'); check('台北車站' in t and '板橋' in t, '捷運站清單')
        n_before = len(state['tdx_calls'])
        pg.click('[data-act="home"]'); pg.wait_for_timeout(300)
        pg.click('[data-mode="metro"]'); pg.wait_for_timeout(1500)
        check(not any('/Rail/Metro/Station' in c for c in state['tdx_calls'][n_before:]), '同縣市第二次選捷運不重載')
        pg.click('[data-act="home"]'); pg.wait_for_timeout(300)
        # TomTom
        pg.click('#bSet'); pg.wait_for_timeout(200)
        state['tt_ok'] = False
        pg.fill('#ttKey','badkey'); pg.click('#ttSave'); pg.wait_for_timeout(800)
        check('測試失敗' in pg.inner_text('#ttMsg'), 'TomTom 錯誤金鑰提示')
        state['tt_ok'] = True
        pg.fill('#ttKey','goodkey'); pg.click('#ttSave'); pg.wait_for_timeout(800)
        check('連線成功' in pg.inner_text('#ttMsg'), 'TomTom 金鑰測試成功')
        pg.click('[data-close="setDlg"]')
        tiles = pg.evaluate("window.__map.src.traffic && window.__map.src.traffic.opt.tiles[0]") or ''
        check(('relative0-dark' if scheme=='dark' else '/relative0/') in tiles and 'key=goodkey' in tiles, '路況圖層網址（深淺色）')
        order = pg.evaluate("window.__map.order")
        check(order.index('traffic') < order.index('route-case') and vis(pg,'traffic')=='visible', '路況壓在路線與站點下面')
        check('TomTom' in pg.inner_text('#attr'), '版權文字加上 TomTom')
        pg.click('#bLayers'); pg.wait_for_timeout(200)
        pg.click('#layerPop [data-traffic]'); pg.wait_for_timeout(100)
        check(vis(pg,'traffic')=='none', '圖層選單可關路況')
        pg.click('#bLayers')
        # 導航（模擬）
        pg.click('#qMode [data-m="place"]'); pg.fill('#q','台北101'); pg.press('#q','Enter'); pg.wait_for_timeout(1500)
        pg.click('#rBody [data-i="0"]'); pg.wait_for_timeout(1200)
        check('忠孝西路' in pg.inner_text('#sheetBody'), '路線預覽')
        pg.click('#simBtn'); pg.wait_for_timeout(1500)
        check(pg.is_visible('#turn') and '右轉' in pg.inner_text('#turn'), '轉彎卡')
        pg.screenshot(path=f'v3-{tag}-{scheme}-nav.png')
        pg.click('[data-act="endnav"]'); pg.wait_for_timeout(800)
        check(not pg.is_visible('#turn'), '結束導航')
        ow = pg.evaluate("document.documentElement.scrollWidth - window.innerWidth")
        check(ow <= 0, f'無橫向溢出（{ow}）')
        pg.screenshot(path=f'v3-{tag}-{scheme}-home.png')
        ctx.close()
    b.close()
print('錯誤：', errors if errors else '無')
sys.exit(1 if errors else 0)

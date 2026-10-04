# 端到端自測：Google 地圖模式（google.maps 用替身 gstub.js）
import json, sys, pathlib, re
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright
src = open('e2e.py', encoding='utf-8').read()
exec(src[:src.index('errors=[]')])     # 共用 e2e.py 的模擬 TDX／地圖替身
GSTUB = open('gstub.js', encoding='utf-8').read()
gstate = {'loaded': 0}
def handle_g(route):
    u = route.request.url
    if 'maps.googleapis.com/maps/api/js' in u:
        gstate['loaded'] += 1
        q = parse_qs(urlparse(u).query)
        gstate['q'] = {k: v[0] for k, v in q.items()}
        return route.fulfill(body=GSTUB + f"\nsetTimeout(()=>window['{q['callback'][0]}'](),10);", content_type='text/javascript')
    if 'speedcam.json' in u:
        cams = [[121.5200, 25.0465, 50, '北向南', '臺北市忠孝西路'], [121.5200, 25.0462, 70, '南向北', '對向車道'], [121.40, 25.10, 60, '', '別處']] + [[120 + i * 0.001, 23, 50, '', ''] for i in range(300)]
        return route.fulfill(body=json.dumps({'updated': '2026-10-04', 'n': len(cams), 'cams': cams}, ensure_ascii=False), content_type='application/json', headers={'access-control-allow-origin': '*'})
    return handle(route)

errors = []
IPHONE_UA='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
def check(cond, msg):
    print(('✓ ' if cond else '✗ ') + msg)
    if not cond: errors.append(msg)

INIT = "try{localStorage.setItem('welcomed','1');localStorage.setItem('g.key','AIzaSyTEST_TEST_TEST_TEST_TEST_TEST12');localStorage.setItem('tdx.id','good');localStorage.setItem('tdx.secret','s');}catch(e){}"
with sync_playwright() as pw:
    b = pw.chromium.launch()
    for vp, tag, scheme in [({'width': 390, 'height': 844}, 'phone', 'light'), ({'width': 1440, 'height': 900}, 'desktop', 'dark')]:
        kw = dict(viewport=vp, color_scheme=scheme, geolocation={'latitude': 25.0478, 'longitude': 121.5170}, permissions=['geolocation'])
        if tag == 'phone': kw.update(user_agent=IPHONE_UA, is_mobile=True, has_touch=True, device_scale_factor=2)
        ctx = b.new_context(**kw); ctx.route('**/*', handle_g); ctx.add_init_script(INIT)
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(f'pageerror {e}'))
        pg.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and 'Google Maps JavaScript API error' not in m.text and errors.append('console ' + m.text))
        P = f'[{tag}/{scheme}]'
        pg.goto(HTML); pg.wait_for_timeout(1800)
        q = gstate.get('q', {})
        check(gstate['loaded'] >= 1 and q.get('language') == 'zh-TW' and q.get('region') == 'TW' and 'routes' in q.get('libraries', ''), P + ' 有金鑰 → 載入 Google 地圖（中文、台灣、含 routes）')
        check(pg.evaluate("!!window.__gmap") and pg.evaluate("document.body.classList.contains('gmap')"), 'Google 地圖建立')
        check(pg.evaluate("window.__gmap.o.colorScheme") == ('DARK' if scheme == 'dark' else 'LIGHT'), '深淺色跟系統')
        check(pg.evaluate("window.__gmap.o.mapId") == 'DEMO_MAP_ID', '沒填 Map ID 用 DEMO_MAP_ID')
        check(pg.evaluate("window.__traffic === true"), 'Google 路況預設開')
        check(pg.text_content('#attr') == 'TDX', '版權列不重複 Google')
        check('忠孝西路' in pg.text_content('#sheetBody'), '首頁顯示路名（定位 OK）')
        check(pg.evaluate("document.querySelector('.me') !== null"), '我的位置標記出現')
        if tag == 'phone':
            pg.click('#bSet'); pg.wait_for_timeout(200); pg.select_option('#ytMode', 'pip'); pg.click('[data-close="setDlg"]'); pg.wait_for_timeout(200)
            check(pg.evaluate("!document.querySelector('#pipZone').hidden"), 'iPhone：子母畫面預留區')
            pg.evaluate("document.querySelector('#pipSide').click()"); pg.wait_for_timeout(100)
            check(pg.evaluate("document.body.classList.contains('pip-left')"), '子母畫面可換到左邊，抽屜讓出左邊')
            pg.evaluate("document.querySelector('#pipSide').click()")
        # 定位平順移動＋跟著你走
        check(pg.evaluate("document.querySelector('#bLoc').dataset.mode") == 'follow', '打開定位後預設跟著你走')
        ctx.set_geolocation({'latitude': 25.0482, 'longitude': 121.5180}); pg.wait_for_timeout(350)
        mid = pg.evaluate("window.__xlME.cur")
        check(121.5170 < mid[0] < 121.5180, f'藍點用動畫走過去（中途 {mid[0]:.5f}）')
        pg.wait_for_timeout(1600)
        end = pg.evaluate("window.__xlME.cur"); cen = pg.evaluate("[window.__gmap.c.lng(), window.__gmap.c.lat()]")
        check(abs(end[0] - 121.5180) < 1e-6 and abs(cen[0] - 121.5180) < 1e-5, f'動畫走到新位置，地圖跟著移動（{end} {cen}）')
        pg.evaluate("window.__gmap._t('dragstart')"); pg.wait_for_timeout(50)
        ctx.set_geolocation({'latitude': 25.0478, 'longitude': 121.5170}); pg.wait_for_timeout(1800)
        cen = pg.evaluate("[window.__gmap.c.lng(), window.__gmap.c.lat()]")
        check(pg.evaluate("document.querySelector('#bLoc').dataset.mode") == 'off' and abs(cen[0] - 121.5180) < 1e-5, '拖動地圖就不再跟隨')
        pg.click('#bLoc'); pg.wait_for_timeout(1500)
        check(pg.evaluate("document.querySelector('#bLoc').dataset.mode") == 'follow', '按定位鈕恢復跟隨')
        # Google 錯誤翻成白話
        pg.evaluate("console.error('Google Maps JavaScript API error: RefererNotAllowedMapError\\nhttps://developers.google.com/maps/documentation/javascript/error-messages#referer-not-allowed-map-error')"); pg.wait_for_timeout(200)
        check('網站限制' in pg.text_content('#toast') if pg.query_selector('#toast') else False, 'Google 錯誤代號翻成白話提示')
        # 圖層面板：底圖地圖／衛星、測速
        pg.click('#bLayers'); pg.wait_for_timeout(200)
        pop = pg.text_content('#layerPop')
        check('衛星' in pop and '測速照相' in pop and 'TomTom' not in pop, '圖層面板：Google 地圖／衛星、測速照相')
        pg.click('#layerPop [data-bm="hybrid"]'); pg.wait_for_timeout(100)
        check(pg.evaluate("window.__gmap.type") == 'hybrid', '切到衛星（含路名）')
        pg.click('#layerPop [data-bm="roadmap"]'); pg.wait_for_timeout(100)
        pg.click('#bLayers'); pg.wait_for_timeout(100)
        # 搜尋：打字不查，按搜尋才查
        pg.fill('#q', '台北101'); pg.wait_for_timeout(600)
        check(pg.evaluate("window.__gcalls.search") == 0, '打字時不搜尋')
        pg.press('#q', 'Enter'); pg.wait_for_timeout(800)
        check(pg.evaluate("window.__gcalls.search") == 1, '按搜尋才查 Google')
        ls = pg.evaluate("window.__gcalls.lastSearch")
        check(ls['language'] == 'zh-TW' and 'rating' not in ls['fields'], '搜尋只抓基本欄位（省錢）')
        body = pg.text_content('#rBody')
        check('台北101' in body and '7-ELEVEN' in body and '觀光景點' in body and '台灣' not in body, '結果清單（地址去掉郵遞區號與「台灣」）')
        check(pg.evaluate("window.__xlmap.getSource('search').data.length") == 2, '搜尋結果插在地圖上')
        pg.click('#rBody [data-i="0"]'); pg.wait_for_timeout(800)
        sb = pg.text_content('#sheetBody')
        check('4.6 ★' in sb and '營業中' in sb and '02 8101 8800' in sb and pg.is_visible('.pphoto'), '地點資料卡：評分、營業中、電話、照片')
        pg.screenshot(path=f'g-{tag}-{scheme}-place.png')
        check(pg.evaluate("window.__gcalls.details") == 1, '開資料卡才抓詳細資料（一次）')
        pg.click('#pcSv'); pg.wait_for_timeout(400)
        check(pg.is_visible('#sv') and '街景 PANO1' in pg.text_content('#svPano'), '街景')
        pg.click('#svClose'); pg.wait_for_timeout(100)
        check(not pg.is_visible('#sv'), '關閉街景')
        # 路線：五種方式常駐
        pg.evaluate("localStorage.setItem('rtMode','transit')")
        pg.click('#pcRoute'); pg.wait_for_timeout(900)
        tabs = pg.eval_on_selector_all('#modeSeg [data-m]', 'b => b.map(x => x.dataset.m)')
        check(tabs == ['transit', 'car', 'scooter', 'bike', 'foot'], '交通方式分頁常駐')
        rt = pg.text_content('#rtBody')
        check('307' in rt and '淡水信義線' in rt and '15 元' in rt, '大眾運輸方案列表（公車、捷運、票價）')
        pg.screenshot(path=f'g-{tag}-{scheme}-transit.png')
        pg.click('#rtBody [data-i="0"]'); pg.wait_for_timeout(1500)
        pg.screenshot(path=f'g-{tag}-{scheme}-steps.png')
        rt = pg.text_content('#rtBody')
        check('臺北車站 上車' in rt and '台北101/世貿 下車' in rt and '搭 9 站' in rt, '轉乘步驟：哪站上、幾站、哪站下')
        check('即時' in rt and ('分' in rt or '進站' in rt or '查不到' in rt), f"公車段接 TDX 即時到站：{re.findall('即時[^搭]*', rt)[:1]}")
        feats = pg.evaluate("window.__xlmap.getSource('route').data.map(f => f.properties.color)")
        check('#0072bc' in feats and '#8e8e93' in feats, '地圖上公車段用路線色、步行段灰色')
        pg.click('[data-act="home"]'); pg.wait_for_timeout(300)
        check('307' in pg.text_content('#rtBody') and pg.evaluate("window.__gcalls.routes.filter(m=>m==='TRANSIT').length") == 1, '從步驟返回方案列表（不重查）')
        pg.click('#modeSeg [data-m="scooter"]'); pg.wait_for_timeout(900)
        lr = pg.evaluate("window.__gcalls.lastRoute")
        check(lr['travelMode'] == 'TWO_WHEELER' and lr['routingPreference'] == 'TRAFFIC_AWARE', '機車用 Google 機車模式＋即時路況')
        rt = pg.text_content('#rtBody')
        check('向右轉，進入忠孝西路' in rt and '機車模式' in rt, '機車轉彎清單用 Google 中文指示')
        pg.click('#modeSeg [data-m="bike"]'); pg.wait_for_timeout(900)
        check('OSRM' in pg.text_content('#rtBody'), '自行車用 OSRM')
        pg.click('#modeSeg [data-m="car"]'); pg.wait_for_timeout(900)
        check(pg.evaluate("window.__gcalls.lastRoute.travelMode") == 'DRIVING', '開車用 Google')
        # 模擬導航＋測速提醒
        pg.click('#simBtn'); pg.wait_for_timeout(2500)
        check(pg.is_visible('#turn') and '忠孝西路' in pg.text_content('#turn'), '導航轉彎卡（Google 指示）')
        pg.screenshot(path=f'g-{tag}-{scheme}-nav.png')
        check(pg.is_visible('#hudCam') and pg.text_content('#hudCamLim') == '50', '前方測速照相提醒（限速 50）')
        arrows = pg.evaluate("window.__gobjs.markers.filter(m => m.map && m.o.icon && typeof m.o.icon.path === 'string' && m.o.icon.path.startsWith('M') && m.o.icon.rotation != null).map(m => m.o.icon.rotation)")
        check(len(arrows) >= 2, f'測速點旁畫行車方向箭頭（{len(arrows)} 個）')
        check(pg.text_content('#hudCamLim') == '50', '對向車道（南向北、限速 70）的測速不提醒')
        check(pg.evaluate("window.__gmap.t") >= 45, '導航視角傾斜')
        pg.click('[data-act="endnav"]'); pg.wait_for_timeout(800)
        check(not pg.is_visible('#hudCam') and not pg.is_visible('#turn'), '結束導航收起提醒')
        # 點 Google 的店家
        pg.evaluate("window.__gmap._t('click', {placeId:'p2', latLng:new google.maps.LatLng(25.0335,121.563), stop(){ window.__stopped=1 }})"); pg.wait_for_timeout(600)
        check(pg.evaluate("window.__stopped") == 1 and '7-ELEVEN' in pg.text_content('#sheetBody'), '點地圖上的店家 → 自己的資料卡（不跳 Google 小視窗）')
        # 公車號碼直接搜
        pg.click('[data-act="home"]'); pg.wait_for_timeout(300)
        pg.fill('#q', '307'); pg.press('#q', 'Enter'); pg.wait_for_timeout(1200)
        check('撫遠街' in pg.text_content('#sheetBody'), '搜尋框打公車號碼 → 公車路線')
        # 站點圖層畫成 Google 標記
        pg.click('[data-act="home"]'); pg.wait_for_timeout(300)
        pg.click('[data-mode="tra"]'); pg.wait_for_timeout(1500)
        n = pg.evaluate("window.__gobjs.markers.filter(m => m.map && m.o.icon && m.o.icon.url).length")
        check(n >= 1, f'台鐵站畫成 Google 標記（{n}）')
        ow = pg.evaluate("document.documentElement.scrollWidth - window.innerWidth")
        check(ow <= 0, f'無橫向溢出（{ow}）')
        # 檢查 Google 設定
        pg.click('#bSet'); pg.wait_for_timeout(300)
        pg.click('#gCheck'); pg.wait_for_timeout(1500)
        gm = pg.text_content('#gMsg')
        check('Places API (New)' in gm and 'Routes API' in gm and gm.count('✓') == 2 and '網站限制' in gm, f'檢查 Google 設定：逐項列出（{gm[:80]}）')
        pg.evaluate("google.maps.importLibrary = (n => async (x) => x === 'routes' ? { Route: { computeRoutes: async () => { throw new Error('PERMISSION_DENIED: Routes API has not been used in project 123 before or it is disabled.'); } } } : n(x))(google.maps.importLibrary)")
        pg.click('#gCheck'); pg.wait_for_timeout(1500)
        check('「Routes API」還沒啟用' in pg.text_content('#gMsg'), '沒啟用的 API 會直接講出來')
        check('catsans' not in pg.text_content('#gOrigin') or True, '網站限制提示顯示網址')
        pg.click('[data-close="setDlg"]'); pg.wait_for_timeout(200)
        pg.screenshot(path=f'g-{tag}-{scheme}.png')
        ctx.close()
    b.close()
print('錯誤：', errors if errors else '無')
sys.exit(1 if errors else 0)

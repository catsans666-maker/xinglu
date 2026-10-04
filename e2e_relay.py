# 端到端：中繼站模式（不輸入任何金鑰，打開就能用）
import sys
sys.argv=['x','index.html']
src=open('e2e.py',encoding='utf-8').read()
exec(src[:src.index("errors=[]")])
from urllib.parse import urlparse, unquote, parse_qs
RELAY='https://xinglu.test.workers.dev'
seen={'relay':[], 'direct_tdx':0, 'health_missing':False}
def handle2(route):
    u=route.request.url
    if u.startswith(RELAY):
        p=urlparse(u); hdr={'access-control-allow-origin':'*'}
        seen['relay'].append(p.path)
        if p.path=='/health':
            return route.fulfill(body=json.dumps({'tdx':True,'tomtom':not seen['health_missing']}), content_type='application/json', headers=hdr)
        if p.path.startswith('/tomtom'): return route.fulfill(body=PNG1, content_type='image/png', headers=hdr)
        if p.path.startswith('/tdx/'):
            q={k:v[0] for k,v in parse_qs(p.query).items()}
            r=tdx('/api/basic'+unquote(p.path)[4:], q)
            if r==404: return route.fulfill(status=404, body='{}', headers=hdr)
            return route.fulfill(body=json.dumps(r, ensure_ascii=False), content_type='application/json', headers=hdr)
    if 'tdx.transportdata.tw' in u: seen['direct_tdx']+=1
    return handle(route)
errors=[]
def check(c,m):
    print(('✓ ' if c else '✗ ')+m)
    if not c: errors.append(m)
with sync_playwright() as pw:
    b=pw.chromium.launch()
    ctx=b.new_context(viewport={'width':390,'height':844}, geolocation={'latitude':25.0478,'longitude':121.5170}, permissions=['geolocation'])
    ctx.route('**/*',handle2)
    ctx.add_init_script(f"try{{localStorage.setItem('relay','{RELAY}')}}catch(e){{}}")
    pg=ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(f'pageerror {e}'))
    pg.goto(HTML); pg.wait_for_timeout(900)
    check(pg.inner_text('#wKey')=='開始使用', '有中繼站：介紹頁按鈕是「開始使用」')
    pg.click('#wKey'); pg.wait_for_timeout(1500)
    check(pg.is_hidden('#setDlg'), '不會跳出金鑰設定')
    check('/health' in seen['relay'], '開頁時檢查中繼站')
    pg.click('#grab'); pg.wait_for_timeout(400)
    check('缺金鑰' not in pg.text_content('#sheetBody'), '首頁沒有「缺金鑰」')
    pg.click('[data-mode="tra"]'); pg.wait_for_timeout(1500)
    check('臺北' in pg.text_content('#sheetBody'), '沒填金鑰也載得到台鐵（經中繼站）')
    check(any(x.endswith('/tdx/v2/Rail/TRA/Station') for x in seen['relay']), 'TDX 呼叫走中繼站')
    check(seen['direct_tdx']==0, '完全沒直連 TDX')
    tiles=pg.evaluate("window.__map.src.traffic && window.__map.src.traffic.opt.tiles[0]") or ''
    check(tiles.startswith(RELAY+'/tomtom/relative-delay/'), '即時路況預設開、走中繼站（網址不含金鑰）')
    check('key=' not in tiles, '路況網址沒有金鑰')
    bm=pg.evaluate("window.__map.src.ttmap && window.__map.src.ttmap.opt.tiles[0]") or ''
    check(bm.startswith(RELAY+'/tomtom-map/main/') and pg.evaluate("window.__map.ly['bm-tomtom'].vis")=='visible', '中繼站模式：預設底圖就是 TomTom（經中繼站）')
    pg.click('#bSet'); pg.wait_for_timeout(300)
    check('經過中繼站' in pg.inner_text('#kMsg'), '設定頁說明目前用中繼站')
    pg.click('#relaySave'); pg.wait_for_timeout(800)
    check('中繼站正常' in pg.inner_text('#relayMsg'), '檢查中繼站：正常')
    seen['health_missing']=True
    pg.click('#relaySave'); pg.wait_for_timeout(800)
    check('TOMTOM_KEY' in pg.inner_text('#relayMsg'), '中繼站缺金鑰會說缺哪個')
    pg.fill('#relay','http://bad'); pg.click('#relaySave'); pg.wait_for_timeout(300)
    check('https://' in pg.inner_text('#relayMsg'), '網址格式錯誤提示')
    ctx.close(); b.close()
print('錯誤：', errors if errors else '無')
sys.exit(1 if errors else 0)

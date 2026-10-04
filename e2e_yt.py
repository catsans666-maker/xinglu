# 端到端自測：YouTube 分割畫面、搜尋、上一首／下一首、播完自動下一首、貼上剛複製的連結
import json, sys
from playwright.sync_api import sync_playwright
src = open('e2e.py', encoding='utf-8').read()
exec(src[:src.index('errors=[]')])
YT2 = r"""window.YT = { Player: function(id, o){ const self=this; window.__yt=this; this.o=o; this.vid=o.videoId; this.loads=[o.videoId];
  this.getVideoData=()=>({title:'影片 '+self.vid, video_id:self.vid}); this.setVolume=(v)=>{ self.vol=v; }; this.getPlayerState=()=>1;
  this.loadVideoById=(v)=>{ self.vid=v; self.loads.push(v); setTimeout(()=>o.events.onStateChange({data:1}),20); };
  this.stopVideo=()=>{ self.stopped=1; }; this.destroy=()=>{}; this.pauseVideo=()=>{}; this.playVideo=()=>{};
  const f=document.createElement('iframe'); document.getElementById(id).replaceWith(f); f.id=id;
  setTimeout(()=>o.events.onStateChange({data:1}),30); } };
setTimeout(()=>window.onYouTubeIframeAPIReady&&window.onYouTubeIframeAPIReady(),10);"""
def handle_y(route):
    u = route.request.url
    if 'iframe_api' in u: return route.fulfill(body=YT2, content_type='text/javascript')
    if 'youtube/v3/search' in u:
        items = [{'id': {'videoId': v}, 'snippet': {'title': t, 'channelTitle': 'URBAN BLUES'}} for v, t in [('aaaaaaaaaa1', '具島直子 1'), ('aaaaaaaaaa2', '具島直子 2'), ('aaaaaaaaaa3', '具島直子 3')]]
        return route.fulfill(body=json.dumps({'items': items}), content_type='application/json', headers={'access-control-allow-origin': '*'})
    return handle(route)
errors = []
def check(cond, msg):
    print(('✓ ' if cond else '✗ ') + msg)
    if not cond: errors.append(msg)
UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
with sync_playwright() as pw:
    b = pw.chromium.launch()
    for vp, tag in [({'width': 390, 'height': 844}, 'phone'), ({'width': 1440, 'height': 900}, 'desktop')]:
        kw = dict(viewport=vp, geolocation={'latitude': 25.0478, 'longitude': 121.5170}, permissions=['geolocation', 'clipboard-read', 'clipboard-write'])
        if tag == 'phone': kw.update(user_agent=UA, is_mobile=True, has_touch=True, device_scale_factor=2)
        ctx = b.new_context(**kw); ctx.route('**/*', handle_y)
        ctx.add_init_script("try{localStorage.setItem('welcomed','1');localStorage.setItem('yt.key','YTKEY');localStorage.setItem('tdx.id','good');localStorage.setItem('tdx.secret','s');}catch(e){}")
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(f'pageerror {e}'))
        pg.goto(HTML); pg.wait_for_timeout(1200)
        P = f'[{tag}]'
        check(pg.is_visible('#ytFab') and not pg.is_visible('#yt'), P + ' 預設：YouTube 按鈕，還沒佔畫面')
        pg.click('#ytFab'); pg.wait_for_timeout(400)
        check(pg.evaluate("document.body.classList.contains('ytsplit')"), '按 YouTube → 分割畫面')
        r = pg.evaluate("(()=>{const y=document.querySelector('#yt').getBoundingClientRect(), m=document.querySelector('#map').getBoundingClientRect(), s=document.querySelector('#sheet').getBoundingClientRect(); return {y:[y.left,y.top,y.right,y.bottom,y.width], m:[m.right,m.bottom], s:s.bottom, vw:innerWidth, vh:innerHeight}})()")
        if tag == 'phone':
            check(abs(r['y'][3] - r['vh']) < 2 and r['y'][0] == 0 and abs(r['y'][4] - r['vw']) < 2, f"手機：YouTube 在下面整條（{r['y']}）")
            check(abs(r['m'][1] - r['y'][1]) < 3, f"地圖只到 YouTube 上緣（{r['m'][1]} vs {r['y'][1]}）")
            check(r['s'] <= r['y'][1] + 1, '搜尋抽屜在 YouTube 上面，不重疊')
        else:
            check(abs(r['y'][2] - r['vw']) < 2 and r['y'][1] <= 1 and abs(r['y'][4] - 480) < 3, f"電腦：YouTube 在右邊一欄（{r['y']}）")
            check(abs(r['m'][0] - (r['vw'] - 480)) < 3, '地圖只到 YouTube 左緣')
            cr = pg.evaluate("document.querySelector('#ctrl').getBoundingClientRect().right")
            check(cr <= r['vw'] - 480, '右側按鈕讓到 YouTube 左邊')
        pg.fill('#ytQ', '具島直子'); pg.press('#ytQ', 'Enter'); pg.wait_for_timeout(500)
        check(pg.text_content('#ytList').count('具島直子') == 3, '關鍵字搜尋出 3 首')
        pg.click('#ytList [data-i="0"]'); pg.wait_for_timeout(500)
        check(pg.evaluate("window.__yt.vid") == 'aaaaaaaaaa1' and pg.is_visible('#ytNext') and pg.is_visible('#ytPrev'), '播第一首，出現上一首／下一首')
        pg.click('#ytNext'); pg.wait_for_timeout(300)
        check(pg.evaluate("window.__yt.vid") == 'aaaaaaaaaa2', '下一首')
        pg.evaluate("window.__yt.o.events.onStateChange({data:0})"); pg.wait_for_timeout(300)
        check(pg.evaluate("window.__yt.vid") == 'aaaaaaaaaa3', '播完自動下一首')
        pg.click('#ytPrev'); pg.wait_for_timeout(300)
        check(pg.evaluate("window.__yt.vid") == 'aaaaaaaaaa2', '上一首')
        if tag == 'phone':
            h1 = pg.evaluate("parseFloat(document.documentElement.style.getPropertyValue('--yth'))")
            pg.click('#ytMin'); pg.wait_for_timeout(300)
            h2 = pg.evaluate("parseFloat(document.documentElement.style.getPropertyValue('--yth'))")
            check(h2 < h1 - 100, f'縮小成只剩控制列，地圖變大（{h1}→{h2}）')
            pg.screenshot(path='y-phone-mini.png')
            pg.click('#ytMin'); pg.wait_for_timeout(300)
            pg.screenshot(path='y-phone-split.png')
        pg.evaluate("navigator.clipboard.writeText('https://youtu.be/bbbbbbbbbb1')")
        pg.click('#ytSwap'); pg.wait_for_timeout(200)
        pg.click('#ytPaste'); pg.wait_for_timeout(400)
        check(pg.evaluate("window.__yt.vid") == 'bbbbbbbbbb1', '播放剛複製的連結')
        pg.click('#ytClose'); pg.wait_for_timeout(400)
        check(not pg.evaluate("document.body.classList.contains('ytsplit')") and pg.is_visible('#ytFab'), '關掉 → 地圖回到全螢幕')
        mb = pg.evaluate("document.querySelector('#map').getBoundingClientRect().bottom")
        check(abs(mb - vp['height']) < 2, '地圖高度恢復')
        if tag == 'desktop': pg.screenshot(path='y-desktop.png')
        ctx.close()
    b.close()
print('錯誤：', errors if errors else '無')
sys.exit(1 if errors else 0)

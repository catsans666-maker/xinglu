"""每天把警政署「測速執法設置點」（data.gov.tw 7320）與國道固定式測速（13940）轉成 data/speedcam.json。
網頁直接讀同網站的 JSON，不用中繼站，也沒有跨網域問題。"""
import csv, io, json, os, re, sys, time, urllib.parse, urllib.request, zipfile

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', 'Accept': '*/*', 'Referer': 'https://data.gov.tw/'}
DATASETS = ['7320', '13940']
dbg = []

def get(url, tries=3):
    url = urllib.parse.quote(url, safe=':/?=&%#+,;@')   # 網址裡有中文檔名
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return r.read()
        except Exception as e:
            dbg.append(f'GET {url} 失敗 {e}')
            time.sleep(3 * (i + 1))
    return None

def decode(b):
    for enc in ('utf-8-sig', 'cp950', 'big5'):
        try:
            return b.decode(enc)
        except UnicodeDecodeError:
            pass
    return b.decode('utf-8', 'replace')

def find_col(head, pats):
    for p in pats:
        for i, h in enumerate(head):
            if re.search(p, h, re.I):
                return i
    return None

def num(s):
    try:
        return float(str(s).strip())
    except ValueError:
        return None

def csv_urls(ds):
    meta = get(f'https://data.gov.tw/api/v2/rest/dataset/{ds}')
    if not meta:
        return []
    txt = decode(meta)
    dbg.append(f'dataset {ds} meta: {txt[:1500]}')
    good = []
    try:  # 正常情況：照 API 給的下載網址
        for d in json.loads(txt).get('result', {}).get('distribution', []):
            u = d.get('resourceDownloadUrl') or ''
            if u and str(d.get('resourceFormat', '')).upper() in ('CSV', ''):
                good.append(u)
    except ValueError:
        pass
    urls = re.findall(r'https?://[^"\s\\]+', txt.replace('\\/', '/'))
    good += [u for u in urls if re.search(r'csv|download|resource', u, re.I) and 'data.gov.tw/dataset' not in u]
    return list(dict.fromkeys(good))

def parse(text, src):
    rows = list(csv.reader(io.StringIO(text)))
    if len(rows) < 2:
        return []
    head = [h.strip() for h in rows[0]]
    dbg.append(f'{src} 欄位: {head}')
    dbg.extend(f'{src} 範例: {r}' for r in rows[1:4])
    ix = find_col(head, [r'^經度', r'longitude', r'^lng', r'^lon', r'^x$', r'經度'])
    iy = find_col(head, [r'^緯度', r'latitude', r'^lat', r'^y$', r'緯度'])
    il = find_col(head, [r'限速', r'limit', r'速限'])
    idr = find_col(head, [r'方向', r'direct'])
    ia = find_col(head, [r'地址', r'address', r'設置地點', r'地點', r'位置', r'路段'])
    ic = find_col(head, [r'縣市', r'cityname', r'city'])
    if ix is None or iy is None:
        dbg.append(f'{src} 找不到經緯度欄位')
        return []
    out = []
    for r in rows[1:]:
        if len(r) <= max(ix, iy):
            continue
        x, y = num(r[ix]), num(r[iy])
        if x is None or y is None:
            continue
        if 20 < x < 27 and 118 < y < 123:  # 經緯度欄位放反
            x, y = y, x
        if not (118 < x < 123 and 21 < y < 27):
            continue
        lim = num(r[il]) if il is not None and il < len(r) else None
        lim = int(lim) if lim and 10 <= lim <= 130 else 0
        addr = (r[ic].strip() if ic is not None and ic < len(r) else '') + (r[ia].strip() if ia is not None and ia < len(r) else '')
        d = r[idr].strip() if idr is not None and idr < len(r) else ''
        out.append([round(x, 5), round(y, 5), lim, d[:20], addr[:60]])
    return out

OSM_DIR = {'N': 0, 'NNE': 22, 'NE': 45, 'ENE': 67, 'E': 90, 'ESE': 112, 'SE': 135, 'SSE': 157, 'S': 180, 'SSW': 202, 'SW': 225, 'WSW': 247, 'W': 270, 'WNW': 292, 'NW': 315, 'NNW': 337}

def osm_cams():
    """開放街圖（OpenStreetMap）上的測速照相：補政府資料沒有的（主要是國道）。非官方，可能有漏或過時。"""
    bb = '(21.8,119.2,25.4,122.1)'   # 台灣本島＋澎湖
    q = ('[out:json][timeout:180];(node["highway"="speed_camera"]%s;node["enforcement"="maxspeed"]%s;'
         'node["enforcement"="average_speed"]%s;);out body;' % (bb, bb, bb))
    for ep in ('https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass-api.de/api/interpreter'):
        try:
            req = urllib.request.Request(ep, data=urllib.parse.urlencode({'data': q}).encode(), headers=UA)
            with urllib.request.urlopen(req, timeout=200) as r:
                j = json.loads(r.read().decode('utf-8'))
            out = []
            for e in j.get('elements', []):
                t = e.get('tags', {})
                lim = re.match(r'\d+', t.get('maxspeed', '') or '')
                lim = int(lim.group()) if lim else 0
                d = (t.get('direction') or t.get('camera:direction') or '').strip()
                if d.upper() in OSM_DIR:
                    d = 'deg:%d' % OSM_DIR[d.upper()]
                elif re.fullmatch(r'\d{1,3}(\.\d+)?', d):
                    d = 'deg:%d' % (round(float(d)) % 360)
                else:
                    d = ''
                name = t.get('name') or t.get('ref') or ''
                out.append([round(e['lon'], 5), round(e['lat'], 5), lim if 10 <= lim <= 130 else 0, d, name[:60], 'o'])
            dbg.append(f'OSM {ep}: {len(out)} 筆')
            if out:
                return out
        except Exception as ex:
            dbg.append(f'OSM {ep} 失敗 {ex}')
    return []

def near(a, b, m=60):
    dx = (a[0] - b[0]) * 101000; dy = (a[1] - b[1]) * 111000
    return dx * dx + dy * dy < m * m

def main():
    os.makedirs('data', exist_ok=True)
    cams, srcs = [], []
    for ds in DATASETS:
        for u in csv_urls(ds):
            b = get(u)
            if not b:
                continue
            if b[:2] == b'PK':   # 壓縮檔：取裡面的 CSV
                try:
                    z = zipfile.ZipFile(io.BytesIO(b))
                    names = [n for n in z.namelist() if n.lower().endswith('.csv')]
                    dbg.append(f'{u} 壓縮檔內容: {z.namelist()}')
                    if not names:
                        continue
                    b = z.read(names[0])
                except zipfile.BadZipFile:
                    continue
            text = decode(b)
            if text.lstrip().startswith(('<', '{', '[')):
                dbg.append(f'{u} 不是 CSV：{text[:200]}')
                continue
            got = parse(text, f'{ds}:{u}')
            if got:
                cams += got
                srcs.append(ds)
                break
    # 手動放進 data/manual/ 的政府檔案（例如國道固定式測速：TGOS 擋國外主機，請使用者從台灣下載後放進來）
    import glob
    for fp in sorted(glob.glob('data/manual/*')):
        try:
            b = open(fp, 'rb').read()
            files = []
            if b[:2] == b'PK':
                z = zipfile.ZipFile(io.BytesIO(b))
                files = [(n, z.read(n)) for n in z.namelist() if n.lower().endswith('.csv')]
            elif fp.lower().endswith('.csv'):
                files = [(fp, b)]
            for n, data in files:
                got = parse(decode(data), 'manual:' + n)
                dbg.append(f'手動檔 {n}: {len(got)} 筆')
                cams += got
                if got and 'manual' not in srcs:
                    srcs.append('manual')
        except Exception as ex:
            dbg.append(f'手動檔 {fp} 失敗 {ex}')
    for c in cams:
        if len(c) < 6:
            c.append('g')   # 政府資料
    # 開放街圖補齊：離政府資料 60 公尺內的視為同一支，不重複
    osm = osm_cams()
    grid = {}
    for c in cams:
        grid.setdefault((round(c[0], 2), round(c[1], 2)), []).append(c)
    added = 0
    for o in osm:
        k = (round(o[0], 2), round(o[1], 2))
        cand = [c for dx in (-0.01, 0, 0.01) for dy in (-0.01, 0, 0.01) for c in grid.get((round(k[0] + dx, 2), round(k[1] + dy, 2)), [])]
        if not any(near(o, c) for c in cand):
            cams.append(o); added += 1
    dbg.append(f'開放街圖補進 {added} 筆')
    if added:
        srcs.append('osm')
    # 其他可能有國道測速的資料集：記下標題與下載網址，方便之後接
    for ds in ('106636', '178143', '100856', '152480', '100855', '104431', '130111', '178119', '178120'):
        m = get(f'https://data.gov.tw/api/v2/rest/dataset/{ds}', tries=1)
        if m:
            try:
                r = json.loads(decode(m)).get('result', {})
                dbg.append(f'候選 {ds}: {r.get("title")} | ' + ' ; '.join(f'{d.get("resourceFormat")} {d.get("resourceDownloadUrl")}' for d in r.get('distribution', [])))
            except ValueError:
                pass
    # 同一點去重（四捨五入到約 10 公尺）
    seen, uniq = set(), []
    for c in cams:
        k = (round(c[0], 4), round(c[1], 4), c[3])
        if k not in seen:
            seen.add(k)
            uniq.append(c)
    with open('data/speedcam-debug.txt', 'w', encoding='utf-8') as f:
        f.write('\n'.join(dbg)[:40000])
    if len(uniq) < 200:
        print('資料太少，保留舊檔', len(uniq))
        sys.exit(0)
    with open('data/speedcam.json', 'w', encoding='utf-8') as f:
        json.dump({'updated': time.strftime('%Y-%m-%d'), 'src': srcs, 'n': len(uniq),
                   'f': ['lon', 'lat', 'limit', 'dir', 'addr', 'src(g=政府,o=開放街圖)'], 'cams': uniq}, f, ensure_ascii=False, separators=(',', ':'))
    print('ok', len(uniq), srcs)

if __name__ == '__main__':
    main()

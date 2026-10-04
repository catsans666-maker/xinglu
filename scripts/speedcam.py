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
    # 同一點去重（四捨五入到約 10 公尺）
    seen, uniq = set(), []
    for c in cams:
        k = (round(c[0], 4), round(c[1], 4), c[3])
        if k not in seen:
            seen.add(k)
            uniq.append(c)
    with open('data/speedcam-debug.txt', 'w', encoding='utf-8') as f:
        f.write('\n'.join(dbg)[:20000])
    if len(uniq) < 200:
        print('資料太少，保留舊檔', len(uniq))
        sys.exit(0)
    with open('data/speedcam.json', 'w', encoding='utf-8') as f:
        json.dump({'updated': time.strftime('%Y-%m-%d'), 'src': srcs, 'n': len(uniq),
                   'f': ['lon', 'lat', 'limit', 'dir', 'addr'], 'cams': uniq}, f, ensure_ascii=False, separators=(',', ':'))
    print('ok', len(uniq), srcs)

if __name__ == '__main__':
    main()

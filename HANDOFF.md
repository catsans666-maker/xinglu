# 交接：「行路台灣」台灣交通地圖工具（v2）

> 給接手的 Claude（遠端控制電腦的那一端）。這份文件記錄前一個對話的全部決策與進度，照這份做，不要重問已定案的事。

## 0. 你這一輪要做的事

1. 在使用者電腦上用 **Chrome** 開 `taiwan-transit.html`（同資料夾）。
2. 請使用者**自己**在網頁的「TDX 金鑰」視窗輸入 Client Id／Secret。**不要叫他把金鑰貼進對話**。他若已經貼了，提醒他之後到 TDX 會員中心刪掉那把、重建一把。
3. 點地圖上的「臺北市」（或右上「選縣市」→ 臺北市），逐項實測：
   - 圖層列的數字是否出現（捷運／台鐵／高鐵／YouBike）
   - 點捷運站、台鐵站、高鐵站、YouBike 站，面板內容是否合理
   - 搜尋公車「307」→ 點路線 → 站序與到站時間、去返程切換
   - 再測一個非雙北縣市（例如高雄市：KRTC、KLRT）
4. 有錯就打開右側「〰」連線紀錄，看哪個網址回什麼 HTTP 狀態，修 `core.js` 的 `EP` 物件（所有 API 路徑都集中在那），再跑 `python3 build.py` 重新產生 HTML，重測。
5. 第①階段實測通過後，回報結果，再問使用者要不要進第②階段。

## 1. 使用者

- 李家豪，新北市，繁體中文（台灣）。
- 回答要：精簡、直接、不客套、不先稱讚；大量資訊用表格或條列。
- **做不到或不確定就說「不知道」**，不要猜。資訊要標【事實】【推論】【不知道】。
- **交件前一定要自測**。
- 專案型需求：一開始問清楚（已問完，見下），之後用精簡條列回覆。

## 2. 需求（已定案）

| 項目 | 決定 |
|---|---|
| 類型 | 真實地圖導航工具（不是模擬城市遊戲） |
| 平台 | iPhone＋電腦都要 |
| 縣市 | 全台地圖，點某縣市才載入該縣市資料 |
| 交通方式 | 全部：開車／機車導航、捷運、台鐵、高鐵、公車、客運、YouBike、步行 |
| 即時景象 | 路口監視器畫面、即時路況顏色、3D 衛星實景（**免費版**：衛星照＋方塊樓房） |
| 金鑰 | 只有他自己用 → 網頁內輸入、存 localStorage |
| 開發方式 | 分階段：①縣市＋軌道／公車／YouBike 即時 → ②監視器＋路況 → ③導航 → ④3D |
| 機車導航 | **要正確的台灣機車規則**（禁行快速道路、兩段式左轉）。已告知可能做不到，第③階段要用他熟的路線實測，錯就直說做不到 |
| 公車站顯示 | 只在**搜尋路線**後才畫該路線的站（不全部顯示） |
| 自測方式 | 他選「自己實機測」；現在改成由你在他電腦上測 |

## 3. 已知限制（已跟使用者講過）

- 不可能整體贏過 Google Maps；能贏的是台灣在地交通資料的整合。
- Claude 發布的網頁（Artifact）會擋所有外部連線（地圖圖磚、TDX），所以交付形式是**獨立 HTML 檔**。
- iPhone 要用的話，需放到 GitHub Pages 之類的網址（尚未做，使用者還沒要求）。
- 網頁版開車語音導航在 iPhone 鎖屏／切 App 後會停。
- 部分台灣 CCTV 是 http 串流，放在 https 頁面會被擋（第②階段要實測）。
- 刻意不反向破解其他 App（台北捷運Go、台北等公車等）的私有 API：資料與 TDX 重複、會變動、可能觸及刑法 §358（只講風險，未下定論）。

## 4. 技術架構（第①階段，已完成並通過模擬自測）

```
core.js        純邏輯：TDX token、排隊節流（每次間隔 300ms）、錯誤分類、WKT 解析、縣市比對、時間格式
ui.js          介面：MapLibre 地圖、圖層、面板、公車搜尋、金鑰設定、連線紀錄
template.html  HTML／CSS 外殼，含 /*CORE*/ /*UI*/ 佔位
build.py       把 core.js、ui.js 塞進 template → taiwan-transit.html
test.js        node 單元測試（純函式＋模擬 TDX 用戶端）：node test.js
e2e.py         Playwright 端到端測試（地圖程式庫用替身、TDX 用模擬回應）
```

- 底圖：OpenFreeMap liberty 向量圖（失敗退回 OSM 點陣圖磚）。
- 縣市邊界：`cdn.jsdelivr.net/npm/taiwan-atlas@2021.9.20/counties-10t.json`（TopoJSON）。物件名與屬性名（`COUNTYNAME`）是程式自動偵測的，**未用真實檔案驗證**；失敗時有「選縣市」清單當備案。
- 函式庫：maplibre-gl 4.7.1（unpkg）、topojson-client 3.1.0（jsdelivr）。
- 靜態資料（站點、線型）快取在 localStorage，省 TDX 額度。

### TDX API 路徑可信度

| 用途 | 路徑 | 可信度 |
|---|---|---|
| Token | `POST https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token` | 【事實】官方範例 |
| 台鐵即時 | `/v2/Rail/TRA/LiveBoard/Station/{StationID}` | 【事實】文件中出現過 |
| 台鐵車站 | `/v2/Rail/TRA/Station` | 【推論】 |
| 捷運站／線型／即時 | `/v2/Rail/Metro/Station|Shape|LiveBoard/{Operator}` | 【推論】 |
| 高鐵車站／當日時刻 | `/v2/Rail/THSR/Station`、`/v2/Rail/THSR/DailyTimetable/Station/{id}/{yyyy-mm-dd}` | 【推論】 |
| YouBike | `/v2/Bike/Station/City/{City}`、`/v2/Bike/Availability/City/{City}` | 【推論】（把握較高） |
| 公車 | `/v2/Bus/Route|StopOfRoute|Shape|EstimatedTimeOfArrival/City/{City}/{RouteName}`（客運用 `InterCity`） | 【推論】（把握較高） |
| 捷運營運代碼 | TRTC、TYMC、TMRT、KRTC、KLRT 較有把握；NTDLRT、NTALRT、NTMC **【不知道】** | 404 會被程式跳過 |

其他【不知道】：
- 捷運 LiveBoard 的 `EstimateTime` 單位（程式當「分鐘」）
- 哪些捷運系統有即時資料
- TDX 免費方案每日／每分鐘額度
- TDX 是否對 `file://` 開啟的頁面允許跨網域。若 Chrome 直接開檔失敗，改在資料夾內跑 `python -m http.server 8000`，再開 `http://localhost:8000/taiwan-transit.html`

## 5. 之後的階段

- **②** 監視器：TDX 有 CCTV 相關資料【推論】，要實測能顯示多少。即時路況顏色：TDX 路況（VD／LiveTraffic）資料【推論】。
- **③** 導航：建議改用開源引擎，要一台常開的電腦當伺服器（使用者尚未決定用哪台）。
  - Valhalla：有 `motor_scooter` 模式【事實】；能否避開台灣快速道路取決於 OpenStreetMap 標註【要實測】；兩段式左轉沒有現成方案。
  - OpenTripPlanner：大眾運輸轉乘規劃，需要 GTFS；TDX 是否直接提供 GTFS【不知道】，沒有就自己把 TDX 時刻表轉成 GTFS。
- **④** 3D：MapLibre 衛星底圖＋建築擠出（免費方案）。

## 6. 給接手者的規則

- 改程式後一定要 `node test.js`；有 Playwright 就跑 `python3 e2e.py`；再 `python3 build.py`。
- 不要把金鑰寫進任何檔案或對話紀錄。
- 修 API 路徑時，只改 `core.js` 的 `EP`，並把這份文件的可信度表更新成【事實】。

## 7. v2 更新（2026/10/3 下午）

**新增需求（已定案）**
- 版面：左邊地圖、左上時間（＋天氣、導航時速度）、右上轉彎卡、右下 YouTube。風格參考 Apple 地圖＋Apple 官網（使用者說「iOS 27 就不錯」；iOS 27 細節【不知道】，做的是 iOS 26 液態玻璃風格）。
- YouTube：iPhone 用 YouTube App 子母畫面（使用者有會員），網頁右下留「子母畫面區」；電腦用內嵌播放器。設定可切換。
- 導航語音：要，可關閉。
- 部署：使用者有 GitHub 帳號 → GitHub Pages（YouTube 內嵌在 file:// 會出錯誤 153）。

**v2 技術**
- 交付檔名改 `index.html`。
- 地點搜尋：Nominatim（OSM）。路線：routing.openstreetmap.de（OSRM：開車／自行車／步行），不含即時路況。機車仍是第③階段。
- 天氣：Open-Meteo（免金鑰）。
- YouTube：IFrame API；關鍵字搜尋需選填的 YouTube Data API 金鑰（每日 10,000 單位，搜一次 100）。
- 底圖改色：`applyPalette()` 依圖層 id 規則改顏色，深淺色各一套。
- 新純函式（core.js）：dist、distToLine、alongLine、bearing、fmtDist、fmtDur、maneuverText、parseYouTube、weatherInfo；測試 `node test2.js`。
- 「模擬」按鈕可在電腦上不走路測導航流程。

**v2 不知道／要實測**
- 子母畫面播 YouTube 時，網頁語音會不會打斷音樂。
- Nominatim、OSRM 公開伺服器在瀏覽器直連是否都允許跨網域（【推論】可以）。
- 底圖改色在真實 OpenFreeMap 樣式上的效果（沙盒沒網路，只驗證了程式有跑）。

## 9. 底圖決策（2026/10/4 定案）
- 使用者說的「換底圖」是要**資料新**，不是換風格。
- 定案：**國土測繪中心 NLSC 為預設底圖＋ OpenFreeMap 向量圖（Apple 配色）可切換**。
- 規則：
  - 預設 NLSC 電子地圖（資料較新）。
  - 地圖旋轉（方向跟隨／導航）時自動切成向量圖，讓字保持正；回北朝上後切回 NLSC。
  - 深色模式預設用向量圖的原生深色配色，不用 NLSC 亮度反轉（反轉留作手動選項）。
  - 底圖選單：NLSC 電子地圖／NLSC 航照／向量（Apple 風）。
- 未採用：Apple MapKit JS（需 Apple 開發者計畫 US$99/年，地圖層要重寫）。

## 8. Dispatch 那輪（v3，2026/10/4 清晨）
- 詳見 `STATUS-dispatch.md`、`CHANGES-dispatch.md`（Dispatch 寫的原文）。
- 重點：取消選縣市（定位自動判斷）、NLSC 底圖、捷運／公車票價與時間、附近站牌、我的地點、指南針與方向跟隨、地點搜尋由近到遠。

## 10. v3.1（2026/10/4 上午，本對話）
以 Dispatch 的 index.html 拆回 template／core／ui（拆完重組與原檔逐字相同），再改：
- **底圖**：NLSC 預設＋ OpenFreeMap 向量圖併在同一樣式。旋轉超過 3°（回到 0.5° 內才換回）或深色模式 → 自動換向量圖；圖層選單可關「自動」。向量圖地名改中文優先（`name:zh-Hant`→`name`→`name:zh`），道路編號不動。Apple 配色（VPAL）只套向量圖層。
- **懶載入**：選縣市不再一次打 ~14 支 TDX；選了哪種交通（`ensure(k)`）才載哪種，同縣市載過不重載，YouBike 60 秒後才重抓。
- **429**：重試秒數可設定（`retry429`），被擋時跳提示（`onThrottle`），被擋後 60 秒內呼叫間隔放慢到 1.5 秒；資料一到就交出，間隔只延後下一個呼叫。
- **TomTom 即時路況**：設定填金鑰（用一張台北圖磚測試），圖層選單開關，深色用 `relative0-dark`，壓在路線與站點下面，版權加 © TomTom。
- **指南針**：按「出發」也會要 iPhone 指南針權限（原本只有定位鈕會要）。Dispatch 原本就有處理 iPhone 授權，我先前說「可能沒處理」是錯的。
- 測試：`node test.js`、`node test2.js`、`node test3.js`（Dispatch 新函式＋429＋TomTom）、`python3 e2e.py`（v3 流程，手機淺／深、電腦，92 項）。
- 未驗證：真實 OpenFreeMap 樣式的配色效果、TomTom 真實圖磚、iPhone 實機。

## 11. v3.2 外觀（2026/10/4 中午）
- 使用者要求「照 iOS 26 重做」。template.html 尾端加「iOS 26 外觀層」：液態玻璃（半透明＋模糊＋上緣高光）、膠囊按鈕、36px 抽屜圓角、iOS 分組清單（內縮分隔線、17pt）、圓形交通方式圖示、圓形返回鈕。
- 設定頁改成 iOS 分組表單：標籤靠左、輸入框靠左、動作是清單列（藍字／紅字），說明文字放在群組下方。
- 手機：搜尋列整條膠囊；地點／公車／捷運切換移到下一行，收合時隱藏。
- 修正：存好金鑰後首頁還顯示「缺金鑰」（懶載入造成的舊狀態）。
- 部署：使用者 GitHub 帳號 catsans666-maker；本對話不能新建 repo，需使用者先建空的 `xinglu`（Public、含 README），再用 add_repo 推送並開 Pages。

## 12. 中繼站（2026/10/4 中午）
- 使用者要「打開就能用、不重複輸入金鑰」，選了 Cloudflare 中繼站方案。
- `worker.js`：金鑰放在 Cloudflare 環境變數（TDX_ID、TDX_SECRET、TOMTOM_KEY）。路徑 `/tdx/v2/...`、`/tomtom/{style}/{z}/{x}/{y}.png`、`/health`。只允許 catsans666-maker.github.io 與 localhost:8000 來源。快取：即時 15 秒、高鐵當日時刻 10 分、其他 6 小時；429 不快取。
- 網頁：`index.html` 最上面 `window.XINGLU_RELAY = ''` 填 Worker 網址；設定頁也可填（優先）。自己填 TDX 金鑰時改為直連（優先於中繼站）。
- 測試：`node test4.js`（中繼站用戶端）、`node test_worker.mjs`（Worker）、`python3 e2e_relay.py`（不填金鑰的流程）。
- Repo：github.com/catsans666-maker/xinglu（Pages 要使用者自己在 Settings → Pages 開；API 被擋）。

## 13. Google 地圖版（2026/10/4 下午）
- **有 Google 金鑰就用 Google**（設定頁「Google 地圖」或 template.html 的 `window.XINGLU_GOOGLE`）；沒有或載入失敗 → 自動退回 MapLibre 開放地圖，功能照舊。
- `gmap.js`：轉接層，介面照 MapLibre（addSource/addLayer/setData/easeTo/fitBounds/Marker…），底下用 google.maps。
  - 縮放：Google = MapLibre + 1。運算式只做 ui.js 用到的（get/case/match/interpolate/step/in…）。
  - 點狀圖層只畫畫面附近（YouBike 上千站），群集用固定網格。標記：有 Map ID 用 AdvancedMarker，沒有用 OverlayView。
  - 點 Google 店家 → `poiclick` → 自己的資料卡（不跳 Google 小視窗）。
- Google 要啟用：**Maps JavaScript API、Places API (New)、Routes API**（舊版 Directions/Places Service 2025/3 起新專案不能開）。Route 類別目前只在 `v=beta`。
- 計費控制：搜尋只抓基本欄位（Pro）；評分、營業時間、電話、照片只在開資料卡時抓（Enterprise）；沒有自動完成（只在按搜尋時查）。
- 路線頁：上方固定五種方式 大眾運輸｜開車｜機車｜自行車｜步行（記住上次選的）。
  - 開車／機車（TWO_WHEELER）／步行：Google Routes，轉成 OSRM 格式給原本的導航程式（core.js `fromGoogleRoute`）。
  - 自行車：OSRM。大眾運輸：Google 方案列表 → 步驟（哪站上、幾站、哪站下）；公車段用 TDX StopOfRoute 找站＋方向，再查即時到站。
  - 沒 Google：大眾運輸、機車分頁顯示「要 Google 金鑰」，不拿汽車路線冒充機車。
- 搜尋框只有一個：打公車號碼（307、紅31…）走 TDX 公車；其他走 Google（或 Nominatim）→ 結果紅點＋清單 → 地點資料卡 → 路線。「返回」會回上一頁（S.backFn）。
- 路況：Google 模式用 Google 自己的 TrafficLayer（免費），不用 TomTom。
- 街景：StreetViewPanorama 全螢幕（#sv）。

## 14. 測速照相（2026/10/4 下午）
- 資料：警政署 data.gov.tw 7320（全國測速執法設置點）＋13940（國道固定式），`.github/workflows/speedcam.yml` 每天 03:17 跑 `scripts/speedcam.py` → `data/speedcam.json`（同網站，不用中繼站）。2026/10/4 首次跑出 1893 處（7320）。
- 導航（開車、機車）時把路線附近 30 公尺內的測速點投影到路線上，沿路線前方 600 公尺內顯示限速標誌、500 公尺語音、超速閃紅並再提醒一次。
- 紅燈秒數：做不到（台灣沒有公開即時號誌資料；高德是用大量使用者軌跡推算，數位部 2026/4/23 說明）。

### 測試
- `e2e_google.py` 用 `gstub.js`（假 google.maps）跑 Google 模式：載入參數、深淺色、衛星、按搜尋才查、資料卡、街景、五種路線、轉乘步驟、TDX 即時、測速提醒、點店家、公車號碼搜尋。

## 15. 平順定位、跟隨、Google 檢查（2026/10/4 傍晚）
- 藍點：GPS 每筆用動畫補間（時間＝兩筆間隔，上限 1.2 秒），方向做平滑；鏡頭跟隨在同一個 requestAnimationFrame 裡 jumpTo，跟藍點同步。導航只有一開始（或按「回到導航」）用 easeTo 轉到導航視角，之後每格 jumpTo。
- 打開定位後預設「跟著你」；拖地圖就停；程式要把地圖移去別處（搜尋結果、路線、站點）時自動停止跟隨（guardCamera 包住 easeTo/flyTo/fitBounds）。
- Google 錯誤：攔 console 的「Google Maps JavaScript API error: XxxMapError」翻成白話；Places／Routes 錯誤用 gHint 翻。設定頁「檢查 Google 設定」逐項測三個 API（用最便宜的請求），附申請步驟與直接連結。
- iOS 26.0 主畫面 App 收鍵盤後底部空一條（Apple 在 Safari 26.1 修好）：standalone 時地圖用 100lvh，收鍵盤時 scrollTo(0,0)。
- 國道測速資料是 zip（檔名有中文）：腳本改成網址編碼＋解壓。

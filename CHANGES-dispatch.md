# CHANGES — 這次交接對話改過／新增的檔案

> 專案資料夾：`C:\Users\clove\Desktop\xinglu-taiwan-v2\xinglu-taiwan`
> 標籤：【事實】實測看到；【推論】有根據沒直接驗證；【不知道】查不到／測不到。
> 這份只記錄變更，詳細功能與測試狀態見 `STATUS.md`。

## 0. 檔案一覽

| 檔案（完整路徑） | 動作 |
|---|---|
| `C:\Users\clove\Desktop\xinglu-taiwan-v2\xinglu-taiwan\core.js` | 修改 |
| `C:\Users\clove\Desktop\xinglu-taiwan-v2\xinglu-taiwan\ui.js` | 修改（大量） |
| `C:\Users\clove\Desktop\xinglu-taiwan-v2\xinglu-taiwan\template.html` | 修改（CSS、少量 HTML） |
| `C:\Users\clove\Desktop\xinglu-taiwan-v2\xinglu-taiwan\index.html` | 修改（手動同步成 template＋core＋ui） |
| `C:\Users\clove\Desktop\xinglu-taiwan-v2\xinglu-taiwan\build.py` | 修改 |
| `C:\Users\clove\Desktop\xinglu-taiwan-v2\xinglu-taiwan\HANDOFF.md` | 修改 |
| `C:\Users\clove\Desktop\xinglu-taiwan-v2\xinglu-taiwan\dev.html` | 新增 |
| `C:\Users\clove\Desktop\xinglu-taiwan-v2\xinglu-taiwan\STATUS.md` | 新增 |
| `C:\Users\clove\Desktop\xinglu-taiwan-v2\xinglu-taiwan\CHANGES.md` | 新增（本檔） |

沒動過：`test.js`、`test2.js`、`e2e.py`。
不是檔案但有改到：使用者 Chrome 在 `localhost:8000` 的 localStorage（TDX 快取 `c:*`、`basemap`；測試用的 `places`／`placeTags`／`__dbg` 已刪除）。

---

## 1. core.js

| 改了什麼 | 為什麼 | 狀態 |
|---|---|---|
| `EP` 新增 `metroFare`、`metroTime`、`busFare` | 顯示票價與所需時間 | 完成；三支 API 實測 200【事實】 |
| 新增 `inPolygon`、`countyAt` | 用定位判斷所在縣市（取消選縣市） | 完成；實測判斷出新北市【事實】 |
| 新增 `metroAdultFare` | 從 ODFare 取全票 | 完成；FareClass 1＝全票是【推論】 |
| 新增 `busFareInfo` | 公車段次票、跨段計算 | 完成；307 兩段計算實測正確【事實】；跨段規則是【推論】 |
| 新增 `metroTravel`（Dijkstra，轉乘估 5 分） | 捷運所需時間 | 完成；5 分鐘是【推論】 |
| 新增 `fmtAddr` | 地址寫成「縣市區路門牌」 | 完成 |
| `rawGet`：429 時等 5／10／20 秒重試（最多 3 次） | TDX 頻率限制很緊 | 完成；上限數字【不知道】 |
| `GAP_MS` 300 → 500 | 300ms 實測會撞 429【事實】 | 完成 |
| 匯出新增函式 | | 完成 |

**已知問題**：新函式都沒有單元測試；`test.js` 若有測「429 立刻報錯」，現在會先等最多約 35 秒再報錯，可能變慢或失敗【推論，沒跑】。

## 2. ui.js

| 改了什麼 | 為什麼 | 狀態 |
|---|---|---|
| 地點搜尋：依距離排序、顯示距離、viewbox 先找附近 | 使用者要「從近到遠」 | 完成，實測 |
| `quickPos` 自己計時 4 秒 | 權限視窗沒人按時搜尋會卡住 | 完成，實測 |
| 定位鈕三段（跟隨／方向跟隨／北朝上）、指南針按鈕、藍點扇形、`DeviceOrientation` | 使用者要指南針、地圖朝向自己 | 電腦實測；手機未測 |
| 導航停車時改用指南針方向 | GPS 方向停車時不準 | 寫好未驗證 |
| `startPosWatch`、`getPos` 高精度逾時改一般精度 | 這台電腦高精度一定逾時【事實】 | 完成，實測 |
| 捷運搜尋分頁 `searchMetro`、台／臺 同字 | 使用者要「左下角捷運」 | 完成，實測 |
| `loadMetro` 一個系統失敗不連累其他 | 429 時整個捷運顯示錯誤 | 完成，實測 |
| 底圖改 NLSC（`BASEMAPS`、`BASE_STYLE`、`setBasemap`），刪除 OpenFreeMap 向量與 Apple 配色程式；深色用亮度反轉 | 使用者要換底圖 | 完成，實測；Google 圖層沒做 |
| 站點改 SVG 徽章圖示（`loadIcons`），YouBike 群集改樣式 | 使用者嫌圓圈難看 | 完成，實測 |
| 移除縣市選單、縣市邊界點選／hover；新增 `firstLocate`、`autoCounty`、`countyFor` | 取消選縣市，用定位自動判斷 | 完成，實測；拖地圖跨縣市自動切換未實測 |
| 首頁改寫：「你在 XX 路」＋交通方式按鈕（`showHome`、`renderHomeStatus`、`openMode`）、`updatePlaceLabel` | 使用者指定的流程 | 完成，實測 |
| `nearStations`（附近台鐵／高鐵／YouBike） | 選交通方式後列附近 | 完成；YouBike 清單未逐一核對 |
| `busNearby`、`openBusStop`（附近站牌、每條路線幾分） | 台北等公車式呈現 | 完成；到站分鐘數未在白天驗證 |
| `searchBus` 雙北一起查 | 新北市查不到 307【事實】 | 完成，實測 |
| `openRoute`／`renderBusStops`／`pickBusStop`／`loadBusFare`／`renderBusTrip`：票價、上下車站、每站票價與時間 | 使用者要費用＋時間 | 票價實測正確；時間未驗證（凌晨無即時資料） |
| 站序、線形、路線表改存本機（`cachedGet`） | 省 TDX 額度 | 完成 |
| `openMetro` 自動帶出「最近站→這站」、`fillMetroDest`、`metroData`、`metroQuote`、`nearestMetro`、`showMetroFare` | 每個站點顯示錢與時間 | 完成，實測 |
| `openLine`、`lineChips`、`LINE_NAMES`、`linePrefix` | 選一條線才顯示 | 完成，實測；LB＝三鶯線是【推論】 |
| `setFocus`（用 setFilter 控制要畫什麼）、`setLayer`；YouBike 預設關 | 路線預設隱藏、需要時才顯示 | 完成，實測（曾有篩選寫法錯誤，已修） |
| 我的地點：`Places`、`openSaveBox`、`renderMyPlaces`、`saveBtn` | 使用者要喜愛／工作等標籤 | 完成，實測 |
| 搜尋結果地址格式、門牌查不到退到路段 | 地址要到街道 | 完成，實測 |

**已知問題**
1. 第一次列「附近捷運站」曾出現 137 公里以上的錯誤距離（定位未及時取得、地圖中心未更新），第二次正常；原因【推論】是測試分頁在背景。
2. 第一個測試分頁曾整頁卡死一次，原因【不知道】，之後沒重現。
3. `e2e.py` 的流程（選縣市晶片）已不存在，端到端測試很可能會失敗【推論，沒跑】。

## 3. template.html

| 改了什麼 | 為什麼 | 狀態 |
|---|---|---|
| 新增指南針按鈕 `#bNorth`；定位鈕預設改空心圖示 | 指南針功能 | 完成 |
| 新增 CSS：藍點（含脈動光暈）、扇形、首頁交通按鈕、YouBike 可借／可還、公車路線列、票價／行程摘要、選線清單、我的地點、底圖選單 | 對應 ui.js 新功能 | 完成 |
| 上車／下車標籤 class 由 `.pin` 改 `.tp` | `.pin` 已被目的地圖釘使用，撞名 | 完成 |
| 搜尋模式加「捷運」按鈕 | 捷運搜尋 | 完成 |
| 底部版權文字改「© 內政部國土測繪中心 · TDX」 | 換底圖 | 完成 |

## 4. index.html

- 依 template＋core.js＋ui.js 手動同步（本機無法執行 python）。
- 最後在 Chrome 比對：與 build.py 會產生的內容逐字相同【事實】。
- 狀態：完成。

## 5. build.py

- 讀寫改指定 `encoding='utf-8'`。原因：Windows 預設 cp950，含中文的檔案會出錯【推論】。
- 狀態：改完沒有執行過。

## 6. HANDOFF.md

- 第 4 節 API 可信度表：依實測改成【事實】，新增 429 說明。
- 新增第 8 節「v3 更新」。
- 狀態：完成。

## 7. dev.html（新增）

- 在瀏覽器裡把 template＋core＋ui 組起來直接執行（需 http 開）。
- 原因：本機無法跑 build.py，用它測原始檔。
- 狀態：完成，實測。

## 8. STATUS.md（新增）

- 完整進度報告：功能清單、實測狀態、API 實測結果、【推論】、【不知道】、限制與待辦。
- 狀態：完成。

---

## 9. 做到一半／未驗證（總表）

| 項目 | 狀態 |
|---|---|
| 捷運即時到站、公車到站分鐘數、公車坐車時間 | 寫好，白天未驗證 |
| 手機指南針、方向跟隨、導航停車用指南針 | 寫好，手機未測 |
| 拖地圖跨縣市自動換資料 | 寫好，未實測 |
| 基隆 YouBike（Station API 回 400） | 未處理，原因【不知道】 |
| YouBike、高雄、台鐵、高鐵面板 | 等使用者確認後再測 |
| 新函式單元測試、`test.js`／`test2.js`／`e2e.py`／`build.py` | 沒跑、沒更新 |
| 門牌精準定位（TGOS） | 沒做，需申請 |
| Google 地圖圖層 | 沒做，需官方付費金鑰 |
| GitHub Pages 部署 | 沒做 |

---

## 10. 打包zip — 未完成

接手打包的工作階段無法產生 `xinglu-dispatch.zip`，原因：
- 這台電腦的指令環境（bash/終端機）開不起來，無法直接執行壓縮指令。
- 檔案總管只有「單純點擊」權限，不能右鍵、不能打字重新命名。
- 改用 Chrome 網頁操作壓縮也被拒絕。

**手動打包方式（約30秒）：**
1. 打開 `C:\Users\clove\Desktop\xinglu-taiwan-v2`
2. 在 `xinglu-taiwan` 資料夾上按右鍵 →「壓縮成 ZIP 檔」
3. 把產生的壓縮檔改名成 `xinglu-dispatch.zip`，可留在原地或拖到桌面

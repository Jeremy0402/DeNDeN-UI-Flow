# DeNDeN UI Flow 圖解

把 Lark「AmpGO 客服營運與知識中樞」裡的 UI Flow 雲端文件，做成可以一步一步看畫面、也能搜尋的網頁。給用戶與 BPO 客服使用。

## 本機預覽

直接用瀏覽器打開 `site/index.html`。改了 `content/` 後重新產生資料：

```bash
node scripts/build.mjs
```

新增截圖後先整理圖片（合併重複、轉 WebP、產生縮圖；需要 `brew install webp`）：`node scripts/optimize-images.mjs`，再 `node scripts/build.mjs --prune` 刪掉沒用到的圖片

## 資料夾

```
content/site.json          網站標題、通路、哪些流程算「異常排解」、「看畫面找問題」清單、舊網址轉址、同義詞
content/lark/              從 Lark 抓下來的 UI Flow 文件（唯一的內容來源：AmpGO、充電抽獎、全支付都在同一份）
content/guides/*.json      （選用）人工整理的教學；目前沒有，全部改由 Lark 文件自動轉
content/images.json        圖片來源對照（Lark 圖片 token → site/img 的 WebP 檔）
scripts/build.mjs          content/ → site/data/flows.js
site/                      網站本體（Cloudflare Pages 直接部署這個資料夾）
private/                   內部資料，不進 repo（.gitignore）
```

## 內容怎麼寫才能自動轉

照〈⚡️ AmpGO｜充電漫遊 UI Flow〉的寫法：
1. 一個「標題 1」＝一條流程；標題以「全支付｜」開頭的段落會放到全支付通路（`scripts/build.mjs` 的 `splits`）
2. 步驟用「分欄」，每欄：**粗體步驟名稱：** ＋說明＋截圖；也可以用「編號清單：**步驟名稱：**＋說明」，每一項下面接截圖
   - 分欄或附圖編號清單前面，單獨一行的短文字（例如「從付款明細查看」）會變成小章節
3. 錯誤畫面用「原因：…」「建議：…」格式，會自動進「看畫面找問題」
4. 💡 開頭＝提示框；⚠️ 開頭＝注意框；「Q1：」開頭＝常見問題；「待更新」之後＝草稿，不上網站
5. 「🎬 影片名稱：YouTube 網址」＝實測影片，網站流程上方會出現「▶ 影片名稱」按鈕

白板不會放上網站（常有內部註記），需要的畫面請另外截圖放進文件。

## 網站怎麼看

- **逐步看**：一次一個畫面，←／→ 或手機左右滑換步驟，適合第一次學、或陪用戶一步一步操作
- **整頁看**：所有步驟與說明一次列出，可以 Ctrl+F、每一步「複製說明」或「複製全部步驟」直接貼給用戶（客服常用）
- 兩種方式會記住上次的選擇；首頁有「最近看過」

## 新增通路

在 `content/site.json` 的 `channels` 加一筆，新增該通路的教學（Lark 分欄格式加到 `scripts/build.mjs` 的 `LARK_DOCS`，或在 `content/guides/` 新增 JSON），再執行 build。

## 注意：這是公開 repo

所有檔案任何人都看得到。build 會檢查 `content/site.json` → `publicForbidden` 的字（例如「後台」「DeNHub」），出現就中止。內部資料一律放 `private/`。

## 部署（Cloudflare Pages）

Cloudflare 後台 → Workers & Pages → 建立 → Pages → 連接 GitHub repo `DeNDeN-UI-Flow`：
- Framework preset：None
- Build command：留空
- Build output directory：`site`

## 自動同步 Lark（GitHub Actions）

`.github/workflows/sync-lark.yml` 會依知識庫專案相同的時段（平日白天每 20 分鐘、夜間與週末每 3 小時）執行 `scripts/sync-lark.mjs`，抓最新的 AmpGO UI Flow 文件與新圖片，重新建置後只在內容有變動時才 commit，Cloudflare 隨即更新網站。也可以在 GitHub 的 Actions 頁手動按 Run workflow。

需要的設定：
1. Lark 開發者後台，應用程式開通 `docx:document:readonly`、`drive:drive:readonly`（或 `docs:document.media:download`）權限並發布版本
2. 把應用程式加為〈AmpGO 充電漫遊 UI Flow〉文件的協作者
3. 本 repo → Settings → Secrets and variables → Actions，新增 `LARK_APP_ID`、`LARK_APP_SECRET`

要同步的文件清單在 `content/lark/sources.json`。同步後會把新圖片轉成 WebP、合併重複圖片，網站沒用到的圖片直接刪除（`images.json` 標記 `pruned`，之後不會再下載）。

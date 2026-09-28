# DeNDeN UI Flow 圖解

把 Lark「AmpGO 客服營運與知識中樞」裡的 UI Flow 雲端文件，做成可以一步一步看畫面、也能搜尋的網頁。給用戶與 BPO 客服使用。

## 本機預覽

直接用瀏覽器打開 `site/index.html`。改了 `content/` 後重新產生資料：

```bash
node scripts/build.mjs
```

新增截圖後先產生縮圖（macOS）：`./scripts/make-thumbs.sh`

## 資料夾

```
content/site.json          網站標題、通路、哪些流程算「異常排解」、「看畫面找問題」清單、同義詞
content/guides/*.json      人工整理的教學（白板類文件：全支付、充電抽獎）
content/lark/              從 Lark 抓下來的 AmpGO 文件區塊與白板
content/images.json        圖片來源對照
scripts/build.mjs          content/ → site/data/flows.js
site/                      網站本體（Cloudflare Pages 直接部署這個資料夾）
private/                   內部資料，不進 repo（.gitignore）
```

## 內容怎麼寫才能自動轉

照〈⚡️ AmpGO｜充電漫遊 UI Flow〉的寫法：
1. 一個「標題 1」＝一條流程
2. 步驟用「分欄」，每欄：**粗體步驟名稱：** ＋說明＋截圖
3. 錯誤畫面用「原因：…」「建議：…」格式，會自動進「看畫面找問題」
4. 💡 開頭＝提示框；「Q1：」開頭＝常見問題；「待更新」之後＝草稿，不上網站

白板無法自動拆成步驟，全支付與抽獎目前是人工整理在 `content/guides/`。

## 新增通路

在 `content/site.json` 的 `channels` 加一筆，新增該通路的教學（Lark 分欄格式加到 `scripts/build.mjs` 的 `LARK_DOCS`，或在 `content/guides/` 新增 JSON），再執行 build。

## 注意：這是公開 repo

所有檔案任何人都看得到。build 會檢查 `content/site.json` → `publicForbidden` 的字（例如「後台」「DeNHub」），出現就中止。內部資料一律放 `private/`。

## 部署（Cloudflare Pages）

Cloudflare 後台 → Workers & Pages → 建立 → Pages → 連接 GitHub repo `DeNDeN-UI-Flow`：
- Framework preset：None
- Build command：留空
- Build output directory：`site`

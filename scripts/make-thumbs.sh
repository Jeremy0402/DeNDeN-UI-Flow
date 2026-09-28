#!/bin/zsh
# 產生縮圖（macOS 內建 sips）：site/img/*/x.png → site/thumbs/*/x.jpg
# 首頁卡片、縮圖列、搜尋結果都用縮圖，避免手機一次下載幾十 MB 的原圖。
# 只會處理還沒有縮圖的圖片；新增截圖後執行一次，再跑 node scripts/build.mjs。
cd "$(dirname "$0")/../site" || exit 1
count=0
for f in img/**/*.(png|jpg|jpeg)(N); do
  out="thumbs/${${f#img/}%.*}.jpg"
  [[ -f "$out" ]] && continue
  mkdir -p "${out:h}"
  sips -Z 480 -s format jpeg -s formatOptions 72 "$f" --out "$out" >/dev/null && count=$((count+1))
done
echo "新增 $count 張縮圖"

#!/usr/bin/env node
/* =========================================================================
   整理 site/img 的截圖（只處理還沒整理過的 png / jpg）
   1. 內容完全一樣的圖片只留一張：images.json 裡的每個 token 都指到同一個檔案
   2. 轉成 WebP 並限制尺寸（一般截圖高度最多 1600px；超長截圖寬度最多 750px），原始 png / jpg 刪掉
   3. 產生 site/thumbs 底下的 WebP 縮圖（最長邊 480px）

   需要 cwebp：macOS `brew install webp`；GitHub Actions 用 apt 安裝 webp。
   沒有 cwebp 時退回舊做法：圖片不轉檔，只用 sips / ImageMagick 做 jpg 縮圖。
   ========================================================================= */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');
const MANIFEST = path.join(ROOT, 'content', 'images.json');
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const has = (cmd) => { try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } };
const sha1 = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');

const MAX_H = 1600;        // 一般手機截圖：網站上最高顯示約 620px，放大看時 2 倍也夠清楚
const LONG_W = 750;        // 超長截圖（高寬比 > 2.8）：限制寬度，高度跟著縮
const THUMB = 480;

function pngSize(file) {
  const b = Buffer.alloc(24);
  const fd = fs.openSync(file, 'r');
  fs.readSync(fd, b, 0, 24, 0);
  fs.closeSync(fd);
  return b.readUInt32BE(0) === 0x89504e47 ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null;
}
function jpgSize(file) {
  const b = fs.readFileSync(file);
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xc3) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

const entriesFor = (rel) => Object.values(manifest).filter((m) => m.file === rel);
const thumbsOf = (rel) => ['.webp', '.jpg'].map((x) => path.join(SITE, 'thumbs', rel.replace(/^img\//, '').replace(/\.\w+$/, x)));
const imgs = fs.readdirSync(path.join(SITE, 'img'), { recursive: true })
  .filter((f) => /\.(png|jpe?g|webp)$/i.test(f) && !f.startsWith('brand'))
  .map((f) => `img/${f}`)
  .sort();

/* 1. 重複的圖片 */
const bySha = new Map();
for (const m of Object.values(manifest)) if (m.sha1 && fs.existsSync(path.join(SITE, m.file))) bySha.set(m.sha1, m.file);
let dup = 0;
for (const rel of imgs.filter((f) => !/\.webp$/i.test(f))) {
  const h = sha1(path.join(SITE, rel));
  const keep = bySha.get(h);
  if (keep && keep !== rel) {
    for (const m of entriesFor(rel)) { m.file = keep; m.sha1 = h; }
    fs.rmSync(path.join(SITE, rel));
    for (const t of thumbsOf(rel)) fs.rmSync(t, { force: true });
    dup++;
  } else {
    bySha.set(h, rel);
    for (const m of entriesFor(rel)) m.sha1 = h;
  }
}

/* 2. 轉成 WebP */
const cwebp = has('cwebp');
let converted = 0, before = 0, after = 0;
if (cwebp) {
  for (const rel of imgs.filter((f) => !/\.webp$/i.test(f) && fs.existsSync(path.join(SITE, f)))) {
    const src = path.join(SITE, rel);
    const outRel = rel.replace(/\.\w+$/, '.webp');
    const out = path.join(SITE, outRel);
    const [w, h] = (/\.png$/i.test(rel) ? pngSize(src) : jpgSize(src)) || [0, 0];
    const resize = h && w && h / w > 2.8 ? (w > LONG_W ? ['-resize', String(LONG_W), '0'] : []) : h > MAX_H ? ['-resize', '0', String(MAX_H)] : [];
    execFileSync('cwebp', ['-quiet', '-q', '82', '-m', '6', '-metadata', 'none', ...resize, src, '-o', out]);
    before += fs.statSync(src).size;
    after += fs.statSync(out).size;
    for (const m of entriesFor(rel)) { m.file = outRel; m.bytes = fs.statSync(out).size; }
    fs.rmSync(src);
    for (const t of thumbsOf(rel)) fs.rmSync(t, { force: true });
    converted++;
  }
}

/* 3. 縮圖 */
const tool = cwebp ? 'cwebp' : has('sips') ? 'sips' : has('magick') ? 'magick' : has('convert') ? 'convert' : null;
let thumbs = 0;
for (const rel of fs.readdirSync(path.join(SITE, 'img'), { recursive: true }).filter((f) => /\.(png|jpe?g|webp)$/i.test(f) && !f.startsWith('brand')).map((f) => `img/${f}`)) {
  if (thumbsOf(rel).some((t) => fs.existsSync(t))) continue;
  if (!tool) { console.error('找不到 cwebp、sips 或 ImageMagick，無法產生縮圖'); process.exit(1); }
  const src = path.join(SITE, rel);
  const [webpThumb, jpgThumb] = thumbsOf(rel);
  fs.mkdirSync(path.dirname(webpThumb), { recursive: true });
  if (tool === 'cwebp') {
    // 縮圖以寬度為準（列表裡是固定寬度的直式框），超長截圖也不會變成細細一條
    execFileSync('cwebp', ['-quiet', '-q', '70', '-metadata', 'none', '-resize', '360', '0', src, '-o', webpThumb]);
  } else if (tool === 'sips') execFileSync('sips', ['-Z', String(THUMB), '-s', 'format', 'jpeg', '-s', 'formatOptions', '72', src, '--out', jpgThumb], { stdio: 'ignore' });
  else execFileSync(tool, [src, '-background', 'white', '-alpha', 'remove', '-resize', `${THUMB}x${THUMB}>`, '-quality', '72', jpgThumb], { stdio: 'ignore' });
  thumbs++;
}

fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
console.log([
  dup && `合併 ${dup} 張重複圖片`,
  converted && `轉成 WebP ${converted} 張（${mb(before)} → ${mb(after)}）`,
  thumbs && `新增 ${thumbs} 張縮圖（${tool}）`,
  !cwebp && '沒有 cwebp，圖片沒有轉檔（brew install webp）',
].filter(Boolean).join('；') || '圖片都已經整理過了');

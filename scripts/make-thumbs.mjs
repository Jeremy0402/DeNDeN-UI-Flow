#!/usr/bin/env node
/* 產生縮圖：site/img 底下的 png 轉成 site/thumbs 底下的 jpg（只處理還沒有縮圖的）
   macOS 用內建 sips；Linux（GitHub Actions）用 ImageMagick。 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const has = (cmd) => { try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } };
const all = fs.readdirSync(path.join(SITE, 'img'), { recursive: true }).filter((f) => /\.(png|jpe?g)$/i.test(f));
const todo = all.filter((f) => !fs.existsSync(path.join(SITE, 'thumbs', f.replace(/\.\w+$/, '.jpg'))));
if (!todo.length) { console.log('縮圖都已經有了，略過'); process.exit(0); }
const tool = has('sips') ? 'sips' : has('magick') ? 'magick' : has('convert') ? 'convert' : null;
if (!tool) { console.error('找不到 sips 或 ImageMagick，無法產生縮圖'); process.exit(1); }

let n = 0;
for (const f of todo) {
  const out = path.join(SITE, 'thumbs', f.replace(/\.\w+$/, '.jpg'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const src = path.join(SITE, 'img', f);
  if (tool === 'sips') execFileSync('sips', ['-Z', '480', '-s', 'format', 'jpeg', '-s', 'formatOptions', '72', src, '--out', out], { stdio: 'ignore' });
  else execFileSync(tool, [src, '-background', 'white', '-alpha', 'remove', '-resize', '480x480>', '-quality', '72', out], { stdio: 'ignore' });
  n++;
}
console.log(`新增 ${n} 張縮圖（${tool}）`);

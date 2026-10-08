#!/usr/bin/env node
/* =========================================================================
   從 Lark 抓最新的 UI Flow 文件與圖片，更新 content/ 與 site/img/
   需要環境變數 LARK_APP_ID、LARK_APP_SECRET（GitHub Secrets）。
   要抓哪些文件：content/lark/sources.json
   執行後請接著跑 node scripts/build.mjs --prune
   ========================================================================= */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = 'https://open.larksuite.com';
const { LARK_APP_ID, LARK_APP_SECRET } = process.env;
if (!LARK_APP_ID || !LARK_APP_SECRET) { console.error('缺少 LARK_APP_ID / LARK_APP_SECRET'); process.exit(1); }

async function api(url, token, opts = {}) {
  const res = await fetch(url.startsWith('http') ? url : HOST + url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
  return res;
}
async function json(url, token, opts) {
  const res = await api(url, token, opts);
  const d = await res.json();
  if (d.code !== 0) throw new Error(`Lark API 錯誤 ${url.split('?')[0]}：[${d.code}] ${d.msg}`);
  return d.data;
}

const tokenRes = await (await fetch(`${HOST}/open-apis/auth/v3/tenant_access_token/internal`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app_id: LARK_APP_ID, app_secret: LARK_APP_SECRET }),
})).json();
if (tokenRes.code !== 0) { console.error(`取得通行證失敗：${tokenRes.msg}`); process.exit(1); }
const token = tokenRes.tenant_access_token;

/* ---------- 區塊格式轉換：Lark 開放 API → content/lark/doc-*.raw.json 的格式 ---------- */
const TYPE = { 1: 'page', 2: 'text', 3: 'heading1', 4: 'heading2', 5: 'heading3', 6: 'heading4', 7: 'heading5', 8: 'heading6', 9: 'heading7', 10: 'heading8', 11: 'heading9', 12: 'bullet', 13: 'ordered', 14: 'code', 15: 'quote', 17: 'todo', 18: 'bitable', 19: 'callout', 22: 'divider', 23: 'file', 24: 'grid', 25: 'grid_column', 26: 'iframe', 27: 'image', 30: 'sheet', 31: 'table', 33: 'view', 34: 'quote_container', 43: 'whiteboard' };
const textKeys = ['text', 'heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6', 'heading7', 'heading8', 'heading9', 'bullet', 'ordered', 'quote', 'todo', 'code'];

function toRuns(elements) {
  return (elements || []).flatMap((el) => {
    const t = el.text_run;
    if (!t) return el.mention_doc ? [{ s: el.mention_doc.title || '' }] : [];
    const st = t.text_element_style || {};
    const a = {};
    if (st.bold) a.bold = 'true';
    if (st.link?.url) a.link = st.link.url.includes('%') ? st.link.url : encodeURIComponent(st.link.url);
    if (st.background_color || st.text_color) a.textHighlight = 'true';
    return [Object.keys(a).length ? { s: t.content, a } : { s: t.content }];
  });
}

function convertBlocks(items) {
  const blocks = {};
  let root = null;
  for (const it of items) {
    const type = TYPE[it.block_type] || `type${it.block_type}`;
    const b = { type, parent_id: it.parent_id || '', children: it.children || [] };
    const key = textKeys.find((k) => it[k]);
    if (key) {
      b.runs = toRuns(it[key].elements);
      if (it[key].style?.sequence) b.seq = it[key].style.sequence;
    }
    if (type === 'image') b.image = { token: it.image.token, width: it.image.width, height: it.image.height, name: it.image.name };
    if (type === 'whiteboard') b.token = it.board?.token;
    if (type === 'file') b.file = { name: it.file?.name, token: it.file?.token };
    blocks[it.block_id] = b;
    if (it.block_type === 1) root = it.block_id;
  }
  return { root, blocks };
}

async function fetchDoc(id) {
  const items = [];
  let pageToken = '';
  do {
    const d = await json(`/open-apis/docx/v1/documents/${id}/blocks?page_size=500&document_revision_id=-1${pageToken ? `&page_token=${pageToken}` : ''}`, token);
    items.push(...(d.items || []));
    pageToken = d.has_more ? d.page_token : '';
  } while (pageToken);
  return { id, ...convertBlocks(items) };
}

const sniff = (b) => (b[0] === 0x89 && b[1] === 0x50 ? 'png' : b[0] === 0xff && b[1] === 0xd8 ? 'jpg' : b.subarray(0, 4).toString() === 'RIFF' ? 'webp' : b.subarray(0, 3).toString() === 'GIF' ? 'gif' : null);

/* ---------- 主流程 ---------- */
const sources = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/lark/sources.json'), 'utf8')).docs;
const manifestPath = path.join(ROOT, 'content/images.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
let changed = false;
const videosPath = path.join(ROOT, 'content/videos.json');
const MAX_VIDEO = 24 * 1024 * 1024;

for (const src of sources) {
  const file = path.join(ROOT, 'content/lark', src.file);
  const old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  const doc = await fetchDoc(src.id);
  if (!doc.root) throw new Error(`${src.file}：抓不到文件根節點`);

  const count = (d, t) => Object.values(d.blocks).filter((b) => b.type === t).length;
  const n = Object.keys(doc.blocks).length;
  // 防呆：區塊或圖片數量突然少一大半，多半是權限或 API 問題，不要覆蓋現有內容
  if (old && (n < Object.keys(old.blocks).length * 0.6 || count(doc, 'image') < count(old, 'image') * 0.6)) {
    throw new Error(`${src.file}：區塊 ${Object.keys(old.blocks).length}→${n}、圖片 ${count(old, 'image')}→${count(doc, 'image')}，減少太多，已中止（請確認應用程式有文件讀取權限）`);
  }

  // 下載新圖片
  const tokens = [...new Set(Object.values(doc.blocks).filter((b) => b.type === 'image').map((b) => b.image.token))];
  let added = 0;
  for (const t of tokens) {
    const key = `${src.imgDoc}:${t}`;
    if (manifest[key] && fs.existsSync(path.join(ROOT, 'site', manifest[key].file))) continue;
    const res = await api(`/open-apis/drive/v1/medias/${t}/download`, token);
    if (!res.ok) throw new Error(`下載圖片 ${t} 失敗（HTTP ${res.status}），請確認應用程式有雲文件媒體下載權限`);
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = sniff(buf);
    if (!ext) throw new Error(`圖片 ${t} 格式無法辨識`);
    const rel = `img/${src.imgDoc}/${t}.${ext}`;
    fs.mkdirSync(path.dirname(path.join(ROOT, 'site', rel)), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'site', rel), buf);
    const name = Object.values(doc.blocks).find((b) => b.type === 'image' && b.image.token === t)?.image.name;
    manifest[key] = { file: rel, bytes: buf.length, name, doc: src.imgDoc };
    added++;
  }

  // 影片：下載 mp4 等檔案放到 site/video（Cloudflare 單檔上限 25 MB，超過就略過並提醒）
  const videos = JSON.parse(fs.existsSync(videosPath) ? fs.readFileSync(videosPath, 'utf8') : '{}');
  for (const b of Object.values(doc.blocks)) {
    if (b.type !== 'file' || !b.file?.token || !/\.(mp4|mov|webm)$/i.test(b.file.name || '')) continue;
    const t = b.file.token;
    if (videos[t] && fs.existsSync(path.join(ROOT, 'site', videos[t].file))) continue;
    const res = await api(`/open-apis/drive/v1/medias/${t}/download`, token);
    if (!res.ok) { console.warn(`⚠ 影片 ${b.file.name} 下載失敗（HTTP ${res.status}）`); continue; }
    const size = Number(res.headers.get('content-length') || 0);
    if (size > MAX_VIDEO) { console.warn(`⚠ 影片 ${b.file.name} 有 ${(size / 1048576).toFixed(1)} MB，超過 ${MAX_VIDEO / 1048576} MB 上限，沒有放到網站`); await res.body?.cancel(); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_VIDEO) { console.warn(`⚠ 影片 ${b.file.name} 超過上限，略過`); continue; }
    const ext = b.file.name.split('.').pop().toLowerCase();
    const rel = `video/${t}.${ext}`;
    fs.mkdirSync(path.join(ROOT, 'site/video'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'site', rel), buf);
    videos[t] = { file: rel, name: b.file.name, bytes: buf.length };
    console.log(`影片 ${b.file.name}（${(buf.length / 1048576).toFixed(1)} MB）已下載`);
    changed = true;
  }
  fs.writeFileSync(videosPath, JSON.stringify(videos, null, 1));

  // 白板：匯出成一張完整的流程圖（需要「查看白板」權限；沒有權限只提醒，不中止）
  for (const b of Object.values(doc.blocks)) {
    if (b.type !== 'whiteboard' || !b.token) continue;
    const key = `${src.imgDoc}:wb-${b.token}`;
    if (manifest[key] && fs.existsSync(path.join(ROOT, 'site', manifest[key].file))) continue;
    const res = await api(`/open-apis/board/v1/whiteboards/${b.token}/download_as_image`, token);
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok || !sniff(buf)) { console.warn(`⚠ 白板 ${b.token} 匯出失敗（HTTP ${res.status}）：${buf.subarray(0, 120).toString()}`); continue; }
    const rel = `img/${src.imgDoc}/wb-${b.token}.${sniff(buf)}`;
    fs.writeFileSync(path.join(ROOT, 'site', rel), buf);
    manifest[key] = { file: rel, bytes: buf.length, name: '白板流程圖', doc: src.imgDoc };
    console.log(`白板 ${b.token} 已匯出成圖片`);
    changed = true;
  }

  const next = JSON.stringify(doc, null, 1);
  // 公開 repo：不留公司網域與編輯者資訊
  const clean = next.replace(/https(%3A|:)(%2F|\/)(%2F|\/)[a-z0-9-]+\.[a-z]+\.larksuite\.com/gi, '');
  const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (clean !== prev) { fs.writeFileSync(file, clean); changed = true; }
  console.log(`${src.file}：${n} 個區塊、${tokens.length} 張圖（新下載 ${added}）${clean !== prev ? '，內容有變動' : '，沒有變動'}`);
  if (added) changed = true;
}

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
console.log(changed ? '✔ 有更新' : '✔ 沒有更新');

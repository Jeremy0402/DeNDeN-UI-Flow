#!/usr/bin/env node
/* =========================================================================
   把 content/ 的資料轉成網站用的 site/data/flows.js
   執行：node scripts/build.mjs            產生網站資料
         node scripts/build.mjs --prune    另外把 site/img 裡沒用到的圖片移到 private/（不會進 repo）

   資料來源
   - content/lark/doc-*.raw.json   Lark 雲端文件的區塊（分欄＋截圖格式，可自動轉成步驟）
   - content/guides/*.json         人工整理的教學（白板類文件無法自動拆步驟，用這種格式寫）
   - content/images.json           每張圖片的來源（Lark 檔案 token → site/img 裡的檔名）
   - content/site.json             網站標題、通路、異常排解分類、同義詞

   網站以「流程」為單位：每份教學的每個一級標題＝一條流程，流程裡的分欄＝一個一個畫面。
   ========================================================================= */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');
const content = (...p) => path.join(ROOT, 'content', ...p);
const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const warnings = [];
const warn = (msg) => warnings.push(msg);

const site = readJSON(content('site.json'));
const manifest = readJSON(content('images.json'));

/* ---------- 來自 Lark 自動轉換的文件 ---------- */
const LARK_DOCS = [
  {
    file: 'doc-ampgo.raw.json',
    imgDoc: 'ampgo',
    id: 'ampgo-roaming',
    channel: 'ampgo',
    title: '充電漫遊',
    icon: '⚡️',
    summary: '從找站、開通、掃碼充電到訂單、發票、優惠與常見異常排除。',
  },
];

/* 公開的白板流程圖：白板 token → content/lark/whiteboards/<key>.svg */
const WHITEBOARDS = { LrS8wenzNh6HqCbciTflhpxVgPg: 'start' };

/* ---------- 圖片 ---------- */
function imageSize(rel) {
  try {
    const fd = fs.openSync(path.join(SITE, rel), 'r');
    const b = Buffer.alloc(24);
    fs.readSync(fd, b, 0, 24, 0);
    fs.closeSync(fd);
    if (b.readUInt32BE(0) === 0x89504e47) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  } catch { /* 非 PNG 或讀不到就不給尺寸 */ }
  return [undefined, undefined];
}

const usedImages = new Set();
function img(doc, token, extra = {}) {
  const m = manifest[`${doc}:${token}`];
  if (!m || !fs.existsSync(path.join(SITE, m.file))) { warn(`找不到圖片 ${doc}:${token}`); return null; }
  usedImages.add(m.file);
  const [w, h] = imageSize(m.file);
  const thumb = `thumbs/${m.file.replace(/^img\//, '').replace(/\.\w+$/, '.jpg')}`;
  const out = { src: m.file, w, h };
  if (fs.existsSync(path.join(SITE, thumb))) out.th = thumb;
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== null && v !== '') out[k] = v;
  return out;
}

/* ---------- 文字 ---------- */
// 人工整理的 JSON 用 **粗體** 標記
function mdRuns(text) {
  const out = [];
  const re = /\*\*(.+?)\*\*/gs;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ s: text.slice(last, m.index) });
    out.push({ s: m[1], b: 1 });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ s: text.slice(last) });
  return out;
}

const plain = (runs) => (runs || []).map((r) => r.s).join('');

function trimRuns(runs) {
  const rs = runs.map((r) => ({ ...r })).filter((r) => r.s !== '');
  while (rs.length && !rs[0].s.trim()) rs.shift();
  while (rs.length && !rs[rs.length - 1].s.trim()) rs.pop();
  if (rs.length) {
    rs[0].s = rs[0].s.replace(/^\s+/, '');
    rs[rs.length - 1].s = rs[rs.length - 1].s.replace(/\s+$/, '');
  }
  return rs;
}

// 把 runs 在第一個換行處切成兩段
function splitFirstLine(runs) {
  const head = [], tail = [];
  let done = false;
  for (const r of runs) {
    if (done) { tail.push({ ...r }); continue; }
    const i = r.s.indexOf('\n');
    if (i < 0) { head.push({ ...r }); continue; }
    if (i > 0) head.push({ ...r, s: r.s.slice(0, i) });
    if (i < r.s.length - 1) tail.push({ ...r, s: r.s.slice(i + 1) });
    done = true;
  }
  return [head, tail];
}

const stripColon = (runs) => {
  const rs = trimRuns(runs);
  if (rs.length) rs[rs.length - 1].s = rs[rs.length - 1].s.replace(/[：:]\s*$/, '');
  return rs;
};

/* ---------- Lark 文件 → 教學（段落與區塊） ---------- */
function convertLarkDoc(spec) {
  const raw = readJSON(content('lark', spec.file));
  const B = raw.blocks;
  const titleCol = {};           // 步驟標題 → 欄位 id，文件內連結失效時的備援
  const owner = {};              // Lark 區塊 id → 所屬欄位 id（或段落）

  const larkRuns = (runs) => (runs || []).map((r) => {
    const a = r.a || {};
    const o = { s: r.s };
    if (a.bold) o.b = 1;
    if (a.textHighlight || a.textHighlightBackground) o.mark = 1;
    if (a.link) {
      const url = decodeURIComponent(a.link);
      const share = url.match(/#share-([A-Za-z0-9]+)/);
      if (share && url.includes(raw.id)) o.ref = share[1];   // 文件內連結，等流程建好後再換成網址
      else o.href = url;
    }
    return o;
  });
  const isEmpty = (b) => !b || ((b.type === 'text') && !plain(b.runs).trim() && !(b.children || []).length);
  const isPlaceholder = (b) => b.type === 'text' && /^【[A-Z]?】$/.test(plain(b.runs).trim());
  const markOwner = (id, o) => { owner[id] = o; for (const c of B[id]?.children || []) markOwner(c, o); };

  function listBlock(ids, ctx, ind = 0) {
    const ordered = B[ids[0]].type === 'ordered';
    let n = 0;
    const items = ids.map((id) => {
      const b = B[id];
      if (ordered) n = /^\d+$/.test(b.seq || '') ? Number(b.seq) : n + 1;
      const item = { r: trimRuns(larkRuns(b.runs)) };
      if (ordered) item.n = n;
      if ((b.children || []).length) item.kids = convertSeq(b.children, ctx, ind + 1);
      return item;
    });
    return { t: ordered ? 'ol' : 'ul', items };
  }

  function stepFromColumn(colId, ctx) {
    const kids = (B[colId].children || []).map((id) => B[id] && { ...B[id], id }).filter((b) => b && !isEmpty(b));
    if (!kids.length || kids.every(isPlaceholder)) return null;
    markOwner(colId, { sec: ctx.sec, col: colId });
    const imgs = kids.filter((k) => k.type === 'image').map((k) => img(spec.imgDoc, k.image.token)).filter(Boolean);
    const rest = kids.filter((k) => k.type !== 'image');
    const col = { id: colId, title: null, body: [], imgs };
    if (!rest.length) return col;

    const first = rest[0];
    const leadOrdered = first.type === 'ordered' && rest.filter((k) => k.type === 'ordered').length === 1;
    let startAt = 0;
    if (first.type === 'text' || leadOrdered) {
      const runs = trimRuns(larkRuns(first.runs));
      const txt = plain(runs);
      const [line1, remain] = splitFirstLine(runs);
      const l1 = plain(line1).trim();
      let title = null, body = null;
      if (runs[0]?.b && runs[0].s.trim()) {
        const boldEnd = runs.findIndex((r) => !r.b);
        title = stripColon(boldEnd < 0 ? runs : runs.slice(0, boldEnd));
        body = boldEnd < 0 ? [] : trimRuns(runs.slice(boldEnd));
      } else if (/^【[^】]+】/.test(txt) && txt.length < 40 && !txt.includes('\n')) {
        title = runs; body = [];
      } else if (remain.length && (/[：:]$/.test(l1) || l1.length <= 12)) {
        title = stripColon(line1); body = trimRuns(remain);
      }
      if (title) {
        col.title = title;
        titleCol[plain(title).trim()] = colId;
        if (body.length) col.body.push({ t: 'p', r: body });
        if ((first.children || []).length) col.body.push(...convertSeq(first.children, ctx, 1));
        startAt = 1;
      }
    }
    col.body.push(...convertSeq(rest.slice(startAt).map((k) => k.id), ctx));
    return col;
  }

  function convertSeq(ids, ctx, ind = 0) {
    const out = [];
    let i = 0;
    while (i < ids.length) {
      const b = B[ids[i]];
      if (!b || isEmpty(b)) { i++; continue; }
      const text = plain(b.runs).trim();

      // 「待更新」之後是草稿，不放上網站
      if (b.type === 'text' && text === '待更新') break;

      if (b.type === 'grid') {
        const cols = [];
        while (i < ids.length && (B[ids[i]]?.type === 'grid' || isEmpty(B[ids[i]]))) {
          for (const c of B[ids[i]]?.children || []) {
            const step = stepFromColumn(c, ctx);
            if (step) cols.push(step);
          }
          i++;
        }
        // 只有提示文字、沒有截圖和標題的欄位，放到步驟後面當提示
        const isTipOnly = (c) => !c.imgs.length && !c.title && c.body.length && c.body.every((x) => x.t === 'tip');
        const real = cols.filter((c) => !isTipOnly(c));
        if (real.length) out.push({ t: 'steps', cols: real });
        out.push(...cols.filter(isTipOnly).flatMap((c) => c.body));
        continue;
      }

      if (b.type === 'bullet' || b.type === 'ordered') {
        const group = [];
        while (i < ids.length && B[ids[i]]?.type === b.type) group.push(ids[i++]);
        // 單獨一行【…】的項目符號，其實是小標題
        if (group.length === 1 && b.type === 'bullet' && /^【[^】]+】$/.test(text)) out.push({ t: 'h', r: [{ s: text.slice(1, -1) }] });
        else {
          const lst = listBlock(group, ctx, ind);
          if (ind) lst.ind = ind;
          out.push(lst);
        }
        continue;
      }

      // Q1：… 形式的常見問題
      if (b.type === 'text' && /^Q\d+[：:]/.test(text)) {
        const items = [];
        while (i < ids.length) {
          const c = B[ids[i]];
          if (!c || isEmpty(c)) { i++; continue; }
          if (c.type !== 'text') break;
          const t = plain(c.runs).trim();
          if (/^Q\d+[：:]/.test(t)) items.push({ q: t.replace(/^Q\d+[：:]\s*/, ''), a: [] });
          else items[items.length - 1].a.push({ t: 'p', r: trimRuns(larkRuns(c.runs)) });
          i++;
        }
        out.push({ t: 'faq', items });
        continue;
      }

      if (/^heading[1-9]$/.test(b.type)) {
        const r = trimRuns(larkRuns(b.runs).map((x) => ({ ...x, s: x.s.replace(/\s*\n\s*/g, ' ').replace(/💡\s*/, '') })));
        out.push({ t: 'h', r });
        i++; continue;
      }

      if (b.type === 'image') {
        const im = img(spec.imgDoc, b.image.token);
        if (im) out.push({ t: 'img', ...im });
        i++; continue;
      }

      // 附件（PDF、影片）不搬上網站；緊接著的「（檔案較大…）」說明一起略過
      if (b.type === 'view' || b.type === 'file') {
        const next = B[ids[i + 1]];
        if (next?.type === 'text' && /^（.*檔案.*）$/.test(plain(next.runs).trim())) i++;
        i++; continue;
      }

      if (b.type === 'whiteboard') {
        const key = WHITEBOARDS[b.token];
        if (key) out.push({ t: 'flow', key, title: '一張圖看完整流程' });
        i++; continue;
      }

      if (b.type === 'text') {
        const r = trimRuns(larkRuns(b.runs));
        const blk = { t: 'p', r };
        if (/^💡/.test(text)) { blk.t = 'tip'; r[0].s = r[0].s.replace(/^💡\s*/, ''); }
        if (ind) blk.ind = ind;
        out.push(blk);
        if ((b.children || []).length) out.push(...convertSeq(b.children, ctx, ind + 1));
        i++; continue;
      }

      if (b.type !== 'sheet') warn(`${spec.id}：未支援的區塊類型 ${b.type}（已略過）`);
      i++;
    }
    return out;
  }

  // 以 heading1 切段落
  const sections = [];
  for (const id of B[raw.root].children || []) {
    const b = B[id];
    if (!b) continue;
    if (b.type === 'heading1') sections.push({ title: plain(b.runs).trim(), ids: [] });
    else {
      if (!sections.length) sections.push({ title: '簡介', ids: [] });
      sections.at(-1).ids.push(id);
      markOwner(id, { sec: sections.at(-1).title });
    }
  }
  const { file, imgDoc, ...meta } = spec;
  return {
    ...meta,
    sections: sections.map((s) => ({ title: s.title, blocks: convertSeq(s.ids, { sec: s.title }) })),
    owner, titleCol,
  };
}

/* ---------- 人工整理的教學 ---------- */
function normalizeCurated(g) {
  const norm = (b) => {
    if (b.t === 'img') { const im = img(b.doc, b.token, { caption: b.caption }); return im && { t: 'img', ...im }; }
    const o = { ...b };
    if (typeof o.text === 'string') { o.r = mdRuns(o.text); delete o.text; }
    if (o.t === 'ul' || o.t === 'ol') {
      o.items = o.items.map((it, k) => {
        const item = { r: mdRuns(typeof it === 'string' ? it : it.text) };
        if (o.t === 'ol') item.n = k + 1;
        return item;
      });
    }
    if (o.t === 'faq') o.items = o.items.map((it) => ({ group: it.group, q: it.q, a: [{ t: 'p', r: mdRuns(it.a) }] }));
    if (o.t === 'steps') {
      o.cols = o.cols.map((c) => ({
        label: c.num || undefined,   // 原文件上的步驟編號（例如 3.1），網站照原文顯示
        title: c.title ? mdRuns(c.title) : null,
        body: [
          ...(c.text ? [{ t: 'p', r: mdRuns(c.text) }] : []),
          ...(c.notes || []).map((n) => ({ t: 'tip', r: mdRuns(n.text) })),
        ],
        imgs: (c.imgs || []).map((i) => img(i.doc, i.token, { caption: i.caption })).filter(Boolean),
      }));
    }
    return o;
  };
  const { _說明, source, ...rest } = g;
  return { ...rest, sections: g.sections.map((s) => ({ title: s.title, blocks: s.blocks.map(norm).filter(Boolean) })) };
}

/* ---------- 教學段落 → 流程 ---------- */
const trouble = new Set(site.troubleshooting || []);

function toFlow(g, s) {
  const id = `${g.id}/${s.title}`;
  const flow = { id, gid: g.id, channel: g.channel, guide: g.title, icon: g.icon, title: s.title, intro: [], chapters: [], steps: [], faq: [], overview: null, blocks: null };
  const chapters = [];
  let cur = { title: null, intro: [], cols: [], outro: [] };
  chapters.push(cur);
  for (const b of s.blocks) {
    if (b.t === 'h') { cur = { title: plain(b.r), intro: [], cols: [], outro: [] }; chapters.push(cur); continue; }
    if (b.t === 'steps') { cur.cols.push(...b.cols); continue; }
    if (b.t === 'faq') { flow.faq.push(...b.items.map((it) => ({ ...it, group: it.group || (cur.title && !/常見問題|FAQ/i.test(cur.title) ? cur.title : undefined) }))); continue; }
    if (b.t === 'flow') { flow.overview = b.key; continue; }
    (cur.cols.length ? cur.outro : cur.intro).push(b);
  }

  const hasSteps = chapters.some((c) => c.cols.length);
  flow.kind = trouble.has(id) ? 'trouble' : hasSteps ? 'flow' : 'info';
  if (!hasSteps) {
    // 沒有截圖步驟的段落（規則、說明、FAQ）直接當文章顯示
    flow.blocks = s.blocks.filter((b) => b.t !== 'faq' && b.t !== 'flow');
    return flow;
  }

  // 沒有步驟的小標題（例如「插槍順序」），併到下一個有步驟的小標題前面
  let pending = null;
  chapters.forEach((c, ci) => {
    if (ci === 0 && !c.title) { flow.intro = c.intro; if (!c.cols.length) return; c.intro = []; }
    if (!c.cols.length) {
      if (c.intro.length) pending = pending ? { title: pending.title, intro: [...pending.intro, { t: 'h', r: [{ s: c.title || '' }] }, ...c.intro] } : { title: c.title, intro: c.intro };
      return;
    }
    const ch = {
      title: pending && pending.title ? (c.title ? `${pending.title} › ${c.title}` : pending.title) : c.title,
      intro: pending ? [...pending.intro, ...c.intro] : c.intro,
      outro: c.outro,
      start: flow.steps.length,
    };
    pending = null;
    c.cols.forEach((col) => flow.steps.push({ ...col, ch: flow.chapters.length }));
    ch.end = flow.steps.length - 1;
    flow.chapters.push(ch);
  });
  return flow;
}

/* ---------- 組合 ---------- */
const larkGuides = LARK_DOCS.map(convertLarkDoc);
const curated = fs.readdirSync(content('guides')).filter((f) => f.endsWith('.json')).map((f) => normalizeCurated(readJSON(content('guides', f))));
const order = site.guideOrder || [];
const guides = [...larkGuides, ...curated].sort((a, b) => {
  const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
});
for (const g of guides) if (!site.channels.some((c) => c.id === g.channel)) warn(`教學 ${g.id} 的通路「${g.channel}」不在 content/site.json 的 channels 裡`);

const flows = guides.flatMap((g) => g.sections.map((s) => toFlow(g, s)));
const flowHref = (f, pos) => `#/f/${f.gid}/${encodeURIComponent(f.title)}${pos ? `/${pos}` : ''}`;

// 文件內連結（#share-區塊）→ 網站內的流程／畫面
function resolveRefs(node, g) {
  if (Array.isArray(node)) return node.forEach((n) => resolveRefs(n, g));
  if (!node || typeof node !== 'object') return;
  if (node.ref) {
    let o = g.owner[node.ref];
    if (!o) {
      const col = g.titleCol[node.s.trim()];
      warn(`${g.id}：Lark 原文件中「${node.s.trim()}」的連結已失效（目標區塊不存在）${col ? '，網站已改連到同名步驟；建議在 Lark 重新設定連結' : ''}`);
      if (col) o = { col };
    }
    const f = o && flows.find((x) => x.gid === g.id && (o.col ? x.steps.some((st) => st.id === o.col) : x.title === o.sec));
    if (f) node.href = flowHref(f, o.col ? f.steps.findIndex((st) => st.id === o.col) + 1 : 0);
    delete node.ref;
  }
  Object.values(node).forEach((v) => resolveRefs(v, g));
}
for (const g of larkGuides) resolveRefs(flows.filter((f) => f.gid === g.id), g);
for (const f of flows) for (const st of f.steps) delete st.id;
for (const t of trouble) if (!flows.some((f) => f.id === t)) warn(`content/site.json 的 troubleshooting 找不到流程「${t}」`);

// 「看畫面找問題」
const lookups = [];
for (const item of site.screenLookup || []) {
  const f = flows.find((x) => x.id === item.flow);
  if (!f) { warn(`content/site.json 的 screenLookup 找不到流程「${item.flow}」`); continue; }
  const picks = item.steps ? item.steps.map((t) => {
    const k = f.steps.findIndex((st) => plain(st.title).trim() === t);
    if (k < 0) warn(`screenLookup：流程「${item.flow}」沒有步驟「${t}」`);
    return k;
  }).filter((k) => k >= 0) : f.steps.map((_, k) => k);
  for (const k of picks) {
    const st = f.steps[k];
    if (!st.imgs.length) continue;
    // 內文若是「原因：… / 建議：…」格式，拆成兩欄
    const paras = st.body.filter((b) => b.t === 'p').map((b) => plain(b.r).trim());
    const cause = paras.find((p) => /^原因[：:]/.test(p));
    const fix = paras.filter((p) => p !== cause).join('\n').replace(/^建議[：:]\s*/, '');
    lookups.push({ flow: f.id, pos: k + 1, title: plain(st.title), img: st.imgs[0], cause: cause ? cause.replace(/^原因[：:]\s*/, '') : null, fix: cause ? fix : null, body: cause ? null : st.body });
  }
}

/* ---------- 流程總覽圖（白板 SVG → 改用本機圖檔） ---------- */
const overviews = {};
fs.rmSync(path.join(SITE, 'flows'), { recursive: true, force: true });
for (const key of new Set(flows.map((f) => f.overview).filter(Boolean))) {
  const src = content('lark', 'whiteboards', `${key}.svg`);
  if (!fs.existsSync(src)) { warn(`缺少白板檔 ${src}`); continue; }
  const svg = fs.readFileSync(src, 'utf8').replace(/href="[^"]*\/download\/preview\/([A-Za-z0-9]+)[^"]*"/g, (all, token) => {
    const m = manifest[`wb-${key}:${token}`];
    if (!m) { warn(`流程圖 ${key} 缺少圖片 ${token}`); return all; }
    usedImages.add(m.file);
    return `href="../${m.file}"`;
  }).replace(/font-family="Noto Sans SC"/g, 'font-family="PingFang TC, Noto Sans TC, Microsoft JhengHei, sans-serif"');
  const [, w, h] = svg.match(/<svg[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"/) || [];
  fs.mkdirSync(path.join(SITE, 'flows'), { recursive: true });
  fs.writeFileSync(path.join(SITE, 'flows', `${key}.svg`), svg.replace(/(<svg[^>]*?)width="[\d.]+"([^>]*?)height="[\d.]+"/, '$1width="100%"$2height="100%"'));
  overviews[key] = { src: `flows/${key}.svg`, w: Number(w), h: Number(h) };
}

/* ---------- 資料更新時間與近期更新公告（比照 AI-Knowledge-Base） ----------
   builtAt 每次 build 都會變，不能拿來告訴使用者「內容什麼時候更新」。
   這裡把流程內容算成指紋，跟上一版 site/data/flows.js 比：
   - 指紋相同 → 沿用上一版的 updatedAt 與公告（只是重新 build，內容沒變）
   - 指紋不同 → updatedAt 改成現在，並逐條流程比對，產生「新增／異動」公告
   第一次（上一版沒有指紋）沒有比對基準，不產生公告，時間取 content/ 最後一次 commit。 */
const MAX_NOTICES = 30;
const hash = (v) => crypto.createHash('sha1').update(JSON.stringify(v)).digest('hex');

function readPrevData() {
  try {
    const raw = fs.readFileSync(path.join(SITE, 'data', 'flows.js'), 'utf8');
    return JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  } catch { return null; }
}
function lastContentCommit() {
  try { return execFileSync('git', ['log', '-1', '--format=%cI', '--', 'content'], { cwd: ROOT, encoding: 'utf8' }).trim() || null; } catch { return null; }
}

const stepKey = (st, k) => st.id || plain(st.title).trim() || `#${k}`;
const stepSig = (st) => ({ title: plain(st.title), body: hash(st.body), imgs: st.imgs.map((m) => m.src) });
const stepLabel = (f, k) => `第 ${f.steps[k].label || k + 1} 步「${plain(f.steps[k].title) || `第 ${k + 1} 個畫面`}」`;

function diffFlow(f, prev) {
  if (!prev) return { tag: '新增', note: f.steps.length ? `新增流程，共 ${f.steps.length} 個畫面。` : '新增說明。', pos: f.steps.length ? 1 : 0 };
  const prevSteps = new Map(prev.steps.map((st, k) => [stepKey(st, k), st]));
  const matched = f.steps.map((st, k) => prevSteps.get(stepKey(st, k)));
  matched.forEach((old, k) => old && prevSteps.delete(stepKey(f.steps[k], k)));
  // 人工整理的教學沒有 Lark 區塊 id，步驟改名會對不上：同一位置還沒配對的舊步驟，視為同一步改了內容
  const left = new Set(prevSteps.values());
  matched.forEach((old, k) => {
    const same = prev.steps[k];
    if (!old && !f.steps[k].id && same && left.has(same)) { matched[k] = same; left.delete(same); prevSteps.delete(stepKey(same, k)); }
  });
  const added = [], changed = [];
  f.steps.forEach((st, k) => {
    const old = matched[k];
    if (!old) { added.push(k); return; }
    const a = stepSig(st), b = stepSig(old);
    const what = [a.title !== b.title || a.body !== b.body ? '說明' : '', a.imgs.join() !== b.imgs.join() ? '截圖' : ''].filter(Boolean);
    if (what.length) changed.push([k, what.join('、')]);
  });
  const parts = [];
  const list = (ks, fmt) => (ks.length > 3 ? `${ks.slice(0, 3).map(fmt).join('、')} 等 ${ks.length} 處` : ks.map(fmt).join('、'));
  if (added.length) parts.push(`新增${list(added, (k) => stepLabel(f, k))}`);
  if (changed.length) parts.push(`${list(changed, ([k, w]) => `${stepLabel(f, k)}${w}`)}已更新`);
  if (prevSteps.size) parts.push(`移除 ${prevSteps.size} 個畫面`);
  if (hash([f.intro, f.chapters.map((c) => [c.title, c.intro, c.outro]), f.blocks]) !== hash([prev.intro, prev.chapters.map((c) => [c.title, c.intro, c.outro]), prev.blocks])) parts.push('流程說明已更新');
  if (hash(f.faq) !== hash(prev.faq)) parts.push('常見問題已更新');
  if (!parts.length) return null;
  const first = [...added, ...changed.map(([k]) => k)].sort((x, y) => x - y)[0];
  return { tag: '異動', note: `${parts.join('；')}。`, pos: first == null ? 0 : first + 1 };
}

const prevData = readPrevData();
const contentHash = hash({ flows, lookups });
let updatedAt, notices;
if (prevData?.contentHash === contentHash) {
  updatedAt = prevData.updatedAt;
  notices = prevData.notices || [];
} else if (!prevData?.contentHash) {
  updatedAt = lastContentCommit() || new Date().toISOString();
  notices = [];
} else {
  updatedAt = new Date().toISOString();
  const prevFlows = new Map(prevData.flows.map((f) => [f.id, f]));
  const fresh = flows.map((f) => {
    const d = diffFlow(f, prevFlows.get(f.id));
    return d && { id: crypto.createHash('sha1').update(`${f.id}|${updatedAt}`).digest('hex').slice(0, 12), at: updatedAt, tag: d.tag, flow: f.id, title: f.title, note: d.note, href: flowHref(f, d.pos) };
  }).filter(Boolean);
  notices = [...fresh, ...(prevData.notices || [])].slice(0, MAX_NOTICES);
  if (fresh.length) console.log(`偵測到 ${fresh.length} 條流程有變動，已寫入近期更新公告。`);
}

/* ---------- 輸出 ---------- */
const data = {
  builtAt: new Date().toISOString(),
  updatedAt,
  contentHash,
  notices,
  site: { title: site.title, subtitle: site.subtitle },
  channels: site.channels,
  synonyms: site.synonyms || [],
  guides: guides.map((g) => ({ id: g.id, channel: g.channel, title: g.title, icon: g.icon, summary: g.summary })),
  flows,
  lookups,
  overviews,
};
const json = JSON.stringify(data);
const leaks = (site.publicForbidden || []).filter((w) => json.includes(w));
if (leaks.length) {
  console.error(`✖ 網站資料含有內部用語：${leaks.join('、')}。這個 repo 是公開的，請先把相關內容拿掉。`);
  process.exit(1);
}
fs.mkdirSync(path.join(SITE, 'data'), { recursive: true });
fs.writeFileSync(path.join(SITE, 'data', 'flows.js'), `window.HC_DATA = ${json};\n`);

// 沒被任何流程用到的圖片：不該放在公開的 site/ 裡
const allImages = fs.readdirSync(path.join(SITE, 'img'), { recursive: true }).filter((f) => /\.(png|jpe?g|gif|webp)$/i.test(f)).map((f) => `img/${f}`);
const unused = allImages.filter((f) => !usedImages.has(f));
if (unused.length) {
  if (process.argv.includes('--prune')) {
    for (const f of unused) {
      const to = path.join(ROOT, 'private', 'site', f);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(path.join(SITE, f), to);
    }
    console.log(`已把 ${unused.length} 張沒用到的圖片移到 private/site/img`);
  } else warn(`site/img 有 ${unused.length} 張圖片沒被用到，執行 node scripts/build.mjs --prune 可移出網站`);
}

const steps = flows.reduce((n, f) => n + f.steps.length, 0);
console.log(`✔ ${guides.length} 份教學、${flows.length} 條流程、${steps} 個畫面、${lookups.length} 個「看畫面找問題」畫面、${usedImages.size} 張圖`);
const uniqueWarnings = [...new Set(warnings)];
if (uniqueWarnings.length) console.log(`\n需要留意（${uniqueWarnings.length}）：\n- ` + uniqueWarnings.join('\n- '));

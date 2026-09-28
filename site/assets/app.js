/* =========================================================================
   DeNDeN UI Flow 圖解（前端）
   不需要建置工具或套件；資料來自 data/flows.js（window.HC_DATA，由 scripts/build.mjs 產生）
   網址：#/                         首頁（流程總覽）
         #/f/<教學>/<流程>/<第幾步>   流程播放
         #/f/<教學>/<流程>/all       全部畫面一覽
         #/e/<第幾個>                看畫面找問題
         #/s/<關鍵字>                搜尋
   ========================================================================= */
(() => {
  'use strict';

  const D = window.HC_DATA;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* 無痕模式存不了，不影響使用 */ } },
  };

  /* ---------- 資料 ---------- */
  const chMap = Object.fromEntries(D.channels.map((c) => [c.id, c]));
  const flows = D.flows;
  let channel = store.get('uf.channel') || 'all';
  if (channel !== 'all' && !chMap[channel]) channel = 'all';
  const inCh = (f) => channel === 'all' || f.channel === channel;
  const plain = (runs) => (runs || []).map((r) => r.s).join('');
  const flowHref = (f, pos) => `#/f/${f.gid}/${encodeURIComponent(f.title)}${pos ? `/${pos}` : ''}`;
  const findFlow = (gid, title) => flows.find((f) => f.gid === gid && f.title === title);
  const chBadge = (id) => { const c = chMap[id]; return c ? `<span class="badge" style="--ch:${c.color}"><span class="ch-dot"></span>${esc(c.name)}</span>` : ''; };
  const thumb = (im) => (im ? im.th || im.src : '');
  const stepTitle = (f, i) => plain(f.steps[i].title) || (f.steps.length === 1 ? f.title : `第 ${i + 1} 個畫面`);
  const stepNo = (f, i) => f.steps[i].label || String(i + 1);
  // 截圖呈現方式：一般手機截圖整張顯示；超長截圖固定寬度可捲動；寬圖不加框
  const shotMode = (im) => { const r = im.h && im.w ? im.h / im.w : 2; return r > 2.8 ? 'long' : r < 1.3 ? 'wide' : 'phone'; };
  const KIND = {
    flow: { h: '📱 操作流程', hint: '用戶一般使用時會看到的畫面' },
    trouble: { h: '🛠️ 異常排解', hint: '用戶卡住時，對照畫面找原因' },
    info: { h: '📄 說明與常見問題', hint: '活動規則、FAQ' },
  };

  /* ---------- 文字 ---------- */
  function inline(text) {
    let h = esc(text);
    h = h.replace(/(https?:\/\/[^\s<>「」，。）)]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
    h = h.replace(/【([^】\n]{1,40})】/g, (all, x) => (x.length > 14 ? `<strong>【${x}】</strong>` : `<span class="ui">${x}</span>`));
    // 「10. 提高啟動充電成功率」這類段落參照 → 連到對應的流程
    h = h.replace(/「(?:\d+\.\s*)?([^」\n]{2,30})」/g, (all, x) => {
      const f = flows.find((fl) => fl.title === x.trim());
      return f ? `<a href="${flowHref(f)}">${all}</a>` : all;
    });
    return h;
  }
  const runsHTML = (runs) => (runs || []).map((r) => {
    let h = r.href
      ? `<a href="${esc(r.href)}"${/^https?:/.test(r.href) ? ' target="_blank" rel="noopener"' : ''}>${esc(r.s)}</a>`
      : inline(r.s);
    if (r.b) h = `<strong>${h}</strong>`;
    if (r.mark) h = `<mark>${h}</mark>`;
    return h;
  }).join('');

  function blocksHTML(blocks) {
    return (blocks || []).map((b) => {
      const ind = b.ind ? ` class="ind-${Math.min(b.ind, 2)}"` : '';
      if (b.t === 'p') return `<p${ind}>${runsHTML(b.r)}</p>`;
      if (b.t === 'h') return `<h3>${runsHTML(b.r)}</h3>`;
      if (b.t === 'tip') return `<div class="callout"><span>💡</span><div>${runsHTML(b.r)}</div></div>`;
      if (b.t === 'ul' || b.t === 'ol') {
        return `<${b.t}${ind}>${b.items.map((it) => `<li${it.n ? ` value="${it.n}"` : ''}>${runsHTML(it.r)}${it.kids ? blocksHTML(it.kids) : ''}</li>`).join('')}</${b.t}>`;
      }
      if (b.t === 'img') return `<p><img src="${esc(b.src)}" alt="" loading="lazy" style="max-width:280px;border-radius:12px;border:1px solid var(--border)"></p>`;
      return '';
    }).join('');
  }

  function faqHTML(items) {
    let last = null;
    return items.map((it) => {
      const g = it.group && it.group !== last ? `<div class="faq-group">${esc(it.group)}</div>` : '';
      last = it.group || last;
      return `${g}<details class="faq"><summary><span class="q">Q</span>${inline(it.q)}</summary><div class="qa prose">${blocksHTML(it.a)}</div></details>`;
    }).join('');
  }

  /* ---------- 首頁 ---------- */
  const footer = () => `<div class="footer">資料更新時間：${esc(new Date(D.builtAt).toLocaleString('zh-TW', { hour12: false }))}</div>`;
  const QUICK = ['無法拔槍', '扣款失敗', '發票', '隨插即充', '抽獎', 'QR Code', '優惠券', '錯誤畫面'];

  function flowCard(f) {
    const n = f.steps.length;
    let strip;
    if (n) {
      const shots = f.steps.flatMap((s) => s.imgs.slice(0, 1)).slice(0, n > 4 ? 3 : 4);
      strip = `<div class="strip">${shots.map((im) => `<img src="${esc(thumb(im))}" alt="" loading="lazy">`).join('')}${n > 4 ? `<span class="more">+${n - 3} 步</span>` : ''}</div>`;
    } else strip = `<div class="strip text">${f.faq.length ? '💬' : f.kind === 'trouble' ? '🛠️' : '📄'}</div>`;
    const meta = n ? `${n} 個畫面` : f.faq.length ? `${f.faq.length} 題問答` : '文字說明';
    const desc = plain((f.intro.find((b) => b.r) || (f.blocks || []).find((b) => b.r) || {}).r);
    return `<a class="fcard ${f.kind}" href="${flowHref(f)}" style="--ch:${chMap[f.channel]?.color}">${strip}
      <div class="info"><div class="meta">${chBadge(f.channel)}<span>${esc(f.guide)}</span></div>
        <h3>${esc(f.title)}</h3><div class="meta"><span class="pill">${meta}</span>${f.faq.length && n ? `<span class="pill">${f.faq.length} 題問答</span>` : ''}</div>
        ${desc ? `<div class="desc">${esc(desc)}</div>` : ''}</div></a>`;
  }

  const lookupsInCh = () => D.lookups.filter((l) => inCh(flows.find((f) => f.id === l.flow)));

  function lookupCard() {
    const ls = lookupsInCh();
    if (!ls.length) return '';
    return `<a class="fcard lookup" href="#/e" style="--ch:var(--blue)"><div class="strip">${ls.slice(0, 4).map((l) => `<img src="${esc(thumb(l.img))}" alt="" loading="lazy">`).join('')}</div>
      <div class="info"><div class="meta"><span class="pill on">${ls.length} 個畫面</span></div><h3>🔍 看畫面找問題</h3>
      <div class="desc">請用戶傳截圖，點選一樣的畫面，就能看到原因和處理方式。</div></div></a>`;
  }

  function viewHome() {
    const fs = flows.filter(inCh);
    const groups = ['flow', 'trouble', 'info'].map((k) => {
      const list = fs.filter((f) => f.kind === k);
      const extra = k === 'trouble' ? lookupCard() : '';
      if (!list.length && !extra) return '';
      return `<div class="group"><h2>${KIND[k].h}</h2><span class="hint">${KIND[k].hint}</span></div><div class="cards">${extra}${list.map(flowCard).join('')}</div>`;
    }).join('');
    return `<div class="wrap">
      <div class="hero"><h1>想看哪一個流程？</h1><p>點一個流程，就能像操作 App 一樣一步一步看畫面；遇到問題可以用畫面對照原因。</p>
        <div class="quick">${QUICK.map((q) => `<a href="#/s/${encodeURIComponent(q)}">${esc(q)}</a>`).join('')}</div></div>
      ${groups || '<div class="empty"><div class="big">📭</div>這個通路目前還沒有流程</div>'}
      ${footer()}</div>`;
  }

  /* ---------- 流程頁 ---------- */
  function viewFlow(f, pos, sub) {
    const n = f.steps.length;
    const crumbs = `<div class="crumbs"><a href="#/">流程總覽</a><span class="sep">/</span>${chBadge(f.channel)}<span>${esc(f.guide)}</span></div>`;
    const siblings = flows.filter((x) => x.gid === f.gid);
    const sibHTML = `<div class="more-sec"><h2>${esc(f.guide)}的其他流程</h2><div class="siblings">${siblings.map((x) => {
      const im = x.steps[0]?.imgs[0];
      return `<a href="${flowHref(x)}" class="${x === f ? 'on' : ''}">${im ? `<img src="${esc(thumb(im))}" alt="" loading="lazy">` : ''}${esc(x.title)}</a>`;
    }).join('')}</div></div>`;
    const faq = f.faq.length ? `<div class="more-sec"><h2>💬 常見問題</h2>${faqHTML(f.faq)}</div>` : '';
    const overview = f.overview && D.overviews[f.overview] ? `<a class="btn" href="${esc(D.overviews[f.overview].src)}" target="_blank" rel="noopener">🗺️ 一張圖看完整流程</a>` : '';

    // 沒有截圖步驟：直接當文章看
    if (!n) {
      return `<div class="wrap">${crumbs}<div class="v-head"><h1>${esc(f.title)}</h1></div>
        ${f.blocks && f.blocks.length ? `<div class="article prose">${blocksHTML(f.blocks)}</div>` : ''}
        ${f.faq.length ? `<div class="more-sec">${faqHTML(f.faq)}</div>` : ''}${sibHTML}${footer()}</div>`;
    }

    // 全部畫面一覽
    if (pos === 'all') {
      let lastCh = -1;
      const cells = f.steps.map((s, k) => {
        const ch = f.chapters[s.ch];
        const label = s.ch !== lastCh && ch.title ? `<div class="ch-label">${esc(ch.title)}</div>` : '';
        lastCh = s.ch;
        return `${label}<a href="${flowHref(f, k + 1)}"><span class="th">${s.imgs[0] ? `<img src="${esc(thumb(s.imgs[0]))}" alt="" loading="lazy">` : ''}</span><span class="t"><span class="n">${esc(stepNo(f, k))}</span>${esc(stepTitle(f, k))}</span></a>`;
      }).join('');
      return `<div class="wrap">${crumbs}<div class="v-head"><h1>${esc(f.title)}</h1><span class="count">共 ${n} 個畫面</span>
        <div class="acts"><a class="btn primary" href="${flowHref(f, 1)}">▶ 一步一步看</a>${overview}</div></div>
        ${f.intro.length ? `<div class="v-intro prose">${blocksHTML(f.intro)}</div>` : ''}
        <div class="grid-all">${cells}</div>${faq}${sibHTML}${footer()}</div>`;
    }

    const i = Math.min(Math.max(pos, 1), n) - 1;
    const st = f.steps[i];
    const ch = f.chapters[st.ch];
    const im = st.imgs[Math.min(sub, st.imgs.length - 1)] || null;
    const prev = i > 0 ? flowHref(f, i) : null;
    const next = i < n - 1 ? flowHref(f, i + 2) : null;
    const nextFlow = siblings[siblings.indexOf(f) + 1];
    const alt = `${stepNo(f, i)}. ${stepTitle(f, i)}`;
    // 原文件有自己的步驟編號（例如 1、2、3.1、3.2…13）時，計數也照原文顯示
    const count = st.label ? `第 ${st.label} / ${f.steps[n - 1].label} 步` : `第 ${i + 1} / ${n} 個畫面`;
    const nextHint = next
      ? `<a class="next-hint" href="${next}">${f.steps[i + 1].imgs[0] ? `<img src="${esc(thumb(f.steps[i + 1].imgs[0]))}" alt="">` : ''}<span><small>下一步</small><strong>${esc(stepTitle(f, i + 1))}</strong></span><span class="go">→</span></a>`
      : `<div class="next-hint done">✅ 這個流程到這裡結束</div>${nextFlow ? `<a class="next-hint" href="${flowHref(nextFlow)}"><span><small>接著看下一個流程</small><strong>${esc(nextFlow.title)}</strong></span><span class="go">→</span></a>` : ''}`;

    let lastCh = -1;
    const film = f.steps.map((s, k) => {
      const gap = s.ch !== lastCh && k ? '<span class="gap"></span>' : k ? '<span class="arr">→</span>' : '';
      lastCh = s.ch;
      return `${gap}<a href="${flowHref(f, k + 1)}" class="${k === i ? 'on' : ''}" title="${esc(stepTitle(f, k))}"><span class="th">${s.imgs[0] ? `<img src="${esc(thumb(s.imgs[0]))}" alt="" loading="lazy">` : ''}</span>${esc(stepNo(f, k))}. ${esc(plain(s.title))}</a>`;
    }).join('');
    const chapterPills = f.chapters.length > 1
      ? `<div class="chapters">${f.chapters.map((c) => `<a class="pill${c === ch ? ' on' : ''}" href="${flowHref(f, c.start + 1)}">${esc(c.title || '開始')}</a>`).join('')}</div>` : '';

    return `<div class="wrap">${crumbs}
      <div class="v-head"><h1>${esc(f.title)}</h1><span class="count">${count}</span>
        <div class="acts"><button class="btn" type="button" data-copy="${flowHref(f, i + 1)}">🔗 複製這一步的連結</button><a class="btn" href="${flowHref(f)}/all">▦ 全部畫面</a>${overview}</div></div>
      ${f.intro.length && i === 0 ? `<div class="v-intro prose">${blocksHTML(f.intro)}</div>` : ''}
      <div class="viewer" id="viewer">
        <div class="stage" id="stage">
          <div class="stage-box">
            <a class="arrow prev${prev ? '' : ' off'}" href="${prev || '#'}" aria-label="上一步">‹</a>
            ${im ? `<div class="shot ${shotMode(im)}" style="background-image:url('${esc(thumb(im))}')">
              <button class="zoom-btn" type="button" data-zoom="${esc(im.src)}" data-cap="${esc(alt)}" aria-label="放大畫面：${esc(alt)}"><img id="shot-img" src="${esc(im.src)}" alt="${esc(alt)}"${im.w ? ` width="${im.w}" height="${im.h}"` : ''} decoding="async"></button>
              ${shotMode(im) === 'long' ? '<span class="long-hint">↓ 長截圖，可以往下捲</span>' : ''}</div>` : '<div class="shot none">這一步沒有截圖</div>'}
            <a class="arrow next${next ? '' : ' off'}" href="${next || '#'}" aria-label="下一步">›</a>
          </div>
          ${st.imgs.length > 1 ? `<div class="alts">${st.imgs.map((m, k) => `<a href="${flowHref(f, i + 1)}/${k}" class="${m === im ? 'on' : ''}" title="${esc(m.caption || `第 ${k + 1} 張`)}"><img src="${esc(thumb(m))}" alt=""></a>`).join('')}</div>` : ''}
          ${im ? '<div class="zoom-hint">點圖片可以放大看細節</div>' : ''}
        </div>
        <div class="detail">
          <div class="top-part">
            ${ch.title ? `<div class="chapter">${esc(ch.title)}</div>` : ''}
            ${i === ch.start && ch.intro.length ? `<div class="ch-intro prose"><div class="t">先了解</div>${blocksHTML(ch.intro)}</div>` : ''}
            <div class="step-no"><span class="big-num">${esc(stepNo(f, i))}</span><small>/ ${esc(f.steps[n - 1].label || n)}</small></div>
            <h2>${st.title ? runsHTML(st.title) : esc(stepTitle(f, i))}</h2>
          </div>
          <div class="bottom-part">
            ${im && im.caption ? `<div class="caption-now">目前畫面：${esc(im.caption)}${st.imgs.length > 1 ? `（${st.imgs.indexOf(im) + 1}/${st.imgs.length}）` : ''}</div>` : ''}
            <div class="prose">${blocksHTML(st.body)}${i === ch.end ? blocksHTML(ch.outro) : ''}</div>
            ${nextHint}
          </div>
        </div>
      </div>
      <div class="film">${chapterPills}<div class="row" id="film">${film}</div></div>
      ${faq}${sibHTML}${footer()}
    </div>
    <div class="mbar"><a class="btn${prev ? '' : ' off'}" href="${prev || '#'}">‹ 上一步</a><a class="mid" href="${flowHref(f)}/all">${st.label ? `${esc(st.label)} / ${esc(f.steps[n - 1].label)}` : `${i + 1} / ${n}`}<small>全部畫面</small></a>
      ${next ? `<a class="btn primary" href="${next}">下一步 ›</a>` : nextFlow ? `<a class="btn primary" href="${flowHref(nextFlow)}">下一個流程 ›</a>` : '<a class="btn off" href="#">已完成</a>'}</div>`;
  }

  /* ---------- 看畫面找問題 ---------- */
  function viewLookup(sel) {
    const ls = lookupsInCh();
    if (!ls.length) return '<div class="wrap"><div class="empty"><div class="big">🔍</div>這個通路目前沒有可以對照的畫面</div></div>';
    const k = Math.min(Math.max(sel, 0), ls.length - 1);
    const l = ls[k];
    const f = flows.find((x) => x.id === l.flow);
    const body = l.cause
      ? `<div class="kv cause"><b>原因</b><p>${inline(l.cause)}</p></div><div class="kv fix"><b>怎麼處理</b><p>${inline(l.fix)}</p></div>`
      : `<div class="prose">${blocksHTML(l.body)}</div>`;
    return `<div class="wrap">
      <div class="hero"><h1>🔍 看畫面找問題</h1><p>請用戶傳截圖，或問他畫面上的標題，點選一樣的畫面就能看到原因和處理方式。</p></div>
      <div class="e-layout">
        <div class="e-grid">${ls.map((x, j) => `<a class="e-tile${j === k ? ' on' : ''}" href="#/e/${j}"><span class="th"><img src="${esc(thumb(x.img))}" alt="" loading="lazy"></span>${esc(x.title)}</a>`).join('')}</div>
        <div class="e-detail" id="e-detail"><button class="shot" type="button" data-zoom="${esc(l.img.src)}" data-cap="${esc(l.title)}" aria-label="放大畫面"><img src="${esc(l.img.src)}" alt="${esc(l.title)}"></button><div>
          <div class="crumbs" style="margin:0">${chBadge(f.channel)}<span>${esc(f.title)}</span></div>
          <h2>${esc(l.title)}</h2>${body}
          <a class="btn" href="${flowHref(f, l.pos)}" style="margin-top:8px">在「${esc(f.title)}」流程中查看 →</a>
        </div></div>
      </div>${footer()}</div>`;
  }

  /* ---------- 搜尋 ---------- */
  const PUNCT = /[\s​.,，。、:：;；!！?？()（）「」『』【】\[\]\-_/|｜~～·・'"“”‘’…]+/g;
  const norm = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(PUNCT, '');
  const SYN = (D.synonyms || []).map((g) => g.map(norm).filter(Boolean));
  const FILLER = /(請問|怎麼辦|怎麼|如何|為什麼|為何|能不能|可不可以|是不是|可以|一直|我的|我們|我|你|要|嗎|呢|吧|啊|了|的|啦|喔|耶)/g;
  const textOf = (blocks) => (blocks || []).map((b) => (b.r ? plain(b.r) : b.items ? b.items.map((it) => `${plain(it.r)} ${textOf(it.kids)}`).join(' ') : '')).join(' ');

  const docs = [];
  const addDoc = (d) => { d.nt = norm(d.title); d.nb = norm(d.body); d.all = d.nt + d.nb; docs.push(d); };
  flows.forEach((f) => {
    addDoc({ kind: 'flow', f, title: f.title, body: `${f.guide} ${textOf(f.intro)} ${textOf(f.blocks)} ${f.chapters.map((c) => `${c.title || ''} ${textOf(c.intro)} ${textOf(c.outro)}`).join(' ')}`, href: flowHref(f), img: f.steps[0]?.imgs[0] });
    f.steps.forEach((s, k) => addDoc({ kind: 'step', f, k, title: stepTitle(f, k), body: `${textOf(s.body)} ${s.imgs.map((m) => m.caption || '').join(' ')} ${f.chapters[s.ch].title || ''}`, href: flowHref(f, k + 1), img: s.imgs[0] }));
    f.faq.forEach((q) => addDoc({ kind: 'faq', f, title: q.q, body: textOf(q.a), href: flowHref(f) }));
  });

  function expand(term) {
    const t = norm(term);
    const alts = new Set([t]);
    SYN.forEach((grp) => { if (grp.some((x) => t === x || (x.length >= 2 && t.includes(x)))) grp.forEach((x) => alts.add(x)); });
    return [...alts].filter(Boolean);
  }
  function termScore(d, alts) {
    let best = 0;
    for (const a of alts) {
      if (d.nt.includes(a)) best = Math.max(best, d.nt === a ? 16 : 10);
      else if (d.nb.includes(a)) best = Math.max(best, 3);
    }
    if (best) return best;
    // 模糊比對：去掉口語贅字與疊字（轉圈圈 → 轉圈）後再比，最後才看雙字詞覆蓋率
    const core = alts[0].replace(FILLER, '').replace(/(.)\1+/gu, '$1');
    if (core.length >= 2 && core !== alts[0]) {
      if (d.nt.includes(core)) return 8;
      if (d.nb.includes(core)) return 4;
    }
    if (core.length >= 3) {
      const grams = [];
      for (let j = 0; j < core.length - 1; j++) grams.push(core.slice(j, j + 2));
      const hit = grams.filter((g) => d.all.includes(g)).length / grams.length;
      if (hit >= 0.6) return 1 + 3 * hit;
    }
    return 0;
  }
  function search(q) {
    const terms = q.trim().split(/\s+/).filter(Boolean).map(expand);
    const hits = [];
    for (const d of docs) {
      if (!inCh(d.f)) continue;
      let total = 0;
      let ok = terms.length > 0;
      for (const alts of terms) { const s = termScore(d, alts); if (!s) { ok = false; break; } total += s; }
      if (!ok) continue;
      // 流程名稱就命中時優先；只在內文命中時降權，避免蓋過真正的那一步
      if (d.kind === 'flow') total *= terms.every((alts) => alts.some((a) => d.nt.includes(a))) ? 1.4 : 0.5;
      hits.push({ d, score: total });
    }
    hits.sort((a, b) => b.score - a.score);
    const seen = new Set(hits.filter((h) => h.d.kind === 'step').map((h) => h.d.f.id));
    return {
      list: hits.filter((h) => !(h.d.kind === 'flow' && seen.has(h.d.f.id) && h.score < 14)).slice(0, 40).map((h) => h.d),
      words: [...new Set([q.trim(), ...q.trim().split(/\s+/), ...terms.flat()])].filter(Boolean),
    };
  }
  function highlight(text, words) {
    const ws = [...words].sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!ws.length) return esc(text);
    return String(text).split(new RegExp(`(${ws.join('|')})`, 'gi')).map((p, j) => (j % 2 ? `<mark>${esc(p)}</mark>` : esc(p))).join('');
  }
  function snippet(text, words) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    const lower = t.toLowerCase();
    let pos = -1;
    for (const w of words) { const p = lower.indexOf(w.toLowerCase()); if (p >= 0 && (pos < 0 || p < pos)) pos = p; }
    const start = Math.max(0, pos - 30);
    return (start > 0 ? '…' : '') + t.slice(start, start + 110) + (t.length > start + 110 ? '…' : '');
  }
  function viewSearch(q) {
    const { list, words } = search(q);
    const chName = channel === 'all' ? '' : `（只搜尋 ${chMap[channel].name}）`;
    const item = (d) => {
      const label = d.kind === 'step' ? `${stepNo(d.f, d.k)}. ${d.title}` : d.title;
      const where = d.kind === 'step' ? `${esc(d.f.title)} › 第 ${d.k + 1} 個畫面` : d.kind === 'faq' ? `${esc(d.f.title)} › 常見問題` : `${esc(d.f.guide)} › 整個流程`;
      return `<a class="r-item" href="${d.href}">${d.img ? `<span class="r-thumb"><img src="${esc(thumb(d.img))}" alt="" loading="lazy"></span>` : `<span class="r-thumb icon">${d.kind === 'faq' ? '💬' : '📄'}</span>`}
        <span class="r-main"><div class="r-title">${highlight(label, words)}</div><div class="r-path">${chBadge(d.f.channel)}<span>${where}</span></div>
        <div class="r-snip">${highlight(snippet(d.body, words), words)}</div></span></a>`;
    };
    return `<div class="wrap results"><h1>「${esc(q)}」的搜尋結果</h1>
      <div class="hint">${list.length ? `找到 ${list.length} 個相關畫面或流程${chName}` : ''}</div>
      ${list.length ? list.map(item).join('') : `<div class="empty"><div class="big">🔍</div>找不到相關內容${chName}。<br>換個說法試試看，例如：${QUICK.slice(0, 4).map((x) => `<a href="#/s/${encodeURIComponent(x)}">${esc(x)}</a>`).join('、')}${channel !== 'all' ? '<br><br><button class="btn" type="button" data-ch="all">改搜尋全部通路</button>' : ''}</div>`}
      ${footer()}</div>`;
  }

  /* ---------- 路由 ---------- */
  function parseRoute() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter((x) => x !== '').map((x) => { try { return decodeURIComponent(x); } catch { return x; } });
    if (parts[0] === 'f') {
      const f = findFlow(parts[1], parts[2]);
      if (f) return { view: 'flow', f, pos: parts[3] === 'all' ? 'all' : Number(parts[3]) || 1, sub: Number(parts[4]) || 0 };
    }
    if (parts[0] === 'e') return { view: 'lookup', sel: Number(parts[1]) || 0, picked: parts.length > 1 };
    if (parts[0] === 's') return { view: 'search', q: parts.slice(1).join('/') };
    return { view: 'home' };
  }

  let lastFlow = null;
  function render() {
    const r = parseRoute();
    let html, title;
    if (r.view === 'flow') { html = viewFlow(r.f, r.pos, r.sub); title = r.pos === 'all' || !r.f.steps.length ? r.f.title : `${r.f.title}（${stepNo(r.f, Math.min(r.pos, r.f.steps.length) - 1)}/${r.f.steps.at(-1).label || r.f.steps.length}）`; }
    else if (r.view === 'lookup') { html = viewLookup(r.sel); title = '看畫面找問題'; }
    else if (r.view === 'search') { html = viewSearch(r.q); title = `搜尋：${r.q}`; }
    else { html = viewHome(); title = null; }
    $('#app').innerHTML = html;
    document.title = title ? `${title}｜${D.site.title}` : D.site.title;
    document.querySelectorAll('.top-nav a').forEach((a) => a.classList.toggle('on', (a.dataset.nav === 'e' && r.view === 'lookup') || (a.dataset.nav === 'home' && r.view === 'home')));
    const q = $('#q');
    if (document.activeElement !== q) q.value = r.view === 'search' ? r.q : '';
    $('#q-clear').hidden = !q.value;

    // 同一條流程換步驟：停在畫面的位置；換到別頁：回到頂端
    const stepping = r.view === 'flow' && typeof r.pos === 'number';
    if (stepping && lastFlow === r.f.id) {
      const v = $('#viewer');
      if (v && v.getBoundingClientRect().top < 0) v.scrollIntoView({ block: 'start' });
    } else if (r.view === 'lookup' && r.picked && innerWidth <= 900) {
      $('#e-detail')?.scrollIntoView({ block: 'start' });
    } else window.scrollTo(0, 0);
    lastFlow = stepping ? r.f.id : null;

    const shot = $('#shot-img');
    if (shot) { const done = () => shot.classList.add('ok'); if (shot.complete && shot.naturalWidth) done(); else shot.addEventListener('load', done, { once: true }); }
    if (stepping && r.f.steps.length) {
      const film = $('#film');
      const on = film && film.querySelector('a.on');
      if (on) film.scrollLeft = on.offsetLeft - film.clientWidth / 2 + on.clientWidth / 2;
      // 先載入下一步的圖，按下一步時比較快
      const nx = r.f.steps[Math.min(r.pos, r.f.steps.length - 1)]?.imgs[0];
      if (nx) new Image().src = nx.src;
    }
  }

  /* ---------- 互動 ---------- */
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 1600);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    toast('已複製連結，可以直接傳給用戶');
  }

  let zoomTrigger = null;
  function zoom(src, cap, trigger) {
    zoomTrigger = trigger;
    $('#lb-img').src = src;
    $('#lb-cap').textContent = cap || '';
    $('#lightbox').hidden = false;
    $('.lb-scroll').scrollTop = 0;
    document.body.style.overflow = 'hidden';
    $('.lb-close').focus();
  }
  function unzoom() {
    $('#lightbox').hidden = true;
    document.body.style.overflow = '';
    if (zoomTrigger) zoomTrigger.focus();
  }

  function step(delta) {
    const r = parseRoute();
    if (r.view !== 'flow' || typeof r.pos !== 'number' || !r.f.steps.length) return;
    const to = r.pos + delta;
    if (to >= 1 && to <= r.f.steps.length) location.hash = flowHref(r.f, to);
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-ch],[data-copy],[data-zoom],[data-theme-set],.lb-close,#q-clear');
    if (!t) return;
    if (t.dataset.themeSet) {
      theme = t.dataset.themeSet;
      store.set('uf.theme', theme);
      applyTheme();
      renderChannels();
    } else if (t.dataset.ch) {
      channel = t.dataset.ch;
      store.set('uf.channel', channel);
      renderChannels();
      render();
    } else if (t.dataset.copy) copyText(`${location.href.split('#')[0]}${t.dataset.copy}`);
    else if (t.dataset.zoom) zoom(t.dataset.zoom, t.dataset.cap, t);
    else if (t.classList.contains('lb-close')) unzoom();
    else if (t.id === 'q-clear') { $('#q').value = ''; $('#q-clear').hidden = true; $('#q').focus(); location.hash = '#/'; }
  });
  $('#lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') unzoom(); });

  document.addEventListener('keydown', (e) => {
    if (!$('#lightbox').hidden) { if (e.key === 'Escape') unzoom(); return; }
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
    if (typing) { if (e.key === 'Escape') document.activeElement.blur(); return; }
    if (e.key === '/') { e.preventDefault(); $('#q').focus(); }
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
  });

  // 手機：在畫面上左右滑動換步驟
  let touch = null;
  document.addEventListener('touchstart', (e) => { touch = e.target.closest('#stage') ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (!touch) return;
    const dx = e.changedTouches[0].clientX - touch.x;
    const dy = e.changedTouches[0].clientY - touch.y;
    touch = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
  });

  let timer = null;
  $('#q').addEventListener('input', () => {
    $('#q-clear').hidden = !$('#q').value;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const v = $('#q').value.trim();
      const h = v ? `#/s/${encodeURIComponent(v)}` : '#/';
      if (parseRoute().view === 'search') { history.replaceState(null, '', h); render(); } else if (v) location.hash = h;
    }, 180);
  });
  $('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter' && $('#q').value.trim()) location.hash = `#/s/${encodeURIComponent($('#q').value.trim())}`; });

  const THEMES = [['auto', '◐', '跟隨系統'], ['light', '☀︎', '淺色'], ['dark', '☾', '深色']];
  let theme = store.get('uf.theme') || 'auto';
  function applyTheme() {
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }
  function renderChannels() {
    const tabs = [{ id: 'all', name: '全部' }, ...D.channels];
    $('#channelbar').innerHTML = `<span class="label">通路</span>${tabs.map((c) => `<button type="button" class="ch-tab" data-ch="${c.id}" aria-pressed="${channel === c.id}">${c.color ? `<span class="ch-dot" style="--ch:${c.color}"></span>` : ''}${esc(c.name)}</button>`).join('')}`
      + `<div class="theme-seg" role="group" aria-label="外觀"><span class="label">外觀</span>${THEMES.map(([id, icon, name]) => `<button type="button" data-theme-set="${id}" aria-pressed="${theme === id}" title="${name}" aria-label="外觀：${name}"><span aria-hidden="true">${icon}</span><span class="t">${name}</span></button>`).join('')}</div>`;
  }

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  if (/[?&]theme=(light|dark)/.test(location.search)) theme = location.search.match(/theme=(\w+)/)[1];
  applyTheme();
  $('#brand-title').textContent = D.site.title;
  $('#brand-sub').textContent = D.site.subtitle || '';
  renderChannels();
  window.addEventListener('hashchange', render);
  render();
})();

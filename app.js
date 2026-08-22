/* TESR PDF Editor — client-side (pdf-lib + PDF.js + JSZip) */
'use strict';
const LIBS_OK = typeof PDFLib !== 'undefined' && typeof pdfjsLib !== 'undefined' && typeof JSZip !== 'undefined';
const { PDFDocument, degrees, rgb, BlendMode, LineCapStyle } = LIBS_OK ? PDFLib : {};
if (LIBS_OK) pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

/* ---------- utils ---------- */
const $ = s => document.querySelector(s);
const el = (t, a = {}, h = '') => { const e = document.createElement(t); Object.assign(e, a); if (h) e.innerHTML = h; return e; };
const svgEl = (t, a = {}) => { const e = document.createElementNS('http://www.w3.org/2000/svg', t); for (const k in a) e.setAttribute(k, a[k]); return e; };
const fmtSize = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(2) + ' MB';
const readBytes = f => f.arrayBuffer().then(b => new Uint8Array(b));
const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2600); }
function busy(on, msg, p) { const b = $('#busy'); b.classList.toggle('on', !!on); if (msg) $('#busyMsg').textContent = msg; $('#busyBar').style.width = ((p || 0) * 100) + '%'; }
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); }
function download(blob, name) { const a = el('a', { href: URL.createObjectURL(blob), download: name }); document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }
function parseRanges(str, max) { const o = new Set(); str.split(/[,\s]+/).filter(Boolean).forEach(p => { const m = p.match(/^(\d+)(?:-(\d+))?$/); if (!m) return; let a = +m[1], b = m[2] ? +m[2] : a; if (a > b) [a, b] = [b, a]; for (let i = a; i <= b; i++) if (i >= 1 && i <= max) o.add(i); }); return [...o].sort((a, b) => a - b); }
const canvasBlob = (c, t = 'image/jpeg', q = .85) => new Promise(r => c.toBlob(r, t, q));
const canvasBytes = async (c, t, q) => new Uint8Array(await (await canvasBlob(c, t, q)).arrayBuffer());
const settings = JSON.parse(localStorage.getItem('tesr.settings') || '{}');
if (LIBS_OK && document.fonts) ['500 16px Sarabun','700 16px Sarabun','500 16px Kanit','700 16px Kanit'].forEach(f => document.fonts.load(f).catch(() => {}));
const meta = { title: '', author: settings.author || 'TESR Co., Ltd.', subject: '', keywords: '' };

/* text geometry (shared by SVG overlay & PNG export) */
const mctx = document.createElement('canvas').getContext('2d');
function fontStr(a, scale = 1) { return `${a.bold ? 700 : 500} ${a.size * scale}px ${a.font || 'Sarabun'}, sans-serif`; }
function measureText(a) { mctx.font = fontStr(a); const lines = String(a.text || ' ').split('\n'); const w = Math.max(...lines.map(l => mctx.measureText(l).width)); const pad = a.size * .3, lh = a.size * 1.4; return { w: w + pad * 2, h: pad * 2 + lines.length * lh, pad, lh, lines }; }
async function textToPng(a, scale = 3) {
  const m = measureText(a); const c = document.createElement('canvas'); c.width = Math.ceil(m.w * scale); c.height = Math.ceil(m.h * scale); const ctx = c.getContext('2d');
  try { await document.fonts.load(fontStr(a)); } catch { }
  ctx.scale(scale, scale); ctx.font = fontStr(a); ctx.fillStyle = a.color || '#000'; ctx.textBaseline = 'alphabetic';
  m.lines.forEach((l, i) => ctx.fillText(l, m.pad, m.pad + i * m.lh + a.size * .9));
  return { bytes: await canvasBytes(c, 'image/png'), w: m.w, h: m.h };
}
async function imageFileToAsset(file, { maxW = 2000, enhance = false, type = null } = {}) {
  const bmp = await createImageBitmap(file); let w = bmp.width, h = bmp.height; if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
  const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d'); ctx.drawImage(bmp, 0, 0, w, h);
  if (enhance) { const d = ctx.getImageData(0, 0, w, h), p = d.data; for (let i = 0; i < p.length; i += 4) { let g = .3 * p[i] + .59 * p[i + 1] + .11 * p[i + 2]; g = (g - 128) * 1.6 + 150; p[i] = p[i + 1] = p[i + 2] = clamp(g, 0, 255); } ctx.putImageData(d, 0, 0); }
  const t = type || (file.type === 'image/png' || file.type === 'image/webp' ? 'image/png' : 'image/jpeg');
  const bytes = await canvasBytes(c, t, .9); return { id: uid(), bytes, type: t, w, h, url: c.toDataURL(t === 'image/png' ? 'image/png' : 'image/jpeg', .85) };
}

/* ---------- document model ---------- */
const docs = [];      // {bytes, pdf (pdfjs), lib (pdf-lib, lazy)}
let pages = [];       // {id, doc, src, w, h, baseRot, rot, annots:[]}
const assets = {};    // id -> {bytes,type,w,h,url}
let zoom = 1, curPage = 0, tool = 'select', sel = null, fileName = 'document.pdf';
const hist = [], redo = [];
const thumbCache = {};
const TD = { // tool defaults
  text: { size: 16, color: '#000000', font: 'Sarabun', bold: false },
  draw: { color: '#b8102a', width: 3 }, highlight: { color: '#ffe600' }, whiteout: { color: '#ffffff' },
  shape: { kind: 'rect', stroke: '#b8102a', width: 2, fill: '#ffffff', fillOn: false },
  image: { asset: null }, sign: { asset: null },
  wm: { type: 'text', text: settings.wm || 'TESR CONFIDENTIAL', opacity: 25, rotate: 45, size: 60, color: '#b8102a', all: true },
  pagenum: { pos: 'bc', fmt: '{n}', size: 11, color: '#000000', start: 1, skip: false },
};
const dispSize = p => { const r = (p.baseRot + p.rot) % 360; return r % 180 ? { W: p.h, H: p.w, r } : { W: p.w, H: p.h, r }; };

async function getLib(i) { if (!docs[i].lib) docs[i].lib = await PDFDocument.load(docs[i].bytes, { ignoreEncryption: true }); return docs[i].lib; }
async function addDocBytes(bytes) {
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise; const di = docs.length; docs.push({ bytes, pdf, lib: null }); const added = [];
  for (let i = 1; i <= pdf.numPages; i++) { const pg = await pdf.getPage(i); const vp = pg.getViewport({ scale: 1, rotation: 0 }); added.push({ id: uid(), doc: di, src: i - 1, w: vp.width, h: vp.height, baseRot: pg.rotate || 0, rot: 0, annots: [] }); }
  return added;
}
async function imageToPdfBytes(file, enhance) {
  const a = await imageFileToAsset(file, { maxW: 2400, enhance, type: 'image/jpeg' }); const d = await PDFDocument.create(); const img = await d.embedJpg(a.bytes);
  const land = a.w > a.h; const [pw, ph] = land ? [841.89, 595.28] : [595.28, 841.89]; const s = Math.min(pw / a.w, ph / a.h); const w = a.w * s, h = a.h * s;
  d.addPage([pw, ph]).drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h }); return d.save();
}
async function loadFiles(files, { append = false, enhance = false } = {}) {
  if (!LIBS_OK) return toast('โหลดไลบรารีไม่สำเร็จ — ตรวจสอบอินเทอร์เน็ตแล้วรีเฟรช');
  files = [...files].filter(f => /pdf$/i.test(f.name) || f.type === 'application/pdf' || f.type.startsWith('image/')); if (!files.length) return toast('รองรับเฉพาะ PDF และรูปภาพ');
  busy(true, 'กำลังเปิดไฟล์…', 0);
  try {
    if (!append) { docs.length = 0; pages = []; hist.length = 0; redo.length = 0; sel = null; fileName = files[0].name.replace(/\.[^.]+$/, '') + '.pdf'; } else snapshot();
    for (let i = 0; i < files.length; i++) {
      const f = files[i]; const bytes = f.type.startsWith('image/') ? await imageToPdfBytes(f, enhance) : await readBytes(f);
      try { pages.push(...await addDocBytes(bytes)); } catch (e) { console.error(e); toast('เปิดไม่ได้: ' + f.name); }
      busy(true, 'กำลังเปิดไฟล์…', (i + 1) / files.length);
    }
    if (!pages.length) throw new Error('ไม่มีหน้าเอกสาร');
    $('#landing').style.display = 'none'; $('#editor').classList.add('on'); $('#fname').textContent = fileName;
    setTool('select'); if (!append) { zoomFit(); } buildStage(); buildThumbs(); updateInfo();
  } catch (e) { toast(e.message); } finally { busy(false); }
}
function updateInfo() { $('#finfo').textContent = `${pages.length} หน้า · ${docs.length} ไฟล์ต้นทาง`; $('#pgCount').textContent = pages.length; $('#undoBtn').disabled = !hist.length; $('#redoBtn').disabled = !redo.length; }

/* ---------- history ---------- */
const serialize = () => JSON.stringify(pages);
function snapshot() { hist.push(serialize()); if (hist.length > 60) hist.shift(); redo.length = 0; updateInfo(); }
function restore(s) { pages = JSON.parse(s); sel = null; buildStage(); buildThumbs(); renderProps(); updateInfo(); }
function undo() { if (!hist.length) return; redo.push(serialize()); restore(hist.pop()); }
function redoFn() { if (!redo.length) return; hist.push(serialize()); restore(redo.pop()); }

/* ---------- stage ---------- */
const stage = $('#stage'); let pageEls = [];
const io = new IntersectionObserver(en => en.forEach(e => { if (e.isIntersecting) renderPageCanvas(+e.target.dataset.i); }), { root: stage, rootMargin: '500px 0px' });
function buildStage() {
  stage.innerHTML = ''; pageEls = []; io.disconnect();
  pages.forEach((p, i) => {
    const { W, H } = dispSize(p); const d = el('div', { className: 'pg' }); d.dataset.i = i; d.style.width = W * zoom + 'px'; d.style.height = H * zoom + 'px';
    const c = el('canvas'); const ov = svgEl('svg', { class: 'ov', viewBox: `0 0 ${W} ${H}` }); d.append(c, ov, el('div', { className: 'lbl' }, `หน้า ${i + 1}`)); stage.appendChild(d); pageEls.push(d); io.observe(d); drawOverlay(i);
  });
}
async function renderPageCanvas(i) {
  const p = pages[i], d = pageEls[i]; if (!p || !d) return; const key = `${p.doc}:${p.src}:${p.rot}:${zoom.toFixed(3)}`; if (d.dataset.key === key) return; d.dataset.key = key;
  const c = d.querySelector('canvas'); const { W, H, r } = dispSize(p); const dpr = Math.min(window.devicePixelRatio || 1, 2); c.width = Math.round(W * zoom * dpr); c.height = Math.round(H * zoom * dpr);
  if (p.src == null) { const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); return; }
  const pg = await docs[p.doc].pdf.getPage(p.src + 1); const vp = pg.getViewport({ scale: zoom * dpr, rotation: r });
  if (d._task) { try { d._task.cancel(); } catch { } } d._task = pg.render({ canvasContext: c.getContext('2d'), viewport: vp }); try { await d._task.promise; } catch { } d._task = null;
}
function setZoom(z, keepRatio = true) { const ratio = stage.scrollTop / Math.max(1, stage.scrollHeight); zoom = clamp(z, .2, 4); $('#zoomLbl').textContent = Math.round(zoom * 100) + '%'; pageEls.forEach((d, i) => { const { W, H } = dispSize(pages[i]); d.style.width = W * zoom + 'px'; d.style.height = H * zoom + 'px'; d.dataset.key = ''; }); if (keepRatio) stage.scrollTop = ratio * stage.scrollHeight; pageEls.forEach((d, i) => { const r = d.getBoundingClientRect(), s = stage.getBoundingClientRect(); if (r.bottom > s.top - 500 && r.top < s.bottom + 500) renderPageCanvas(i); }); }
function zoomFit() { const maxW = Math.max(...pages.map(p => dispSize(p).W)); const avail = stage.clientWidth - 34 || 600; zoom = clamp(avail / maxW, .2, 2.5); $('#zoomLbl').textContent = Math.round(zoom * 100) + '%'; }
$('#zoomIn').onclick = () => setZoom(zoom * 1.2); $('#zoomOut').onclick = () => setZoom(zoom / 1.2); $('#zoomFit').onclick = () => { zoomFit(); setZoom(zoom); };
stage.addEventListener('scroll', () => { let best = 0, bd = 1e9; const st = stage.getBoundingClientRect().top + 80; pageEls.forEach((d, i) => { const r = d.getBoundingClientRect(); const dd = Math.abs(r.top - st); if (dd < bd && r.bottom > st) { bd = dd; best = i; } }); if (best !== curPage) { curPage = best; markCurThumb(); } }, { passive: true });
function scrollToPage(i) { curPage = i; pageEls[i]?.scrollIntoView({ block: 'start', behavior: 'smooth' }); markCurThumb(); }

/* ---------- overlay rendering ---------- */
function drawOverlay(i) {
  const p = pages[i], ov = pageEls[i]?.querySelector('.ov'); if (!ov) return; ov.innerHTML = '';
  p.annots.forEach(a => ov.appendChild(annotSvg(a)));
  if (sel && sel.page === i) { const a = p.annots.find(x => x.id === sel.id); if (a) { const b = bbox(a); ov.appendChild(svgEl('rect', { class: 'selbox', x: b.x, y: b.y, width: b.w, height: b.h })); if (a.type !== 'line' && a.type !== 'arrow') ov.appendChild(svgEl('circle', { class: 'hdl', cx: b.x + b.w, cy: b.y + b.h, r: 6 / zoom, 'data-hdl': '1' })); } }
}
function bbox(a) { if (a.type === 'line' || a.type === 'arrow') return { x: Math.min(a.x1, a.x2), y: Math.min(a.y1, a.y2), w: Math.abs(a.x2 - a.x1) || 1, h: Math.abs(a.y2 - a.y1) || 1 }; return { x: a.x, y: a.y, w: a.w, h: a.h }; }
function annotSvg(a) {
  let e; const op = a.opacity != null ? a.opacity : 1;
  switch (a.type) {
    case 'text': { const m = measureText(a); e = svgEl('g'); const bg = svgEl('rect', { x: a.x, y: a.y, width: a.w, height: a.h, fill: 'transparent' }); e.appendChild(bg); const t = svgEl('text', { x: a.x + m.pad, y: a.y + m.pad + a.size * .9, 'font-size': a.size, fill: a.color, 'font-family': `${a.font || 'Sarabun'}, sans-serif`, 'font-weight': a.bold ? 700 : 500, opacity: op }); m.lines.forEach((l, k) => { const ts = svgEl('tspan', { x: a.x + m.pad, y: a.y + m.pad + a.size * .9 + k * m.lh }); ts.textContent = l; t.appendChild(ts); }); e.appendChild(t); break; }
    case 'image': e = svgEl('image', { x: a.x, y: a.y, width: a.w, height: a.h, href: assets[a.asset]?.url || '', preserveAspectRatio: 'none', opacity: op }); break;
    case 'highlight': e = svgEl('rect', { x: a.x, y: a.y, width: a.w, height: a.h, fill: a.color, opacity: .45, style: 'mix-blend-mode:multiply' }); break;
    case 'whiteout': e = svgEl('rect', { x: a.x, y: a.y, width: a.w, height: a.h, fill: a.color }); break;
    case 'rect': e = svgEl('rect', { x: a.x, y: a.y, width: a.w, height: a.h, fill: a.fillOn ? a.fill : 'none', stroke: a.stroke, 'stroke-width': a.width }); break;
    case 'ellipse': e = svgEl('ellipse', { cx: a.x + a.w / 2, cy: a.y + a.h / 2, rx: a.w / 2, ry: a.h / 2, fill: a.fillOn ? a.fill : 'none', stroke: a.stroke, 'stroke-width': a.width }); break;
    case 'line': case 'arrow': { e = svgEl('g'); e.appendChild(svgEl('line', { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, stroke: a.stroke, 'stroke-width': a.width, 'stroke-linecap': 'round' })); if (a.type === 'arrow') { const [h1, h2] = arrowHead(a); e.appendChild(svgEl('line', { x1: a.x2, y1: a.y2, x2: h1[0], y2: h1[1], stroke: a.stroke, 'stroke-width': a.width, 'stroke-linecap': 'round' })); e.appendChild(svgEl('line', { x1: a.x2, y1: a.y2, x2: h2[0], y2: h2[1], stroke: a.stroke, 'stroke-width': a.width, 'stroke-linecap': 'round' })); } e.appendChild(svgEl('line', { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, stroke: 'transparent', 'stroke-width': Math.max(14, a.width + 10) })); break; }
    case 'ink': e = svgEl('path', { d: inkPath(a), fill: 'none', stroke: a.stroke, 'stroke-width': a.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }); break;
  }
  if (a.rotate) { const b = bbox(a); e.setAttribute('transform', `rotate(${-a.rotate} ${b.x + b.w / 2} ${b.y + b.h / 2})`); }
  e.classList.add('an'); e.dataset.id = a.id; return e;
}
function arrowHead(a) { const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1), L = Math.max(10, a.width * 4); return [[a.x2 - L * Math.cos(ang - .5), a.y2 - L * Math.sin(ang - .5)], [a.x2 - L * Math.cos(ang + .5), a.y2 - L * Math.sin(ang + .5)]]; }
function inkPath(a) { return a.pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' '); }
function inkBounds(a) { const xs = a.pts.map(p => p[0]), ys = a.pts.map(p => p[1]); a.x = Math.min(...xs); a.y = Math.min(...ys); a.w = Math.max(...xs) - a.x || 1; a.h = Math.max(...ys) - a.y || 1; }

/* ---------- tools ---------- */
const I = {
  select: '<svg viewBox="0 0 24 24"><path d="M5 3l14 8-6 2-3 6z"/></svg>', text: '<svg viewBox="0 0 24 24"><path d="M5 6V4h14v2M12 4v16M9 20h6"/></svg>',
  highlight: '<svg viewBox="0 0 24 24"><path d="M9 15l-4 4H3l2-2 1-3 8-8 3 3zM14 5l2-2 3 3-2 2"/><path d="M4 21h16"/></svg>', draw: '<svg viewBox="0 0 24 24"><path d="M4 20c2-7 6-9 8-7s-2 6 0 7 5-5 8-6"/></svg>',
  whiteout: '<svg viewBox="0 0 24 24"><path d="M3 17l7 4 11-11-7-7L3 14z"/><path d="M10 21l-5-5"/><path d="M4 22h16"/></svg>', image: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5-5-8 8"/></svg>',
  shape: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="9" height="9" rx="1"/><circle cx="16.5" cy="16.5" r="4.5"/></svg>', sign: '<svg viewBox="0 0 24 24"><path d="M3 17c3-6 6-8 7-6s-1 6 0 6 3-5 5-5 1 5 3 5 2-3 3-3"/><path d="M3 21h18"/></svg>',
  wm: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M12 9c-2 2.5-3 4-3 5.5a3 3 0 006 0C15 13 14 11.5 12 9z"/></svg>', pagenum: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M11 17h2"/></svg>',
  rotate: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 11-3-6.2"/><path d="M20 4v5h-5"/></svg>', pages: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><path d="M17 14v6M14 17h6"/></svg>',
};
const TOOLS = [['select', 'เลือก'], ['text', 'ข้อความ'], ['highlight', 'ไฮไลท์'], ['draw', 'ปากกา'], ['whiteout', 'ยางลบ'], ['shape', 'รูปทรง'], ['image', 'รูปภาพ'], ['sign', 'ลายเซ็น'], null, ['wm', 'ลายน้ำ'], ['pagenum', 'เลขหน้า'], ['rotate', 'หมุนหน้า'], ['pages', 'จัดหน้า']];
$('#tools').innerHTML = TOOLS.map(t => t ? `<button class="tool" data-t="${t[0]}" title="${t[1]}">${I[t[0]]}<span>${t[1]}</span></button>` : '<div class="tool sepr"></div>').join('');
$('#tools').addEventListener('click', e => { const b = e.target.closest('.tool[data-t]'); if (b) setTool(b.dataset.t); });
function setTool(t) {
  if (t === 'rotate') { rotatePage(curPage, 90); return; }
  if (t === 'pages') { $('#ebody').classList.toggle('showThumbs'); return; }
  tool = t; sel = null; document.querySelectorAll('.tool').forEach(b => b.classList.toggle('on', b.dataset.t === t)); stage.classList.toggle('cross', t !== 'select');
  pageEls.forEach((_, i) => drawOverlay(i)); renderProps();
  if (t === 'image' && !TD.image.asset) pickImage('image'); if (t === 'sign' && !TD.sign.asset) openSignModal();
  if (window.innerWidth <= 980 && ['wm', 'pagenum', 'text', 'shape', 'draw'].includes(t)) $('#ebody').classList.add('showProps');
}
function pickImage(which) { const inp = el('input', { type: 'file', accept: 'image/*' }); inp.onchange = async () => { if (!inp.files[0]) return; const a = await imageFileToAsset(inp.files[0], { maxW: 1800 }); assets[a.id] = a; TD[which].asset = a.id; toast('แตะบนหน้าเพื่อวางรูป'); renderProps(); }; inp.click(); }

/* pointer interaction */
let drag = null;
function evPos(e) { const d = e.target.closest('.pg'); if (!d) return null; const i = +d.dataset.i, r = d.getBoundingClientRect(); return { i, x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom, d }; }
stage.addEventListener('pointerdown', e => {
  if (e.button !== 0 && e.pointerType === 'mouse') return; const pos = evPos(e); if (!pos) { if (tool === 'select') { sel = null; pageEls.forEach((_, i) => drawOverlay(i)); renderProps(); } return; }
  const { i, x, y } = pos; const p = pages[i]; curPage = i; markCurThumb();
  if (tool === 'select') {
    const hdl = e.target.closest('[data-hdl]'); const an = e.target.closest('.an');
    if (hdl && sel) { const a = p.annots.find(q => q.id === sel.id); snapshot(); drag = { kind: 'resize', i, a, sx: x, sy: y, o: JSON.parse(JSON.stringify(a)) }; }
    else if (an) { const a = p.annots.find(q => q.id === an.dataset.id); sel = { page: i, id: a.id }; snapshot(); drag = { kind: 'move', i, a, sx: x, sy: y, o: JSON.parse(JSON.stringify(a)), moved: false }; pageEls.forEach((_, k) => drawOverlay(k)); renderProps(); }
    else { sel = null; pageEls.forEach((_, k) => drawOverlay(k)); renderProps(); return; }
    stage.setPointerCapture(e.pointerId); stage.classList.add('drawing'); return;
  }
  const { W, H } = dispSize(p); e.preventDefault(); stage.setPointerCapture(e.pointerId); stage.classList.add('drawing');
  if (tool === 'text') { snapshot(); const a = { id: uid(), type: 'text', x, y, text: 'ข้อความ', ...TD.text }; Object.assign(a, measureText(a)); delete a.lines; delete a.pad; delete a.lh; p.annots.push(a); sel = { page: i, id: a.id }; drawOverlay(i); setTool('select'); sel = { page: i, id: a.id }; drawOverlay(i); renderProps(true); return; }
  if (tool === 'image' || tool === 'sign') { const aid = TD[tool].asset; if (!aid) { tool === 'image' ? pickImage('image') : openSignModal(); return; } const as = assets[aid]; const w = W * (tool === 'sign' ? .25 : .4), h = w * as.h / as.w; snapshot(); const a = { id: uid(), type: 'image', x: x - w / 2, y: y - h / 2, w, h, asset: aid }; p.annots.push(a); sel = { page: i, id: a.id }; setTool('select'); sel = { page: i, id: a.id }; drawOverlay(i); renderProps(); return; }
  snapshot(); let a;
  if (tool === 'draw') a = { id: uid(), type: 'ink', pts: [[x, y]], stroke: TD.draw.color, width: TD.draw.width, x, y, w: 1, h: 1 };
  else if (tool === 'highlight') a = { id: uid(), type: 'highlight', x, y, w: 1, h: 1, color: TD.highlight.color };
  else if (tool === 'whiteout') a = { id: uid(), type: 'whiteout', x, y, w: 1, h: 1, color: TD.whiteout.color };
  else if (tool === 'shape') { const k = TD.shape.kind; a = k === 'line' || k === 'arrow' ? { id: uid(), type: k, x1: x, y1: y, x2: x, y2: y, stroke: TD.shape.stroke, width: TD.shape.width } : { id: uid(), type: k, x, y, w: 1, h: 1, stroke: TD.shape.stroke, width: TD.shape.width, fill: TD.shape.fill, fillOn: TD.shape.fillOn }; }
  if (!a) return; p.annots.push(a); drag = { kind: 'new', i, a, sx: x, sy: y }; drawOverlay(i);
});
stage.addEventListener('pointermove', e => {
  if (!drag) return; const d = pageEls[drag.i], r = d.getBoundingClientRect(); const x = (e.clientX - r.left) / zoom, y = (e.clientY - r.top) / zoom; const a = drag.a, { W, H } = dispSize(pages[drag.i]);
  if (drag.kind === 'new') {
    if (a.type === 'ink') { a.pts.push([x, y]); inkBounds(a); }
    else if (a.type === 'line' || a.type === 'arrow') { a.x2 = x; a.y2 = y; }
    else { a.x = Math.min(drag.sx, x); a.y = Math.min(drag.sy, y); a.w = Math.abs(x - drag.sx); a.h = Math.abs(y - drag.sy); }
  } else if (drag.kind === 'move') {
    const dx = x - drag.sx, dy = y - drag.sy; drag.moved = true; const o = drag.o;
    if (a.type === 'line' || a.type === 'arrow') { a.x1 = o.x1 + dx; a.y1 = o.y1 + dy; a.x2 = o.x2 + dx; a.y2 = o.y2 + dy; }
    else { a.x = o.x + dx; a.y = o.y + dy; if (a.type === 'ink') a.pts = o.pts.map(q => [q[0] + dx, q[1] + dy]); }
  } else if (drag.kind === 'resize') {
    const o = drag.o; let nw = Math.max(8, o.w + (x - drag.sx)), nh = Math.max(8, o.h + (y - drag.sy));
    if (a.type === 'text') { const s = nw / o.w; a.size = Math.max(4, o.size * s); Object.assign(a, (({ w, h }) => ({ w, h }))(measureText(a))); }
    else if (a.type === 'image' && !e.shiftKey) { a.w = nw; a.h = nw * o.h / o.w; }
    else if (a.type === 'ink') { const sx = nw / o.w, sy = nh / o.h; a.pts = o.pts.map(q => [o.x + (q[0] - o.x) * sx, o.y + (q[1] - o.y) * sy]); inkBounds(a); }
    else { a.w = nw; a.h = nh; }
  }
  drawOverlay(drag.i);
});
function endDrag(e) {
  if (!drag) return; const { a, i, kind } = drag; const p = pages[i];
  if (kind === 'new') { const b = bbox(a); const tiny = a.type === 'ink' ? a.pts.length < 2 : (b.w < 3 && b.h < 3); if (tiny) { p.annots.pop(); hist.pop(); } else { sel = { page: i, id: a.id }; if (['highlight', 'whiteout', 'shape'].includes(tool) || tool === 'draw') { /* stay in tool */ } } }
  if (kind === 'move' && !drag.moved) hist.pop();
  drag = null; stage.classList.remove('drawing'); drawOverlay(i); updateInfo(); if (kind !== 'new' || tool === 'select') renderProps();
}
stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', endDrag);
stage.addEventListener('dblclick', e => { const an = e.target.closest('.an'); const pos = evPos(e); if (an && pos) { const a = pages[pos.i].annots.find(q => q.id === an.dataset.id); if (a?.type === 'text') { setTool('select'); sel = { page: pos.i, id: a.id }; drawOverlay(pos.i); renderProps(true); } } });
document.addEventListener('keydown', e => {
  if (!$('#editor').classList.contains('on')) return; const tag = e.target.tagName; if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'Z'))) { e.preventDefault(); redoFn(); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); deleteSel(); } else if (e.key === 'Escape') setTool('select');
});
function deleteSel() { if (!sel) return; snapshot(); const p = pages[sel.page]; p.annots = p.annots.filter(a => a.id !== sel.id); const i = sel.page; sel = null; drawOverlay(i); renderProps(); }
function updateSel(fn) { if (!sel) return; const a = pages[sel.page].annots.find(q => q.id === sel.id); if (!a) return; fn(a); if (a.type === 'text') Object.assign(a, (({ w, h }) => ({ w, h }))(measureText(a))); drawOverlay(sel.page); }

/* ---------- props panel ---------- */
const F = {
  text: (id, l, v = '', ph = '') => `<div class="field"><label>${l}</label><input type="text" id="${id}" value="${esc(v)}" placeholder="${ph}"></div>`,
  area: (id, l, v = '') => `<div class="field"><label>${l}</label><textarea id="${id}" rows="3">${esc(v)}</textarea></div>`,
  num: (id, l, v, mn, mx, st = 1) => `<div class="field"><label>${l}</label><input type="number" id="${id}" value="${v}" min="${mn}" max="${mx}" step="${st}"></div>`,
  range: (id, l, v, mn, mx, st = 1, u = '') => `<div class="field"><label>${l}: <b id="${id}_v">${v}${u}</b></label><input type="range" id="${id}" value="${v}" min="${mn}" max="${mx}" step="${st}" oninput="document.getElementById('${id}_v').textContent=this.value+'${u}'"></div>`,
  sel: (id, l, items, v) => `<div class="field"><label>${l}</label><select id="${id}">${items.map(([a, b]) => `<option value="${a}" ${a == v ? 'selected' : ''}>${b}</option>`).join('')}</select></div>`,
  seg: (id, l, items, v) => `<div class="field"><label>${l}</label><div class="seg" id="${id}" data-v="${v}">${items.map(([a, b]) => `<button type="button" data-v="${a}" class="${a == v ? 'on' : ''}">${b}</button>`).join('')}</div></div>`,
  chk: (id, l, on) => `<label class="chk"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}>${l}</label>`,
  color: (id, l, v) => `<div class="field"><label>${l}</label><input type="color" id="${id}" value="${v}"></div>`,
};
const V = id => { const e = document.getElementById(id); if (!e) return null; if (e.classList.contains('seg')) return e.dataset.v; if (e.type === 'checkbox') return e.checked; if (e.type === 'number' || e.type === 'range') return +e.value; return e.value; };
const props = $('#props');
document.addEventListener('click', e => { const b = e.target.closest('.seg button'); if (b) { const s = b.parentElement; s.dataset.v = b.dataset.v;[...s.children].forEach(c => c.classList.toggle('on', c === b)); s.dispatchEvent(new Event('input', { bubbles: true })); } });
function head(t) { return `<h4>${t}<button class="ibtn" onclick="document.getElementById('ebody').classList.remove('showProps')"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></h4>`; }
function renderProps(focusText = false) {
  let html = '', bind = null;
  const a = sel ? pages[sel.page]?.annots.find(q => q.id === sel.id) : null;
  if (a) {
    const common = `<div class="row"><button class="btn ghost sm" id="pDup">ทำสำเนา</button><button class="btn sm" style="background:var(--red2);color:#fff" id="pDel">ลบ</button></div>`;
    if (a.type === 'text') { html = head('ข้อความ') + `<div class="opt">${F.area('pTxt', 'เนื้อหา', a.text)}<div class="row">${F.num('pSz', 'ขนาด', Math.round(a.size), 4, 200)}${F.color('pCol', 'สี', a.color)}</div>${F.sel('pFont', 'ฟอนต์', [['Sarabun', 'Sarabun'], ['Kanit', 'Kanit'], ['serif', 'Serif'], ['monospace', 'Monospace']], a.font)}${F.chk('pBold', 'ตัวหนา', a.bold)}${F.range('pOp', 'ความทึบ', Math.round((a.opacity ?? 1) * 100), 5, 100, 5, '%')}${common}</div>`; bind = () => { const u = () => updateSel(q => { q.text = V('pTxt'); q.size = V('pSz'); q.color = V('pCol'); q.font = V('pFont'); q.bold = V('pBold'); q.opacity = V('pOp') / 100; }); ['pTxt', 'pSz', 'pCol', 'pFont', 'pBold', 'pOp'].forEach(id => $('#' + id).addEventListener('input', u)); if (focusText) { if (window.innerWidth <= 980) $('#ebody').classList.add('showProps'); const t = $('#pTxt'); t.focus(); t.select(); } }; }
    else if (a.type === 'image') { html = head('รูปภาพ / ลายเซ็น') + `<div class="opt">${F.range('pW', 'ความกว้าง (% ของหน้า)', Math.round(a.w / dispSize(pages[sel.page]).W * 100), 2, 100, 1, '%')}${F.range('pOp', 'ความทึบ', Math.round((a.opacity ?? 1) * 100), 5, 100, 5, '%')}${F.range('pRot', 'มุม', a.rotate || 0, -180, 180, 5, '°')}${common}</div>`; bind = () => ['pW', 'pOp', 'pRot'].forEach(id => $('#' + id).addEventListener('input', () => updateSel(q => { const W = dispSize(pages[sel.page]).W; const nw = W * V('pW') / 100; q.h = q.h * nw / q.w; q.w = nw; q.opacity = V('pOp') / 100; q.rotate = V('pRot'); }))); }
    else if (['rect', 'ellipse', 'line', 'arrow', 'ink'].includes(a.type)) { const hasFill = a.type === 'rect' || a.type === 'ellipse'; html = head(a.type === 'ink' ? 'เส้นปากกา' : 'รูปทรง') + `<div class="opt"><div class="row">${F.color('pSt', 'สีเส้น', a.stroke)}${F.num('pWd', 'ความหนา', a.width, 1, 40)}</div>${hasFill ? `${F.chk('pFillOn', 'เติมสี', a.fillOn)}${F.color('pFill', 'สีพื้น', a.fill)}` : ''}${common}</div>`; bind = () => ['pSt', 'pWd', 'pFillOn', 'pFill'].forEach(id => $('#' + id)?.addEventListener('input', () => updateSel(q => { q.stroke = V('pSt'); q.width = V('pWd'); if (hasFill) { q.fillOn = V('pFillOn'); q.fill = V('pFill'); } }))); }
    else { html = head(a.type === 'highlight' ? 'ไฮไลท์' : 'ปิดทับ') + `<div class="opt">${F.color('pC', 'สี', a.color)}${common}</div>`; bind = () => $('#pC').addEventListener('input', () => updateSel(q => q.color = V('pC'))); }
  } else {
    switch (tool) {
      case 'select': html = head('เลือก / ย้าย') + `<div class="note">คลิกวัตถุบนหน้าเพื่อเลือก · ลากเพื่อย้าย · จุดมุมขวาล่างเพื่อปรับขนาด · ดับเบิลคลิกข้อความเพื่อแก้ · ปุ่ม Delete เพื่อลบ</div><div class="note" style="margin-top:8px">หน้าปัจจุบัน: ${curPage + 1} / ${pages.length}</div>`; break;
      case 'text': html = head('ข้อความ') + `<div class="opt"><div class="row">${F.num('tSz', 'ขนาด', TD.text.size, 4, 200)}${F.color('tCol', 'สี', TD.text.color)}</div>${F.sel('tFont', 'ฟอนต์', [['Sarabun', 'Sarabun'], ['Kanit', 'Kanit'], ['serif', 'Serif'], ['monospace', 'Monospace']], TD.text.font)}${F.chk('tBold', 'ตัวหนา', TD.text.bold)}<div class="note">แตะบนหน้าเอกสารเพื่อวางกล่องข้อความ แล้วพิมพ์ในช่องที่ปรากฏ</div></div>`; bind = () => ['tSz', 'tCol', 'tFont', 'tBold'].forEach(id => $('#' + id).addEventListener('input', () => Object.assign(TD.text, { size: V('tSz'), color: V('tCol'), font: V('tFont'), bold: V('tBold') }))); break;
      case 'draw': html = head('ปากกา') + `<div class="opt"><div class="row">${F.color('dCol', 'สี', TD.draw.color)}${F.num('dW', 'ความหนา', TD.draw.width, 1, 40)}</div><div class="note">ลากบนหน้าเพื่อวาดอิสระ</div></div>`; bind = () => ['dCol', 'dW'].forEach(id => $('#' + id).addEventListener('input', () => Object.assign(TD.draw, { color: V('dCol'), width: V('dW') }))); break;
      case 'highlight': html = head('ไฮไลท์') + `<div class="opt">${F.seg('hC', 'สี', [['#ffe600', 'เหลือง'], ['#7dff7d', 'เขียว'], ['#7fd7ff', 'ฟ้า'], ['#ffa3d5', 'ชมพู']], TD.highlight.color)}<div class="note">ลากคลุมข้อความที่ต้องการเน้น</div></div>`; bind = () => $('#hC').addEventListener('input', () => TD.highlight.color = V('hC')); break;
      case 'whiteout': html = head('ยางลบ / ปิดทับ') + `<div class="opt">${F.color('wC', 'สีที่ใช้ปิดทับ', TD.whiteout.color)}<div class="note">ลากกรอบทับบริเวณที่ต้องการลบออก (เช่น ลายน้ำ ข้อความเก่า) — ใช้สีขาวสำหรับพื้นกระดาษ</div></div>`; bind = () => $('#wC').addEventListener('input', () => TD.whiteout.color = V('wC')); break;
      case 'shape': html = head('รูปทรง') + `<div class="opt">${F.seg('sK', 'ชนิด', [['rect', 'สี่เหลี่ยม'], ['ellipse', 'วงรี'], ['line', 'เส้น'], ['arrow', 'ลูกศร']], TD.shape.kind)}<div class="row">${F.color('sSt', 'สีเส้น', TD.shape.stroke)}${F.num('sW', 'ความหนา', TD.shape.width, 1, 40)}</div>${F.chk('sFillOn', 'เติมสี', TD.shape.fillOn)}${F.color('sFill', 'สีพื้น', TD.shape.fill)}</div>`; bind = () => ['sK', 'sSt', 'sW', 'sFillOn', 'sFill'].forEach(id => $('#' + id).addEventListener('input', () => Object.assign(TD.shape, { kind: V('sK'), stroke: V('sSt'), width: V('sW'), fillOn: V('sFillOn'), fill: V('sFill') }))); break;
      case 'image': html = head('รูปภาพ') + `<div class="opt">${TD.image.asset ? `<img src="${assets[TD.image.asset].url}" style="max-height:120px;object-fit:contain;background:#fff;border-radius:8px">` : ''}<button class="btn ghost sm" id="imgPick">เลือกรูป…</button><div class="note">แตะบนหน้าเพื่อวาง จากนั้นลากปรับตำแหน่ง/ขนาดได้</div></div>`; bind = () => $('#imgPick').onclick = () => pickImage('image'); break;
      case 'sign': html = head('ลายเซ็น') + `<div class="opt">${TD.sign.asset ? `<img src="${assets[TD.sign.asset].url}" style="max-height:100px;object-fit:contain;background:#fff;border-radius:8px">` : ''}<button class="btn ghost sm" id="sigNew">วาด / อัปโหลดลายเซ็นใหม่…</button><div class="note">แตะบนหน้าเอกสารตรงจุดที่ต้องการลงนาม</div></div>`; bind = () => $('#sigNew').onclick = openSignModal; break;
      case 'wm': { const w = TD.wm; html = head('ลายน้ำ') + `<div class="opt">${F.seg('wType', 'ชนิด', [['text', 'ข้อความ'], ['logo', 'โลโก้ TESR'], ['img', 'รูปอื่น']], w.type)}${F.text('wTxt', 'ข้อความ', w.text)}<div class="row">${F.range('wOp', 'ความทึบ', w.opacity, 5, 100, 5, '%')}${F.range('wRot', 'มุม', w.rotate, -90, 90, 5, '°')}</div>${F.range('wSz', 'ขนาด (% ของหน้า)', w.size, 10, 100, 5, '%')}${F.color('wCol', 'สี', w.color)}${F.chk('wAll', 'ใส่ทุกหน้า', w.all)}<button class="btn primary" id="wApply">ใส่ลายน้ำ</button><div class="note">ลายน้ำจะกลายเป็นวัตถุบนหน้า — เลือกแล้วย้าย/ลบได้</div></div>`; bind = () => { const u = () => Object.assign(w, { type: V('wType'), text: V('wTxt'), opacity: V('wOp'), rotate: V('wRot'), size: V('wSz'), color: V('wCol'), all: V('wAll') }); ['wType', 'wTxt', 'wOp', 'wRot', 'wSz', 'wCol', 'wAll'].forEach(id => $('#' + id).addEventListener('input', u)); $('#wApply').onclick = applyWatermark; }; break; }
      case 'pagenum': { const n = TD.pagenum; html = head('เลขหน้า') + `<div class="opt">${F.seg('nPos', 'ตำแหน่ง', [['bl', 'ล่างซ้าย'], ['bc', 'ล่างกลาง'], ['br', 'ล่างขวา'], ['tl', 'บนซ้าย'], ['tc', 'บนกลาง'], ['tr', 'บนขวา']], n.pos)}${F.sel('nFmt', 'รูปแบบ', [['{n}', '1, 2, 3'], ['{n} / {t}', '1 / 10'], ['หน้า {n}', 'หน้า 1'], ['หน้า {n} จาก {t}', 'หน้า 1 จาก 10'], ['- {n} -', '- 1 -']], n.fmt)}<div class="row">${F.num('nSz', 'ขนาด', n.size, 6, 40)}${F.num('nSt', 'เริ่มที่', n.start, 0, 9999)}</div>${F.color('nCol', 'สี', n.color)}${F.chk('nSkip', 'ไม่ใส่หน้าแรก', n.skip)}<button class="btn primary" id="nApply">ใส่เลขหน้า</button></div>`; bind = () => { const u = () => Object.assign(n, { pos: V('nPos'), fmt: V('nFmt'), size: V('nSz'), start: V('nSt'), color: V('nCol'), skip: V('nSkip') }); ['nPos', 'nFmt', 'nSz', 'nSt', 'nCol', 'nSkip'].forEach(id => $('#' + id).addEventListener('input', u)); $('#nApply').onclick = applyPageNumbers; }; break; }
    }
  }
  props.innerHTML = html; if (bind) bind();
  if (a) { $('#pDel').onclick = deleteSel; $('#pDup').onclick = () => { snapshot(); const c = JSON.parse(JSON.stringify(a)); c.id = uid(); if (c.type === 'line' || c.type === 'arrow') { c.x1 += 12; c.x2 += 12; c.y1 += 12; c.y2 += 12; } else { c.x += 12; c.y += 12; if (c.pts) c.pts = c.pts.map(q => [q[0] + 12, q[1] + 12]); } pages[sel.page].annots.push(c); sel.id = c.id; drawOverlay(sel.page); renderProps(); }; }
}
async function applyWatermark() {
  const w = TD.wm; let base;
  if (w.type === 'text') { if (!w.text.trim()) return toast('กรุณาใส่ข้อความ'); base = { type: 'text', text: w.text, size: 64, color: w.color, font: 'Kanit', bold: true }; Object.assign(base, (({ w, h }) => ({ w, h }))(measureText(base))); }
  else { let aid = w.type === 'logo' ? TD._logo : null; if (!aid) { const f = w.type === 'logo' ? await (await fetch('logo.png')).blob() : await new Promise(r => { const i = el('input', { type: 'file', accept: 'image/*' }); i.onchange = () => r(i.files[0]); i.click(); }); if (!f) return; const as = await imageFileToAsset(f, { maxW: 1400, type: 'image/png' }); assets[as.id] = as; aid = as.id; if (w.type === 'logo') TD._logo = aid; } base = { type: 'image', asset: aid, w: assets[aid].w, h: assets[aid].h }; }
  snapshot(); const targets = w.all ? pages.map((_, i) => i) : [curPage];
  targets.forEach(i => { const { W, H } = dispSize(pages[i]); const tw = W * w.size / 100, th = tw * base.h / base.w; const a = { ...base, id: uid(), x: (W - tw) / 2, y: (H - th) / 2, w: tw, h: th, opacity: w.opacity / 100, rotate: w.rotate }; if (a.type === 'text') a.size = base.size * tw / base.w; pages[i].annots.push(a); drawOverlay(i); });
  toast(`ใส่ลายน้ำ ${targets.length} หน้าแล้ว`); setTool('select');
}
function applyPageNumbers() {
  const n = TD.pagenum; snapshot(); const total = pages.length + n.start - 1;
  pages.forEach((p, i) => { if (n.skip && i === 0) return; const { W, H } = dispSize(p); const a = { id: uid(), type: 'text', text: n.fmt.replace('{n}', n.start + i).replace('{t}', total), size: n.size, color: n.color, font: 'Sarabun', bold: false, pn: true }; Object.assign(a, (({ w, h }) => ({ w, h }))(measureText(a))); const m = 22; a.x = n.pos.endsWith('l') ? m : n.pos.endsWith('r') ? W - m - a.w : (W - a.w) / 2; a.y = n.pos.startsWith('b') ? H - m - a.h : m; p.annots = p.annots.filter(q => !q.pn); p.annots.push(a); drawOverlay(i); });
  toast('ใส่เลขหน้าแล้ว'); setTool('select');
}

/* ---------- signature modal ---------- */
function openSignModal() {
  const box = $('#modalBox'); box.innerHTML = `<h3>ลายเซ็น</h3>${F.seg('sgSrc', 'ที่มา', [['draw', 'วาด'], ['upload', 'อัปโหลดรูป']], 'draw')}<div id="sgDraw" style="margin-top:10px"><canvas class="sigpad" id="sigCv"></canvas><div class="seg" style="margin-top:6px"><button type="button" id="sgClear">ล้าง</button><button type="button" data-c="#000000" class="on sgc">ดำ</button><button type="button" data-c="#1a3fb8" class="sgc">น้ำเงิน</button></div></div><div id="sgUp" style="margin-top:10px;display:none"><input type="file" id="sgFile" accept="image/*"></div><div class="acts"><button class="btn ghost" id="sgCancel">ยกเลิก</button><button class="btn primary" id="sgOk">ใช้ลายเซ็นนี้</button></div>`;
  $('#modal').classList.add('on'); const c = $('#sigCv'); const dpr = window.devicePixelRatio || 1; const r = c.getBoundingClientRect(); c.width = r.width * dpr; c.height = r.height * dpr; const ctx = c.getContext('2d'); ctx.scale(dpr, dpr); ctx.lineWidth = 2.4; ctx.lineCap = ctx.lineJoin = 'round'; let col = '#000000', has = false, dr = false;
  const pos = e => { const b = c.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  c.onpointerdown = e => { dr = true; c.setPointerCapture(e.pointerId); ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(...pos(e)); }; c.onpointermove = e => { if (!dr) return; ctx.lineTo(...pos(e)); ctx.stroke(); has = true; }; c.onpointerup = c.onpointercancel = () => dr = false;
  $('#sgClear').onclick = () => { ctx.clearRect(0, 0, c.width, c.height); has = false; }; box.querySelectorAll('.sgc').forEach(b => b.onclick = () => { col = b.dataset.c; box.querySelectorAll('.sgc').forEach(x => x.classList.toggle('on', x === b)); });
  box.querySelectorAll('#sgSrc button').forEach(b => b.onclick = () => { const d = b.dataset.v === 'draw'; $('#sgDraw').style.display = d ? '' : 'none'; $('#sgUp').style.display = d ? 'none' : ''; box.querySelectorAll('#sgSrc button').forEach(x => x.classList.toggle('on', x === b)); $('#sgSrc').dataset.v = b.dataset.v; });
  $('#sgCancel').onclick = () => $('#modal').classList.remove('on');
  $('#sgOk').onclick = async () => {
    let as; if ($('#sgSrc').dataset.v === 'draw') { if (!has) return toast('กรุณาวาดลายเซ็นก่อน'); const d = ctx.getImageData(0, 0, c.width, c.height).data; let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0; for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } const pad = 8; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(c.width, x1 + pad); y1 = Math.min(c.height, y1 + pad); const o = document.createElement('canvas'); o.width = x1 - x0; o.height = y1 - y0; o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height); as = { id: uid(), bytes: await canvasBytes(o, 'image/png'), type: 'image/png', w: o.width, h: o.height, url: o.toDataURL() }; }
    else { const f = $('#sgFile').files[0]; if (!f) return toast('กรุณาเลือกรูป'); as = await imageFileToAsset(f, { maxW: 1200, type: 'image/png' }); }
    assets[as.id] = as; TD.sign.asset = as.id; $('#modal').classList.remove('on'); setTool('sign'); toast('แตะบนหน้าเอกสารเพื่อวางลายเซ็น');
  };
}

/* ---------- thumbnails / page ops ---------- */
async function thumbUrl(p) { const key = `${p.doc}:${p.src}:${p.rot}`; if (thumbCache[key]) return thumbCache[key]; const { W, H, r } = dispSize(p); const c = document.createElement('canvas'); const s = 140 / W; c.width = Math.round(W * s); c.height = Math.round(H * s); if (p.src == null) { const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); } else { const pg = await docs[p.doc].pdf.getPage(p.src + 1); await pg.render({ canvasContext: c.getContext('2d'), viewport: pg.getViewport({ scale: s, rotation: r }) }).promise; } return thumbCache[key] = c.toDataURL('image/jpeg', .6); }
async function buildThumbs() {
  const L = $('#thumbList'); L.innerHTML = pages.map((p, i) => `<div class="tmb ${i === curPage ? 'cur' : ''}" draggable="true" data-i="${i}"><span class="n">${i + 1}</span><img alt=""><div class="ta"><button data-a="up" title="เลื่อนขึ้น">↑</button><button data-a="down" title="เลื่อนลง">↓</button><button data-a="rot" title="หมุน">↻</button><button data-a="dup" title="ทำสำเนา">⧉</button><button data-a="del" title="ลบหน้า">✕</button></div></div>`).join('');
  let from = null; L.querySelectorAll('.tmb').forEach(t => {
    const i = +t.dataset.i; t.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { pageOp(b.dataset.a, i); return; } scrollToPage(i); if (window.innerWidth <= 980) $('#ebody').classList.remove('showThumbs'); });
    t.addEventListener('dragstart', () => { from = i; t.classList.add('drag'); }); t.addEventListener('dragend', () => t.classList.remove('drag'));
    t.addEventListener('dragover', e => { e.preventDefault(); t.classList.add('over'); }); t.addEventListener('dragleave', () => t.classList.remove('over'));
    t.addEventListener('drop', e => { e.preventDefault(); if (from === null || from === i) return; snapshot(); const [it] = pages.splice(from, 1); pages.splice(i, 0, it); curPage = i; buildStage(); buildThumbs(); updateInfo(); });
  });
  for (let i = 0; i < pages.length; i++) { const img = L.children[i]?.querySelector('img'); if (img) img.src = await thumbUrl(pages[i]); }
}
function markCurThumb() { $('#thumbList').querySelectorAll('.tmb').forEach((t, i) => t.classList.toggle('cur', i === curPage)); if (tool === 'select' && !sel) renderProps(); }
function pageOp(a, i) {
  if (a === 'rot') return rotatePage(i, 90);
  snapshot();
  if (a === 'del') { if (pages.length === 1) { hist.pop(); return toast('ต้องเหลืออย่างน้อย 1 หน้า'); } pages.splice(i, 1); curPage = Math.min(curPage, pages.length - 1); }
  if (a === 'dup') { const c = JSON.parse(JSON.stringify(pages[i])); c.id = uid(); c.annots.forEach(q => q.id = uid()); pages.splice(i + 1, 0, c); }
  if (a === 'up' && i > 0) [pages[i - 1], pages[i]] = [pages[i], pages[i - 1]]; if (a === 'down' && i < pages.length - 1) [pages[i + 1], pages[i]] = [pages[i], pages[i + 1]];
  sel = null; buildStage(); buildThumbs(); updateInfo();
}
function rotatePage(i, deg) { snapshot(); const p = pages[i]; const { W, H } = dispSize(p); p.rot = (p.rot + deg) % 360; // rotate annotations with the page (90° CW): (x,y) -> (H - y - h, x)
  p.annots.forEach(a => { if (a.type === 'line' || a.type === 'arrow') { [a.x1, a.y1] = [H - a.y1, a.x1];[a.x2, a.y2] = [H - a.y2, a.x2]; } else if (a.type === 'ink') { a.pts = a.pts.map(q => [H - q[1], q[0]]); inkBounds(a); } else { const nx = H - a.y - a.h, ny = a.x; if (a.type === 'text' || a.type === 'image') { a.rotate = ((a.rotate || 0) - 90); const cx = nx + a.h / 2, cy = ny + a.w / 2; a.x = cx - a.w / 2; a.y = cy - a.h / 2; } else { a.x = nx; a.y = ny;[a.w, a.h] = [a.h, a.w]; } } });
  sel = null; buildStage(); buildThumbs(); toast(`หมุนหน้า ${i + 1}`); }
$('#addPagesBtn').onclick = () => $('#addIn').click(); $('#addIn').onchange = e => { loadFiles(e.target.files, { append: true }); e.target.value = ''; };
$('#blankPageBtn').onclick = () => { snapshot(); const ref = pages[curPage] || { w: 595.28, h: 841.89 }; pages.splice(curPage + 1, 0, { id: uid(), doc: -1, src: null, w: ref.w, h: ref.h, baseRot: 0, rot: 0, annots: [] }); buildStage(); buildThumbs(); updateInfo(); };
$('#mThumbs').onclick = () => $('#ebody').classList.toggle('showThumbs'); $('#mThumbsX').onclick = () => $('#ebody').classList.remove('showThumbs'); $('#mProps').onclick = () => $('#ebody').classList.toggle('showProps');
$('#undoBtn').onclick = undo; $('#redoBtn').onclick = redoFn;
$('#closeBtn').onclick = () => { if (hist.length && !confirm('ปิดไฟล์นี้? การแก้ไขที่ยังไม่ได้ดาวน์โหลดจะหายไป')) return; $('#editor').classList.remove('on'); $('#landing').style.display = ''; };
window.addEventListener('resize', () => { if ($('#editor').classList.contains('on')) { clearTimeout(window._rz); window._rz = setTimeout(() => { zoomFit(); setZoom(zoom); }, 200); } });

/* ---------- export ---------- */
async function buildPdf(sel = null, onProg) {
  const out = await PDFDocument.create(); const list = sel || pages.map((_, i) => i); const embCache = {};
  for (let k = 0; k < list.length; k++) {
    const p = pages[list[k]]; const { W, H, r } = dispSize(p); const page = out.addPage([W, H]);
    if (p.src != null) { const key = p.doc + ':' + p.src; if (!embCache[key]) { const lib = await getLib(p.doc); [embCache[key]] = await out.embedPdf(lib, [p.src]); } const emb = embCache[key]; const w = p.w, h = p.h;
      if (r === 0) page.drawPage(emb, { x: 0, y: 0 }); else if (r === 90) page.drawPage(emb, { x: 0, y: w, rotate: degrees(-90) }); else if (r === 180) page.drawPage(emb, { x: w, y: h, rotate: degrees(180) }); else page.drawPage(emb, { x: h, y: 0, rotate: degrees(90) }); }
    for (const a of p.annots) await drawAnnot(out, page, a, H);
    onProg && onProg((k + 1) / list.length);
  }
  out.setTitle(meta.title || fileName.replace(/\.pdf$/i, '')); out.setAuthor(meta.author); out.setSubject(meta.subject); out.setKeywords(meta.keywords.split(',').map(s => s.trim()).filter(Boolean)); out.setProducer('TESR PDF Editor'); out.setCreator('TESR PDF Editor'); out.setModificationDate(new Date());
  return out.save({ useObjectStreams: true });
}
async function drawAnnot(out, page, a, H) {
  const op = a.opacity ?? 1;
  const imgOpts = (img, b) => { const rot = a.rotate || 0; if (!rot) return { x: b.x, y: H - b.y - b.h, width: b.w, height: b.h, opacity: op }; const rad = rot * Math.PI / 180, cx = b.x + b.w / 2, cy = H - (b.y + b.h / 2); return { x: cx - (b.w / 2) * Math.cos(rad) + (b.h / 2) * Math.sin(rad), y: cy - (b.w / 2) * Math.sin(rad) - (b.h / 2) * Math.cos(rad), width: b.w, height: b.h, rotate: degrees(rot), opacity: op }; };
  switch (a.type) {
    case 'text': { const r = await textToPng(a); const img = await out.embedPng(r.bytes); page.drawImage(img, imgOpts(img, { x: a.x, y: a.y, w: a.w, h: a.h })); break; }
    case 'image': { const as = assets[a.asset]; if (!as) break; if (!as._emb || as._emb.doc !== out) as._emb = { doc: out, img: as.type === 'image/png' ? await out.embedPng(as.bytes) : await out.embedJpg(as.bytes) }; page.drawImage(as._emb.img, imgOpts(as._emb.img, a)); break; }
    case 'highlight': page.drawRectangle({ x: a.x, y: H - a.y - a.h, width: a.w, height: a.h, color: hexRgb(a.color), opacity: .45, blendMode: BlendMode.Multiply }); break;
    case 'whiteout': page.drawRectangle({ x: a.x, y: H - a.y - a.h, width: a.w, height: a.h, color: hexRgb(a.color) }); break;
    case 'rect': page.drawRectangle({ x: a.x, y: H - a.y - a.h, width: a.w, height: a.h, borderColor: hexRgb(a.stroke), borderWidth: a.width, color: a.fillOn ? hexRgb(a.fill) : undefined }); break;
    case 'ellipse': page.drawEllipse({ x: a.x + a.w / 2, y: H - a.y - a.h / 2, xScale: a.w / 2, yScale: a.h / 2, borderColor: hexRgb(a.stroke), borderWidth: a.width, color: a.fillOn ? hexRgb(a.fill) : undefined }); break;
    case 'line': case 'arrow': { const L = (x1, y1, x2, y2) => page.drawLine({ start: { x: x1, y: H - y1 }, end: { x: x2, y: H - y2 }, thickness: a.width, color: hexRgb(a.stroke), lineCap: LineCapStyle.Round }); L(a.x1, a.y1, a.x2, a.y2); if (a.type === 'arrow') { const [h1, h2] = arrowHead(a); L(a.x2, a.y2, h1[0], h1[1]); L(a.x2, a.y2, h2[0], h2[1]); } break; }
    case 'ink': page.drawSvgPath(inkPath(a), { x: 0, y: H, borderColor: hexRgb(a.stroke), borderWidth: a.width, borderLineCap: LineCapStyle.Round }); break;
  }
}
async function renderBytes(bytes, { scale = 1.5, onPage, onProg }) { const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise; for (let i = 1; i <= pdf.numPages; i++) { const pg = await pdf.getPage(i); const vp = pg.getViewport({ scale }); const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise; await onPage(c, i, pdf.numPages); onProg && onProg(i / pdf.numPages); } return pdf; }
const outName = suf => (settings.prefix ?? 'TESR_') + fileName.replace(/\.pdf$/i, '') + suf;

$('#dlBtn').onclick = e => { e.stopPropagation(); $('#dlMenu').classList.toggle('on'); }; document.addEventListener('click', () => $('#dlMenu').classList.remove('on'));
$('#dlMenu').addEventListener('click', async e => { const b = e.target.closest('button'); if (!b) return; $('#dlMenu').classList.remove('on'); await runExport(b.dataset.a); });
$('#printBtn').onclick = async () => { busy(true, 'กำลังเตรียมพิมพ์…'); try { const bytes = await buildPdf(null, p => busy(true, 'กำลังเตรียมพิมพ์…', p)); const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })); const f = $('#printFrame'); f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch { window.open(url, '_blank'); } }; f.src = url; } catch (err) { toast('พิมพ์ไม่สำเร็จ: ' + err.message); } finally { busy(false); } };
function modal(html, onOk) { const box = $('#modalBox'); box.innerHTML = html + `<div class="acts"><button class="btn ghost" id="mCancel">ยกเลิก</button><button class="btn primary" id="mOk">ตกลง</button></div>`; $('#modal').classList.add('on'); $('#mCancel').onclick = () => $('#modal').classList.remove('on'); $('#mOk').onclick = async () => { $('#modal').classList.remove('on'); await onOk(); }; }
$('#modal').addEventListener('click', e => { if (e.target === $('#modal')) $('#modal').classList.remove('on'); });
async function runExport(action) {
  const wrap = async (label, fn) => { busy(true, label, 0); try { await fn(); } catch (err) { console.error(err); toast('เกิดข้อผิดพลาด: ' + err.message); } finally { busy(false); } };
  if (action === 'pdf') return wrap('กำลังสร้าง PDF…', async () => { const bytes = await buildPdf(null, p => busy(true, 'กำลังสร้าง PDF…', p)); const b = new Blob([bytes], { type: 'application/pdf' }); download(b, outName('.pdf')); toast(`ดาวน์โหลดแล้ว · ${fmtSize(b.size)}`); });
  if (action === 'range') return modal(`<h3>เฉพาะบางหน้า / แยกไฟล์</h3><div class="opt" style="display:flex;flex-direction:column;gap:10px">${F.seg('xMode', 'รูปแบบ', [['range', 'ดึงหน้าที่เลือก'], ['each', 'แยกทุกหน้า (ZIP)'], ['every', 'แบ่งทุก N หน้า (ZIP)']], 'range')}${F.text('xRng', 'หน้าที่ต้องการ', '', 'เช่น 1-3,5')}${F.num('xN', 'N หน้าต่อไฟล์', 2, 1, 999)}</div>`, () => wrap('กำลังแยกไฟล์…', async () => {
    const mode = V('xMode'); const nm = fileName.replace(/\.pdf$/i, '');
    if (mode === 'range') { const ps = parseRanges(V('xRng'), pages.length); if (!ps.length) throw new Error('ระบุหน้าไม่ถูกต้อง'); const bytes = await buildPdf(ps.map(x => x - 1)); download(new Blob([bytes], { type: 'application/pdf' }), outName(`_p${V('xRng').replace(/[^\d,-]/g, '')}.pdf`)); return; }
    const n = mode === 'each' ? 1 : Math.max(1, V('xN')); const zip = new JSZip(); const groups = []; for (let i = 0; i < pages.length; i += n) groups.push(Array.from({ length: Math.min(n, pages.length - i) }, (_, k) => i + k));
    for (let g = 0; g < groups.length; g++) { zip.file(`${nm}_${String(g + 1).padStart(3, '0')}_p${groups[g][0] + 1}-${groups[g].at(-1) + 1}.pdf`, await buildPdf(groups[g])); busy(true, 'กำลังแยกไฟล์…', (g + 1) / groups.length); }
    download(await zip.generateAsync({ type: 'blob' }), outName('_split.zip'));
  }));
  if (action === 'compress') return modal(`<h3>ลดขนาดไฟล์</h3>${F.seg('cLvl', 'ระดับ', [['low', 'เบา (ชัดสุด)'], ['mid', 'กลาง'], ['high', 'แรง (เล็กสุด)']], 'mid')}<div class="note" style="margin-top:10px">ทุกหน้าจะถูกแปลงเป็นภาพบีบอัด — ข้อความจะเลือก/ค้นหาไม่ได้ แต่ไฟล์เล็กลงมาก เหมาะกับเอกสารสแกน</div>`, () => wrap('กำลังบีบอัด…', async () => {
    const cfg = { low: [1.6, .82], mid: [1.25, .7], high: [1.0, .55] }[V('cLvl')]; const src = await buildPdf(); const out = await PDFDocument.create();
    await renderBytes(src, { scale: cfg[0], onProg: p => busy(true, 'กำลังบีบอัด…', p), onPage: async c => { const img = await out.embedJpg(await canvasBytes(c, 'image/jpeg', cfg[1])); const pg = out.addPage([c.width / cfg[0], c.height / cfg[0]]); pg.drawImage(img, { x: 0, y: 0, width: pg.getWidth(), height: pg.getHeight() }); } });
    const b = new Blob([await out.save({ useObjectStreams: true })], { type: 'application/pdf' }); download(b, outName('_compressed.pdf')); toast(`${fmtSize(src.length)} → ${fmtSize(b.size)}`);
  }));
  if (action === 'images') return modal(`<h3>แปลงเป็นรูป</h3><div style="display:flex;flex-direction:column;gap:10px">${F.seg('iFmt', 'รูปแบบ', [['jpeg', 'JPG'], ['png', 'PNG']], 'jpeg')}${F.seg('iDpi', 'ความละเอียด', [['1', '72 dpi'], ['2', '144 dpi'], ['3', '216 dpi']], '2')}</div>`, () => wrap('กำลังแปลงเป็นรูป…', async () => {
    const fmt = V('iFmt'), sc = V('iDpi'); const src = await buildPdf(); const zip = new JSZip(); const nm = fileName.replace(/\.pdf$/i, ''); let last, n = 0;
    await renderBytes(src, { scale: sc, onProg: p => busy(true, 'กำลังแปลงเป็นรูป…', p), onPage: async (c, i) => { last = await canvasBlob(c, 'image/' + fmt, .9); zip.file(`${nm}_${String(i).padStart(3, '0')}.${fmt === 'jpeg' ? 'jpg' : 'png'}`, last); n++; } });
    if (n === 1) download(last, outName(fmt === 'jpeg' ? '.jpg' : '.png')); else download(await zip.generateAsync({ type: 'blob' }), outName('_images.zip'));
  }));
  if (action === 'text') return wrap('กำลังดึงข้อความ…', async () => {
    let out = ''; for (let i = 0; i < pages.length; i++) { const p = pages[i]; if (p.src == null) continue; const tc = await (await docs[p.doc].pdf.getPage(p.src + 1)).getTextContent(); let line = '', lastY = null; tc.items.forEach(it => { if (lastY !== null && Math.abs(it.transform[5] - lastY) > 2) line += '\n'; line += it.str + (it.hasEOL ? '\n' : ''); lastY = it.transform[5]; }); p.annots.filter(a => a.type === 'text').forEach(a => line += '\n' + a.text); out += `--- หน้า ${i + 1} ---\n${line.trim()}\n\n`; busy(true, 'กำลังดึงข้อความ…', (i + 1) / pages.length); }
    if (!out.replace(/--- หน้า \d+ ---/g, '').trim()) throw new Error('ไม่พบข้อความ (อาจเป็น PDF สแกน)'); download(new Blob(['\ufeff' + out], { type: 'text/plain;charset=utf-8' }), outName('.txt'));
  });
  if (action === 'meta') return modal(`<h3>ข้อมูลไฟล์</h3><div style="display:flex;flex-direction:column;gap:10px">${F.text('mTitle', 'Title', meta.title)}${F.text('mAuthor', 'Author', meta.author)}${F.text('mSubject', 'Subject', meta.subject)}${F.text('mKw', 'Keywords (คั่นด้วย ,)', meta.keywords)}${F.text('mName', 'ชื่อไฟล์', fileName)}</div>`, async () => { Object.assign(meta, { title: V('mTitle'), author: V('mAuthor'), subject: V('mSubject'), keywords: V('mKw') }); fileName = V('mName').replace(/\.pdf$/i, '') + '.pdf'; $('#fname').textContent = fileName; toast('บันทึกข้อมูลไฟล์แล้ว (มีผลตอนดาวน์โหลด)'); });
}

/* ---------- landing ---------- */
const dz = $('#dz'); ['dragenter', 'dragover'].forEach(e => dz.addEventListener(e, ev => { ev.preventDefault(); dz.classList.add('over'); })); ['dragleave', 'drop'].forEach(e => dz.addEventListener(e, ev => { ev.preventDefault(); dz.classList.remove('over'); }));
dz.addEventListener('drop', e => loadFiles(e.dataTransfer.files)); $('#fileIn').addEventListener('change', e => { loadFiles(e.target.files); e.target.value = ''; });
document.addEventListener('dragover', e => e.preventDefault()); document.addEventListener('drop', e => { e.preventDefault(); if ($('#editor').classList.contains('on') && e.dataTransfer.files.length) loadFiles(e.dataTransfer.files, { append: true }); });
const QUICK = [
  { n: 'สแกน / รูป → PDF', d: 'ถ่ายรูปเอกสารหรือเลือกรูป ปรับขาวดำให้ชัด', c: '#b8102a', accept: 'image/*', capture: true, enhance: true, ic: '<svg viewBox="0 0 24 24"><path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3"/><path d="M7 15l3-4 3 3 2-2 2 3"/></svg>' },
  { n: 'รวมหลาย PDF', d: 'เลือกหลายไฟล์ จัดลำดับในหน้าแก้ไขแล้วดาวน์โหลด', c: '#1f4fbf', accept: '.pdf', ic: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="10" height="13" rx="2"/><path d="M8 3h10a2 2 0 012 2v11"/></svg>' },
  { n: 'ลดขนาด PDF', d: 'เปิดไฟล์แล้วบีบอัดทันที', c: '#c07a0c', accept: '.pdf', after: 'compress', ic: '<svg viewBox="0 0 24 24"><path d="M4 9h4M8 9V5M20 9h-4M16 9V5M4 15h4M8 15v4M20 15h-4M16 15v4"/></svg>' },
  { n: 'PDF → JPG', d: 'แปลงทุกหน้าเป็นรูปภาพ', c: '#108a7a', accept: '.pdf', after: 'images', ic: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M21 16l-5-5-8 8"/></svg>' },
];
$('#quick').innerHTML = QUICK.map((q, i) => `<button style="--c:${q.c}" data-q="${i}"><div class="ic">${q.ic}</div><b>${q.n}</b><small>${q.d}</small></button>`).join('');
$('#quick').addEventListener('click', e => { const b = e.target.closest('button[data-q]'); if (!b) return; const q = QUICK[+b.dataset.q]; const inp = el('input', { type: 'file', accept: q.accept, multiple: true }); if (q.capture && /Mobi|Android/i.test(navigator.userAgent)) inp.setAttribute('capture', 'environment'); inp.onchange = async () => { await loadFiles(inp.files, { enhance: q.enhance }); if (q.after && pages.length) setTimeout(() => runExport(q.after), 300); }; inp.click(); });
const qp = new URLSearchParams(location.search); if (qp.get('file')) fetch(qp.get('file')).then(r => r.blob()).then(b => loadFiles([new File([b], qp.get('file').split('/').pop() || 'file.pdf', { type: 'application/pdf' })])).catch(() => { });

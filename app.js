/* TESR PDF Tools — client-side only. pdf-lib + PDF.js + JSZip */
'use strict';
const LIBS_OK = typeof PDFLib !== 'undefined' && typeof pdfjsLib !== 'undefined' && typeof JSZip !== 'undefined';
const { PDFDocument, degrees, rgb, StandardFonts, PDFName } = LIBS_OK ? PDFLib : {};
if (LIBS_OK) pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

/* ---------------- helpers ---------------- */
const $ = s => document.querySelector(s);
const el = (tag, attrs = {}, html = '') => { const e = document.createElement(tag); Object.assign(e, attrs); if (html) e.innerHTML = html; return e; };
const fmtSize = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(2) + ' MB';
const readBytes = f => f.arrayBuffer().then(b => new Uint8Array(b));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const settings = JSON.parse(localStorage.getItem('tesr.settings') || '{}');
const prefix = () => settings.prefix ?? 'TESR_';
const baseName = f => f.name.replace(/\.[^.]+$/, '');
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2500); }
function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); }
function download(blob, name) { const a = el('a', { href: URL.createObjectURL(blob), download: name }); document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
function parseRanges(str, max) {
  const out = new Set();
  str.split(/[,\s]+/).filter(Boolean).forEach(p => {
    const m = p.match(/^(\d+)(?:-(\d+))?$/); if (!m) return;
    let a = +m[1], b = m[2] ? +m[2] : a; if (a > b) [a, b] = [b, a];
    for (let i = a; i <= b; i++) if (i >= 1 && i <= max) out.add(i);
  });
  return [...out].sort((x, y) => x - y);
}
async function loadPdf(bytes) { return PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }); }
async function savePdf(doc) {
  doc.setProducer('TESR PDF Tools'); doc.setCreator('TESR PDF Tools');
  if (settings.author) doc.setAuthor(settings.author);
  return doc.save({ useObjectStreams: true });
}
async function renderPages(bytes, { scale = 1.5, pages = null, onPage, onProgress } = {}) {
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const list = pages || Array.from({ length: pdf.numPages }, (_, i) => i + 1);
  const out = [];
  for (let k = 0; k < list.length; k++) {
    const page = await pdf.getPage(list[k]);
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    const r = onPage ? await onPage(c, list[k], k) : c; out.push(r);
    onProgress && onProgress((k + 1) / list.length);
  }
  return { canvases: out, numPages: pdf.numPages, pdf };
}
const canvasBlob = (c, type = 'image/jpeg', q = .85) => new Promise(r => c.toBlob(r, type, q));
async function canvasBytes(c, type, q) { return new Uint8Array(await (await canvasBlob(c, type, q)).arrayBuffer()); }
/* Render (Thai-capable) text to PNG via canvas, so any font/Unicode works in pdf-lib */
async function textToPng(text, { size = 48, color = '#000000', opacity = 1, font = 'Sarabun', weight = 600, scaleUp = 2 } = {}) {
  const c = document.createElement('canvas'); const ctx = c.getContext('2d');
  const f = `${weight} ${size * scaleUp}px ${font}, sans-serif`;
  try { await document.fonts.load(f); } catch { }
  ctx.font = f; const lines = String(text).split('\n');
  const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + size * scaleUp * 0.4;
  const lh = size * scaleUp * 1.5; c.width = Math.ceil(w); c.height = Math.ceil(lh * lines.length);
  ctx.font = f; ctx.fillStyle = color; ctx.globalAlpha = opacity; ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, size * scaleUp * 0.2, lh * (i + .5)));
  return { bytes: await canvasBytes(c, 'image/png'), w: c.width / scaleUp, h: c.height / scaleUp };
}
async function fileToPngOrJpg(file, { maxW = 0, quality = .9, type = null, enhance = false } = {}) {
  const img = await createImageBitmap(file);
  let w = img.width, h = img.height;
  if (maxW && w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
  const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  if (enhance) { // simple document enhancement: grayscale + contrast + brightness
    const d = ctx.getImageData(0, 0, w, h), p = d.data;
    for (let i = 0; i < p.length; i += 4) { let g = .3 * p[i] + .59 * p[i + 1] + .11 * p[i + 2]; g = (g - 128) * 1.6 + 150; p[i] = p[i + 1] = p[i + 2] = Math.max(0, Math.min(255, g)); }
    ctx.putImageData(d, 0, 0);
  }
  const t = type || (file.type === 'image/png' ? 'image/png' : 'image/jpeg');
  return { bytes: await canvasBytes(c, t, quality), w, h, type: t, canvas: c };
}
async function embedImage(doc, file, opt = {}) {
  const { bytes, type, w, h } = await fileToPngOrJpg(file, opt);
  const img = type === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  return { img, w, h };
}

/* ---------------- tool registry ---------------- */
const ICONS = {
  scan: '<svg viewBox="0 0 24 24"><path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3"/><path d="M7 15l3-4 3 3 2-2 2 3"/></svg>',
  merge: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="10" height="13" rx="2"/><path d="M8 3h10a2 2 0 012 2v11"/></svg>',
  organize: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><path d="M17 14v6M14 17h6"/></svg>',
  split: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="7" height="16" rx="2"/><rect x="14" y="4" width="7" height="16" rx="2"/></svg>',
  compress: '<svg viewBox="0 0 24 24"><path d="M4 9l4 0M8 9V5M20 9h-4M16 9V5M4 15h4M8 15v4M20 15h-4M16 15v4"/></svg>',
  pdf2img: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5-5-8 8"/></svg>',
  imgcomp: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 16l5-5 4 4 3-3 6 6"/><path d="M17 8h3M18.5 6.5v3"/></svg>',
  img2pdf: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="9" height="9" rx="1.5"/><path d="M14 6h5a2 2 0 012 2v11a2 2 0 01-2 2H9a2 2 0 01-2-2v-4"/><path d="M11 16h6M11 19h4"/></svg>',
  pagenum: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M11 17h2"/></svg>',
  watermark: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M12 9c-2 2.5-3 4-3 5.5a3 3 0 006 0C15 13 14 11.5 12 9z"/></svg>',
  text: '<svg viewBox="0 0 24 24"><path d="M5 5h14M12 5v14M9 19h6"/></svg>',
  sign: '<svg viewBox="0 0 24 24"><path d="M3 17c3-6 6-8 7-6s-1 6 0 6 3-5 5-5 1 5 3 5 2-3 3-3"/><path d="M3 21h18"/></svg>',
  unwm: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 9l6 6M15 9l-6 6"/></svg>',
  rotate: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 11-3-6.2"/><path d="M20 4v5h-5"/></svg>',
  pdf2txt: '<svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h6"/></svg>',
  meta: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
};
const TOOLS = [
  { id: 'scan', name: 'สแกนเอกสาร', desc: 'ถ่ายหรือเลือกรูปเอกสาร ปรับให้ชัดแล้วรวมเป็น PDF', color: '#b8102a', accept: 'image/*', multi: true, capture: true, quick: true },
  { id: 'merge', name: 'รวมไฟล์ PDF', desc: 'ต่อหลายไฟล์เข้าด้วยกันตามลำดับที่ต้องการ', color: '#1f4fbf', accept: '.pdf', multi: true, quick: true },
  { id: 'organize', name: 'จัดหน้า PDF', desc: 'ลากสลับลำดับ หมุน หรือลบหน้าที่ไม่ต้องการ', color: '#6f3fcf', accept: '.pdf', quick: true },
  { id: 'split', name: 'แยกไฟล์ PDF', desc: 'ดึงเฉพาะหน้าที่ต้องการ หรือแบ่งเป็นหลายไฟล์', color: '#108a7a', accept: '.pdf', quick: true },
  { id: 'compress', name: 'ลดขนาด PDF', desc: 'บีบอัดภาพในเอกสารให้ไฟล์เล็กลง ส่งทาง LINE/อีเมลได้', color: '#c07a0c', accept: '.pdf', quick: true },
  { id: 'pdf2img', name: 'PDF → JPG / PNG', desc: 'แปลงทุกหน้าเป็นรูปภาพ ดาวน์โหลดเป็น ZIP', color: '#cc1f3a', accept: '.pdf' },
  { id: 'imgcomp', name: 'ลดขนาดไฟล์ภาพ', desc: 'บีบอัด JPG, PNG, WEBP ย่อความละเอียดได้', color: '#d98a10', accept: 'image/*', multi: true },
  { id: 'img2pdf', name: 'JPG → PDF', desc: 'รวมรูปถ่ายหรือภาพเอกสารหลายใบเป็น PDF ไฟล์เดียว', color: '#0e8fc9', accept: 'image/*', multi: true, quick: true },
  { id: 'pagenum', name: 'ใส่เลขหน้า', desc: 'เพิ่มเลขหน้าในตำแหน่งและรูปแบบที่กำหนด', color: '#5846d6', accept: '.pdf' },
  { id: 'watermark', name: 'ใส่ลายน้ำ', desc: 'ข้อความหรือโลโก้ ปรับความโปร่งใส มุม และการเรียงซ้ำ', color: '#b11dab', accept: '.pdf', quick: true },
  { id: 'text', name: 'ใส่ข้อความ', desc: 'แตะบนหน้าเพื่อวางข้อความ ภาษาไทยได้', color: '#2b7a3a', accept: '.pdf' },
  { id: 'sign', name: 'ลายเซ็น', desc: 'วาดลายเซ็นหรืออัปโหลดรูป แล้ววางบนหน้าที่ต้องการ', color: '#8b0000', accept: '.pdf', quick: true },
  { id: 'unwm', name: 'เอาลายน้ำออก', desc: 'ลบ Stamp/Annotation หรือปิดทับบริเวณลายน้ำ', color: '#4a4a55', accept: '.pdf' },
  { id: 'rotate', name: 'หมุนหน้า', desc: 'หมุนทุกหน้าหรือเฉพาะบางหน้า 90 / 180 / 270 องศา', color: '#1a8fa0', accept: '.pdf' },
  { id: 'pdf2txt', name: 'ดึงข้อความ (PDF → TXT)', desc: 'คัดลอกข้อความจาก PDF ไปใช้ต่อได้ทันที', color: '#5f6b1c', accept: '.pdf' },
  { id: 'meta', name: 'แก้ข้อมูลไฟล์ (Metadata)', desc: 'ตั้ง Title / Author / Subject / Keywords', color: '#6b5a2b', accept: '.pdf' },
];

/* ---------------- navigation ---------------- */
function go(v) {
  document.querySelectorAll('.view').forEach(s => s.classList.toggle('active', s.id === 'v-' + v));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.v === v));
  window.scrollTo({ top: 0 });
  if (v === 'recent') renderRecent();
}
function cardHtml(t) {
  return `<button class="card" style="--ico:${t.color}" onclick="openTool('${t.id}')">
    <div class="ic">${ICONS[t.id]}</div><h3>${t.name}</h3><p>${t.desc}</p></button>`;
}
$('#gridQuick').innerHTML = TOOLS.filter(t => t.quick).map(cardHtml).join('');
$('#gridAll').innerHTML = TOOLS.map(cardHtml).join('');
$('#toolCount').textContent = `รวม ${TOOLS.length} รายการ`;
$('#statTools').textContent = TOOLS.length;

/* ---------------- recent ---------------- */
function addRecent(tool, name, size) {
  const r = JSON.parse(localStorage.getItem('tesr.recent') || '[]');
  r.unshift({ tool, name, size, t: Date.now() }); localStorage.setItem('tesr.recent', JSON.stringify(r.slice(0, 30)));
  const today = new Date().toDateString();
  $('#statDone').textContent = r.filter(x => new Date(x.t).toDateString() === today).length;
}
function renderRecent() {
  const r = JSON.parse(localStorage.getItem('tesr.recent') || '[]');
  $('#recentList').innerHTML = r.length ? r.map(x => { const t = TOOLS.find(q => q.id === x.tool) || {}; return `<li><div class="ic" style="background:${t.color || '#555'}">${(t.name || '?').slice(0, 3)}</div><div style="flex:1;min-width:0"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${x.name}</div><small>${t.name || x.tool} · ${fmtSize(x.size)} · ${new Date(x.t).toLocaleString('th-TH')}</small></div></li>`; }).join('')
    : '<div class="empty">ยังไม่มีงานล่าสุด</div>';
}
function clearRecent() { localStorage.removeItem('tesr.recent'); renderRecent(); $('#statDone').textContent = 0; toast('ล้างประวัติแล้ว'); }
(() => { const r = JSON.parse(localStorage.getItem('tesr.recent') || '[]'); const today = new Date().toDateString(); $('#statDone').textContent = r.filter(x => new Date(x.t).toDateString() === today).length; })();

/* ---------------- settings ---------------- */
$('#setWm').value = settings.wm || ''; $('#setAuthor').value = settings.author || ''; $('#setPrefix').value = settings.prefix ?? '';
function saveSettings() { settings.wm = $('#setWm').value; settings.author = $('#setAuthor').value; settings.prefix = $('#setPrefix').value; localStorage.setItem('tesr.settings', JSON.stringify(settings)); toast('บันทึกการตั้งค่าแล้ว'); }

/* ---------------- workspace ---------------- */
let cur = null, files = [], state = {};
const opts = $('#opts'), extra = $('#extra'), fileList = $('#fileList'), runBtn = $('#runBtn'), status = $('#status'), prog = $('#prog'), result = $('#result'), dl = $('#dl');
function setStatus(m, err = false) { status.textContent = m; status.classList.toggle('err', err); }
function setProg(p) { prog.style.display = p == null ? 'none' : 'block'; prog.firstElementChild.style.width = (p * 100) + '%'; }
function showResult(blob, name, info) {
  result.style.display = 'block'; $('#resInfo').textContent = info || `${name} · ${fmtSize(blob.size)}`;
  dl.innerHTML = ''; const b = el('button', { className: 'btn gold' }, '⬇ ดาวน์โหลด'); b.onclick = () => download(blob, name); dl.appendChild(b);
  if (navigator.share && navigator.canShare) {
    const f = new File([blob], name, { type: blob.type });
    if (navigator.canShare({ files: [f] })) { const s = el('button', { className: 'btn ghost' }, 'แชร์ / ส่งต่อ'); s.onclick = () => navigator.share({ files: [f], title: name }).catch(() => { }); dl.appendChild(s); }
  }
  addRecent(cur.id, name, blob.size); toast('เสร็จแล้ว — ' + name);
}
function openTool(id) {
  cur = TOOLS.find(t => t.id === id); files = []; state = {};
  $('#wsIcon').style.background = cur.color; $('#wsIcon').innerHTML = ICONS[id]; $('#wsTitle').textContent = cur.name; $('#wsDesc').textContent = cur.desc;
  const inp = $('#fileIn'); inp.value = ''; inp.accept = cur.accept; inp.multiple = !!cur.multi;
  if (cur.capture) inp.setAttribute('capture', 'environment'); else inp.removeAttribute('capture');
  $('#dropHint').textContent = cur.accept === '.pdf' ? (cur.multi ? 'เลือกได้หลายไฟล์ PDF' : 'ไฟล์ PDF 1 ไฟล์') : 'JPG, PNG, WEBP — เลือกได้หลายรูป';
  $('#dropTitle').textContent = cur.capture ? 'ถ่ายรูป หรือเลือกรูปจากเครื่อง' : 'แตะหรือลากไฟล์มาวางที่นี่';
  extra.innerHTML = ''; result.style.display = 'none'; setStatus(''); setProg(null);
  go('work'); renderFiles(); buildOptions();
}
const drop = $('#drop');
['dragenter', 'dragover'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', ev => addFiles([...ev.dataTransfer.files]));
$('#fileIn').addEventListener('change', ev => { addFiles([...ev.target.files]); ev.target.value = ''; });
function addFiles(list) {
  const ok = list.filter(f => cur.accept === '.pdf' ? /pdf$/i.test(f.name) || f.type === 'application/pdf' : f.type.startsWith('image/'));
  if (!ok.length) return toast('ประเภทไฟล์ไม่ถูกต้อง');
  files = cur.multi ? files.concat(ok) : [ok[0]];
  renderFiles(); onFilesChanged();
}
function renderFiles() {
  fileList.innerHTML = files.map((f, i) => `<li draggable="true" data-i="${i}"><span class="badge">${cur.accept === '.pdf' ? 'PDF' : 'IMG'}</span><span class="nm">${f.name}</span><span class="sz">${fmtSize(f.size)}</span>
   ${cur.multi ? `<button title="เลื่อนขึ้น" onclick="moveFile(${i},-1)">↑</button><button title="เลื่อนลง" onclick="moveFile(${i},1)">↓</button>` : ''}<button title="ลบ" onclick="removeFile(${i})">✕</button></li>`).join('');
  runBtn.disabled = files.length === 0;
}
function moveFile(i, d) { const j = i + d; if (j < 0 || j >= files.length) return;[files[i], files[j]] = [files[j], files[i]]; renderFiles(); }
function removeFile(i) { files.splice(i, 1); renderFiles(); onFilesChanged(); }
function onFilesChanged() { result.style.display = 'none'; setStatus(''); if (cur.onFiles) cur.onFiles(); }
runBtn.addEventListener('click', async () => {
  if (!files.length) return; if (!LIBS_OK) return setStatus('โหลดไลบรารีไม่สำเร็จ — ตรวจสอบการเชื่อมต่ออินเทอร์เน็ตแล้วรีเฟรชหน้า', true); runBtn.disabled = true; result.style.display = 'none'; setStatus('กำลังประมวลผล…'); setProg(0);
  try { await HANDLERS[cur.id](); setStatus('เสร็จสิ้น'); }
  catch (e) { console.error(e); setStatus('เกิดข้อผิดพลาด: ' + (e.message || e), true); }
  finally { setProg(null); runBtn.disabled = false; }
});

/* option builders */
const F = {
  text: (id, label, val = '', ph = '') => `<div class="field"><label>${label}</label><input type="text" id="${id}" value="${val.replace(/"/g, '&quot;')}" placeholder="${ph}"></div>`,
  num: (id, label, val, min, max, step = 1) => `<div class="field"><label>${label}</label><input type="number" id="${id}" value="${val}" min="${min}" max="${max}" step="${step}"></div>`,
  range: (id, label, val, min, max, step = 1, unit = '') => `<div class="field"><label>${label}: <b id="${id}_v">${val}${unit}</b></label><input type="range" id="${id}" value="${val}" min="${min}" max="${max}" step="${step}" oninput="document.getElementById('${id}_v').textContent=this.value+'${unit}'"></div>`,
  select: (id, label, items, val) => `<div class="field"><label>${label}</label><select id="${id}">${items.map(([v, l]) => `<option value="${v}" ${v == val ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`,
  seg: (id, label, items, val) => `<div class="field"><label>${label}</label><div class="seg" id="${id}" data-v="${val}">${items.map(([v, l]) => `<button type="button" data-v="${v}" class="${v == val ? 'on' : ''}" onclick="segPick(this)">${l}</button>`).join('')}</div></div>`,
  chk: (id, label, on = false) => `<label class="chk"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}>${label}</label>`,
  color: (id, label, val) => `<div class="field"><label>${label}</label><input type="color" id="${id}" value="${val}"></div>`,
  note: t => `<div class="note">${t}</div>`,
};
function segPick(b) { const s = b.parentElement; s.dataset.v = b.dataset.v;[...s.children].forEach(c => c.classList.toggle('on', c === b)); s.dispatchEvent(new Event('change')); }
const V = id => { const e = document.getElementById(id); if (!e) return null; if (e.classList.contains('seg')) return e.dataset.v; if (e.type === 'checkbox') return e.checked; return e.value; };

function buildOptions() {
  const b = OPTIONS[cur.id]; opts.innerHTML = b ? b() : '<div class="note">ไม่มีตัวเลือกเพิ่มเติม</div>';
  if (cur.init) cur.init();
}
const OPTIONS = {
  scan: () => F.seg('enh', 'ปรับภาพ', [['doc', 'เอกสาร (ขาวดำชัด)'], ['orig', 'สีต้นฉบับ']], 'doc') + F.seg('pg', 'ขนาดหน้า', [['A4', 'A4'], ['fit', 'พอดีรูป']], 'A4') + F.range('q', 'คุณภาพภาพ', 80, 40, 100, 5, '%') + F.note('เคล็ดลับ: ถ่ายในที่แสงสม่ำเสมอ วางเอกสารให้เต็มเฟรม'),
  merge: () => F.note('เรียงลำดับไฟล์ด้วยปุ่ม ↑ ↓ ในรายการด้านซ้าย ผลลัพธ์จะต่อกันตามลำดับนั้น') + F.text('nm', 'ชื่อไฟล์ผลลัพธ์', 'merged'),
  organize: () => F.note('ลากรูปย่อเพื่อสลับลำดับ · ↻ หมุน · ✕ ลบหน้า (กดอีกครั้งเพื่อยกเลิก)'),
  split: () => F.seg('mode', 'รูปแบบ', [['range', 'ดึงหน้าที่เลือก'], ['each', 'แยกทุกหน้า'], ['every', 'แบ่งทุก N หน้า']], 'range') + F.text('rng', 'หน้าที่ต้องการ (เช่น 1-3,5,8-10)', '', '1-3,5') + F.num('n', 'N หน้าต่อไฟล์', 2, 1, 999) + F.note('ดึงหน้าที่เลือก = 1 ไฟล์ · รูปแบบอื่นจะได้ ZIP'),
  compress: () => F.seg('lvl', 'ระดับการบีบอัด', [['low', 'เบา (ชัดสุด)'], ['mid', 'กลาง'], ['high', 'แรง (เล็กสุด)']], 'mid') + F.note('โหมดนี้แปลงแต่ละหน้าเป็นภาพบีบอัดใหม่ ข้อความจะเลือก/ค้นหาไม่ได้ แต่ขนาดลดลงมาก เหมาะกับเอกสารสแกน'),
  pdf2img: () => F.seg('fmt', 'รูปแบบ', [['jpeg', 'JPG'], ['png', 'PNG']], 'jpeg') + F.seg('dpi', 'ความละเอียด', [['1', 'ปกติ (72dpi)'], ['2', 'สูง (144dpi)'], ['3', 'สูงมาก (216dpi)']], '2') + F.text('rng', 'หน้าที่ต้องการ (เว้นว่าง = ทุกหน้า)', '', '1-5'),
  imgcomp: () => F.range('q', 'คุณภาพ', 75, 30, 100, 5, '%') + F.select('mw', 'ย่อความกว้างสูงสุด', [['0', 'ไม่ย่อ'], ['2560', '2560 px'], ['1920', '1920 px'], ['1280', '1280 px'], ['800', '800 px']], '1920') + F.seg('fmt', 'บันทึกเป็น', [['jpeg', 'JPG'], ['png', 'PNG'], ['webp', 'WEBP']], 'jpeg'),
  img2pdf: () => F.seg('pg', 'ขนาดหน้า', [['A4', 'A4'], ['fit', 'พอดีรูป']], 'A4') + F.seg('ori', 'แนว', [['auto', 'อัตโนมัติ'], ['p', 'แนวตั้ง'], ['l', 'แนวนอน']], 'auto') + F.num('mg', 'ขอบกระดาษ (mm)', 10, 0, 40) + F.range('q', 'คุณภาพภาพ', 85, 40, 100, 5, '%') + F.text('nm', 'ชื่อไฟล์ผลลัพธ์', 'images'),
  pagenum: () => F.seg('pos', 'ตำแหน่ง', [['bl', 'ล่างซ้าย'], ['bc', 'ล่างกลาง'], ['br', 'ล่างขวา'], ['tl', 'บนซ้าย'], ['tc', 'บนกลาง'], ['tr', 'บนขวา']], 'bc') + F.select('fmt', 'รูปแบบ', [['{n}', '1, 2, 3'], ['{n} / {t}', '1 / 10'], ['หน้า {n}', 'หน้า 1'], ['หน้า {n} จาก {t}', 'หน้า 1 จาก 10'], ['- {n} -', '- 1 -']], '{n}') + `<div class="row">${F.num('sz', 'ขนาดตัวอักษร', 11, 6, 40)}${F.num('st', 'เริ่มนับที่', 1, 0, 9999)}</div>` + F.color('col', 'สี', '#000000') + F.chk('skip', 'ไม่ใส่เลขหน้าแรก'),
  watermark: () => F.seg('type', 'ชนิด', [['text', 'ข้อความ'], ['logo', 'โลโก้ TESR'], ['img', 'รูปอื่น']], 'text') + F.text('txt', 'ข้อความ', settings.wm || 'TESR CONFIDENTIAL') + `<div class="field" id="wmImgF" style="display:none"><label>รูปลายน้ำ (PNG โปร่งใสได้)</label><input type="file" id="wmImg" accept="image/*"></div>` + `<div class="row">${F.range('op', 'ความโปร่งใส', 25, 5, 100, 5, '%')}${F.range('rot', 'มุม', 45, -90, 90, 5, '°')}</div>` + F.range('sz', 'ขนาด (% ของความกว้างหน้า)', 60, 10, 100, 5, '%') + F.color('col', 'สี', '#b8102a') + F.chk('tile', 'เรียงซ้ำทั่วทั้งหน้า') + F.text('rng', 'เฉพาะหน้า (เว้นว่าง = ทุกหน้า)', '', '1-3'),
  text: () => F.text('txt', 'ข้อความ', '', 'พิมพ์ข้อความ…') + `<div class="row">${F.num('sz', 'ขนาด', 14, 6, 120)}${F.color('col', 'สี', '#000000')}</div>` + F.select('font', 'ฟอนต์', [['Sarabun', 'Sarabun'], ['Kanit', 'Kanit'], ['serif', 'Serif'], ['monospace', 'Monospace']], 'Sarabun') + F.chk('all', 'ใส่ทุกหน้าในตำแหน่งเดียวกัน') + F.note('แตะบนตัวอย่างหน้าเอกสารด้านซ้ายเพื่อกำหนดตำแหน่ง (มุมซ้ายบนของข้อความ)'),
  sign: () => F.seg('src', 'ที่มาลายเซ็น', [['draw', 'วาด'], ['upload', 'อัปโหลดรูป']], 'draw') + `<div id="sigDraw"><div class="field"><label>วาดลายเซ็นในกรอบ</label><canvas class="sig" id="sigCv"></canvas></div><div class="seg" style="margin-top:6px"><button type="button" onclick="sigClear()">ล้าง</button><button type="button" data-c="#000" onclick="sigColor(this)" class="on">ดำ</button><button type="button" data-c="#1a3fb8" onclick="sigColor(this)">น้ำเงิน</button></div></div>` + `<div class="field" id="sigUp" style="display:none"><label>รูปลายเซ็น (PNG พื้นโปร่งใสจะดีที่สุด)</label><input type="file" id="sigImg" accept="image/*"></div>` + F.range('w', 'ความกว้าง (% ของหน้า)', 25, 5, 80, 1, '%') + F.chk('all', 'ใส่ทุกหน้าในตำแหน่งเดียวกัน') + F.note('แตะบนตัวอย่างหน้าเอกสารเพื่อกำหนดจุดวาง (มุมซ้ายบนของลายเซ็น)'),
  unwm: () => F.seg('mode', 'วิธี', [['annot', 'ลบ Stamp / Annotation'], ['cover', 'ปิดทับบริเวณที่เลือก']], 'annot') + F.color('col', 'สีที่ใช้ปิดทับ', '#ffffff') + F.chk('all', 'ใช้กับทุกหน้า', true) + F.note('วิธี 1 ลบลายน้ำแบบ Annotation/Stamp ออกทั้งหมด (ไม่กระทบเนื้อหา) · วิธี 2 ลากกรอบบนตัวอย่างเพื่อปิดทับลายน้ำที่ฝังอยู่ในเนื้อหา'),
  rotate: () => F.seg('deg', 'มุม', [['90', '90° ตามเข็ม'], ['180', '180°'], ['270', '90° ทวนเข็ม']], '90') + F.text('rng', 'เฉพาะหน้า (เว้นว่าง = ทุกหน้า)', '', '2,4-6'),
  pdf2txt: () => F.chk('sep', 'คั่นแต่ละหน้าด้วยหัวข้อ --- หน้า N ---', true),
  meta: () => F.text('title', 'Title', '') + F.text('author', 'Author', settings.author || 'TESR Co., Ltd.') + F.text('subject', 'Subject', '') + F.text('kw', 'Keywords (คั่นด้วย ,)', ''),
};

/* ---- per-tool UI hooks ---- */
const tool = id => TOOLS.find(t => t.id === id);
tool('watermark').init = () => $('#type').addEventListener('change', () => { const t = V('type'); $('#wmImgF').style.display = t === 'img' ? '' : 'none'; $('#txt').parentElement.style.display = t === 'text' ? '' : 'none'; $('#col').parentElement.style.display = t === 'text' ? '' : 'none'; });
tool('sign').init = () => { initSigPad(); $('#src').addEventListener('change', () => { const d = V('src') === 'draw'; $('#sigDraw').style.display = d ? '' : 'none'; $('#sigUp').style.display = d ? 'none' : ''; }); };
tool('split').init = () => { const f = () => { $('#rng').parentElement.style.display = V('mode') === 'range' ? '' : 'none'; $('#n').parentElement.style.display = V('mode') === 'every' ? '' : 'none'; }; $('#mode').addEventListener('change', f); f(); };
tool('unwm').init = () => $('#mode').addEventListener('change', () => { state.mark = null; if (V('mode') === 'cover') buildPreview({ box: true }); else extra.innerHTML = ''; });
tool('organize').onFiles = () => buildThumbs();
tool('text').onFiles = () => buildPreview({ point: true });
tool('sign').onFiles = () => buildPreview({ point: true });
tool('unwm').onFiles = () => { if (V('mode') === 'cover') buildPreview({ box: true }); };
tool('meta').onFiles = async () => { try { const d = await loadPdf(await readBytes(files[0])); $('#title').value = d.getTitle() || ''; $('#subject').value = d.getSubject() || ''; $('#kw').value = (d.getKeywords() || ''); if (d.getAuthor()) $('#author').value = d.getAuthor(); } catch { } };

/* ---- signature pad ---- */
let sigCtx, sigHas = false, sigCol = '#000';
function initSigPad() {
  const c = $('#sigCv'); const fit = () => { const r = c.getBoundingClientRect(); const d = window.devicePixelRatio || 1; c.width = r.width * d; c.height = r.height * d; sigCtx = c.getContext('2d'); sigCtx.scale(d, d); sigCtx.lineWidth = 2.2; sigCtx.lineCap = 'round'; sigCtx.lineJoin = 'round'; sigHas = false; };
  fit(); let drawing = false;
  const pos = e => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  c.onpointerdown = e => { drawing = true; c.setPointerCapture(e.pointerId); sigCtx.strokeStyle = sigCol; sigCtx.beginPath(); sigCtx.moveTo(...pos(e)); };
  c.onpointermove = e => { if (!drawing) return; sigCtx.lineTo(...pos(e)); sigCtx.stroke(); sigHas = true; };
  c.onpointerup = c.onpointercancel = () => drawing = false;
}
function sigClear() { const c = $('#sigCv'); sigCtx.clearRect(0, 0, c.width, c.height); sigHas = false; }
function sigColor(b) { sigCol = b.dataset.c;[...b.parentElement.children].forEach(x => x.classList.toggle('on', x === b)); }
async function sigPngTrimmed() {
  const c = $('#sigCv'); const ctx = c.getContext('2d'); const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const pad = 8; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(c.width, x1 + pad); y1 = Math.min(c.height, y1 + pad);
  const o = document.createElement('canvas'); o.width = x1 - x0; o.height = y1 - y0; o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return { bytes: await canvasBytes(o, 'image/png'), w: o.width, h: o.height };
}

/* ---- page preview with point/box placement ---- */
async function buildPreview({ point = false, box = false } = {}) {
  if (!files.length) { extra.innerHTML = ''; return; }
  state.mark = null;
  extra.innerHTML = `<div class="pvbar" style="margin-top:14px"><span>ตัวอย่างหน้า</span><select id="pvPage"></select><span id="pvInfo">${point ? 'แตะเพื่อกำหนดตำแหน่ง' : 'ลากเพื่อเลือกบริเวณ'}</span></div><div class="pv" id="pv"><canvas id="pvCv"></canvas></div>`;
  const bytes = await readBytes(files[0]); state.bytes = bytes;
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise; state.numPages = pdf.numPages;
  const sel = $('#pvPage'); sel.innerHTML = Array.from({ length: pdf.numPages }, (_, i) => `<option value="${i + 1}">หน้า ${i + 1} / ${pdf.numPages}</option>`).join('');
  const cv = $('#pvCv'), pv = $('#pv');
  async function draw() {
    const page = await pdf.getPage(+sel.value); const vp = page.getViewport({ scale: 1.2 }); cv.width = vp.width; cv.height = vp.height;
    await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise; state.pvPage = +sel.value; pv.querySelectorAll('.mark').forEach(m => m.remove()); state.mark = null;
  }
  sel.onchange = draw; await draw();
  const rel = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };
  const showMark = () => { pv.querySelectorAll('.mark').forEach(m => m.remove()); const m = state.mark; if (!m) return; const d = el('div', { className: 'mark' + (box ? ' box' : '') }); if (box) { d.style.left = m.x * 100 + '%'; d.style.top = m.y * 100 + '%'; d.style.width = m.w * 100 + '%'; d.style.height = m.h * 100 + '%'; } else { d.style.left = `calc(${m.x * 100}% - 6px)`; d.style.top = `calc(${m.y * 100}% - 6px)`; d.style.width = '12px'; d.style.height = '12px'; d.style.borderRadius = '50%'; } pv.appendChild(d); };
  if (point) cv.onpointerdown = e => { state.mark = { ...rel(e), page: state.pvPage }; showMark(); $('#pvInfo').textContent = `ตำแหน่ง ${(state.mark.x * 100).toFixed(0)}% , ${(state.mark.y * 100).toFixed(0)}%`; };
  if (box) { let s = null; cv.onpointerdown = e => { s = rel(e); cv.setPointerCapture(e.pointerId); }; cv.onpointermove = e => { if (!s) return; const p = rel(e); state.mark = { x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y), page: state.pvPage }; showMark(); }; cv.onpointerup = () => { s = null; if (state.mark) $('#pvInfo').textContent = 'เลือกบริเวณแล้ว'; }; }
}

/* ---- organize thumbnails ---- */
async function buildThumbs() {
  if (!files.length) { extra.innerHTML = ''; return; }
  extra.innerHTML = '<div class="status">กำลังสร้างตัวอย่างหน้า…</div>';
  const bytes = await readBytes(files[0]); state.bytes = bytes;
  const { canvases } = await renderPages(bytes, { scale: .4 });
  state.pages = canvases.map((c, i) => ({ idx: i, src: c.toDataURL('image/jpeg', .7), rot: 0, del: false }));
  const wrap = el('div', { className: 'thumbs', id: 'thumbs', style: 'margin-top:14px' }); extra.innerHTML = ''; extra.appendChild(wrap); drawThumbs();
}
function drawThumbs() {
  const w = $('#thumbs'); w.innerHTML = state.pages.map((p, i) => `<div class="thumb ${p.del ? 'deleted' : ''}" draggable="true" data-i="${i}"><span class="n">${p.idx + 1}</span><img src="${p.src}" style="transform:rotate(${p.rot}deg)"><div class="acts"><button onclick="thRot(${i})" title="หมุน">↻</button><button onclick="thMove(${i},-1)">←</button><button onclick="thMove(${i},1)">→</button><button onclick="thDel(${i})" title="ลบ">✕</button></div></div>`).join('');
  let from = null;
  w.querySelectorAll('.thumb').forEach(t => {
    t.addEventListener('dragstart', () => { from = +t.dataset.i; t.classList.add('drag'); });
    t.addEventListener('dragend', () => t.classList.remove('drag'));
    t.addEventListener('dragover', e => { e.preventDefault(); t.classList.add('over'); });
    t.addEventListener('dragleave', () => t.classList.remove('over'));
    t.addEventListener('drop', e => { e.preventDefault(); const to = +t.dataset.i; if (from === null || from === to) return; const [it] = state.pages.splice(from, 1); state.pages.splice(to, 0, it); drawThumbs(); });
  });
}
function thRot(i) { state.pages[i].rot = (state.pages[i].rot + 90) % 360; drawThumbs(); }
function thDel(i) { state.pages[i].del = !state.pages[i].del; drawThumbs(); }
function thMove(i, d) { const j = i + d; if (j < 0 || j >= state.pages.length) return;[state.pages[i], state.pages[j]] = [state.pages[j], state.pages[i]]; drawThumbs(); }

/* ---------------- handlers ---------------- */
const A4 = [595.28, 841.89];
function fitImage(iw, ih, pw, ph, margin) { const aw = pw - margin * 2, ah = ph - margin * 2; const s = Math.min(aw / iw, ah / ih); return { w: iw * s, h: ih * s, x: (pw - iw * s) / 2, y: (ph - ih * s) / 2 }; }
async function imagesToPdf(imgFiles, { pg, ori, mg, q, enhance }) {
  const doc = await PDFDocument.create(); const margin = (mg || 0) * 2.835;
  for (let i = 0; i < imgFiles.length; i++) {
    const { bytes, w, h } = await fileToPngOrJpg(imgFiles[i], { maxW: 2400, quality: q, type: 'image/jpeg', enhance });
    const img = await doc.embedJpg(bytes);
    let pw, ph; if (pg === 'fit') { pw = w * .75 + margin * 2; ph = h * .75 + margin * 2; } else { const land = ori === 'l' || (ori === 'auto' && w > h);[pw, ph] = land ? [A4[1], A4[0]] : A4; }
    const page = doc.addPage([pw, ph]); const f = fitImage(w, h, pw, ph, margin); page.drawImage(img, f); setProg((i + 1) / imgFiles.length);
  }
  return doc;
}
function pagePos(pos, pw, ph, w, h, m = 28) {
  const x = pos.endsWith('l') ? m : pos.endsWith('r') ? pw - m - w : (pw - w) / 2;
  const y = pos.startsWith('b') ? m : ph - m - h; return { x, y };
}
const HANDLERS = {
  async scan() { const doc = await imagesToPdf(files, { pg: V('pg'), ori: 'auto', mg: 0, q: V('q') / 100, enhance: V('enh') === 'doc' }); const b = new Blob([await savePdf(doc)], { type: 'application/pdf' }); showResult(b, `${prefix()}scan_${Date.now().toString(36)}.pdf`, `${files.length} หน้า · ${fmtSize(b.size)}`); },
  async img2pdf() { const doc = await imagesToPdf(files, { pg: V('pg'), ori: V('ori'), mg: +V('mg'), q: V('q') / 100 }); const b = new Blob([await savePdf(doc)], { type: 'application/pdf' }); showResult(b, `${prefix()}${V('nm') || 'images'}.pdf`, `${files.length} รูป → ${fmtSize(b.size)}`); },
  async merge() {
    const out = await PDFDocument.create(); let n = 0;
    for (let i = 0; i < files.length; i++) { const d = await loadPdf(await readBytes(files[i])); const ps = await out.copyPages(d, d.getPageIndices()); ps.forEach(p => out.addPage(p)); n += ps.length; setProg((i + 1) / files.length); }
    const b = new Blob([await savePdf(out)], { type: 'application/pdf' }); showResult(b, `${prefix()}${V('nm') || 'merged'}.pdf`, `${files.length} ไฟล์ · ${n} หน้า · ${fmtSize(b.size)}`);
  },
  async organize() {
    if (!state.pages) await buildThumbs();
    const keep = state.pages.filter(p => !p.del); if (!keep.length) throw new Error('ต้องเหลืออย่างน้อย 1 หน้า');
    const src = await loadPdf(state.bytes); const out = await PDFDocument.create();
    const ps = await out.copyPages(src, keep.map(p => p.idx));
    ps.forEach((p, i) => { if (keep[i].rot) p.setRotation(degrees((p.getRotation().angle + keep[i].rot) % 360)); out.addPage(p); });
    const b = new Blob([await savePdf(out)], { type: 'application/pdf' }); showResult(b, `${prefix()}${baseName(files[0])}_organized.pdf`, `${keep.length} หน้า · ${fmtSize(b.size)}`);
  },
  async split() {
    const src = await loadPdf(await readBytes(files[0])); const total = src.getPageCount(); const mode = V('mode'); const nm = baseName(files[0]);
    const sub = async idxs => { const d = await PDFDocument.create(); (await d.copyPages(src, idxs)).forEach(p => d.addPage(p)); return savePdf(d); };
    if (mode === 'range') { const pages = parseRanges(V('rng'), total); if (!pages.length) throw new Error('ระบุหน้าไม่ถูกต้อง'); const b = new Blob([await sub(pages.map(p => p - 1))], { type: 'application/pdf' }); showResult(b, `${prefix()}${nm}_pages_${V('rng').replace(/[^\d,-]/g, '')}.pdf`, `${pages.length} หน้า · ${fmtSize(b.size)}`); return; }
    const zip = new JSZip(); const groups = []; const n = mode === 'each' ? 1 : Math.max(1, +V('n'));
    for (let i = 0; i < total; i += n) groups.push(Array.from({ length: Math.min(n, total - i) }, (_, k) => i + k));
    for (let g = 0; g < groups.length; g++) { zip.file(`${nm}_${String(g + 1).padStart(3, '0')}_p${groups[g][0] + 1}-${groups[g].at(-1) + 1}.pdf`, await sub(groups[g])); setProg((g + 1) / groups.length); }
    const b = await zip.generateAsync({ type: 'blob' }); showResult(b, `${prefix()}${nm}_split.zip`, `${groups.length} ไฟล์ · ${fmtSize(b.size)}`);
  },
  async compress() {
    const bytes = await readBytes(files[0]); const lvl = V('lvl'); const cfg = { low: [1.6, .82], mid: [1.25, .7], high: [1.0, .55] }[lvl];
    const out = await PDFDocument.create();
    await renderPages(bytes, { scale: cfg[0], onProgress: setProg, onPage: async c => { const img = await out.embedJpg(await canvasBytes(c, 'image/jpeg', cfg[1])); const page = out.addPage([c.width / cfg[0], c.height / cfg[0]]); page.drawImage(img, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() }); return null; } });
    const b = new Blob([await savePdf(out)], { type: 'application/pdf' }); const pct = Math.round((1 - b.size / files[0].size) * 100);
    showResult(b, `${prefix()}${baseName(files[0])}_compressed.pdf`, `${fmtSize(files[0].size)} → ${fmtSize(b.size)} (${pct > 0 ? 'ลดลง ' + pct + '%' : 'ไฟล์เดิมเล็กอยู่แล้ว'})`);
  },
  async pdf2img() {
    const bytes = await readBytes(files[0]); const fmt = V('fmt'); const scale = +V('dpi'); const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
    const pages = V('rng').trim() ? parseRanges(V('rng'), pdf.numPages) : null; const zip = new JSZip(); const nm = baseName(files[0]); let last = null;
    const r = await renderPages(bytes, { scale, pages, onProgress: setProg, onPage: async (c, pn) => { const blob = await canvasBlob(c, 'image/' + fmt, .9); last = blob; zip.file(`${nm}_${String(pn).padStart(3, '0')}.${fmt === 'jpeg' ? 'jpg' : 'png'}`, blob); return null; } });
    if (r.canvases.length === 1) { showResult(last, `${prefix()}${nm}.${fmt === 'jpeg' ? 'jpg' : 'png'}`); return; }
    const b = await zip.generateAsync({ type: 'blob' }); showResult(b, `${prefix()}${nm}_images.zip`, `${r.canvases.length} รูป · ${fmtSize(b.size)}`);
  },
  async imgcomp() {
    const q = V('q') / 100, mw = +V('mw'), fmt = V('fmt'); const ext = fmt === 'jpeg' ? 'jpg' : fmt; let before = 0, after = 0; const zip = new JSZip(); let single = null;
    for (let i = 0; i < files.length; i++) { const { bytes } = await fileToPngOrJpg(files[i], { maxW: mw, quality: q, type: 'image/' + fmt }); before += files[i].size; after += bytes.length; const blob = new Blob([bytes], { type: 'image/' + fmt }); single = blob; zip.file(`${baseName(files[i])}.${ext}`, blob); setProg((i + 1) / files.length); }
    const info = `${fmtSize(before)} → ${fmtSize(after)} (ลดลง ${Math.max(0, Math.round((1 - after / before) * 100))}%)`;
    if (files.length === 1) showResult(single, `${prefix()}${baseName(files[0])}.${ext}`, info); else { const b = await zip.generateAsync({ type: 'blob' }); showResult(b, `${prefix()}images_compressed.zip`, `${files.length} รูป · ` + info); }
  },
  async pagenum() {
    const doc = await loadPdf(await readBytes(files[0])); const pages = doc.getPages(); const fmt = V('fmt'), size = +V('sz'), start = +V('st'), skip = V('skip'), col = V('col'), pos = V('pos');
    for (let i = 0; i < pages.length; i++) {
      if (skip && i === 0) continue; const label = fmt.replace('{n}', start + i).replace('{t}', pages.length + start - 1);
      const { bytes, w, h } = await textToPng(label, { size, color: col, weight: 500 }); const img = await doc.embedPng(bytes); const p = pages[i]; const { width, height } = p.getSize();
      p.drawImage(img, { ...pagePos(pos, width, height, w, h), width: w, height: h }); setProg((i + 1) / pages.length);
    }
    const b = new Blob([await savePdf(doc)], { type: 'application/pdf' }); showResult(b, `${prefix()}${baseName(files[0])}_numbered.pdf`);
  },
  async watermark() {
    const doc = await loadPdf(await readBytes(files[0])); const pages = doc.getPages(); const op = V('op') / 100, rot = +V('rot'), pct = V('sz') / 100, tile = V('tile');
    let img, iw, ih;
    if (V('type') === 'logo') { const f = await (await fetch('logo.png')).blob(); const r = await embedImage(doc, f, { maxW: 1200, type: 'image/png' }); img = r.img; iw = r.w; ih = r.h; }
    else if (V('type') === 'img') { const f = $('#wmImg').files[0]; if (!f) throw new Error('กรุณาเลือกรูปลายน้ำ'); const r = await embedImage(doc, f, { maxW: 1600, type: 'image/png' }); img = r.img; iw = r.w; ih = r.h; }
    else { const t = V('txt').trim(); if (!t) throw new Error('กรุณาใส่ข้อความ'); const r = await textToPng(t, { size: 64, color: V('col'), weight: 700, font: 'Kanit' }); img = await doc.embedPng(r.bytes); iw = r.w; ih = r.h; }
    const sel = V('rng').trim() ? new Set(parseRanges(V('rng'), pages.length)) : null;
    for (let i = 0; i < pages.length; i++) {
      if (sel && !sel.has(i + 1)) continue; const p = pages[i]; const { width: pw, height: ph } = p.getSize();
      const w = pw * (tile ? pct * .45 : pct), h = w * ih / iw; const rad = rot * Math.PI / 180;
      const drawAt = (cx, cy) => { // rotate around center of image
        const x = cx - (w / 2) * Math.cos(rad) + (h / 2) * Math.sin(rad), y = cy - (w / 2) * Math.sin(rad) - (h / 2) * Math.cos(rad);
        p.drawImage(img, { x, y, width: w, height: h, rotate: degrees(rot), opacity: op });
      };
      if (tile) { const sx = w * 1.4, sy = Math.max(h * 3, sx * .6); for (let y = -sy; y < ph + sy; y += sy) for (let x = -sx / 2; x < pw + sx; x += sx) drawAt(x, y); }
      else drawAt(pw / 2, ph / 2);
      setProg((i + 1) / pages.length);
    }
    const b = new Blob([await savePdf(doc)], { type: 'application/pdf' }); showResult(b, `${prefix()}${baseName(files[0])}_watermarked.pdf`);
  },
  async text() {
    if (!state.mark) throw new Error('กรุณาแตะบนตัวอย่างหน้าเพื่อกำหนดตำแหน่ง'); const t = V('txt'); if (!t.trim()) throw new Error('กรุณาใส่ข้อความ');
    const doc = await loadPdf(state.bytes); const pages = doc.getPages(); const { bytes, w, h } = await textToPng(t, { size: +V('sz'), color: V('col'), font: V('font'), weight: 500 }); const img = await doc.embedPng(bytes);
    const targets = V('all') ? pages.map((_, i) => i) : [state.mark.page - 1];
    targets.forEach(i => { const p = pages[i]; const { width: pw, height: ph } = p.getSize(); p.drawImage(img, { x: state.mark.x * pw, y: ph - state.mark.y * ph - h, width: w, height: h }); });
    const b = new Blob([await savePdf(doc)], { type: 'application/pdf' }); showResult(b, `${prefix()}${baseName(files[0])}_text.pdf`);
  },
  async sign() {
    if (!state.mark) throw new Error('กรุณาแตะบนตัวอย่างหน้าเพื่อกำหนดจุดวาง');
    const doc = await loadPdf(state.bytes); const pages = doc.getPages(); let img, iw, ih;
    if (V('src') === 'draw') { if (!sigHas) throw new Error('กรุณาวาดลายเซ็นก่อน'); const r = await sigPngTrimmed(); img = await doc.embedPng(r.bytes); iw = r.w; ih = r.h; }
    else { const f = $('#sigImg').files[0]; if (!f) throw new Error('กรุณาเลือกรูปลายเซ็น'); const r = await embedImage(doc, f, { maxW: 1200, type: 'image/png' }); img = r.img; iw = r.w; ih = r.h; }
    const targets = V('all') ? pages.map((_, i) => i) : [state.mark.page - 1];
    targets.forEach(i => { const p = pages[i]; const { width: pw, height: ph } = p.getSize(); const w = pw * V('w') / 100, h = w * ih / iw; p.drawImage(img, { x: state.mark.x * pw, y: ph - state.mark.y * ph - h, width: w, height: h }); });
    const b = new Blob([await savePdf(doc)], { type: 'application/pdf' }); showResult(b, `${prefix()}${baseName(files[0])}_signed.pdf`);
  },
  async unwm() {
    const doc = await loadPdf(state.bytes || await readBytes(files[0])); const pages = doc.getPages(); let n = 0;
    if (V('mode') === 'annot') {
      pages.forEach(p => { const a = p.node.Annots(); if (a) { n += a.size(); p.node.delete(PDFName.of('Annots')); } });
      const b = new Blob([await savePdf(doc)], { type: 'application/pdf' }); showResult(b, `${prefix()}${baseName(files[0])}_clean.pdf`, `ลบ Annotation ${n} รายการ · ${fmtSize(b.size)}`); return;
    }
    if (!state.mark) throw new Error('กรุณาลากกรอบบนตัวอย่างหน้าเพื่อเลือกบริเวณ'); const m = state.mark; const targets = V('all') ? pages.map((_, i) => i) : [m.page - 1];
    targets.forEach(i => { const p = pages[i]; const { width: pw, height: ph } = p.getSize(); p.drawRectangle({ x: m.x * pw, y: ph - (m.y + m.h) * ph, width: m.w * pw, height: m.h * ph, color: hexToRgb(V('col')) }); });
    const b = new Blob([await savePdf(doc)], { type: 'application/pdf' }); showResult(b, `${prefix()}${baseName(files[0])}_clean.pdf`, `ปิดทับ ${targets.length} หน้า · ${fmtSize(b.size)}`);
  },
  async rotate() {
    const doc = await loadPdf(await readBytes(files[0])); const pages = doc.getPages(); const deg = +V('deg'); const sel = V('rng').trim() ? new Set(parseRanges(V('rng'), pages.length)) : null;
    pages.forEach((p, i) => { if (sel && !sel.has(i + 1)) return; p.setRotation(degrees((p.getRotation().angle + deg) % 360)); });
    const b = new Blob([await savePdf(doc)], { type: 'application/pdf' }); showResult(b, `${prefix()}${baseName(files[0])}_rotated.pdf`);
  },
  async pdf2txt() {
    const pdf = await pdfjsLib.getDocument({ data: (await readBytes(files[0])).slice(0) }).promise; let out = ''; const sep = V('sep');
    for (let i = 1; i <= pdf.numPages; i++) { const tc = await (await pdf.getPage(i)).getTextContent(); let line = '', lastY = null; tc.items.forEach(it => { if (lastY !== null && Math.abs(it.transform[5] - lastY) > 2) line += '\n'; line += it.str + (it.hasEOL ? '\n' : ''); lastY = it.transform[5]; }); out += (sep ? `--- หน้า ${i} ---\n` : '') + line.trim() + '\n\n'; setProg(i / pdf.numPages); }
    if (!out.trim()) throw new Error('ไม่พบข้อความ (อาจเป็น PDF สแกน) ลองใช้เครื่องมือ PDF → JPG แล้ว OCR ภายนอก');
    const b = new Blob(['\ufeff' + out], { type: 'text/plain;charset=utf-8' }); showResult(b, `${prefix()}${baseName(files[0])}.txt`, `${pdf.numPages} หน้า · ${out.length.toLocaleString()} ตัวอักษร`);
  },
  async meta() {
    const doc = await loadPdf(await readBytes(files[0])); doc.setTitle(V('title')); doc.setAuthor(V('author')); doc.setSubject(V('subject')); doc.setKeywords(V('kw').split(',').map(s => s.trim()).filter(Boolean)); doc.setModificationDate(new Date());
    const bytes = await doc.save({ useObjectStreams: true }); const b = new Blob([bytes], { type: 'application/pdf' }); showResult(b, `${prefix()}${baseName(files[0])}.pdf`);
  },
};

/* deep link: ?tool=merge */
const qp = new URLSearchParams(location.search).get('tool'); if (qp && tool(qp)) openTool(qp);

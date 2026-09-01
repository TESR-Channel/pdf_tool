/* TESR PDF Editor — ux.js : Interaction module (โหลดหลัง app.js + patch-responsive.js)
   - แก้ข้อความบนหน้าทันทีด้วยดับเบิลคลิก (inline editing) / ดับเบิลคลิกที่ว่าง = เพิ่มข้อความ
   - คลิกขวา / กดค้าง = เมนูบริบท
   - คีย์ลัด Ctrl+C/X/V/D/S/P/F/Z/Y/+/−/0, Delete, Enter, ลูกศร, ตัวอักษรสลับเครื่องมือ
   ทำงานเป็นชั้นบน app.js: ดักเหตุการณ์ในเฟส capture ก่อน handler เดิม แล้วหยุดส่งต่อเมื่อจัดการเอง */
'use strict';

/* ---------- inline text editing ---------- */
let inlineEd = null;
const wh = m => ({ w: m.w, h: m.h });
function newTextAt(i, x, y, text = '') {
  snapshot(); const p = pages[i]; const a = { id: uid(), type: 'text', x, y, text: text || 'ข้อความ', ...TD.text }; Object.assign(a, wh(measureText(a))); p.annots.push(a);
  if (tool !== 'select') setTool('select'); sel = { page: i, id: a.id }; drawOverlay(i); renderProps(); startInlineEdit(i, a, true);
}
function startInlineEdit(i, a, isNew = false) {
  finishInlineEdit(); if (!isNew) snapshot();
  const d = pageEls[i]; const m = measureText(a); const ed = el('div', { className: 'inline-edit', contentEditable: 'true', spellcheck: false });
  Object.assign(ed.style, { left: a.x * zoom + 'px', top: a.y * zoom + 'px', fontSize: a.size * zoom + 'px', fontFamily: (a.type === 'stamp' ? 'Kanit' : (a.font || 'Sarabun')) + ', sans-serif', fontWeight: (a.bold || a.type === 'stamp') ? 700 : 500, color: a.color, padding: m.pad * zoom + 'px', lineHeight: 1.4, minWidth: a.size * 2 * zoom + 'px', opacity: a.opacity ?? 1 });
  ed.innerText = a.text; d.appendChild(ed); inlineEd = { i, a, ed }; drawOverlay(i);
  const sync = () => { a.text = ed.innerText.replace(/\n$/, ''); Object.assign(a, wh(measureText(a))); if (a.type === 'stamp') a.w += 10; drawOverlay(i); };
  ed.addEventListener('input', sync);
  ed.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); finishInlineEdit(); } });
  ed.addEventListener('blur', () => finishInlineEdit());
  ed.focus(); const r = document.createRange(); r.selectNodeContents(ed); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r);
}
function finishInlineEdit() {
  if (!inlineEd) return; const { i, a, ed } = inlineEd; inlineEd = null; ed.remove();
  if (!a.text.trim()) { pages[i].annots = pages[i].annots.filter(q => q !== a); if (sel?.id === a.id) sel = null; }
  drawOverlay(i); renderProps();
}
/* keep the SVG copy hidden while its inline editor is open */
const _drawOverlay = drawOverlay;
drawOverlay = function (i) { _drawOverlay(i); if (inlineEd && inlineEd.i === i) pageEls[i]?.querySelector(`.ov .an[data-id="${inlineEd.a.id}"]`)?.setAttribute('opacity', '0'); };

/* ---------- pointer: double-click detection + text tool (capture phase, runs before app.js handler) ---------- */
let lastTap = null;
stage.addEventListener('pointermove', e => { const q = evPos(e); if (q) window.lastPtr = { page: q.i, x: q.x, y: q.y }; }, { passive: true });
stage.addEventListener('pointerdown', e => {
  if (e.target.closest('.inline-edit')) { e.stopImmediatePropagation(); return; }
  closeCtx(); if (e.button !== 0 && e.pointerType === 'mouse') return;
  const pos = evPos(e); if (!pos) return; const { i, x, y } = pos; const p = pages[i];
  if (tool === 'text') { e.preventDefault(); e.stopImmediatePropagation(); newTextAt(i, x, y); return; }
  if (tool !== 'select') return;
  const hdl = e.target.closest('[data-hdl]'); const an = e.target.closest('.an');
  const now = Date.now(), key = an ? an.dataset.id : 'page' + i; const isDbl = lastTap && lastTap.key === key && now - lastTap.t < 380 && Math.hypot(lastTap.x - x, lastTap.y - y) < 12; lastTap = { key, t: now, x, y };
  if (!isDbl || hdl) return;
  lastTap = null; e.preventDefault(); e.stopImmediatePropagation(); curPage = i;
  if (an) { const a = p.annots.find(q => q.id === an.dataset.id); if (a && (a.type === 'text' || a.type === 'stamp')) { sel = { page: i, id: a.id }; drawOverlay(i); startInlineEdit(i, a); } else if (a?.type === 'note') { sel = { page: i, id: a.id }; drawOverlay(i); renderProps(true); } }
  else newTextAt(i, x, y);
}, true);
stage.addEventListener('dblclick', e => e.stopImmediatePropagation(), true); // native dblclick is unreliable under pointer capture; handled above

/* ---------- clipboard ---------- */
let clip = null;
function selAnnot() { return sel ? pages[sel.page]?.annots.find(q => q.id === sel.id) : null; }
function copySel() { const a = selAnnot(); if (!a) return false; clip = JSON.parse(JSON.stringify(a)); toast('คัดลอกแล้ว'); return true; }
function cutSel() { if (copySel()) deleteSel(); }
function pasteClip(at) {
  if (!clip || !pages.length) return; snapshot(); const c = JSON.parse(JSON.stringify(clip)); c.id = uid(); const i = at ? at.page : curPage; const b = bbox(c);
  const dx = at ? at.x - b.w / 2 - b.x : 16, dy = at ? at.y - b.h / 2 - b.y : 16;
  if (c.type === 'line' || c.type === 'arrow') { c.x1 += dx; c.x2 += dx; c.y1 += dy; c.y2 += dy; } else { c.x += dx; c.y += dy; if (c.pts) c.pts = c.pts.map(q => [q[0] + dx, q[1] + dy]); }
  pages[i].annots.push(c); if (!at) clip = JSON.parse(JSON.stringify(c)); sel = { page: i, id: c.id }; curPage = i; drawOverlay(i); renderProps();
}
function dupSel() { const a = selAnnot(); if (!a) return; const keep = clip; clip = JSON.parse(JSON.stringify(a)); pasteClip(); clip = keep || clip; }
function nudgeSel(dx, dy) { const a = selAnnot(); if (!a) return; snapshot(); if (a.type === 'line' || a.type === 'arrow') { a.x1 += dx; a.x2 += dx; a.y1 += dy; a.y2 += dy; } else { a.x += dx; a.y += dy; if (a.pts) a.pts = a.pts.map(q => [q[0] + dx, q[1] + dy]); } drawOverlay(sel.page); }
function zOrder(dir) { const a = selAnnot(); if (!a) return; snapshot(); const arr = pages[sel.page].annots; const k = arr.indexOf(a); arr.splice(k, 1); dir > 0 ? arr.push(a) : arr.unshift(a); drawOverlay(sel.page); }

/* ---------- keyboard shortcuts (capture phase; stops the older handler in app.js for handled keys) ---------- */
document.addEventListener('keydown', e => {
  if (!$('#editor').classList.contains('on')) return; const tag = e.target.tagName; if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(); let done = true;
  if (mod && k === 'z' && !e.shiftKey) undo();
  else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) redoFn();
  else if (mod && k === 'c') { if (sel) copySel(); else done = false; }
  else if (mod && k === 'x') { if (sel) cutSel(); else done = false; }
  else if (mod && k === 'v') { if (clip) pasteClip(); else done = false; }
  else if (mod && k === 'd') { if (sel) dupSel(); else done = false; }
  else if (mod && k === 's') runExport('pdf');
  else if (mod && k === 'p') $('#printBtn').click();
  else if (mod && k === 'f') $('#findIn').focus();
  else if (mod && (k === '=' || k === '+')) setZoom(zoom * 1.2);
  else if (mod && k === '-') setZoom(zoom / 1.2);
  else if (mod && k === '0') { zoomFit(); setZoom(zoom); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) deleteSel();
  else if (e.key === 'Enter' && sel) { const a = selAnnot(); if (a && (a.type === 'text' || a.type === 'stamp')) startInlineEdit(sel.page, a); else done = false; }
  else if (e.key.startsWith('Arrow') && sel) { const st = e.shiftKey ? 10 : 1; nudgeSel(e.key === 'ArrowLeft' ? -st : e.key === 'ArrowRight' ? st : 0, e.key === 'ArrowUp' ? -st : e.key === 'ArrowDown' ? st : 0); }
  else if (e.key === 'Escape') { closeCtx(); if (inlineEd) finishInlineEdit(); else setTool('select'); }
  else if (!mod && !e.altKey) { const map = { v: 'select', t: 'text', h: 'highlight', b: 'draw', e: 'whiteout', u: 'shape', i: 'image', n: 'note', g: 'sign', k: 'stamp', r: 'redact' }; if (map[k]) setTool(map[k]); else done = false; }
  else done = false;
  if (done) { e.preventDefault(); e.stopPropagation(); }
}, true);

/* ---------- context menu (right-click / long-press) ---------- */
const ctxEl = el('div', { className: 'ctx' }); document.body.appendChild(ctxEl);
function closeCtx() { ctxEl.classList.remove('on'); }
document.addEventListener('click', e => { if (!e.target.closest('.ctx')) closeCtx(); }); stage.addEventListener('scroll', closeCtx, { passive: true }); window.addEventListener('resize', closeCtx);
function openCtx(x, y, items) {
  items = items.filter(it => it !== undefined);
  ctxEl.innerHTML = items.map(it => it === null ? '<hr>' : `<button ${it.dis ? 'disabled' : ''} data-k="${it.k}"><span>${it.l}</span>${it.s ? `<kbd>${it.s}</kbd>` : ''}</button>`).join('');
  ctxEl.classList.add('on'); const r = ctxEl.getBoundingClientRect(); ctxEl.style.left = Math.min(x, innerWidth - r.width - 8) + 'px'; ctxEl.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  ctxEl.onclick = e => { const b = e.target.closest('button[data-k]'); if (!b) return; closeCtx(); const it = items.find(q => q && q.k === b.dataset.k); it?.fn?.(); };
}
function placeImage(i, x, y, aid, frac, extra = {}) { const as = assets[aid]; const { W } = dispSize(pages[i]); const w = W * frac, h = w * as.h / as.w; snapshot(); const a = { id: uid(), type: 'image', x: x - w / 2, y: y - h / 2, w, h, asset: aid, ...extra }; pages[i].annots.push(a); if (tool !== 'select') setTool('select'); sel = { page: i, id: a.id }; drawOverlay(i); renderProps(); }
stage.addEventListener('contextmenu', e => {
  e.preventDefault(); if (e.target.closest('.inline-edit')) return; const pos = evPos(e); if (!pos) return closeCtx();
  const an = e.target.closest('.an'); const at = { page: pos.i, x: pos.x, y: pos.y }; curPage = pos.i;
  if (an) {
    const a = pages[pos.i].annots.find(q => q.id === an.dataset.id); if (tool !== 'select') setTool('select'); sel = { page: pos.i, id: a.id }; drawOverlay(pos.i); renderProps();
    const canEdit = a.type === 'text' || a.type === 'stamp';
    openCtx(e.clientX, e.clientY, [
      canEdit ? { k: 'edit', l: 'แก้ไขข้อความ', s: 'Enter / ดับเบิลคลิก', fn: () => startInlineEdit(pos.i, a) } : a.type === 'note' ? { k: 'edit', l: 'แก้ไขหมายเหตุ', fn: () => renderProps(true) } : undefined,
      { k: 'cut', l: 'ตัด', s: 'Ctrl+X', fn: cutSel }, { k: 'copy', l: 'คัดลอก', s: 'Ctrl+C', fn: copySel }, { k: 'dup', l: 'ทำสำเนา', s: 'Ctrl+D', fn: dupSel }, null,
      { k: 'front', l: 'นำขึ้นหน้าสุด', fn: () => zOrder(1) }, { k: 'back', l: 'ส่งไปหลังสุด', fn: () => zOrder(-1) },
      { k: 'all', l: 'คัดลอกไปทุกหน้า', fn: () => { snapshot(); pages.forEach((p, k) => { if (k === pos.i) return; const c = JSON.parse(JSON.stringify(a)); c.id = uid(); p.annots.push(c); drawOverlay(k); }); toast('คัดลอกไปทุกหน้าแล้ว'); } }, null,
      { k: 'del', l: 'ลบ', s: 'Delete', fn: deleteSel },
    ]);
  } else {
    sel = null; drawOverlay(pos.i);
    openCtx(e.clientX, e.clientY, [
      { k: 'paste', l: 'วางที่นี่', s: 'Ctrl+V', dis: !clip, fn: () => pasteClip(at) }, null,
      { k: 'text', l: 'เพิ่มข้อความที่นี่', s: 'ดับเบิลคลิก', fn: () => newTextAt(pos.i, pos.x, pos.y) },
      { k: 'note', l: 'เพิ่มหมายเหตุที่นี่', fn: () => { snapshot(); const a = { id: uid(), type: 'note', x: pos.x, y: pos.y, w: 20, h: 20, text: '', color: TD.note.color, author: TD.note.author }; pages[pos.i].annots.push(a); setTool('select'); sel = { page: pos.i, id: a.id }; drawOverlay(pos.i); renderProps(true); } },
      { k: 'sign', l: 'ลงลายเซ็นที่นี่', fn: () => { if (!TD.sign.asset) return openSignModal(); placeImage(pos.i, pos.x, pos.y, TD.sign.asset, .25); } },
      { k: 'stamp', l: 'ประทับตรายาง TESR ที่นี่', fn: async () => { if (!TD.rubber.asset) await buildRubberAsset(); TD.stamp.mode = 'rubber'; placeImage(pos.i, pos.x, pos.y, TD.rubber.asset, .28, { opacity: .92 }); } },
      { k: 'date', l: 'ใส่วันที่วันนี้ที่นี่', fn: () => newTextAt(pos.i, pos.x, pos.y, new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })) }, null,
      { k: 'rot', l: `หมุนหน้า ${pos.i + 1}`, fn: () => rotatePage(pos.i, 90) }, { k: 'dupPage', l: 'ทำสำเนาหน้านี้', fn: () => pageOp('dup', pos.i) }, { k: 'blank', l: 'แทรกหน้าว่างถัดไป', fn: () => { curPage = pos.i; $('#blankPageBtn').click(); } },
      { k: 'delPage', l: `ลบหน้า ${pos.i + 1}`, dis: pages.length < 2, fn: () => pageOp('del', pos.i) }, null,
      { k: 'save', l: 'ดาวน์โหลด PDF', s: 'Ctrl+S', fn: () => runExport('pdf') }, { k: 'print', l: 'พิมพ์', s: 'Ctrl+P', fn: () => $('#printBtn').click() },
    ]);
  }
});

/* ---------- props panel tweaks (hints + close inline editor when the side textarea is used) ---------- */
const _renderProps = renderProps;
renderProps = function (focusText = false) {
  _renderProps(focusText);
  const t = $('#pTxt'); if (t) t.addEventListener('focus', finishInlineEdit);
  if (tool === 'select' && !sel && props.querySelector('.note')) props.querySelector('.note').innerHTML = '<b>ดับเบิลคลิก</b>ข้อความเพื่อแก้ตรงนั้นทันที · ดับเบิลคลิกที่ว่างเพื่อเพิ่มข้อความ · <b>คลิกขวา</b>เพื่อดูเมนู · ลากเพื่อย้าย · จุดมุมขวาล่างปรับขนาด · ลูกศรเลื่อนทีละนิด<br><br>คีย์ลัด: Ctrl+C/X/V คัดลอก-ตัด-วาง · Ctrl+D ทำสำเนา · Ctrl+S ดาวน์โหลด · Ctrl+P พิมพ์ · Ctrl+F ค้นหา · Ctrl+Z/Y เลิกทำ/ทำซ้ำ · Delete ลบ · Enter แก้ข้อความ · V/T/H/B/E/U/I/N/G/K/R สลับเครื่องมือ';
  if (tool === 'text' && !sel) { const n = props.querySelector('.note'); if (n) n.textContent = 'แตะบนหน้าเอกสารเพื่อวางกล่องข้อความ แล้วพิมพ์ได้ทันทีตรงนั้น (Esc หรือคลิกที่อื่นเพื่อจบ · Ctrl+Enter ก็ได้)'; }
};
/* on phones, don't pop the options drawer for the text tool (it would cover the keyboard) */
const _setTool = setTool;
setTool = function (t) { _setTool(t); if (t === 'text' && window.innerWidth <= 980) $('#ebody').classList.remove('showProps'); };

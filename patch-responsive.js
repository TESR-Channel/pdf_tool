/* TESR PDF Editor — patch-responsive.js (โหลดหลัง app.js)
   แก้: (1) จอเล็กเลื่อนซ้าย-ขวาไม่ได้เมื่อซูม  (2) fit-to-screen ทุกขนาดจอ + หมุนจอ
        (3) path ฟอนต์ไทย Loma.otf อยู่ root ของ repo
   หมายเหตุ: ฟังก์ชันด้านล่างทับ (override) เวอร์ชันใน app.js — จะรวมเข้า app.js ในรอบถัดไป */
'use strict';
buildStage = function () {
  stage.innerHTML = '<div class="inner"></div>'; const inner = stage.firstElementChild; pageEls = []; io.disconnect();
  pages.forEach((p, i) => {
    const { W, H } = dispSize(p); const d = el('div', { className: 'pg' }); d.dataset.i = i; d.style.width = W * zoom + 'px'; d.style.height = H * zoom + 'px';
    const c = el('canvas'); const ov = svgEl('svg', { class: 'ov', viewBox: `0 0 ${W} ${H}` }); d.append(c, ov, el('div', { className: 'lbl' }, `หน้า ${i + 1}`)); inner.appendChild(d); pageEls.push(d); io.observe(d); drawOverlay(i);
  });
};
zoomFit = function () { const maxW = Math.max(...pages.map(p => dispSize(p).W)); const avail = (stage.clientWidth || window.innerWidth) - 32; zoom = clamp(avail / maxW, .15, 3); $('#zoomLbl').textContent = Math.round(zoom * 100) + '%'; };
getThaiFont = async function (out) { if (out._thFont) return out._thFont; try { if (!window._lomaBytes) window._lomaBytes = new Uint8Array(await (await fetch('Loma.otf')).arrayBuffer()); out.registerFontkit(window.fontkit); out._thFont = await out.embedFont(window._lomaBytes, { subset: true }); return out._thFont; } catch (e) { console.warn('font', e); return null; } };
window.addEventListener('orientationchange', () => setTimeout(() => { if ($('#editor').classList.contains('on')) { zoomFit(); setZoom(zoom); } }, 300));

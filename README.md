# TESR PDF Tools

เครื่องมือ PDF ครบวงจรสำหรับทีม TESR Co., Ltd. — ทำงานบน browser 100% (ไม่มี server, ไฟล์ไม่ออกจากเครื่อง)
รองรับมือถือ / แท็บเล็ต / คอมพิวเตอร์ และติดตั้งเป็นแอปบนหน้าจอโฮมได้ (PWA manifest)

## เครื่องมือ (16)
สแกนเอกสาร · รวม PDF · จัดหน้า (ลาก/หมุน/ลบ) · แยก PDF · ลดขนาด PDF · PDF→JPG/PNG · ลดขนาดภาพ · JPG→PDF ·
ใส่เลขหน้า · ใส่ลายน้ำ (ข้อความ/โลโก้) · ใส่ข้อความ · ลายเซ็น (วาด/อัปโหลด) · เอาลายน้ำออก · หมุนหน้า · PDF→TXT · Metadata

## Deploy บน GitHub Pages (3 ขั้นตอน)
1. สร้าง repo ใหม่ (เช่น `tesr-pdf-tools`) แล้วอัปโหลดไฟล์ทั้งหมดในโฟลเดอร์นี้ไปที่ branch `main`
2. ไปที่ **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: main / (root)** → Save
3. รอ 1–2 นาที เปิดที่ `https://<org>.github.io/tesr-pdf-tools/`

Deep link ไปเครื่องมือได้ เช่น `?tool=merge`, `?tool=sign`

## เปลี่ยนโลโก้
โลโก้ปัจจุบันเป็น ไฟล์ `logo.png` (ใช้ใน header, hero, favicon, manifest และเป็นตัวเลือก "โลโก้ TESR" ในเครื่องมือใส่ลายน้ำ)

## Stack
- [pdf-lib](https://pdf-lib.js.org) — สร้าง/แก้ไข PDF
- [PDF.js](https://mozilla.github.io/pdf.js/) — เรนเดอร์หน้า / ดึงข้อความ
- [JSZip](https://stuk.github.io/jszip/) — ไฟล์ ZIP
- Google Fonts: Kanit (display) + Sarabun (body) — ข้อความไทยในลายน้ำ/เลขหน้าถูกเรนเดอร์ผ่าน canvas จึงรองรับทุกฟอนต์

## ข้อจำกัด
- ไม่มีการใส่รหัสผ่าน/เข้ารหัส PDF (pdf-lib ยังไม่รองรับ)
- "ลดขนาด PDF" แปลงหน้าเป็นภาพ ข้อความจะเลือก/ค้นหาไม่ได้
- "เอาลายน้ำออก" ลบได้เฉพาะแบบ Annotation หรือปิดทับบริเวณ ไม่สามารถแยกลายน้ำที่ฝังในเนื้อหาเวกเตอร์ได้
- ไฟล์ขนาดใหญ่มาก (>100 MB) อาจช้าบนมือถือ

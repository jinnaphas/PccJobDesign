# Live Design — PCC Job Role System (GitHub Pages)

> หน้าตา + โครงสร้างของระบบตอนขึ้น Live. เปิดผ่าน GitHub Pages, ทุกแอป fetch จาก `/data/*.json` (same-origin) — แก้ข้อมูลที่เดียว เห็นทุกแอป

## 1. ภาพรวม — "PCC People Architecture Portal"

ระบบเป็น **เว็บเดียว 4 โมดูล** ใช้ shell ร่วมกัน (header + nav + language toggle TH/EN + footer)

```
 ┌───────────────────────────────────────────────────────────────────┐
 │  ◆ PCC People Architecture        Library  Career  Evaluate  Admin │  ← top nav (sticky)
 │                                                       [TH/EN] [⌕]  │
 ├───────────────────────────────────────────────────────────────────┤
 │                                                                     │
 │                      « เนื้อหาแต่ละโมดูล »                          │
 │                                                                     │
 ├───────────────────────────────────────────────────────────────────┤
 │  PCC Group · Job Role Architecture · data v0.1 · updated 2026-06-15│  ← footer
 └───────────────────────────────────────────────────────────────────┘
```

URL (GitHub Pages):
```
/                → Hub (index.html)  ── การ์ด 4 โมดูล + สถานะข้อมูล
/library.html    → Job Role Library
/career.html     → Career Path Explorer
/evaluate.html   → Evaluation (hiring / gap / promotion)
/admin.html      → JD Authoring (ภายหลัง: แก้ data → gen docx)
```

ทุกหน้าโหลด `data/reference.json` (สี/ระดับ/family) + ไฟล์ข้อมูลของตัวเอง

---

## 2. Hub (index.html) — หน้าแรกที่เห็นก่อน

```
 ┌─────────────────────────────────────────────────────────────┐
 │   PCC People Architecture Portal                            │
 │   196 Job Roles · 9 Companies · F1–L6 · JE Framework        │
 │                                                             │
 │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌─────┐│
 │  │ 📚 Library   │ │ 🪜 Career    │ │ 🎯 Evaluate  │ │⚙️Adm││
 │  │ JD ทั้งหมด    │ │ เส้นทางเติบโต │ │ คน × ตำแหน่ง  │ │ JD  ││
 │  │ [196 roles]  │ │ [F1→L6]      │ │ 3 โหมด       │ │ gen ││
 │  └──────────────┘ └──────────────┘ └──────────────┘ └─────┘│
 │                                                             │
 │  Data health: ✅196 active · ⚠️ JE review 4 · 🔴 dup 1      │
 └─────────────────────────────────────────────────────────────┘
```

---

## 3. โมดูล 1 — Job Role Library  `library.html`

อ่าน `job_roles.json` + `reference.json`. = ศูนย์กลางที่อีก 2 โมดูลอ้างถึง

```
 ┌── Filters (ซ้าย) ──┐ ┌── Grid การ์ดตำแหน่ง (ขวา) ───────────────┐
 │ Company  ▢ GRP ▢PCC│ │ ⌕ ค้นหา...                  [196 results] │
 │ ▢PEM ▢PSP ▢PDE ... │ │ ┌─────────┐ ┌─────────┐ ┌─────────┐      │
 │ Level   ▢F1 ▢L1... │ │ │HR Officer│ │HR Super.│ │HCD Mgr  │      │
 │ Family  ▢ HR ▢ FIN │ │ │GRP·HR·L1│ │GRP·HR·L2│ │PCC·HR·L3│      │
 │ ▢ Eng ▢ Digital ...│ │ │JE 44 ●  │ │JE 69 ●  │ │JE 121 ● │      │
 │                    │ │ └─────────┘ └─────────┘ └─────────┘      │
 │ [Reset]            │ │ ... (การ์ดสีตามบริษัท/ระดับ)             │
 └────────────────────┘ └──────────────────────────────────────────┘
```

**คลิกการ์ด → Drill-down modal:**
```
 ┌──────────────────────────────────────────────┐
 │ HCD Manager  ·  PCC-HR-HCDM-L3  ·  JE 121     │
 │ ┌─ JE Donut ─┐  Purpose: วางแผน/ขับเคลื่อน... │
 │ │   ◔ 121    │  KRs:                          │
 │ │  /150+     │  ① L&D Strategy ........ 25%   │
 │ └────────────┘  ② Talent & Succession . 25%   │
 │ Specs: โท HRM · 8+ ปี · EN High · SHRM        │
 │ KPIs ต่อ KR (expand) · [ดู .docx] [Career →]  │
 │  ⚠️ data_quality flags (ถ้ามี) แสดงเป็นแถบเตือน│
 └──────────────────────────────────────────────┘
```
- การ์ด/สี: `LC` (สีตามระดับ) + `CC` (สีตามบริษัท จาก reference.json#/companies)
- ปุ่ม **[Career →]** กระโดดไป career.html โดยล็อก family เดียวกัน
- ถ้า record มี `data_quality[]` → แสดงแถบเตือน (เช่น "JE อยู่ระหว่างทบทวน")

---

## 4. โมดูล 2 — Career Path Explorer  `career.html`

อ่าน `job_roles.json` + `career_overlay.json`. แสดง "บันได" ของแต่ละ family โดย derive จาก level ของ role จริง

```
 เลือก Family: [Human Resources ▾]      AI Risk: 🟢 Low
 ┌──────────────────────────────────────────────────────────┐
 │  F1 ──▶ L1 ─────▶ L2 ─────▶ L3 ─────▶ L4 ─────▶ L5/L6    │
 │         HR        HR        HCD       Head of   CFO/CHRO  │
 │         Officer   Super.    Manager   Human Cap          │
 │         JE44      JE69      JE121     JE112             │
 │         └─ คลิกช่วงเปลี่ยน L1→L2 ────────────┐           │
 └───────────────────────────────────────────────┘           │
 ┌── Transition L1→L2 (จาก career_overlay) ─────────────────┐ │
 │ Timeline ~2-3 ปี · Readiness checklist · Skills have/dev │ │
 │ 70-20-10 learning · Certs แนะนำ · HiPo fast-track       │ │
 └──────────────────────────────────────────────────────────┘
```
- เส้นบันได = group roles ตาม family แล้วเรียง F1→L6 (อัตโนมัติจากข้อมูล)
- ข้อมูลช่วงเปลี่ยนระดับ + bridge ไป family อื่น มาจาก `career_overlay.json`

---

## 5. โมดูล 3 — Evaluation  `evaluate.html`

อ่าน `job_roles.json` + `people/*.json` + `scoring_model.json` + `competency_dict.json`. **engine เดียว 3 โหมด**

```
 โหมด:  ◉ Hiring   ○ Gap Closing   ○ Promotion
 เป้าหมาย JD: [PCC-HR-HCDM-L3 ▾]      คน: [เลือกผู้สมัคร/พนักงาน ▾]
 ┌── Fit summary ──┐ ┌── Radar 6 มิติ ──┐ ┌── KR Alignment ──┐
 │   78%  Proceed  │ │   (เทียบ JD)     │ │ L&D ▓▓▓▓░ 80%    │
 │   ●●●●○          │ │                  │ │ Talent ▓▓▓▓ 88% │
 └─────────────────┘ └──────────────────┘ └──────────────────┘
 ┌── Competency gap (JD target vs คน) ──────────────────────┐
 │ technical_expertise   ต้องการ 4 │ มี 3 │ gap -1  → พัฒนา │
 │ planning_mgmt         ต้องการ 4 │ มี 4 │ ✓             │
 └──────────────────────────────────────────────────────────┘
 Strengths · Gaps · Development plan / Interview focus
```
- **Hiring** = ผู้สมัคร × JD เป้าหมาย (= dashboard เดิม แต่ generalize)
- **Gap Closing** = พนักงาน × JD ปัจจุบัน → development plan
- **Promotion** = พนักงาน × JD ระดับถัดไป (ดึงจาก Career ladder) → readiness
- น้ำหนัก/threshold/label มาจาก `scoring_model.json` (ไม่ hardcode)

---

## 6. ระบบดีไซน์ (Design tokens)

| Token | ค่า | ที่มา |
|-------|-----|-------|
| สีบริษัท | GRP #1e40af · PCC #b45309 · PEM #065f46 · PSP #6d28d9 · PDE #0369a1 · PSL #9f1239 · PPP #0f766e · SBP #7c2d12 · PCE #4d7c0f | reference.json#/companies |
| สีระดับ | F1 #d97706 · L1 #3b82f6 · L2 #10b981 · L3 #f59e0b · L4 #ef4444 · L5 #8b5cf6 · L6 #ec4899 | คงจาก Library v2 |
| Font | TH Sarabun New / Segoe UI / Sarabun (web) | — |
| Nav | navy #1F3864 · accent #2E5F9E | คงจาก dashboard |
| i18n | `data-i18n` keys, toggle TH/EN | คงจาก dashboard |

**หลักการ:** การ์ด มุมโค้ง, เงาบาง, badge สี = บริษัท/ระดับ, modal drill-down, responsive (มือถือ = filter ยุบเป็น drawer), print-friendly (พิมพ์ JD/รายงานได้)

---

## 7. การเชื่อมข้อมูล (ใครอ่านไฟล์ไหน)

| แอป | ไฟล์ที่ fetch |
|-----|---------------|
| library.html | reference.json · job_roles.json |
| career.html | reference.json · job_roles.json · career_overlay.json |
| evaluate.html | reference.json · job_roles.json · people/*.json · scoring_model.json · competency_dict.json |
| admin.html | ทั้งหมด (เขียน job_roles.json ผ่าน Git/PR แล้ว build → docx) |

---

## 8. ขั้นตอนทำจริง (หลังยืนยันโครงสร้าง pilot)
1. Extract 196 → `job_roles.json` เต็ม + validation report
2. Refactor 3 HTML เดิม → fetch JSON (เลิก hardcode)
3. เปิด GitHub Pages (`main` หรือ `gh-pages`) → ได้ URL ใช้งานจริง
4. ทำ `career_overlay.json` + `people/` schema → ครบ 4 โมดูล
5. (ออปชัน) GitHub Action: แก้ data → validate → gen docx → deploy อัตโนมัติ

> ตัวอย่างหน้าตา hub เปิดดูได้จริงที่ `apps/index.html` (static preview)

# PCC Group Job Role System — Data Architecture

> **หลักการเดียว:** แยก *ข้อมูล* ออกจาก *หน้าจอ* — มีชุดข้อมูลกลาง 1 ชุด แล้วให้ทุกแอป fetch จากที่เดียว

เดิมข้อมูลถูก hardcode ซ้ำใน 3 ไฟล์ HTML (`ROLES`, `DATA`, ฯลฯ) ทำให้แก้ JD 1 ใบต้องไล่แก้หลายที่และ sync ไม่ได้จริง สถาปัตยกรรมนี้ทำให้ **Job Role Library เป็นศูนย์กลางข้อมูล (single source of truth)** ที่ Career Path และ Evaluation ดึงไปใช้ต่อ

---

## 1. การตัดสินใจที่ล็อกแล้ว (จาก Earth, 2026-06-15)

| เรื่อง | ผลสรุป |
|--------|--------|
| **Deployment** | GitHub Pages / cloud hosting → แอป fetch JSON กลางได้สดๆ (ไม่ติดข้อจำกัด `file://`) |
| **Master data** | ข้อมูลโครงสร้างเป็น master → **generate `.docx` อัตโนมัติ** (ไม่ parse docx กลับ) |
| **Employee data** | ยังไม่มี → ออกแบบ schema เก็บใหม่ (`schema/person.schema.json`) |

---

## 2. ผังข้อมูล (Data Flow)

```
            ┌──────────────────────────────────────────┐
 authoring  │            data/job_roles.json           │   ← SINGLE SOURCE OF TRUTH
 (master) ──►│            (196 JD records)              │
            └───────────────────┬──────────────────────┘
                                │
        build/gen-docx.js ◄─────┤  (data → .docx, ทางเดียว)
                │               │
                ▼               │ fetch (GitHub Pages, same-origin)
            jds/*.docx          │
        (เอกสารทางการ)   ┌───────┼───────────────┬───────────────────┐
                         ▼       ▼               ▼                   ▼
                   library.html  career_path.html            dashboard.html
                                 + career_overlay.json       + people/*.json
                                                             + scoring_model.json
                                                             + competency_dict.json
        ทุกแอปอ้าง taxonomy ร่วมจาก ──► data/reference.json
```

---

## 3. ไฟล์ข้อมูล (`data/`)

| ไฟล์ | บทบาท | สถานะ |
|------|-------|-------|
| `reference.json` | Taxonomy กลาง: บริษัท, ระดับ, family-code, JE framework | ✅ Phase 0 (draft) |
| `schema/*.schema.json` | JSON Schema ของแต่ละชุดข้อมูล (ใช้ validate) | ✅ Phase 0 |
| `scoring_model.json` | น้ำหนัก + เกณฑ์การให้คะแนน 3 โหมด | ✅ Phase 0 (seed) |
| `competency_dict.json` | พจนานุกรมสมรรถนะ (จาก JE 30 ข้อ) — แกนจับคู่ JD↔คน | ✅ Phase 0 (seed) |
| `job_roles.json` | 196 JD records — หัวใจของระบบ | ⏳ Phase 1 |
| `career_overlay.json` | bridges / readiness / skill-gap / ai-risk | ⏳ Phase 2 |
| `people/*.json` | ผู้สมัคร + พนักงาน (schema เดียวกัน) | ⏳ Phase 3 |

---

## 4. Evaluation Engine — engine ตัวเดียว 3 โหมด

จับคู่ `person.competencies` กับ `job_role.specs.competency_targets` บนแกน `competency_dict.json` แล้วให้คะแนนตาม `scoring_model.json`

| โหมด | person | เทียบกับ | ผลลัพธ์ |
|------|--------|----------|---------|
| `hiring` | ผู้สมัคร | JD เป้าหมาย | Proceed / Consider / Not Suitable |
| `gap_closing` | พนักงาน | JD **ปัจจุบัน** | On Target / Minor Gap / Major Gap + แผนพัฒนา |
| `promotion` | พนักงาน | JD **ระดับถัดไป** | Ready / Develop / Not Ready |

---

## 5. ลำดับงาน (Roadmap)

- [x] **Phase 0 — Foundation** *(ไฟล์ชุดนี้)*: reconcile taxonomy + schema + seed scoring/competency
- [ ] **Phase 1 — Library = Hub**: extract 196 docx+Excel → `job_roles.json` (+ validation report) → Library fetch JSON → pipeline `data→docx` → เปิด GitHub Pages
- [ ] **Phase 2 — Career Path**: fetch `job_roles.json` + เติม `career_overlay.json`
- [ ] **Phase 3 — Evaluation**: generalize Dashboard 3 โหมด + เก็บข้อมูลพนักงานตาม schema

---

## 6. ⚠️ เรื่องที่รอ HR ยืนยัน (ดู `reference.json#/open_decisions`)

| # | เรื่อง | สถานะ |
|---|--------|-------|
| D1 | Company list = 9 บริษัท (retire PCT/PCR/PEP) | ✅ adopted, รอ sign-off |
| D2 | **JE scale จริง** (criteria doc = max 150 แต่ของจริงถึง 200) | 🔴 รอ HR |
| D3 | ไฟล์ซ้ำ `PCC-DT-VPDT-L5` v1.0/v2.0 → ย้าย v1.0 ไป Inactive | 🟠 รอยืนยัน |
| D4 | Normalize family-code aliases (SALES/SAL, ENG/TEC, LRC/LEGAL …) | 🟠 proposal |
| D5 | ช่องว่างโครงสร้าง (PCC ไม่มี L4, L6 มี 1, ไม่มี AI L4) | ℹ️ backlog |

> หลัง Phase 0 ผ่าน ควร rewrite `CLAUDE.md` / `HANDOFF_TO_NEW_CLAUDE.md` / `memory/context/pcc-group.md` ให้ชี้มาที่ `reference.json` เป็นแหล่งจริง เพื่อเลิกความขัดแย้งของเอกสาร memory

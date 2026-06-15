# PccJobDesign

ระบบ **Job Role Architecture ของ PCC Group** — Job Description Library เป็นศูนย์กลางข้อมูล (single source of truth) ที่ป้อนต่อให้ Career Path Explorer และ Candidate/Employee Evaluation

## โครงสร้างเป้าหมาย

```
data/
  reference.json          ← taxonomy กลาง: บริษัท / ระดับ / family / JE framework
  job_roles.json          ← 196 JD records (Phase 1)
  career_overlay.json     ← ข้อมูล Career Path (Phase 2)
  scoring_model.json      ← น้ำหนัก + เกณฑ์การให้คะแนน
  competency_dict.json    ← พจนานุกรมสมรรถนะ (จาก JE 30 ข้อ)
  people/                 ← ผู้สมัคร + พนักงาน (Phase 3)
  schema/*.schema.json    ← JSON Schema สำหรับ validate ทุกชุดข้อมูล
apps/                     ← library.html · career_path.html · dashboard.html (fetch จาก data/)
jds/                      ← *.docx (generated output — ไม่ใช่ master)
build/                    ← gen-docx.js · validate.js
docs/DATA_ARCHITECTURE.md ← อ่านก่อน: ผังข้อมูล + roadmap + ประเด็นที่รอ HR ยืนยัน
```

## สถานะ

- ✅ **Phase 0 — Foundation**: reconcile taxonomy (`reference.json`), schema ทั้งหมด, seed `scoring_model.json` + `competency_dict.json`
- ⏳ Phase 1 (Library hub) → Phase 2 (Career Path) → Phase 3 (Evaluation)

ดูรายละเอียดทั้งหมดที่ [`docs/DATA_ARCHITECTURE.md`](docs/DATA_ARCHITECTURE.md)

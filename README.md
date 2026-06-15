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

## สถานะ (พร้อม Live)

- ✅ **Phase 0 — Foundation**: `reference.json`, schema ทั้งหมด, `scoring_model.json`, `competency_dict.json`, `je_level_baseline.json`
- ✅ **Phase 1 — Library hub**: `job_roles.json` ครบ **196 roles** (13 detailed + 183 skeleton) + `apps/library.html` ใช้งานได้
- ✅ **Phase 2 — Career Path**: `apps/career.html` (ladder F1→L6 + AI risk + transitions จาก `career_overlay.json`)
- ✅ **Phase 3 — Evaluation**: `apps/evaluate.html` (Hiring โหมด, ผู้สมัครจริง 16 คน × HCDM-L3)
- ✅ **Admin/Data Health**: `apps/admin.html`
- ⏳ ต่อไป: deep-extract KR/spec ของ 183 skeleton + **regenerate JE จริง** (รอ HR ยืนยัน item-30-by-level) · เก็บข้อมูลพนักงานสำหรับ Gap/Promotion

## เปิดใช้งาน (GitHub Pages)
Settings → Pages → Deploy from branch → เลือก branch + root (`/`). entry: `index.html` (redirect ไป `apps/index.html`). `.nojekyll` ใส่ไว้แล้วเพื่อให้ serve `/data/*.json` ได้

ดูรายละเอียดทั้งหมดที่ [`docs/DATA_ARCHITECTURE.md`](docs/DATA_ARCHITECTURE.md) · [`docs/LIVE_DESIGN.md`](docs/LIVE_DESIGN.md)

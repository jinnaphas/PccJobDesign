# Phase 1 — Pilot Extraction & Validation Report

**ขอบเขต:** ดึง JD จริง 7 ใบจาก Google Drive → `data/job_roles.json` เพื่อตรวจโครงสร้างก่อนทำครบ 196 ใบ
**วันที่:** 2026-06-15

## Pilot set (คละครบ F1→L5)

| Code | ตำแหน่ง | Level | JE (ตามไฟล์) | คุณภาพ |
|------|---------|-------|--------------|--------|
| GRP-OPM-OPR-F1 | Production Operator | F1 | 35 | ✅ สะอาด |
| GRP-HR-HRO-L1 | HR Officer | L1 | 44 | 🔴 JE ปนเปื้อน (Facility) |
| PCC-AI-AAIO-L1 | Agentic AI Operations Officer | L1 | 57 | 🔴 JE + KR#5 ปนเปื้อน |
| GRP-HR-HRS-L2 | HR Supervisor | L2 | 69 | 🟠 header เพี้ยน + เลขไม่ตรง |
| PCC-HR-HCDM-L3 | HCD Manager | L3 | 121 | ✅ JE สะอาด (แต่เกิน band) |
| GRP-HR-HCD-L4 | Head of Human Capital | L4 | 112 | 🔴 JE ปนเปื้อน (Business Manager) |
| GRP-FIN-CFO-L5 | Chief Financial Officer | L5 | 184 | 🔴 JE ปนเปื้อน (COO) |

## ✅ สิ่งที่พิสูจน์แล้ว (ข่าวดี)

1. **docx → structured ได้สะอาด** — Header / KR table (หน้าที่/ผลคาดหวัง/KPI/สัดส่วน%) / Spec / JE 30 ข้อ / Market Benchmark ดึงเข้า schema `job_role.schema.json` ได้ครบ
2. **สูตร JE ไขกระจ่าง (ปิด D2)** — ทุกใบเขียนหัวตารางว่า *"ข้อ 26 Max=6, ข้อ 27 Max=7, ข้อ 30 Max=150"* → ข้อ 30 (Stakeholders) ใช้สเกลขั้นบันได `1,25,35,45,55,70,80-150` จึงดันคะแนนรวมขึ้นถึง ~200 ได้ทั้งที่ข้ออื่นเป็น 0-5. บันทึกใน `reference.json#/je_framework/scoring` แล้ว
3. **KR / Spec ส่วนใหญ่ถูกต้องตามตำแหน่ง** — เนื้อหาความรับผิดชอบและคุณสมบัติเชื่อถือได้

## 🔴 สิ่งที่ต้องแจ้ง (เหตุผลที่ pilot-first คุ้มมาก)

### 1. JE-table ปนเปื้อนจากการ copy JD (วิกฤต — กระทบ Pay Grading)
JD จำนวนมากถูกสร้างโดย "copy ใบพี่น้องมาแก้" แต่ **ตาราง JE 30 ข้อ (และบางทีบรรทัดชื่อ/รหัสหัวเอกสาร) ไม่ได้ถูกแก้ตาม**:

| JD | JE table จริงๆ เป็นของ |
|----|------------------------|
| HR Officer L1 | Facility Management Officer |
| Agentic AI Ops L1 | Facility / Accounting (+ KR#5 บัญชีหลุดเข้ามา) |
| Head of Human Capital L4 | Business Manager (HV Electrical) |
| CFO L5 | COO |

→ ใน pilot **4 จาก 7 ใบ (~57%) JE ใช้ไม่ได้** เพราะคะแนน/เหตุผลเป็นของตำแหน่งอื่น **คะแนน JE จึงยังเชื่อถือไม่ได้สำหรับทำ Pay Grade** จนกว่าจะ re-evaluate (เก็บ flag ราย record ที่ `data_quality[]` แล้ว)

### 2. คะแนน JE ไม่อยู่ในช่วงของระดับ + เกิด inversion
- HCDM-**L3** = 121 (เกิน band L3 ที่ 88-102)
- Head of HC **L4** = 112 (ต่ำกว่า band L4 ที่ 118-128)
- → **L3 คะแนนสูงกว่า L4** เพราะ L3 ให้ข้อ 30 = 25 (สเกลบันได) แต่ L4 ให้ข้อ 30 = 4 (สเกลธรรมดา) — **การใช้ข้อ 30 ไม่เป็นมาตรฐานเดียวกัน** (เปิดประเด็น D7)

### 3. ความไม่ตรงภายในเอกสาร
- HR Supervisor L2: ตาราง JE รวม = 69 แต่หมายเหตุ Benchmark เขียน 71
- หัวเอกสาร HR Supervisor อ้างรหัสผิดเป็น HRBPSM-L2

### 4. เอกสารมีหลาย "เจน" รูปแบบ
F1 = layout เรียบง่าย (ไม่มี Position Show/Benchmark) · L1-L5 รุ่นใหม่มี Market Benchmark + ช่องอนุมัติ · header บางใบ 2 คอลัมน์ บางใบ 3 คอลัมน์ → parser เต็มต้องรองรับความหลากหลายนี้

## ข้อเสนอ ก่อนทำครบ 196
1. **ยืนยันโครงสร้าง `job_roles.json`** (ไฟล์นี้) ว่าโอเค → แล้วผมดึงครบ 196 พร้อม validation report เต็ม
2. ระหว่าง extract ผมจะ **ตรวจทุกตาราง JE เทียบกับชื่อตำแหน่ง** อัตโนมัติ (จับคำที่ผิดบริบท เช่น JD ของ HR แต่ JE พูดเรื่อง "อาคาร/ผู้รับเหมา") แล้ว flag ทุกใบที่ปนเปื้อน
3. รายการ JD ที่ JE ปนเปื้อน → ทำเป็น **worklist ให้ HR re-score** (หรือผม regenerate จากเกณฑ์ที่ถูกต้องเมื่อ HR ยืนยันสูตรข้อ 30 ต่อ level)

> สรุป: **โครงสร้างพร้อม เดินต่อได้** แต่ **อย่าเพิ่งเอา JE ขึ้น Live เป็น Pay Grade** จนกว่าจะเคลียร์ contamination — ส่วน KR/Spec/Career Path ใช้ได้เลย

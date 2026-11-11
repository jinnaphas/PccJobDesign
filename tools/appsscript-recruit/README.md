# PCC Recruitment Tracker — Google Apps Script

The recruitment team records requisitions and candidates from a browser with
their own Google account, and the KPI summary is computed from the same data.

```
ทีม Recruit (Google login @precise.co.th)
        ↓
   Apps Script Web App  ──  Control List  +  KPI Summary
        ↓                ↘
  Google Sheet (ข้อมูล)     Google Drive (เอกสารแนบ)
```

## Why Google login instead of tokens

A token typed into a web page *is* the write credential: anyone who gets it can
write, it cannot be revoked per person, and nothing records who made a change.
Google login gives the opposite on all three counts, costs nothing to run, and
the signed-in address is written to the History sheet on every change.

If some recruiters have no Workspace account, set `ACCESS_CODE` as a fallback —
but prefer the domain deployment.

## Data model

Requisitions and candidates are separate, because one requisition normally
carries several candidates. Funnel and conversion KPIs are impossible without
that split.

| Sheet | One row is | Key fields |
|---|---|---|
| `Requisitions` | an open position | ref, role_code, dept, headcount, opened_at, target_start, status, recruiter |
| `Candidates` | one applicant for one requisition | req_id, name, source, stage, stage_since, interview_at, offer_salary, reject_reason |
| `History` | one status change | at, entity, entity_id, from, to, **by**, note |

**Stages.** The requisition carries stage 1 (เปิดรับสมัคร → ปิด/พัก/ยกเลิก);
each candidate carries stages 2–5 (ส่งใบสมัครให้หน่วยงาน → รอสัมภาษณ์ →
หน่วยงานคอนเฟิม → แจ้งเริ่มงาน), plus ไม่ผ่าน and ปฏิเสธ Offer, which require a
reason before they can be set.

When onboarded candidates reach the requisition's headcount, the requisition
closes itself and the change is written to History.

## KPIs

All computed in the browser from the three sheets — no stored totals to drift.

| KPI | Source |
|---|---|
| Time to Fill (avg + median) | opened_at → the first onboard entry in History |
| Fill Rate | onboarded candidates ÷ total headcount |
| Offer Acceptance | onboard ÷ (onboard + ปฏิเสธ Offer) |
| Funnel + conversion per step | candidates that **ever reached** each stage, from History |
| SLA compliance per stage | days in current stage vs the stage's SLA (5/7/5/3) |
| Source effectiveness | candidates and hires grouped by source |
| Rejection reasons | share of each reason |
| Monthly trend | requisitions opened vs filled |

Filter by period, company and recruiter.

## Setup (once, ~20 minutes)

### 1. Sign in as `@precise.co.th`
Not a personal Gmail account — the "Anyone within <domain>" deployment option
only exists for Workspace accounts.

### 2. Create the pieces
- A Google **Sheet** (empty — the script creates the three tabs itself)
- A Drive **folder** for attachments
- <https://script.google.com> → New project → paste `Code.gs`; then **+ → HTML**,
  name it exactly `Index`, paste `Index.html`

### 3. Script properties
**Project Settings → Script properties:**

| Property | Required | Value |
|---|---|---|
| `SHEET_ID` | ✅ | the spreadsheet id from its URL |
| `DRIVE_FOLDER_ID` | ✅ | the folder id from its URL |
| `ALLOWED_DOMAIN` | recommended | `precise.co.th` |
| `ACCESS_CODE` | only for "Anyone" deployments | a shared code |

Then run `setupCheck` once from the editor: it authorises the script, creates
the three sheets with headers, and logs what is configured.

### 4. Deploy
**Deploy → New deployment → Web app** · Execute as **Me** · Who has access
**Anyone within precise.co.th**. Share the URL with the team.

## Limits worth knowing

- **8 MB per attachment** (the file is sent base64-encoded through
  `google.script.run`). Larger files go straight into the Drive folder by hand.
- Any file type is accepted, `.docx` and `.xlsx` included — the earlier artifact
  build could not do this.
- The page loads all rows and filters in the browser: comfortable into the
  thousands of requisitions, not designed for tens of thousands.
- Role data is read live from the published site (`job_roles.json`,
  `reference.json`) and cached for 6 hours, so renaming a company or adding a
  role flows through without touching this script.

# PCC Recruitment Tracker — Google Apps Script

The recruitment team records requisitions and candidates from a browser, signing
in with a personal access token. The KPI summary is computed from the same data.

```
ทีม Recruit (token รายคน)
        ↓
   Apps Script Web App  ──  Control List  +  KPI Summary
        ↓                ↘
  Google Sheet (ข้อมูล)     Google Drive (เอกสารแนบ)
```

## How sign-in works

Each person gets their own token. The token is **verified on the server**, never
compared in the browser — a check written in page JavaScript is not a lock,
because anyone can read the page source and call the backend directly.

- Tokens are stored as **SHA-256 hashes** in the `Users` sheet. Reading that
  sheet does not give anyone a working token.
- Every call carries the token; the server resolves it to a person and writes
  that name into the `History` sheet, so each change has an author.
- Revoking one person does not disturb the other: set `active` to `FALSE`, or
  run `revokeUser('ชื่อ')`.
- A token is ~122 bits of randomness, so guessing is not a practical attack; a
  light throttle sits in front of repeated failures anyway.

**What a token cannot do:** stop someone who was given a token from passing it
on. With a small team that is a people problem rather than a technical one — but
it is the reason tokens are per person, so a leak is traceable and revocable
without changing anything for anyone else.

To switch to Google Workspace login later, set `AUTH_MODE` to `google` and
`ALLOWED_DOMAIN` to your domain. Nothing else changes.

## Data model

Requisitions and candidates are separate, because one requisition normally
carries several candidates. Funnel and conversion KPIs are impossible without
that split.

| Sheet | One row is | Key fields |
|---|---|---|
| `Requisitions` | an open position | ref, role_code, dept, headcount, opened_at, target_start, status, recruiter |
| `Candidates` | one applicant for one requisition | req_id, name, source, stage, stage_since, interview_at, offer_salary, reject_reason |
| `History` | one status change | at, entity, entity_id, from, to, **by**, note |
| `Users` | one person who may sign in | token_hash, name, email, role, active, last_seen |

**Stages.** The requisition carries stage 1 (เปิดรับสมัคร → ปิด/พัก/ยกเลิก);
each candidate carries stages 2–5 (ส่งใบสมัครให้หน่วยงาน → รอสัมภาษณ์ →
หน่วยงานคอนเฟิม → แจ้งเริ่มงาน), plus ไม่ผ่าน and ปฏิเสธ Offer, which require a
reason before they can be set.

When onboarded candidates reach the requisition's headcount, the requisition
closes itself and the change is written to History.

## KPIs

All computed in the browser from the sheets — no stored totals to drift.

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

### 1. Create the pieces
- A Google **Sheet** (empty — the script creates all four tabs itself)
- A Drive **folder** for attachments
- <https://script.google.com> → New project → paste `Code.gs`; then **+ → HTML**,
  name it exactly `Index`, paste `Index.html`

### 2. Script properties
**Project Settings → Script properties:**

| Property | Required | Value |
|---|---|---|
| `SHEET_ID` | ✅ | the spreadsheet id from its URL |
| `DRIVE_FOLDER_ID` | ✅ | the folder id from its URL |
| `TOKEN_SALT` | ✅ | any long random string — **set it before creating users** |
| `AUTH_MODE` | optional | `token` (default) or `google` |
| `ALLOWED_DOMAIN` | only with `google` | `precise.co.th` |

`TOKEN_SALT` must be set first: changing it later invalidates every token
already issued.

### 3. Create the two accounts
Run `setupCheck` once from the editor (this also authorises the script and
creates the sheets), then run, once per person:

```javascript
createUser('ชื่อน้อง A', 'a@precise.co.th')
createUser('ชื่อน้อง B', 'b@precise.co.th')
```

Each run prints that person's token in the **Execution log**. It is shown once
and cannot be read back — copy it and hand it over privately (not in a group
chat). To reissue, run `createUser` again for that person and `revokeUser` on
the old entry.

`listUsers()` shows who can sign in and when they last did, without exposing any
token.

### 4. Deploy
**Deploy → New deployment → Web app** · Execute as **Me** · Who has access
**Anyone** (the token is the gate, so the team does not need Workspace
accounts). With `AUTH_MODE = google` instead, choose **Anyone within
precise.co.th**.

Send each person the URL and their own token.

## Limits worth knowing

- **8 MB per attachment** (the file is sent base64-encoded through
  `google.script.run`). Larger files go straight into the Drive folder by hand.
- Any file type is accepted, `.docx` and `.xlsx` included.
- The page loads all rows and filters in the browser: comfortable into the
  thousands of requisitions, not designed for tens of thousands.
- Role data is read live from the published site (`job_roles.json`,
  `reference.json`) and cached for 6 hours, so renaming a company or adding a
  role flows through without touching this script.

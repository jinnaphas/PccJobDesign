# PCC Recruitment Tracker — Google Apps Script

The recruitment team works in the portal page **`apps/recruit.html`**, signing in
with a username and password. This Apps Script project is the API behind it.

```
ทีม Recruit → apps/recruit.html (GitHub Pages)
                     ↓  POST JSON
             Apps Script Web App (API)
                     ↓            ↘
          Google Sheet (ข้อมูล)   Google Drive (เอกสารแนบ)
```

Opening the web app URL directly shows a short status page, not the UI.

## How sign-in works

Username and password, checked **on the server**. A check written in page
JavaScript is not a lock — anyone can read the page source and call the backend
directly — so none of it happens in the browser.

1. The page posts the username and password once.
2. The server verifies them and returns a **session id** it generated.
3. Every later call carries that session id; the password is never sent again
   and never stored in the browser.

- Passwords are stored **salted, peppered and iterated 1,200 times** in the
  `Users` sheet. Reading that sheet does not give anyone a usable password.
- The server resolves each session to a person and writes that name into the
  `History` sheet, so every change has an author.
- Sessions expire after **6 hours**; the page then returns to the login screen.
- Revoke one person with `revokeUser('username')` without disturbing the other.
- Repeated failures are throttled.

Google Workspace login is **not** implemented: the script always checks a
username and password. Switching to Google login would mean a domain-restricted
deployment, which the browser cannot call from `github.io` — so it would also
mean moving the UI off GitHub Pages and back into Apps Script.

## Data model

Requisitions and candidates are separate, because one requisition normally
carries several candidates. Funnel and conversion KPIs are impossible without
that split.

| Sheet | One row is | Key fields |
|---|---|---|
| `Requisitions` | an open position | ref, role_code, dept, headcount, opened_at, target_start, status, recruiter |
| `Candidates` | one applicant for one requisition | req_id, name, source, stage, stage_since, interview_at, offer_salary, reject_reason |
| `History` | one status change | at, entity, entity_id, from, to, **by**, note |
| `Users` | one person who may sign in | username, pass_hash, salt, name, email, role, active, last_seen |

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
- <https://script.google.com> → New project → replace everything in `Code.gs`
  with this folder's `Code.gs`, then **save** (the editor does not autosave)

There is no HTML file in this project. The UI is `apps/recruit.html`, served by
GitHub Pages; this project is only the API.

### 2. Script properties
**Project Settings → Script properties:**

| Property | Required | Value |
|---|---|---|
| `SHEET_ID` | ✅ | the spreadsheet id **only** — the part between `/d/` and `/edit`, not the whole URL |
| `DRIVE_FOLDER_ID` | ✅ | the folder id only — the part after `/folders/` |
| `TOKEN_SALT` | ✅ | any long random string (the password pepper) — **set it before creating users** |

These three are the only properties the script reads.

`TOKEN_SALT` must be set first: changing it later invalidates every password
already stored, and everyone has to be recreated.

### 3. Create the two accounts
Run `setupCheck` once from the editor (this also authorises the script and
creates the four tabs). It returns a small report — check `sheets:
"created/verified"` and that no `error` or `warning_*` field is present before
going on. Then once per person:

```javascript
createUser('recruit.a', 'รหัสผ่านอย่างน้อย8ตัว', 'ชื่อน้อง A', 'a@precise.co.th')
createUser('recruit.b', 'รหัสผ่านอย่างน้อย8ตัว', 'ชื่อน้อง B', 'b@precise.co.th')
```

Hand each person their username and password privately, and have them change it
later with `setPassword('recruit.a','รหัสใหม่')` run by an admin.
`listUsers()` shows who can sign in and when they last did.

### 4. Deploy, then point the portal at it
**Deploy → New deployment → Web app** · Execute as **Me** · Who has access
**Anyone**. "Anyone" is required: the browser calls this URL from
`jinnaphas.github.io`, and a Google-login deployment would redirect that call to
a sign-in page the browser cannot follow. The username and password are the gate.

Copy the deployment URL into **`data/recruit_config.json`**:

```json
{ "api_url": "https://script.google.com/macros/s/XXXXXXXX/exec" }
```

**Take that URL from the deployment, not from the browser's address bar.** The
editor address looks like `script.google.com/home/projects/<id>`; adding `/exec`
to it does not make an endpoint, it just points back at a web page, and every
call fails. The real one contains `/macros/s/` and is shown under **Deploy →
Manage deployments → Web app → URL**. The portal page checks the shape on load
and names the problem rather than failing on the first login.

Commit that and the page is live. Until it is filled in, the page shows a setup
notice instead of a login form that could not work.

> **Every time you change `Code.gs`, deploy a new version.** A deployment serves
> a frozen snapshot of the code as it was when that version was cut, so edits in
> the editor change nothing for the live URL until you do **Manage deployments →
> ✏ Edit → Version: New version → Deploy**. That keeps the same URL. A brand-new
> deployment gets a new URL and the config needs updating.

## If something does not work

Open the `/exec` URL in a browser tab. What comes back names the problem:

| What you see | What it means |
|---|---|
| **"PCC Recruitment API"** status page | Working. If the page still fails, look elsewhere. |
| **"Script function not found: doGet"** | The deployed version does not contain this `Code.gs`. Either it was never pasted and saved, or the deployment was cut before pasting it — deploy a new version as above. |
| A Google **sign-in page** | The deployment is not set to "Anyone". Edit it and change Who has access. |
| **"Authorization required"** | Run `setupCheck` once from the editor and accept the permission prompt. |
| A script **error page** naming a function | A real error in the code; the message gives the line. |

## Limits worth knowing

- **5 MB per attachment** (the file is sent base64-encoded in the request body).
  Larger files go straight into the Drive folder by hand.
- Any file type is accepted, `.docx` and `.xlsx` included.
- The page loads all rows and filters in the browser: comfortable into the
  thousands of requisitions, not designed for tens of thousands.
- Role data is read live from the published site (`job_roles.json`,
  `reference.json`) and cached for 6 hours, so renaming a company or adding a
  role flows through without touching this script.

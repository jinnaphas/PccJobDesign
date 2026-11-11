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

## Setup (once, about 5 minutes)

### 1. Paste the code
<https://script.google.com> → New project → replace everything in `Code.gs` with
this folder's `Code.gs`, then **save** (the editor does not autosave).

There is no HTML file in this project. The UI is `apps/recruit.html`, served by
GitHub Pages; this project is only the API.

### 2. Run `setup()`
Pick `setup` in the Run dropdown and run it. Accept the permission prompt the
first time. That one call does everything else:

- creates the spreadsheet and the attachments folder in **this** Google account
- generates `TOKEN_SALT`, the password pepper, so no secret is ever typed or
  pasted anywhere
- builds the four tabs
- creates `recruit.a` and `recruit.b` with **random passwords, printed once** in
  the execution log

Copy the two passwords out of the log and hand each person theirs privately.

### Where the credentials live

| | Where |
|---|---|
| **Usernames** | the `Users` tab of the spreadsheet, or run `listUsers()` |
| **Passwords** | nowhere in readable form. The sheet holds only a hash, salted per person, peppered and iterated 1,200 times. |
| **The passwords as first issued** | printed once in the log of the `setup()` run. Still readable afterwards under **⏱ Executions** in the left sidebar — open that run and read `PASSWORDS_SHOWN_ONCE`. That history is not kept forever. |

### Managing who can sign in

The Run button calls a function with **no arguments**, so typing
`createUser('a','b','c','d')` or `setPassword('recruit.a','...')` into the
editor and pressing Run does nothing at all. Use these instead — each takes its
values from lines inside itself, so each runs from the Run dropdown:

| Run this | What it does |
|---|---|
| `addUser` | Adds a person. Fill in `USERNAME` and `NAME`; leave `PASSWORD` empty for a random one, printed once. Refuses a username that already exists rather than overwriting it. |
| `changePassword` | Sets a password you chose for an existing person. |
| `resetBothPasswords` | Takes no values at all: issues a fresh random password for `recruit.a` and `recruit.b` and prints both once. For when the original log is gone. |
| `listUsers` | Who can sign in, and when each last did. |

After running `addUser` or `changePassword`, blank the password line again and
save, so no secret sits in the project source.

None of them needs a re-deploy: they run in the editor and write straight to
the sheet.

**Everyone who signs in has the same access.** The `role` column is a label and
gates nothing — nothing in the backend or the page reads it. Anyone you add can
open, edit and delete requisitions and candidates and attach or remove
documents.

To stop someone, set their `active` cell to `FALSE` in the `Users` tab. That
takes effect at their next sign-in; a session already issued lasts up to six
hours. (`revokeUser('username')` does the same but needs an argument, so it has
the Run-button problem described above.)

There is no password-change screen in the portal — the API exposes only `login`
and `logout` without a session, so a password can only be changed by someone
who can open this Apps Script project.

`listUsers()` shows who can sign in and when they last did.
`revokeUser('username')` needs an argument, so it needs the same treatment as
`setPassword`; `active` can also be set to `FALSE` by hand in the `Users` tab.

Running `setup()` again is safe: it never overwrites a property, re-creates a
user or resets a password, and reports the current state instead.

To use a spreadsheet and folder that already exist, pass their ids:
`setup('<spreadsheet id>', '<folder id>')`.

> The script reads exactly three script properties — `SHEET_ID`,
> `DRIVE_FOLDER_ID` and `TOKEN_SALT` — and `setup()` fills all three. There is
> nothing to enter under Project Settings by hand. Never change `TOKEN_SALT`
> afterwards: every stored password becomes unusable and both accounts have to
> be created again.

### 3. Deploy, then point the portal at it
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

### 4. Optional: mirror the attachment log to the repository

Every attach and remove is written to the **`Attachments`** tab regardless. To
also commit each event to `data/recruit_audit/attachments.jsonl`, set two more
script properties:

| Property | Value |
|---|---|
| `GITHUB_REPO` | `jinnaphas/PccJobDesign` |
| `GITHUB_TOKEN` | a **fine-grained** personal access token |

Make the token at **GitHub → Settings → Developer settings → Personal access
tokens → Fine-grained tokens**, with:

- **Repository access**: only `jinnaphas/PccJobDesign`
- **Permissions → Contents**: *Read and write* (nothing else)
- a short expiry, renewed when it lapses

The token lives only in Script properties, on the server. It never reaches the
browser and must never be committed — the repository is public, and a token
with write access to it would let anyone push.

**The log contains no personal data on purpose.** Documents stay in Drive; the
log records an opaque id, the extension, the size and a SHA-256 of the file.
`data/recruit_audit/README.md` explains the format and why a hash is enough to
prove which file a row refers to.

If a push fails — token expired, GitHub unreachable — the upload still
succeeds and the row stays in the tab with an empty `pushed` column. The next
upload retries it, or run `pushAuditNow()` from the editor.

## Importing an existing recruitment sheet

`importFromDrive()` loads requisitions from a CSV named **`recruit_import.csv`**
placed in the attachments folder. Its header must be the `Requisitions` columns,
in order.

1. Upload the CSV to the Drive folder named in `DRIVE_FOLDER_ID`
2. Run `importFromDrive` from the Run dropdown
3. Read the log: `added`, `updated`, `skipped_without_req_id`
4. **Delete the CSV from the folder**

It upserts on `req_id`, so running it twice updates rather than duplicates, and
only genuinely new rows get a `History` entry. That makes a correct-and-re-run
loop safe: fix the CSV, upload it again, run it again.

The CSV goes to Drive and never into this repository. A real recruitment sheet
carries employee names in its notes — "ได้คนแล้ว น.ส. ..." — and the repository is
public.

### Statuses

`pending_ec` ("รออนุมัติ EC") exists because a headcount awaiting approval is
not a paused search. It is excluded from the Fill Rate denominator along with
`cancelled`: neither has anything to fill, so counting them would report a
worse fill rate than reality. It is also not counted as open, so it never
enters Time to Fill or the SLA figures.

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

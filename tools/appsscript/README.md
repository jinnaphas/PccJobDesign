# PCC Resume Screening — Google Apps Script backend

Lets HR screen resumes from a browser with only their **Google login**. No Claude
account or seat is required: the Anthropic API key lives in Script Properties and
the call is made server-side by Apps Script.

```
HR (Google login) → Apps Script web app → Anthropic API → results in the browser
```

## Why this exists

The GitHub Pages site is static and cannot hold an API key. The Claude artifact
version only serves its AI capability to members of the owner's Claude
organization, so invited HR accounts could not use it. This backend removes both
constraints.

## Setup (once, ~15 minutes)

### 1. Sign in with the right account
Create the project while signed in as **`@precise.co.th`**, not a personal Gmail
account. The "Anyone within precise.co.th" deployment option only exists for
Google Workspace accounts.

### 2. Create the project
Go to <https://script.google.com> → **New project**, then:
- Rename the default `Code.gs` file and paste the contents of `Code.gs`
- **+ → HTML** → name it exactly `Index` → paste the contents of `Index.html`

### 3. Add the API key and settings
**Project Settings → Script properties → Add script property:**

| Property | Required | Value |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | key from <https://console.anthropic.com> |
| `ALLOWED_DOMAIN` | recommended | `precise.co.th` — server-side check on top of the deployment setting |
| `MODEL` | optional | default `claude-opus-5` |
| `EFFORT` | optional | `low` (default), `medium`, or `high` |
| `ACCESS_CODE` | only for "Anyone" deployments | a shared code HR must type |
| `LOG_SHEET_ID` | optional | Spreadsheet id; appends one audit row per analysis |

### 4. Deploy
**Deploy → New deployment → Web app**
- Execute as: **Me**
- Who has access: **Anyone within precise.co.th**

Copy the web app URL and share it with HR.

> No Workspace account? Deploy with **Who has access: Anyone**, and set
> `ACCESS_CODE` so the endpoint is not open to the world. Anyone with the URL and
> the code can then spend your API budget — prefer the Workspace route.

### 5. Test
Open the URL, pick a role, paste one resume, press **เริ่มวิเคราะห์**.
The first run asks you to authorise the script's permissions.

## Running costs

Billed per token by Anthropic, separate from a Claude.ai subscription. One resume
sends roughly the JD plus up to 12,000 characters of resume and returns a small
JSON object, so cost per resume is small but not zero — check real usage on the
Anthropic console after the first batch.

To trade cost for depth, change `MODEL` (`claude-sonnet-5` and `claude-haiku-4-5`
are cheaper than the `claude-opus-5` default) or `EFFORT`. Nothing else changes.

## Design notes

- **Structured outputs.** The request sets `output_config.format` with a JSON
  schema, so the model's reply is always valid JSON in the expected shape. There
  is no parsing fallback because there is nothing to fall back from.
- **Deterministic total.** The model scores the six dimensions; the page computes
  the weighted total from the same weights as `data/scoring_model.json`
  (skills 25 · experience 25 · education 15 · digital 15 · english 10 ·
  certifications 10). The total is reproducible and auditable.
- **Bias guard.** The prompt forbids using age, gender, religion, marital status,
  nationality or photos, and requires evidence quoted from the resume.
- **`EFFORT` defaults to `low`** because `UrlFetchApp` caps a request at about 60
  seconds. Raise it only if analyses still complete in time.
- **Nothing is stored** unless `LOG_SHEET_ID` is set, and that log holds scores
  and token counts — not resume text.

## Getting results onto the site

Export **⤓ CSV** and hand it to whoever maintains the repository; it is converted
into `data/people/candidates_<ROLE>.json` so the role appears on the evaluation
page. `tools/sync_screening.py` does the equivalent job for the Claude artifact's
database.

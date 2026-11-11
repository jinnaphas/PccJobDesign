# Recruitment attachment audit

`attachments.jsonl` is the append-only record of candidate and requisition
documents being attached or removed in the Recruitment Control List. One JSON
object per line, oldest first, written by the Apps Script backend
(`tools/appsscript-recruit`).

## This repository is public, so the log carries no personal data

The documents themselves — resumes, copies of ID cards, transcripts — stay in
Google Drive, reachable only by the people the folder is shared with. They are
never committed here, and neither is anything that identifies a candidate.

| Field | Example | Why it is safe to publish |
|---|---|---|
| `at` | `2026-11-11T13:04:22` | a timestamp |
| `action` | `attach` / `remove` | |
| `entity` | `cand` / `req` | which kind of record it hangs off |
| `entity_id` | `cand_9f2c1ab4e0` | an opaque id, meaningless without the sheet |
| `req_ref` | `REQ-2026-004` | the requisition's running number |
| `ext` | `.pdf` | the extension only — **never the filename**, which usually contains the candidate's name |
| `bytes` | `248139` | size |
| `sha256` | `a3f1…` | SHA-256 of the file's contents |
| `by` | `น้อง A` | the recruiter who did it |

## What the hash is for

A hash proves which file a row refers to without revealing any of it. Take the
file from Drive, hash it, and compare: if it matches, that is the file attached
on that date, unchanged since. That is what makes this a usable audit trail
rather than a list of claims — and it works years later, from a public file,
without a single candidate's name being exposed.

An `attach` row and the matching `remove` row carry the same `sha256`, so a
document's whole life is traceable.

## If a row is missing

The `Attachments` tab in the spreadsheet is the source of truth; this file is a
mirror. A row whose `pushed` column is empty has not reached the repository yet
— a push failure never blocks an upload. Run `pushAuditNow()` from the Apps
Script editor to send whatever is pending.

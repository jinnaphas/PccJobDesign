#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Sync Resume Screening Console results into data/people/.

Input: JSON documents dumped from the artifact DB collection "screenings"
(Artifact tool -> action read_db, db_op list, collection screenings, out_dir <dir>).

For each screening session it upserts a batch into
data/people/candidates_<ROLE_CODE>.json (person.schema.json shape) and
rebuilds data/people/index.json.

Idempotent: re-running with the same batch replaces that batch in place.
Prints CHANGED or NO_CHANGE on the last line so a scheduled job can decide
whether there is anything to commit.

usage: python3 tools/sync_screening.py --dump <dir>
"""
import argparse, glob, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PEOPLE = os.path.join(ROOT, "data", "people")
EDU_LEVELS = ["Vocational", "Bachelor", "Master", "PhD", "Other"]
ENGLISH = ["Low", "Medium", "High"]


def load(p, default=None):
    if not os.path.exists(p):
        return default
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def dump(p, obj, indent=1):
    with open(p, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=indent)


def slug(code):
    return re.sub(r"[^a-z0-9]+", "", code.lower())


def person_from(result, code, batch_id, date, seq, taken):
    edu = result.get("education") or {}
    lvl = edu.get("level") or "Other"
    if lvl not in EDU_LEVELS:
        lvl = "Other"
    ex = result.get("experience") or {}
    pid = "cand-%s-%02d" % (slug(code)[-8:], seq)
    while pid in taken:
        pid += "x"
    taken.add(pid)
    p = {
        "id": pid,
        "name": result.get("name") or "(ไม่ระบุชื่อ)",
        "type": "candidate",
        "source_file": result.get("src", ""),
        "current_title": result.get("current_title", ""),
        "current_company": result.get("current_company", ""),
        "target_role_codes": [code],
        "education": {"level": lvl, "field": edu.get("field", "")},
        "experience": {
            "total_years": ex.get("total_years", 0),
            "relevant_years": ex.get("relevant_years", 0),
        },
        "evaluation": {
            "target_role_code": code,
            "mode": "hiring",
            "analyzed_at": result.get("analyzed_at") or date,
            "batch_id": batch_id,
            "scores": dict(result.get("scores") or {}),
            "kr_alignment": {str(k): v for k, v in (result.get("kr_alignment") or {}).items()},
            "overall_pct": result.get("overall_pct", 0),
            "recommendation": result.get("recommendation", "—"),
            "key_strengths": result.get("key_strengths") or [],
            "key_gaps": result.get("key_gaps") or [],
            "evidence": result.get("evidence") or [],
            "risk_flags": result.get("risk_flags") or [],
        },
    }
    eng = (result.get("languages") or {}).get("english")
    if eng in ENGLISH:
        p["languages"] = {"english": eng}
    return p


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dump", required=True, help="directory holding screenings/*.json")
    args = ap.parse_args()

    roles = {r["code"]: r for r in load(os.path.join(ROOT, "data", "job_roles.json"))["roles"]}
    files = sorted(glob.glob(os.path.join(args.dump, "**", "*.json"), recursive=True))
    if not files:
        print("no screening documents found under", args.dump)
        print("NO_CHANGE")
        return 0

    before = {p: load(p) for p in glob.glob(os.path.join(PEOPLE, "*.json"))}
    touched = []

    for f in files:
        doc = load(f) or {}
        d = doc.get("data", doc)
        code = d.get("role_code")
        if not code or code not in roles:
            print("skip (role not in job_roles.json):", code, "-", os.path.basename(f))
            continue
        role = roles[code]
        krs = role.get("krs", [])
        kr_keys = {str(i): k.get("name_th", "KR%d" % (i + 1)) for i, k in enumerate(krs)}

        out = os.path.join(PEOPLE, "candidates_%s.json" % code)
        cur = load(out) or {
            "_meta": {
                "title": "Candidates — %s (%s)" % (role.get("title_en", code), code),
                "schema": "../schema/person.schema.json",
                "source": "Resume Screening Console (AI)",
                "target_role_code": code,
                "kr_keys": kr_keys,
                "batches": [],
            },
            "people": [],
        }
        cur["_meta"].setdefault("batches", [])
        cur["_meta"]["kr_keys"] = kr_keys

        date = d.get("analyzed_at") or (d.get("created", "")[:10])
        bid = d.get("batch_id") or ("b-" + (date or "").replace("-", ""))
        results = d.get("results") or []

        cur["people"] = [
            p for p in cur["people"] if (p.get("evaluation") or {}).get("batch_id") != bid
        ]
        taken = {p["id"] for p in cur["people"]}

        n = 0
        for i, r in enumerate(results, 1):
            if r.get("error"):
                continue
            cur["people"].append(person_from(r, code, bid, date, i, taken))
            n += 1

        cur["_meta"]["batches"] = [b for b in cur["_meta"]["batches"] if b.get("id") != bid]
        cur["_meta"]["batches"].append(
            {
                "id": bid,
                "label": d.get("batch_label") or ("คัดกรอง %s · %s" % (role.get("title_en", code), date)),
                "date": date,
                "count": n,
                "source": "Resume Screening Console (AI)",
                "method": "ai",
            }
        )
        cur["_meta"]["batches"].sort(key=lambda b: b.get("date", ""), reverse=True)
        dump(out, cur)
        touched.append((out, n, bid, date))
        print("upserted %s — %d candidate(s), batch %s (%s)" % (os.path.basename(out), n, bid, date))

    # rebuild the dataset index the evaluation page reads
    idx = []
    for p in sorted(glob.glob(os.path.join(PEOPLE, "candidates_*.json"))):
        pf = load(p)
        m = pf["_meta"]
        code = m.get("target_role_code")
        r = roles.get(code, {})
        bs = m.get("batches", [])
        idx.append(
            {
                "code": code,
                "file": os.path.basename(p),
                "title_en": r.get("title_en", code),
                "title_th": r.get("title_th", ""),
                "level": r.get("level", ""),
                "count": len(pf.get("people", [])),
                "batches": len(bs),
                "latest": max([b.get("date", "") for b in bs], default=""),
            }
        )
    dump(
        os.path.join(PEOPLE, "index.json"),
        {
            "_meta": {
                "title": "Index of candidate datasets",
                "note": "GitHub Pages cannot list a directory — evaluate.html reads this to populate the role picker.",
            },
            "datasets": idx,
        },
    )

    after = {p: load(p) for p in glob.glob(os.path.join(PEOPLE, "*.json"))}
    changed = before != after
    print("CHANGED" if changed else "NO_CHANGE")
    return 0


if __name__ == "__main__":
    sys.exit(main())

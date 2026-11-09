#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Export a job role from data/job_roles.json as a Word (.docx) JD.

Renders the house JD layout used across the PCC People Architecture:
identity block, job purpose, key responsibilities, job specifications,
the 30-item JE table, market benchmark and a signature block.

usage:
    python3 tools/make_jd_docx.py GRP-STR-CSO-L5
    python3 tools/make_jd_docx.py GRP-STR-CSO-L5 PCC-MGT-PGCO-L6 --out /tmp/jds
    python3 tools/make_jd_docx.py --level L5          # every active role at a level
"""
import argparse, json, os, re, sys

try:
    from docx import Document
    from docx.shared import Pt, RGBColor, Inches
    from docx.enum.table import WD_TABLE_ALIGNMENT
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement
except ImportError:
    sys.exit("python-docx is required:  python3 -m pip install python-docx")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAVY, LIGHT, GREY = "1F3A5F", "EEF2F5", "666666"
FONT = "Tahoma"


def load(p):
    with open(os.path.join(ROOT, p), encoding="utf-8") as f:
        return json.load(f)


def shade(cell, hexcolor):
    el = OxmlElement("w:shd")
    el.set(qn("w:val"), "clear")
    el.set(qn("w:fill"), hexcolor)
    cell._tc.get_or_add_tcPr().append(el)


def style_run(run, size=10, bold=False, color=None, italic=False):
    run.font.name = FONT
    run.font.size = Pt(size)
    run.bold = bold
    run.italic = italic
    run.font.element.rPr.rFonts.set(qn("w:cs"), FONT)   # Thai (complex script) face
    if color:
        run.font.color.rgb = RGBColor.from_string(color)


def put(cell, text, size=9, bold=False, color=None):
    cell.text = ""
    p = cell.paragraphs[0]
    for i, line in enumerate(str(text).split("\n")):
        if i:
            p.add_run().add_break()
        style_run(p.add_run(line), size, bold, color)


class Doc:
    def __init__(self):
        self.d = Document()
        st = self.d.styles["Normal"]
        st.font.name = FONT
        st.font.size = Pt(10)
        st.element.rPr.rFonts.set(qn("w:cs"), FONT)
        sec = self.d.sections[0]
        sec.top_margin = sec.bottom_margin = Inches(0.6)
        sec.left_margin = sec.right_margin = Inches(0.7)

    def para(self, text, size=10, bold=False, color=None, italic=False, space_before=0):
        p = self.d.add_paragraph()
        if space_before:
            p.paragraph_format.space_before = Pt(space_before)
        style_run(p.add_run(text), size, bold, color, italic)
        return p

    def heading(self, text):
        return self.para(text, size=13, bold=True, color=NAVY, space_before=10)

    def bullets(self, items, size=9):
        for b in items:
            p = self.d.add_paragraph(style="List Bullet")
            style_run(p.add_run(b), size)

    def table(self, rows, widths=None, header=True, fontsize=9):
        if not rows:
            return None
        t = self.d.add_table(rows=0, cols=len(rows[0]))
        t.style = "Table Grid"
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        for ri, row in enumerate(rows):
            cells = t.add_row().cells
            for ci, val in enumerate(row):
                head = header and ri == 0
                put(cells[ci], val, fontsize, head, "FFFFFF" if head else None)
                if head:
                    shade(cells[ci], NAVY)
                elif ri % 2 == 0:
                    shade(cells[ci], LIGHT)
        if widths:
            for ci, w in enumerate(widths):
                for row in t.rows:
                    row.cells[ci].width = Inches(w)
        return t


def build(code, ref, roles, outdir):
    role = next((r for r in roles if r["code"] == code), None)
    if not role:
        raise SystemExit("role not found: " + code)

    dims = [d["name_th"] for d in ref["je_framework"]["dimensions"]]
    levels = {l["code"]: l for l in ref["leadership_levels"]}
    companies = {c["code"]: c for c in ref["companies"]}
    fam = ref["job_family_codes"].get(role.get("family_code"), {})
    cons = next((x for x in ref["consolidated_families"]
                 if x["id"] == fam.get("consolidated")), None)
    fam_name = (cons["name_en"] if cons else fam.get("name_en", role.get("family_code", "")))
    lv = levels.get(role["level"], {})
    co = companies.get(role.get("company"), {})
    s = role.get("specs", {}) or {}

    D = Doc()
    D.para("ใบกำหนดหน้าที่งาน (Job Description)", 15, True, NAVY)
    D.para("%s  ·  (%s)" % (role.get("title_en", ""), role.get("title_th", "")), 12, True)
    D.para("JD Code: %s   |   Company: %s   |   v%s" % (
        role["code"], co.get("name_en", role.get("company", "")), role.get("version", "1.0")),
        9, color=GREY)

    D.table([
        ["ชื่อตำแหน่ง (Position)", "ระดับ (Job Level)", "บริษัท (Company)"],
        ["%s\n(%s)" % (role.get("title_en", ""), role.get("title_th", "")),
         "%s (%s)" % (lv.get("label_en", ""), role["level"]),
         "%s\n%s" % (co.get("name_en", ""), co.get("name_th", ""))],
        ["รหัสตำแหน่ง (Job Role Code)", "Job Family", "รายงานตรงต่อ (Reports to)"],
        [role["code"], "%s (%s)" % (fam_name, role.get("family_code", "")),
         role.get("report_to", "-")],
    ], widths=[2.3, 2.0, 2.8])
    if role.get("unit_type"):
        D.para("ประเภทหน่วยงาน (Type): " + role["unit_type"], 9, color="333333")

    n = 1
    D.heading("%d. วัตถุประสงค์ (Job Purpose)" % n); n += 1
    D.para(role.get("purpose_th", "-"), 10)

    krs = role.get("krs") or []
    if krs:
        D.heading("%d. ความรับผิดชอบหลัก (Key Responsibilities) — ระดับ %s"
                  % (n, lv.get("label_en", role["level"]))); n += 1
        has_expected = any(k.get("expected_th") for k in krs)
        head = ["หน้าที่หลัก", "ผลที่คาดหวัง", "ตัวชี้วัด (KPIs)", "%"] if has_expected \
            else ["หน้าที่หลัก", "ตัวชี้วัด (KPIs)", "%"]
        rows, total = [head], 0
        for k in krs:
            total += k.get("weight_pct", 0) or 0
            kpis = "\n".join("• " + x for x in (k.get("kpis") or []))
            label = "%s. %s" % (k.get("seq", ""), k.get("name_th", ""))
            rows.append([label, k.get("expected_th", ""), kpis, "%s%%" % k.get("weight_pct", "")]
                        if has_expected else [label, kpis, "%s%%" % k.get("weight_pct", "")])
        rows.append(["รวมสัดส่วนความรับผิดชอบทั้งหมด"] + [""] * (len(head) - 2) + ["%d%%" % total])
        D.table(rows, widths=[2.3, 2.1, 2.3, 0.5] if has_expected else [3.0, 3.6, 0.6], fontsize=8.5)

    D.heading("%d. คุณสมบัติประจำตำแหน่ง (Job Specifications)" % n); n += 1
    ed, ex = s.get("education", {}) or {}, s.get("experience", {}) or {}
    spec_rows = []
    if ed:
        spec_rows.append(["วุฒิการศึกษา / สาขา",
                          (ed.get("level", "") + (" — " + ed["field"] if ed.get("field") else "")).strip(" —")])
    if ex:
        spec_rows.append(["ประสบการณ์", "ขั้นต่ำ %s ปี%s" % (
            ex.get("min_years", 0), " — " + ex["note"] if ex.get("note") else "")])
    for label, key in [("ทักษะหลัก", "skills"), ("ทักษะดิจิทัล", "digital"),
                       ("ใบรับรอง/วิชาชีพ", "certs")]:
        if s.get(key):
            spec_rows.append([label, "\n".join("• " + x for x in s[key])])
    if (s.get("languages") or {}).get("english"):
        spec_rows.append(["ภาษาอังกฤษ", s["languages"]["english"]])
    D.table(spec_rows, widths=[1.8, 5.3], header=False, fontsize=9)

    if s.get("competency_targets"):
        D.para("Competency Targets (สเกล 1–5): " +
               " · ".join("%s %s" % (k, v) for k, v in s["competency_targets"].items()),
               8.5, color="333333")

    bd = role.get("je_breakdown")
    D.heading("%d. JE (Position Grade) — ประเมิน 30 หัวข้อ (ข้อ26 Max6, ข้อ27 Max7, ข้อ30 stepped) | รวม %s"
              % (n, role.get("je_score", "-"))); n += 1
    if bd:
        rows = [["No.", "Key Competency", "Score"]]
        for i, name in enumerate(dims):
            rows.append([str(i + 1), name, str(bd[i]) if i < len(bd) else "-"])
        rows.append(["", "รวมคะแนน JE (Position Grade Score)", str(role.get("je_score", ""))])
        D.table(rows, widths=[0.5, 5.7, 0.9], fontsize=8.5)
    else:
        D.para("ไม่มีรายละเอียดรายข้อในระบบ (je_breakdown ว่าง) — มีเฉพาะคะแนนรวม %s"
               % role.get("je_score", "-"), 9, italic=True, color=GREY)
    if role.get("je_source"):
        D.para("หมายเหตุ: je_source=%s%s" % (
            role["je_source"],
            " — จัดทำจาก baseline ต่อระดับ อยู่ระหว่างรอ HR ปรับเทียบก่อนใช้เป็น Pay Grade"
            if role["je_source"] == "regenerated_proposed" else ""),
            8.5, color=GREY, italic=True)

    mb = role.get("market_benchmark") or {}
    if mb:
        D.heading("%d. Market Benchmark" % n); n += 1
        rows = []
        if mb.get("comparable_titles"):
            v = mb["comparable_titles"]
            rows.append(["ตำแหน่งเทียบเคียง", ", ".join(v) if isinstance(v, list) else v])
        if mb.get("salary_range_thb"):
            v = mb["salary_range_thb"]
            rows.append(["ช่วงเงินเดือน", " · ".join("%s: %s" % (a, b) for a, b in v.items())
                         if isinstance(v, dict) else v])
        if mb.get("note"):
            rows.append(["หมายเหตุ", mb["note"]])
        D.table(rows, widths=[1.8, 5.3], header=False, fontsize=9)

    D.d.add_paragraph()
    D.table([
        ["ผู้จัดทำ (Prepared by)", "ผู้อนุมัติ (Approved by)", "ผู้ดำรงตำแหน่ง (Acknowledged by)"],
        ["(................................)\nGroup HR — Precise Corporation\nวันที่ ..../..../....",
         "(................................)\nผู้บังคับบัญชา / ผู้มีอำนาจอนุมัติ\nวันที่ ..../..../....",
         "(................................)\n%s\nวันที่ ..../..../...." % role.get("title_en", "")],
    ], widths=[2.37, 2.37, 2.37], fontsize=9)
    D.para("Precise Corporation Public Company Limited | Group HR | %s | v%s"
           % (role["code"], role.get("version", "1.0")), 8, color="888888")

    safe = re.sub(r"[^\w\s&()\-]", "", role.get("title_en", "role")).strip()
    name = "%s_%s_%s_v%s.docx" % (role["code"], safe, role.get("company", ""), role.get("version", "1.0"))
    path = os.path.join(outdir, name)
    D.d.save(path)
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("codes", nargs="*", help="job role codes")
    ap.add_argument("--level", help="export every active role at this level instead")
    ap.add_argument("--out", default=".", help="output directory (default: current)")
    a = ap.parse_args()

    ref = load("data/reference.json")
    roles = load("data/job_roles.json")["roles"]
    codes = a.codes
    if a.level:
        codes += [r["code"] for r in roles
                  if r["level"] == a.level and r.get("status") == "active"]
    if not codes:
        ap.error("give at least one job role code, or --level")

    os.makedirs(a.out, exist_ok=True)
    for c in codes:
        print("wrote", build(c, ref, roles, a.out))


if __name__ == "__main__":
    main()

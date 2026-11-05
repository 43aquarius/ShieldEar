#!/usr/bin/env python3
"""patch-footers.py — 三节页码后处理
按 document.xml 中 sectPr 出现顺序定位各节 footerReference，
第 2 节（目录）补 ROMAN 格式开关，第 3 节（正文）补 arabic；
并清除空 <w:pgNumType/>。
"""
import re, sys, zipfile, shutil, os

DOCX = sys.argv[1]
TMP = DOCX + ".tmp"

with zipfile.ZipFile(DOCX) as z:
    names = z.namelist()
    files = {n: z.read(n) for n in names}

doc = files["word/document.xml"].decode("utf-8")

# 1. 清除空 pgNumType
doc = doc.replace("<w:pgNumType/>", "")

# 2. 按 sectPr 出现顺序取 default footerReference r:id
sectprs = re.findall(r"<w:sectPr[ >].*?</w:sectPr>", doc, flags=re.S)
print(f"sections found: {len(sectprs)}")
foot_ids = []  # (section_index, rid) — 仅 default footer
for i, sp in enumerate(sectprs):
    m = re.search(r'<w:footerReference w:type="default" r:id="(rId\d+)"', sp)
    foot_ids.append((i, m.group(1) if m else None))
    print(f"  section {i+1}: footer={m.group(1) if m else 'none (inherit)'}")

# 3. rels: rId -> footer file
rels = files["word/_rels/document.xml.rels"].decode("utf-8")
rid2file = dict(re.findall(r'Id="(rId\d+)"[^>]*Target="(footer\d+\.xml)"', rels))

def patch_footer(fname, fmt):
    key = "word/" + fname
    xml = files[key].decode("utf-8")
    xml2 = re.sub(r"(<w:instrText[^>]*>)\s*PAGE\s*(</w:instrText>)",
                  rf"\1 PAGE \\* {fmt} \\* MERGEFORMAT \2", xml)
    files[key] = xml2.encode("utf-8")
    print(f"  patched {fname} -> {fmt}")

# 节序：0=封面(无footer) 1=目录(ROMAN) 2=正文(arabic)
for idx, rid in foot_ids:
    if rid is None:
        continue
    fname = rid2file.get(rid)
    if not fname:
        continue
    if idx == 1:
        patch_footer(fname, "ROMAN")
    elif idx == 2:
        patch_footer(fname, "arabic")

files["word/document.xml"] = doc.encode("utf-8")

with zipfile.ZipFile(TMP, "w", zipfile.ZIP_DEFLATED) as z:
    for n in names:
        z.writestr(n, files[n])
shutil.move(TMP, DOCX)
print("OK footers patched")

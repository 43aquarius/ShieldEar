#!/usr/bin/env python3
"""espeak-ng Windows 便携包重建：MSI → CAB → 平铺文件 → 按本地 1.52 数据树重建标准布局"""
import olefile, subprocess, os, shutil, sys, glob

DL = "/home/z/my-project/package-build/downloads"
OUT = os.path.join(DL, "espeak-ng-win")
LOCAL_DATA = "/usr/lib/x86_64-linux-gnu/espeak-ng-data"
SEVENZA = os.path.join(DL, "package/linux/x64/7za")

# 1. 从 MSI 提取最大 CAB 流
ole = olefile.OleFileIO(os.path.join(DL, "espeak152.msi"))
best, best_size = None, 0
for s in ole.listdir():
    sz = ole.get_size(s)
    if sz > best_size:
        best, best_size = s, sz
cab_path = os.path.join(DL, "espeak152.cab")
with open(cab_path, "wb") as f:
    f.write(ole.openstream(best).read())
print(f"[1] CAB stream: {best_size/1048576:.1f}MB -> {cab_path}")

# 2. 解出平铺文件
flat = os.path.join(DL, "espeak152-flat")
if os.path.exists(flat):
    shutil.rmtree(flat)
subprocess.run([SEVENZA, "x", f"-o{flat}", "-y", cab_path], check=True, capture_output=True)
flat_files = [f for f in glob.glob(flat + "/**/*", recursive=True) if os.path.isfile(f)]
print(f"[2] flat files: {len(flat_files)}")

# 3. 本地数据树 → 文件名到相对路径的映射（归一化 - 与 _ 等价）
def norm(name):
    return name.replace("-", "_").replace("!", "").lower()

local_map = {}
for root, dirs, files in os.walk(LOCAL_DATA):
    for fn in files:
        local_map.setdefault(norm(fn), os.path.relpath(os.path.join(root, fn), LOCAL_DATA))

# 4. 重建布局：espeak-ng/espeak-ng.exe + espeak-ng/espeak-ng-data/**（exe 与 data 同级兄弟）
if os.path.exists(OUT):
    shutil.rmtree(OUT)
data_out = os.path.join(OUT, "espeak-ng-data")
matched, unmatched, exe_found = 0, [], False
for ff in flat_files:
    base = os.path.basename(ff)
    if base.lower() in ("espeak_ng.exe", "espeak-ng.exe"):
        shutil.copy2(ff, os.path.join(OUT, "espeak-ng.exe"))
        exe_found = True
        continue
    rel = local_map.get(norm(base))
    if rel:
        dst = os.path.join(data_out, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(ff, dst)
        matched += 1
    else:
        unmatched.append(base)

print(f"[3] matched: {matched}, unmatched(dropped): {len(unmatched)}, exe: {exe_found}")
if unmatched:
    print("    dropped:", ", ".join(sorted(unmatched)[:15]), "..." if len(unmatched) > 15 else "")

# 5. 核心文件自检
core = ["phontab", "phonindex", "phondata", "intonations", "cmn_dict",
        os.path.join("lang", "sit", "cmn"), os.path.join("lang", "gmw", "en")]
missing = [c for c in core if not os.path.exists(os.path.join(data_out, c))]
print(f"[4] core check: {'OK' if not missing else 'MISSING ' + str(missing)}")
sys.exit(0 if (exe_found and not missing) else 1)

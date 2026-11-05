#!/usr/bin/env python3
"""patch_fonts_pptx.py — SOP §8.2 字体塌缩防御 · 第三层终处理
把 PPTX 内 XML 的 webfont 字族改写为 Windows/Office/WPS 标配六族：
宋体标题 / 雅黑正文 / 楷体设问 / Arial Narrow 数据 / Calibri 西文 / Courier New 代码
用法: python3 patch_fonts_pptx.py <输出.pptx>
"""
import sys, zipfile, shutil

FONT_MAP = {
    'Noto Serif SC': 'SimSun',          # 宋体标题
    'Noto Sans SC': 'Microsoft YaHei',  # 雅黑正文
    'LXGW WenKai': 'KaiTi',             # 楷体设问 / 图注
    'Inter': 'Arial Narrow',            # 数据（窄体数字）
    'Playfair Display': 'Calibri',      # 西文展示
    'IBM Plex Mono': 'Courier New',     # 代码 / 英文小签
    'JetBrains Mono': 'Courier New',
    'Carlito': 'Calibri',
    'Tinos': 'Calibri',
    # 转换器内置映射产生的 Linux 字体名 → Windows 标配
    'Liberation Sans Narrow': 'Arial Narrow',
    'Liberation Sans': 'Arial',
    'Liberation Serif': 'Times New Roman',
    'Liberation Mono': 'Courier New',
}

def patch(path):
    tmp = path + '.patched'
    replaced = {}
    with zipfile.ZipFile(path, 'r') as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename.endswith('.xml') and b'typeface=' in data:
                text = data.decode('utf-8')
                for old, new in FONT_MAP.items():
                    if old in text:
                        n = text.count(f'typeface="{old}"')
                        text = text.replace(f'typeface="{old}"', f'typeface="{new}"')
                        replaced[old] = replaced.get(old, 0) + n
                data = text.encode('utf-8')
            zout.writestr(item, data)
    shutil.move(tmp, path)
    total = 0
    for k, v in sorted(replaced.items()):
        print(f'  {k:20s} -> {FONT_MAP[k]:16s} x{v}')
        total += v
    return total

if __name__ == '__main__':
    p = sys.argv[1]
    print(f'patching fonts: {p}')
    n = patch(p)
    print(f'done · {n} typeface refs rewritten')

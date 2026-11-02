#!/usr/bin/env bash
# ============================================================
# push-v134.sh — v1.3.4 一键发布（等 GitHub PAT 到位后执行）
# 用法: GH_TOKEN=github_pat_xxx bash scripts/push-v134.sh
# 做四件事：
#   1. 推送 v1.3.4-pending → origin/main（fast-forward）
#   2. 打 tag v1.3.4 并推送
#   3. 创建 GitHub Release（附说明与 sha256）
#   4. 上传便携包资产（66MB，走 API，断点由 GitHub 处理）
# ============================================================
set -euo pipefail

TOKEN="${GH_TOKEN:?请提供 GitHub PAT：GH_TOKEN=github_pat_xxx bash scripts/push-v134.sh}"
REPO="43aquaris/ShieldEar"
BRANCH_TIP="$(git rev-parse v1.3.4-pending)"
ZIP="${1:-/home/z/my-project/download/ShieldEar-v1.3.4-portable.zip}"
SHA256="$(sha256sum "$ZIP" | cut -d' ' -f1)"

echo "── [1/4] 推送 main（$BRANCH_TIP）──"
git -c http.version=HTTP/1.1 push "https://x-access-token:${TOKEN}@github.com/${REPO}.git" \
  "+refs/heads/v1.3.4-pending:refs/heads/main"

echo "── [2/4] 打 tag v1.3.4 ──"
git tag -f v1.3.4 "$BRANCH_TIP"
git -c http.version=HTTP/1.1 push "https://x-access-token:${TOKEN}@github.com/${REPO}.git" \
  "refs/tags/v1.3.4"

echo "── [3/4] 创建 Release ──"
RELEASE_ID=$(curl -s -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/${REPO}/releases" \
  -d "$(python3 - "$SHA256" <<'PY'
import json, sys
body = """## 声盾 ShieldEar v1.3.4 — 判决剧场惊艳升级

### 新特性（面向答辩演示的高光时刻）
- **判决剧场**：环形置信度仪表（刻度环逐格点亮 + 数字滚动）→ 判决印章砸落动画（深伪检出红章 / 真人语音翠章）→ 高危卡片红色呼吸描边
- **时频取证视图**：客户端 FFT（1024 点 / 汉宁窗）→ 对数频率轴 magma 热力瀑布图，可疑片段红色高亮、播放光标联动、点击跳转
- **Hero 声纹律动**：多频正弦叠加有机律动，开屏即"系统活着"
- **威胁热力时间线**：实时鉴听逐窗落格战况带 + 告警横幅滑入
- **真伪 A/B 对比试听**：内置对照样本浏览器内双判决（实测真人 20.2% vs 合成 72.5%）
- 三条链路（鉴听/文件/挑战）全部打通本地回放与时频分析
- 全部动效尊重 prefers-reduced-motion

### 交付
- 纯离线便携包 65.7MB（v1.3.3 为 81.1MB）
- 断网 netns 实测 6/6 全绿（仅 lo 接口，合成 0.18s 零联网零等待）
- SHA-256: `%s`

### 升级方式
解压任意目录 → 双击 START-ShieldEar.bat → 浏览器自动打开
""" % sys.argv[1]
print(json.dumps({
    "tag_name": "v1.3.4",
    "target_commitish": "main",
    "name": "ShieldEar v1.3.4 — 判决剧场惊艳升级（纯离线便携版）",
    "body": body,
    "draft": False,
    "prerelease": False,
}))
PY
)" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id') or d)")

echo "── [4/4] 上传便携包资产（67MB，约需数分钟）──"
curl -s -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/zip" \
  --data-binary "@$ZIP" \
  "https://uploads.github.com/repos/${REPO}/releases/${RELEASE_ID}/assets?name=ShieldEar-v1.3.4-portable.zip" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('资产:', d.get('browser_download_url') or d)"

echo
echo "✓ v1.3.4 发布完成"
echo "⚠ 提醒：确认发布成功后，请到 GitHub Settings → Developer settings 撤销本 PAT"

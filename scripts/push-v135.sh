#!/usr/bin/env bash
# ============================================================
# push-v135.sh — v1.3.5 一键发布（等 GitHub PAT 到位后执行）
# 用法: GH_TOKEN=github_pat_xxx bash scripts/push-v135.sh
# 做四件事：
#   1. 推送本地 main（含 v1.3.4 遗留 + v1.3.5 两个提交，fast-forward）
#   2. 推送 tag v1.3.5
#   3. 创建 GitHub Release（附说明与 SHA-256）
#   4. 上传便携包资产（64.7MB，走 API）
# 注：v1.3.4 的 push-v134.sh 中仓库名曾误拼为 43aquaris（少 u），
#     本脚本已修正为 43aquarius。
# ============================================================
set -euo pipefail

TOKEN="${GH_TOKEN:?请提供 GitHub PAT：GH_TOKEN=github_pat_xxx bash scripts/push-v135.sh}"
REPO="43aquarius/ShieldEar"
BRANCH_TIP="$(git rev-parse main)"
ZIP="${1:-/home/z/my-project/download/ShieldEar-v1.3.5-portable.zip}"
SHA256="$(sha256sum "$ZIP" | cut -d' ' -f1)"

echo "── [1/4] 推送 main（$BRANCH_TIP）──"
git -c http.version=HTTP/1.1 push "https://x-access-token:${TOKEN}@github.com/${REPO}.git" \
  "refs/heads/main:refs/heads/main"

echo "── [2/4] 推送 tag v1.3.5 ──"
git -c http.version=HTTP/1.1 push "https://x-access-token:${TOKEN}@github.com/${REPO}.git" \
  "refs/tags/v1.3.5"

echo "── [3/4] 创建 Release ──"
RELEASE_ID=$(curl -s -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/${REPO}/releases" \
  -d "$(python3 - "$SHA256" <<'PY'
import json, sys
body = """## 声盾 ShieldEar v1.3.5 — 纯离线发行版

### 修复（针对用户实测反馈）
- **合成挑战 / 案例库报 "Unexpected token 'I', Internal Server Error"**：根因是运行环境 Prisma 引擎缺失或加载失败（典型：系统缺少 VC++ 2015-2022 运行库 x64、杀毒软件隔离 .node 引擎、解压不完整）时，Next.js 返回纯文本 500，而前端 `.json()` 在状态检查之前执行。现已：
  - 前端全部 6 个接口调用统一 `fetchJson` 兜底，错误信息人话化并附处置提示；
  - **启动自检**（boot.js）：实际加载 Prisma 引擎探针 + 数据库连通 + 校准数据 + espeak 组件，任何一项失败即给出中文指引（含 VC++ 运行库官方链接）并写入 `STARTUP-ERROR.txt`，拒绝带病启动；
  - 打包管线双重 fail-fast：构建机引擎校验 + 组装后包内校验 + 空库防线。
- **案例库空库**：发行包数据库一律以源仓库为权威数据，种子案例与证据 WAV 一一对应（哈希校验）后入库。

### 新特性
- **证据完整性核验**：检测结果与案例库详情中一键「核验证据完整性」— 服务端重读证据 WAV、重算 SHA-256 与入库值逐项比对，绿色 **INTEGRITY VERIFIED** 印章证明证据自存证以来未被篡改（实测篡改 1 字节立即检出）。这是「存证 → 验真」闭环的验真端。
- **系统自检**（导航第 4 页）：一键体检数据引擎 / 证据目录 / 引擎校准 / 本地合成引擎 / 离线声明，逐项打勾揭晓动画，全绿横幅 — 答辩开场即可证明"这台机器上的声盾是健康的、离线的"。
- **纯离线发行锁**：云端合成通道从发行包中整体移除 — 界面无开关（编译期徽章化）、切换接口 403 锁死、包内不存在任何可触发的联网路径。源码开发版（`npm run dev`）仍保留云端四级链用于对比实验。

### 断网实测（unshare 仅 lo 接口）
8/8 全绿：合成挑战（espeak 本地 0.29s）/ 实时鉴听 / 文件检测 / 案例库 / 存证包 / 云端通道 403 发行锁 / 系统自检 5-5 / 证据核验 verified=True

### 交付
- 便携包 **64.7 MB**（1891 个文件；v1.3.4 为 62.1MB，新增自检/核验模块）
- 引擎版本 v1.3.5-calibrated
- SHA-256: `%s`

### 升级方式
解压任意目录 → 双击 START-ShieldEar.bat → 浏览器自动打开。
若启动窗口提示自检失败，按 STARTUP-ERROR.txt 内指引处理（最常见：安装微软 VC++ 运行库 x64 或将解压目录加入杀毒白名单）。
""" % sys.argv[1]
print(json.dumps({
    "tag_name": "v1.3.5",
    "target_commitish": "main",
    "name": "ShieldEar v1.3.5 — 纯离线发行版（启动自检 + 证据完整性核验 + 系统自检）",
    "body": body,
    "draft": False,
    "prerelease": False,
}))
PY
)" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id') or d)")

echo "── [4/4] 上传便携包资产（64.7MB，约需数分钟）──"
curl -s -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/zip" \
  --data-binary "@$ZIP" \
  "https://uploads.github.com/repos/${REPO}/releases/${RELEASE_ID}/assets?name=ShieldEar-v1.3.5-portable.zip" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('资产:', d.get('browser_download_url') or d)"

echo
echo "✓ v1.3.5 发布完成"
echo "⚠ 提醒：确认发布成功后，请到 GitHub Settings → Developer settings 撤销本 PAT"

#!/usr/bin/env bash
# ============================================================
# push-v138.sh — v1.3.8 一键发布（根因修正热修复）
# 用法: GH_TOKEN=github_pat_xxx bash scripts/push-v138.sh
# 做四件事：
#   1. 推送本地 main
#   2. 推送 tag v1.3.8
#   3. 创建 GitHub Release（幂等：已存在则复用）
#   4. 上传便携包资产（重试 5 次）
# 注：v1.3.7 Release 页已由用户手动添加修复指引，无需横幅；
#     本脚本发布完可顺带把 v1.3.7 说明中「根因=VC++」的表述改为指向 v1.3.8。
# ============================================================
set -euo pipefail

TOKEN="${GH_TOKEN:?请提供 GitHub PAT：GH_TOKEN=github_pat_xxx bash scripts/push-v138.sh}"
REPO="43aquaris/ShieldEar"
BRANCH_TIP="$(git rev-parse main)"
ZIP="/home/z/my-project/download/ShieldEar-v1.3.8-portable.zip"
SHA256="$(sha256sum "$ZIP" | cut -d' ' -f1)"

push_retry() {
  local n=0
  until [ $n -ge 4 ]; do
    if git -c http.version=HTTP/1.1 push "https://x-access-token:${TOKEN}@github.com/${REPO}.git" "$@"; then
      return 0
    fi
    n=$((n + 1)); echo "[push] 第 ${n} 次失败，重试…"; sleep 5
  done
  return 1
}

echo "── [1/4] 推送 main（$BRANCH_TIP）──"
push_retry "refs/heads/main:refs/heads/main"

echo "── [2/4] 推送 tag v1.3.8 ──"
push_retry "refs/tags/v1.3.8"

echo "── [3/4] 创建 Release（幂等）──"
RELEASE_JSON=$(python3 - "$SHA256" <<'PY'
import json, sys
body = """## 声盾 ShieldEar v1.3.8 — 本地合成引擎根因修正（DLL 文件名修复）

### 修复内容
彻底解决「系统自检提示本地合成引擎失败 / 合成挑战报『未找到可用的 espeak-ng』」的问题。

**真正根因**（用户真机实测坐实）：包内 `espeak-ng.exe`（官方 CI 构建）的 PE 导入表要求 `libespeak-ng.dll`（**连字符**），而发行包内的文件名是 `libespeak_ng.dll`（**下划线**）—— 一字之差，导致**任何** Windows 电脑上合成器都以 `0xC0000135`（DLL 找不到）拒绝启动。

**v1.3.7 误诊说明**：v1.3.7 曾将该错误归因于「系统缺少 VC++ 运行库 / 杀毒误删」并随包分发了 VC++ 三 DLL —— 那些运行库确实是必要依赖，但并非本故障根因；装了运行库也照样复现。向被误导的用户致歉。

**修复（四层防线）**：
- 包内同时分发两个文件名的 DLL（`libespeak-ng.dll` + `libespeak_ng.dll`）；
- 三层运行时自愈：启动自检自动补齐别名（boot.js）、合成探测前自动补齐（local-tts.ts）、随包 `windows-smoke.cmd` 可双击就地修复 v1.3.7 旧包；
- 打包流水线新增 **PE 导入表硬闸**：包内任何二进制引用的每个 DLL 必须按名可解析，否则拒绝打包 —— 本类事故从构建期即被拦截；
- `0xC0000135` 报错文案修正为「包内 DLL 缺失或文件名不匹配」，不再误导用户去装 VC++。

### 新增
- `windows-smoke.cmd`（包根目录）：双击 10 秒验证本地合成引擎（版本探测 → 中文合成 → 产物校验），全绿即健康。

### 交付
- 纯离线便携包约 70MB（含双文件名 DLL 与 VC++ 运行库，Win10/11 解压即用，**无需安装任何运行库**）
- 断网 netns 实测（解压后交付 zip · 仅 lo 接口 · 零联网零等待）8/8 全绿
- SHA-256: `%s`

### 升级方式
解压任意目录 → 双击 START-ShieldEar.bat → 浏览器自动打开 http://127.0.0.1:3000

### 旧包就地修复（不想重新下载时）
在 v1.3.7 包根目录执行 `windows-smoke.cmd`（从本 Release 单独下载该文件放入亦可），脚本会自动补齐 `espeak-ng\\libespeak-ng.dll`；或手动复制：`espeak-ng\\libespeak_ng.dll` → `espeak-ng\\libespeak-ng.dll`。""" % sys.argv[1]
print(json.dumps({
    "tag_name": "v1.3.8",
    "target_commitish": "main",
    "name": "ShieldEar v1.3.8 — 本地合成引擎根因修正（DLL 文件名 · 双名随包 + 三层自愈 + 打包硬闸）",
    "body": body,
    "draft": False,
    "prerelease": False,
}))
PY
)
EXIST_ID=""
for probe in 1 2 3 4 5; do
  GOT=$(curl -s -m 30 -H "Authorization: Bearer ${TOKEN}" \
    "https://api.github.com/repos/${REPO}/releases/tags/v1.3.8" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id') or ('NOTFOUND' if d.get('status')=='404' else 'FLAKE'))" 2>/dev/null || echo FLAKE)
  if [ "$GOT" != "FLAKE" ] && [ "$GOT" != "" ]; then
    [ "$GOT" != "NOTFOUND" ] && EXIST_ID="$GOT"
    break
  fi
  sleep 3
done

if [ -n "$EXIST_ID" ]; then
  echo "Release 已存在（id=$EXIST_ID），复用"
  REL_ID="$EXIST_ID"
else
  REL_ID=$(curl -s -m 60 -X POST \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$RELEASE_JSON" \
    "https://api.github.com/repos/${REPO}/releases" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id') or ('ERR:'+str(d.get('message'))[:200]))")
  case "$REL_ID" in
    ERR:*) echo "✗ Release 创建失败：$REL_ID"; exit 1 ;;
  esac
  echo "✓ Release 创建成功（id=$REL_ID）"
fi

echo "── [4/4] 上传便携包资产（$(du -h "$ZIP" | cut -f1)）──"
for attempt in 1 2 3 4 5; do
  UP=$(curl -s -m 1800 -X POST \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/zip" \
    --data-binary "@$ZIP" \
    "https://uploads.github.com/repos/${REPO}/releases/${REL_ID}/assets?name=ShieldEar-v1.3.8-portable.zip" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('browser_download_url') or ('ERR:'+str(d.get('message'))[:200]))")
  case "$UP" in
    https*) echo "✓ 资产上传成功：$UP"; exit 0 ;;
    *) echo "  第 ${attempt} 次上传未确认（$UP），重试…"; sleep 5 ;;
  esac
done
echo "✗ 资产上传 5 次未确认，请手动检查 Release 页"
exit 1

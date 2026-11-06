#!/usr/bin/env bash
# ============================================================
# push-v137.sh — v1.3.7 一键发布（等 GitHub PAT 到位后执行）
# 用法: GH_TOKEN=github_pat_xxx bash scripts/push-v137.sh
# 做五件事：
#   1. 推送本地 main
#   2. 推送 tag v1.3.7
#   3. 创建 GitHub Release（幂等：已存在则复用）
#   4. 上传便携包资产（70.1MB，重试 3 次）
#   5. 给 v1.3.6 Release 说明加修复指引横幅
# ============================================================
set -euo pipefail

TOKEN="${GH_TOKEN:?请提供 GitHub PAT：GH_TOKEN=github_pat_xxx bash scripts/push-v137.sh}"
REPO="43aquarius/ShieldEar"
BRANCH_TIP="$(git rev-parse main)"
ZIP="/home/z/my-project/download/ShieldEar-v1.3.7-portable.zip"
SHA256="$(sha256sum "$ZIP" | cut -d' ' -f1)"

push_retry() {
  # $@ = git push 参数；最多 4 次（应对 TLS/路由抖动）
  local n=0
  until [ $n -ge 4 ]; do
    if git -c http.version=HTTP/1.1 push "https://x-access-token:${TOKEN}@github.com/${REPO}.git" "$@"; then
      return 0
    fi
    n=$((n + 1)); echo "[push] 第 ${n} 次失败，重试…"; sleep 5
  done
  return 1
}

echo "── [1/5] 推送 main（$BRANCH_TIP）──"
push_retry "refs/heads/main:refs/heads/main"

echo "── [2/5] 推送 tag v1.3.7 ──"
push_retry "refs/tags/v1.3.7"

echo "── [3/5] 创建 Release（幂等）──"
RELEASE_JSON=$(python3 - "$SHA256" <<'PY'
import json, sys
body = """## 声盾 ShieldEar v1.3.7 — 本地合成引擎热修复 + 界面精简

### 修复内容
修复部分 Windows 电脑上「系统自检提示本地合成引擎失败 / 合成挑战报『未找到可用的 espeak-ng』」的问题。

**根因**：包内 espeak-ng.exe 与 libespeak_ng.dll 为 MSVC 构建，运行依赖微软 VC++ 2015-2022 运行库（msvcp140 / vcruntime140 / vcruntime140_1）。未安装该运行库的电脑上，合成器进程以 0xC0000135（DLL 缺失）拒绝启动 —— v1.3.6 的报错文案「包内组件缺失」曾误导排障方向，实际上文件都在，是系统运行库缺失。

**修复**：
- 三个微软官方运行库 DLL 以 app-local 方式随包分发（espeak-ng/ 目录），**任何 Windows 10/11 电脑解压即用，无需安装任何运行库**；已装运行库的机器不受影响；
- espeak 探测失败时如实携带逐候选真实原因（退出码翻译为人话），系统自检页可直接看到根因；
- 启动自检中 espeak 组件缺失从「拒绝启动」降级为「警告并降级到预置样本回放」——单一组件被杀毒误删不再导致整包不可用。

### 界面精简
按演示反馈移除「真伪 A/B 对比试听」卡片，合成挑战页签聚焦现场合成主线（预置样本仍保留在文件检测中）。

### 交付
- 纯离线便携包 70.0MB（1920 文件，含 VC++ 运行库 DLL 695KB）
- 断网 netns 实测 8/8 全绿（解压后交付物 · 仅 lo 接口 · 零联网零等待）
- SHA-256: `%s`

### 升级方式
解压任意目录 → 双击 START-ShieldEar.bat → 浏览器自动打开 http://127.0.0.1:3000
（v1.3.6 在缺 VC++ 运行库的电脑上合成挑战会降级为预置样本回放，建议统一换用本版）""" % sys.argv[1]
print(json.dumps({
    "tag_name": "v1.3.7",
    "target_commitish": "main",
    "name": "ShieldEar v1.3.7 — 本地合成引擎热修复（内置 VC++ 运行库 · 纯离线便携版）",
    "body": body,
    "draft": False,
    "prerelease": False,
}))
PY
)
# 幂等：先查是否已存在（抖动鲁棒：404 需连续 5 次才判定「不存在」；200 即得 id）
EXIST_ID=""
for probe in 1 2 3 4 5; do
  GOT=$(curl -s -m 30 -H "Authorization: Bearer ${TOKEN}" \
    "https://api.github.com/repos/${REPO}/releases/tags/v1.3.7" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id') or ('NOTFOUND' if d.get('status')=='404' else 'FLAKE'))" 2>/dev/null || echo FLAKE)
  if [ "$GOT" != "FLAKE" ] && [ "$GOT" != "" ]; then
    [ "$GOT" != "NOTFOUND" ] && EXIST_ID="$GOT"
    break
  fi
  echo "[release] 探测抖动（${probe}/5），重试…"; sleep 4
done
if [ -n "$EXIST_ID" ]; then
  echo "[release] 已存在 id=$EXIST_ID，复用"
  RELEASE_ID="$EXIST_ID"
else
  RESP=$(curl -s -m 60 -X POST \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/${REPO}/releases" \
    -d "$RELEASE_JSON")
  RELEASE_ID=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id') or '')" 2>/dev/null || true)
  if [ -z "$RELEASE_ID" ]; then
    # 已存在（422 already_exists）或抖动 → 重探 id
    echo "[release] 创建未直返 id（$(echo "$RESP" | head -c 120)），重探…"
    for probe in 1 2 3 4 5; do
      RELEASE_ID=$(curl -s -m 30 -H "Authorization: Bearer ${TOKEN}" \
        "https://api.github.com/repos/${REPO}/releases/tags/v1.3.7" \
        | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id') or '')" 2>/dev/null || true)
      [ -n "$RELEASE_ID" ] && break
      sleep 4
    done
  fi
  [ -n "$RELEASE_ID" ] && echo "[release] 创建成功 id=$RELEASE_ID" || { echo "✗ Release 创建/探测均失败"; exit 1; }
fi

echo "── [4/5] 上传便携包资产（70.0MB，重试 5 次）──"
UPLOADED=0
for attempt in 1 2 3 4 5; do
  echo "[upload] 第 ${attempt} 次上传..."
  RESP=$(curl -s -X POST \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/zip" \
    --data-binary "@$ZIP" \
    "https://uploads.github.com/repos/${REPO}/releases/${RELEASE_ID}/assets?name=ShieldEar-v1.3.7-portable.zip")
  URL=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('browser_download_url') or '')" 2>/dev/null || true)
  if [ -n "$URL" ]; then
    echo "[upload] ✓ $URL"
    UPLOADED=1
    break
  fi
  echo "[upload] ✗ $(echo "$RESP" | head -c 200)"
  sleep 8
done
[ "$UPLOADED" = "1" ] || { echo "✗ 资产上传失败"; exit 1; }

echo "── [5/5] v1.3.6 Release 说明加修复指引横幅 ──"
python3 - "$TOKEN" <<'PY'
import json, os, subprocess, sys
TOKEN = sys.argv[1]
REPO = "43aquarius/ShieldEar"

def api(path, data=None, method=None, tries=6):
    import time as _t
    out = None
    for i in range(tries):
        cmd = ["curl", "-s", "--max-time", "60", "-H", f"Authorization: Bearer {TOKEN}",
               "-H", "Accept: application/vnd.github+json"]
        if data is not None:
            cmd += ["-X", method or "PATCH", "-d", json.dumps(data)]
        cmd.append(f"https://api.github.com/repos/{REPO}/{path}")
        out = json.loads(subprocess.run(cmd, capture_output=True, text=True).stdout or "{}")
        if isinstance(out, dict) and "id" in out:
            return out
        if data is None:  # 读探测：可能抖动假 404
            _t.sleep(4); continue
        _t.sleep(4)
    return out or {}

rel = api("releases/tags/v1.3.6")
if "id" not in rel:
    print("[patch] ✗ 找不到 v1.3.6 release:", str(rel)[:200])
    sys.exit(1)
old = rel.get("body") or ""
banner = ("> ⚠️ **本版在未安装微软 VC++ 2015-2022 运行库的 Windows 电脑上，系统自检会提示「本地合成引擎失败」，"
          "合成挑战降级为预置样本回放**（其余功能不受影响）。\n"
          "> 已由 **[v1.3.7](https://github.com/43aquarius/ShieldEar/releases/tag/v1.3.7)** 内置运行库 DLL 彻底修复，请下载 v1.3.7 使用。\n\n")
if "v1.3.7" in old:
    print("[patch] 已含横幅，跳过")
else:
    patched = api(f"releases/{rel['id']}", data={"body": banner + old})
    print("[patch] ✓ v1.3.6 说明已加横幅" if "id" in patched else f"[patch] ✗ 失败: {str(patched)[:150]}")
PY

echo
echo "✓ v1.3.7 发布完成：https://github.com/${REPO}/releases/tag/v1.3.7"
echo "⚠ 提醒：确认发布成功后，请到 GitHub Settings → Developer settings → Personal access tokens 撤销本 PAT（已在聊天中暴露）"

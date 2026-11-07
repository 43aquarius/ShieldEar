#!/usr/bin/env bash
# ============================================================
# push-v139.sh — v1.3.9 一键发布（应用内合成通道根因修正 + 存证强化）
# 用法: GH_TOKEN=github_pat_xxx bash scripts/push-v139.sh
# 做四件事：
#   1. 推送本地 main
#   2. 推送 tag v1.3.9
#   3. 创建 GitHub Release（幂等；名字路由失败自动回落数字 ID 路由
#      /repositories/1435969436/releases —— v1.3.8 名字索引故障期实证可用）
#   4. 上传便携包资产（双路由 × 5 次重试）
# ============================================================
set -euo pipefail

TOKEN="${GH_TOKEN:?请提供 GitHub PAT：GH_TOKEN=github_pat_xxx bash scripts/push-v139.sh}"
REPO="43aquaris/ShieldEar"
REPO_NUM=1435969436   # GraphQL databaseId（数字 ID 备援路由）
BRANCH_TIP="$(git rev-parse main)"
ZIP="/home/z/my-project/download/ShieldEar-v1.3.9-portable.zip"
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

echo "── [2/4] 推送 tag v1.3.9 ──"
push_retry "refs/tags/v1.3.9" || echo "  （tag 推送失败不阻断——Release 创建走 API）"

echo "── [3/4] 创建 Release（幂等 · 双路由）──"
RELEASE_JSON=$(SHA256="$SHA256" python3 << 'PY'
import json, os
body = """## 声盾 ShieldEar v1.3.9 — 应用内合成通道真正的根因修正 + 存证强化

### 头条修复：合成挑战从「恒回放预置样本」变为真·现场合成

v1.3.8 修好了 DLL 文件名（那也是真实缺陷），但真机审计发现**应用内的合成挑战依然 100% 回放预置样本**。本次坐实更深一层的根因：

**Turbopack 平台常量折叠**：Next.js 16 在服务端打包时把 `process.platform === "win32"` 按**构建机**（Linux）的值折叠为 `false`，随后 DCE 整段裁掉 win32 分支 —— 源码里正确的 `espeak-ng.exe` 候选名在产物中退化为裸名 `espeak-ng`，`existsSync` 不自动补 `.exe`，包内候选自 v1.3.1 起**从未命中过**（v1.3.7 真机自检 4/5 红项、历次「未找到可用的 espeak-ng」全部同源）。

**修复**：
- 候选探测改为**平台无关按名探测**（`espeak-ng.exe` / `espeak-ng` 都试，由真实运行平台裁决），服务端代码全面禁用平台常量分支；
- `boot.js` 启动时全局注入 `ESPEAK_DATA_PATH`（官方 CI 构建的 exe 找不到数据目录会直接崩溃）；
- 打包流水线新增**平台折叠硬闸**：产物 chunk 中必须能找到 `espeak-ng.exe` 字面量（被折叠即消失），否则拒绝打包 —— 本类事故从构建期拦截。

### 审计驱动的其余修复
- **P0 并发存证竞态**：两个检测同时提交时旧版互相覆盖证据音频 → 改为「先入库占号（撞号重试）、后写文件（失败回滚）」，6 路并发实测编号唯一、证据零交叉污染；500 响应不再泄漏 Prisma 原始栈
- **P1 浏览器重采样跨档**：同一段音频以 44.1/48kHz 容器提供时判决从「深伪检出」掉到「疑似合成」→ 重写为 Kaiser 窗 sinc 抗混叠重采样 + 16kHz AudioContext 单次重采样，跨采样率判决分差 ≤0.003（旧实现实测掉 0.05+ 跨档）
- **P1 README Q4**：「删库自动重建」为失实指引 → 改为「请勿删除 custom.db，损坏时从发行包恢复」（本包确实不自动重建）
- **P2 原始来源落盘**：文件检测的原始音频（≤12MiB）随证保留，核验页「原始来源文件」从恒跳过变为真实可执行；来源哈希改服务端自算，不信任客户端声明值
- **P2 存证包真·离线导出**：任一案例一键导出 ZIP（证据音频 + 原始来源 + 案例全量记录 + 核验报告 + SHA-256 清单），解包后 `sha256sum -c SHA256SUMS.txt` 可独立校验 —— 旧版此能力仅为浏览器打印，README 宣称与实际不符
- **P3 预置音频去重**：7 音色预置样本不再与演示诈骗样本重复；「四级合成通道」文案按云端开关如实显示
- 附带：请求体 16MiB 早期上限（413）；VC++ 三 DLL 增放包根与 Prisma 引擎目录

### 判决分数诚实化说明
旧管线非 16k 音频的降采样存在混叠，混叠噪声把合成样本分数推高约 0.05（如彤彤演示样本 0.759 → 干净值 0.712，仍为 HIGH）。修复后**同一音频以任意采样率容器提供判决一致**（这正是本次修复要的性质）；预置挑战音色 tongtong 更换独立文本样本后为 CRITICAL 0.789。检测引擎与校准（v1.3.5-calibrated）对 16k 输入逐位不变。

### 交付与验证
- 纯离线便携包 74.3MB / 1943 文件（Win10/11 解压即用，**无需安装任何运行库**）
- 断网 netns 实测（对解压后交付 zip · 仅 lo 接口）：v1.3.5 基线回归 8/8 + v1.3.9 专项回归 6/6 全绿（含自检第 4 项「发行包内组件」、合成挑战 mode=live、并发零污染、存证包自洽、413 早期闸）
- 出厂案例库 5 件：真人×2（LOW）+ 神经合成×2（HIGH）+ **本地引擎现场合成×1（live 模式入库）**
- SHA-256: `%s`

### 升级方式
解压任意目录 → 双击 START-ShieldEar.bat → 浏览器自动打开 http://127.0.0.1:3000
（v1.3.7/v1.3.8 旧包无需任何手工修复，直接换用本包即可）""" % os.environ["SHA256"]
print(json.dumps({
    "tag_name": "v1.3.9",
    "target_commitish": "main",
    "name": "ShieldEar v1.3.9 — 应用内合成通道根因修正（Turbopack 平台折叠）+ 并发存证/重采样/存证包强化",
    "body": body,
    "draft": False,
    "prerelease": False,
}))
PY
)

probe_release_id() {  # $1: base api url (name or numeric)
  curl -s -m 30 -H "Authorization: Bearer ${TOKEN}" "$1" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id') or 'NOTFOUND')" 2>/dev/null || echo FLAKE
}

REL_ID=""
for BASE in "https://api.github.com/repos/${REPO}/releases/tags/v1.3.9" \
            "https://api.github.com/repositories/${REPO_NUM}/releases/tags/v1.3.9"; do
  GOT=$(probe_release_id "$BASE")
  case "$GOT" in
    ''|FLAKE|NOTFOUND) continue ;;
    *) REL_ID="$GOT"; break ;;
  esac
done

if [ -z "$REL_ID" ]; then
  for BASE in "https://api.github.com/repos/${REPO}/releases" \
              "https://api.github.com/repositories/${REPO_NUM}/releases"; do
    REL_ID=$(curl -s -m 60 -X POST \
      -H "Authorization: Bearer ${TOKEN}" \
      -H "Content-Type: application/json" \
      -d "$RELEASE_JSON" \
      "$BASE" \
      | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id') or ('ERR:'+str(d.get('message'))[:200]))")
    case "$REL_ID" in
      ERR:*) echo "  路由 $BASE 失败：$REL_ID"; REL_ID="" ;;
      *) echo "✓ Release 创建成功（id=$REL_ID，经由 $BASE）"; break ;;
    esac
  done
else
  echo "Release 已存在（id=$REL_ID），复用"
fi
[ -n "$REL_ID" ] || { echo "✗ Release 创建失败（双路由）"; exit 1; }

echo "── [4/4] 上传便携包资产（$(du -h "$ZIP" | cut -f1)，双路由 × 重试）──"
for attempt in 1 2 3 4 5; do
  for UPBASE in "https://uploads.github.com/repos/${REPO}/releases/${REL_ID}/assets" \
                "https://uploads.github.com/repositories/${REPO_NUM}/releases/${REL_ID}/assets"; do
    UP=$(curl -s -m 1800 -X POST \
      -H "Authorization: Bearer ${TOKEN}" \
      -H "Content-Type: application/zip" \
      --data-binary "@$ZIP" \
      "${UPBASE}?name=ShieldEar-v1.3.9-portable.zip" \
      | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('browser_download_url') or ('ERR:'+str(d.get('message'))[:200]))")
    case "$UP" in
      https*) echo "✓ 资产上传成功：$UP"; exit 0 ;;
      *) echo "  第 ${attempt} 次 @ ${UPBASE##*com} 未确认（$UP）" ;;
    esac
  done
  sleep 5
done
echo "✗ 资产上传未确认，请手动检查 Release 页"
exit 1

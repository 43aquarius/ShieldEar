#!/usr/bin/env bash
# ============================================================
# build-portable.sh — v1.3.5 纯离线便携包组装（完整流水线）
# 前置：npm run build:offline 已完成；/tmp/{node.exe, msi-out} 就位
# 产物：/tmp/package-build/ShieldEar/（Windows 交付目录）
#
# v1.3.5 变更：
#   · 纯离线发行锁（SHIELD_RELEASE_OFFLINE）随 boot.js 注入；
#   · boot.js 启动自检：Prisma 引擎/数据库/校准数据缺失时
#     打印明确提示并退出，杜绝"带病启动 → 页面 500"；
#   · 组装前后双重 fail-fast 校验（引擎文件必须进包）；
#   · 数据库必须含种子案例（空库直接报错，防"案例库空白"）。
#
# v1.3.8 变更（根因修正热修复）：
#   · espeak-ng DLL 双文件名随包（libespeak-ng.dll 连字符 +
#     libespeak_ng.dll 下划线）——v1.3.7 及之前只放下划线名，
#     而 exe 导入表要求连字符名 → 全平台 0xC0000135（真机实测坐实，
#     v1.3.7 曾误诊为 VC++ 运行库缺失）；
#   · boot.js / local-tts.ts / windows-smoke.cmd 三层运行时自愈；
#   · 新增 PE 导入表硬闸（verify-package-imports.py）：包内任何
#     二进制引用的每个 DLL 必须按名可解析，否则拒绝打包；
#   · windows-smoke.cmd 随包分发（真机 10 秒冒烟，构建机为 Linux
#     无法执行 PE，以「导入表硬闸 + 随包冒烟脚本」组合替代）。
#
# v1.3.9 变更（Turbopack 平台折叠根因修复 + 存证强化）：
#   · 根因：Turbopack 服务端打包把 process.platform === "win32"
#     按构建机（Linux）折叠为 false 并 DCE 裁掉 win32 分支
#     → 产物中 espeak-ng.exe 候选名退化为裸名 → 合成挑战
#     恒走预置回放（v1.3.1 起全部 Windows 包中招，与
#     v1.3.7 真机 4/5 红项同源）；
#   · 修复：local-tts.ts 候选探测平台无关化（espeak-ng.exe /
#     espeak-ng 按名探测）+ boot.js 全局注入 ESPEAK_DATA_PATH；
#   · 新增打包硬闸 verify-bundled-platform.py：产物 chunk 必须
#     含 "espeak-ng.exe" 字面量（被折叠即消失），缺失拒绝打包；
#   · VC++ 三 DLL 增至包根与 .prisma/client/（Prisma 引擎 DLL
#     依赖 msvcp140 等，未装运行库的机器上 app-local 就位）。
#
# v1.3.11 变更（合成挑战功能整体移除，专注识别分析）：
#   · 便携包不再携带任何本地合成组件（espeak-ng.exe / DLL / 全量声库，
#     共约 27MB）；相应地 boot.js 移除 ESPEAK_DATA_PATH 注入与合成组件
#     自检，windows-smoke.cmd 不再随包；
#   · VC++ 2015-2022 三 DLL 仍随包（Prisma query_engine-windows.dll.node
#     依赖 msvcp140 等，与合成组件无关），改为直接落包根与 .prisma/client；
#   · verify-bundled-platform.py 收敛为「平台比较残留」单项硬闸
#     （espeak/ffmpeg 字面量闸随探测代码一并移除）。
#
# 注意：最终包只含 Windows Prisma 引擎；Linux 断网测试由
#       test-offline-portable.sh 临时补 debian 引擎后自行清理
# ============================================================
set -euo pipefail

PROJ="${SRC:-/home/z/my-project}"   # 源仓库（可指向融合克隆，如 /tmp/fuse）
STAGE=/tmp/package-build/ShieldEar
rm -rf /tmp/package-build
mkdir -p "$STAGE"

echo "── [0/8] fail-fast：构建机前置校验 ──"
# v1.3.9 硬闸：平台折叠检查（产物必须含 espeak-ng.exe 字面量，
# 被 Turbopack 折叠掉即拒绝继续 —— 这是 v1.3.8 发布后真机审计坐实的根因）
if ! python3 "$PROJ/scripts/verify-bundled-platform.py" "$PROJ/.next/standalone"; then
  echo "✗ 平台折叠硬闸未通过 —— 拒绝组装（请先修复源码后重新构建）"
  exit 1
fi
# 构建机必须已生成 Prisma 客户端（含 Windows 引擎），否则 standalone 里没有引擎
if ! ls "$PROJ/node_modules/.prisma/client/"query_engine-windows.dll.node >/dev/null 2>&1; then
  echo "✗ 构建机缺少 Windows Prisma 引擎（node_modules/.prisma/client/query_engine-windows.dll.node）"
  echo "  请先执行: npm run db:generate （prisma schema 已配置 windows binaryTarget）"
  exit 1
fi
echo "✓ Windows Prisma 引擎就绪"

echo "── [1/8] 复制 standalone 服务端（排除沙箱杂物） ──"
cd "$PROJ/.next/standalone"
mkdir -p "$STAGE/server"
rsync -a --exclude 'skills' --exclude 'repo-stage' --exclude 'download' \
  --exclude 'upload' --exclude 'tool-results' --exclude 'tests' --exclude 'scripts' \
  --exclude 'Caddyfile' --exclude 'dev.log' --exclude 'bun.lock' \
  --exclude 'eslint.config.mjs' --exclude 'tailwind.config.ts' \
  --exclude 'tsconfig.json' --exclude 'postcss.config.mjs' \
  --exclude 'components.json' --exclude 'src' --exclude 'package-lock.json' \
  --exclude '.env' --exclude '.env.*' --exclude 'docs' \
  ./ "$STAGE/server/"

echo "── [2/8] 精简 node_modules（Windows 交付） ──"
cd "$STAGE/server/node_modules"
rm -rf typescript @img sharp 2>/dev/null || true
cd "$STAGE/server/node_modules/.prisma/client"
rm -f libquery_engine-darwin-arm64.dylib.node \
      libquery_engine-debian-openssl-3.0.x.so.node \
      libquery_engine-linux-openssl-3.0.x.so.node 2>/dev/null || true
find "$STAGE/server/node_modules/@prisma/engines" -name "*.node" ! -name "*windows*" -delete 2>/dev/null || true
# Prisma WASM：仅保留 sqlite
cd "$STAGE/server/node_modules/@prisma/client/runtime"
rm -f query_engine_bg.postgresql* query_engine_bg.cockroachdb* \
      query_engine_bg.sqlserver* query_engine_bg.mysql* \
      query_compiler_bg.postgresql* query_compiler_bg.cockroachdb* \
      query_compiler_bg.sqlserver* query_compiler_bg.mysql* 2>/dev/null || true

echo "── [2b/8] 解引用全部软链（Windows 交付零软链 · v1.3.6 关键修复） ──"
# Next.js 16 Turbopack 会把 serverExternalPackages 默认清单里的包（如 @prisma/client）
# 外部化为 <包名>-<内容哈希> 形态（如 @prisma/client-2c3a283f134fdcb6）：实体包在顶层
# node_modules，而 .next/node_modules/ 下只放一个【目录软链】指回实体包。
# 构建机上软链可解析（离线自检/回归全绿），但 zip 的 os.walk 会【静默丢弃目录软链】，
# Windows 解压后 require 哈希名失败 → 所有走数据库的 API 500（v1.3.5 线上事故根因）。
# 此步把全部软链替换为实体拷贝，确保「包内内容 = 构建机验证过的内容」。
# 注意：必须在 [2/8] 精简之后执行，让拷贝继承精简后的体积。
SLINK_N=0
while IFS= read -r -d '' lnk; do
  tgt=$(readlink -f "$lnk" 2>/dev/null) || { echo "✗ 断链: $lnk"; exit 1; }
  if [ ! -e "$tgt" ]; then echo "✗ 软链目标缺失: $lnk → $tgt"; exit 1; fi
  rm -f "$lnk"
  cp -a "$tgt" "$lnk"
  echo "  · 已解引用: ${lnk#"$STAGE"/}"
  SLINK_N=$((SLINK_N + 1))
done < <(find "$STAGE" -type l -print0)
echo "✓ 软链解引用完成（共 $SLINK_N 个；0 亦正常）"

echo "── [3/8] 精简校准音频（引擎用编译进 JS 的常量，96MB 音频仅开发期使用） ──"
rm -rf "$STAGE/server/calibration/audio" \
       "$STAGE/server/calibration/testsuite_results.json" \
       "$STAGE/server/calibration/results.json"

echo "── [4/8] 启动包装器 boot.js（自检 + 纯离线发行锁 + DATABASE_URL 绝对化） ──"
cat > "$STAGE/server/boot.js" << 'BOOTEOF'
/**
 * boot.js — 声盾便携包启动包装器（v1.3.5；v1.3.11 移除合成通道）
 * 职责：
 *   1. 纯离线发行锁：SHIELD_RELEASE_OFFLINE=1（本包检测/存证/核验
 *      全程本地，不含任何联网路径）；
 *   2. 启动自检：实际加载 Prisma 引擎 + 数据库连通 + 校准数据，
 *      任何一项失败都打印明确提示并写 STARTUP-ERROR.txt 后退出 ——
 *      杜绝"带病启动 → 页面 Internal Server Error"；
 *   3. 把相对形态的 DATABASE_URL 转为基于本目录的绝对路径；
 *   4. 固定 cwd 到本目录，保证相对路径组件的定位；
 *   5. 加载 Next.js standalone 服务端。
 */
const path = require("path");
const fs = require("fs");
process.chdir(__dirname);

// ── 1. 纯离线发行锁 ──
process.env.SHIELD_RELEASE_OFFLINE = "1";

// ── 2. DATABASE_URL 相对→绝对（自检的 Prisma 探针需要正确路径） ──
let url = process.env.DATABASE_URL || "file:./db/custom.db";
if (url.startsWith("file:")) {
  const p = url.slice(5);
  if (!path.isAbsolute(p)) {
    process.env.DATABASE_URL = "file:" + path.resolve(__dirname, p);
  }
}

// ── 3. 启动自检 ──
function startupFail(items) {
  const line = "=".repeat(60);
  const msg =
    "\n" + line +
    "\n  [ShieldEar] STARTUP CHECK FAILED - 启动自检未通过\n" + line + "\n\n" +
    items.map((s) => "  ✗ " + s).join("\n") +
    "\n\n  处理建议：\n" +
    "  · 重新解压完整发行包（可能解压不完整或文件被杀毒软件误删，请将本文件夹加入杀毒白名单）\n" +
    "  · 若数据引擎（Prisma）加载失败：本包已随附所需 DLL（msvcp140 等，\n" +
    "    v1.3.9 起包内两处就位）；如仍失败，多为解压不完整或杀毒误删 ——\n" +
    "    请重新解压完整包\n" +
    "  · 数据库（server/db/custom.db）不会自动重建：若缺失或损坏，请从\n" +
    "    发行包重新解压恢复，勿手动删除该文件\n" +
    "  · 从 GitHub Releases 重新下载：https://github.com/43aquarius/ShieldEar\n" +
    "  · 本提示已写入 STARTUP-ERROR.txt（位于本文件夹根目录）\n" + line + "\n";
  console.error(msg);
  try {
    fs.writeFileSync(path.join(__dirname, "..", "STARTUP-ERROR.txt"), msg.trim() + "\n");
  } catch {}
  process.exit(1);
}

async function main() {
  const problems = [];

  // 3a. Prisma 查询引擎：文件存在性（平台对应的引擎文件）
  const prismaClientDir = path.join(__dirname, "node_modules", ".prisma", "client");
  const engineExpect = {
    win32: [/^query_engine-windows\.dll\.node$/],
    linux: [/^libquery_engine-.*\.so\.node$/, /^query_engine-.*\.so\.node$/],
    darwin: [/^libquery_engine-darwin.*\.dylib\.node$/, /^query_engine-darwin.*\.node$/],
  };
  let hasEngineFile = false;
  try {
    const files = fs.readdirSync(prismaClientDir);
    const pats = engineExpect[process.platform] || [];
    hasEngineFile = files.some((f) => pats.some((p) => p.test(f)));
  } catch {}
  if (!hasEngineFile) {
    problems.push(
      "Prisma 查询引擎文件缺失（node_modules/.prisma/client，" +
        (process.platform === "win32" ? "query_engine-windows.dll.node" : "当前平台引擎") +
        "）— 案例库/存证功能将不可用（常见原因：解压不完整或杀毒软件误删）"
    );
  }

  // 3b. 数据引擎实际加载（关键：能发现 VC++ 运行库缺失、DLL 损坏等文件检查发现不了的问题）
  if (hasEngineFile) {
    try {
      const { PrismaClient } = require("@prisma/client");
      const probe = new PrismaClient();
      await probe.$queryRaw`SELECT COUNT(*) FROM DetectionCase`;
      await probe.$disconnect();
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      const hint = /dll|DLL|module|动态链接|找不到指定的模块|was not found/i.test(msg)
        ? "（疑似包内 VC++ 运行库 DLL 缺失：请重新解压完整发行包；本包已随附所需 DLL，无需另装运行库）"
        : "";
      problems.push("数据引擎加载失败：" + msg.slice(0, 300) + hint);
    }
  }

  // 3c. 数据库文件
  const dbFile = path.join(__dirname, "db", "custom.db");
  if (!fs.existsSync(dbFile) || fs.statSync(dbFile).size < 4096) {
    problems.push(
      "案例数据库缺失或损坏（server/db/custom.db）— 本包不自动重建数据库：" +
        "请从发行包重新解压恢复该文件（请勿手动删除 custom.db）"
    );
  }

  // 3d. 引擎校准数据
  const calibFile = path.join(__dirname, "calibration", "features.json");
  if (!fs.existsSync(calibFile)) {
    problems.push("检测引擎校准数据缺失（server/calibration/features.json）— 检测功能将不可用");
  }

  if (problems.length > 0) startupFail(problems);

  // ── 4. 加载 Next.js standalone 服务端 ──
  require("./server.js");
}

main().catch((e) => {
  startupFail(["服务启动异常：" + String(e && e.message ? e.message : e).slice(0, 300)]);
});
BOOTEOF
rm -f "$STAGE/server/wrap-server.js"

echo "── [5/8] 数据库与运行时数据（以源仓库为权威，无条件覆盖） ──"
mkdir -p "$STAGE/server/db" "$STAGE/server/evidence" "$STAGE/server/calibration"
# db 无条件取源仓库（standalone 里可能残留构建期旧库，不可作为发行数据）
cp "$PROJ/db/custom.db" "$STAGE/server/db/custom.db"
[ -f "$STAGE/server/db/custom.db" ] || { echo "✗ 源仓库 db/custom.db 缺失"; exit 1; }
[ -f "$PROJ/calibration/features.json" ] || { echo "✗ calibration/features.json 缺失"; exit 1; }
cp "$PROJ/calibration/features.json" "$STAGE/server/calibration/features.json"
# 证据目录：清空后以源仓库为权威（保证与 db 记录一一对应，无孤儿文件）
rm -rf "$STAGE/server/evidence"
mkdir -p "$STAGE/server/evidence"
if [ -d "$PROJ/evidence" ]; then
  cp "$PROJ"/evidence/*.wav "$STAGE/server/evidence/" 2>/dev/null || true
  cp "$PROJ"/evidence/*.bin "$STAGE/server/evidence/" 2>/dev/null || true
fi
EV_COUNT=$(ls "$STAGE/server/evidence"/*.wav 2>/dev/null | wc -l)
SRC_COUNT=$(ls "$STAGE/server/evidence"/*.bin 2>/dev/null | wc -l)
echo "✓ 证据音频 $EV_COUNT 份 + 原始来源 $SRC_COUNT 份（与种子案例一一对应）"

# v1.3.5：空库防线 — 发行包的案例库必须带种子演示数据
SEED_COUNT=$(python3 - "$STAGE/server/db/custom.db" << 'PYEOF'
import sqlite3, sys
try:
    con = sqlite3.connect(sys.argv[1])
    n = con.execute("SELECT COUNT(*) FROM DetectionCase").fetchone()[0]
    con.close()
    print(n)
except Exception:
    print(-1)
PYEOF
)
if [ "$SEED_COUNT" -lt 1 ] 2>/dev/null; then
  echo "✗ 数据库为空库（0 条案例）：请先在源仓库 seed 演示数据（scripts/seed-demo-cases.py）再打包"
  exit 1
fi
echo "✓ 案例库含 $SEED_COUNT 条种子案例"

echo "── [6/8] VC++ 运行库三 DLL（Prisma 引擎依赖 · v1.3.11 起唯一消费者）──"
# v1.3.7 引入（espeak-ng 需要）；v1.3.9 扩展（Prisma 引擎也需要）；
# v1.3.11 合成组件移除后，Prisma query_engine-windows.dll.node 成为唯一消费者。
# 放包根（node.exe 同目录，DLL 搜索首选路径）与 .prisma/client/
# （引擎加载目录）—— 未装 VC++ 运行库的机器上也能正常加载（app-local 就位）。
# UCRT（api-ms-win-crt-*）Win10+ 系统内置，无需随包。
mkdir -p "$STAGE/server/node_modules/.prisma/client"
for vc in msvcp140.dll vcruntime140.dll vcruntime140_1.dll; do
  src="$PROJ/scripts/package-files/vcredist/$vc"
  [ -f "$src" ] || { echo "✗ VC++ 运行库 DLL 缺失：$src（仓库不完整）"; exit 1; }
  cp "$src" "$STAGE/$vc"
  cp "$src" "$STAGE/server/node_modules/.prisma/client/$vc"
done
VC_SIZE=$(du -cb "$PROJ/scripts/package-files/vcredist/"{msvcp140,vcruntime140,vcruntime140_1}.dll | tail -1 | cut -f1)
echo "✓ VC++ 运行库三 DLL 就位（$((VC_SIZE/1024))KB × 包根 + .prisma/client 两处；合成组件已随 v1.3.11 移除，包体约 -27MB）"

echo "── [7/8] Node 运行时与启动脚本 ──"
cp /tmp/node.exe "$STAGE/node.exe"
cp "$PROJ/scripts/package-files/START-ShieldEar.bat" "$STAGE/"
cp "$PROJ/scripts/package-files/README.txt" "$STAGE/README.txt"

echo "── [8/8] 组装后校验与体积统计 ──"
# fail-fast：Windows 引擎必须真的在包里（防构建机状态异常导致静默缺失）
if ! ls "$STAGE/server/node_modules/.prisma/client/"query_engine-windows.dll.node >/dev/null 2>&1; then
  echo "✗ 校验失败：包内缺少 server/node_modules/.prisma/client/query_engine-windows.dll.node"
  exit 1
fi
if [ ! -f "$STAGE/server/boot.js" ]; then
  echo "✗ 校验失败：boot.js 未生成"
  exit 1
fi

# v1.3.6 fail-fast：chunk 引用的所有外部依赖必须能从包内真实解析。
# （防患于未然：即使解引用步骤失效，只要 Turbopack 外部化的任何一个包名
#   在包内找不到，此处直接终止构建，绝不带病打包。）
if ! (cd "$STAGE/server" && node -e '
const fs = require("fs"), path = require("path"), { createRequire } = require("module");
const chunksDir = path.resolve(".next/server/chunks");
const rq = createRequire(path.join(chunksDir, "_.js"));
const names = new Set();
for (const f of fs.readdirSync(chunksDir)) {
  if (!f.endsWith(".js")) continue;
  const s = fs.readFileSync(path.join(chunksDir, f), "utf8");
  for (const m of s.matchAll(/e\.x\("([^"]+)",\s*\(\)\s*=>\s*require\("([^"]+)"\)/g)) names.add(m[2]);
  for (const m of s.matchAll(/__turbopack_external_require__\("([^"]+)"\)/g)) names.add(m[1]);
}
const bad = [...names].filter((n) => { try { rq.resolve(n); return false; } catch { return true; } });
if (bad.length) { console.error("✗ 以下外部依赖无法从包内解析: " + bad.join(", ")); process.exit(1); }
console.log("✓ 外部依赖解析校验通过（" + names.size + " 个）");
'); then
  echo "✗ 外部依赖完整性校验失败（详见上方）"
  exit 1
fi

# v1.3.8 硬闸：PE 导入表完整性 —— 包内每个 .exe/.dll/.node 引用的每个 DLL
# 必须同目录按名存在（app-local）或属系统白名单，缺一即拒打包。
# v1.3.7 事故（espeak-ng.exe 要连字符 libespeak-ng.dll、包内只有下划线名
# → 全平台 0xC0000135）当时若有此闸即被拦截。构建机为 Linux 无法执行 PE，
# 此闸是「打包期静态等效」的 Windows 冒烟。
# v1.3.9 硬闸：对最终包再跑一次平台折叠检查（双保险）
if ! python3 "$PROJ/scripts/verify-bundled-platform.py" "$STAGE/server"; then
  echo "✗ 最终包平台折叠硬闸未通过 —— 拒绝打包"
  exit 1
fi

if ! python3 "$PROJ/scripts/verify-package-imports.py" "$STAGE"; then
  echo "✗ PE 导入表完整性校验失败（详见上方）—— 拒绝带病打包"
  exit 1
fi

echo "✓ Windows 引擎 / boot.js / 数据库 / 校准数据 / 外部依赖 / VC++ 运行库 全部就位"
du -sh "$STAGE"/* | sort -rh
echo "── 总计 ──"
du -sh "$STAGE"
echo "✓ 组装完成：$STAGE"

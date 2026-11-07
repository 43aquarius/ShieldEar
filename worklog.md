
---

## Task 10 · v1.3.3 融合版（2026-10-31）

背景：v1.3.2 由两条线并行实现（沙箱线的运行时开关版 + 官方线的环境变量门控版），
v1.3.3 将两者融合为最终参赛交付。

### 融合要点
- 环境约定统一：`SHIELD_TTS_ONLINE=1` → 云端四级链；未设置 → 纯离线（便携包默认，零联网零尝试零等待）
- 运行时开关（新增）：`GET/POST /api/config/cloud` 界面即时切换，无需重启；
  globalThis 单例跨路由共享；重启回落环境默认（离线交付安全默认不变）
- `src/lib/server/cloud-config.ts`：唯一配置源，`isCloudEnabled/isOfflineMode/setCloudEnabled`
- tts-challenge：保留 v1.3.2 的 GET 模式端点（改读 cloud-config，反映运行时状态）；
  POST 响应新增 cloudEnabled 字段
- challenge-panel：云端通道 Switch 开关（乐观更新+toast+说明联动）
- db.ts：生产模式 Prisma 仅记录 error（便携包无 SQL 刷屏）
- 便携包关键修复（相对 v1.3.2 官方包）：
  1. tracing 复制的 server/.env 内嵌构建机绝对路径 → 打包排除 + 启动脚本注入
  2. Prisma SQLite 相对路径按生成时 schema 目录解析 → server/boot.js 动态转绝对路径
  3. 启动脚本纯 ASCII（START-ShieldEar.bat）规避旧版 cmd 的 UTF-8 解析与解压乱码风险
- 体积：433MB → 182MB（删多平台二进制/非 SQLite WASM/开发期校准音频/typescript），
  zip 81MB（v1.3.2 官方包 285.9MB，缩小 72%）
- dev 自愈：scripts/selfheal.sh + predev 钩子（沙箱快照恢复后自动补 Prisma 引擎，
  根治 "Unexpected token 'l', internal s..." 全站 500）

### 断网铁证（scripts/test-offline-portable.sh）
unshare -rn 无外网接口命名空间中：合成挑战(espeak)/实时鉴听/文件检测/案例库/
存证包/云端开关 6/6 全绿，物理断网环境零外连请求。

---

## Task 11 · v1.3.4 判决剧场（2026-11-02 · 发布线）

- 判决剧场升级：环形置信度仪表 + 判决印章砸落 + 时频取证视图 + 真伪 A/B 对比试听（实测真人 20.2% vs 合成 72.5%）
- 便携包 62.1MB；断网回归 6/6 全绿；Release 附 SHA-256
- 本线提交一度因沙箱环境重置与本地开发线分叉，v1.3.5 发布时合并恢复（见 Task 12）

## Task 12 · v1.3.5 纯离线发行版（2026-11-05）

**修复（用户实测反馈）**
- 合成挑战/案例库报 `Unexpected token 'I', Internal Server Error`：根因是运行环境 Prisma 引擎缺失时，前端对纯文本 500 响应直接 `.json()`。三层修复：`fetchJson` 全站兜底（错误信息人话化）；启动自检 `boot.js`（引擎探针/数据库连通/校准数据/espeak 组件，任一失败写 `STARTUP-ERROR.txt` 并拒绝带病启动）；打包管线三重防线（构建机引擎校验 + 包内校验 + 空库防线）
- 案例库空库：发行包数据库一律以源仓库为权威数据，种子案例与证据 WAV 逐条 SHA-256 校验后入库

**新特性**
- 证据完整性核验：服务端重读证据 WAV、重算 SHA-256 与入库值逐项比对，绿色 INTEGRITY VERIFIED 印章（实测篡改 1 字节立即检出）
- 系统自检页（导航第 4 页）：数据引擎/证据目录/引擎校准/本地合成引擎/离线声明逐项体检，全绿横幅
- 纯离线发行锁：云端合成通道从发行包整体移除——界面无开关（编译期徽章化）、切换接口 403 锁死、零联网路径

**验证与交付**
- 断网实测（unshare 仅 lo）8/8 全绿；便携包 64.7MB / 1891 文件；SHA-256 `961b2e09…1c7`
- 仓库卫生：剔除误入库的沙箱环境目录（skills/ 等 54.4MB）与 espeak.msi 404 错误桩，补 .gitignore
- 历史修复：本地开发线与 v1.3.4 发布线（fde5b7d）因环境重置分叉，发布前 merge 合并恢复

## Task 13 · v1.3.6 热修复：Windows 便携包启动失败（2026-11-05）

**事故（用户实测反馈）**
- v1.3.5 便携包在 Windows 启动后所有走库 API 500：`Cannot find module '@prisma/client-2c3a283f134fdcb6'`
- 根因：Next.js 16 Turbopack 把 serverExternalPackages（@prisma/client）外部化为
  `<包名>-<内容哈希>` 名：实体包在顶层 node_modules，`.next/node_modules/` 下仅一个
  【目录软链】指回。构建机上软链可解析（离线回归全绿），但 make-portable-zip 的
  os.walk 会静默丢弃目录软链 → Windows 解压后模块解析失败
- 复盘：v1.3.5 的断网实测跑在 stage 目录而非解压后的 zip 上——「测的不是交付物」

**修复（三重防线）**
- build-portable.sh [2b/8]：组装期把全部软链解引用为实体拷贝（继承精简后体积）
- build-portable.sh [8/8]：fail-fast 扫描 chunks 的全部外部依赖名逐一 require.resolve
  实测解析（本次 18 个全过，缺任何一个直接终止构建）
- make-portable-zip.py：交付树含软链即拒绝打包；test-offline-portable.sh 改为
  「解压交付 zip → 补 Linux 引擎 → unshare -rn 断网回归」+ 哈希外部依赖实体目录断言

**组件抢救与数据重建（沙箱重置后）**
- /tmp/node.exe 与 espeak 组件丢失：以 zip Range 分段下载（parallel_fetch 12 线程 +
  zip-range-plan/zip-extract-prefix 中央目录索引提取）从 v1.3.5 Release 资产原样取回
  node.exe（v20.18.1 官方）与 espeak-ng 全套 443 文件，零版本漂移
- prisma generate 需 `--no-network-family-autoselection`（Node 24 undici 在本沙箱的
  happy-eyeballs 缺陷，fetch 全挂而 curl 正常）
- 种子数据重播：4 案例（真人 LOW×2 / 合成 CRITICAL+HIGH）+ 证据 WAV SHA-256 锚定复核

**验证与交付**
- 解压后交付物断网实测 8/8 全绿（合成挑战/鉴听/文件检测/案例库/存证包/云端锁403/
  自检5绿/证据核验）+ UI 冒烟（标题/静态资源/案例 API）
- 便携包 69.8MB / 1917 文件 · SHA-256 `3d47b336fdd1756e18ffd02c1d21f3f48e9efe1f09771b1a6ca79659c2b08c1d`
- 遗留：calibration/audio 49 个 WAV 有未提交改动（疑似上一会话重新生成，与本版
  交付无关，未随本版提交）

**发布**
- v1.3.6 Release：https://github.com/43aquarius/ShieldEar/releases/tag/v1.3.6（资产 15s 传完）
- v1.3.5 Release 说明已加修复指引横幅
- 辅助：gh-connect-proxy.py（github.com 主站 DNS 路由损坏时经可用边缘 IP 的
  CONNECT 代理推送）、patch-v135-release.py（旧版说明补横幅）

## Task 14 · v1.3.7 热修复：espeak-ng VC++ 运行库缺失 + 移除 A/B 对比（2026-11-06）

**事故（用户实测反馈）**
- v1.3.6 便携包在用户 Windows 上：系统自检提示「[api/tts-challenge] Tier3(espeak) 失败:
  未找到可用的 espeak-ng（包内组件缺失且系统 PATH 无 espeak-ng）」
- **根因确诊（PE 导入表分析）**：包内 espeak-ng.exe(27KB) / libespeak_ng.dll(477KB) 为
  MSVC 构建，导入 VCRUNTIME140 / VCRUNTIME140_1 / MSVCP140；用户机器未装 VC++ 2015-2022
  x64 运行库 → 进程 0xC0000135 拒绝启动 → 逐候选探测全败。旧报错文案「包内组件缺失」
  严重误导（文件其实都在，是系统运行库缺失）。Prisma Windows 引擎为 Rust 静态链接构建
  （仅依赖系统 DLL），故数据引擎在同一台机器上正常——两个组件行为差异由此解释。
- 诊断方法：zip Range 分段下载 v1.3.6 Release 资产的中央目录（fetch-zip-members/
  list-zip-entries 改 curl 版）→ 提取 exe/dll → 纯 Python 解析 PE 导入表

**修复**
- **VC++ 三 DLL app-local 随包分发**：微软官方 VCLibs.x64 appx（aka.ms 直链，本质 zip）
  提取 msvcp140(563KB) / vcruntime140(109KB) / vcruntime140_1(39KB)，存档
  scripts/package-files/vcredist/（保构建可复现），打包进 espeak-ng/ 目录；
  **导出表全量核对**：两个 espeak 二进制导入的每个函数均在随包 DLL 导出表中命中
  （系统 DLL + UCRT 由 Win10+ 内置覆盖）→ 任何 Win10/11 解压即用，免装运行库
- **诊断增强**：resolveEspeak 探测失败如实携带逐候选原因；退出码翻译人话
  （0xC0000135=DLL 缺失/杀毒误删、0xC0000139=入口点、0xC0000005=违例），缓存复用
- **启动韧性**：boot.js 的 espeak 组件检查从致命退出降级为警告继续（有 Tier4 预置
  样本兜底，杀毒误删单一组件不再导致整包不可用）；VC DLL 一并纳入缺失检查清单
- **移除「真伪 A/B 对比试听」**（用户要求）：删 ab-compare.tsx + shield-app.tsx 引用；
  样本 WAV 保留（文件检测预置与种子案例共用）；gen-demo-handbook.js 删第 4 幕并重排
  五幕、速查卡/应急预案/附录同步去 A/B 化（截图随沙箱重置丢失，手册文档待重截图后再生）

**沙箱重置恢复（第三次）**
- /tmp 全失（node.exe / msi-out / package-build）：写 recover-build-assets.py ——
  解析 zip 中央目录 → 444 目标成员（node.exe + espeak 全套）恰好连续 [3142, 39514406)
  → 16 路 curl 并行分段下载 37.7MB（143s）→ 逐成员 CRC32 校验提取，零版本漂移
- VC_redist.x64.exe 的 WiX Burn 容器手工解析未走通（cFolders=0 流式 CAB 头 + 无 7z/
  msitools/root），改走 VCLibs appx 官方渠道（zip 直开），更简更稳
- 种子数据重播（第二次）：seed-and-stop.sh 单命令内起 dev → 播 4 案例 → 关服务
  （后台进程跨工具调用会被收割）；实测真人 LOW 25.4%/15.6% · 合成 CRITICAL 76.0%/HIGH 67.8%

**验证与交付**
- npm run build:offline → build-portable.sh（软链解引用 1 个 + 外部依赖 18 个全过 +
  VC DLL 695KB 就位）→ make-portable-zip.py
- 断网回归（解压后 zip + unshare 仅 lo）8/8 全绿：合成挑战(espeak live 0.23s)/鉴听/
  文件检测/案例库/存证包/云端锁 403/自检 5 绿/证据核验；预渲染页面 A/B 残留 0
- 便携包 70.1MB / 1921 文件 · SHA-256 b0193b68bec9090281eb36afa34f74f17ff1e0df8a15058035054bcb1382a4cd
- Linux 断网测试走系统 espeak-ng（1.52），Windows espeak.exe+VC DLL 路径以 PE 导入/
  导出表全量核对代替（沙箱无法运行 Windows 二进制）
- 发布：push-v137.sh（PAT 到位后一键：推 main/tag → Release 幂等创建 → 资产重试上传
  → v1.3.6 说明加横幅）；上一枚 PAT 已在聊天明文暴露，用户须撤销换新后执行

## Task 15 · v1.3.7 发布实录（2026-11-06 · 第四次沙箱重置后重建）

**第四次沙箱重置恢复**
- /tmp 全失（node.exe / msi-out / .next / 已建 zip）且 download/ 回退旧快照：源码与
  提交完好，交付物需整体重建
- 资产恢复走 API 资产端点签名直链（fetch-tail.py + poll-redirect.sh 双通道轮询 302，
  避开 github.com 主站抖动）→ recover-build-assets.py 16 路分段 37.7MB（195s）
  → 444 成员 CRC32 全对（node.exe v20.18.1 + espeak 全套，零版本漂移）
- prisma generate（~/.cache 引擎缓存命中，无需联网）→ seed 重播（4 案例
  25.4%/15.6%/76.0%/67.8%，与首播逐位一致 —— 引擎确定性再证）→ build:offline
  → build-portable（软链解引用 1 + 外部依赖 18 全过 + VC DLL 695KB）→ zip
- 结构对照：新包 = v1.3.6 中央目录 + 3 个 VC DLL，目录级零差异（-1 文件为
  Turbopack chunk 哈希正常波动）；A/B 残留 0；断网回归（解压后 zip + unshare
  仅 lo）8/8 全绿
- **最终交付：70.0MB / 1920 文件 · SHA-256 `16bd15f7916892e301255c2ea269bd7f2e98f1e245c30b56f46ff650a8bedf05`**
  （替代沙箱重置丢失的 b0193b68… 构建，功能等价）

**GitHub 通道抖动档案（2026-11-06 实况，供后世会话参考）**
- 症状：api.github.com 对仓库级 GET（/repos /releases /tags /commits）间歇性
  假 404（好/坏窗口以分钟级交替）；/user /rate_limit 恒正常；早先的成功响应
  可能是中间层缓存，勿据单次 200/404 下结论。git 智能协议（Basic 认证）与
  Fastly CDN（release-assets.githubusercontent.com）稳定
- 判别法：缓存穿透参数 + 换认证头各试一次；git ls-remote 为 ground truth
- 应对：双通道轮询拿 302（github.com 直链 / api 资产端点）→ CDN 直链分段下载；
  push-v137.sh 全面加固（push 4 次重试、Release 探测「404×5 才判不存在」防
  双建、422 already_exists 兜底重探、上传 5 次重试、横幅 PATCH 重试）
- 新工具入库：fetch-tail.py（API 端点取签名直链 + 尾部下载）、poll-redirect.sh
  （双通道 302 轮询）、probe-gh-edges.sh（边缘 IP 探测）；recover-build-assets.py
  增 ASSET_DIRECT_URL 环境变量与直链重试

**发布**
- v1.3.7 Release：https://github.com/43aquaris/ShieldEar/releases/tag/v1.3.7
- 新 PAT（2026-11-23 过期）发布后仍建议撤销：聊天明文已暴露

## Task 16 · 答辩演示手册 v1.3.7 重制 + 沙箱第五次重置恢复（2026-11-06）

**沙箱第五次重置恢复（dev 环境）**
- db/custom.db 与 ~/.cache/prisma 引擎全失；prisma generate 的 Node fetch 在本沙箱
  无限挂起（happy-eyeballs 缺陷），selfheal.sh 卡死导致 dev 起不来
- **restore-prisma-engines.sh**：读 @prisma/fetch-engine 源码破译 URL 规则
  （`binaries.prisma.sh/all_commits/{enginesVersion}/{target}/{napi名}.gz`，注意
  channel 是下划线 all_commits），curl 下载 4 引擎 gunzip 就位到三处：
  @prisma/engines（CLI）/ node_modules/prisma（generate 校验，debug 日志实测）/
  .prisma/client（运行时）；原生引擎 require() 版本探针自验通过，generate/db push 离线全通

**手册重制（Task 14 遗留的「待重截图后再生」）**
- take-handbook-shots.sh 单命令流水线：setsid 起 dev → 播种 → agent-browser 截图 → 关服
- 踩坑三连（已写进脚本头注释）：就绪探测 `|| echo 000` 与 curl -w 的 000 拼成 000000
  假就绪；agent-browser close 无守护进程时挂死须 timeout 包裹；非交互 shell 后台任务
  与脚本同进程组须 setsid 隔离再组杀
- 4 张实拍截图（VLM 逐张验收）：首页 Hero / 判决剧场（espeak 桐桐话术确定性复现
  HIGH 56.7%，同 v1.3.4 时代数值）/ 时频取证瀑布图 / 案例库 4 条种子案例
- 滚动定位教训：querySelectorAll 文档序先命中外层容器 → 限 h3/叶子节点 + 印章居中后
  固定 scrollBy；HIGH 档印章文本是「疑似合成」非「深伪检出」（四档文本须全枚举）
- gen-demo-handbook.js 全面对齐 v1.3.7：检查清单加自检页与 70.0MB、速查卡 8/8 断网 +
  0.23s + 跨引擎 81.3% + 证据核验行、应急预案去云端开关话术、附录重写为 v1.3.7 交付
  摘要（VC++ app-local/诊断增强/启动韧性）、图注重排为 1-4 连号、判决话术改为
  「琥珀色疑似合成章」（如实反映 espeak 演示档位）
- 交付：声盾-答辩演示手册.docx（12 页，724KB）+ docs/handbook-shots/ 四图随库；
  渲染 PDF 后 VLM 抽查 7 个关键页全部通过；README 徽章/下载链接/常见问题同步 v1.3.7

## Task 17 · v1.3.8 根因修正热修复（2026-11-07 · 用户真机实测定案）

**根因确诊（用户 dsh 真机实测 + 仓库侧物证双确认）**
- v1.3.7 误诊坐实：包内 espeak-ng.exe（官方 CI 构建）PE 导入表要求
  **libespeak-ng.dll（连字符）**，而包内文件名为 libespeak_ng.dll（下划线）
  → 任何 Windows 上 0xC0000135；复制一份连字符名 + ESPEAK_DATA_PATH 即
  exit 0 且中文合成正常（434KB WAV）。VC++ 运行库三 DLL 仍是必要依赖
  （dll 导入 msvcp140/vcruntime140/vcruntime140_1），但非本故障根因
- 仓库侧漏检链复盘：verify-vc-dlls.py 第 80-83 行明知导入表要连字符名，
  却注释「包内同目录提供（已确认存在）」直接放行未按名核实；构建机 Linux
  走系统 espeak 验证，天然测不到 Windows PE —— 「导入表按名可解析」这一层
  校验当时不存在，一字之差漏网

**修复（四层防线，全部落地）**
1. 打包：espeak-ng/ 双文件名随包（libespeak-ng.dll + libespeak_ng.dll 互为拷贝）
2. 运行时三层自愈：boot.js 启动补齐别名 / local-tts.ts 探测前补齐 /
   windows-smoke.cmd 随包（10 秒冒烟：版本探测→中文合成→产物校验，
   对 v1.3.7 旧包可就地修复）
3. 打包硬闸 verify-package-imports.py：包内每个 .exe/.dll/.node 的全部被导入
   DLL（含延迟导入表）必须同目录/包根按名存在或属系统白名单，缺一即拒打包；
   正负例双验：现包全过，移除连字符名立即拦截 —— 此闸在 v1.3.7 当时即可拦住事故
4. 文案修正：0xC0000135 → 「包内 DLL 缺失或文件名不匹配」（local-tts.ts /
   boot.js / README / 包内 README.txt / 演示手册全线更新），不再误导装 VC++

**第六次 /tmp 重置恢复（含 GitHub 通道极端抖动应对）**
- /tmp 全失（node.exe/msi-out/.next）；恢复期 github.com 对**本仓库**web/api/codeload
  全边缘假 404（其他仓库 200，git 智能协议正常 —— 与 Task 15 档案一致但窗口更长）
- **零漂移替代通道（本轮关键突破）**：
  - node.exe ← nodejs.org 官方 dist v20.18.1 win-x64，SHA-256 与官方
    SHASUMS256.txt 完全一致（06c1dec1…72cf5）
  - espeak 全套 ← 上游 espeak-ng/espeak-ng 1.52.0 官方 MSI（其仓库 API 可达，
    资产端点 302 → CDN 断点续传；12,765,862 B 与 API 报告分毫不差）
- **rebuild-espeak-from-msi.py**（新工具，纯 Python 零依赖）：MSI(OLE)→最大流 CAB→
  MSZIP 解压→按系统 1.52.0 数据树重建布局。踩坑二连：
  ① 该 WiX 变体 CAB 头部 cFiles/cFolders 字段不可靠（报 44/0，实际 443 文件/1 文件夹），
    以「表区恰填满 + start 累积校验 + 解压总量对齐」三重自洽破译（文件表 @44 起，
    16 字节头 {cbFile, start 累积偏移, 保留 8}）
  ② MSZIP 块间共享 32KB 滑窗，zlib.decompress 逐块独立解压报
    「invalid distance too far back」→ decompressobj(-15, zdict=前块尾部 32KB) 续窗解决
- 自验：exe 27,136 B / dll 477,184 B 与 v1.3.7 包内记录分毫不差；exe 导入表
  实锤含连字符 libespeak-ng.dll（根因物证）；440 数据文件入树，103 个与系统
  1.52.0 同名文件逐字节相同；数据区消费至流长精确对齐

**构建与验证**
- prisma 引擎恢复（restore-prisma-engines.sh，binaries.prisma.sh 通道稳定）→
  generate → seed 重播（4 案例 syntheticRatio 25.4%/15.6%/76.0%/67.8% 与
  Task 15 逐位一致，引擎确定性三连证）→ build:offline → build-portable
  （软链解引用 1 + 外部依赖 18 + PE 硬闸 8 文件全过）→ zip
- **v1.3.8 交付：70.3MB / 1922 文件（恰 +2：连字符 DLL + windows-smoke.cmd）**
  SHA-256 `8a67d786396e7a56301d63e93cf54c18a703d3bc4dfe10619b3395f40b896faa`
- 断网 netns 回归（解压交付 zip · 仅 lo）：8/8 全绿，合成挑战 mode=live 真合成
  （HIGH 55.9%），自检 5/5，云端锁 403，证据核验 SHA-256 一致
- 演示手册 v1.3.8 重制（17 处更新：检查清单加 windows-smoke.cmd 行、附录根因
  修正、体积/SHA 更新），13 页文本验证零残留

**待办**
- push-v138.sh 就绪；等 GitHub 通道恢复 + 新 PAT 后推送发布（老提醒：撤第 2 枚 PAT）
- 真机复验：windows-smoke.cmd 应 PASS；合成挑战在 Windows 上应 mode=live
  （espeak 共振峰合成判 HIGH/琥珀章 ~56%，非 CRITICAL —— 物理边界，讲清即可）

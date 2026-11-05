
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

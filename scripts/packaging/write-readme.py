#!/usr/bin/env python3
"""运行说明.txt 生成 —— UTF-8 with BOM（Windows 记事本自动识别，杜绝乱码）"""
text = """声盾 ShieldEar —— AI 语音鉴伪反诈平台（可直接运行版）
======================================================================
版本    v1.3.1 · 2026.10（修复 v1.3.0 中文乱码与离线合成通道问题）
队伍    你们说的对 · 43aquarius、谭畅 · 大连理工大学
开源    https://github.com/43aquarius/ShieldEar
平台    Windows / Linux / macOS（Apple Silicon）全平台免安装

【一分钟上手】
1. 将本压缩包解压到任意本地目录（路径中尽量避免空格与特殊字符）；
2. Windows 双击「启动声盾-Windows.bat」（推荐，中文系统），
   或双击 START-ShieldEar.bat（英文及其他区域设置系统的兜底入口）；
   Linux/macOS 在终端执行 bash start-shield-linux-mac.sh
   （macOS 亦可直接双击 .sh 选择用终端运行）；
3. 等待数秒，浏览器将自动打开 http://127.0.0.1:3000
   （若 3000 端口被占用，程序会自动改用 3001-3009 并提示实际地址）；
4. 使用完毕后关闭启动窗口（或 Ctrl+C）即可停止服务。

【包内构成】
server/            平台服务（生产构建，含 21 件演示案件与证据 WAV 存档）
runtime/windows/   Windows 便携 Node.js 22 运行时（无需系统安装）
runtime/linux/     Linux x86_64 便携 Node.js 22 运行时
runtime/mac/       Apple Silicon (arm64) 便携 Node.js 22 运行时
espeak-ng/         离线语音合成组件（现场合成挑战的本地合成通道，Windows）
tools/             ffmpeg 转码工具（Edge 神经 TTS 通道用，Windows）

【功能与演示动线】
· 实时鉴听：允许麦克风权限后即可边说边检（无麦克风环境自动容错）；
· 文件检测：拖入 WAV/MP3 即测，或一键试用预置合成/自然对照样本；
· 现场合成挑战：输入任意文本当场合成并当场检出。合成采用四级链路：
  云端 TTS → Edge 神经 TTS（纯 Node 协议栈，联网时神经级音质）
  → espeak-ng 本地合成（完全离线仍为真实合成）→ 预置样本回放，
  自动逐级降级。联网时优先使用神经级音质；完全离线时使用包内
  espeak-ng 真实合成（Windows）/预置回放，引擎来源在界面徽标与
  存证记录中如实标注，全程双哈希存证；
· 案例库：历史案件检索、逐窗判决明细、特征剖面、证据 WAV 下载
  （含 SS-20261028-0003 等真实演示案件，可与文档记载交叉核对）；
· 核验报告：每件案件可导出八章节可打印取证报告。

【环境与安全说明】
· 全部检测计算在本机完成，不上传任何音频或检测结果；
· 数据库与证据仅写入 server/db 与 server/evidence 两个本机目录；
· 无需任何 API 密钥或外部账号即可完整体验全部功能；
· 首次启动如被杀毒软件拦截便携运行时，请将本目录加入信任列表。

常见问题
· 端口被占用：自动向后探测 3001-3009，亦可设置 PORT 环境变量指定；
· 浏览器未自动打开：按窗口提示手动访问对应地址；
· Linux/macOS 无法执行 .sh：先执行 chmod +x start-shield-linux-mac.sh；
· Intel Mac：未内置对应运行时，请安装系统 Node.js 20+ 后运行。
"""
import sys
out = sys.argv[1] if len(sys.argv) > 1 else "/home/z/my-project/package-build/ShieldEar/运行说明.txt"
with open(out, "wb") as f:
    # UTF-8 BOM + CRLF 行尾（Windows 记事本双保险识别）
    crlf = text.replace("\r\n", "\n").replace("\n", "\r\n")
    f.write(b"\xef\xbb\xbf" + crlf.encode("utf-8"))
print("运行说明.txt 已写入（UTF-8 BOM）:", out)

/**
 * 多级现场合成通道 — Edge 神经 TTS / espeak-ng 本地合成
 * ────────────────────────────────────────────────────────────
 * 背景（2026-10-28）：上游 z-ai 网关 /audio/tts 路径被前置 WAF 施加路径级
 * IP 惩罚（任何请求形态均 405，持续 17h+，应用侧无法解除）。为保证「现场
 * 合成挑战」的演示闭环始终可用，新增两条不依赖该网关的合成通道：
 *
 *   Tier 2 · Edge TTS：微软 Edge 朗读服务的公开神经语音接口（8 个中文音色），
 *            经 python3 -m edge_tts 客户端合成 MP3，ffmpeg 转 16kHz 单声道 WAV。
 *            神经 TTS 声学特性与云端商用 TTS 同类，声盾引擎可正常检出。
 *   Tier 3 · espeak-ng：系统本地共振峰合成器，完全离线、零网络依赖，
 *            质量机械但永远可用，作为最终兜底。
 *
 * 全部子进程调用使用 execFile 参数数组（不经 shell），杜绝命令注入；
 * 合成产物统一封装为 SynthResult，路由层无需感知引擎差异。
 */
import { execFile } from "child_process";
import { promisify } from "util";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import { readFile, unlink } from "fs/promises";

const execFileAsync = promisify(execFile);

/** Python 解释器候选（按优先级；须能 import edge_tts）
 *  背景：Next 服务进程的 PATH 可能解析到无 edge_tts 包的系统 Python，
 *  故按候选列表逐个验证 import，命中后进程内缓存。 */
const PYTHON_CANDIDATES = [
  "/home/z/.venv/bin/python3",
  "/usr/bin/python3",
  "python3",
];

/** 进程内缓存的可用解释器（null=尚未探测；""=无可用） */
let resolvedPython: string | null = null;

/** 探测可用的 Python 解释器（能 import edge_tts），进程内仅探测一次 */
async function resolvePython(): Promise<string> {
  if (resolvedPython !== null) {
    if (resolvedPython === "") {
      throw new Error("未找到安装了 edge-tts 包的 Python 解释器");
    }
    return resolvedPython;
  }
  for (const py of PYTHON_CANDIDATES) {
    try {
      await execFileAsync(py, ["-c", "import edge_tts"], { timeout: 15_000 });
      resolvedPython = py;
      return py;
    } catch {
      // 该解释器不可用或无 edge_tts 包：尝试下一个候选
    }
  }
  resolvedPython = "";
  throw new Error("未找到安装了 edge-tts 包的 Python 解释器");
}

/** z-ai 音色 → Edge 中文神经音色映射（性别/风格就近匹配） */
const EDGE_VOICE_MAP: Record<string, string> = {
  tongtong: "zh-CN-XiaoxiaoNeural", // 桐桐 · 温暖亲切 → 晓晓
  chuichui: "zh-CN-XiaoyiNeural", // 吹吹 · 活泼可爱 → 晓伊
  xiaochen: "zh-CN-YunyangNeural", // 小陈 · 沉稳专业 → 云扬（新闻播报）
  jam: "zh-CN-YunxiNeural", // Jam · 英音绅士 → 云希
  kazi: "zh-CN-YunjianNeural", // 卡兹 · 清晰标准 → 云健
  douji: "zh-CN-YunxiaNeural", // 豆几 · 自然流畅 → 云夏
  luodo: "zh-CN-liaoning-XiaobeiNeural", // 罗多 · 富有感染力 → 小贝（东北）
};

export interface SynthResult {
  /** 单声道 WAV（Edge=16kHz；espeak=22.05kHz，由路由统一重采样） */
  wavBuffer: Buffer;
  /** 原始合成产物（MP3 或 WAV），供证据哈希锚定 */
  originalBuffer: Buffer;
  originalMime: string;
  originalExt: string;
  engine: "edge" | "espeak";
  engineLabel: string;
}

/** speed(0.5-2) → edge-tts 的 --rate 百分比（如 +50% / -25%） */
function ratePercent(speed: number): string {
  const s = Math.min(2, Math.max(0.5, speed));
  const pct = Math.round((s - 1) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 2, delayMs = 1500): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, delayMs));
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Edge 神经 TTS 现场合成：text → MP3 → 16kHz 单声道 WAV
 * 依赖：python3 + edge-tts 包 + ffmpeg（本环境均已安装）。
 */
export async function synthesizeEdge(
  text: string,
  voice: string,
  speed = 1.0
): Promise<SynthResult> {
  const edgeVoice = EDGE_VOICE_MAP[voice] ?? "zh-CN-XiaoxiaoNeural";
  const id = randomUUID();
  const mp3Path = path.join(tmpdir(), `shield-tts-${id}.mp3`);
  const wavPath = path.join(tmpdir(), `shield-tts-${id}.wav`);
  try {
    const py = await resolvePython();
    await withRetry(() =>
      execFileAsync(
        py,
        [
          "-m", "edge_tts",
          "--voice", edgeVoice,
          `--rate=${ratePercent(speed)}`,
          "--text", text,
          "--write-media", mp3Path,
        ],
        { timeout: 45_000, maxBuffer: 16 * 1024 * 1024 }
      )
    );
    const mp3 = await readFile(mp3Path);
    if (mp3.length < 2000) {
      throw new Error(`Edge TTS 输出过短（${mp3.length} 字节）`);
    }
    // MP3 → 16kHz 单声道 PCM WAV
    await execFileAsync(
      "ffmpeg",
      ["-y", "-i", mp3Path, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wavPath],
      { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }
    );
    const wav = await readFile(wavPath);
    if (wav.subarray(0, 4).toString("ascii") !== "RIFF" || wav.length < 2000) {
      throw new Error("Edge TTS WAV 转码失败");
    }
    return {
      wavBuffer: wav,
      originalBuffer: mp3,
      originalMime: "audio/mpeg",
      originalExt: "mp3",
      engine: "edge",
      engineLabel: `Edge 神经 TTS · ${edgeVoice}`,
    };
  } finally {
    void unlink(mp3Path).catch(() => {});
    void unlink(wavPath).catch(() => {});
  }
}

/**
 * espeak-ng 本地合成（完全离线兜底）：text → 22.05kHz 单声道 WAV
 * 依赖：系统 espeak-ng（中文声库 cmn）。
 */
export async function synthesizeEspeak(
  text: string,
  voice: string,
  speed = 1.0
): Promise<SynthResult> {
  const wpm = Math.round(160 * Math.min(2, Math.max(0.5, speed)));
  const id = randomUUID();
  const wavPath = path.join(tmpdir(), `shield-espeak-${id}.wav`);
  try {
    await execFileAsync(
      "espeak-ng",
      ["-v", "cmn", "-s", String(wpm), "-w", wavPath, text],
      { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }
    );
    const wav = await readFile(wavPath);
    if (wav.subarray(0, 4).toString("ascii") !== "RIFF" || wav.length < 2000) {
      throw new Error("espeak-ng 输出异常");
    }
    return {
      wavBuffer: wav,
      originalBuffer: wav,
      originalMime: "audio/wav",
      originalExt: "wav",
      engine: "espeak",
      engineLabel: "espeak-ng 本地合成",
    };
  } finally {
    void unlink(wavPath).catch(() => {});
  }
}

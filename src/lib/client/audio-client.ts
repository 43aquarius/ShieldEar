/**
 * 声盾 — 客户端音频工具：解码、重采样、哈希、PCM 上行编码
 */
import { resampleTo16k } from "@/lib/engine/dsp";
import { floatToInt16 } from "@/lib/audio/wav";

export interface DecodedAudio {
  pcm: Float32Array; // 16kHz 单声道
  durationSec: number;
}

/** 解码任意浏览器支持的音频文件 → 16kHz 单声道 PCM */
export async function decodeFileTo16k(file: File | Blob): Promise<DecodedAudio> {
  const arrayBuffer = await file.arrayBuffer();
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  // 用临时上下文解码（挂起状态亦可解码）
  const ctx = new Ctx();
  let audioBuf: AudioBuffer;
  try {
    audioBuf = await ctx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    void ctx.close();
  }
  const chs = audioBuf.numberOfChannels;
  const len = audioBuf.length;
  // 混合为单声道
  const mono = new Float32Array(len);
  for (let c = 0; c < chs; c++) {
    const data = audioBuf.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += data[i] / chs;
  }
  const pcm = resampleTo16k(mono, audioBuf.sampleRate);
  return { pcm, durationSec: pcm.length / 16000 };
}

/** 文件字节 SHA-256（十六进制） */
export async function sha256OfBlob(file: File | Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Float32 PCM → base64（Int16 LE 编码，服务端解码复核） */
export function pcmToB64(pcm: Float32Array): string {
  const i16 = floatToInt16(pcm);
  const u8 = new Uint8Array(i16.buffer, i16.byteOffset, i16.byteLength);
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + CHUNK)) as unknown as number[]);
  }
  return btoa(s);
}

/** base64 WAV → 可播放/可下载的 blob URL */
export function b64ToBlobUrl(b64: string, mime = "audio/wav"): string {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([u8], { type: mime }));
}

/** 触发下载 */
export function downloadBlobUrl(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export const MAX_UPLOAD_SEC = 300;

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatTime(ts: string): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

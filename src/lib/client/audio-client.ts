/**
 * 声盾 — 客户端音频工具：解码、重采样、哈希、PCM 上行编码
 */
import { resampleTo16k } from "@/lib/engine/dsp";
import { floatToInt16 } from "@/lib/audio/wav";

export interface DecodedAudio {
  pcm: Float32Array; // 16kHz 单声道
  durationSec: number;
}

/** 解码任意浏览器支持的音频文件 → 16kHz 单声道 PCM
 *  v1.3.9：优先创建 16kHz AudioContext —— decodeAudioData 会把任意源重采样到
 *  上下文采样率（浏览器内置高质量重采样器），全程只重采样一次；
 *  旧实现用默认采样率（设备相关，常见 44.1/48k）解码后再由引擎降回 16k，
 *  两次重采样叠加将同一音频的判决拉低跨档（真机审计实测）。
 *  16k 上下文构造失败或解码失败时回退默认采样率 + Kaiser sinc 重采样。 */
export async function decodeFileTo16k(file: File | Blob): Promise<DecodedAudio> {
  const arrayBuffer = await file.arrayBuffer();
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

  const decodeWith = async (sampleRate?: number): Promise<AudioBuffer> => {
    const ctx = sampleRate ? new Ctx({ sampleRate }) : new Ctx();
    try {
      return await ctx.decodeAudioData(arrayBuffer.slice(0));
    } finally {
      void ctx.close();
    }
  };

  let audioBuf: AudioBuffer;
  try {
    audioBuf = await decodeWith(16000); // 主路径：单次重采样到 16k
  } catch {
    audioBuf = await decodeWith(); // 兼容回退：默认采样率 + 引擎 sinc 降采样
  }

  const chs = audioBuf.numberOfChannels;
  const len = audioBuf.length;
  // 混合为单声道
  const mono = new Float32Array(len);
  for (let c = 0; c < chs; c++) {
    const data = audioBuf.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += data[i] / chs;
  }
  // 16k 上下文时为恒等返回；回退路径时为 Kaiser sinc 抗混叠重采样
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

/** ArrayBuffer → base64（v1.3.9：原始上传文件随行携带，服务端落盘核验） */
export function arrayBufferToB64(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
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

/** Float32 PCM → 16bit WAV blob URL（实时鉴听结果本地回放/时频分析用） */
export function pcmToWavUrl(pcm: Float32Array, sampleRate = 16000): string {
  const i16 = floatToInt16(pcm);
  const u8 = new Uint8Array(i16.buffer, i16.byteOffset, i16.byteLength);
  const header = new ArrayBuffer(44);
  const dv = new DataView(header);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  dv.setUint32(4, 36 + u8.length, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true); // byte rate
  dv.setUint16(32, 2, true); // block align
  dv.setUint16(34, 16, true); // bits
  writeStr(36, "data");
  dv.setUint32(40, u8.length, true);
  return URL.createObjectURL(new Blob([header, u8.slice().buffer as ArrayBuffer], { type: "audio/wav" }));
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

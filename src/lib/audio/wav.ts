/**
 * 声盾 — WAV 编解码工具（同构，无 Node 依赖）
 * 用途：
 *  1. 客户端把录音 PCM 封装为 WAV 作为证据材料
 *  2. 服务端解码 TTS 返回的 WAV 进行分析
 */

export interface DecodedWav {
  pcm: Float32Array;
  sampleRate: number;
  channels: number;
}

function readAscii(view: DataView, offset: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

/**
 * 解码 WAV（支持 PCM8/PCM16/PCM24/PCM32/Float32/Extensible）
 */
export function decodeWav(data: ArrayBuffer | Uint8Array): DecodedWav {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 44) throw new Error("WAV 文件过短");
  if (readAscii(view, 0, 4) !== "RIFF" || readAscii(view, 8, 4) !== "WAVE") {
    throw new Error("非标准 WAV 文件");
  }

  // 遍历 chunk 寻找 fmt 与 data
  let offset = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  let dataOffset = -1;
  let dataLen = 0;
  while (offset + 8 <= bytes.byteLength) {
    const id = readAscii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      const format = view.getUint16(body, true);
      const channels = view.getUint16(body + 2, true);
      const rate = view.getUint32(body + 4, true);
      const bits = view.getUint16(body + 14, true);
      let realFormat = format;
      if (format === 0xfffe && size >= 40) {
        // Extensible：读取 SubFormat GUID 前两个字节
        realFormat = view.getUint16(body + 24, true);
      }
      fmt = { format: realFormat, channels, rate, bits };
    } else if (id === "data") {
      dataOffset = body;
      dataLen = Math.min(size, bytes.byteLength - body);
    }
    offset = body + size + (size % 2); // chunk 按 2 字节对齐
  }
  if (!fmt || dataOffset < 0) throw new Error("WAV 缺少 fmt/data 块");

  const { format, channels, rate, bits } = fmt;
  const bytesPerSample = bits / 8;
  const frameCount = Math.floor(dataLen / (bytesPerSample * channels));
  const pcm = new Float32Array(frameCount * channels);

  for (let i = 0; i < frameCount * channels; i++) {
    const p = dataOffset + i * bytesPerSample;
    let v = 0;
    if (format === 1) {
      // 整数 PCM
      if (bits === 8) v = (view.getUint8(p) - 128) / 128;
      else if (bits === 16) v = view.getInt16(p, true) / 32768;
      else if (bits === 24) {
        const b0 = view.getUint8(p), b1 = view.getUint8(p + 1), b2 = view.getUint8(p + 2);
        let int = (b2 << 16) | (b1 << 8) | b0;
        if (int & 0x800000) int |= ~0xffffff;
        v = int / 8388608;
      } else if (bits === 32) v = view.getInt32(p, true) / 2147483648;
      else throw new Error(`不支持的 PCM 位宽: ${bits}`);
    } else if (format === 3) {
      if (bits === 32) v = view.getFloat32(p, true);
      else if (bits === 64) v = view.getFloat64(p, true);
      else throw new Error(`不支持的 Float 位宽: ${bits}`);
    } else {
      throw new Error(`不支持的 WAV 格式: ${format}`);
    }
    pcm[i] = v;
  }
  return { pcm, sampleRate: rate, channels };
}

/** 多声道 → 单声道 */
export function mixToMono(pcm: Float32Array, channels: number): Float32Array {
  if (channels === 1) return pcm;
  const frames = Math.floor(pcm.length / channels);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < channels; c++) s += pcm[i * channels + c];
    out[i] = s / channels;
  }
  return out;
}

/**
 * 将 Float32 PCM 封装为 16-bit PCM WAV（用于证据材料）
 */
export function encodeWav16(pcm: Float32Array, sampleRate: number): Uint8Array {
  const dataLen = pcm.length * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buf);
  const writeStr = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataLen, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataLen, true);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true);
  }
  return new Uint8Array(buf);
}

/** Float32 PCM → Int16 PCM 字节（上行传输格式） */
export function floatToInt16(pcm: Float32Array): Int16Array {
  const out = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    out[i] = s < 0 ? s * 32768 : s * 32767;
  }
  return out;
}

/** Int16 PCM 字节 → Float32 PCM */
export function int16ToFloat(buf: Uint8Array | Int16Array): Float32Array {
  const src = buf instanceof Int16Array ? buf : new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2));
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[i] / 32768;
  return out;
}

/**
 * WAV 编解码测试
 * 往返保真（各 bit 深度 / Extensible / 多声道）+ v1.3.13 加固后的
 * 容错路径（损坏头部给出可读错误而非晦涩 RangeError / 垃圾值）。
 */
import { describe, it, expect } from "vitest";
import { decodeWav, mixToMono, encodeWav16, floatToInt16, int16ToFloat } from "../wav";

/** 手工构造 WAV 字节（完全控制头部字段，用于容错测试） */
function buildWav(opts: {
  format?: number; // 1=PCM, 3=Float, 0xfffe=Extensible
  channels?: number;
  rate?: number;
  bits?: number;
  fmtSize?: number; // fmt 块声明长度（默认 16）
  samples: number[] | Float32Array; // 交织样本（按 PCM int 或 float 原值写入）
  dataSizeOverride?: number; // data 块声明长度（默认实际长度）
  extensible?: boolean;
}): Uint8Array {
  const {
    format = 1,
    channels = 1,
    rate = 16000,
    bits = 16,
    fmtSize = 16,
    samples,
    dataSizeOverride,
    extensible = false,
  } = opts;
  const bytesPerSample = bits / 8;
  const dataLen = samples.length * bytesPerSample;
  const fmtLen = extensible ? 40 : fmtSize;
  const buf = new ArrayBuffer(12 + 8 + fmtLen + 8 + dataLen);
  const v = new DataView(buf);
  const wStr = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  wStr(0, "RIFF");
  v.setUint32(4, 4 + 8 + fmtLen + 8 + dataLen, true);
  wStr(8, "WAVE");
  wStr(12, "fmt ");
  v.setUint32(16, fmtLen, true);
  v.setUint16(20, format, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, (rate * channels * bytesPerSample) | 0, true);
  v.setUint16(32, channels * bytesPerSample, true);
  v.setUint16(34, bits, true);
  if (extensible) {
    v.setUint16(36, 22, true); // cbSize
    v.setUint16(38, bits, true); // validBitsPerSample
    v.setUint32(40, 0x3, true); // channel mask
    // SubFormat GUID：前两字节 = PCM(1)，其余固定
    v.setUint16(44, format === 0xfffe ? 1 : format, true);
    v.setUint32(46, 0x00000010, true);
    v.setUint32(50, 0x800000aa, true);
    v.setUint32(54, 0x00389b71, true);
  }
  const dataOff = 12 + 8 + fmtLen;
  wStr(dataOff, "data");
  v.setUint32(dataOff + 4, dataSizeOverride ?? dataLen, true);
  const body = dataOff + 8;
  for (let i = 0; i < samples.length; i++) {
    const p = body + i * bytesPerSample;
    const s = typeof samples[i] === "number" ? samples[i] : 0;
    if (format === 3) {
      if (bits === 32) v.setFloat32(p, s as number, true);
      else if (bits === 64) v.setFloat64(p, s as number, true);
    } else {
      if (bits === 8) v.setUint8(p, (s as number) + 128); // 8bit 无符号偏移
      else if (bits === 16) v.setInt16(p, s as number, true);
      else if (bits === 24) {
        const int = Math.max(-8388608, Math.min(8388607, Math.round(s as number)));
        v.setUint8(p, int & 0xff);
        v.setUint8(p + 1, (int >> 8) & 0xff);
        v.setUint8(p + 2, (int >> 16) & 0xff);
      } else if (bits === 32) v.setInt32(p, Math.round(s as number), true);
    }
  }
  return new Uint8Array(buf);
}

describe("decodeWav 往返保真", () => {
  it("encodeWav16 → decodeWav：16bit PCM 往返量化误差 ≤ 5e-5（正半轴 × 32767 编码口径）", () => {
    const pcm = new Float32Array(1600);
    for (let i = 0; i < pcm.length; i++) pcm[i] = 0.6 * Math.sin((2 * Math.PI * 220 * i) / 16000);
    const wav = encodeWav16(pcm, 16000);
    const dec = decodeWav(wav);
    expect(dec.sampleRate).toBe(16000);
    expect(dec.channels).toBe(1);
    expect(dec.pcm.length).toBe(pcm.length);
    for (let i = 0; i < pcm.length; i++) {
      expect(Math.abs(dec.pcm[i] - pcm[i])).toBeLessThanOrEqual(5e-5);
    }
  });

  it("PCM8（无符号偏移编码）正确解码", () => {
    // 采样值 s∈[−128,127] 写入字节 s+128
    const wav = buildWav({ bits: 8, samples: [-128, 0, 127, -64] });
    const dec = decodeWav(wav);
    expect(dec.pcm[0]).toBeCloseTo(-1, 6);
    expect(dec.pcm[1]).toBeCloseTo(0, 6);
    expect(dec.pcm[2]).toBeCloseTo(127 / 128, 6);
    expect(dec.pcm[3]).toBeCloseTo(-0.5, 6);
  });

  it("PCM24 三字节小端补码正确解码", () => {
    const wav = buildWav({ bits: 24, samples: [0, 8388607, -8388608, 4194304] });
    const dec = decodeWav(wav);
    expect(dec.pcm[0]).toBe(0);
    expect(dec.pcm[1]).toBeCloseTo(1, 6);
    expect(dec.pcm[2]).toBeCloseTo(-1, 6);
    expect(dec.pcm[3]).toBeCloseTo(0.5, 6);
  });

  it("PCM32 整数与 Float32 / Float64 编码", () => {
    const i32 = decodeWav(buildWav({ bits: 32, samples: [0, 1073741824, -1073741824] }));
    expect(i32.pcm[1]).toBeCloseTo(0.5, 6);
    expect(i32.pcm[2]).toBeCloseTo(-0.5, 6);
    const f32 = decodeWav(buildWav({ format: 3, bits: 32, samples: [0.25, -0.75] }));
    expect(f32.pcm[0]).toBeCloseTo(0.25, 7);
    expect(f32.pcm[1]).toBeCloseTo(-0.75, 7);
    const f64 = decodeWav(buildWav({ format: 3, bits: 64, samples: [0.123456789] }));
    // 解码输出为 Float32Array 存储，精度受限于 float32（≈1e-7 相对）
    expect(f64.pcm[0]).toBeCloseTo(0.123456789, 7);
  });

  it("WAVE_FORMAT_EXTENSIBLE：SubFormat GUID 解析出真实格式", () => {
    const wav = buildWav({ format: 0xfffe, extensible: true, bits: 16, samples: [16384, -16384] });
    const dec = decodeWav(wav);
    expect(dec.pcm[0]).toBeCloseTo(0.5, 6);
    expect(dec.pcm[1]).toBeCloseTo(-0.5, 6);
  });

  it("data 块声明长度大于实际字节 → 截断恢复（取证容错）", () => {
    // 证据文件传输截断时不应整文件报废，按实际字节解码
    const wav = buildWav({ bits: 16, samples: [1000, -2000, 3000, -4000], dataSizeOverride: 100000 });
    const dec = decodeWav(wav);
    expect(dec.pcm.length).toBe(4);
    expect(dec.pcm[0]).toBeCloseTo(1000 / 32768, 7);
  });

  it("多声道 mixToMono 平均", () => {
    expect(mixToMono(new Float32Array([0.5, -0.5, 1, -1]), 2)).toEqual(new Float32Array([0, 0]));
    const mono = new Float32Array([1, 2]);
    expect(mixToMono(mono, 1)).toBe(mono); // 单声道恒等
  });
});

describe("decodeWav 容错路径（v1.3.13 头部合法性闸）", () => {
  it("非 WAV 魔数 → 明确拒绝", () => {
    expect(() => decodeWav(new Uint8Array(64).fill(0x41))).toThrow("非标准 WAV");
  });

  it("过短文件（<44 字节）→ 明确拒绝", () => {
    expect(() => decodeWav(new Uint8Array(20))).toThrow("过短");
  });

  it("缺少 data 块（存在无关 chunk）→ 明确拒绝", () => {
    const wav = buildWav({ samples: [] });
    // 把 data 魔数改成无关 chunk（文件长度仍 ≥44）
    wav[36] = "j".charCodeAt(0);
    wav[37] = "u".charCodeAt(0);
    expect(() => decodeWav(wav)).toThrow("缺少");
  });

  it("channels=0 → 可读错误（旧版为 Infinity 帧数 → RangeError）", () => {
    const wav = buildWav({ channels: 0, samples: [] });
    expect(() => decodeWav(wav)).toThrow("声道数非法");
  });

  it("rate=0 → 可读错误", () => {
    const wav = buildWav({ rate: 0, samples: [1, 2] });
    expect(() => decodeWav(wav)).toThrow("采样率非法");
  });

  it("非 8 倍数位宽（bits=12）→ 可读错误", () => {
    const wav = buildWav({ bits: 12, samples: [1, 2, 3] });
    expect(() => decodeWav(wav)).toThrow("位宽非法");
  });

  it("fmt 块声明长度 <16 → 可读错误（旧版读越界字段）", () => {
    // 总长 ≥44 以绕开“文件过短”闸，fmt 声明 10 字节触发新闸
    const wav = buildWav({ fmtSize: 10, samples: [0, 0, 0, 0, 0, 0, 0, 0] });
    expect(() => decodeWav(wav)).toThrow("fmt 块损坏");
  });

  it("空 data 块（0 帧）→ 明确拒绝", () => {
    const wav = buildWav({ samples: [] });
    expect(() => decodeWav(wav)).toThrow("data 块为空");
  });

  it("不支持格式（ADPCM=2）→ 明确拒绝", () => {
    const wav = buildWav({ format: 2, samples: [1, 2] });
    expect(() => decodeWav(wav)).toThrow("不支持的 WAV 格式");
  });
});

describe("PCM 编解码辅助函数", () => {
  it("floatToInt16 / int16ToFloat 往返", () => {
    const pcm = new Float32Array([0, 0.5, -0.5, 0.999, -1]);
    const back = int16ToFloat(new Uint8Array(floatToInt16(pcm).buffer));
    for (let i = 0; i < pcm.length; i++) {
      expect(Math.abs(back[i] - pcm[i])).toBeLessThanOrEqual(5e-5);
    }
  });

  it("floatToInt16 限幅（|x|>1 不回绕）", () => {
    const i16 = floatToInt16(new Float32Array([2, -2]));
    expect(i16[0]).toBe(32767);
    expect(i16[1]).toBe(-32768);
  });
});

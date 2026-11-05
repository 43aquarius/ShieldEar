/**
 * 声盾测试集 — 自然语音鲁棒性变体生成
 * 对 5 段自然人声构造 4 类现实扰动（录音增益 ±6dB、变速 5%、20dB 信噪比加性噪声），
 * 用于检验引擎的抗误报能力（第二组测试项 N2）。
 * 全部处理为纯本地 DSP，不依赖任何外部服务。
 */
import fs from 'fs';
import path from 'path';
import { decodeWav, mixToMono, encodeWav16 } from '../src/lib/audio/wav';
import { resampleTo16k } from '../src/lib/engine/dsp';

const ADIR = path.join(process.cwd(), 'calibration', 'audio');

function loadPcm16k(file: string): Float32Array {
  const buf = fs.readFileSync(path.join(ADIR, file));
  const dec = decodeWav(new Uint8Array(buf).buffer);
  const mono = mixToMono(dec.pcm, dec.channels);
  return resampleTo16k(mono, dec.sampleRate);
}

/** 线性增益（dB） */
function gain(pcm: Float32Array, db: number): Float32Array {
  const k = Math.pow(10, db / 20);
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    out[i] = Math.max(-1, Math.min(1, pcm[i] * k));
  }
  return out;
}

/** 变速（重采样域实现，同时影响音高与时长，模拟 5% 语速偏差） */
function speed(pcm: Float32Array, factor: number): Float32Array {
  const n = Math.round(pcm.length / factor);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const src = i * factor;
    const i0 = Math.floor(src);
    const frac = src - i0;
    const s0 = pcm[Math.min(i0, pcm.length - 1)] ?? 0;
    const s1 = pcm[Math.min(i0 + 1, pcm.length - 1)] ?? 0;
    out[i] = s0 * (1 - frac) + s1 * frac;
  }
  return out;
}

/** 加性白噪声至目标信噪比（dB，相对信号 RMS） */
function addNoise(pcm: Float32Array, snrDb: number, seed = 20261027): Float32Array {
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x3fffffff - 1;
  };
  let energy = 0;
  for (let i = 0; i < pcm.length; i++) energy += pcm[i] * pcm[i];
  const sigRms = Math.sqrt(energy / pcm.length) || 1e-9;
  const noiseRms = sigRms / Math.pow(10, snrDb / 20);
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    out[i] = Math.max(-1, Math.min(1, pcm[i] + rand() * noiseRms));
  }
  return out;
}

function save(pcm: Float32Array, name: string) {
  const bytes = encodeWav16(pcm, 16000);
  fs.writeFileSync(path.join(ADIR, name), bytes);
  console.log('OK', name, bytes.length);
}

function main() {
  const naturals = fs.readdirSync(ADIR).filter((f) => /_16k\.wav$/.test(f));
  console.log(`natural sources: ${naturals.length}`);
  for (const f of naturals) {
    const base = f.replace(/_16k\.wav$/, '');
    const pcm = loadPcm16k(f);
    save(gain(pcm, +6), `nvar_gainup_${base}.wav`);
    save(gain(pcm, -6), `nvar_gaindown_${base}.wav`);
    save(speed(pcm, 1.05), `nvar_speed105_${base}.wav`);
    save(addNoise(pcm, 20), `nvar_noise20_${base}.wav`);
  }
  console.log('DONE natural variants');
}

main();

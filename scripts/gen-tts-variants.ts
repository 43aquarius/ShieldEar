/**
 * 声盾测试集 — 合成语音退化鲁棒性变体生成（T3 组）
 * 对 20 段校准集合成语音构造 3 类现实退化：
 *   noise20  —— 20dB 信噪比加性白噪声（嘈杂环境通话）
 *   mp3      —— 64kbps 单声道 MP3 编解码往返（语音消息压缩链路）
 *   speed105 —— 1.05 倍变速（倍速播放/变速转发的语音）
 * 检验检出率（召回）在现实退化下的保持能力。
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { decodeWav, mixToMono, encodeWav16 } from '../src/lib/audio/wav';
import { resampleTo16k } from '../src/lib/engine/dsp';

const ADIR = path.join(process.cwd(), 'calibration', 'audio');
const TMP = path.join(process.cwd(), 'calibration', 'tmp');
const SR = 16000;

function loadPcm16k(file: string): Float32Array {
  const buf = fs.readFileSync(path.join(ADIR, file));
  const dec = decodeWav(new Uint8Array(buf).buffer);
  const mono = mixToMono(dec.pcm, dec.channels);
  return resampleTo16k(mono, dec.sampleRate);
}

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

/** MP3 编解码往返（真实语音消息压缩链路） */
function mp3Roundtrip(pcm: Float32Array, tag: string): Float32Array {
  fs.mkdirSync(TMP, { recursive: true });
  const inWav = path.join(TMP, `${tag}.wav`);
  const mp3 = path.join(TMP, `${tag}.mp3`);
  const outWav = path.join(TMP, `${tag}_dec.wav`);
  fs.writeFileSync(inWav, encodeWav16(pcm, SR));
  execSync(`ffmpeg -y -hide_banner -loglevel error -i "${inWav}" -ar ${SR} -ac 1 -b:a 64k "${mp3}"`);
  execSync(`ffmpeg -y -hide_banner -loglevel error -i "${mp3}" -ar ${SR} -ac 1 "${outWav}"`);
  const buf = fs.readFileSync(outWav);
  const dec = decodeWav(new Uint8Array(buf).buffer);
  const mono = mixToMono(dec.pcm, dec.channels);
  return resampleTo16k(mono, dec.sampleRate);
}

function save(pcm: Float32Array, name: string) {
  fs.writeFileSync(path.join(ADIR, name), encodeWav16(pcm, SR));
  console.log('OK', name);
}

function main() {
  const tts = fs.readdirSync(ADIR).filter((f) => /^tts_.*\.wav$/.test(f) && !/^tts2_/.test(f)).sort();
  console.log(`tts sources: ${tts.length}`);
  for (const f of tts) {
    const base = f.replace(/\.wav$/, '');
    const pcm = loadPcm16k(f);
    save(addNoise(pcm, 20), `tvar_noise20_${base}.wav`);
    save(speed(pcm, 1.05), `tvar_speed105_${base}.wav`);
    save(mp3Roundtrip(pcm, base), `tvar_mp3_${base}.wav`);
  }
  // 清理临时目录
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('DONE tts variants');
}

main();

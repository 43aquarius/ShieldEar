#!/usr/bin/env python3
"""
gen-resample-test-assets.py — v1.3.9 重采样回归素材生成

真机审计发现（v1.3.8 及之前）：同一音频以 44.1/48/32 kHz 容器提供时，
浏览器解码 → 旧版 resampleTo16k（对半抽取+线性插值）会把判决拉低跨档
（彤彤 CRITICAL 0.759 → HIGH 0.702）。

本脚本用 scipy resample_poly（高质量参考实现）把 16kHz 基线样本上采样到
44.1/48/32 kHz，供 scripts/test-resample-quality.ts 做「降回 16k → 引擎
判决 vs 基线」的 A/B 回归：v1.3.9 要求同档不降级、分差在容差内。
"""
import sys
from pathlib import Path

import numpy as np
import scipy.io.wavfile as wavfile
from scipy.signal import resample_poly

SRC = Path("/home/z/my-project/calibration/audio")
OUT = Path("/tmp/resample-test")
RATES = [44100, 48000, 32000]
CASES = [
    "tts_tongtong_0.wav",   # 合成 · 基线 CRITICAL
    "tts_luodo_0.wav",      # 合成 · 基线 HIGH
    "demo_natural_demo.wav",  # 真人（public/samples 的副本亦放入 OUT）
]


def upsample(src: Path, dst_rate: int, dst: Path) -> None:
    rate, data = wavfile.read(src)
    assert rate >= 16000, f"{src} 采样率异常：{rate}"
    assert data.dtype == np.int16
    # 有理比率重采样：源→目标（高质量参考实现）
    from math import gcd
    g = gcd(rate, dst_rate)
    up, down = dst_rate // g, rate // g
    out = resample_poly(data.astype(np.float64) / 32768.0, up, down, window=("kaiser", 9.0))
    out16 = np.clip(np.round(out * 32768.0), -32768, 32767).astype(np.int16)
    wavfile.write(dst, dst_rate, out16)
    print(f"  {src.name} → {dst_rate}Hz: {len(data)} → {len(out16)} 样本")


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    for name in CASES:
        # demo_natural_* 在 public/samples 下
        src = SRC / name
        if not src.exists():
            alt = Path("/home/z/my-project/public/samples") / name
            if alt.exists():
                src = alt
        if not src.exists():
            print(f"✗ 找不到 {name}", file=sys.stderr)
            return 1
        for rate in RATES:
            upsample(src, rate, OUT / name.replace(".wav", f"_{rate}.wav"))
        # 基线副本（原生采样率，由被测管线的 resampleTo16k 处理）
        import shutil
        shutil.copy(src, OUT / name)
        print(f"  基线副本: {name}（原生采样率见上）")
    print("✓ 素材就绪:", OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())

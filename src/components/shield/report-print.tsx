"use client";

/**
 * 声盾 — 核验报告（打印视图）
 * window.print() → 浏览器「另存为 PDF」即得正式核验报告
 * 屏幕隐藏 / 打印独占（display 切换，见 globals.css @media print）
 */

import { useCallback } from "react";
import { useShield } from "@/lib/store";
import { formatDuration, formatTime } from "@/lib/client/audio-client";
import type { WindowResult } from "@/lib/engine/types";

export function useReport() {
  const print = useCallback(() => {
    window.print();
  }, []);
  return { print };
}

function CurveSvg({ windows }: { windows: WindowResult[] }) {
  const voiced = windows.filter((w) => w.voiced);
  if (!voiced.length) return <p className="text-xs">（无有效语音窗口）</p>;
  const W = 720;
  const H = 130;
  const maxT = voiced[voiced.length - 1].startSec || 1;
  const pts = voiced.map((w) => {
    const x = 34 + (w.startSec / maxT) * (W - 50);
    const y = H - 18 - w.score * (H - 34);
    return { x, y, score: w.score, t: w.startSec };
  });
  const path = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const y72 = H - 18 - 0.72 * (H - 34);
  const y50 = H - 18 - 0.5 * (H - 34);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="逐窗置信度曲线">
      {/* 轴 */}
      <line x1="34" y1={H - 18} x2={W - 12} y2={H - 18} stroke="#666" strokeWidth="1" />
      <line x1="34" y1="12" x2="34" y2={H - 18} stroke="#666" strokeWidth="1" />
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <text key={v} x="30" y={H - 18 - v * (H - 34) + 3} fontSize="8" fill="#555" textAnchor="end">
          {(v * 100).toFixed(0)}
        </text>
      ))}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <text
          key={f}
          x={34 + f * (W - 50)}
          y={H - 6}
          fontSize="8"
          fill="#555"
          textAnchor="middle"
        >
          {(maxT * f).toFixed(0)}s
        </text>
      ))}
      {/* 阈值 */}
      <line x1="34" y1={y72} x2={W - 12} y2={y72} stroke="#c0392b" strokeDasharray="5 3" strokeWidth="0.8" />
      <text x={W - 14} y={y72 - 2} fontSize="7.5" fill="#c0392b" textAnchor="end">合成阈值 72%</text>
      <line x1="34" y1={y50} x2={W - 12} y2={y50} stroke="#b8860b" strokeDasharray="4 3" strokeWidth="0.8" />
      <text x={W - 14} y={y50 - 2} fontSize="7.5" fill="#b8860b" textAnchor="end">可疑阈值 50%</text>
      {/* 曲线 */}
      <polyline points={path} fill="none" stroke="#166534" strokeWidth="1.4" />
      {pts.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={1.7}
          fill={p.score >= 0.72 ? "#c0392b" : p.score >= 0.5 ? "#b8860b" : "#166534"}
        />
      ))}
      <text x={W / 2} y="8" fontSize="9" fill="#333" textAnchor="middle">
        逐窗合成置信度（2s 窗 / 1s 步进 / 中值+指数平滑）
      </text>
    </svg>
  );
}

export function ReportPrint() {
  const { result, meta } = useShield();
  if (!result) return null;
  const { overall, audio, windows, segments, featureProfile, stats, channel } = result;
  const riskText: Record<string, string> = {
    LOW: "未发现明显合成特征（低风险）",
    MEDIUM: "存在可疑片段（中风险）",
    HIGH: "疑似 AI 合成语音（高风险）",
    CRITICAL: "高度疑似 AI 合成语音（极高风险）",
  };

  return (
    <div id="print-root" className="hidden" aria-hidden>
      {/* 抬头 */}
      <div className="print-nobreak mb-4 flex items-end justify-between border-b-2 border-black pb-2">
        <div>
          <div className="text-[22px] font-bold tracking-wide">声盾 ShieldEar</div>
          <div className="mt-0.5 text-[12px] text-[#333]">
            AI 语音鉴伪核验报告 · Anti-Fraud Voice Forensics Report
          </div>
        </div>
        <div className="text-right text-[11px] leading-5">
          <div className="font-mono-data font-semibold">{meta?.caseNo ?? "（未存证）"}</div>
          <div>{meta ? formatTime(meta.createdAt) : ""}</div>
        </div>
      </div>

      {/* 一、基本信息 */}
      <section className="print-nobreak mb-4">
        <h2 className="mb-1.5 text-[13px] font-bold">一、基本信息</h2>
        <table>
          <tbody>
            <tr>
              <th className="w-[130px]">检测对象</th>
              <td>{meta?.sourceLabel ?? "—"}</td>
              <th className="w-[110px]">来源方式</th>
              <td>
                {meta?.sourceType === "LIVE"
                  ? "实时鉴听（麦克风）"
                  : meta?.sourceType === "TTS"
                    ? "现场合成挑战（平台 TTS）"
                    : "文件上传"}
              </td>
            </tr>
            <tr>
              <th>音频时长</th>
              <td className="font-mono-data">{formatDuration(audio.durationSec)}（{audio.durationSec.toFixed(1)} 秒）</td>
              <th>分析采样率</th>
              <td className="font-mono-data">16 kHz 单声道</td>
            </tr>
            <tr>
              <th>检测引擎</th>
              <td className="font-mono-data">ShieldEar {result.engine.version}</td>
              <th>分析耗时 / RTF</th>
              <td className="font-mono-data">
                {stats.analyzeMs.toFixed(0)} ms / {stats.rtf.toFixed(3)}
              </td>
            </tr>
            <tr>
              <th>信道模式</th>
              <td>{channel === "narrowband" ? "窄带（电话信道）模式" : "宽带模式"}</td>
              <th>窗口配置</th>
              <td className="font-mono-data">2s 窗 / 1s 步进 / 50% 重叠</td>
            </tr>
            <tr>
              <th>有效语音窗</th>
              <td className="font-mono-data">{audio.voicedWindows} / {audio.totalWindows}（静音 {audio.silentWindows} 窗不计入判决）</td>
              <th>服务端复核</th>
              <td>{meta ? "已复核并存证" : "仅客户端初判"}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* 二、检测结论 */}
      <section className="print-nobreak mb-4">
        <h2 className="mb-1.5 text-[13px] font-bold">二、检测结论</h2>
        <table>
          <tbody>
            <tr>
              <th className="w-[130px]">结论</th>
              <td className="font-bold">{riskText[overall.risk]}</td>
            </tr>
            <tr>
              <th>合成置信度</th>
              <td className="font-mono-data">
                {(overall.syntheticRatio * 100).toFixed(1)}%（能量加权均值）· 峰值{" "}
                {(overall.maxScore * 100).toFixed(1)}% · 可疑片段 {segments.length} 段
              </td>
            </tr>
            <tr>
              <th>处置建议</th>
              <td className="leading-5">{overall.advice}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* 三、置信度曲线 */}
      <section className="print-nobreak mb-4">
        <h2 className="mb-1.5 text-[13px] font-bold">三、逐窗置信度曲线</h2>
        <CurveSvg windows={windows} />
      </section>

      {/* 四、可疑片段 */}
      <section className="print-nobreak mb-4">
        <h2 className="mb-1.5 text-[13px] font-bold">四、可疑片段明细</h2>
        {segments.length ? (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>起始（秒）</th>
                <th>结束（秒）</th>
                <th>均值置信度</th>
                <th>峰值置信度</th>
                <th>窗口数</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((s, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td className="font-mono-data">{s.startSec.toFixed(1)}</td>
                  <td className="font-mono-data">{s.endSec.toFixed(1)}</td>
                  <td className="font-mono-data">{(s.meanScore * 100).toFixed(1)}%</td>
                  <td className="font-mono-data">{(s.peakScore * 100).toFixed(1)}%</td>
                  <td>{s.windows}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-xs">未检出置信度超过可疑阈值的连续片段。</p>
        )}
      </section>

      {/* 五、特征偏离摘要 */}
      <section className="print-nobreak mb-4">
        <h2 className="mb-1.5 text-[13px] font-bold">五、特征偏离摘要（判决依据）</h2>
        <table>
          <thead>
            <tr>
              <th>特征</th>
              <th>实测均值</th>
              <th>自然先验</th>
              <th>偏离（σ）</th>
            </tr>
          </thead>
          <tbody>
            {featureProfile.map((f) => (
              <tr key={f.key}>
                <td>{f.name}</td>
                <td className="font-mono-data">{f.meanValue.toFixed(4)}</td>
                <td className="font-mono-data">
                  {f.naturalPrior.toFixed(4)} ± {f.naturalRange.toFixed(4)}
                </td>
                <td className="font-mono-data">
                  {f.zMean > 0 ? "+" : ""}
                  {f.zMean.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-[10px] leading-4 text-[#555]">
          σ 为同信道自然人声统计波动单位；|z| ≥ 1.5 视为显著偏离。特征剖面与逐窗明细支持第三方复核。
        </p>
      </section>

      {/* 六、逐窗明细 */}
      <section className="mb-4">
        <h2 className="mb-1.5 text-[13px] font-bold">六、逐窗判决明细</h2>
        <table>
          <thead>
            <tr>
              <th>窗</th>
              <th>起止（秒）</th>
              <th>平滑置信度</th>
              <th>判决</th>
              <th>电平(dB)</th>
              <th>信道</th>
            </tr>
          </thead>
          <tbody>
            {windows.map((w) => (
              <tr key={w.index}>
                <td className="font-mono-data">#{w.index + 1}</td>
                <td className="font-mono-data">
                  {w.startSec.toFixed(1)}–{w.endSec.toFixed(1)}
                </td>
                <td className="font-mono-data">
                  {w.voiced ? (w.score * 100).toFixed(1) + "%" : "静音"}
                </td>
                <td>
                  {w.label === "synthetic"
                    ? "合成"
                    : w.label === "suspect"
                      ? "可疑"
                      : w.label === "natural"
                        ? "正常"
                        : "静音"}
                </td>
                <td className="font-mono-data">{w.rmsDb.toFixed(0)}</td>
                <td>{w.channel === "narrowband" ? "窄带" : "宽带"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* 七、证据固定 */}
      <section className="print-nobreak mb-4">
        <h2 className="mb-1.5 text-[13px] font-bold">七、证据固定</h2>
        <table>
          <tbody>
            <tr>
              <th className="w-[170px]">案件编号</th>
              <td className="font-mono-data">{meta?.caseNo ?? "—"}</td>
            </tr>
            <tr>
              <th>证据音频 SHA-256</th>
              <td className="font-mono-data break-all">{meta?.audioHash ?? "—"}</td>
            </tr>
            {meta?.sourceHash && (
              <tr>
                <th>
                  {meta.sourceType === "TTS" ? "原始合成音频 SHA-256" : "原始上传文件 SHA-256"}
                </th>
                <td className="font-mono-data break-all">{meta.sourceHash}</td>
              </tr>
            )}
            <tr>
              <th>存证时间</th>
              <td className="font-mono-data">{meta ? formatTime(meta.createdAt) : "—"}</td>
            </tr>
            <tr>
              <th>证据下载</th>
              <td className="font-mono-data">
                {meta?.caseNo ? `/api/evidence/${meta.caseNo}?kind=evidence` : "—"}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* 八、声明 */}
      <section className="print-nobreak">
        <h2 className="mb-1.5 text-[13px] font-bold">八、方法与免责声明</h2>
        <p className="text-[10.5px] leading-5 text-[#333]">
          本报告由声盾 ShieldEar 轻量可解释检测引擎生成：音频统一重采样至 16 kHz 单声道后，
          以 2 秒滑动窗口（1 秒步进、50% 重叠）提取 8 维声学特征（高频谱平坦度、高频能量占比、
          谐波规整度、嗓音动力波动、谱通量波动度、基音微扰、过零率波动度、高频周期性），
          相对同信道自然人声统计先验计算标准化偏离，经数据驱动校准的逻辑回归评分得到逐窗合成置信度，
          再经中值滤波与指数平滑输出最终判决。全部特征先验与权重经真实样本离线拟合，过程可复现。
          本工具定位为反诈辅助验真：结论附带置信度与不确定性说明，不构成执法结论或司法鉴定意见；
          检测演示音频均为平台合成或公有领域样本。如涉及真实案件，请以司法鉴定机构出具的正式意见为准，
          并可凭本报告案件编号与哈希链向受理机构提供线索材料。
        </p>
      </section>

      {/* 页脚 */}
      <div className="mt-6 border-t border-[#999] pt-2 text-center text-[10px] text-[#555]">
        声盾 ShieldEar · AI 语音诈骗实时鉴伪反诈平台 · 参赛作品演示版 ·{" "}
        <span className="font-mono-data">{meta?.caseNo}</span>
      </div>
    </div>
  );
}

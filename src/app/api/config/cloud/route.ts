/**
 * GET  /api/config/cloud — 读取云端合成通道状态
 * POST /api/config/cloud — { enabled: boolean } 切换；{ reset: true } 恢复环境默认
 *
 * v1.3.3：离线包默认关闭云端通道（SHIELD_TTS_ONLINE 未设置），
 * 界面开关经此 API 运行时切换（无需重启），重启后恢复离线默认值。
 */
import { NextRequest, NextResponse } from "next/server";
import {
  isCloudEnabled,
  isOfflineMode,
  setCloudEnabled,
  cloudChannelSummary,
} from "@/lib/server/cloud-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    cloudEnabled: isCloudEnabled(),
    offlineMode: isOfflineMode(),
    summary: cloudChannelSummary(),
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { enabled?: boolean; reset?: boolean };
    if (body.reset) {
      setCloudEnabled(null);
    } else if (typeof body.enabled === "boolean") {
      setCloudEnabled(body.enabled);
    } else {
      return NextResponse.json(
        { error: "请求体需为 { enabled: boolean } 或 { reset: true }" },
        { status: 400 }
      );
    }
    return NextResponse.json({
      cloudEnabled: isCloudEnabled(),
      offlineMode: isOfflineMode(),
      summary: cloudChannelSummary(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "配置更新失败" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-utils";
import { enterOrganizationContext } from "@/lib/organization-context";
import {
  authenticateFbsPrintAgent,
  claimFbsPrintItem,
  completeFbsPrintItem,
  heartbeatFbsPrintAgent,
  parseFbsPrintAgentOrganization,
  pauseFbsPrintItem,
} from "@/lib/fbs-print-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const organizationId = parseFbsPrintAgentOrganization(token);
  if (!organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  enterOrganizationContext({ organizationId, userId: null, organizationRole: "admin", source: "job" });
  try {
    const agentId = await authenticateFbsPrintAgent(token);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action || "claim");
    if (action === "heartbeat") {
      await heartbeatFbsPrintAgent(agentId, String(body.printerName || ""), String(body.status || "online"), String(body.error || ""));
      return NextResponse.json({ ok: true });
    }
    if (action === "claim") {
      return NextResponse.json({ ok: true, item: await claimFbsPrintItem(agentId, String(body.printerName || "")) });
    }
    if (action === "complete") {
      return NextResponse.json({ ok: true, result: await completeFbsPrintItem(agentId, String(body.jobId || ""), Number(body.position || 0)) });
    }
    if (action === "pause") {
      await pauseFbsPrintItem(agentId, String(body.jobId || ""), Number(body.position || 0), String(body.error || "Печать остановлена"));
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return apiError(error);
  }
}

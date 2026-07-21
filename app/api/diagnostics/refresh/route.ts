import { apiErrorResponse, requireMutationSession } from "@/lib/api";
import { getDiagnosticsSnapshot } from "@/lib/diagnostics";
import { jsonResponse } from "@/lib/http-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  try {
    requireMutationSession(request);
    return jsonResponse({ ok: true, diagnostics: await getDiagnosticsSnapshot(true) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

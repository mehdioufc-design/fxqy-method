import { apiErrorResponse, requireApiSession } from "@/lib/api";
import { getDiagnosticsSnapshot } from "@/lib/diagnostics";
import { jsonResponse } from "@/lib/http-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  try {
    requireApiSession(request);
    return jsonResponse({ diagnostics: await getDiagnosticsSnapshot() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

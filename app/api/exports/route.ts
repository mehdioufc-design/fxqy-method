import { apiErrorResponse, requireApiSession } from "@/lib/api";
import { exportsRepository } from "@/lib/db";
import { jsonResponse } from "@/lib/http-security";
import { exportView } from "@/lib/views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const session = requireApiSession(request);
    return jsonResponse({ exports: exportsRepository.list(session.owner.id, 200).map(exportView) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

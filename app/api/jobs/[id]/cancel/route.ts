import { apiErrorResponse, requireMutationSession } from "@/lib/api";
import { jobs } from "@/lib/db";
import { jsonResponse } from "@/lib/http-security";
import { isSafeObjectId } from "@/lib/paths";
import { jobView } from "@/lib/views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const session = requireMutationSession(request);
    const { id } = await context.params;
    if (!isSafeObjectId(id)) return new Response(null, { status: 404 });
    const current = jobs.get(id, session.owner.id);
    if (!current) return new Response(null, { status: 404 });
    if (["queued", "analyzing", "processing"].includes(current.status)) {
      jobs.requestCancellation(id, session.owner.id);
      if (current.status === "queued") {
        jobs.setStatus(id, session.owner.id, "cancelled", {
          phase: "Cancelled before processing",
          completedAt: Date.now(),
        });
      }
    }
    const updated = jobs.get(id, session.owner.id);
    if (!updated) return new Response(null, { status: 404 });
    return jsonResponse({ ok: true, job: jobView(updated) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

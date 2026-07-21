import { apiErrorResponse, requireApiSession } from "@/lib/api";
import { jobs } from "@/lib/db";
import { jsonResponse } from "@/lib/http-security";
import { isSafeObjectId } from "@/lib/paths";
import { jobView } from "@/lib/views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    const session = requireApiSession(request);
    const { id } = await context.params;
    if (!isSafeObjectId(id)) return new Response(null, { status: 404 });
    const job = jobs.get(id, session.owner.id);
    if (!job) return new Response(null, { status: 404 });
    return jsonResponse({ job: jobView(job) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

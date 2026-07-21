import { apiErrorResponse, requireMutationSession } from "@/lib/api";
import { exportsRepository } from "@/lib/db";
import { jsonResponse } from "@/lib/http-security";
import { isSafeObjectId } from "@/lib/paths";
import { deleteMediaKey } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, context: Context): Promise<Response> {
  try {
    const session = requireMutationSession(request);
    const { id } = await context.params;
    if (!isSafeObjectId(id)) return new Response(null, { status: 404 });
    const item = exportsRepository.get(id, session.owner.id);
    if (!item || item.deletedAt) return new Response(null, { status: 404 });
    await deleteMediaKey(item.storageKey);
    exportsRepository.markDeleted(item.id, session.owner.id);
    return jsonResponse({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

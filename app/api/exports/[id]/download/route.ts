import { apiErrorResponse, requireApiSession } from "@/lib/api";
import { getAppConfig } from "@/lib/config";
import { exportsRepository } from "@/lib/db";
import { trustedExistingMediaPath } from "@/lib/media";
import { isSafeObjectId, resolveContainedPath } from "@/lib/paths";
import { privateFileResponse } from "@/lib/private-file-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

async function serve(request: Request, context: Context): Promise<Response> {
  try {
    const session = requireApiSession(request);
    const { id } = await context.params;
    if (!isSafeObjectId(id)) return new Response(null, { status: 404 });
    const item = exportsRepository.get(id, session.owner.id);
    if (!item || item.deletedAt) return new Response(null, { status: 404 });
    const candidate = resolveContainedPath(getAppConfig().mediaRoot, item.storageKey);
    const output = await trustedExistingMediaPath(getAppConfig().mediaRoot, candidate);
    return privateFileResponse(request, output, { fileName: item.displayName, download: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export const GET = serve;
export const HEAD = serve;

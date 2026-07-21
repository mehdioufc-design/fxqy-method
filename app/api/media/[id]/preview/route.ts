import { apiErrorResponse, requireApiSession } from "@/lib/api";
import { getAppConfig } from "@/lib/config";
import { mediaAssets } from "@/lib/db";
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
    const asset = mediaAssets.get(id, session.owner.id);
    if (!asset || asset.deletedAt || asset.status !== "ready") return new Response(null, { status: 404 });
    const candidate = resolveContainedPath(getAppConfig().mediaRoot, asset.storageKey);
    const mediaPath = await trustedExistingMediaPath(getAppConfig().mediaRoot, candidate);
    return privateFileResponse(request, mediaPath, { fileName: asset.originalName });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export const GET = serve;
export const HEAD = serve;

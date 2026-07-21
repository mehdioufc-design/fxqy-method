import { requireMutationSession } from "@/lib/api";
import { owners } from "@/lib/db";
import { jsonResponse } from "@/lib/http-security";
import { apiErrorResponse } from "@/lib/api";

export async function POST(request: Request) {
  try { const { owner } = requireMutationSession(request); owners.completeOnboarding(owner.id); return jsonResponse({ ok: true }); }
  catch (error) { return apiErrorResponse(error); }
}

import { clearSessionCookie, revokeRequestSession } from "@/lib/auth";
import { assertSafeMutationRequest, jsonResponse } from "@/lib/http-security";
import { apiErrorResponse } from "@/lib/api";

export async function POST(request: Request) {
  try {
    assertSafeMutationRequest(request); revokeRequestSession(request);
    return jsonResponse({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
  } catch (error) { return apiErrorResponse(error); }
}

import crypto from "node:crypto";
import { z } from "zod";
import { apiErrorResponse, requireMutationSession } from "@/lib/api";
import { feedbackRepository } from "@/lib/db";
import { jsonResponse, readSmallJsonObject } from "@/lib/http-security";

const Input = z.object({ kind:z.enum(["bug","feedback"]), message:z.string().trim().min(5).max(4000), page:z.string().trim().min(1).max(300) }).strict();
export async function POST(request: Request) {
  try { const { owner }=requireMutationSession(request); const input=Input.parse(await readSmallJsonObject(request)); const now=Date.now(); feedbackRepository.create({ id:crypto.randomUUID(), ownerId:owner.id, ...input, status:"new", createdAt:now, updatedAt:now }); return jsonResponse({ok:true},{status:201}); }
  catch(error){return apiErrorResponse(error);}
}

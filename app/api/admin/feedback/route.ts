import { z } from "zod";
import { apiErrorResponse, requireApiSession, requireMutationSession } from "@/lib/api";
import { feedbackRepository } from "@/lib/db";
import { jsonResponse, readSmallJsonObject } from "@/lib/http-security";

function admin(owner:{role:string}) { if(owner.role!=="admin") return jsonResponse({error:{message:"Administrator access is required."}},{status:403}); }
export async function GET(request:Request){try{const {owner}=requireApiSession(request);const denied=admin(owner);if(denied)return denied;return jsonResponse({feedback:feedbackRepository.listAll()});}catch(error){return apiErrorResponse(error);}}
const Input=z.object({id:z.string().uuid(),status:z.enum(["new","reviewing","resolved"])}).strict();
export async function PATCH(request:Request){try{const {owner}=requireMutationSession(request);const denied=admin(owner);if(denied)return denied;const input=Input.parse(await readSmallJsonObject(request));if(!feedbackRepository.updateStatus(input.id,input.status))return jsonResponse({error:{message:"Report not found."}},{status:404});return jsonResponse({ok:true});}catch(error){return apiErrorResponse(error);}}

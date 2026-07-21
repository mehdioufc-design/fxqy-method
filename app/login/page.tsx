import { currentOwner } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AuthPanel } from "@/components/auth-panel";

export const dynamic = "force-dynamic";
export default async function LoginPage() {
  const owner = await currentOwner();
  if (owner) redirect(owner.onboardedAt ? "/" : "/onboarding");
  return <AuthPanel />;
}

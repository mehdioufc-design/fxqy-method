import { currentOwner } from "@/lib/auth";
import { redirect } from "next/navigation";
import { OnboardingForm } from "@/components/onboarding-form";

export const dynamic = "force-dynamic";
export default async function OnboardingPage() {
  const owner = await currentOwner();
  if (!owner) redirect("/login");
  if (owner.onboardedAt) redirect("/");
  return <OnboardingForm email={owner.username} />;
}

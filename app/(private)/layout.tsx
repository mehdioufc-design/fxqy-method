import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { currentOwner } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PrivateLayout({ children }: { children: ReactNode }) {
  const owner = await currentOwner();
  if (!owner) redirect("/login");
  if (!owner.onboardedAt) redirect("/onboarding");
  return <AppShell user={{ email: owner.username, role: owner.role }}>{children}</AppShell>;
}

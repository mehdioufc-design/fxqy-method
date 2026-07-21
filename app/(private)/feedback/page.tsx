import { currentOwner } from "@/lib/auth"; import { redirect } from "next/navigation"; import { FeedbackAdmin } from "@/components/feedback-admin";
export const metadata={title:"Feedback inbox"}; export default async function Page(){const owner=await currentOwner();if(owner?.role!=="admin")redirect("/");return <FeedbackAdmin/>}

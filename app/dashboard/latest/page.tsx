import { redirect } from "next/navigation";
import { latestAuditId } from "@/lib/store";

export const dynamic = "force-dynamic";

// "Dashboard" in the nav always opens the most recent audit; with none yet, go home to start one.
export default async function Latest() {
  const id = await latestAuditId();
  redirect(id ? `/dashboard/${id}` : "/");
}

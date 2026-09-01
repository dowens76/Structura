export const dynamic = "force-dynamic";

import { getActiveWorkspaceId } from "@/lib/workspace";
import AccountPanel from "./AccountPanel";

export const metadata = { title: "Account & Workspaces — Structura" };

export default async function AccountPage() {
  const activeWorkspaceId = await getActiveWorkspaceId();
  return <AccountPanel activeWorkspaceId={activeWorkspaceId} />;
}

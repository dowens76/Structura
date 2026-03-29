import { getActiveWorkspaceId } from "@/lib/workspace";
import AccountPanel from "./AccountPanel";

export const metadata = { title: "Account & Workspaces — Structura" };

export default async function AccountPage() {
  const activeWorkspaceId = await getActiveWorkspaceId();
  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--background)" }}>
      <AccountPanel activeWorkspaceId={activeWorkspaceId} />
    </div>
  );
}

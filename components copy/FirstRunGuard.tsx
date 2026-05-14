"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import AccountSetupModal from "./AccountSetupModal";

export default function FirstRunGuard({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/users")
      .then((r) => r.json())
      .then((data) => {
        if (!data.users || data.users.length === 0) {
          setNeedsSetup(true);
        }
      })
      .catch(() => {
        // If the fetch fails, don't block the app
      })
      .finally(() => setChecking(false));
  }, []);

  function handleSetupComplete(workspaceId: number) {
    void workspaceId;
    setNeedsSetup(false);
    router.refresh();
  }

  // While checking, render children normally (avoids flash of blocked content).
  // The modal will appear on top once we confirm no users exist.
  return (
    <>
      {!checking && needsSetup && (
        <AccountSetupModal onComplete={handleSetupComplete} />
      )}
      {children}
    </>
  );
}

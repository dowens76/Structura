"use client";

import { useState } from "react";
import { useTranslation } from "@/lib/i18n/LocaleContext";
import { setActiveWorkspace } from "@/lib/workspace-client";

interface Props {
  onComplete: (workspaceId: number) => void;
}

export default function AccountSetupModal({ onComplete }: Props) {
  const { t } = useTranslation();
  const [name, setName]   = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      setError("Please fill in both fields.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      // Create user (server also auto-creates a "Default" workspace)
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? t("accountSetup.error"));
        return;
      }
      const { workspace } = await res.json();
      // Set active workspace cookie
      await setActiveWorkspace(workspace.id);
      onComplete(workspace.id);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
    >
      <div
        className="w-full max-w-md mx-4 rounded-xl shadow-2xl p-8"
        style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}
      >
        {/* Logo / title */}
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold mb-1" style={{ color: "var(--foreground)" }}>
            {t("accountSetup.welcome")}
          </h1>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {t("accountSetup.createPrompt")}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
              {t("accountSetup.name")}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("accountSetup.namePlaceholder")}
              autoFocus
              className="px-3 py-2 rounded-lg text-sm outline-none"
              style={{
                backgroundColor: "var(--background)",
                border: "1px solid var(--border)",
                color: "var(--foreground)",
              }}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
              {t("accountSetup.email")}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="px-3 py-2 rounded-lg text-sm outline-none"
              style={{
                backgroundColor: "var(--background)",
                border: "1px solid var(--border)",
                color: "var(--foreground)",
              }}
            />
          </div>

          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 px-4 py-2 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-50"
            style={{ backgroundColor: "var(--accent)", color: "#fff" }}
          >
            {loading ? t("accountSetup.creating") : t("accountSetup.getStarted")}
          </button>
        </form>

        <p className="mt-4 text-xs text-center" style={{ color: "var(--text-muted)" }}>
          {t("accountSetup.localNote")}
        </p>
      </div>
    </div>
  );
}

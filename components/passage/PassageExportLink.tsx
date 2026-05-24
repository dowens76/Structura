"use client";

import Link from "next/link";
import { useState, useEffect } from "react";

interface Props {
  passageId: number;
}

export default function PassageExportLink({ passageId }: Props) {
  const base = `/export/passage/${passageId}`;

  function buildHref(): string {
    try {
      const raw = localStorage.getItem("structura:activeTranslations");
      const abbrs: string[] = raw ? JSON.parse(raw) : [];
      return abbrs.length > 0 ? `${base}?t=${abbrs.map(encodeURIComponent).join(",")}` : base;
    } catch { return base; }
  }

  const [href, setHref] = useState(base);
  useEffect(() => {
    setHref(buildHref());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  return (
    <Link
      href={href}
      className="text-xs px-2 py-1 rounded transition-colors"
      style={{ color: "var(--nav-fg)" }}
      onClick={(e) => {
        // Re-read localStorage at click time to guarantee the latest active
        // translations are used even if the useEffect hasn't re-run yet.
        const url = buildHref();
        if (url !== href) {
          e.preventDefault();
          window.location.href = url;
        }
      }}
    >
      Export →
    </Link>
  );
}

"use client";

import Link from "next/link";
import { useState, useEffect } from "react";

interface Props {
  passageId: number;
}

export default function PassageExportLink({ passageId }: Props) {
  const base = `/export/passage/${passageId}`;
  const [href, setHref] = useState(base);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("structura:activeTranslations");
      const abbrs: string[] = raw ? JSON.parse(raw) : [];
      setHref(abbrs.length > 0 ? `${base}?t=${abbrs.map(encodeURIComponent).join(",")}` : base);
    } catch { /* ignore */ }
  }, [base]);

  return (
    <Link
      href={href}
      target="_blank"
      className="text-xs px-2 py-1 rounded transition-colors"
      style={{ color: "var(--nav-fg)" }}
    >
      Export →
    </Link>
  );
}

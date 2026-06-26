"use client";

import { useRouter } from "next/navigation";

export default function NotFound() {
  const router = useRouter();

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center gap-4"
      style={{ backgroundColor: "var(--background)", color: "var(--foreground)" }}
    >
      <p className="text-lg font-medium">Book missing.</p>
      <button
        onClick={() => router.back()}
        className="px-4 py-2 rounded text-sm font-medium transition-colors bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700"
      >
        Return to last view.
      </button>
    </div>
  );
}

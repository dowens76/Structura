"use client";

import type { DisplayMode } from "@/lib/morphology/types";
import { useTranslation } from "@/lib/i18n/LocaleContext";

interface DisplayModeToggleProps {
  mode: DisplayMode;
  onChange: (mode: DisplayMode) => void;
}

export default function DisplayModeToggle({ mode, onChange }: DisplayModeToggleProps) {
  const { t } = useTranslation();

  const MODES: { value: DisplayMode; label: string; title: string }[] = [
    { value: "clean", label: t("toolbar.displayClean"), title: t("toolbar.titleClean") },
    { value: "color", label: t("toolbar.displayColor"), title: t("toolbar.titleColor") },
    { value: "interlinear", label: t("toolbar.displayInterlinear"), title: t("toolbar.titleInterlinear") },
  ];

  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-stone-400 dark:text-stone-500 mr-1">{t("toolbar.displayLabel")}</span>
      {MODES.map(({ value, label, title }) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          title={title}
          className={[
            "px-2.5 py-1 rounded text-xs font-medium transition-colors",
            mode === value
              ? "bg-blue-600 text-white"
              : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
          ].join(" ")}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

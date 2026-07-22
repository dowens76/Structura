"use client";

import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger";
type Size = "md" | "sm";

const SIZE_CLASSES: Record<Size, string> = {
  md: "px-4 py-2 text-sm",
  sm: "px-3 py-1.5 text-xs",
};

const BASE = "rounded-lg font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

/**
 * Shared button for the primary/secondary/danger actions used across the
 * app's Manage pages (Save, Create, Download, Export, Delete, Restore…).
 * Defaults to `type="button"` — pass `type="submit"` explicitly for a
 * form's submit action. Use `size="sm"` for a compact action next to a
 * heading (e.g. "Export CSV") rather than overriding padding via
 * `className` — Tailwind's utility ordering doesn't reliably let a
 * caller-supplied class beat one already baked into the component.
 */
export default function Button({
  variant = "primary",
  size = "md",
  type = "button",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  const sizeCls = SIZE_CLASSES[size];
  if (variant === "secondary") {
    return (
      <button
        type={type}
        className={`${BASE} ${sizeCls} border hover:opacity-80 ${className}`}
        style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--foreground)" }}
        {...rest}
      />
    );
  }
  if (variant === "danger") {
    return (
      <button
        type={type}
        className={`${BASE} ${sizeCls} bg-red-600 hover:bg-red-700 text-white ${className}`}
        {...rest}
      />
    );
  }
  return (
    <button
      type={type}
      className={`${BASE} ${sizeCls} text-white hover:opacity-90 ${className}`}
      style={{ backgroundColor: "var(--accent)" }}
      {...rest}
    />
  );
}

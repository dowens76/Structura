"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import type { Book } from "@/lib/db/schema";
import { useTranslation } from "@/lib/i18n/LocaleContext";

interface Props {
  books: Book[];
  currentOsisBook: string;
  textSource: string;
}

/** Resolve which URL source to use when navigating to a book from the dropdown. */
function targetSource(book: Book, currentSource: string): string {
  if (book.textSource === "SBLGNT") return "SBLGNT";
  // OT/LXX book: if the user is currently in LXX, keep them in LXX; otherwise OSHB.
  if (currentSource === "STEPBIBLE_LXX") return "STEPBIBLE_LXX";
  return "OSHB";
}

export default function BookDropdown({ books, currentOsisBook, textSource }: Props) {
  const { t, bookName: getBookName } = useTranslation();
  const bookName = getBookName(currentOsisBook);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (ref.current && !ref.current.contains(e.target as Node)) {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    } else {
      document.removeEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, handleClickOutside]);

  const hasLXXExtra = books.some((b) => b.testament === "LXX");
  const hasNT = books.some((b) => b.testament === "NT");

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors"
        style={{ color: "var(--nav-fg)" }}
        title={t("nav.titleJumpToBook")}
      >
        <span className="max-w-[7rem] truncate">{bookName}</span>
        <span className="text-[10px] opacity-60">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1 w-52 rounded-lg shadow-xl border z-50 overflow-hidden"
          style={{ backgroundColor: "var(--background)", borderColor: "var(--border)" }}
        >
          <div className="max-h-72 overflow-y-auto py-1">
            {books.map((book, idx) => {
              const isCurrent = book.osisCode === currentOsisBook;
              const src = targetSource(book, textSource);
              const prevBook = idx > 0 ? books[idx - 1] : null;
              const showLXXDivider = hasLXXExtra && book.testament === "LXX" && prevBook?.testament !== "LXX";
              const showNTDivider  = hasNT && book.testament === "NT" && prevBook?.testament !== "NT";

              return (
                <div key={book.osisCode}>
                  {showLXXDivider && (
                    <div
                      className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest"
                      style={{ color: "var(--text-muted)", borderTop: "1px solid var(--border)" }}
                    >
                      Additional Books
                    </div>
                  )}
                  {showNTDivider && (
                    <div
                      className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest"
                      style={{ color: "var(--text-muted)", borderTop: "1px solid var(--border)" }}
                    >
                      New Testament
                    </div>
                  )}
                  <Link
                    href={`/${encodeURIComponent(book.osisCode)}/${src}/1`}
                    onClick={() => setOpen(false)}
                    className="flex items-center justify-between px-3 py-1.5 text-xs transition-colors hover:opacity-80"
                    style={
                      isCurrent
                        ? { backgroundColor: "var(--accent)", color: "#fff", fontWeight: 600 }
                        : { color: "var(--foreground)" }
                    }
                  >
                    <span>{getBookName(book.osisCode)}</span>
                    <span
                      className="text-[10px] shrink-0 ml-2"
                      style={{ opacity: isCurrent ? 0.75 : 0.45 }}
                    >
                      {book.chapterCount}{t("nav.chSuffix")}
                    </span>
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

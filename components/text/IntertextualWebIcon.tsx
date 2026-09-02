"use client";

/**
 * Nested-hexagon "web" icon used to represent intertextual connections.
 * Shared between the Intertextual Links toolbar toggle (ChapterDisplay.tsx)
 * and the per-verse indicator under each verse-number label
 * (VerseDisplay.tsx) so both stay visually identical.
 */
export default function IntertextualWebIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <line x1="8" y1="8" x2="8" y2="1" stroke="currentColor" strokeWidth="0.8"/>
      <line x1="8" y1="8" x2="14.1" y2="4.5" stroke="currentColor" strokeWidth="0.8"/>
      <line x1="8" y1="8" x2="14.1" y2="11.5" stroke="currentColor" strokeWidth="0.8"/>
      <line x1="8" y1="8" x2="8" y2="15" stroke="currentColor" strokeWidth="0.8"/>
      <line x1="8" y1="8" x2="1.9" y2="11.5" stroke="currentColor" strokeWidth="0.8"/>
      <line x1="8" y1="8" x2="1.9" y2="4.5" stroke="currentColor" strokeWidth="0.8"/>
      <path d="M8 5.7 L9.99 6.85 L9.99 9.15 L8 10.3 L6.01 9.15 L6.01 6.85 Z" stroke="currentColor" strokeWidth="0.75" fill="none"/>
      <path d="M8 3.4 L11.98 5.7 L11.98 10.3 L8 12.6 L4.02 10.3 L4.02 5.7 Z" stroke="currentColor" strokeWidth="0.75" fill="none"/>
      <path d="M8 1 L14.06 4.5 L14.06 11.5 L8 15 L1.94 11.5 L1.94 4.5 Z" stroke="currentColor" strokeWidth="0.75" fill="none"/>
    </svg>
  );
}

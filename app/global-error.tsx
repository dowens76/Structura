"use client";

// Next.js renders this in place of its bare "Internal Server Error" text
// whenever an error escapes every route/layout boundary. global-error.tsx
// must define its own <html>/<body> since it replaces the root layout.
// Without this file, users get zero information about what actually failed —
// just the literal words "Internal Server Error" and nothing else.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 720, margin: "0 auto" }}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Structura ran into a problem</h1>
        <p style={{ color: "#666" }}>
          The app hit an unexpected server error. The details below can help diagnose the issue.
        </p>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            background: "#f5f5f4",
            border: "1px solid #e7e5e4",
            borderRadius: 6,
            padding: "1rem",
            fontSize: "0.85rem",
            overflow: "auto",
          }}
        >
          {error.message || String(error)}
          {error.digest ? `\n\nDigest: ${error.digest}` : ""}
          {error.stack ? `\n\n${error.stack}` : ""}
        </pre>
        <button
          onClick={() => reset()}
          style={{
            marginTop: "1rem",
            padding: "0.5rem 1rem",
            borderRadius: 6,
            border: "1px solid #d6d3d1",
            background: "#fff",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}

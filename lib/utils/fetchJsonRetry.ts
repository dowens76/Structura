/**
 * Fetches JSON with a single retry on failure, logging a console error if both
 * attempts fail. Used for status checks (e.g. "is a credential configured?")
 * where a transient network/server hiccup must not be indistinguishable from
 * a confirmed "not configured" response — callers should leave prior state
 * untouched when this returns null, rather than defaulting to a negative/empty
 * state that looks identical to genuine absence.
 */
export async function fetchJsonRetry<T>(
  url: string,
  { retries = 1, delayMs = 1200 }: { retries?: number; delayMs?: number } = {}
): Promise<T | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url} → ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      if (attempt === retries) {
        console.error(`[fetchJsonRetry] giving up on ${url} after ${attempt + 1} attempt(s):`, err);
        return null;
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return null;
}

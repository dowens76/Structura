/** Escapes a single CSV field per RFC 4180: wraps in double quotes if it
 *  contains a comma, quote, or newline, doubling any embedded quotes.
 *  null/undefined become an empty field. */
export function csvField(val: unknown): string {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (/[,"\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

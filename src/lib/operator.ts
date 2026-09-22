/**
 * Operating-carrier text normalization.
 *
 * Extracted verbatim from the text parser so that BOTH the generic parser and
 * the Google Flights / Style C parser normalize "Operated by …" text through
 * exactly ONE implementation. `parser.ts` re-exports `cleanOperator`, so every
 * existing import path keeps working unchanged.
 */

export function cleanOperator(raw: string): string | null {
  // Keep the operator's full trading name ("SKYWEST DBA UNITED EXPRESS").
  // Only strip trailing codeshare flight references and stray punctuation.
  let op = raw
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+as\s+flight\b.*$/i, "")
    .replace(/\s+(?:flight|flt)\s*[A-Z]{0,3}\s*\d{1,4}\s*$/i, "")
    .replace(/[.。,;:]+$/, "")
    .replace(/\)+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!op || op.length < 2 || op.length > 70) return null;
  return op.toUpperCase();
}

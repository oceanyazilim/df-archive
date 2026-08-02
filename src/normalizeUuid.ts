/**
 * UUID normalization.
 *
 * Both the UUID coming from the API and the UUID values in the mapping file are
 * passed through this function before comparison. Matching is EXACT after
 * normalization — no partial, fuzzy, or similarity matching is ever performed.
 */

/**
 * Normalize a raw UUID-ish value to its canonical comparison form.
 *
 * Steps:
 *  - reject null / undefined
 *  - coerce to string
 *  - trim surrounding whitespace
 *  - strip a single layer of accidental surrounding quotes (" ' ` )
 *  - trim again (in case quotes wrapped padded whitespace)
 *  - lowercase
 *  - remove standard UUID hyphens WHEN the de-hyphenated form is a canonical
 *    32-hex UUID (so "ede63b46-782e-46e1-9045-255f32c0ff0f" matches the stored
 *    "ede63b46782e46e19045255f32c0ff0f"); other values keep their hyphens
 *  - reject empty results
 *
 * @returns the normalized string, or `null` when the input cannot yield a
 *          usable UUID (null/undefined/empty).
 */
export function normalizeUuid(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;

  let value = String(raw).trim();
  if (value.length === 0) return null;

  value = stripSurroundingQuotes(value).trim();
  if (value.length === 0) return null;

  value = value.toLowerCase();

  // Only collapse hyphens when the result is a canonical 32-hex UUID; this keeps
  // matching exact and avoids mangling unrelated hyphenated strings.
  const dehyphenated = value.replace(/-/g, "");
  if (/^[0-9a-f]{32}$/.test(dehyphenated)) {
    value = dehyphenated;
  }

  return value.length > 0 ? value : null;
}

const QUOTE_PAIRS: Array<[string, string]> = [
  ['"', '"'],
  ["'", "'"],
  ["`", "`"],
];

function stripSurroundingQuotes(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  for (const [open, close] of QUOTE_PAIRS) {
    if (first === open && last === close) {
      return value.slice(1, -1);
    }
  }
  return value;
}

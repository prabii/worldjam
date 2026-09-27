/**
 * Search text normalisation shared by indexing and querying, so "Café-Glass!"
 * is stored and searched as "cafe glass". Both FTS4 (phone and Jest) and the
 * LIKE fallback work on this normalised form.
 */

export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0080-￿]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function tokens(query: string): string[] {
  const norm = normalizeText(query);
  return norm ? norm.split(' ').slice(0, 8) : [];
}

/**
 * FTS4 MATCH expression: every word must match as a prefix ("gla" finds
 * "glass"). Tokens are already stripped to lowercase [a-z0-9…], so none can
 * be read as FTS syntax (operators like OR/NEAR are only recognised in upper
 * case).
 */
export function ftsQuery(query: string): string | null {
  const t = tokens(query);
  if (t.length === 0) return null;
  return t.map((w) => `${w}*`).join(' ');
}

/** Builds the indexed body from the fields a search should cover. */
export function searchBody(parts: Array<string | null | undefined>): string {
  return normalizeText(parts.filter(Boolean).join(' '));
}

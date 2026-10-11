// What a requirement declaration looks like, in one place.
//
// This shape is load-bearing in a way a normal parser detail is not. A
// requirement written in a specification but shaped slightly wrong is not
// reported, not half-read: it is absent from protocol/requirements.json, and
// therefore absent from the traceability suite of every implementation that
// consumes the inventory. The failure is silent and it is the failure mode
// this module exists to make loud, so both the parser and its guard read the
// same expressions rather than each carrying a private copy that can drift.

// A declaration is a list item whose bold text is a requirement identifier,
// followed by the EARS qualifier in parentheses and a colon.
export const RF_DECLARATION =
  /^\s*[-*]\s+\*\*(RF-[A-Z]?\d+)\*\*\s*\(([^)]+)\)\s*:\s*(\S.*)$/;

// One RF-looking token: `RF-O08a` is one, the two halves of a range such as
// `RF-W28-RF-W34` are two.
const RF_TOKEN = /\bRF-[A-Za-z0-9]+\b/g;

/**
 * Reports lines that read as a declaration but that RF_DECLARATION cannot
 * parse, as `{ line, identifier }`. Returns an empty array for a specification
 * whose declarations are all well formed.
 *
 * Telling a malformed declaration apart from prose that merely mentions
 * identifiers is not something a shape can do on its own, so the candidate
 * test is deliberately narrow and each clause excludes text that really does
 * occur in this repository's specifications:
 *
 *   - a list item, because that is where declarations live and a table row or
 *     a running paragraph is not a declaration at all;
 *   - bold text naming exactly one identifier, because a bold range such as
 *     `RF-W28-RF-W34` is two and is a mention, not a declaration;
 *   - followed by a qualifier that contains no identifier of its own. This is
 *     what separates `**RF-O08a** (Ubiquity):` from prose like
 *     `**RF-V12** (and RF-V13) are covered`, where the parenthetical is
 *     pointing at another requirement rather than naming an EARS qualifier;
 *   - or followed by a colon, which is a declaration that lost its qualifier.
 *
 * A guard with false positives is a guard that gets switched off, and a guard
 * that has been switched off fails exactly as silently as the accident this
 * module exists to catch. When in doubt it stays quiet.
 */
export function findUnparseableDeclarations(text) {
  const found = [];

  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.replace(/\r$/, '');
    if (RF_DECLARATION.test(line)) continue;

    const bold = line.match(/^\s*[-*]\s+\*\*(RF-[^*]+)\*\*\s*(.*)$/);
    if (!bold) continue;

    const identifier = bold[1].trim();
    if (identifier.match(RF_TOKEN)?.length !== 1) continue;

    const qualifier = bold[2].match(/^\(([^)]*)\)/);
    const lostItsQualifier = bold[2].startsWith(':');
    if (!qualifier && !lostItsQualifier) continue;
    if (qualifier && RF_TOKEN.test(qualifier[1])) {
      RF_TOKEN.lastIndex = 0;
      continue;
    }

    found.push({ line: index + 1, identifier });
  }

  return found;
}
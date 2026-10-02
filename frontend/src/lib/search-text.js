// PHASE-09 search normalization. Matching runs on normalized strings; the
// highlight must land on the ORIGINAL string, so highlightSegments() builds a
// per-code-point normalization map instead of slicing the normalized text
// (NFKC changes lengths, e.g. fullwidth → ascii, ligatures → multiple chars).
export function normalizeSearchText(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('zh-Hans-CN').trim();
}

export function matchesSearch(haystack, query) {
  const q = normalizeSearchText(query);
  if (!q) return true;
  return normalizeSearchText(haystack).includes(q);
}

function buildNormalizedIndexMap(original) {
  const chars = Array.from(String(original ?? ''));
  let normalized = '';
  const map = [];
  for (let index = 0; index < chars.length; index++) {
    const part = chars[index].normalize('NFKC').toLocaleLowerCase('zh-Hans-CN');
    for (let i = 0; i < part.length; i++) map.push(index);
    normalized += part;
  }
  return { normalized, map, charCount: chars.length };
}

// Returns [{ text, hit, first }] over the original string. When the normalized
// match cannot be mapped back onto the original (rare cross-codepoint
// composition), falls back to one unhilite segment — matching still succeeded,
// only the highlight is dropped.
export function highlightSegments(original, query) {
  const text = String(original ?? '');
  const q = normalizeSearchText(query);
  if (!q) return [{ text, hit: false, first: false }];

  const { normalized, map, charCount } = buildNormalizedIndexMap(text);
  const at = normalized.indexOf(q);
  if (at === -1) return [{ text, hit: false, first: false }];

  const startChar = map[at];
  const endChar = map[at + q.length - 1];
  if (startChar === undefined || endChar === undefined) return [{ text, hit: false, first: false }];

  const segments = [];
  const chars = Array.from(text);
  if (startChar > 0) segments.push({ text: chars.slice(0, startChar).join(''), hit: false, first: false });
  segments.push({ text: chars.slice(startChar, endChar + 1).join(''), hit: true, first: true });
  if (endChar + 1 < charCount) segments.push({ text: chars.slice(endChar + 1).join(''), hit: false, first: false });
  return segments.filter(segment => segment.text !== '');
}

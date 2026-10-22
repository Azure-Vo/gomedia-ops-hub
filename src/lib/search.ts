// Vietnamese-friendly text search for pickers: accents and case are ignored, so "quay dung" finds "Quay dựng".

/** Lowercase, strip diacritics (đ → d), collapse spaces. */
export function normalizeVi(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Scores how well `query` matches an item. 0 = no match. Every query word must appear in `name` or in
 * one of the `extra` fields (code, group, unit). Matches in the name, at the start of the name or at the
 * start of a word score higher, so the closest names come first.
 */
export function searchScore(query: string, name: string, extra: string[] = []): number {
  const words = normalizeVi(query).split(' ').filter(Boolean);
  if (!words.length) return 1;
  const n = normalizeVi(name);
  const rest = normalizeVi(extra.join(' '));
  let score = 0;
  for (const w of words) {
    const i = n.indexOf(w);
    if (i === 0) score += 6;
    else if (i > 0 && n[i - 1] === ' ') score += 4;
    else if (i > 0) score += 2;
    else if (rest.includes(w)) score += 1;
    else return 0;
  }
  if (n.startsWith(normalizeVi(query))) score += 3;
  return score;
}

// Frontend mirror of the backend derivePrettyNameSlug recipe (see
// src/backend/utils/pretty-name-slug.ts). Used by create-flow dialogs to
// gate "the name would reduce to at least one letter" validation at type-
// time, so users see inline feedback before clicking Create.
//
// Pretty-names shape (2026-09-30) § Philosophy "one rule, uniformly
// applied": both ends of the wire run the same derivation. Backend remains
// authoritative — the frontend preview is a UX hint, not a security gate.

const DIGIT_WORDS: readonly string[] = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
];

export const PRETTY_NAME_MAX_LEN = 80;

/**
 * Compute the slug the backend would derive for a typed pretty name.
 * Returns an empty string when the input is empty, over the length cap,
 * or reduces to zero letters after slugification — the caller treats
 * empty-string as "invalid, show validation error".
 */
export function previewSlugFromPrettyName(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > PRETTY_NAME_MAX_LEN) return "";
  const spelled = trimmed
    .toLowerCase()
    .replace(/[0-9]/g, (d) => ` ${DIGIT_WORDS[Number(d)]} `);
  return spelled.replace(/[^a-z]+/g, "-").replace(/^-+|-+$/g, "");
}

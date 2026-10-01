/**
 * Backend-authoritative slug derivation from a user-typed pretty name.
 *
 * Shared across roles, identities (name-it-myself path), and projects at
 * create-time. The user types a pretty name — the system derives a safe
 * slug via one uniform recipe so the three entity types agree on charset,
 * length, and collision behavior.
 *
 * Recipe:
 *   1. Trim.
 *   2. Reject if empty, or if longer than 80 characters.
 *   3. Fold to lowercase.
 *   4. Spell out digits 0-9 as English words (zero, one, two, …, nine),
 *      each surrounded by spaces so adjacent letters don't fuse to a
 *      made-up word.
 *   5. Replace any run of non-[a-z] characters with a single dash.
 *   6. Trim leading / trailing dashes.
 *   7. Reject if the resulting slug has no letters (all-emoji input,
 *      all-whitespace, all-punctuation).
 *
 * Output of a successful derivation is `[a-z]+(-[a-z]+)*` — pure lowercase
 * letters and dashes. The absence of digits in a user-derived slug is
 * load-bearing: it means any digit appearing in a slug on disk is
 * unambiguously a system-appended collision marker (see auto-suffix helper).
 */

export const PRETTY_NAME_MAX_LEN = 80;

export type SlugResult =
  | { ok: true; slug: string }
  | { ok: false; reason: "empty" | "too_long" | "unslugifiable" };

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

function spellOutDigits(input: string): string {
  return input.replace(/[0-9]/g, (d) => ` ${DIGIT_WORDS[Number(d)]} `);
}

export function derivePrettyNameSlug(input: string): SlugResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (trimmed.length > PRETTY_NAME_MAX_LEN) {
    return { ok: false, reason: "too_long" };
  }
  const spelled = spellOutDigits(trimmed.toLowerCase());
  const dashed = spelled.replace(/[^a-z]+/g, "-").replace(/^-+|-+$/g, "");
  if (dashed.length === 0) {
    return { ok: false, reason: "unslugifiable" };
  }
  return { ok: true, slug: dashed };
}

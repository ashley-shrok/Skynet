// A typed name → the kebab-case slug used for role, skill and runbook
// folders (diacritics dropped, anything else non-alphanumeric → "-").
export function slugifyRoleName(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

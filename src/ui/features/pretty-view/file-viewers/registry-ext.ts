/**
 * Filename helpers with no imports, so viewer modules can use them without
 * a circular import through registry.ts.
 */

/** Lower-cased extension without the dot, or null (dotfiles count as none). */
export function extensionOf(filename: string): string | null {
  const base = filename.slice(filename.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return null;
  return base.slice(dot + 1).toLowerCase();
}

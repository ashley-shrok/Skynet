/**
 * Icon URL for an app tile. With the sweep's icon version appended as `?v=`
 * the server marks the bytes immutable, so the browser keeps them across
 * remounts (collapse/expand of the Apps section) instead of refetching; a
 * changed icon arrives as a new version, i.e. a new URL.
 *
 * Both parts are encoded as defence-in-depth — the wire gates them today
 * (hostId numeric, slug kebab-case).
 */
export function appIconUrl(
  hostId: string | number,
  slug: string,
  iconVersion: string | null | undefined,
): string {
  const base = `/apps/${encodeURIComponent(String(hostId))}/${encodeURIComponent(slug)}/icon`;
  return iconVersion ? `${base}?v=${encodeURIComponent(iconVersion)}` : base;
}

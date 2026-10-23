// convo-scoped apps: app links and the "open this app" bridge.
//
// An agent hands an app to the user by linking its pane address,
// `<skynet-origin>/apps/<hostId>/<slug>/pane/`. The chat renders such a link
// as an app chip (AppChip); clicking it — or a row in the identity modal's
// Apps tab — asks the shell to open the app exactly like a sidebar tile click.
// The shell listens for OPEN_APP_EVENT (AppShell), so surfaces deep in the
// conversation tree don't need the shell's callbacks threaded down to them.

/** Drag MIME shared with sidebar app tiles — the split view already accepts it. */
export const APP_TILE_MIME = "application/x-skynet-app-tile";

export const OPEN_APP_EVENT = "skynet:open-app";

export interface AppAddress {
  hostId: number;
  slug: string;
}

export interface OpenAppDetail extends AppAddress {
  title: string;
}

const APP_PANE_PATH_RE = /^\/apps\/([1-9][0-9]{0,9})\/([a-z0-9-]{1,64})\/pane(?:\/.*)?$/;

/**
 * Parse an app pane link into its (hostId, slug). Accepts the same-origin
 * absolute form agents write and the root-relative form; anything else
 * (other origins, other paths) returns null and stays a plain link.
 */
export function parseSkynetAppUrl(href: string | undefined | null): AppAddress | null {
  if (!href) return null;
  let pathname: string;
  try {
    const u = new URL(href, window.location.origin);
    if (u.origin !== window.location.origin) return null;
    pathname = u.pathname;
  } catch {
    return null;
  }
  const m = APP_PANE_PATH_RE.exec(pathname);
  if (!m) return null;
  return { hostId: Number(m[1]), slug: m[2] };
}

export function requestOpenApp(detail: OpenAppDetail): void {
  window.dispatchEvent(new CustomEvent<OpenAppDetail>(OPEN_APP_EVENT, { detail }));
}

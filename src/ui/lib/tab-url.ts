// URL-encoded workspace addressing so Chrome tab-restore preserves the
// full Termix tab set in each browser tab. See patches #25 (single tab),
// #34 (only=1 marker), #35 (multi-tab).
//
// State lives in the URL FRAGMENT (hash), NOT the query string. Chrome's
// window-restore code path (Ctrl+Shift+T after closing a whole window) reverts
// to the canonical navigation URL and drops replaceState'd query params — the
// fragment survives because Chrome treats it as part of the URL identity.
//
// Wire URL form:
//   #tab=<spec>[&tab=<spec>...][&active=<index>][&only=1]
// Each <spec>:
//   tmux:<host>:<session-name>   attach named tmux session on SSH host
//   terminal:<host>              plain SSH terminal (Windows / non-tmux hosts)
//   rdp:<host>                   RDP via guacamole
//   vnc:<host>                   VNC via guacamole
//   telnet:<host>                telnet via guacamole
//
// active=<N> is the zero-based index (within the emitted `tab=` list) of the
// tab that should be focused on restore. Omitted if the active tab isn't
// URL-addressable (e.g. Dashboard).
//
// only=1 is a one-shot marker set ONLY by Move-to-new-window (patch #34).
// Tells AppShell.loadSavedTabs to skip the persisted-tab rehydrate pass so
// the new Chrome tab shows JUST the URL's tabs. The ambient URL-sync effect
// never sets it, preserving `reopenTabsOnLogin` compatibility.
//
// Legacy `?tab=` query form is also accepted on parse for bookmarks predating
// patch #25, and single-tab bookmarks (`#tab=one:spec`) predating patch #35
// still parse as a length-1 workspace.
//
// The <host> component is the host record's `name` field (case-insensitive
// lookup); numeric IDs work as a rename-fallback (`#tab=rdp:7`).
//
// Persistence: snapshot the URL into sessionStorage at page load BEFORE any
// auth-flow replaceState can strip it — sessionStorage is per-Chrome-tab.
// AppShell consumes it after tabs are restored, then clears it.

import type { TabType } from "@/types/ui-types";

const STORAGE_KEY = "termix_pending_tab";

export interface TabSpec {
  protocol: "tmux" | "terminal" | "rdp" | "vnc" | "telnet";
  host: string;
  session?: string;
}

// Full workspace state carried in the URL: an ordered list of tab specs,
// optional active-index, optional one-shot `only` marker, and (phase 6)
// an optional `mobileView` marker indicating "the user is on the mobile
// view screen right now, not the list screen." Only mobile viewports
// consume the flag; desktop ignores it. See src/ui/lib/mobile-flow.ts.
// Lives in the URL fragment for the same Chrome-window-restore reason
// the `tab=` scheme does — see the module doc-comment above.
export interface WorkspaceSpec {
  tabs: TabSpec[];
  activeIndex?: number;
  only?: boolean;
  mobileView?: boolean;
}

const PROTOCOLS: TabSpec["protocol"][] = [
  "tmux",
  "terminal",
  "rdp",
  "vnc",
  "telnet",
];

export function parseTabParam(raw: string | null): TabSpec | null {
  if (!raw) return null;
  const idx1 = raw.indexOf(":");
  if (idx1 === -1) return null;
  const protocol = raw.slice(0, idx1) as TabSpec["protocol"];
  if (!PROTOCOLS.includes(protocol)) return null;
  const rest = raw.slice(idx1 + 1);
  if (protocol === "tmux") {
    const idx2 = rest.indexOf(":");
    if (idx2 === -1) return null;
    const host = decodeURIComponent(rest.slice(0, idx2));
    const session = decodeURIComponent(rest.slice(idx2 + 1));
    if (!host || !session) return null;
    return { protocol, host, session };
  }
  const host = decodeURIComponent(rest);
  if (!host) return null;
  return { protocol, host };
}

export function encodeTabSpec(spec: TabSpec): string {
  const parts = [spec.protocol, encodeURIComponent(spec.host)];
  if (spec.protocol === "tmux" && spec.session) {
    parts.push(encodeURIComponent(spec.session));
  }
  return parts.join(":");
}

// Build the fragment payload from a WorkspaceSpec:
// tab=X&tab=Y[&active=N][&only=1]. URLSearchParams handles the multi-value
// tab= keys natively.
export function encodeWorkspaceSpec(ws: WorkspaceSpec): string {
  const params = new URLSearchParams();
  for (const spec of ws.tabs) {
    params.append("tab", encodeTabSpec(spec));
  }
  if (
    typeof ws.activeIndex === "number" &&
    ws.activeIndex >= 0 &&
    ws.activeIndex < ws.tabs.length
  ) {
    params.set("active", String(ws.activeIndex));
  }
  if (ws.only) params.set("only", "1");
  if (ws.mobileView) params.set("mv", "1");
  return params.toString();
}

// Derive the wire spec from a Tab-shaped input. Returns null for tabs that
// aren't URL-addressable (dashboard, singletons without a host).
export function specForTab(input: {
  type: TabType;
  host?: { name?: string; id?: string };
  targetTmuxSession?: string | null;
}): TabSpec | null {
  if (!input.host?.name) return null;
  const host = input.host.name;
  if (input.type === "terminal") {
    if (input.targetTmuxSession) {
      return { protocol: "tmux", host, session: input.targetTmuxSession };
    }
    return { protocol: "terminal", host };
  }
  if (input.type === "rdp" || input.type === "vnc" || input.type === "telnet") {
    return { protocol: input.type, host };
  }
  return null;
}

// Read the full workspace payload from the URL. Prefers hash form
// (#tab=...&tab=...), falls back to query form (?tab=...) for legacy
// bookmarks predating patch #25. Preserves ALL tab= values plus active
// and only. Returns null if no tab param present.
function readTabPayloadFromUrl(): string | null {
  if (typeof window === "undefined") return null;

  const build = (p: URLSearchParams): string | null => {
    const tabs = p.getAll("tab");
    if (tabs.length === 0) return null;
    const out = new URLSearchParams();
    for (const t of tabs) out.append("tab", t);
    const active = p.get("active");
    if (active !== null) out.set("active", active);
    if (p.get("only") === "1") out.set("only", "1");
    if (p.get("mv") === "1") out.set("mv", "1");
    return out.toString();
  };

  const hash = window.location.hash;
  if (hash.length > 1) {
    const payload = build(new URLSearchParams(hash.slice(1)));
    if (payload) return payload;
  }
  return build(new URLSearchParams(window.location.search));
}

// Called at module load in main.tsx BEFORE the React tree renders. Reads the
// URL and stashes into sessionStorage so it survives every downstream
// replaceState (auth flow, OIDC, etc.). sessionStorage is per-Chrome-tab, so a
// browser with N Termix tabs open holds N independent pending workspaces.
export function snapshotPendingTab(): void {
  if (typeof window === "undefined") return;
  try {
    const payload = readTabPayloadFromUrl();
    if (payload) window.sessionStorage.setItem(STORAGE_KEY, payload);
  } catch {
    // sessionStorage may be blocked (private mode with strict setting) — the
    // URL fallback in consumePendingWorkspace still works if the hash survives.
  }
}

// Consumed once by AppShell after tabs are ready. Prefers sessionStorage
// (which survives auth-flow URL-stripping), falls back to the current URL.
// Returns the full workspace spec (or null if no tab param decoded).
export function consumePendingWorkspace(): WorkspaceSpec | null {
  if (typeof window === "undefined") return null;
  let payload: string | null = null;
  try {
    payload = window.sessionStorage.getItem(STORAGE_KEY);
    if (payload) window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  if (!payload) payload = readTabPayloadFromUrl();
  if (!payload) return null;
  const params = new URLSearchParams(payload);
  const tabs = params.getAll("tab").map(parseTabParam).filter(
    (t): t is TabSpec => t !== null,
  );
  if (tabs.length === 0) return null;
  const ws: WorkspaceSpec = { tabs };
  const activeRaw = params.get("active");
  if (activeRaw !== null) {
    const n = parseInt(activeRaw, 10);
    if (Number.isFinite(n) && n >= 0 && n < tabs.length) {
      ws.activeIndex = n;
    }
  }
  if (params.get("only") === "1") ws.only = true;
  // Phase 6 (mobile-flow.ts): `mv=1` means "the user is on the mobile view
  // screen." Strict boolean coerce — only exact `1` counts. Absent, or any
  // other value (including `0`, `yes`, `true`), parses to `mobileView: false`
  // (via the field being undefined). See mobile-flow.ts for the reader path.
  if (params.get("mv") === "1") ws.mobileView = true;
  return ws;
}

// Push a WorkspaceSpec into the URL fragment via replaceState (no history
// entry). null clears any existing #tab=. Called from AppShell's URL-sync
// effect on every tab-set / active-tab / tmux-session change.
//
// We use the fragment specifically because Chrome's window-restore code path
// (Ctrl+Shift+T after closing a whole window) doesn't preserve replaceState'd
// query params, but does preserve the fragment.
//
// Patch #132 Fix B: `mv=` semantics on write. mobile-flow.ts's
// navigateToView / navigateToList are the AUTHORITATIVE writers of the
// `mv=` flag. This writer's rule:
//   - ws === null                 → strip mv= (clearing the whole workspace)
//   - ws.mobileView === true      → set mv=1 (spec wins; supports URL restore)
//   - ws.mobileView === false     → strip mv= (explicit clear)
//   - ws.mobileView === undefined → PRESERVE whatever mv= is currently in
//                                    the URL
// The undefined-preserves-URL branch is what breaks the bounce race:
// AppShell's URL sync effect passes `mobileView` as `mobileScreen === "view"
// ? true : undefined`, and a transient `mobileScreen === "list"` no longer
// strips a live mv=1 — it just doesn't touch it. mobile-flow retains
// exclusive ownership of when mv= disappears.
// Also PRESERVES current history.state instead of wiping it with `{}` — the
// wipe used to clobber navigateToView's sentinel and force navigateToList
// into its URL-rewrite fallback path (see mobile-flow.ts:119-149).
export function writeWorkspaceToUrl(ws: WorkspaceSpec | null): void {
  if (typeof window === "undefined") return;
  const payload = ws && ws.tabs.length > 0 ? encodeWorkspaceSpec(ws) : "";
  // Resolve final mv= per the rule table above.
  let finalMv: "1" | null;
  if (ws === null) {
    finalMv = null;
  } else if (ws.mobileView === true) {
    finalMv = "1";
  } else if (ws.mobileView === false) {
    finalMv = null;
  } else {
    const currentHashParams = new URLSearchParams(
      window.location.hash.slice(1),
    );
    finalMv = currentHashParams.get("mv") === "1" ? "1" : null;
  }
  // `encodeWorkspaceSpec` only emits mv=1 when ws.mobileView===true; reset
  // via a fresh URLSearchParams pass so `finalMv` is authoritative.
  let nextHash = "";
  if (payload) {
    const p = new URLSearchParams(payload);
    p.delete("mv");
    if (finalMv === "1") p.set("mv", "1");
    nextHash = `#${p.toString()}`;
  }
  const currentHash = window.location.hash;
  // Also strip any legacy ?tab= that might be lurking from a bookmarked pre-hash URL.
  const params = new URLSearchParams(window.location.search);
  params.delete("tab");
  params.delete("active");
  params.delete("only");
  params.delete("mv");
  const qs = params.toString();
  const nextSearch = qs ? `?${qs}` : "";
  const nextUrl = window.location.pathname + nextSearch + nextHash;
  if (currentHash === nextHash && window.location.search === nextSearch) return;
  // Preserve existing history.state so navigateToView's sentinel survives.
  window.history.replaceState(window.history.state, "", nextUrl);
}

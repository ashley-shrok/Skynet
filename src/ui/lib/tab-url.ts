// URL-encoded tab addressing so Chrome tab-restore preserves the active Termix
// session in each browser tab. See patch 25.
//
// State lives in the URL FRAGMENT (hash), NOT the query string. Chrome's
// window-restore code path (Ctrl+Shift+T after closing a whole window) reverts
// to the canonical navigation URL and drops replaceState'd query params — the
// fragment survives because Chrome treats it as part of the URL identity.
//
// Wire URL forms accepted / emitted:
//   #tab=tmux:<host>:<session-name>   attach/create named tmux session on SSH host
//   #tab=terminal:<host>              plain SSH terminal (Windows / non-tmux hosts)
//   #tab=rdp:<host>                   RDP via guacamole
//   #tab=vnc:<host>                   VNC via guacamole
//   #tab=telnet:<host>                telnet via guacamole
//
// Legacy `?tab=` query form is also accepted on parse for bookmarks predating
// the switch, but new URLs are always written to the hash.
//
// The <host> component is the host record's `name` field (case-insensitive lookup);
// numeric IDs work too as a rename-fallback (`#tab=rdp:7`).
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
  // One-shot marker: when true, AppShell.loadSavedTabs skips the
  // persisted-tab rehydrate pass and only opens this URL's target.
  // Set by the "Move to new window" tab-context-menu action (patch #34)
  // so the new Chrome tab shows JUST the moved tab instead of restoring
  // the source window's whole persisted set. Not preserved on tab-switch
  // URL rewrites — the natural `writeTabToUrl` scrub strips it within
  // milliseconds of page load.
  only?: boolean;
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

// Read tab= and only= from the URL. Prefers hash form (#tab=...),
// falls back to query form (?tab=...) for legacy bookmarks predating
// patch 25. Returns the URLSearchParams-shaped payload string
// (e.g. "tab=tmux:host:name&only=1"), or null if no tab param present.
function readTabPayloadFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash;
  if (hash.length > 1) {
    const p = new URLSearchParams(hash.slice(1));
    if (p.has("tab")) {
      const out = new URLSearchParams();
      out.set("tab", p.get("tab")!);
      if (p.get("only") === "1") out.set("only", "1");
      return out.toString();
    }
  }
  const q = new URLSearchParams(window.location.search);
  if (q.has("tab")) {
    const out = new URLSearchParams();
    out.set("tab", q.get("tab")!);
    if (q.get("only") === "1") out.set("only", "1");
    return out.toString();
  }
  return null;
}

// Called at module load in main.tsx BEFORE the React tree renders. Reads the
// URL and stashes into sessionStorage so it survives every downstream
// replaceState (auth flow, OIDC, etc.). sessionStorage is per-Chrome-tab, so a
// browser with N Termix tabs open holds N independent pending specs.
export function snapshotPendingTab(): void {
  if (typeof window === "undefined") return;
  try {
    const payload = readTabPayloadFromUrl();
    if (payload) window.sessionStorage.setItem(STORAGE_KEY, payload);
  } catch {
    // sessionStorage may be blocked (private mode with strict setting) — the
    // URL fallback in consumePendingTab still works if the hash survives.
  }
}

// Consumed once by AppShell after tabs are ready. Prefers sessionStorage (which
// survives auth-flow URL-stripping), falls back to the current URL.
export function consumePendingTab(): TabSpec | null {
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
  const spec = parseTabParam(params.get("tab"));
  if (!spec) return null;
  if (params.get("only") === "1") spec.only = true;
  return spec;
}

// Push a TabSpec into the URL fragment via replaceState (no history entry).
// null clears any existing #tab=.
//
// We use the fragment specifically because Chrome's window-restore code path
// (Ctrl+Shift+T after closing a whole window) doesn't preserve replaceState'd
// query params, but does preserve the fragment. Individual-tab restore works
// fine with both — this covers both paths.
export function writeTabToUrl(spec: TabSpec | null): void {
  if (typeof window === "undefined") return;
  const nextHash = spec ? `#tab=${encodeTabSpec(spec)}` : "";
  const currentHash = window.location.hash;
  // Also strip any legacy ?tab= that might be lurking from a bookmarked pre-hash URL.
  const params = new URLSearchParams(window.location.search);
  params.delete("tab");
  const qs = params.toString();
  const nextSearch = qs ? `?${qs}` : "";
  const nextUrl = window.location.pathname + nextSearch + nextHash;
  if (currentHash === nextHash && window.location.search === nextSearch) return;
  window.history.replaceState({}, "", nextUrl);
}

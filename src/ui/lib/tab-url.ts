// URL-encoded tab addressing so Chrome tab-restore preserves the active Termix
// session in each browser tab. See patch 25.
//
// Wire URL forms accepted / emitted:
//   ?tab=tmux:<host>:<session-name>   attach/create named tmux session on SSH host
//   ?tab=terminal:<host>              plain SSH terminal (Windows / non-tmux hosts)
//   ?tab=rdp:<host>                   RDP via guacamole
//   ?tab=vnc:<host>                   VNC via guacamole
//   ?tab=telnet:<host>                telnet via guacamole
//
// The <host> component is the host record's `name` field (case-insensitive lookup);
// component IDs work too as a rename-fallback (`?tab=rdp:7`).
//
// Persistence: snapshot the URL param into sessionStorage at page load BEFORE any
// auth-flow replaceState can strip it — sessionStorage is per-Chrome-tab and survives
// login redirects. AppShell consumes it after tabs are restored, then clears it.

import type { TabType } from "@/types/ui-types";

const STORAGE_KEY = "termix_pending_tab";

export interface TabSpec {
  protocol: "tmux" | "terminal" | "rdp" | "vnc" | "telnet";
  host: string;
  session?: string;
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

// Called at module load in main.tsx BEFORE the React tree renders. Reads the
// URL query and stashes ?tab= into sessionStorage so it survives every
// downstream replaceState (auth flow, OIDC, etc.). sessionStorage is
// per-Chrome-tab, so a browser with N Termix tabs open holds N independent
// pending specs — exactly the property we need.
export function snapshotPendingTab(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = new URLSearchParams(window.location.search).get("tab");
    if (raw) window.sessionStorage.setItem(STORAGE_KEY, raw);
  } catch {
    // sessionStorage may be blocked (private mode with strict setting) — the
    // URL fallback in consumePendingTab still works if the query survives.
  }
}

// Consumed once by AppShell after tabs are ready. Prefers sessionStorage (which
// survives auth-flow URL-stripping), falls back to the current URL.
export function consumePendingTab(): TabSpec | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw) window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  if (!raw) {
    raw = new URLSearchParams(window.location.search).get("tab");
  }
  return parseTabParam(raw);
}

// Push a TabSpec into the browser URL bar via replaceState (no history entry).
// null clears any existing ?tab= param.
export function writeTabToUrl(spec: TabSpec | null): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (spec) {
    params.set("tab", encodeTabSpec(spec));
  } else {
    params.delete("tab");
  }
  const qs = params.toString();
  // Manually re-decode our own colon separators for readability. URLSearchParams
  // percent-encodes the `:` we intentionally kept unencoded in encodeTabSpec.
  const cleaned = qs.replace(/tab=([^&]+)/, (_, v) =>
    "tab=" + v.replace(/%3A/g, ":"),
  );
  const url =
    window.location.pathname + (cleaned ? `?${cleaned}` : "") + window.location.hash;
  window.history.replaceState({}, "", url);
}

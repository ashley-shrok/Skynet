// ─── Stamped fetch wrapper (Phase 111 Plan 04) ───────────────────────────────
//
// Phase 111 SKEW-04: raw-fetch stamp wrapper. All in-scope raw-fetch call
// sites (streaming, SSE, fire-and-forget beacons) go through this helper
// INSTEAD OF the global `fetch` so the client-build header is stamped by
// construction — parallel discipline to the axios request interceptor in
// `src/ui/main-axios.ts`, which covers all 8 axios instances through a
// single factory edit. Together they close the D-04 airtight-by-construction
// loop on the client side.
//
// OUT OF SCOPE (do NOT rewrite to use stampedFetch):
//   - External URL fetches (avatar candidates from pravatar/gravatar in
//     `src/ui/sidebar/CreateRoleDialog.tsx` and
//     `src/ui/features/pretty-view/RoleCosmeticEditBlock.tsx`) — those hit
//     third-party servers and must not leak `X-Skynet-Client-Build` to them.
//   - Electron server-config probes hitting user-configured remote installs
//     (`src/ui/auth/ElectronServerConfig.tsx`) — those may target a different
//     Skynet install so per-caller convention wins.
//
// Signature mirrors the global `fetch`: accepts `RequestInfo | URL` and
// optional `RequestInit`, returns raw `Response`. No error handling, no
// retry, no lifecycle side effects — streaming callers still get
// `response.body.getReader()` as a `ReadableStream`.

import { CLIENT_BUILD_ID } from "./client-build-id.js";

export async function stampedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  // `new Headers(init.headers)` normalizes all three shapes the fetch API
  // accepts: `Headers`, `Record<string, string>`, `[string, string][]`. The
  // `.set()` call OVERWRITES any pre-existing `X-Skynet-Client-Build` if a
  // caller passed one manually — correct-by-construction (we always win).
  const headers = new Headers(init.headers ?? {});
  headers.set("X-Skynet-Client-Build", CLIENT_BUILD_ID);
  return fetch(input, { ...init, headers });
}

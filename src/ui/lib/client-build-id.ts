/**
 * Phase 111 SKEW-01: single source of truth for the browser bundle's build-id.
 *
 * Value is baked in at Vite compile time via the `define` block in
 * `vite.config.ts` — the `import.meta.env.VITE_BUILD_ID` reference below is
 * substituted with a JSON-encoded string literal at bundle time (NOT a
 * runtime env var read; the browser has no `process.env`, and Vite's
 * `import.meta.env` is compile-time-static).
 *
 * All consumers (axios request interceptor at `src/ui/main-axios.ts`, WS
 * client sites at `src/ui/api/*` + `src/ui/features/*`) import
 * `CLIENT_BUILD_ID` from HERE — no consumer touches
 * `import.meta.env.VITE_BUILD_ID` directly. Single point of contact.
 *
 * Fallback: `"dev-unknown"` when the `define` substitution didn't fire
 * (e.g. under vitest jsdom, which does NOT run a Vite build pass). Any
 * production bundle that lands with `"dev-unknown"` visible in logs means
 * the Vite eval never received `SKYNET_BUILD_SHA` — a config drift
 * (Pitfall 4).
 *
 * Plain-const shape (not a getter fn) — tree-shaking sees the substituted
 * value as a literal after Vite's `define` transform.
 */

export const CLIENT_BUILD_ID: string =
  (import.meta.env.VITE_BUILD_ID as string | undefined) || "dev-unknown";

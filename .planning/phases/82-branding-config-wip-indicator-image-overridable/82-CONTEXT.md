# Phase 82: Branding config: WIP indicator image overridable — Context

**Gathered:** 2026-09-07
**Status:** Ready for planning
**Source:** In-session scope discussion with Ashley (greenlit `thumbs up` 2026-09-07). Bounty `branding-config-wip-indicator-image-overridable` (pinned).

<domain>
## Phase Boundary

Extend the Phase 70 `BrandingConfig` schema with a new field `wipIndicatorPath: string` so operators of Skynet instances can override the WIP indicator image (`public/wip-cube.webp` today — a 52×52 animated WebP shown when the Terminal PTY reports non-idle or backgrounded agents/shells are running). Rewire `WipBubble.tsx` to read the src from `useBrandingConfig()` instead of the hardcoded `/wip-cube.webp` string. Relocate the current asset into the `docker/branding-defaults/` bundled-defaults directory so it flows through the branding router's per-file fallback (`resolveAssetPath()` — override → bundled default) rather than being served by nginx's static-file fallback.

Companion to Phase 74 (`avatarDirectorSpec`), but in the "image asset" variant — shape mirrors `iconPath` / `wordmarkPath` (bundled default IS the fallback), NOT `avatarDirectorSpec` (intentionally empty to force operator authoring). No boot gate required.

</domain>

<decisions>
## Implementation Decisions

### Schema shape (LOCKED — mirrors Phase 74 pattern for image assets)

- Add `wipIndicatorPath: string` to both:
  - Backend `BrandingConfig` type in `src/backend/branding/branding-config-loader.ts`
  - Frontend mirrored `BrandingConfig` type in `src/ui/branding/branding-store.ts`
- Both types stay field-for-field in sync (existing convention documented in `branding-store.ts` comments).
- Field lives alongside `iconPath` / `wordmarkPath` / `faviconPath` — same string shape, same `/branding/*` URL convention.

### Bundled default value (LOCKED)

- `wipIndicatorPath: "/branding/wip-cube.webp"` in:
  - `HARDCODED_FALLBACK` in `branding-config-loader.ts`
  - `docker/branding-defaults/branding.json`
  - Frontend initial-state sentinel in `branding-store.ts`
- All three MUST agree byte-for-byte (Phase 70 D-14 rule: no-config deploy preserves current behavior).

### Bundled default asset location (LOCKED)

- `git mv public/wip-cube.webp docker/branding-defaults/wip-cube.webp`
- Dockerfile already `COPY docker/branding-defaults/ /app/branding-defaults/` (per Phase 70), so the file becomes discoverable at `/app/branding-defaults/wip-cube.webp` inside the container.
- `resolveAssetPath("wip-cube.webp")` will then return the bundled default when no operator override exists at `/etc/skynet/branding/wip-cube.webp`, or the override when present.

### Shape guard (LOCKED)

- Add validation to `isValidBrandingShape()` in both loader.ts (backend) and the equivalent guard in `branding-fetch.ts` (frontend):
  - `if (typeof o.wipIndicatorPath !== "string") return false;`

### Component wiring (LOCKED)

- `src/ui/features/pretty-view/WipBubble.tsx` — import `useBrandingConfig` from `@/branding/branding-store` (following the same import pattern used in `PrettyConversationsPanel.tsx`, `Auth.tsx`, `AppShell.tsx`), read `wipIndicatorPath`, use as `<img src={wipIndicatorPath}>`.
- Comment header updated to note that the asset path is now branding-configurable (post-Phase-82 addendum). The existing patch #260 / 2026-09-05 canvas→WebP swap history stays — it's still the right context for why the image approach was chosen over rAF canvas render.

### No boot gate (LOCKED)

- Unlike Phase 74's `avatarDirectorSpec` (intentionally empty in the bundled default, boot gate in `assert-boot.ts` refuses to start if empty), `wipIndicatorPath` has a real usable default. No boot gate needed. `assert-boot.ts` is NOT modified.

### No new sizing field (LOCKED)

- `WipBubble` hardcodes `h-[52px] w-[52px]` CSS classes.
- Operators overriding the image are responsible for matching aspect ratio.
- Do NOT add a `wipIndicatorSizePx: number` field. Extra complexity for marginal benefit; can be added later if a live operator asks for it.

### No cache-control change (LOCKED)

- Existing `/branding/*` route sets `Cache-Control: public, max-age=300` (5 min).
- Fine for now. Do NOT extend cache duration in this phase.

### Test surface (LOCKED)

- `src/backend/branding/branding-config-loader.test.ts` — update `makeValidLoadResult` to include `wipIndicatorPath: "/branding/wip-cube.webp"`; add a missing-`wipIndicatorPath` shape-guard case; add a wrong-type shape-guard case.
- `src/backend/branding/assert-boot.test.ts` — update `makeValidLoadResult` if it also carries a full-shape fixture (verify).
- Frontend `branding-fetch.ts` test (if one exists) — update to include the new field in expected shape.
- Search for any test that pins the `/wip-cube.webp` string via `<WipBubble>` render assertion or PrettyView snapshot — rewire to read from store or accept the store-driven value.
- No new test file needed — this is a schema extension along an established pattern.

### Operator workflow (locked, documented in bundled-defaults comment)

- Operator drops a custom image at `/opt/skynet/branding/wip-cube.webp` on the host (bind-mounted read-only into container at `/etc/skynet/branding/wip-cube.webp`).
- Instance picks it up on next `GET /branding/wip-cube.webp` (per-request `fs.access`) — no container restart needed.
- If operator wants a different filename, edit `/opt/skynet/branding.json` to set `wipIndicatorPath: "/branding/my-custom-wip.webp"`.

### Claude's Discretion

- Exact spot in `HARDCODED_FALLBACK` block-comment attribution for the new field (loader.ts line ~86-92 currently explains why `avatarDirectorSpec: ""` — that comment stays; a parallel one-line comment for the new field is fine but not mandatory since it's a straightforward default).
- Whether to put `wipIndicatorPath` immediately after `faviconPath` or after `pwaIcons` in the type declaration order — planner picks. Convention seems to group image-URL fields; recommended order: `iconPath`, `wordmarkPath`, `faviconPath`, `wipIndicatorPath`, then `pwaIcons`.
- Test file for `WipBubble.tsx` specifically — if none exists, do NOT create one (keep scope tight; behavior is a single-line src prop).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 70 (branding config — the pattern being extended)
- `.planning/phases/70-branding-config/` — original PLAN/SUMMARY files for the branding router, per-file fallback, PWA manifest, and initial `BrandingConfig` shape.
- `src/backend/branding/branding-config-loader.ts` — canonical shape + validation + resolver.
- `src/backend/branding/branding-routes.ts` — `/api/branding` + `/branding/*` router.
- `src/ui/branding/branding-store.ts` — frontend mirror + `useBrandingConfig` hook.
- `src/ui/branding/branding-fetch.ts` — boot fetch + shape guard.

### Phase 74 (avatarDirectorSpec — companion pattern extension)
- `.planning/phases/74-control-style-of-avatar-generation-through-branding-config/` — original PLAN/SUMMARY files. Confirms the "add a field to BrandingConfig" mechanics work.
- `src/backend/branding/assert-boot.ts` — boot gate (this phase does NOT modify, but reading it clarifies why Phase 74 needed it and Phase 82 does not).

### Target file (the thing being wired)
- `src/ui/features/pretty-view/WipBubble.tsx` — current implementation with hardcoded `/wip-cube.webp` string; patch #86 / #260 history in the file header.

### Bundled defaults
- `docker/branding-defaults/` — where the new default asset lives after `git mv`.
- `docker/branding-defaults/branding.json` — where the new field's default value string lives.

### Test surface
- `src/backend/branding/branding-config-loader.test.ts` — shape-guard test pattern.
- `src/backend/branding/assert-boot.test.ts` — reference for full-shape fixtures.

</canonical_refs>

<specifics>
## Specific Ideas

- The WipBubble comment header should get a single-line addendum after the existing patch #260 block, noting the branding-config wiring landed in Phase 82. Preserves history without rewriting existing narrative.
- The bundled JSON file (`docker/branding-defaults/branding.json`) is what real Skynet instances actually deploy against — the `HARDCODED_FALLBACK` in loader.ts is a last-resort backstop if even the bundled JSON goes missing (shouldn't happen — Dockerfile COPYs it). Both need updating; they must agree.

</specifics>

<deferred>
## Deferred Ideas

- **Configurable WIP indicator size** (`wipIndicatorSizePx` or similar) — leave hardcoded 52×52 CSS; operators match aspect ratio.
- **Longer cache-control on branding assets** — 5 min stays; separate concern.
- **Operator-selectable animation** (multiple bundled variants + toggle) — out of scope.

</deferred>

<scope_fence>
## Scope Fence

**Out of scope for Phase 82:**
- Any change to `assert-boot.ts` (no boot gate for this field).
- Any change to WIP indicator sizing or CSS classes on `WipBubble.tsx` (only the `src` prop moves).
- Any change to the WIP indicator mount conditions in `PrettyView.tsx` (still triggered by Terminal PTY non-idle OR backgrounded agents/shells running).
- Any change to Cache-Control headers for `/branding/*`.
- Any new frontend UI for editing branding config (operators edit JSON on the host filesystem — same as Phase 70/74).
- Any change to nginx `location` blocks — `/branding/*` already routes to backend per Phase 70 (both `docker/nginx.conf` and `docker/nginx-https.conf`).

</scope_fence>

---

*Phase: 82-branding-config-wip-indicator-image-overridable*
*Context gathered: 2026-09-07 (in-session with Ashley — /build shape → GSD phase route)*

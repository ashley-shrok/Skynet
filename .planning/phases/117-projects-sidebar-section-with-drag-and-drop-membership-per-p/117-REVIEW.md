# Phase 117 — Unbiased Code Review (post-execution, pre-ship)

**Reviewer:** general-purpose subagent, /build pipeline step 5 (unbiased code review + fixes)
**Date:** 2026-09-18
**Verdict:** SIGNIFICANT ISSUES — DO NOT SHIP
**Findings:** 3 HIGH, 8 MEDIUM, 5 LOW

---

## HIGH severity — MUST fix before ship

### H1. Identity-based project membership is a no-op end-to-end in production

**Files:**
- `src/ui/state/conversation-store.ts` (lines 442–449, 1145, 2283–2299)
- `src/ui/AppShell.tsx` (lines 1325–1385)

**Problem:** The frontend's `state.identityProjectAssignments` Map (keyed on `${hostId}::${identityKey}`) is what `projectForRow()` reads to bucket identity conversations into projects — but nothing in production code ever calls `setIdentityProjectAssignments`. The only callers are tests. AppShell's boot-time hydration effect fetches `listProjects` and `listRelayRoomProjectTags` but never derives an identity-project map from the `state.identities[]` array (which does carry `identity.project` from GET /identities). The wire frame `IdentityAppearanceSchema` in `wire-protocol.ts` also does not include `project`, so the WS pulse never propagates identity assignments either. Net effect: after a user drags an identity conversation onto a project, the backend writes the frontmatter correctly, but the sidebar never shows the identity moving into that project — not on WS update, not on refresh, not even after boot.

**Fix:** Add a `setIdentityProjectAssignments`-populating effect in AppShell that derives the Map from `identitiesByKey`/`identities` on each identity-store update: for every identity with `identity.project !== null` AND `identity.hostId` defined, insert `[`${hostId}::${identityKey.toLowerCase()}`, identity.project]`. Fire on identities-store change. Also extend `IdentityAppearanceSchema` to include `project` and pass it through source-B for live updates (see M6).

### H2. `relay-room-project-tag.ts` publishes an empty `[]` and blows away the projects cache

**Files:**
- `src/backend/database/routes/relay-room-project-tag.ts` (lines 254–267)
- `src/backend/fleet-status/subscription-registry.ts` (lines 378–397)

**Problem:** After a successful room-tag write, this route calls `registry.publishProjectListChanged([])`. Its comment claims the "idempotent-skip absorbs the no-op" — but `subscription-registry.publishProjectListChanged` compares to the *previous cache*: if the cache is currently populated (which it always is after boot hydration), publishing `[]` is a real delta. The registry then (a) overwrites the cache with `[]`, and (b) fans out an empty `project-list-changed` frame to every WS subscriber. On the frontend, `setProjects([])` empties the entire projects slice — every project header vanishes and every assigned conversation drops back to the flat middle. Any client that reconnects after this receives the empty cache in the snapshot replay too.

**Fix:** Do not publish anything after a room-tag write. Remove the `registry.publishProjectListChanged([])` call at line 257. Same fix on `session-project-write.ts` (see M5) — session-field writes don't change the projects list, so they shouldn't touch the projects cache. If a wire ping for room-tag changes is required, add a distinct `session-project-changed` frame that carries `{roomId, project}` and doesn't touch the projects cache — but that's out-of-scope for this fix pass (deferred idea).

### H3. `createProject`/`archiveProject` REMOTE branches wrap `$HOME` with `shellEscape`, breaking `$HOME` expansion

**File:** `src/backend/claude-session/identity-artifact-reader.ts` (lines 796–809 in `createProject`; lines 848–853 in `archiveProject`; `shellEscape` at line 563)

**Problem:** `shellEscape(s)` wraps its argument in single quotes. In `createProject`, `const remoteDir = "$HOME/fleet/projects/${slug}"; const escapedDir = shellEscape(remoteDir);` produces `'$HOME/fleet/projects/foo'`. When passed to `test -d '$HOME/fleet/projects/foo'` or `mkdir -p '$HOME/fleet/projects/foo'`, the shell will NOT expand `$HOME` (single quotes disable expansion) — it interprets `$HOME` as a literal path component. Result: (a) the `test -d` probe always returns "missing" (dupe detection fails silently), (b) `mkdir -p` creates a `$HOME` directory in the SSH user's cwd (usually the home dir, but as a literal file named `$HOME`), and (c) the subsequent `writeMarkdownFileAtomic` fails or writes to the wrong path. `archiveProject` has the same bug.

**Fix:** Use double-quoted interpolation like the other REMOTE readers (slugs are already `PROJECT_SLUG_RE`-validated, so `[a-z0-9-]` — nothing shell-special), e.g. `test -d "$HOME/fleet/projects/${slug}" && echo ok || echo missing` and `mkdir -p "$HOME/fleet/projects/${slug}"`. Do not pass `$HOME/...` strings through `shellEscape`.

---

## MEDIUM severity — worth fixing before ship (cluster with HIGHs)

### M1. `archiveProject` REMOTE `mv` silently nests into an existing archive

**File:** `src/backend/claude-session/identity-artifact-reader.ts` (lines 830–854)

**Problem:** POSIX `mv src dest` where `dest` is an existing directory moves `src` *inside* `dest`, becoming `dest/basename(src)`. If a project is archived, then a new project with the same slug is created and archived again, the second archive silently produces `~/fleet/projects/archive/foo/foo/...` — nested corruption. The docblock explicitly states "Does NOT overwrite" — but the REMOTE branch violates that contract silently.

**Fix:** Probe `test -d "$HOME/fleet/projects/archive/${slug}"` before the `mv`, and error out with an EEXIST-shaped error if it exists. Same pattern for LOCAL — call `fs.stat(dest)` first and throw EEXIST.

### M2. Concurrent `createProject` calls can silently race past the dupe check on both branches

**File:** `src/backend/claude-session/identity-artifact-reader.ts` (lines 763–815)

**Problem:** The dupe check is TOCTOU: probe → mkdir → write. Two concurrent `createProject` calls with the same slug will both pass the probe, both `mkdir -p` (which succeeds because it's recursive/idempotent), and both write `project.md` — the second overwrites the first, no 409 is raised.

**Fix:** Use `fs.mkdir(projectDir)` without `recursive:true` — vanilla `mkdir` fails with EEXIST atomically. Catch EEXIST and re-throw with the same `.code`. For REMOTE, replace `mkdir -p` with plain `mkdir` (or `mkdir -p; test` sequence guarded on exit code).

### M3. `PrettyProjectSectionHeader` renders a nested clickable inside a `<button>`

**File:** `src/ui/features/pretty-conversations/PrettyProjectSectionHeader.tsx` (lines 198–252)

**Problem:** The outer element is `<button>` (which handles collapse toggle); inside it is a `<span role="button" tabIndex={0}>` for the new-conversation action. Nesting an interactive element inside a `<button>` is invalid HTML. Screen readers, keyboard navigation, and mobile a11y engines can behave inconsistently.

**Fix:** Change the outer element to `<div role="button" tabIndex={0}>` with keyboard handler. Move `onContextMenu` and click semantics onto the top-level div per WAI-ARIA authoring practices.

### M4. `useCollapsedProjectSlugs` performs side effects inside a `setState` updater

**File:** `src/ui/state/use-collapsed-project-slugs.ts` (lines 87–98)

**Problem:** The `toggle` callback calls `persistToStorage(next)` inside the functional `setCollapsed((prev) => …)` updater. React StrictMode double-invokes updaters in development; this causes `localStorage.setItem` to run twice per toggle in dev.

**Fix:** Move `persistToStorage(next)` out of the updater. Compute `next` explicitly, call `setCollapsed(next)`, then call `persistToStorage(next)` once after.

### M5. `session-project-write.ts` fires `publishProjectListChanged` after every identity write, requiring an extra `listProjects` SSH roundtrip that is a no-op

**File:** `src/backend/database/routes/session-project-write.ts` (lines 202–226)

**Problem:** After writing the identity's `project:` frontmatter (which does NOT change the projects list itself), the route fires a full `listProjects(conn)` — one extra SSH round-trip — and hands the (unchanged) array to `publishProjectListChanged`. The registry's idempotent-skip absorbs it, so no wire frame is fanned out, but the extra remote enumeration on every drag is wasted work.

**Fix:** Skip the `listProjects + publishProjectListChanged` fan-out entirely on the session-project write path. Same fix pattern as H2's fix on relay-room-project-tag.

### M6. Backend `IdentityAppearanceSchema` (wire) omits `project`, so live source-B updates cannot propagate identity project membership

**File:** `src/backend/fleet-status/wire-protocol.ts` (lines 367–381)

**Problem:** `resolveIdentityAppearance` returns `project` on the resolved appearance, and the source-B publisher hands the appearance to the frontend via SessionState's `identityAppearance` field. But `IdentityAppearanceSchema` does not declare `project`, so zod's default strip behavior removes it in transit. Combined with H1, this makes live-updating identity project assignments impossible over the WS.

**Fix:** Add `project: z.string().nullable().optional()` to `IdentityAppearanceSchema`. Remove the `project: null` hardcoded default in `identities-store.ts` (line 628) and pipe `appearance.project` through.

### M7. `handleArchiveProject` may fall back to a nonsensical `defaultCreateProjectHostId` when the project isn't in the list

**File:** `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (lines 2046–2058)

**Problem:** When the project is not in `projectsList` (which "should never happen"), the code falls back to `defaultCreateProjectHostId` — a completely different host than the one the project actually lives on. If the fallback fires, `archiveProject` will attempt to archive a slug on the wrong host, silently failing or archiving a same-slug project on a different host.

**Fix:** Refuse to archive if `projectsList.find((p) => p.slug === slug)` returns undefined — log a warning and return without the folder-move rather than using the wrong host.

### M8. `getSubscriptionRegistry()` returns null during tests but write routes silently no-op the publish

**Files:** `src/backend/database/routes/project-list.ts` (lines 302–316; also session-project-write.ts, relay-room-project-tag.ts)

**Problem:** Multiple routes wrap their `getSubscriptionRegistry()` in `if (registry)` guards — sensible for tests, but in production a `null` here means starter.ts hasn't wired the registry yet. If a request arrives that early, the publish is silently dropped.

**Fix:** In production paths, log a warning when the registry is null so the failure is visible; treat null-registry-at-request-time as a startup-timing bug rather than a silent success.

---

## LOW severity — defer

### L1. `relay-room-project-tags-list.ts` requires `hostId` but does not use it for the actual data fetch

Matrix rooms are fleet-wide, so the per-host fetch retrieves the same set of assignments regardless of `hostId`. AppShell aggregates per-host and dedups by roomId, which multiplies Matrix HTTP round-trips by the number of hosts. Consider dropping the hostId requirement in a future iteration.

### L2. `CreateProjectModal` uses `modal={false}` on Radix Dialog which breaks focus-trap

`modal={false}` disables Radix's focus-trap. Tab from the input can escape to background elements. Minor a11y regression. Consider `modal={true}` for consistency.

### L3. Slug from `u.project.<slug>` in `relay-room-project-tags-list.ts` bypasses `PROJECT_SLUG_RE`

A room's account_data with `u.project.` (empty slug) or `u.project.evil/../slug` reaches the frontend and lives in `state.roomProjectAssignments`. Not exploitable — the frontend's `projectsBySlug.has(raw)` filter drops it — but defense-in-depth would add `if (!PROJECT_SLUG_RE.test(slug)) continue;` at the read site.

### L4. `subscription-registry.ts` idempotent-skip uses `JSON.stringify` on unsorted objects

If callers ever build the projects array with different key insertion order, byte-identical arrays could stringify differently and defeat the skip. Currently all callers use the same builder so this is theoretical.

### L5. `project-list.ts` post-write publish uses `host.name ?? String(hostId)` fallback but ProjectRow type expects `hostname: string`

`host.name` could be an empty string on a poorly-configured host; the `??` fallback only catches null/undefined. Empty-string hostname would flow through and render as blank. Consider `host.name || String(hostId)` (falsy coerce).

---

## Summary

- HIGH: 3 findings — identity project axis broken end-to-end (H1), relay-room write publishes empty projects list (H2), REMOTE createProject/archiveProject $HOME shell-quoting bug (H3).
- MEDIUM: 8 findings — data-integrity and code-quality concerns, several clustering with the HIGHs.
- LOW: 5 findings — style + defense-in-depth suggestions.

**Overall recommendation:** SIGNIFICANT ISSUES — DO NOT SHIP.

H1 alone means the identity carrier for project membership doesn't function in production. H2 means every relay-room project drag empties the projects sidebar for every connected client. H3 means every remote-box project create/archive silently succeeds against the wrong path. All three MUST land before this ships. M1, M2, M5, M6 cluster with the HIGHs and should land together. M3, M4, M7, M8 are polish/edge cases worth folding in. LOWs can defer.

**Fix pass scope:** H1, H2, H3, M1, M2, M3, M4, M5, M6, M7, M8. Defer LOWs.

# Phase 66 — CONTEXT

**Skynet reads and writes identity cosmetics from disk (Phase B of `/build identity-prettiness-on-disk`)**

This CONTEXT.md is seeded from the locked shape file at `.planning/shapes/identity-prettiness-on-disk.md` (opened + closed 2026-08-31 via `/open`). Discuss-phase is intentionally SKIPPED per the build-skill precedent — the shape file already captured the why + what + constraints + scope edges, so re-eliciting them into a fresh CONTEXT.md would waste cycles.

**Read shape.md first for the philosophy and cross-phase context.** This file focuses on Phase B specifics for the planner.

---

## Why now — Phase A already shipped

Phase A (populate disk fleet-wide + adjust id skill) shipped 2026-08-31 by nadia + nelly:

- **51 of 54 identities** got their `~/.claude/identities/<key>/<key>.md` frontmatter grown with `displayName`, `title`, `colorHue`, `voice` (absent-⇒-omit), plus a sibling `<key>.<ext>` avatar file. Idempotent across boxes. Spot-checked. Nelly's `coordinator: true` marker preserved. Chad's non-null `voice: Connor.wav` landed.
- **id skill** updated in `~/vms-apps` master `f33d187` — slim-identity template grew the 5 optional cosmetic fields with a "cosmetic fields live on disk" note. Self-updating; every box picks it up on next `/id <name>`.
- **3 orphans, all adjudicated:**
  - `alpha`, `beta` — retired from the store 2026-08-31 (they were stale test rows).
  - `commander-zoey` — folder on ZoeyBattlestation is `commander zoey` (space, not hyphen), violates the id-skill invariant. Ashley greenlit "accept the ugly render post-Phase-B" as a scoped edge case; no rename in this phase, no fallback code.

Disk is now the fleet standard for identity cosmetics. Phase B is Skynet catching up.

---

## Phase B scope (three tracks + one migration)

### Track 1: BIRTH — enrich identity-birth-orchestrator emission

**File:** `src/backend/database/routes/identity-birth-orchestrator.ts`.

Currently step 2 of the birth flow SSH's into the target box, creates `~/.claude/identities/<key>/`, and writes `<key>.md` with only a `role:` frontmatter pointer. The exact frontmatter emission code lives in the birth-orchestrator's step-2 body (search for `identityFileBody` + the `writeMarkdownFileAtomic` call around line 502).

**Change:** grow the frontmatter emission to include the four scalars — `displayName`, `title`, `colorHue`, `voice` — from the birth `opts` object. Absent (null in opts) ⇒ omit the field entirely from the YAML frontmatter (do NOT write `null`). Then, using the same SSH connection, write the uploaded avatar bytes as a sibling file `<key>.<ext>` inside the identity folder — extension derived from the avatar mime type (webp/png/jpeg/gif; SVG conservative-allow if the frontend already accepts it). The `avatar: <key>.<ext>` line in the frontmatter names the sibling file.

**Test coverage:** extend `identity-birth-orchestrator.role-frontmatter.test.ts` to also assert `displayName`, `title`, `colorHue`, `voice`, and `avatar` emission (both present-cases and absent-omit cases). Add a new test file (or extend existing) verifying the avatar sibling file lands and its bytes match input.

### Track 2: UPDATE — flip `PUT /identities/:id` to write disk

**Files:** `src/backend/database/routes/identities.ts` (the PUT handler around line 200-ish based on prior grep), + wherever `parseMultipartMetadata` lives.

Today the PUT writes `displayName`/`title`/`colorHue`/`voice`/`avatarData`/`avatarMime`/`avatarEtag` into the `identities` table via `db.update(...).run()` + `DatabaseSaveTrigger.forceSave`. Post-flip: it writes the same values as a frontmatter mutation on `<key>.md` on the identity's home box (which the handler learns via existing (identityKey, hostId) plumbing — planner: confirm this is available in the PUT context; if not, a manifest lookup step becomes part of the flip).

**Frontmatter mutation semantic:** read the existing YAML frontmatter, overlay the changed fields, write back atomically via `writeMarkdownFileAtomic` (existing helper). Absent-in-payload ⇒ leave the field alone (don't touch what wasn't sent). Explicit-null-in-payload ⇒ REMOVE the field from frontmatter (matches absent-⇒-omit invariant). Avatar update: write fresh bytes as `<key>.<new-ext>` (may differ from previous if mime changed), delete the old avatar sibling if extension differs (planner: decide whether to hard-delete or keep as historical — I lean hard-delete to avoid dead files accumulating).

**Reference pattern:** `identity-artifact-reader.remote-writes.test.ts` shows the shape of an SSH write via the artifact-reader. Reuse that plumbing; do NOT invent a new tunnel.

**Test coverage:** extend `identities.ts` PUT tests to assert the frontmatter mutation lands correctly (present, absent, null-remove cases), and that the avatar sibling file is written with the correct bytes + extension. Add a mime-change-swaps-extension test.

### Track 3: READ — flip every render surface

**Reads currently served from the store:**
- `GET /identities` — returns the full list with all cosmetic fields.
- `GET /identities/:id/avatar` — returns avatar bytes + mime.
- Whatever internal code reads `identities` rows for badge rendering, pretty-view avatar, chat-list row, etc.

**Post-flip:**
- `GET /identities` becomes a fleet-walk (or per-hostId lazy read tied to the calling user's context — planner decides which. My default lean: keep the shape "list all identities for this user" but derive cosmetics per-identity via artifact-reader; identityKey and id come from the surviving store columns; frontmatter values overlay on top. If the reader fails for an identity, return the row with cosmetics-absent — client already tolerates missing cosmetics from the current codepath).
- `GET /identities/:id/avatar` reads the sibling avatar file from disk via the reader.
- The `identityKey → hostId` mapping needed for the reader routing is the same one existing artifact reads use — if `GET /identities` doesn't currently have that hostId per-row (identity table has no hostId column, remember), then a discovery layer needs to be introduced OR the endpoint contract widens to require the caller to pass hostId per-identity (planner: pick the approach that matches how bounty-count works today — which already faces the same identityKey↔hostId question).

**Test coverage:** extend `/identities` + `/identities/:id/avatar` route tests to assert disk-sourced returns. Add "identity's box unreachable" tests asserting the failure-mode contract (does the endpoint return partial data, error 502, or something else? planner decides — shape says error-and-move-on is acceptable).

### Migration: drop the moved columns

**File:** a new drizzle migration at `drizzle/` (or wherever the fleet migrations live) that ALTER TABLE identities DROP COLUMN for `displayName`, `title`, `colorHue`, `voice`, `avatarMime`, `avatarData`, `avatarEtag`.

**Ordering constraint:** migration must land AFTER birth+update+read flips are proven green in tests (dropping columns before flips would break tests). Runs once at container start via the existing drizzle migration runner (verify with the box-maintainer per-runbook that this is safe on the encrypted-SQLite in-memory setup — patches around `db/index.ts:34-37`).

**Backup:** since the fleet uses AWS DLM daily EBS snapshots (7 retained, tag `dlm-backup=skynet`), rollback is available via snapshot restore if the migration surprises anyone. That's the safety net; not a rollback we plan to use, but it's there.

---

## Reference constraints (fleet-standing, not phase-specific)

- **No worktrees** (fleet rule). All work in `~/skynet-tina` on `feat/tab-title-from-tmux`.
- **Sub-agents don't do deploys** — executor's remit stops at code + commit + scoped tests green. Ship motion (git pull --rebase → coord-room BEFORE → git push → docker build → force-recreate → HTTPS 200 → coord-room AFTER) is orchestrator-only.
- **Container mutations serialize via the coord room** on the relay (matrix room `!FHdIfqtmSWcGYUfyVp:thenasty.taild9b663.ts.net`); dormancy sweep before posting (skip post if all peer identities are dormant).
- **Scoped tests during dev; full-suite green as ship gate** — `npx vitest run --related <changed>` during work; full `npx vitest run` before docker build.
- **In-memory SQLite gotcha** — any `db.update/insert/delete().run()` needs an accompanying `await DatabaseSaveTrigger.forceSave("<reason>")` in try/catch. Track 2 update code no longer writes to the store for cosmetics (whole point of the phase), but the migration + any surviving `identities`-table updates DO.
- **Per-push greenlight** — every git push requires a fresh "may I?" from Ashley (deploy-window boundary). Multi-step pre-authorizations authorize the CODE motion only, never the push.

---

## Known open questions the planner should resolve

1. **`GET /identities` fleet-walk cost.** If every list-identities call has to reach every fleet box, this could be slow / high fanout. Options: (a) per-user lazy fetch (only reach the boxes hosting identities the user has interacted with), (b) accept the cost since box count is small (~5 SSH-reachable Linux boxes, timeouts fail-fast at 3s), (c) something else. Planner picks based on read the actual call sites.

2. **`identityKey → hostId` at update-time.** The PUT identity endpoint needs to know which box to write to. The frontend caller has this info (it's rendering the identity somewhere with a hostId context) — planner: either widen the PUT contract to require hostId in the body, or derive it server-side from wherever the artifact-reader already gets it for other identity operations.

3. **Migration ordering with running fleet.** Skynet is deployed as a single container. When Phase B ships, the migration runs at container start, then the new code goes live. Between "old container stops" and "new container ready" there's the normal deploy window. The disk is authoritative before AND after the migration; the migration just drops columns that are no longer referenced. Planner should verify no code path outside this phase reads the dropped columns.

4. **What to do about `commander-zoey` in `GET /identities`.** Ashley greenlit "accept the ugly render." Concretely: the row appears with cosmetics-absent (no displayName override, no title, no colorHue, no voice, no avatar). The client renders whatever it renders for a cosmetics-less identity (likely a placeholder). Planner: verify the client actually tolerates this — if it doesn't, either fix the client OR add a minimal fallback in the endpoint (I lean fix-client if needed; the codebase already tolerates missing bounty/wakeup artifacts, so the pattern should extend).

---

## Vehicle notes

Straight to `/gsd-plan-phase 66`. Discuss-phase SKIPPED (shape file + this CONTEXT do the discovery). Planner should read `.planning/shapes/identity-prettiness-on-disk.md` alongside this file — the shape has the philosophy and "what would make it wrong" that this file doesn't repeat.

After plan-phase produces plans, `/gsd-execute-phase 66` runs them (auto-proceed per fleet rule — no user greenlight between plan and execute). Ship gate is full-suite green, coord-room BEFORE post, per the standing box-maintainer discipline. `/close identity-prettiness-on-disk` closes the whole two-phase arc after Phase B ships.

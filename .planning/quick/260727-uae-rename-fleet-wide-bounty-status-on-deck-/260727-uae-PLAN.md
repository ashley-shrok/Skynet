---
phase: quick-260727-uae
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/backend/claude-session/identity-artifact-reader.ts
  - src/backend/claude-session/identity-artifact-reader.count-bounties.test.ts
  - src/backend/claude-session/claude-session-server.ts
  - src/backend/claude-session/claude-session-server.count-bounties.test.ts
  - src/ui/api/claude-session-api.ts
  - src/ui/api/claude-session-api.count-bounties.test.ts
  - src/ui/state/bounty-counts-store.ts
  - src/ui/state/bounty-counts-store.test.ts
  - src/ui/features/pretty-conversations/PrettyBountyCountBadge.tsx
  - src/ui/features/pretty-conversations/PrettyConversationRow.tsx
  - src/ui/features/pretty-conversations/pretty-conversations.css
  - src/ui/features/pretty-view/BountyCard.tsx
  - src/ui/features/pretty-view/IdentityModal.tsx
autonomous: true
requirements: [rename-on-deck-to-pinned]

must_haves:
  truths:
    - "No occurrence of `on_deck` / `onDeck` / `OnDeck` / `on-deck` remains anywhere under src/ after the rename"
    - "Backend WS response field is `pinnedCount` (not `onDeckCount`); frontend consumer type + store + badge prop all read `pinnedCount` in lockstep"
    - "BountyCard renders `Pinned` (not `On Deck`) for a bounty with status `pinned`, using the amber style formerly keyed under `on_deck`"
    - "`npm run build:backend && npm run build` succeeds (frontend tsc-noemit alone is NOT sufficient — fleet-standing lesson from patch #154)"
    - "`npm run test:backend` stays green at 223/223 and `npm run test` stays green at 486/486"
    - "Identity bounty folder for the tb1 patch is renamed from `pretty-conversations-on-deck-badge` → `pretty-conversations-pinned-badge`, its bounty.json title updated, and a timeline entry recorded"
  artifacts:
    - path: "src/backend/claude-session/identity-artifact-reader.ts"
      provides: "exported readIdentityPinnedBountyCount (renamed from readIdentityOnDeckBountyCount); filter `.status === \"pinned\"`"
    - path: "src/backend/claude-session/claude-session-server.ts"
      provides: "WS response field `pinnedCount` + import of renamed reader"
    - path: "src/ui/api/claude-session-api.ts"
      provides: "type shape field `pinnedCount`"
    - path: "src/ui/state/bounty-counts-store.ts"
      provides: "store field/helper naming aligned to `pinnedCount`"
    - path: "src/ui/features/pretty-conversations/PrettyBountyCountBadge.tsx"
      provides: "prop rename + a11y/title copy 'pinned' (was 'on-deck')"
    - path: "src/ui/features/pretty-view/BountyCard.tsx"
      provides: "status style map key `pinned` + display label `Pinned`"
  key_links:
    - from: "src/ui/state/bounty-counts-store.ts"
      to: "src/ui/api/claude-session-api.ts"
      via: "shared BountyCount type — `pinnedCount` field name matches on both sides"
      pattern: "pinnedCount"
    - from: "src/backend/claude-session/claude-session-server.ts"
      to: "src/backend/claude-session/identity-artifact-reader.ts"
      via: "import { readIdentityPinnedBountyCount }"
      pattern: "readIdentityPinnedBountyCount"
    - from: "src/ui/features/pretty-conversations/PrettyConversationRow.tsx"
      to: "src/ui/features/pretty-conversations/PrettyBountyCountBadge.tsx"
      via: "prop pass-through (`count` from `pinnedCount` local via `useBountyCount`)"
      pattern: "pinnedCount"
---

<objective>
Fleet-wide, the bounty JSON schema value `on_deck` has been retired in favor of `pinned` (per `~/.claude/skills/id/SKILL.md § Schema`). This plan sweeps every remaining reference under `src/` — including the just-shipped tb1 patch (per-row bounty count badge) and pre-existing patch #92 code (BountyCard status map + IdentityModal comments) — over to `pinned` in one lockstep rename. No shims, no aliases, no backwards-compat: `on_deck` is dead everywhere.

Purpose: Prevent the tb1 per-row bounty count badge from silently counting zero forever (the reader currently filters `.status === "on_deck"` — a value no bounty will ever again carry). Keep the pretty-view BountyCard rendering the correct label + style for the surviving `pinned` status. Sweep dead comment references so future greppers aren't confused.

Output: One atomic sweep across ~13 files in `src/`, staged into three commits (backend, frontend, identity-folder + verification) so each layer's rename lands as a legible unit. Commit only — do NOT push, do NOT build for deploy, do NOT `docker compose up`. Stop at the push authorization boundary per fleet rule (Ashley 2026-07-27, patch #153 lesson) and wait for the human "deploy" / "ship it" signal.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md

# Fleet identity + schema definition (canonical source of the pinned status enum)
@$HOME/.claude/identities/tina/tina.md
@$HOME/.claude/skills/id/SKILL.md

# The files being renamed (read to confirm current shape before editing)
@src/backend/claude-session/identity-artifact-reader.ts
@src/backend/claude-session/identity-artifact-reader.count-bounties.test.ts
@src/backend/claude-session/claude-session-server.ts
@src/backend/claude-session/claude-session-server.count-bounties.test.ts
@src/ui/api/claude-session-api.ts
@src/ui/api/claude-session-api.count-bounties.test.ts
@src/ui/state/bounty-counts-store.ts
@src/ui/state/bounty-counts-store.test.ts
@src/ui/features/pretty-conversations/PrettyBountyCountBadge.tsx
@src/ui/features/pretty-conversations/PrettyConversationRow.tsx
@src/ui/features/pretty-conversations/pretty-conversations.css
@src/ui/features/pretty-view/BountyCard.tsx
@src/ui/features/pretty-view/IdentityModal.tsx
</context>

<tasks>

<task type="auto">
  <name>Task 1: Backend rename — reader + WS server + their tests (atomic commit)</name>
  <files>src/backend/claude-session/identity-artifact-reader.ts, src/backend/claude-session/identity-artifact-reader.count-bounties.test.ts, src/backend/claude-session/claude-session-server.ts, src/backend/claude-session/claude-session-server.count-bounties.test.ts</files>
  <action>
Perform the backend half of the fleet-wide `on_deck` → `pinned` rename. Every rename below is a straight substitution — no compat shims, no aliases. All four files ship in ONE commit so backend surfaces move atomically.

Concretely, in `src/backend/claude-session/identity-artifact-reader.ts`:
- Rename the exported symbol `readIdentityOnDeckBountyCount` → `readIdentityPinnedBountyCount` (function declaration on line ~777).
- Change the local-branch filter `parsed.status === "on_deck"` → `parsed.status === "pinned"` (the load-bearing behavior change; without this the badge counts zero forever).
- Change the remote-branch Python heredoc string `if j.get("status")=="on_deck": n+=1` → `if j.get("status")=="pinned": n+=1`.
- Update the error message `remote on-deck count returned non-integer` → `remote pinned count returned non-integer`.
- Sweep all block/JSDoc comments in the on-deck header comment block (lines ~758-776 area): `on_deck` → `pinned`, `on-deck` → `pinned`. Preserve wording style; only swap the enum/label tokens.

In `src/backend/claude-session/identity-artifact-reader.count-bounties.test.ts`:
- Import + describe-block + every call site: `readIdentityOnDeckBountyCount` → `readIdentityPinnedBountyCount`.
- Every `writeBounty("<slug>", "on_deck", ...)` fixture → `writeBounty("<slug>", "pinned", ...)`.
- Every test name / describe string / comment referencing `on_deck` or `on-deck` → `pinned`.
- File header comment (line 1) reference to `readIdentityOnDeckBountyCount` → `readIdentityPinnedBountyCount`.
- Behavioral assertions (counts of 2, 3, etc.) stay identical — only the enum value changes.

In `src/backend/claude-session/claude-session-server.ts`:
- Update the import from `identity-artifact-reader.js`: `readIdentityOnDeckBountyCount` → `readIdentityPinnedBountyCount` (line ~23), and the call site (line ~469).
- Rename every `onDeckCount:` field in every emitted WS response object → `pinnedCount:` (lines ~459, 532, 538, 555, 572, 578, 588). This is the wire-format flip.
- Update the type-alias / interface field declaration `onDeckCount: number` → `pinnedCount: number` (line ~459).
- Sweep every doc/JSDoc/inline comment referencing the WS wire format (lines ~37, 64, 444, 453, 1675, 1678, 1689) so `onDeckCount` → `pinnedCount` and `on-deck` → `pinned`.

In `src/backend/claude-session/claude-session-server.count-bounties.test.ts`:
- File header comment (line 7) + mock-setup comment (line 18): `onDeckCount` → `pinnedCount`, `on-deck` → `pinned`.
- `vi.mock(...)` object: `readIdentityOnDeckBountyCount: vi.fn()` → `readIdentityPinnedBountyCount: vi.fn()` (line ~35).
- Import: `readIdentityOnDeckBountyCount` → `readIdentityPinnedBountyCount` (line ~41).
- Test interface / expected-shape type: `onDeckCount: number` → `pinnedCount: number` (line ~49).
- Every `vi.mocked(readIdentityOnDeckBountyCount).*` call site → `vi.mocked(readIdentityPinnedBountyCount).*` (lines ~70, 91, 122, 138, 154, 203, 233).
- Every fixture / expectation object literal `{ ..., onDeckCount: N, ... }` → `{ ..., pinnedCount: N, ... }` (lines ~110, 111, 148, 177, 181, 186, 224, 256, 259). Numeric values (0, 1, 2, 3, 5, 7) stay identical — only the key name changes.

Commit shape (do NOT push):
`git add` the four backend files, then `git commit` with a message capturing that this is the BACKEND HALF of the fleet-wide `on_deck` → `pinned` rename (reader filter + WS wire field + import symbol + their tests, all lockstep). Reference the fleet-wide schema retirement in `~/.claude/skills/id/SKILL.md § Schema` in the commit body. Include a note that the frontend half + identity folder rename land in the next two commits.

⚠️ Do NOT run `npm run build:backend` yet — it will fail until Task 2 flips the wire consumer's field name. Backend + frontend must both land before typecheck passes cleanly. That's why the pre-push typecheck sits in Task 3.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet &amp;&amp; ! git grep -n "on_deck\|onDeck\|OnDeck\|on-deck" -- src/backend/claude-session/</automated>
  </verify>
  <done>Zero occurrences of `on_deck` / `onDeck` / `OnDeck` / `on-deck` remain anywhere under `src/backend/claude-session/`. The commit is on the branch (not pushed, not built).</done>
</task>

<task type="auto">
  <name>Task 2: Frontend rename — WS type + store + badge/row + CSS + BountyCard + IdentityModal (atomic commit)</name>
  <files>src/ui/api/claude-session-api.ts, src/ui/api/claude-session-api.count-bounties.test.ts, src/ui/state/bounty-counts-store.ts, src/ui/state/bounty-counts-store.test.ts, src/ui/features/pretty-conversations/PrettyBountyCountBadge.tsx, src/ui/features/pretty-conversations/PrettyConversationRow.tsx, src/ui/features/pretty-conversations/pretty-conversations.css, src/ui/features/pretty-view/BountyCard.tsx, src/ui/features/pretty-view/IdentityModal.tsx</files>
  <action>
Perform the frontend half of the rename. Every field name flipped in Task 1's backend wire response is consumed here; both must land in lockstep for the type system to accept the wire shape.

In `src/ui/api/claude-session-api.ts`:
- Update the exported type/interface field `onDeckCount: number` → `pinnedCount: number` (line ~395).
- Sweep the section header + JSDoc comments (lines ~365, 371, 378, 405) so `on-deck` / `onDeckCount` → `pinned` / `pinnedCount`. The "batched on-deck bounty count" header becomes "batched pinned bounty count."

In `src/ui/api/claude-session-api.count-bounties.test.ts`:
- Every fixture/mock WS response and every assertion object referencing `onDeckCount` → `pinnedCount` (lines ~83, 84, 124, 131). Numeric values stay identical.

In `src/ui/state/bounty-counts-store.ts`:
- File header comment (lines ~3, 65) `on-deck` → `pinned`.
- Store's mirror-field read: `c.onDeckCount` → `c.pinnedCount` (lines ~114, 115). This is the point where the store copies the WS response value into its keyed cache — flipping this in lockstep with the WS type keeps the store faithful to the wire.
- Any exported helper/function/type-name containing `OnDeck` / `onDeck` → `Pinned` / `pinned` while preserving casing conventions (camelCase for values, PascalCase for types). If none exist beyond the field references above, that's fine — the module already reads the field from a generic BountyCount shape.

In `src/ui/state/bounty-counts-store.test.ts`:
- File header comment (line ~4): `on-deck bounty badge` → `pinned bounty badge`.
- Test interface field (line ~35): `onDeckCount: number` → `pinnedCount: number`.
- Any fixture-builder destructuring (line ~45, 48): `onDeckCount` → `pinnedCount`, preserving positional semantics.

In `src/ui/features/pretty-conversations/PrettyBountyCountBadge.tsx`:
- File header comment (line 4): `on_deck-status bounties` → `pinned-status bounties`.
- No prop rename needed here — the badge's own prop is `count` (a generic number), not `onDeckCount`. Verify by reading the component; if it does have an `onDeckCount` prop, rename it to `pinnedCount` and update the JSX consumer in `PrettyConversationRow.tsx` in lockstep.
- Update the a11y label / `title` copy that renders "on-deck" user-visible text → "pinned" (e.g. `title="N on-deck bounties"` → `title="N pinned bounties"`). Verify against the actual JSX; the tb1 patch used "on-deck" phrasing in the tooltip.

In `src/ui/features/pretty-conversations/PrettyConversationRow.tsx`:
- Local variable / hook return name `onDeckCount` (line ~157) → `pinnedCount`. Update the `useBountyCount(...)` destructure and every downstream reference within the component (line ~510 `count={onDeckCount}` → `count={pinnedCount}`).
- Comments: line ~149 "per-row on-deck bounty count" → "per-row pinned bounty count"; line ~499 JSX comment "per-row on-deck bounty count badge" → "per-row pinned bounty count badge"; line ~507 "on-deck bounties" → "pinned bounties".

In `src/ui/features/pretty-conversations/pretty-conversations.css`:
- Header comment on line ~680 "per-row on-deck bounty count badge" → "per-row pinned bounty count badge".
- If ANY class name contains `--on-deck` / `-on-deck` (e.g. `.pretty-bounty-count-badge--on-deck`), rename to `--pinned` / `-pinned` and update the matching JSX className in `PrettyBountyCountBadge.tsx` in lockstep. Verify by reading the CSS file; if no such class exists it's a comment-only edit.

In `src/ui/features/pretty-view/BountyCard.tsx`:
- Status style map key (line ~24): `on_deck: "bg-amber-500/25 text-amber-200 border border-amber-500/40"` → `pinned: "bg-amber-500/25 text-amber-200 border border-amber-500/40"`. Amber styling stays identical — only the key rotates.
- Status label map (line ~34): `on_deck: "On Deck"` → `pinned: "Pinned"`. This is what the user sees on a pinned-bounty card.

In `src/ui/features/pretty-view/IdentityModal.tsx`:
- Comment-only sweep on lines ~19, ~87, ~311, ~330, ~418 — every `on_deck` / `on-deck` in a `//` comment → `pinned`. No code changes; this is doc-hygiene so a future grep doesn't hit stale references.

Commit shape:
`git add` all nine frontend files, then `git commit` with a message capturing that this is the FRONTEND HALF of the rename (WS consumer type + store + badge props/copy + row pass-through + CSS + BountyCard style/label + IdentityModal doc sweep). Reference the backend commit from Task 1 in the body ("pairs with <sha> to complete the wire flip").

⚠️ Still do NOT run `npm run build:backend` or `npm run build` yet — Task 3 owns the full pre-push typecheck sequence.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet &amp;&amp; ! git grep -n "on_deck\|onDeck\|OnDeck\|on-deck" -- src/</automated>
  </verify>
  <done>Zero occurrences of `on_deck` / `onDeck` / `OnDeck` / `on-deck` remain anywhere under `src/` (backend AND frontend combined). Two commits are on the branch (backend + frontend), not pushed, not built.</done>
</task>

<task type="auto">
  <name>Task 3: Identity bounty folder rename + full pre-push verification (mv, docs, build:backend, build, tests)</name>
  <files>~/.claude/identities/tina/bounties/pretty-conversations-on-deck-badge/ (renamed to pretty-conversations-pinned-badge/), ~/.claude/identities/tina/bounties/pretty-conversations-pinned-badge/bounty.json</files>
  <action>
Two independent pieces that both must happen before the executor reports done: (a) the identity bounty folder rename with a timeline entry, (b) the full pre-push typecheck + test sweep. Order: verification FIRST (so the executor doesn't announce done on a broken tree), then the folder rename (which is docs-hygiene and can't affect the build).

Step 1 — Pre-push verification sweep (mandatory, patch #154 lesson):

Run in order and confirm all four pass BEFORE proceeding:
- `npm run build:backend` — must exit 0. Backend files were touched; frontend `tsc --noEmit` alone would silently pass a missed backend edit and only fail at docker-build time. `build:backend` is the strictest local check short of a full docker build.
- `npm run build` — must exit 0. Full frontend production build; catches the vite/tsc pipeline together.
- `npm run test:backend` — must be 223 passing / 0 failing (baseline the tb1 patch left green).
- `npm run test` — must be 486 passing / 0 failing (baseline the tb1 patch left green).

If ANY of the four fails, STOP and surface the failure verbatim; do NOT auto-fix without user input, because a red typecheck after a rename usually means one occurrence was missed and the right move is to find + fix it explicitly (a hidden false-negative is worse than a loud fail).

⚠️ For long-running commands (build:backend, build) use file-redirect + explicit exit code capture per patch #154 — NEVER `| tail`. Pattern:
`npm run build:backend > /tmp/bb.log 2>&1; echo "EXIT_BB: $?"` then Read `/tmp/bb.log` for the tail. Same for `npm run build`. Tail-with-pipe masks the exit code and shipped a stale image in patch #154's near-miss.

Step 2 — Identity bounty folder rename:

Rename the tb1 patch's bounty folder to match the new terminology and record the fleet-wide sweep in its timeline:
- `mv ~/.claude/identities/tina/bounties/pretty-conversations-on-deck-badge ~/.claude/identities/tina/bounties/pretty-conversations-pinned-badge`
- Read the moved `~/.claude/identities/tina/bounties/pretty-conversations-pinned-badge/bounty.json`.
- Update its `title` field: replace any "on-deck" or "on_deck" with "pinned" (e.g. "Per-row on-deck bounty count badge on pretty-conversations panel" → "Per-row pinned bounty count badge on pretty-conversations panel").
- Append a `timeline[]` entry (with today's ISO-Z prefix, `2026-07-27T...Z`) noting the fleet-wide schema rename `on_deck` → `pinned` and this followup that swept the fork's references in lockstep. One line, e.g. `"2026-07-27T... · fleet-wide bounty status on_deck retired → pinned; this quick (260727-uae) swept fork references (reader filter, WS wire field pinnedCount, store, badge, BountyCard, IdentityModal comments) in lockstep and renamed this bounty folder to match"`.
- Bump `updated_at` to the same ISO-Z timestamp.
- Keep `status: "waiting_on_someone_else"` — the bounty is not done (it's blocked on Ashley's deploy authorization for the tb1 badge itself), and this rename doesn't change that status axis. Do NOT flip it to `pinned` or `done` unless explicitly told to.

Step 3 — Final commit + STOP:

`git add` nothing further (the identity folder rename is outside the repo; nothing to commit in-repo for step 2). If the build/test pass revealed any missed edit that needed a fix commit, that fix belongs as a small third commit on top of the two rename commits.

⚠️ STOP HERE — do NOT `git push`, do NOT `docker build`, do NOT `docker compose up`. Fleet rule (Ashley 2026-07-27, patch #153 lesson): a code-work ask authorizes CODE motion only. Report to the user: "backend + frontend rename committed on the branch (2 commits); identity bounty folder renamed; build:backend + build + test:backend + test all green; not pushed, not built for deploy — waiting on your 'ship it' before push+build+deploy." Then wait.
  </action>
  <verify>
    <automated>test -d /home/ubuntu/.claude/identities/tina/bounties/pretty-conversations-pinned-badge &amp;&amp; ! test -d /home/ubuntu/.claude/identities/tina/bounties/pretty-conversations-on-deck-badge &amp;&amp; grep -q '"pinned"\|pinned' /home/ubuntu/.claude/identities/tina/bounties/pretty-conversations-pinned-badge/bounty.json</automated>
  </verify>
  <done>Both pre-push builds (`build:backend`, `build`) exit 0. Both test suites are green (223/223 backend, 486/486 frontend). Identity bounty folder renamed and its bounty.json title + timeline reflect the rename. Nothing pushed, nothing built for deploy. Handoff line stated to the user so they know exactly what state the branch is in.</done>
</task>

</tasks>

<verification>
Fleet-wide verification of the rename:

```bash
# In /home/ubuntu/skynet:
git grep -n "on_deck\|onDeck\|OnDeck\|on-deck" -- src/   # MUST return zero matches
git log --oneline -3                                       # MUST show 2 new commits (backend, frontend) — 3 if a fix commit was needed

# Identity folder:
ls ~/.claude/identities/tina/bounties/ | grep -i "pinned\|on-deck"
# MUST show pretty-conversations-pinned-badge; MUST NOT show pretty-conversations-on-deck-badge

# Full pre-push sweep (all four must pass):
npm run build:backend > /tmp/bb.log 2>&1; echo "EXIT: $?"
npm run build         > /tmp/fb.log 2>&1; echo "EXIT: $?"
npm run test:backend                                       # 223/223
npm run test                                               # 486/486
```

Nothing is pushed. Nothing is docker-built for deploy. The tree is on the branch, green, and awaiting Ashley's explicit deploy authorization.
</verification>

<success_criteria>
- Zero `on_deck` / `onDeck` / `OnDeck` / `on-deck` occurrences under `src/`.
- `readIdentityPinnedBountyCount` is the exported name; the reader filters `.status === "pinned"`.
- WS response field on the wire is `pinnedCount` (backend emitter + frontend consumer type + store cache-write in lockstep).
- BountyCard renders `Pinned` under the amber style for a bounty with `status: "pinned"`.
- `npm run build:backend` + `npm run build` both exit 0.
- `npm run test:backend` = 223/223; `npm run test` = 486/486.
- Identity bounty folder at `~/.claude/identities/tina/bounties/pretty-conversations-pinned-badge/` exists; the on-deck-named folder no longer exists; its `bounty.json` title + timeline reflect the rename; `status` unchanged (still `waiting_on_someone_else`).
- Two commits on the branch (backend, frontend); no push; no docker build; no `docker compose up`. Executor reports the branch state and stops at the push authorization boundary.
</success_criteria>

<output>
Create `.planning/quick/260727-uae-rename-fleet-wide-bounty-status-on-deck-/260727-uae-SUMMARY.md` when done — one-page summary of what shipped, what commits are on the branch, and the verification results.
</output>

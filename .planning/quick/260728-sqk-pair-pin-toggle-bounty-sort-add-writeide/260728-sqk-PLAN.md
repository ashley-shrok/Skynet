---
quick: 260728-sqk-pair-pin-toggle-bounty-sort-add-writeide
type: execute
wave: 1
depends_on: []
files_modified:
  - src/backend/claude-session/identity-artifact-reader.ts
  - src/backend/claude-session/claude-session-server.ts
  - src/backend/claude-session/identity-artifact-reader.write-bounty-pinned.test.ts
  - src/ui/api/claude-session-api.ts
  - src/ui/features/pretty-view/BountyCard.tsx
  - src/ui/features/pretty-view/IdentityModal.tsx
  - .planning/quick/260728-sqk-pair-pin-toggle-bounty-sort-add-writeide/172-PATCH-ENTRY-DRAFT.md
autonomous: true
requirements:
  - pin-toggle-ui-in-identity-modal
  - identity-modal-sort-bounties-by-priority

must_haves:
  truths:
    - "Backend exposes a `writeIdentityBountyPinned` writer with both local and remote (SSH) branches that flips `bounty.pinned` to true/false, bumps `updated_at`, and appends a timeline line — mirroring `writeIdentityBountyStatus`."
    - "WS server accepts `identity:update-bounty-pinned` and replies with `identity:bounty-pinned-updated {bounties, archivedBounties, error?}`, validated with IDENTITY_KEY_RE + IDENTITY_SLUG_RE + boolean type check."
    - "`normalizeBounty` includes `pinned: boolean` (defaulting to false) so both bounty lists carry the field to the frontend."
    - "`Bounty` wire type gains `pinned: boolean`; new payload/event types `IdentityUpdateBountyPinnedPayload` + `IdentityBountyPinnedUpdatedEvent` are added to the WS discriminated union."
    - "`BountyCard` renders a star pin toggle (filled for pinned=true, hollow for pinned=false) adjacent to the StatusPill row and fires `onPinnedChange` prop when clicked."
    - "`IdentityModal` groups any bounty with `pinned===true` into a new `pinned` group rendered at the top of `OPEN_STATUS_ORDER` (labelled `Pinned`), REGARDLESS of its `status`, and preserves the existing within-group priority + updated_at sort."
    - "The stale patch-#109 comment at IdentityModal.tsx :90-98 is rewritten to reflect the new schema: pinned is an independent boolean with its own top group; rest still collapses waiting_on_someone_else + anything-not-in_progress-not-terminal."
    - "`172-PATCH-ENTRY-DRAFT.md` exists in the quick's work folder documenting the paired change (not pasted into skynet-patches.md — deploy-time only)."
    - "Both bounty folders are flipped to `status:done` with a closing timeline line and moved into `~/.claude/identities/tina/bounties/archive/` after code lands."
  artifacts:
    - path: "src/backend/claude-session/identity-artifact-reader.ts"
      provides: "writeIdentityBountyPinned + normalizeBounty pinned propagation"
      contains: "writeIdentityBountyPinned"
    - path: "src/backend/claude-session/claude-session-server.ts"
      provides: "identity:update-bounty-pinned WS dispatch case"
      contains: "identity:update-bounty-pinned"
    - path: "src/backend/claude-session/identity-artifact-reader.write-bounty-pinned.test.ts"
      provides: "Vitest coverage for pinned writer round-trip + slug validation"
      contains: "writeIdentityBountyPinned"
    - path: "src/ui/api/claude-session-api.ts"
      provides: "Bounty.pinned + IdentityUpdateBountyPinnedPayload/Event types + union members"
      contains: "IdentityBountyPinnedUpdatedEvent"
    - path: "src/ui/features/pretty-view/BountyCard.tsx"
      provides: "PinToggle star icon + onPinnedChange prop wiring"
      contains: "onPinnedChange"
    - path: "src/ui/features/pretty-view/IdentityModal.tsx"
      provides: "pinned group at top of OPEN_STATUS_ORDER + updateBountyPinned handler + refreshed :90-98 comment"
      contains: "updateBountyPinned"
    - path: ".planning/quick/260728-sqk-pair-pin-toggle-bounty-sort-add-writeide/172-PATCH-ENTRY-DRAFT.md"
      provides: "Draft skynet-patches.md #172 entry (not pasted until deploy)"
  key_links:
    - from: "src/ui/features/pretty-view/BountyCard.tsx"
      to: "src/ui/features/pretty-view/IdentityModal.tsx"
      via: "onPinnedChange prop wired to updateBountyPinned(bounty.slug, next)"
      pattern: "onPinnedChange"
    - from: "src/ui/features/pretty-view/IdentityModal.tsx"
      to: "src/backend/claude-session/claude-session-server.ts"
      via: "identity:update-bounty-pinned WS payload + identity:bounty-pinned-updated response"
      pattern: "identity:update-bounty-pinned"
    - from: "src/backend/claude-session/claude-session-server.ts"
      to: "src/backend/claude-session/identity-artifact-reader.ts"
      via: "writeIdentityBountyPinned(conn, key, slug, pinned) call"
      pattern: "writeIdentityBountyPinned"
---

<objective>
Pair two bounties into ONE atomic patch (skynet fork #172):
1. `pin-toggle-ui-in-identity-modal` — add a write path + UI star toggle for the independent `pinned` boolean field on bounty.json.
2. `identity-modal-sort-bounties-by-priority` — surface pinned rows in a global top group above the existing in_progress fence.

Backend gets a new `writeIdentityBountyPinned` byte-shape mirror of `writeIdentityBountyStatus`, matching the fleet schema post-#168 where `pinned` is orthogonal to lifecycle `status`. Frontend gets a PinToggle star on BountyCard + a "Pinned" group prepended to `OPEN_STATUS_ORDER` in IdentityModal.

Purpose: Ashley can pin/unpin bounties inline from the identity modal and see pinned bounties surfaced at the top of the sort regardless of status — closes both bounties in one commit on `feat/tab-title-from-tmux`.

Output: Backend writer + WS handler + backend test; wire types; PinToggle in BountyCard; sortBounties/grouping updates + comment refresh in IdentityModal; draft patch-entry doc.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/backend/claude-session/identity-artifact-reader.ts
@src/backend/claude-session/claude-session-server.ts
@src/backend/claude-session/identity-artifact-reader.write-bounty-status.test.ts
@src/ui/api/claude-session-api.ts
@src/ui/features/pretty-view/BountyCard.tsx
@src/ui/features/pretty-view/IdentityModal.tsx
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Backend writeIdentityBountyPinned + WS handler + test + normalizeBounty propagation</name>
  <files>
    src/backend/claude-session/identity-artifact-reader.ts,
    src/backend/claude-session/claude-session-server.ts,
    src/backend/claude-session/identity-artifact-reader.write-bounty-pinned.test.ts
  </files>
  <behavior>
    - Test A (local round-trip pinned=true): seed a bounty.json with `pinned:false`; call `writeIdentityBountyPinned(null, KEY, SLUG, true)`; re-read → `parsed.pinned === true`, `updated_at` bumped (differs from seed and parses as valid date), timeline[] gains a line matching `/pinned set to true via identity modal$/`, timeline[0] unchanged (`"seed"`).
    - Test B (local round-trip pinned=false): seed a bounty.json with `pinned:true`; call `writeIdentityBountyPinned(null, KEY, SLUG, false)`; re-read → `parsed.pinned === false`, `updated_at` bumped, timeline appended with `/pinned set to false via identity modal$/`.
    - Test C (invalid pinned type rejected): call with `"true" as unknown as boolean` (or any non-boolean) → rejects with `/invalid pinned/`.
    - Test D (folder untouched): flip pinned; verify sibling directory listing under `<root>/<KEY>/bounties/` is unchanged (no rename, no archive dir created) — mirrors the guarantee in the status-writer test.
    - Test E (invalid slug on remote branch): call with `bountySlug: "../evil"` on the remote branch surrogate → rejects with `/invalid bounty slug/`. (No ssh2 mock needed — trigger via the pre-remote-branch validation the same way `writeIdentityBountyStatus`'s slug check is triggered by mocking conn as an object that the function checks the slug BEFORE using.)
    - No sibling folder is created or renamed under `bounties/` regardless of the new `pinned` value.
  </behavior>
  <action>
    Add `writeIdentityBountyPinned(conn, identityKey, bountySlug, pinned)` to `src/backend/claude-session/identity-artifact-reader.ts` as a byte-shape mirror of `writeIdentityBountyStatus` (starts ~line 796). Follow the same shape exactly:
    - Validate `pinned` is `typeof "boolean"`; else throw `Error("invalid pinned")`.
    - Compute `nowIso = new Date().toISOString()` and `timelineLine = "${nowIso} pinned set to ${pinned} via identity modal"`.
    - LOCAL branch (`conn === null`): resolve `filePath` via `getLocalIdentitiesRoot()` + join → `<root>/<identityKey>/bounties/<bountySlug>/bounty.json`; readFile → JSON.parse; set `parsed.pinned = pinned`; set `parsed.updated_at = nowIso`; append `timelineLine` to `parsed.timeline` (guard non-array); JSON.stringify with 2-space indent + trailing `\n`; tmp+rename write.
    - REMOTE branch: validate slug via `IDENTITY_SLUG_RE`; construct python3 script byte-identical to status writer except: use `d["pinned"]=u["pinned"]`, timeline line is `"pinned set to "+str(u["pinned"]).lower()+" via identity modal"` so remote emits `true`/`false` (lowercase JS-style, matching what the wire will show in the panel). Payload is `JSON.stringify({ pinned })`; same `execWithTimeout` invocation shape.
    - Place the function directly BELOW `writeIdentityBountyStatus` (before section 9 archiveIdentityBounty) with a numbered section-8b header comment: `// 8b. writeIdentityBountyPinned — patch bounty.json's pinned field` referencing patch #172 and Nelly's 2026-07-28 fleet migration (per full_scope schema notes).

    Update `normalizeBounty` (~line 171) to add a new field: `pinned: typeof parsed.pinned === "boolean" ? parsed.pinned : false,` alongside the other fields so both open and archived bounty payloads carry the flag to the frontend.

    Add WS dispatch case in `src/backend/claude-session/claude-session-server.ts` — mirror the `identity:update-bounty-status` block at ~line 2083-2156 exactly, differing only by:
    - New msg type: `"identity:update-bounty-pinned"`.
    - Response type: `"identity:bounty-pinned-updated"`.
    - Extract `rawPinned = raw.pinned`; validate `typeof rawPinned === "boolean"`; else emit `{ error: "invalid pinned" }`.
    - `writeIdentityBountyPinned(...)` (both local + remote branches) instead of `writeIdentityBountyStatus`.
    - Log operation names `"identity_update_bounty_pinned"` / `"identity_update_bounty_pinned_error"`.
    - Reuse the same IDENTITY_KEY_RE + IDENTITY_SLUG_RE validation shape.
    Place the case block directly BELOW the status handler (before `identity:update-bounty-priority` at ~line 2158), keeping the same import-block conventions.
    Add `writeIdentityBountyPinned` to the destructured import from `./identity-artifact-reader.js` at the top of `claude-session-server.ts` (~line 26 alongside `writeIdentityBountyStatus`).

    Update the WS protocol comment header (~line 50, alongside the `identity:update-bounty-status` line) to document the new `identity:update-bounty-pinned` payload and `identity:bounty-pinned-updated` response — same style, reference `pinned` is a boolean orthogonal to status per patch #168 fleet migration.

    Create new test file `src/backend/claude-session/identity-artifact-reader.write-bounty-pinned.test.ts` — clone the shape of `identity-artifact-reader.write-bounty-status.test.ts` (`beforeEach` mkdtemp + IDENTITIES_HOST_DIR env; `afterEach` cleanup; `seedBounty` helper) and cover behaviors A-E above. Import `writeIdentityBountyPinned` from `./identity-artifact-reader.js`. Assertions must use vitest matchers (`.toBe`, `.toMatch`, `.rejects.toThrow`, `.toEqual`).
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet &amp;&amp; npx vitest run src/backend/claude-session/identity-artifact-reader.write-bounty-pinned.test.ts src/backend/claude-session/identity-artifact-reader.write-bounty-status.test.ts</automated>
  </verify>
  <done>
    - New writer + new WS case + new test file all present.
    - All 5 behavior tests (A-E) pass in vitest; existing status-writer test still passes (regression guard).
    - `writeIdentityBountyPinned` visible in server's imports and dispatched on `identity:update-bounty-pinned`.
    - `normalizeBounty` returns `pinned` field (default `false`) — implicit via subsequent test cases that assert the field surfaces on the wire (see Task 2 pre-check + Task 3 frontend behavior).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Wire types + BountyCard star pin toggle</name>
  <files>
    src/ui/api/claude-session-api.ts,
    src/ui/features/pretty-view/BountyCard.tsx
  </files>
  <behavior>
    - Wire-type: `Bounty` gains required `pinned: boolean`. `IdentityUpdateBountyPinnedPayload` + `IdentityBountyPinnedUpdatedEvent` exist and are members of the outbound + inbound WS discriminated unions (`ClaudeSessionServerEvent`).
    - BountyCard renders a star affordance: when `bounty.pinned === true` the star is FILLED (lucide `Star` with `fill="currentColor"`); when `false` the star is HOLLOW (no fill). The star sits on the same row as the status pill (adjacent to it), sized `h-3.5 w-3.5`, unobtrusive/Telegram-shape.
    - When `onPinnedChange` prop is provided, clicking the star fires `onPinnedChange(!bounty.pinned)` (Promise-returning). Local `savingPinned` state disables the button during flight; `pinnedError` renders inline on failure (same shape as `savingStatus` + `statusError`).
    - When `onPinnedChange` is NOT provided (e.g. static/read-only render), the star still renders as a visual indicator but is `disabled` and has no click handler. (Consistent with archived-in-place cards that render other pills read-only.)
    - Clicking the star does NOT trigger the row's expand toggle — stop propagation on the button's onClick.
    - `aria-label` on the star reads `"Pin bounty"` when `pinned=false` and `"Unpin bounty"` when `pinned=true`; `aria-pressed` reflects the current pinned state.
  </behavior>
  <action>
    In `src/ui/api/claude-session-api.ts`:
    - Add `pinned: boolean;` as a required field on the `Bounty` type (~line 268-285), documented inline as: `/** Patch #168 / #172: independent of status; true if pinned. Backend normalizeBounty defaults to false when the field is absent from bounty.json. */`.
    - Add new payload type immediately after `IdentityUpdateBountyStatusPayload` (~line 424):
      ```ts
      // Quick 260728-sqk / patch #172: byte-shape mirror of the status payload
      // for the parallel pinned write surface. pinned is an independent boolean
      // orthogonal to lifecycle status (fleet schema post-#168).
      export type IdentityUpdateBountyPinnedPayload = {
        type: "identity:update-bounty-pinned";
        identityKey: string;
        hostId: number;
        bountySlug: string;
        pinned: boolean;
      };
      export type IdentityBountyPinnedUpdatedEvent = {
        type: "identity:bounty-pinned-updated";
        bounties: Bounty[];
        archivedBounties: Bounty[];
        error?: string;
      };
      ```
      (Note: NEVER embed fenced code in `<action>` per planner rules — the block above is intentionally inlined only in the plan artifact itself as a naming/shape reference for the executor; when writing action code use the pattern names + field list without a fenced block. In this action, treat the fenced block as the target shape only, and write it as normal TypeScript.)
    - Add `IdentityBountyPinnedUpdatedEvent` to the `ClaudeSessionServerEvent` union (~line 190-218), placed alphabetically near `IdentityBountyStatusUpdatedEvent`.

    In `src/ui/features/pretty-view/BountyCard.tsx`:
    - Import `Star` from `lucide-react`.
    - Add prop to component signature:
      - `onPinnedChange?: (pinned: boolean) => Promise<void>;` documented as: `/** Quick 260728-sqk / patch #172: when supplied, header row renders a pin-toggle star; click fires this callback with the flipped boolean. Supplied for ALL bounties including archived (unpin an archived pinned bounty stays legal). */`.
    - Add `savingPinned` + `pinnedError` useState slots mirroring `savingStatus` + `statusError`.
    - Add `handlePinnedChange(next: boolean)` async fn mirroring `handleStatusChange`.
    - In the header disclosure `<button>` (~line 320-361), insert a NEW `<button type="button">` for the star:
      - Placement: adjacent to the status pill span (before the `PriorityIcon` shrink-0 span), inline in the header row so the pin visually reads as part of the meta cluster.
      - `onClick={(e) => { e.stopPropagation(); void handlePinnedChange(!bounty.pinned); }}` — stop propagation prevents the disclosure toggle from firing.
      - `disabled={!onPinnedChange || savingPinned}`.
      - `aria-label={bounty.pinned ? "Unpin bounty" : "Pin bounty"}`, `aria-pressed={bounty.pinned}`, `title` mirror.
      - Star icon: `<Star className={cn("h-3.5 w-3.5", bounty.pinned ? "text-amber-300" : "text-[#a89a80]")} fill={bounty.pinned ? "currentColor" : "none"} />`.
      - Classes: `shrink-0 rounded p-0.5 transition-colors cursor-pointer hover:brightness-125 disabled:opacity-60 disabled:cursor-default`.
    - Render `pinnedError` inline in the expanded body near the other error slots (below StatusRow's `statusError` block) with the same `text-xs text-rose-300 whitespace-pre-wrap` styling.
    - Update the Patch #168 comment near `STATUS_CLASSES` (~line 27-30) to add a reference: `// Patch #172: pin-toggle handled by the header-row star (not a status pill) — see onPinnedChange prop.`

    Do NOT wire `onPinnedChange` in IdentityModal in this task — Task 3 covers that. BountyCard's `onPinnedChange` remains optional so this task can be compiled and typechecked independently.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet &amp;&amp; npm run build:backend &amp;&amp; npm run build</automated>
  </verify>
  <done>
    - `Bounty` type has `pinned: boolean`; new payload + event types defined and in the union.
    - `BountyCard` compiles with the new optional `onPinnedChange` prop; star renders in the header row.
    - `npm run build:backend` AND `npm run build` both succeed with zero TS errors — frontend tsc alone is not sufficient per fleet typecheck rule.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: IdentityModal Pinned group + updateBountyPinned handler + comment refresh + draft patch entry + close bounties</name>
  <files>
    src/ui/features/pretty-view/IdentityModal.tsx,
    .planning/quick/260728-sqk-pair-pin-toggle-bounty-sort-add-writeide/172-PATCH-ENTRY-DRAFT.md
  </files>
  <behavior>
    - `OPEN_STATUS_ORDER` starts with `"pinned"` as the FIRST entry: `["pinned", "in_progress", "rest", "other"]`.
    - `GROUP_LABELS.pinned === "Pinned"`.
    - `grouped` useMemo: for every bounty in `bounties`, if `b.pinned === true` push into `groups.pinned` REGARDLESS of `b.status` (checked BEFORE the existing `isArchived` / `in_progress` / `rest` branches). Bounties with `pinned:false` fall through to the existing status-driven partitioning unchanged.
    - Within each partition (including `pinned`), the existing `sortBounties` (priority asc, updated_at desc) still applies — pinned rows appear priority-sorted at the top.
    - New handler `updateBountyPinned(bountySlug, pinned)` mirrors `updateBountyStatus`: builds `IdentityUpdateBountyPinnedPayload`, awaits `sendIdentityMutation` on `"identity:bounty-pinned-updated"`, throws on `res.error`, sets `bounties` + `archivedBounties` from the response, calls `void invalidateBountyCount(identity.identityKey, hostId)` (piggyback path — pinning a bounty directly changes the pinned count).
    - `onPinnedChange={(next) => updateBountyPinned(b.slug, next)}` is threaded into EVERY `<BountyCard>` render site: the open-group loop across all four partitions (pinned/in_progress/rest/other) AND the sortedArchive.map inside the Archive accordion.
    - The stale patch-#109 comment at :90-98 is rewritten to: "Patch #172: `pinned` is now an independent boolean field. Pinned bounties get their own top group (`pinned`) rendered above the in_progress fence regardless of status. Below that, in_progress keeps its fence; `rest` still collapses waiting_on_someone_else + anything else that's not in_progress + not done/dropped into one flat priority-sorted region (no header). done/dropped-in-place bounties still bucket to `other` with a quiet header so recently-closed work doesn't blend into open work."
    - `hasOpen` check still works: since `OPEN_STATUS_ORDER` now includes `"pinned"`, and `grouped` has all four keys initialized to `[]`, the existing `.some(...)` predicate correctly returns true when any of the four groups is non-empty.
    - The draft patch entry file exists at the specified path with a coherent 1-2 paragraph #172 entry describing the paired change (backend writer + WS + frontend pin toggle + top-group sort), noting it is a DRAFT to be pasted into `~/skynet-patches.md` at deploy time only.
    - After the code lands, both source bounties (`~/.claude/identities/tina/bounties/pin-toggle-ui-in-identity-modal/bounty.json` and `~/.claude/identities/tina/bounties/identity-modal-sort-bounties-by-priority/bounty.json`) have `status:"done"`, `updated_at` bumped, a closing timeline line, and their folders are `mv`'d into `~/.claude/identities/tina/bounties/archive/`.
  </behavior>
  <action>
    In `src/ui/features/pretty-view/IdentityModal.tsx`:
    - Add `IdentityUpdateBountyPinnedPayload` + `IdentityBountyPinnedUpdatedEvent` to the `import type { ... }` block from `@/api/claude-session-api` (~line 26-50).
    - Change `OPEN_STATUS_ORDER` (~line 99) from `["in_progress", "rest", "other"]` to `["pinned", "in_progress", "rest", "other"]`.
    - Add `GROUP_LABELS.pinned = "Pinned"` (~line 101-105 object literal).
    - Rewrite the comment block at :90-98 per the behavior spec above. Delete stale references to "pinned + waiting_on_someone_else + anything else... collapse into rest" and replace with the new reality where pinned is a boolean with its own top group.
    - In the `grouped` useMemo (~line 319-347): initialize `groups: Record<string, Bounty[]> = { pinned: [], in_progress: [], rest: [], other: [] }`. In the for-loop, FIRST check `if (b.pinned === true) { groups.pinned.push(b); continue; }` BEFORE the existing `isArchived` check — this makes pinned globally win over status-based partitioning. Everything else remains unchanged (isArchived → other, in_progress → in_progress, else → rest). The `sortBounties` fan-out over `Object.keys(groups)` covers the new key automatically.
    - Add a new handler `updateBountyPinned` immediately AFTER `updateBountyStatus` (~line 456). Mirror byte-shape exactly:
      - `payload: IdentityUpdateBountyPinnedPayload = { type: "identity:update-bounty-pinned", identityKey: identity.identityKey, hostId, bountySlug, pinned }`.
      - `sendIdentityMutation<IdentityUpdateBountyPinnedPayload, IdentityBountyPinnedUpdatedEvent>(payload, "identity:bounty-pinned-updated")`.
      - Throw on `res.error`; `setBounties(res.bounties)` + `setArchivedBounties(res.archivedBounties)`; `void invalidateBountyCount(identity.identityKey, hostId)` (pinning a bounty deterministically changes the pinned count — same justification as `updateBountyStatus`).
    - Thread `onPinnedChange` prop into ALL FOUR `<BountyCard>` render sites:
      - The open-group loop (~line 719-766): `onPinnedChange={(next) => updateBountyPinned(b.slug, next)}` for every partition including `"other"` — pinning a done-in-place bounty is a legal resurrect signal same as status.
      - The archive accordion `<BountyCard>` (~line 777-795): same prop wired the same way (unpinning an archived pinned bounty stays legal, and re-pinning is the resurrect signal on the pinned axis).
    - Verify `hasOpen` at :488 still works with the new `"pinned"` entry in `OPEN_STATUS_ORDER` — no change should be required (the `.some((s) => grouped[s].length > 0)` predicate iterates all four keys). If TS complains about `grouped[s]` narrowing after the initialization change, ensure `groups` uses `Record<string, Bounty[]>` (already the case).

    Create the draft patch entry file at `.planning/quick/260728-sqk-pair-pin-toggle-bounty-sort-add-writeide/172-PATCH-ENTRY-DRAFT.md`. Content: 1-2 short paragraphs matching the numbered-patch entry style used elsewhere in `~/skynet-patches.md`. Include:
    - Patch number header: `## Patch #172 — pin-toggle + global pinned sort in identity modal`.
    - Body: mention it is a paired atomic commit closing two Tina bounties (`pin-toggle-ui-in-identity-modal` + `identity-modal-sort-bounties-by-priority`), on branch `feat/tab-title-from-tmux`. Enumerate the four surfaces touched (backend writer, WS handler, wire types, BountyCard star, IdentityModal grouping). Reference the fleet #168 schema migration (pinned is now a boolean orthogonal to status). Note that within-group sort (priority asc, updated_at desc) is preserved for the new pinned group.
    - Footer: `**Draft — do NOT paste into skynet-patches.md until same-turn as deploy per fleet inline-docs rule.**`

    After committing the code (git commit happens in the orchestrator's Step 8), close the two source bounties via shell (this runs at the end of Task 3 as the final action-block step):
    - For each of `~/.claude/identities/tina/bounties/pin-toggle-ui-in-identity-modal/bounty.json` and `~/.claude/identities/tina/bounties/identity-modal-sort-bounties-by-priority/bounty.json`:
      1. Read the JSON, set `status="done"`, set `updated_at` to the current ISO-Z timestamp, append a timeline line like `"<ISO-Z> closed by quick 260728-sqk (paired pin-toggle + pinned-sort atomic patch, patch #172 draft in .planning/quick/260728-sqk.../172-PATCH-ENTRY-DRAFT.md)"`.
      2. Write via a tmp+rename pattern (python3 one-liner or node --input-type=module invocation is fine — the goal is atomicity not tooling purity).
      3. `mkdir -p ~/.claude/identities/tina/bounties/archive/` (idempotent).
      4. `mv ~/.claude/identities/tina/bounties/<slug>/ ~/.claude/identities/tina/bounties/archive/<slug>/`.
    - Do NOT git-commit the bounty JSON edits — they live outside the repo (`~/.claude/identities/` is the fleet-shared identity dir, not `~/skynet/`). This side-effect is purely the fleet bounty-lifecycle bookkeeping.

    Constraints (re-stated from full_scope for the executor):
    - Do NOT push, do NOT docker build, do NOT deploy. Ashley bundles deploy separately.
    - Do NOT commit docs artifacts (SUMMARY.md, PLAN.md, STATE.md, 172-PATCH-ENTRY-DRAFT.md) — orchestrator handles docs commit in Step 8.
    - Commit atomically on `feat/tab-title-from-tmux` (already checked out; no branch switch).
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet &amp;&amp; npm run build:backend &amp;&amp; npm run build &amp;&amp; test -f .planning/quick/260728-sqk-pair-pin-toggle-bounty-sort-add-writeide/172-PATCH-ENTRY-DRAFT.md &amp;&amp; grep -q "Patch #172" .planning/quick/260728-sqk-pair-pin-toggle-bounty-sort-add-writeide/172-PATCH-ENTRY-DRAFT.md &amp;&amp; grep -q '^  "pinned"' src/ui/features/pretty-view/IdentityModal.tsx &amp;&amp; grep -q "updateBountyPinned" src/ui/features/pretty-view/IdentityModal.tsx</automated>
  </verify>
  <done>
    - `OPEN_STATUS_ORDER` begins with `"pinned"`; `GROUP_LABELS.pinned === "Pinned"`.
    - `grouped` partitions any pinned bounty into the pinned group regardless of status; within-group sort preserved.
    - `updateBountyPinned` handler exists and is wired into all four open-group render sites + the archive accordion `BountyCard`.
    - Stale :90-98 comment rewritten to the new schema reality.
    - `npm run build:backend` AND `npm run build` both succeed with zero TS errors.
    - `172-PATCH-ENTRY-DRAFT.md` exists in the quick's folder with the described content.
    - Both source bounty folders are `mv`'d into `~/.claude/identities/tina/bounties/archive/` with `status:"done"` + closing timeline line + bumped `updated_at`.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser → WS server (port 30011) | Untrusted client payload crosses here — JSON with `identity:update-bounty-pinned` including identityKey, bountySlug, pinned. |
| WS server → remote identity box (SSH exec) | identityKey + bountySlug are interpolated into remote shell paths. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-172-01 | Tampering | `identity:update-bounty-pinned` WS handler | mitigate | Validate identityKey with `IDENTITY_KEY_RE`, bountySlug with `IDENTITY_SLUG_RE`, and `pinned` with `typeof === "boolean"` BEFORE any filesystem or SSH call; on validation failure emit `{ type: "identity:bounty-pinned-updated", bounties: [], archivedBounties: [], error: "invalid ..." }` and return. Mirrors the identical guard shape used by `identity:update-bounty-status`. |
| T-172-02 | Elevation of Privilege | Remote-branch SSH path interpolation | mitigate | `writeIdentityBountyPinned`'s remote branch validates `bountySlug` against `IDENTITY_SLUG_RE` a SECOND time (belt-and-braces) before interpolating it into the `$HOME/.claude/identities/<id>/bounties/<slug>/bounty.json` path; slug regex `/^[a-z0-9_-]{1,80}$/i` excludes shell metacharacters and `..`. |
| T-172-03 | Repudiation | Bounty state changes on disk | mitigate | Every write appends a `<ISO> pinned set to <bool> via identity modal` line to `timeline[]` — auditable per-bounty change log matching the priority/status/archive writers. |
| T-172-04 | Denial of Service | One-shot WS response | accept | Piggybacks on the existing one-shot request/response WS convention (D-13); no new subscription or long-lived state. `identity:list-bounties`'s existing rate-limit posture applies. |
| T-172-SC | Tampering | npm/pip/cargo installs | mitigate | No package installs in this quick — pure edits to existing TS files + one new vitest test file using already-installed vitest. No slopcheck required. |
</threat_model>

<verification>
Phase-level checks (run at end):

1. `cd /home/ubuntu/skynet && npm run build:backend && npm run build` — MUST succeed with zero TS errors (frontend `tsc` alone silently passes backend TS errors per fleet learned rule).
2. `cd /home/ubuntu/skynet && npx vitest run src/backend/claude-session/identity-artifact-reader.write-bounty-pinned.test.ts src/backend/claude-session/identity-artifact-reader.write-bounty-status.test.ts` — MUST pass; new pinned tests all green + regression on status writer.
3. `grep -n "identity:update-bounty-pinned\|identity:bounty-pinned-updated\|writeIdentityBountyPinned" src/backend/claude-session/*.ts src/ui/api/claude-session-api.ts src/ui/features/pretty-view/IdentityModal.tsx` — all six references present (writer decl, WS case, WS response, import, wire payload/event, modal handler).
4. `grep -n '^  "pinned"' src/ui/features/pretty-view/IdentityModal.tsx` — confirms `OPEN_STATUS_ORDER` starts with `"pinned"`.
5. `test -f .planning/quick/260728-sqk-pair-pin-toggle-bounty-sort-add-writeide/172-PATCH-ENTRY-DRAFT.md` — draft entry exists.
6. `ls ~/.claude/identities/tina/bounties/archive/ | grep -E 'pin-toggle-ui-in-identity-modal|identity-modal-sort-bounties-by-priority'` — both source bounties archived.
7. `git -C /home/ubuntu/skynet status --short` — SUMMARY.md / PLAN.md / STATE.md / draft entry unstaged (orchestrator handles their commit in Step 8); code files staged/committed atomically on `feat/tab-title-from-tmux`.
</verification>

<success_criteria>
- All `must_haves.truths` satisfied and observable.
- Backend `writeIdentityBountyPinned` + WS dispatch case + test file all present; vitest passes for both new pinned test file and existing status test file.
- Wire types (`Bounty.pinned`, `IdentityUpdateBountyPinnedPayload`, `IdentityBountyPinnedUpdatedEvent`) exist and are in the union.
- `BountyCard` renders a star pin toggle in the header row that flips between filled (pinned) and hollow (not pinned) on click.
- `IdentityModal` groups pinned bounties into a top `"Pinned"` group above the in_progress fence regardless of status; within-group priority sort preserved.
- Stale `:90-98` comment rewritten to reflect the post-#168/#172 schema reality.
- `172-PATCH-ENTRY-DRAFT.md` exists in the quick's folder.
- `npm run build:backend && npm run build` both succeed.
- Both source bounties archived under `~/.claude/identities/tina/bounties/archive/` with `status:"done"` + closing timeline line.
- No push, no docker build, no deploy, no branch switch.
</success_criteria>

<output>
Create `.planning/quick/260728-sqk-pair-pin-toggle-bounty-sort-add-writeide/260728-sqk-SUMMARY.md` when done, documenting: files touched, tests added, patch #172 draft path, bounty-close/archive side-effects executed, and the intentional deferrals (skynet-patches.md paste + deploy handled separately by Ashley).
</output>

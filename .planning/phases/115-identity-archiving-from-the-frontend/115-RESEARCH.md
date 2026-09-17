# Phase 115: identity archiving from the frontend — Research

**Researched:** 2026-09-17
**Domain:** Cross-repo (Skynet TS/React frontend + backend + fleet-substrate bash supervisor + Python fleet-status sweep)
**Confidence:** HIGH (every claim below cites a file+line; all files read verbatim in this session)

## Summary

Phase 115 wires a real end-of-life "archive" gesture into Skynet's unified conversation-row + identity-badge context menu, replacing the current visual-only "Hide" action. The gesture drops a `.archive-requested` sentinel on the identity's disk; the agent-supervisor picks it up on its reconcile tick and runs a REORDERED `retire_identity()` — matrix deactivate → graceful harness exit → tmux kill → folder move — bypassing the pin/no-dormancy/coordinator guards that gate the 180-day dormancy path. The fleet-status sweep grows to enumerate `~/fleet/identities-archive/` so the sidebar's archived section has content. All `.hidden` sentinel machinery is deleted.

**Load-bearing external precondition:** The whole `retire_identity()` code path has never fired in production — the retire order reversal PLUS the new user-initiated trigger both run for the first time against real state as part of this phase's testing. Existing test infrastructure (`substrate/scripts/tests/agent-supervisor-archive-scan.sh` with its Python stub-homeserver) is a solid foundation to extend.

**Primary recommendation:** Follow the existing per-identity sentinel patterns established by Phase 92 (pinned), Phase 107 (hidden), and Phase 94 (retire flow). The new archive endpoint should mirror the shape of `identity-no-dormancy.ts` (mounted BEFORE the generic `/identities` router in `database.ts`) — one small route module, POST-only, targeting one identity on one host, calling `writeIdentityFile(name, ".archive-requested", "", {hostId, conn})`. All Phase 107 deletion is straightforward: single line-ranges to remove or single fields to drop; the test suite will catch stragglers.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Frontend surface:**
- **D-01:** Rename "Hide" → "Archive" in the unified context menu on both entry points. Preserve the affordance-narrowing gate (fleet-synthetic identity-backed rows only — no archive on RDP synthetic rows, dev-created openTab rows, or relay-room rows). Menu's other actions (Pin/Unpin, Open/Move in new window, Kill) are untouched.
- **D-02:** Red styling. Match Kill's existing styling verbatim.
- **D-03:** Confirmation prompt with copy: **"archive `<identity>`? this can't be undone."** — user-locked wording, `<identity>` is the displayed identity name.
- **D-04:** Confirming Archive on an open pane/tab closes it as a side effect (mirrors current Hide behavior at `PrettyConversationsPanel.tsx:1355` / `handleToggleHide`).
- **D-05:** No un-archive.
- **D-06:** Archived rows are fully inert (no context menu, no click actions in v1).

**Sentinel + trigger:**
- **D-07:** Sentinel is a one-shot intent signal (not a toggleable state). Matches `.recycle-requested` semantics.
- **D-08:** Filename is `.archive-requested` — user-locked. Empty presence-only file.
- **D-09:** Sentinel drops at `~/fleet/identities/<name>/.archive-requested` on the identity's host. Per-host, not fan-out.
- **D-10:** Supervisor scans for the sentinel on every reconcile tick (~15s). NOT gated on `run_archive_scan_if_due()` (24h gate).
- **D-11:** User click BYPASSES the pinned/no-dormancy/coordinator guards. Load-bearing: `retire_identity()` must not re-check those guards internally; either caller handles the guard or a `force:bool` param is added.
- **D-12:** Sentinel deletion happens BEFORE the folder move (recommended option b in CONTEXT.md — a mid-retire crash leaves the sentinel in place for the next tick to retry).

**Retire flow reordering:**
- **D-13:** New order: **(1) matrix deactivate → (2) graceful harness exit → (3) tmux kill → (4) folder move.** Applied to BOTH trigger paths (user-initiated + 180-day dormancy).
- **D-14:** Step 2 uses the SAME `/exit paste + Enter, wait, SIGTERM survivors` pattern as the existing `recycle()` in `agent-supervisor.sh` (~L1050). Do NOT invent a second pattern.
- **D-15:** LOUD on any step failure. User-initiated path retries per-tick (~15s cadence). Retire-stuck sentinel after 3 consecutive failures on the same identity (small counter in dormancy-state dir, mirrors Phase 94's `retire-fail-count-$name` pattern at L528). 180-day path keeps its 24h/3-fail semantics.
- **D-16:** Matrix deactivate failure must fail LOUD.

**Fleet-status sweep — archived-section content:**
- **D-17:** New dedicated frontend endpoint — recommended shape `POST /identity/:hostId/:name/archive`. Planner may adjust to fit existing route conventions in `src/backend/database/routes/identities.ts`. Do NOT reuse the `PUT /user-preferences` array-of-IDs shape. Add `.archive-requested` to `ALLOWED_REL_PATHS`.
- **D-18:** `substrate/scripts/fleet-status-sweep.py` grows to enumerate `~/fleet/identities-archive/`. Rows sourced from the archive tree emit `archived: true` on `SweepIdentityLine` (sibling to existing `hidden`, `pinned`, `dormant`).
- **D-19:** Archived-section lazy loading — verify + preserve. If not present today, add as part of this phase's scope.

**Migration + retirement:**
- **D-20:** Manual migration of existing `.hidden` sentinels (the operator handles outside code scope).
- **D-21:** `.hidden` code path fully retired. Delete every read/write of `.hidden` anywhere.

**Testing:**
- **D-22:** End-to-end retire must be revalidated. Phase 94's retire flow has never fired in production.
- **D-23:** Executor uses scoped `npx vitest run <files>` per fleet directive. Full-suite + Playwright smoke run at the orchestrator scope during the DEPLOY motion, not before push, not inside the executor.

### Claude's Discretion

- Exact route shape / naming for the new archive endpoint (`POST /identity/:hostId/:name/archive` vs `POST /host/:hostId/identity/:name/archive` vs another pattern that fits existing conventions in `identities.ts`).
- Where the guard-bypass logic lives (caller-side vs `force:bool` param on `retire_identity()`). CONTEXT recommends caller-side.
- Graceful-exit timeout for step 2 — reuse the recycle flow's exact wait window or tune specifically for retire.
- Sentinel-scan branch inline on reconcile tick vs background task.
- Exact form of the retire-fail-count counter for the user-initiated per-tick path.
- Where in the fleet-status sweep code the archive-tree enumeration lands (second walk vs unified walk with `archived` flag).
- Frontend confirmation dialog mechanism (new component vs existing modal machinery vs `window.confirm`).

### Deferred Ideas (OUT OF SCOPE)

- Un-archive / restore path
- Permanent delete from archived section
- Context menu on archived rows
- Automated `.hidden` → `.archive-requested` migration
- Configurable graceful-exit timeout
- Cross-host archive announcement wire
- User-facing "recently archived" toast/notification
- Retention/pruning of the archive tree
- Multi-user re-scoping of the archive gesture

## Phase Requirements

**None tracked at the requirement-ID level** (per objective statement in the spawn context). Phase acceptance is driven entirely by CONTEXT decisions D-01..D-23. This RESEARCH.md consequently drives implementation detail; the planner should slice tasks against each D-XX decision (mapping is straightforward — each D-XX corresponds to 1-3 concrete edits).

---

# Section 1 — The unified context menu (post-`ebcbac5b`)

## Menu implementation architecture

**Shared component:** `src/ui/features/pretty-conversations/PrettyConversationContextMenu.tsx` (223 lines) — a portal-mounted, cursor-positioned, hue-aware menu that accepts a props array of `PrettyContextMenuItem { label, onClick, danger? }`. Both entry points (row + identity badge) construct their own `items[]` array and pass them to this same component.

**Row entry point:** `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` **L1336-1421** (inside `PrettyConversationRow` component). The `items[]` builder is an IIFE at L1341-1418 that pushes menu entries conditionally based on props threaded from the panel:

```
1. Pin/Unpin        (L1343-1346) — always present. Uses onTogglePin.
2. Hide/Unhide      (L1350-1355) — present only when onToggleHide prop is provided.
                                    Label bifurcates on `hidden` prop.
3. Open in new window (L1373-1391) — desktop-only (!isMobile) + specForTab non-null.
                                     Fires window.open + optional onDeactivate on success.
4. Kill             (L1404-1416) — gated on: onKill provided AND !isRdp AND !identity
                                    AND row.targetTmuxSession non-null.
                                    Has `danger: true` (red styling).
```

**Identity badge entry point:** `src/ui/shell/IdentitySessionPane.tsx` **L154-222** — `identityBadgeContextMenuItems` is a `useMemo` that returns the items array. Mobile returns `[]` (mobile has no right-click; long-press already wired to togglePrettyMode).

Order in the badge menu (L158-207):
```
1. Pin/Unpin        (L158-168) — always present when badge menu is enabled (i.e., !isMobile).
2. Hide/Unhide      (L171-181) — present only when shadowFleetId is non-null (i.e., we can
                                  construct fleet::<hostId>::<session>). Side effect on Hide:
                                  calls onCloseTab?.(tabId) after hideConversation() — mirrors
                                  the panel's handleToggleHide + handleRowDeactivate composition.
3. Move to new window (L184-207) — desktop-only via useMemo isMobile guard.
                                     Note: no `Kill` item on the badge menu (Kill is only for
                                     non-identity rows per D-01 preservation).
```

## Red styling of Kill (D-02 target)

Kill is styled red via **`danger: true`** on the `PrettyContextMenuItem` at:
- Row: `PrettyConversationRow.tsx:1414` — `danger: true`
- The menu component's styling: `PrettyConversationContextMenu.tsx:212` — `color: item.danger ? "#ff9a8a" : "#e8e4d8"` (peach-red vs the standard warm off-white).

**Archive must set `danger: true`** to inherit the exact same red styling. Nothing else needed — no new tokens, no CSS classes.

## Identity-backed vs non-identity branching

The gate for whether Hide currently renders is `onToggleHide !== undefined` (row) or `shadowFleetId !== null` (identity-badge). The **panel** (`PrettyConversationsPanel.tsx`) decides whether to pass `onToggleHide` — at each of the 4 render sites (L1848, L1881, L1911, L2021) it uses:
```ts
onToggleHide={
  canonicalHideIdForRow(row) !== null ? () => handleToggleHide(row) : undefined
}
```
`canonicalHideIdForRow` at **L231-239** returns null for `row.kind === "relay-room"` or `row.rdpHostRow === true`; otherwise returns a `fleet::<hostId>::<name>` id or null if no host+targetTmuxSession is available.

**Implication for Phase 115:** The archive gate can reuse this same discriminator verbatim. Rename `onToggleHide` prop → `onArchive` (or add `onArchive` alongside during transition), rename `canonicalHideIdForRow` → some archive-context name (or keep it since the gate logic is identical) — the shape of "which rows show this menu item" is unchanged. Row `onArchive` prop is passed only when `canonicalHideIdForRow(row) !== null`, exactly like `onToggleHide` today.

## Current Hide click handler → sentinel drop chain

The chain today:

1. User clicks Hide in row context menu → `PrettyConversationRow.tsx:1353` invokes `onToggleHide()` (the prop).
2. Prop is set by panel at `PrettyConversationsPanel.tsx:1849,1882,1912,2022` to `() => handleToggleHide(row)`.
3. `handleToggleHide` at **`PrettyConversationsPanel.tsx:1419-1430`** does:
   - `canonicalId = canonicalHideIdForRow(row)`
   - if `hiddenIds.has(canonicalId)` → `unhideConversation(canonicalId)` (unhide branch)
   - else: if row in activeSet, `handleRowDeactivate(row)` first (closes the tab), then `hideConversation(canonicalId)`.
4. `hideConversation` at **`src/ui/state/conversation-store.ts:1810-1830`** — mutates `state.hiddenIds`, fire-and-forget calls `putHiddenIds([...nextHiddenIds], identityHosts)` which PUTs the full array to `/user-preferences`.
5. Backend PUT handler at `src/backend/database/routes/user-preferences.ts:411-511` — the `hiddenConversationIds` fanout block computes delta vs current disk state, calls `writeIdentityFile(k, ".hidden", "", {hostId, conn})` / `removeIdentityFile(k, ".hidden", {hostId, conn})` in parallel across hosts.

**Frontend call-chain to duplicate for archive:** Skip step 4's "array-of-IDs → PUT" shape (D-17 forbids it). Instead, add an `archiveIdentity(hostId, name)` function to a frontend API module (recommended: new file `src/ui/api/identity-archive-api.ts` OR add to `src/ui/api/identities-api.ts`) that POSTs a single command. The panel's new `handleArchive(row)` handler mirrors `handleToggleHide` (with `window.confirm` or equivalent gate for D-03) and calls this new API.

---

# Section 2 — The Phase 107 `.hidden` code path being retired

## Complete deletion inventory (D-21)

### Primitive layer
- `src/backend/claude-session/per-identity-file.ts` **L82-86** — `ALLOWED_REL_PATHS` set. Remove `".hidden"` from the Set; add `".archive-requested"`. The comment at L79-80 mentions both `.pinned` and `.hidden` — update to reference `.pinned` and `.archive-requested` only.
- `src/backend/claude-session/per-identity-file.test.ts` **L273-278** and **L673-720ish** — `.hidden` test coverage: primitive whitelist admission, LOCAL/REMOTE write/remove/exists, no-chmod treatment. Full describe block at L689+ ("Phase 107 Plan 107-01: .hidden sentinel primitive coverage"). Replace with equivalent `.archive-requested` block.

### Backend read path (GET /identities)
- `src/backend/database/routes/identities.ts` **L189-197** — `hidden: boolean = false` param on `publicIdentity()`. Delete the parameter (or replace with an archive-flavored one only if we later decide identities.ts needs it — Phase 115 does NOT surface `archive_requested` on `publicIdentity` because the archive tree enumeration is via the sweep, not per-identity GET).
- `src/backend/database/routes/identities.ts` **L211** — `hidden` argument passed to `resolveIdentityAppearance`.
- `src/backend/database/routes/identities.ts` **L252-257** — `hidden: resolved.hidden` field on the return object.
- `src/backend/database/routes/identities.ts` **L414-424** — parallel `.hidden` `identityFileExists` probe in the Promise.all wave. DELETE entirely.
- `src/backend/database/routes/identities.ts` **L426** — three-tuple destructure `const [{ markdown }, pinned, hidden] = ...`. Reduce to `const [{ markdown }, pinned] = ...`.
- `src/backend/database/routes/identities.ts` **L441-449** — `publicIdentity(...)` call passing `hidden` as 7th arg. Drop.
- `src/backend/database/routes/identities.ts` **L402** — comment mentions "3 channels per identity (identity file + `.pinned` + `.hidden`)". Update: 2 channels per identity + math on L339 changes (24 → 16 per 8-slot cap).

### Backend write path (PUT /user-preferences)
- `src/backend/database/routes/user-preferences.ts` **L14-17** — imports include `writeIdentityFile`, `removeIdentityFile`, `identityFileExists`. Keep — the archive endpoint (Section 6) still needs them. (Migration: user-preferences no longer NEEDS them post-Phase-115 since both pin fanout AND hidden fanout are the only callers; pin fanout stays put per D-21 last paragraph "delete... any test coverage" applying to hidden only.)

  ⚠ Actually — re-reading D-21: only `.hidden` is retired. The pinned fanout in user-preferences.ts stays. So the primitive imports stay too.

- `src/backend/database/routes/user-preferences.ts` **L33-37** — `HIDDEN_CONVERSATION_IDS_MAX_LENGTH` constant. Delete.
- `src/backend/database/routes/user-preferences.ts` **L79-82** — comment about hidden slice on GET response. Delete/adjust.
- `src/backend/database/routes/user-preferences.ts` **L143-154** — `hiddenConversationIds` destructure + type. Delete lines specific to hidden.
- `src/backend/database/routes/user-preferences.ts` **L249-278** — the full hiddenConversationIds validation block. Delete.
- `src/backend/database/routes/user-preferences.ts` **L280** — condition `if (pinnedConversationIds !== undefined || hiddenConversationIds !== undefined)`. Simplify to `if (pinnedConversationIds !== undefined)`.
- `src/backend/database/routes/user-preferences.ts` **L402-511** — the full HIDDEN FANOUT block. Delete entirely (including all references to `identityHosts`, `previousStates`, `postStates`, `echoHiddenFinal`).
- `src/backend/database/routes/user-preferences.ts` — any `echoHiddenFinal` / `didFanoutSentinels` conditional based on hidden. Simplify. The `didFanoutSentinels` flag was likely set true from BOTH branches (L378 and L489); post-retirement, only the pin branch sets it.
- `src/backend/database/routes/user-preferences.ts` — search for `echoHiddenFinal` and delete any response-echo code that references it. The response echo assembly is downstream of the fanout blocks.

### Frontend API layer
- `src/ui/api/user-preferences-api.ts` **L18-27, L87-134** — retire `putHiddenIds()` and all Phase 107 comment blocks. Keep the SHARED `toBareIdentityKey` helper (L45-49) — still used by `putPinnedIds`.

### Frontend state layer
- `src/ui/state/identities-store.ts` **L9-15** — `hydrateHiddenIdsFromServer` import. Delete.
- `src/ui/state/identities-store.ts` **L217-258** — `deriveDiskHiddenIds` function. Delete.
- `src/ui/state/identities-store.ts` **L529** — `hydrateHiddenIdsFromServer(deriveDiskHiddenIds(identityHosts))` inside `reprojectDiskPinHideIntoRows`. Delete.
- Any `Identity.hidden` field on the `Identity` type in `src/ui/api/identities-api.ts` — search & remove.

### Frontend conversation-store
- `src/ui/state/conversation-store.ts` **L227** — `hiddenIds: ReadonlySet<string>` on ReadonlyConversationState. Delete.
- `src/ui/state/conversation-store.ts` **L350** — `hiddenIds: Set<string>` on internal State. Delete.
- `src/ui/state/conversation-store.ts` **L399** — `hiddenIds: new Set<string>()` initial value. Delete.
- `src/ui/state/conversation-store.ts` **L1804-1880** — `hideConversation`, `unhideConversation`, `toggleHideConversation`, `hydrateHiddenIdsFromServer`. Delete all four exports.
- `src/ui/state/conversation-store.ts` **L1941-1945** — `useHiddenIds` hook. Delete.
- `src/ui/state/conversation-store.ts` **L2091** — `hiddenIds: state.hiddenIds` in whatever getter that lives in. Delete.
- `src/ui/state/conversation-store.ts` **L2125-2128** — `resetHiddenIds` helper (test hook). Delete.
- `src/ui/state/conversation-store.ts` **L995-997** — comment about hiddenIds subscription + canonicalHideIdForRow. Update.

### PrettyConversationsPanel.tsx (most touch points here)
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` **L231-256** — `canonicalHideIdForRow` and `isRowHidden`. If we keep the naming, rename to `canonicalArchiveIdForRow` — but the logic is the same. Alternatively, extract as a shared "which rows are identity-backed" helper.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` **L281** — `hidden?: boolean` on props of `PrettyConversationRowLive`. Change to `archived?: boolean` (for archived-section rendering) OR drop the field entirely and let the archived flag come from the sweep.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` **L291** — `onToggleHide?: () => void` on props. Rename → `onArchive?: () => void`.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` **L748** — `const [hiddenExpanded, setHiddenExpanded] = useState(false)`. Rename → `archivedExpanded`.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` **L974-988** — `hiddenRows` useMemo. Replace with `archivedRows` — but the data SOURCE changes (see Section 5 below): it's no longer derived from `hiddenIds.has(canonicalHideIdForRow(row))` off live rows; it's a NEW row source from the sweep's archive-tree walk.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` **L1154** — comment references `handleToggleHide`. Update.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` **L1406-1430** — `handleToggleHide`. Replace with `handleArchive(row)`:
  ```ts
  const handleArchive = (row: ConversationRowShape) => {
    const canonicalId = canonicalHideIdForRow(row); // reused as-is for the row-eligibility gate
    if (canonicalId === null) return;
    if (!window.confirm(`archive \`${row.host?.name /* or identity displayName */}\`? this can't be undone.`)) return;
    // Extract identityKey + hostId from row.host + row.targetTmuxSession
    // Close the pane if it's open (mirror the existing hide-side behavior at L1426-1428)
    if (activeSet.has(row.id)) handleRowDeactivate(row);
    void archiveIdentity(hostId, identityKey); // fire-and-forget or await + handle error
  };
  ```
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` **L1848-1849, L1881-1882, L1911-1912, L2021-2022** — 4 render sites for `onToggleHide`. Rename to `onArchive`, same gate.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` **L1973-2031** — the entire Hidden section render block. RENAME to Archived section, and change the DATA source (see Section 5).

### Identity badge (mirror updates)
- `src/ui/shell/IdentitySessionPane.tsx` **L140-141** — `usePinnedIds()` + `useHiddenIds()`. Delete the `useHiddenIds()` call.
- `src/ui/shell/IdentitySessionPane.tsx` **L150-152** — `isHidden` calculation. Delete.
- `src/ui/shell/IdentitySessionPane.tsx` **L170-182** — the Hide/Unhide menu item block. Replace with an Archive block: `label: "Archive"`, `danger: true`, `onClick: () => { if (!confirm(...)) return; onCloseTab?.(tabId); archiveIdentity(hostId, name); }`. Gate stays: only present when `shadowFleetId !== null`.
- `src/ui/shell/IdentitySessionPane.tsx` **L212-213** — `isHidden` in the useMemo deps array. Delete.

### Backend fleet-status feeder + sweep
- `src/backend/fleet-status/sweep-schema.ts` **L109-131** — `hidden?: boolean` on `SweepIdentityLine`. Delete. Add `archived?: boolean`.
- `src/backend/fleet-status/sweep-schema.ts` **L353, L410-411** — `B9` entry in `SWEEP_FIELD_PARITY` map + the `"B8"|"B9"` union entry. Adjust for archived.
- `src/backend/fleet-status/ssh-poll-orchestrator.ts` **L1131-1162** — `hidden` field usage in `appearanceFromIdentityLine`. Delete `hidden`, add archived plumbing (see Section 5).
- `src/backend/fleet-status/identity-appearance.ts` **L73-74, L134-136, L138, L200-201** — `hidden: boolean` in `ResolvedIdentityAppearance` shape and pass-through. Delete.
- `src/backend/fleet-status/wire-protocol.ts` **L332, L366-383** — `hidden` in `IdentityAppearanceSchema`. Delete. (`archived` will land at the sweep line level, not on identity appearance — because archived identities aren't "an appearance", they're a separate row source. See D-18 + Section 5.)

### Backend database migration (already done in Phase 107)
- `src/backend/database/db/index.ts` — no schema changes needed for Phase 115 (Phase 107 already dropped the `hidden_conversation_ids` column). Nothing to do here.

### Test files (partial list — the vitest suite will surface stragglers via TS errors + failing tests when the props/fields are deleted)
- `src/backend/claude-session/per-identity-file.test.ts` — describe block at L689+, plus L273-278 whitelist assertion.
- `src/backend/database/routes/identities.disk-read.test.ts` — L423, L448, L491, L496, L499, L505-, L508, L510, L513, L516-, L529-, L542-, L553, L557-.
- `src/backend/database/routes/user-preferences.test.ts` — all Phase 107 hidden fanout tests.
- `src/ui/api/user-preferences-api.test.ts` — L207+ (API-107-01 test), all `putHiddenIds` tests.
- `src/ui/features/pretty-conversations/*.test.tsx` — 6+ test files reference `deriveDiskHiddenIds`, `hydrateHiddenIdsFromServer`, `hideConversation`, `unhideConversation`. These are mostly mocked module-scoped fakes that can be deleted verbatim.
- `src/ui/state/conversation-store.test.ts`, `src/ui/state/identities-store.enrichment.test.ts` — hidden-slice tests.
- Backend `sweep-schema.test.ts`, `wire-protocol.test.ts`, `identity-appearance.test.ts`, `ssh-poll-orchestrator.test.ts` — remove hidden coverage; add archived coverage.

**Deletion strategy for the planner:** Do the deletions BEFORE adding archived-tree scan support, so the test suite is clean when the new tests land. A single "delete phase 107 hidden" plan followed by a "add archive endpoint + archived section" plan makes the diff review much easier than interleaving.

---

# Section 3 — The retire flow in the supervisor

## Key function boundaries

- **`is_coordinator()`** at `substrate/scripts/agent-supervisor.sh` **L324-328** — awk detection matching id-skill's strict frontmatter rule. Reused by the 180-day sweep at L514.
- **`get_freshness_epoch()`** at L339-349 — reads cursor mtime with folder-mtime fallback.
- **`retire_identity(name)`** at **L368-479** — the 3-step retire in the current Phase 94 order (move → tmux → matrix).
- **`run_archive_scan()`** at L498-553 — daily walk. Applies guards D-03 (pinned), D-04 (no-dormancy), D-05 (coordinator), D-08 (freshness threshold) before calling `retire_identity()`. Handles retire-stuck counter (D-14).
- **`run_archive_scan_if_due()`** at L568-577 — 24h gate. Called at TOP of reconcile() at **L1780**.
- **`recycle()`** at **L1050-1100** — graceful harness-exit pattern D-14 will reuse.

## Current step order (Phase 94, to be REVERSED by Phase 115)

`retire_identity()` at L368-479 does:
1. **STEP 1 (L373-398): mv folder** to archive/. States: normal (mv), resume-from-partial (skip mv), collision (abort), anomaly (abort).
2. **STEP 2 (L400-417): tmux kill-session** with `timeout -k 5 10 tmux kill-session -t "$actual"` where `$actual` came from `match_session` (case-insensitive lookup). Idempotent no-op if session gone.
3. **STEP 3 (L419-475): matrix deactivate.** Reads `relay.json` from ARCHDIR (post-move). POST `/_matrix/client/v3/account/deactivate` with the identity's own token + `erase:true`. HTTP dispatch: 200 → success, 401 → treat as idempotent success (token revoked → already deactivated), 4xx → abort, 5xx/network → abort.

Return value: 0 on success (all three), 1 on any step failure.

## Where guards live vs where they'd need to move for D-11 bypass

Guards live entirely in `run_archive_scan()` (the CALLER), NOT inside `retire_identity()`:
- L509 `[ -f "$d/.pinned" ] && continue`
- L511 `[ -f "$d/.no-dormancy" ] && continue`
- L514 `if is_coordinator "$d/$name.md"; then continue; fi`
- L520 freshness threshold check

**This is already the right architecture for D-11 bypass.** The new user-initiated sentinel-scan branch simply skips the four guard lines. `retire_identity()` itself is already guard-agnostic. Recommendation (aligns with CONTEXT.md's D-11 recommendation): keep guard-bypass at the caller — new sentinel-scan branch simply doesn't check pinned/no-dormancy/coordinator/freshness, whereas `run_archive_scan()` still does. **No `force:bool` param needed.**

## Retire-fail-count counter (D-14 pattern)

At **L528**, on success:
```bash
rm -f "$DORMANCY_STATE_DIR/retire-fail-count-$name" 2>/dev/null
```

At L534-538, on failure:
```bash
count=$(grep -E '^[0-9]+$' "$DORMANCY_STATE_DIR/retire-fail-count-$name" 2>/dev/null || echo 0)
count=$((count + 1))
printf '%s' "$count" > "$DORMANCY_STATE_DIR/retire-fail-count-$name"
if [ "$count" -ge 3 ]; then
  touch "$IDENTITIES_ARCHIVE_DIR/$name/retire-stuck" 2>/dev/null
  log "ERROR: archive-scan: '$name': STUCK after $count consecutive daily-pass failures ..."
fi
```

**For the user-initiated path (D-15):** Per-tick cadence (~15s) instead of daily cadence, but SAME counter file and SAME 3-strike rule. Two options for the planner:
- (a) Share the same file `retire-fail-count-<name>` — both paths increment it together. If a user-initiated retry fails 2 times then the daily sweep runs and fails once, that's 3, and `retire-stuck` fires. This may be confusing observability but is functionally simple.
- (b) Use a sibling file `retire-fail-count-user-<name>` — counters are independent, retry semantics are clean per D-15 ("faster cadence for user-initiated, daily for 180-day").

**Recommendation:** Option (b). The user-initiated retry cadence is ~15s, which means 3 failures happen in 45s of wall time; the 180-day path is 24h × 3 = 72h. Sharing would mean a passing daily sweep resets a user-initiated stuck counter mid-flight — arguably wrong. But this is a Claude's-discretion call.

## `retire-stuck` sentinel semantics

Empty file at `$IDENTITIES_ARCHIVE_DIR/$name/retire-stuck` (matches `.pinned`/`.no-dormancy` presence-only convention). Location matters: written into the ARCHIVE folder (not the live tree) because for retire to have retried 3 times, the folder move likely partly happened. If Step 1 (folder move) failed on ALL 3 attempts (State 4 in `retire_identity()` at L395 — "neither active nor archive"), the touch silently fails (comment at L542-543 acknowledges this edge).

**For Phase 115's new order (matrix-first):** The archdir may NOT exist yet when we hit retire-stuck (matrix deactivate fails → we never reach the folder-move step → archdir was never created). The planner MUST handle this: on retire-stuck, `mkdir -p "$IDENTITIES_ARCHIVE_DIR/$name"` before touching the sentinel file — OR write the stuck sentinel elsewhere (planner picks).

## Graceful-exit pattern from recycle() (D-14 detail)

At **L1050-1100**, `recycle()` does (byte-for-byte):
```bash
# graceful: ask the claude REPL to exit
_ex_tmp=$(mktemp)
printf '%s' "/exit" > "$_ex_tmp"
timeout -k 5 10 tmux load-buffer -t "$sess" "$_ex_tmp" 2>/dev/null
timeout -k 5 10 tmux paste-buffer -p -t "$sess" 2>/dev/null
rm -f "$_ex_tmp"
sleep 0.5
timeout -k 5 10 tmux send-keys -t "$sess" Enter 2>/dev/null
log "'$name' recycle: /exit paste + Enter sent to pane"
sleep 3
# hard fallback: kill any claude/node still on the pane tty
local tty pid killed=0
tty="$(timeout -k 5 10 tmux list-panes -t "=$sess" -F '#{pane_tty}' 2>/dev/null | head -1)"
if [ -n "$tty" ]; then
  for pid in $(ps -t "${tty#/dev/}" -o pid=,comm= 2>/dev/null | grep -iE 'claude|node' | awk '{print $1}'); do
    kill "$pid" 2>/dev/null   # SIGTERM (default signal)
    killed=$((killed+1))
  done
fi
```

Steps summarized:
1. Bracketed paste `/exit` via `tmux load-buffer` + `tmux paste-buffer -p`.
2. Sleep 500ms.
3. `tmux send-keys Enter`.
4. Sleep 3 seconds.
5. Find pane's tty (`tmux list-panes -F '#{pane_tty}'`), enumerate processes on that tty (`ps -t`), grep claude/node, SIGTERM each survivor.

**Timing:** 500ms + 3000ms = 3.5s bounded wait from paste to SIGTERM. May be too short if the harness is mid-turn on a long response. Planner discretion whether to tune for retire — recommendation: reuse verbatim for v1 (D-14 says "same pattern"), and if v2 shows hangs, expose a knob (this is captured as a Deferred idea).

**⚠️ The recycle-graceful-exit pattern SIGTERMs claude/node but does NOT SIGTERM the ambient-monitor.** The ambient-monitor is a SEPARATE process launched at claude spawn time (see `substrate/scripts/agent-supervisor.sh` search "AMBIENT_MONITOR" — omitted for brevity here — Phase 115 planner may need to look this up if unclear). When the harness (claude/node) dies, ambient-monitor's `_harness_watch()` (Section 4 below) notices via `os.kill(HARNESS_PID, 0)` and self-triggers `_do_shutdown()`, which then SIGTERMs its four children. So the chain is:
```
Step 2 sends /exit → claude dies → ambient-monitor sees harness dead → SIGTERMs children → children flush (recv cursor) → children exit → ambient-monitor exits.
```
Total wait budget from harness death to child exit: **10 seconds** (`GRACE_SECONDS` at `ambient-monitor.py:81`), then SIGKILL fallback.

## What NOT to break

- The 180-day sweep at `run_archive_scan()` MUST continue working — same `retire_identity()` function, just reordered internal steps. All four guards (pinned/no-dormancy/coordinator/freshness) still apply on that path.
- The `.pinned`, `.no-dormancy`, `.recycle-requested`, `.dormant`, `.recycled-at` sentinel behaviors are all orthogonal to Phase 115 and must not be touched.

---

# Section 4 — Ambient-monitor's graceful-shutdown path

## `_harness_watch()` — the trigger

At `substrate/scripts/ambient-monitor.py` **L738-761**. Polls `os.kill(HARNESS_PID, 0)` every 1 second. On any OSError (harness dead), sets `shutting_down.set()`. Comment at L752-756 explicitly says: "this fires BECAUSE the harness died, so there is no agent left to tell" — the design intent is exactly what D-13 leans on.

The main thread at L768-769 waits on `shutting_down.is_set()`, then falls through to `_do_shutdown()` at L771.

## `_shutdown_handler()` + signals

At L582-585 (handler) and L588-593 (signal registration): SIGTERM, SIGINT, SIGHUP all wired to set `shutting_down`. So the ambient-monitor also honors external SIGTERM (in addition to the harness-death self-trigger).

## `_do_shutdown()` — the SIGTERM fanout

At L596-618:
1. Enumerate `running` list of child entries; filter to `popen.poll() is None` (still alive).
2. For each: `os.killpg(os.getpgid(p.pid), signal.SIGTERM)`. **Note the killpg — the entire process group of each child gets SIGTERM'd**, not just the leader. This means recv.sh's subprocesses (curl, jq) also get signaled. Any of them mid-syscall die together with the parent.
3. Loop over children again with `p.wait(timeout=remaining)` bounded by `GRACE_SECONDS = 10` (L81) shared deadline (deadline = time.time() + GRACE_SECONDS at L606).
4. Any child not exited within the shared 10s window → `os.killpg(...SIGKILL)`.

## `_reap_loop()`

At L640-665. Runs as a daemon thread from L734. Notices child deaths, emits a wake announcement per death (via `emit_wake` — comment at L622-637: relay-receiver death is CRITICAL, others degrade). When all children dead, sets `shutting_down` and exits.

**For Phase 115:** The `_do_shutdown()` path is exactly what D-13 relies on. When the harness dies (from `/exit` in Step 2), harness_watch fires within ~1s (poll interval), _do_shutdown runs, SIGTERMs the 4 children as a killpg fanout, waits up to 10s for graceful exit, SIGKILLs stragglers. **Ten seconds is longer than the recycle 3-second wait for claude/node itself.** Meaning: retire's step 2 in the new order should either wait ≥10s (to give ambient-monitor its full grace window) OR just fire step 3 immediately (tmux kill-session) — but the latter kills the tmux SESSION which owns the ambient-monitor's parent pane, which may SIGHUP the ambient-monitor before it finishes its grace window.

## Cursor flush behavior (D-14 correctness claim)

`substrate/skills/agent-relay/recv.sh` — NO `trap` handler for SIGTERM (grep confirms only 1 `trap` reference and it's in a comment about not using EXIT-trap). The cursor is naturally flushed at **L247** — `SINCE="$NB"; printf '%s' "$SINCE" > "$SINCE_FILE"` — after every successful long-poll (30s interval by default). On SIGTERM, whatever was written by the most recent long-poll persists. No in-flight sync's next_batch is written until it succeeds AND returns non-empty (CURSOR GUARD at L238-246 rejects empty responses on the theory that homeserver restarts return empty). This means:
- **Well-behaved shutdown:** cursor was last written N seconds ago (0≤N≤30). Next boot resumes from there — at most 30 seconds of catch-up.
- **In-flight sync at shutdown:** SIGTERM kills the `curl` child (via killpg), curl exits non-zero, `R` variable is empty, CURSOR GUARD at L246 does `sleep 3; continue` — but we've been SIGTERMed so `continue` back to the top of the loop reads STDIN or does nothing... actually let me re-check:

The main sync loop at recv.sh runs in a `while true; do ... done`. There's no explicit `[ "$shutting_down" = 1 ] && exit` check. SIGTERM to a bash script running an inner `curl` will typically kill the curl child first (if curl is on the foreground), then the shell exits. **The cursor file remains at its last successful value.** No graceful "flush and exit" is needed because there's no in-memory buffer — the disk IS the buffer.

**Verdict on D-14's correctness claim:** ✅ ambient-monitor + recv.sh's shutdown path IS correct as documented. The 10-second grace window is generous enough that curl's default connection timeouts don't matter. The Phase 115 planner should trust this — but write a test that OBSERVES the cursor mtime advancing during shutdown to lock the claim (see Section 11).

## Consequence for D-13 step ordering

The critical timing is: **between when Step 2 sends /exit and when Step 3 does tmux kill-session, we need enough wall-clock time for the ambient-monitor to complete its own shutdown.** Napkin math:
```
Step 2 send /exit → 500ms sleep → send Enter → 3s sleep → SIGTERM survivors (from recycle pattern)
                                                                   ↓
harness dies (from /exit + Enter, or from SIGTERM at ~3.5s)
                                                                   ↓
harness_watch fires within 1s (once/sec poll)
                                                                   ↓
_do_shutdown SIGTERMs 4 children (killpg)
                                                                   ↓
Grace window up to 10s for children to flush + exit
                                                                   ↓
ambient-monitor exits
                                                                   ↓
Step 3: tmux kill-session
```

Recycle's total wait budget (3.5s from send to SIGTERM survivors) does NOT include the ambient-monitor grace window. So retire's step 2 needs an ADDITIONAL wait of ~10-11 seconds AFTER the recycle-style sequence for ambient-monitor to finish its own cleanup. Otherwise tmux kill-session in step 3 will SIGHUP the ambient-monitor mid-flush.

**Planner action needed:** Step 2 in Phase 115's new order should be: `recycle-style-graceful-exit` + `sleep 11` (or `sleep GRACE_SECONDS + 1`). Alternatively: poll the ambient-monitor pid until it exits, bounded by a timeout (more precise but more code). This is a Claude's-discretion detail (CONTEXT L86).

---

# Section 5 — The fleet-status sweep and archive-tree enumeration

## Current enumeration (`_enumerate_identities`)

At `substrate/scripts/fleet-status-sweep.py` **L977-1018**. Iterates `~/fleet/identities/*/` (via `os.path.join(home, "fleet", "identities")` at L987). For each dir with a safe name, stats 5 sentinels: `.dormant`, `.recycled-at`, `.recycle-requested`, `.pinned`, `.hidden`. Returns a list of dicts with `{name, dormant, recycled_at, recycle_requested, pinned, hidden}`.

The main() at L1046-1124 orchestrates:
1. `_enumerate_identities(home)` at L1053 — the sentinel walk.
2. `_enumerate_pids(home)` at L1054 — PID enumeration from `~/.claude/sessions/*.json`.
3. PID → tmux session (identity name) resolution.
4. Union pass to add synthetic identity records for identities discovered only via PID resolution.
5. Per-identity JSONL discovery (Phase 32).
6. Emit identity lines (via `_build_identity_line`).
7. Emit PID lines.

## `_build_identity_line` — the JSONL emitter

At L818-878. Reads identity frontmatter + role cosmetics + jsonl-tail scan. Returns a dict shaped like `SweepIdentityLine`. Fields include `hidden` (from the sentinel walk).

## `SweepIdentityLine` schema — `src/backend/fleet-status/sweep-schema.ts` L111-132

Current fields: `line_kind`, `schema_version`, `identity`, `dormant`, `recycled_at`, `recycle_requested`, `jsonl_path`, `layer1_recycling`, `role?`, `identity_cosmetics?`, `role_cosmetics?`, `pinned?`, `hidden?`. The `?` on the appearance fields marks them optional so mid-distribution old boxes without those keys still parse (comment at L120-126).

## Adding the archive tree

**Approach recommendation:** Take a unified walk over BOTH `~/fleet/identities/` AND `~/fleet/identities-archive/` and emit `archived: true` for the latter. This is cleaner than a second walk because:
1. Sentinel handling is symmetric across the two roots (the archive tree may have `.pinned`, `.no-dormancy`, `retire-stuck`, etc. as residue after retire — they're inert once archived but they're still on disk).
2. The identity name comes from the folder basename in both cases.
3. Downstream logic that keys on identity name is unified — the frontend just sees "these are the identity records, some carry `archived: true`."
4. The JSONL emit loop at L1093-1111 stays a single loop.

Concrete diff sketch for `_enumerate_identities`:
```python
def _enumerate_identities(home):
    out = []
    for root, archived_flag in [
        (os.path.join(home, "fleet", "identities"), False),
        (os.path.join(home, "fleet", "identities-archive"), True),
    ]:
        try:
            with os.scandir(root) as it:
                for entry in it:
                    if not entry.is_dir(follow_symlinks=False):
                        continue
                    name = entry.name
                    if not SAFE_NAME_RE.match(name):
                        _log("identity_name_skipped", name=name[:40])
                        continue
                    # ... same sentinel probes ...
                    out.append({
                        "name": name,
                        "dormant": ...,
                        "recycled_at": ...,
                        "recycle_requested": ...,
                        "pinned": ...,
                        "hidden": ...,  # deleted per D-21
                        "archived": archived_flag,  # NEW
                    })
        except FileNotFoundError:
            continue  # archive tree may not exist yet on some boxes
        except OSError as e:
            _log("identities_scandir_failed", errno=e.errno, root=root)
            continue
    return out
```

`_build_identity_line` at L864-878 propagates `archived` into the emit dict. Downstream `SweepIdentityLine` gets `archived?: boolean`.

**Cross-root name collision** (a name appearing in both `identities/` AND `identities-archive/`): shouldn't happen in practice (that would be the retire-collision state 3 at `agent-supervisor.sh:388-393` which is refused). If it does, both records emit — the frontend sees two rows with the same identity name, one live and one archived. Feasibly handleable by preferring the live one (planner picks; probably a low-priority defensive test).

**Note on `hidden` field:** With D-21 retiring `.hidden` entirely, the `hidden` probe at line 1004 of fleet-status-sweep.py is deleted, and the `hidden` field on the dict + SweepIdentityLine is dropped. Just delete cleanly — the operator handles manual `.hidden` file cleanup per D-20.

## How does `archived` reach the frontend

The chain today for `hidden`:
```
sweep-schema.ts SweepIdentityLine.hidden
  → ssh-poll-orchestrator.ts appearanceFromIdentityLine builds IdentityAppearance.hidden
     → published via fleet-status WS frames
       → frontend consumes it in the same identities-store data flow
```

For `archived`, the design choice is: do we surface `archived` on `IdentityAppearance` (like `hidden` today) or on a NEW row-source in the frontend?

The critical semantic difference: `hidden` was a per-user filter applied to LIVE identities (still in the live tree). `archived` means the identity is GONE from the live tree entirely. Archived rows shouldn't even appear in the "identities" list that `GET /identities` returns — they're not identities anymore, they're historical rows.

**Recommendation:** `archived` should NOT go through `resolveIdentityAppearance` / `IdentityAppearance`. Archived rows come exclusively from the sweep's per-host archive-tree walk. The frontend renders them from a NEW row-source that's siblings to the live identity rows:
- `SweepIdentityLine.archived: boolean` — the schema field.
- ssh-poll-orchestrator handles archived rows as a distinct code path: instead of "publish this identity's live state," it "publishes this identity to the archived-rows pool."
- The frontend receives these via the same WS wire but keys them into `state.archivedRows` (new store slice), not `state.identities`.
- The archived section renders from `state.archivedRows`.

This is the cleaner architecture but requires a new plumbing path. **Planner's-discretion alternative:** Bolt `archived` onto `IdentityAppearance` for expedience, and filter at the render site. Uglier but smaller diff. Recommend the clean path — it aligns with D-06 (archived rows are inert) because they never even enter the interactive row space.

## `GET /identities` — should it filter or include archived?

Right now, `identities.ts:299-505` GET fanout enumerates `listIdentityKeysOnHost(conn)` which today only walks `~/fleet/identities/*` (not the archive tree). Check the reader source:

<code file="src/backend/claude-session/identity-artifact-reader.ts" — grep confirmed L351 uses `listIdentityKeysOnHost(conn)` which reads `~/fleet/identities` />

So `GET /identities` naturally excludes archived rows — no code change needed. Archived rows will only surface via the sweep. This is the intended behavior per D-05 (no un-archive, archive is one-way, archived rows are inert).

---

# Section 6 — Backend route conventions for the new archive endpoint

## Existing per-identity POST/PUT patterns in `src/backend/database/routes/`

Available conventions:

1. **`/:identityKey/no-dormancy`** at `identity-no-dormancy.ts` — PUT with body `{present: boolean}` + query `?hostId=<n>`. Mounted at `database.ts:1918`: `app.use("/identities", identityNoDormancyRoutes)` — depth-2 route inside the `/identities` mount. This is the closest existing precedent to a per-identity sentinel drop endpoint. **Directly reusable pattern.**

2. **`/identities/exists-on-host`** at `identity-exists-on-host.ts` — GET with query `?hostId=<n>&identityKey=<key>`. Mounted at `database.ts:1914`.

3. **`/identities/pool/*`** at `identity-pool.ts` — POST for pool operations. Mounted at `database.ts:1911`.

4. **`/identities/:identityKey`** on the main router at `identities.ts:517` — PUT for identity update. Uses `IDENTITY_KEY_RE` gate BEFORE any I/O (L529-533) and reads `hostId` from body (L541-551).

## Recommended route shape

Following the `no-dormancy` precedent:

**`POST /identities/:identityKey/archive`** with body `{ hostId: number }` (or query `?hostId=<n>` — pick one).

Rationale:
- Depth-2 under `/identities` — parallel structure to `/:key/no-dormancy`.
- Uses same IDENTITY_KEY_RE gate for shell/path injection defense.
- Uses same hostId body/query parameter for routing (LOCAL vs SSH branch via `isLocalHostId`).
- POST semantics: this is a one-shot command (matches D-07 intent semantics), not a state toggle. `.no-dormancy` was PUT because it's toggleable state; `.archive-requested` is one-way so POST is more accurate.

**Alternative considered (D-17):** `POST /identity/:hostId/:name/archive` — a fresh top-level `/identity/` mount would add a whole new route file with a different mounting convention. NOT recommended — the `/identities` pattern is already established across 3+ route modules (no-dormancy, exists-on-host, pool), and consistency wins.

**Alternative considered:** `POST /host/:hostId/identity/:name/archive` — host-first path shape. Not used anywhere currently in `routes/`. Skip.

## Route implementation sketch

New file: `src/backend/database/routes/identity-archive.ts`, mirroring `identity-no-dormancy.ts` structure:

```ts
router.post(
  "/:key/archive",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    // 1. Parse + validate hostId (from body)
    const hostId = /* parse from req.body.hostId */;
    if (invalid) return res.status(400).json({...});

    // 2. Validate identityKey via IDENTITY_KEY_RE
    const key = String(req.params.key);
    if (!IDENTITY_KEY_RE.test(key)) return res.status(400).json({...});

    // 3. Verify host ownership
    const host = await resolveHostById(hostId, userId);
    if (!host) return res.status(404).json({...});

    // 4. Branch LOCAL vs REMOTE — mirroring writeIdentityFile discipline
    const local = isLocalHostId(hostId);
    let conn: import("ssh2").Client | null = null;
    if (!local) {
      try { conn = await connectOneShot(host, 3000); }
      catch { return res.status(504).json({error: "Host unreachable"}); }
    }

    try {
      await writeIdentityFile(key, ".archive-requested", "", { hostId, conn });
      return res.json({ ok: true });
    } catch (err) {
      // log the error server-side, return generic 500
      return res.status(500).json({ error: "Failed to drop archive sentinel" });
    } finally {
      if (conn) { try { conn.end(); } catch { /* ignore */ } }
    }
  },
);
```

Mount in `database.ts` BEFORE the generic `/identities` router (same discipline as `identity-no-dormancy` at L1918).

## Auth/permission guards

Same as `identity-no-dormancy`:
- `authenticateJWT` middleware sets `req.userId`.
- `resolveHostById(hostId, userId)` filters to the caller's own hosts (Phase 89 admin-cross-user READ bypass exists but not for host writes — normal user path only writes their own hosts; admin cross-user write path is a separate concern not touched by Phase 115).
- `IDENTITY_KEY_RE` validates the key.

## ALLOWED_REL_PATHS update (D-21)

`src/backend/claude-session/per-identity-file.ts` **L82-86**:
```ts
export const ALLOWED_REL_PATHS: ReadonlySet<string> = new Set([
  "relay.json",
  ".pinned",
  ".archive-requested",  // ADDED
  // ".hidden" — REMOVED per D-21
]);
```

Update the comment at L27-31 to reflect the new set. Update the test at `per-identity-file.test.ts:273-278` — new whitelist assertion.

---

# Section 7 — The archived-section rendering in the sidebar

## Current Hidden section render — is it lazy?

**YES.** At `PrettyConversationsPanel.tsx` **L1978-2031**:

```tsx
{hiddenRows.length > 0 && (
  <div className="pv-panel-group pv-hidden-section">
    <button onClick={() => setHiddenExpanded((v) => !v)} ...>
      {/* header chip: EyeOff + "Hidden" + gradient rule + chevron */}
    </button>
    {hiddenExpanded &&
      hiddenRows.map((row) => (
        <PrettyConversationRowLive ... />
      ))}
  </div>
)}
```

The critical construct is `{hiddenExpanded && hiddenRows.map(...)}`. When `hiddenExpanded === false` (initial value per L748: `useState(false)`), the entire `hiddenRows.map` expression short-circuits to `false`, so React renders NOTHING inside the div (only the header button). Rows are NOT in the DOM at all.

**D-19 is satisfied today** — lazy loading is present. Phase 115 needs to preserve this. Planner action: RENAME `hiddenExpanded` → `archivedExpanded`, rename the section from "Hidden" to "Archived", RENAME `hiddenRows` → `archivedRows`, but keep the `{archivedExpanded && archivedRows.map(...)}` structure verbatim.

**Header treatment:** L1987 uses `<EyeOff className="size-3 ..." />` glyph. For Archived, the shape file didn't specify a glyph — planner picks. Options: `<Archive>` from lucide-react (semantic), `<Trash2>` (destructive, but archived rows aren't deleted), or reuse `<EyeOff>` for minimal visual churn. Recommend `<Archive>` — it's semantically accurate and matches the section label.

## Data source change (linked to Section 5)

Today: `hiddenRows` (L974-988) is computed by walking `activeSetRows`, `pinned`, `middle` and filtering rows where `isRowHidden(row, hiddenIds)` is true. This filter walks LIVE rows the panel already has.

Phase 115: `archivedRows` comes from a NEW data source — rows sourced from `SweepIdentityLine.archived === true`. These rows don't exist in `activeSetRows`, `pinned`, or `middle` because the fleet-status feeder never publishes them into the live identity state. They live in a new frontend store slice fed by the sweep frames.

**Planner action:** Add a new store slice (e.g., `state.archivedFleetRows` on conversation-store, or a new store module) that ssh-poll-orchestrator writes into. The archived section renders from this new slice. See Section 5 for the wire-level details.

## Archived rows are inert (D-06)

At the render site: pass NO `onArchive`, NO `onKill`, NO `onTogglePin`, NO `onSelect`. The `PrettyConversationRowLive` component currently always receives `onSelect` and `onTogglePin` — those need to be gated at the render site OR the row component needs to accept these as truly optional and skip the context menu entirely.

Simpler approach: emit archived rows using a NEW dedicated component `PrettyArchivedRow` that mirrors `PrettyConversationRow`'s visual but has no context menu wiring. Cleaner separation, tightly scoped to D-06.

---

# Section 8 — Test coverage patterns

## Phase 107 test locations (`.hidden` coverage — to be deleted per D-21)

- **Primitive:** `src/backend/claude-session/per-identity-file.test.ts` L273-278 (whitelist assertion) + L689+ (Phase 107 describe block, 10-ish tests). Delete + replace with `.archive-requested` equivalents.
- **Backend GET:** `src/backend/database/routes/identities.disk-read.test.ts` L423-499 (fanout probe topology) + L505+ (publicIdentity.hidden + disk-fanout tests, tagged `HID-107-*` and `PUB-107-*`). Delete entirely.
- **Backend PUT:** `src/backend/database/routes/user-preferences.test.ts` — Phase 107 hidden fanout tests, tagged `HID-107-PUT-*`. Delete entirely.
- **Frontend API:** `src/ui/api/user-preferences-api.test.ts` L207+ (API-107-01 test for putHiddenIds). Delete.
- **Frontend hydrate/state:** `src/ui/features/pretty-conversations/NewConversationModal.flow.test.tsx`, `PrettyConversationsPanel.role-management-flow.test.tsx`, `PrettyConversationsPanel.new-role-button.test.tsx`, `PrettyConversationsPanel.relay-room.test.tsx`, `PrettyConversationsPanel.test.tsx` — all have Phase 107 mock stubs (`deriveDiskHiddenIds: () => []`, `hydrateHiddenIdsFromServer: vi.fn()`, `hideConversation: vi.fn()`, etc.). Delete each stub.
- **Frontend affordance test:** somewhere in `PrettyConversationRow.test.tsx` and `PrettyConversationsPanel.test.tsx` (planner should grep) — "Hide button rendered on fleet rows, not on RDP/openTab/relay-room rows" tests. Rename or repurpose for Archive.
- **Fleet-status wire:** `src/backend/fleet-status/sweep-schema.test.ts`, `wire-protocol.test.ts`, `identity-appearance.test.ts`, `ssh-poll-orchestrator.test.ts` — hidden coverage. Delete + replace with archived coverage.

**Setup patterns to reuse:**
- Backend route tests use `supertest` + a mocked `db` module and mocked `identityFileExists` / `writeIdentityFile` / `removeIdentityFile`. See `user-preferences.test.ts` for the fanout test pattern.
- Frontend tests use `vi.mock('...')` at the top of each file for `identities-store`, `conversation-store`, `identities-api`, `user-preferences-api`. See `NewConversationModal.flow.test.tsx` for the shape.
- Primitive tests use `mockFs` + fake SSH conn objects. See `per-identity-file.test.ts` describe blocks.

## Phase 94 test infrastructure (retire flow — to be extended)

- **`substrate/scripts/tests/agent-supervisor-archive-scan.sh`** (841 lines). Test harness for `retire_identity()`, `run_archive_scan()`, `is_coordinator()`, retire-stuck counter, guards. Key features:
  - Hermetic sourcing: `AGENT_IDENTITIES_DIR`, `AGENT_IDENTITIES_ARCHIVE_DIR`, `AGENT_SUPERVISOR_CONF=/dev/null`, `AGENT_SUPERVISOR_LIB_ONLY=1` (L33 — a supervisor guard that stops before the reconcile loop when set, allowing pure function-definition loading).
  - Python-based stub homeserver at L240-287 (`start_stub_homeserver`) — spins up `http.server.BaseHTTPRequestHandler` on random port, responds with configurable HTTP code. Reads Content-Length body, responds `{"status":"ok"}`. Used to test matrix deactivate step's HTTP dispatch.
  - Test cases at L502-680: happy path (200), 401-idempotent-success, 5xx-abort, network-fail-abort, retry-from-partial, collision-abort, password-with-quotes injection defense, retire-stuck fires at 3-not-before, counter-resets-on-success.
  - Static-analysis gates at L321-334: bash syntax, shellcheck line-count (≤60), pitfall greps.

**For Phase 115:** Extend this same file. Add:
- Section for sentinel-scan branch (new): drop `.archive-requested` in scratch dir, invoke a wrapper of `reconcile()` (or a new `scan_archive_requested_sentinels()` function the planner adds), assert `retire_identity()` was called, sentinel is gone after success.
- Section for reordered retire (new): assert step order matrix → harness → tmux → folder by inspecting log output or by having each step touch a marker file.
- Section for guard bypass (new): pinned/no-dormancy/coordinator sentinels present + `.archive-requested` present → retire STILL fires (asserting D-11 bypass).
- Section for guard-still-applies-on-daily-path (new): pinned/no-dormancy/coordinator sentinels present + no `.archive-requested` + freshness > 180 days → retire does NOT fire (asserting the daily path still respects guards).

## What already exists vs what needs to be built fresh

**Already exists (reuse):**
- Stub homeserver infrastructure at L240-298.
- Retire happy-path test with 200 stub at L502.
- Retry-from-partial test at L567.
- Retire-stuck counter tests at L620.

**Needs fresh construction:**
- Sentinel-scan branch invocation harness.
- Reordered-step observation (per-step marker file or log-line grep).
- Guard-bypass assertion (both directions).
- Real tmux session teardown observation (existing tests kill sessions but don't observe ambient-monitor child cleanup — this is the D-22 gap).
- Ambient-monitor child-cleanup observation (see Section 11).

---

# Section 9 — Fleet substrate distribution integration

Confirmed no changes needed:
- `agent-supervisor.sh` distributed via `src/backend/distributor/catalog.ts` L193-196 (slug: `agent-supervisor`, restart hook: `agent-supervisor.service`).
- `fleet-status-sweep.py` distributed via L251-254 (slug: `fleet-status-sweep`).
- `ambient-monitor.py` distributed via L287-289 (slug: `ambient-monitor`).
- `recv.sh` distributed via L142-144 as part of the agent-relay skill.

Once Phase 115 changes land on origin, the distributor sweeps them to every managed host on its next cycle. No `catalog.ts` edit needed.

Fleet rule reminder (L47-58 header comment): never hand-edit the installed copies (`~/.local/bin/agent-supervisor` etc.) — always edit `substrate/scripts/` in origin and let the distributor propagate.

---

# Section 10 — Sentinel `.archive-requested` addition to ALLOWED_REL_PATHS

Confirmed location: `src/backend/claude-session/per-identity-file.ts` **L82-86**. Current three entries: `"relay.json"`, `".pinned"`, `".hidden"`. Add `".archive-requested"`; delete `".hidden"` per D-21.

Full change:
```ts
// BEFORE:
export const ALLOWED_REL_PATHS: ReadonlySet<string> = new Set([
  "relay.json",
  ".pinned",
  ".hidden",
]);

// AFTER:
export const ALLOWED_REL_PATHS: ReadonlySet<string> = new Set([
  "relay.json",
  ".pinned",
  ".archive-requested",
]);
```

Update L27-31 comment block to mention `.archive-requested` in place of `.hidden`.

Update comment at L77-80 (the "The bounded set of basenames" doc-comment) to say `.archive-requested` — cite Phase 115 in the reference tag.

Update the primitive test whitelist assertion at `per-identity-file.test.ts:273-278`:
```ts
expect(ALLOWED_REL_PATHS.has(".archive-requested")).toBe(true);
// Delete: expect(ALLOWED_REL_PATHS.has(".hidden")).toBe(true);
```

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — the `.hidden` sentinel is the only stored representation of hidden state; D-20 declares the operator handles manual `.hidden` cleanup outside code scope. No DB rows to migrate (Phase 107 already dropped `hidden_conversation_ids` column). No ChromaDB/Mem0/Redis touchpoints for hidden or archive. | Data-migration for `.hidden` files is the operator's manual task (D-20). No code migration needed. |
| Live service config | None. n8n workflows, Datadog service names, Tailscale ACLs, Cloudflare Tunnel names — none reference `.hidden` or per-identity retire state. Matrix homeserver has deactivated accounts (from Phase 94's retire step 3) — these are legitimate ongoing state on Synapse, not a stale reference. | None. |
| OS-registered state | The distributor propagates `agent-supervisor.sh` + `fleet-status-sweep.py` + `ambient-monitor.py` via the fleet-substrate catalog on its next sweep. No systemd unit changes. No OS Task Scheduler entries reference these files by content. | None — distributor auto-propagates on next cycle. |
| Secrets / env vars | No env var names change. `SOPS` isn't in play for these files. `.env` files not touched. | None. |
| Build artifacts | Backend build (`npm run build:backend`) will emit updated JS from the deleted `.hidden` reader/writer code — normal build cycle handles this. No stale egg-info / .whl / Docker image tags. | Rebuild after code lands (standard deploy motion). |

**Canonical question answer:** After every file in the repo is updated:
- **Live tree `.hidden` sentinels on managed hosts** — the operator manually converts / deletes per D-20 outside this phase's code scope.
- **DB `hidden_conversation_ids` rows** — already dropped in Phase 107 (D-21 confirms nothing new to drop).
- **In-memory `state.hiddenIds` in the frontend** — cleared on next page load (no persistent client cache for this specifically). The `localStorage` cache under `skynet:identities-appearance-cache:v1` may still contain `hidden` field on cached identity records; the schema version suffix `v1` should be bumped to `v2` when the identity shape changes (search `APPEARANCE_CACHE_KEY` in `identities-store.ts` L37 — planner note).

---

# Section 11 — Untested-in-practice risk (D-22 depth)

## What the E2E retire test needs to observe

**Non-negotiable observations for the new-order retire flow to be trusted:**
1. Matrix deactivate call actually reaches a homeserver AND returns 200 (or 401 → idempotent success).
2. `/exit` paste reaches the tmux pane AND claude/node processes on that pane's tty exit within a bounded window.
3. Ambient-monitor's `_harness_watch()` fires within ~1s of harness death.
4. Ambient-monitor's `_do_shutdown()` SIGTERMs the four watcher children (killpg fanout).
5. Relay-receiver flushes its cursor (its cursor file mtime advances or is stable within the sync window before shutdown).
6. Ambient-monitor exits within `GRACE_SECONDS` (10s) after harness death.
7. `tmux kill-session` runs AFTER ambient-monitor has exited (or is at least fully quiesced).
8. Folder move `mv identities/<name> identities-archive/<name>` completes AFTER all of the above.
9. `.archive-requested` sentinel is deleted BEFORE the folder move (D-12 option b).

## Recommended test harness architecture

**Reuse the existing infrastructure:**
- The Python stub homeserver at `substrate/scripts/tests/agent-supervisor-archive-scan.sh:240-287` — extend to log request bodies (currently discards them at L256) so the test can assert the deactivate payload's user_id / password fields are what we expect.
- The hermetic scratch dir + `AGENT_SUPERVISOR_LIB_ONLY=1` sourcing pattern at L89-97 — extend with `AGENT_AMBIENT_MONITOR=1` env if we introduce a similar library-only mode for ambient-monitor (or spawn ambient-monitor as a real subprocess in a scratch identity).

**Additional infrastructure needed:**
- **Real tmux session in the test.** Existing tests kill sessions but don't spawn real claude harnesses. For Phase 115, the graceful-exit path needs a REAL running process on the tty that responds to /exit. Options:
  - Spawn a shell script that reads a signal file and exits cleanly (simulates a well-behaved harness).
  - Spawn a shell script that ignores SIGTERM and just spins (simulates a hung harness — tests the SIGTERM survivor kill).
  - Spawn actual `claude` — but that requires a live Claude Code install in the test env; skip for CI.

- **Real ambient-monitor invocation.** Currently the test at `agent-supervisor-archive-scan.sh` doesn't touch ambient-monitor. For Phase 115, the E2E test needs to spawn ambient-monitor as a subprocess, verify its child processes exist (via `pgrep` or a state file each child touches), then trigger the retire and observe children exit + cursor file mtime + ambient-monitor exit code.

- **Marker files per retire step.** The most reliable way to assert step ordering: have each step drop a per-step marker file `~/scratch/.state/retire-marker-<step>-<timestamp>`. Then the test asserts the marker mtimes are monotonically increasing in the D-13 order.

## Failure modes to test

1. **Matrix 401 on user-initiated retire (D-11 + D-15 loud):** stub returns 401 → retire completes as idempotent success (matches existing Phase 94 behavior at `agent-supervisor.sh:454-459`). Sentinel is deleted, folder moves. No retire-stuck sentinel.

2. **Matrix 500 on user-initiated retire (D-16 LOUD):** stub returns 500 → retire returns 1 → sentinel STAYS → next tick retries → 2nd and 3rd tick also fail → `retire-stuck` sentinel drops in dormancy state dir (or archive dir — but archive dir may not exist yet since Step 1 didn't move the folder). Planner MUST decide the retire-stuck location for the new-order case (see Section 3 above).

3. **Tmux kill error on the daily path** (existing coverage at `test_retire_5xx_aborts_with_1` etc.). In the new order, tmux kill is step 3 — after ambient-monitor has already gracefully exited. If tmux kill fails, the ambient-monitor is already gone; retire should return 1 and the sentinel stays for retry. Test: kill the tmux session BEFORE step 3 runs (simulate "session already gone between ambient-monitor cleanup and tmux kill"); assert retire proceeds to step 4 (folder move) as an idempotent no-op.

4. **Folder move conflict:** live and archive both exist (State 3 at `agent-supervisor.sh:388-393`) — currently aborts. In the new order, this state is even less likely to arise (matrix already deactivated, harness already exited, tmux already killed — but the folder is somehow present in both places). Existing behavior (abort with retire-stuck after 3) is fine. Test: pre-populate both `identities/<name>` and `identities-archive/<name>`, drop `.archive-requested`, assert 3 failed retires → retire-stuck drops.

5. **Ambient-monitor doesn't shut down its children:** simulate by pre-launching a fake ambient-monitor that has broken `_harness_watch()` (e.g., HARNESS_PID=None branch at line 745-747). In this case, the harness dies but ambient-monitor doesn't notice. Retire's Step 2 wait times out. Tmux kill in Step 3 THEN kills the ambient-monitor via SIGHUP (pane dies → session dies → ambient-monitor's controlling tty is gone → SIGHUP). This is a degraded path but should NOT leave orphan processes. Test: assert that after Step 3, `pgrep -f ambient-monitor` returns no match for this identity.

6. **Relay receiver mid-sync at shutdown:** the receiver's long-poll is in-flight when SIGTERM lands. curl gets killed, script exits. Cursor file at `since` has value from a PRIOR successful sync (30s window). Test: pre-populate `since` file with a known value, spawn recv.sh in a subshell, SIGTERM after 2s, assert cursor file value UNCHANGED (no partial-write, no empty file).

## Test infrastructure gap assessment

**Existing (from Phase 94):**
- ✅ Stub homeserver with configurable HTTP code
- ✅ Hermetic scratch dir + supervisor sourcing
- ✅ Log-line asserts for retire steps
- ✅ Retire-stuck counter tests
- ✅ Password-with-quotes injection defense test

**Missing (Phase 115 must add):**
- ❌ Real tmux session running a "well-behaved harness" script that responds to /exit
- ❌ Real ambient-monitor spawned as subprocess with 4 fake children (each child a shell script that touches a marker on SIGTERM before exiting)
- ❌ Cursor-file-mtime-during-shutdown observation
- ❌ Sentinel-scan branch invocation (need to call the new user-initiated scan function in isolation)
- ❌ Step ordering marker-file assertion
- ❌ Guard bypass matrix (user-initiated path vs daily path × pinned × no-dormancy × coordinator)

**Alternative to real ambient-monitor:** Mock the entire ambient-monitor via a shell-script stub that (a) writes its own pid to a file (b) listens on SIGTERM (via `trap`) (c) touches a "clean-exit" marker before exiting. Then the retire test can assert the stub was SIGTERM'd and cleaned up. This is much simpler than spinning real ambient-monitor + 4 real children in a CI env.

## Homeserver testing options

- **Option A: Stub homeserver only (existing).** Fast, deterministic, doesn't require Synapse. Tests the HTTP response dispatch but doesn't verify Synapse's post-deactivate state (username reservation, user_directory filtering). Recommendation: use for CI + gate.
- **Option B: Throwaway Matrix account on a test homeserver.** Requires network + credentials. Should be an integration test run manually before push OR a separate "e2e-live" test file that's opt-in via env var. Verifies the entire chain including post-Synapse state.
- **Option C: Docker-composed Synapse.** Full local homeserver in the test env. Heavy but complete. Overkill for Phase 115 — Phase 94's dev evidence at `agent-supervisor.sh:145` already confirmed the endpoint works against Synapse 1.157.2.

**Recommendation:** Option A for the CI gate (fast, deterministic), Option B as a manual pre-ship checklist item (the operator runs it against her live test account). Skip Option C.

## Observability upgrades to consider

The current retire logs are `log "archive-scan: retire '$name': step X — ..."`. For Phase 115's E2E test to make step-ordering assertions reliable, consider adding structured tags that a shell test can grep for:
- `[retire step=1 status=success name=alice]`
- `[retire step=2 status=graceful-exit name=alice pane_tty=/dev/pts/5 survivors=0]`
- etc.

This is a nice-to-have for testing but adds noise to the operational log. Planner discretion — recommend adding at least step-number tags for grep-ability.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The identity displayName in the confirmation dialog (D-03) should be the row's displayed identity name (e.g. "wren"). CONTEXT says "displayed identity name (e.g. wren, tabitha)"; I read this as `row.host?.name` or the resolved identity's `displayName`, but haven't verified which frontend field the planner should use. | Section 1 | Minor — wrong field means the dialog says "archive `alpha-1`" instead of "archive `Alpha`". Cosmetic only. |
| A2 | `AGENT_SUPERVISOR_LIB_ONLY=1` supports library-only loading (i.e., function definitions load without the reconcile loop running). I only saw this env var used in the test harness at `agent-supervisor-archive-scan.sh:33,77,94`; the guard itself in the supervisor script may be handled at a different point that I didn't trace. | Section 8, 11 | Low — if the guard doesn't exist as expected, the test harness pattern doesn't work as-is, but this is testable in isolation before phase execution. |
| A3 | The `handleRowDeactivate(row)` function closes the tab as a side effect of the deactivate. I saw the call at `PrettyConversationsPanel.tsx:1427` inside `handleToggleHide`; I did NOT read `handleRowDeactivate` itself to verify what it actually does. The archive path (D-04) requires closing the visible session — need to confirm this composition is right. | Section 1, 7 | Low — worst case is that the pane doesn't close on Archive; user hits it once more or the pane stays until refresh. Not data-loss. |
| A4 | The archive-tree enumeration approach (unified walk with `archived` flag) works cleanly in the sweep. I did NOT verify that `SweepIdentityLine` consumers (fleet-status-feeder / ssh-poll-orchestrator) can handle rows from a completely different disk root without confusion (e.g., they might assume every identity name maps 1:1 to a live identity for other reads like jsonl_tail scans). | Section 5 | Medium — if the orchestrator assumes archived rows still have valid `identity_cosmetics` / `role` / `jsonl_path`, it might issue useless reads or emit misleading appearance data. Recommend the planner verify: for archived rows, `_build_identity_line` should either skip the jsonl_path discovery + tail scan entirely OR treat missing paths as null (already the fail-open behavior — probably fine). |
| A5 | `identityBadgeContextMenuItems` on `IdentitySessionPane.tsx` L154+ is the SINGLE badge-menu render site. I did not exhaustively search for other badge-menu builders in `shell/` or `pretty-view/`. | Section 1 | Low — if a second site exists, the Archive item would be missing there and the badge menu would inherit the old Hide behavior. Grep for `identityBadgeContextMenuItems` in the codebase before finalizing plan slicing. |
| A6 | `.hidden` sentinel files on managed hosts are the only runtime residue of Phase 107. I saw no other references (no separate DB table, no filesystem cache). But this claim relies on my grep coverage — the planner should re-verify. | Runtime State Inventory | Low — if there's another cache (say, an in-memory Skynet server cache), it's cleaned by container restart; not a plan blocker. |

## Open Questions

1. **Where to write the `retire-stuck` sentinel on the new-order path?**
   - What we know: In Phase 94's order, the folder is moved FIRST, so `$IDENTITIES_ARCHIVE_DIR/$name/retire-stuck` is a valid destination if we're any step past 1. In Phase 115's order, the folder move is LAST — the archdir may not exist yet.
   - What's unclear: Should we (a) `mkdir -p` the archdir before touching retire-stuck, (b) write retire-stuck to the DORMANCY_STATE_DIR instead, or (c) write to the live identity dir?
   - Recommendation: Option (a) — `mkdir -p "$IDENTITIES_ARCHIVE_DIR/$name" && touch retire-stuck`. Preserves grep-ability semantics ("look in archive/ for stuck identities"). Small code change.

2. **Exact graceful-exit timeout in step 2.**
   - What we know: Recycle uses 500ms + 3000ms = 3.5s wait budget. Ambient-monitor's grace window is 10s. Total budget from `/exit` paste to fully-clean-shutdown is ~13.5s.
   - What's unclear: Should step 2 wait a fixed 13-15s, or poll ambient-monitor's PID until exit + timeout?
   - Recommendation: Poll for ambient-monitor pid exit (with a bounded 15s timeout) — more precise. Fallback to fixed sleep if the pid isn't discoverable.

3. **Sentinel-scan implementation — inline vs background.**
   - What we know: CONTEXT.md's Claude's Discretion notes this as a decision. Retire's Matrix deactivate step can take multiple seconds (network); tmux/folder ops are millisecond-scale.
   - What's unclear: If the retire runs inline on the reconcile tick, a slow retire could push the next tick past 15s (blowing the tick cadence contract). If it runs as a background task, we need to guard against overlapping retires on the same identity (a second tick could fire again before the first finishes).
   - Recommendation: Run inline BUT drop the sentinel INTO `.archive-in-progress` at retire start (rename `.archive-requested` → `.archive-in-progress` — like recycle's `.recycle-requested` → `.recycled-at`). Subsequent ticks that see `.archive-in-progress` skip. Cleanup: delete `.archive-in-progress` at retire end (success or 3-strike fail). This is idempotent + non-blocking for other identities and avoids background-task complexity.

4. **Archived rows: separate wire message shape vs bolted onto IdentityAppearance?**
   - What we know: `IdentityAppearance` is threaded through `resolveIdentityAppearance` for consistent cosmetics rendering. Archived rows have no live activity to publish (no dormant flag, no working state, no jsonl_tail).
   - What's unclear: Do we (a) send archived rows through the same fleet-status frames with an `archived: true` field on the identity, or (b) use a separate wire path?
   - Recommendation: Option (a) with the caveat that ssh-poll-orchestrator gates rendering. Archived rows arrive on the same `SweepIdentityLine` shape (with `archived: true` field), and the frontend fleet-status feeder writes them into a NEW store slice (not `state.identities`), keeping D-06's "inert rows" separation clean.

---

## Sources

### Primary (HIGH confidence — read verbatim in this session)

- `.planning/phases/115-identity-archiving-from-the-frontend/115-CONTEXT.md` — locked decisions D-01..D-23
- `.planning/shapes/shape-identity-archiving.md` — shape file (source of D-01..D-23 via /open)
- `.planning/phases/94-supervisor-archive-extension-daily-archive-scan-for-180-day-/94-CONTEXT.md` — Phase 94 retire flow context
- `.planning/phases/107-hide-identity-rows-via-disk-sentinel-mirror-phase-92-for-the/107-CONTEXT.md` — Phase 107 hidden sentinel context
- `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` (1424 lines) — row context menu
- `src/ui/features/pretty-conversations/PrettyConversationContextMenu.tsx` (223 lines) — shared portal menu
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (2251 lines) — panel-level handlers + archived section render
- `src/ui/shell/IdentitySessionPane.tsx` (555 lines) — identity badge context menu
- `src/ui/api/user-preferences-api.ts` (134 lines) — Phase 107 putHiddenIds
- `src/ui/state/identities-store.ts` — deriveDiskHiddenIds + hydrate helpers
- `src/ui/state/conversation-store.ts` — hideConversation, unhideConversation, hiddenIds slice
- `src/backend/claude-session/per-identity-file.ts` (395 lines) — primitive layer + ALLOWED_REL_PATHS
- `src/backend/database/routes/identities.ts` (1014 lines) — publicIdentity, GET /identities disk fanout
- `src/backend/database/routes/user-preferences.ts` (685 lines) — hidden fanout block
- `src/backend/database/routes/identity-no-dormancy.ts` — per-identity sentinel toggle precedent
- `src/backend/database/database.ts` — route mounting order
- `src/backend/fleet-status/sweep-schema.ts` (413 lines) — SweepIdentityLine
- `src/backend/fleet-status/ssh-poll-orchestrator.ts` — appearanceFromIdentityLine
- `src/backend/fleet-status/identity-appearance.ts` — resolveIdentityAppearance
- `substrate/scripts/agent-supervisor.sh` (1966 lines) — retire_identity, run_archive_scan, recycle, reconcile
- `substrate/scripts/ambient-monitor.py` (772 lines) — _harness_watch, _do_shutdown, GRACE_SECONDS
- `substrate/skills/agent-relay/recv.sh` — cursor flush behavior + trap absence
- `substrate/scripts/fleet-status-sweep.py` (1139 lines) — _enumerate_identities, _build_identity_line
- `substrate/scripts/tests/agent-supervisor-archive-scan.sh` (841 lines) — Phase 94 test harness
- `src/backend/distributor/catalog.ts` — distribution catalog confirmation
- `src/backend/claude-session/per-identity-file.test.ts` — Phase 107 hidden primitive tests
- `.planning/config.json` — nyquist_validation setting (false)

### Secondary (MEDIUM confidence — grep-based only)

- Existing frontend UI test files (grep-only, not read line-by-line): NewConversationModal.flow.test.tsx, PrettyConversationsPanel.*.test.tsx, conversation-store.test.ts, identities-store.enrichment.test.ts. All confirmed to have `.hidden` / `hideConversation` mocks.

### Tertiary (LOW confidence — not verified)

- None. All claims in this research are backed by file+line citations from files read directly in this session.

## Metadata

**Confidence breakdown:**
- Frontend menu wiring (§1, §7): HIGH — read all 3 relevant source files verbatim.
- `.hidden` deletion inventory (§2): HIGH — file + line for every referenced site.
- Retire flow / supervisor (§3): HIGH — retire_identity, run_archive_scan, recycle all read verbatim; guard bypass architecture is clear.
- Ambient-monitor timing (§4): MEDIUM — `_harness_watch` + `_do_shutdown` verified; the 10s grace window claim is a direct read from L81. The recommendation that step 2 must wait ≥10s is a reasoning conclusion, not a locked spec — the planner should confirm during implementation.
- Sweep + archive-tree (§5, §6): MEDIUM — sweep-schema and fleet-status-sweep.py read verbatim; the recommended "unified walk" approach is planner-picks-per-CONTEXT (both branches noted).
- Archive endpoint route shape (§6): HIGH — `identity-no-dormancy.ts` verified as a directly reusable precedent.
- Testing (§8, §11): HIGH — existing test harness read verbatim; the "what's missing" list is a reasoning conclusion.
- Distribution (§9): HIGH — catalog.ts entries confirmed.

**Research date:** 2026-09-17
**Valid until:** 30 days for the supervisor/ambient-monitor code paths (stable), 7 days for the frontend menu code (HEAD `ebcbac5b` was landed 2026-09-17; expect drift as adjacent UX work happens).

---

## RESEARCH COMPLETE

---
phase: 115-identity-archiving-from-the-frontend
plan: 06
subsystem: frontend (row + badge menus, archived section, store slice, API client) + backend (wire protocol, subscription registry, ssh-poll-orchestrator)
tags: [phase-115, archive, frontend, wire-protocol, subscription-registry, ssh-poll-orchestrator, D-01, D-02, D-03, D-04, D-05, D-06, D-19, distinct-wire-message]

# Dependency graph
requires:
  - phase: 115
    plan: 02
    provides: "retired .hidden frontend + backend surfaces (menu items, store slice, wire fields) — 115-06 lands the Archive replacement in the same slots"
  - phase: 115
    plan: 03
    provides: "POST /identities/:key/archive route + IDENTITY_KEY_RE gate + resolveHostById ownership filter — 115-06's archiveIdentity API client is the frontend caller"
  - phase: 115
    plan: 05
    provides: "SweepIdentityLine.archived?: boolean + unified archive-tree walk in fleet-status-sweep.py — 115-06's ssh-poll-orchestrator source-B loop keys on line.archived === true"
provides:
  - "archiveIdentity(hostId, identityKey) API client — POST /identities/:key/archive"
  - "'Archive' menu item on row (PrettyConversationRow.tsx) + identity badge (IdentitySessionPane.tsx) with danger:true styling + D-03 confirmation dialog"
  - "canonicalArchiveIdForRow(row) — affordance-narrowing gate mirroring the retired canonicalHideIdForRow"
  - "handleArchive(row) — panel-level composition: gate → confirm → pane-close side effect → API call"
  - "PrettyArchivedRow.tsx — purely presentational, inert (D-06) archived-row component"
  - "archivedFleetRows store slice — new dedicated pool (NOT state.identities) fed by the distinct wire message"
  - "useArchivedFleetRows() + setArchivedFleetRows() + upsertArchivedFleetRow() — store surface"
  - "Archived section render in PrettyConversationsPanel — D-19 lazy-render via {archivedExpanded && archivedRows.map(...)} short-circuit"
  - "FrontendIdentityArchivedFrame — distinct wire message shape { kind:'identity-archived', name, hostId, hostname } in the FrontendOutboundFrame discriminated union"
  - "publishIdentityArchived(name, hostId, hostname) — idempotent registry publish method + archivedIdentities Map + snapshot-on-subscribe replay"
  - "ssh-poll-orchestrator source-B batch loop routes archived-tree rows to publishIdentityArchived, live-tree rows to composeAndPublishPerIdentity (strict-boolean check per 115-05 threat note)"
  - "AppShell fleet-status-client onIdentityArchived callback → upsertArchivedFleetRow"
affects: [115-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Distinct wire message for inert historical rows: archived rows get their own frame shape ({ kind:'identity-archived', ... }) rather than bolting archived:true onto the standard identity frame. Rationale: (a) D-06 rows are inert and never join the interactive session pool, so a phantom boolean on every active identity would be dead weight, (b) frontend routing maps 1:1 onto a distinct store slice (archivedFleetRows) rather than filtering identity frames post-hoc, (c) future archive-only fields (archived-at, etc.) live on this frame without polluting the standard frame."
    - "Idempotent registry publish with (hostId, name) composite key: publishIdentityArchived is a no-op if the registry already has a byte-identical entry. Cross-host name collisions produce distinct entries. Snapshot-on-subscribe replays the whole cache to reconnecting clients — same discipline as the existing SessionState snapshot delivery."
    - "Affordance-narrowing gate at the panel + defense-in-depth at the row: canonicalArchiveIdForRow(row) at the panel returns null for RDP synthetic rows, relay-room rows, and rows without host+targetTmuxSession. Row-side items[] builder gates on onArchive prop presence. RDP render site does NOT thread onArchive at all (documented with an inline comment for future refactor safety)."
    - "Lazy-render via short-circuit (D-19): `{archivedExpanded && archivedRows.map(...)}` — collapsed rows are NOT in the DOM at all. Test A11 asserts zero PrettyArchivedRow instances when archivedExpanded=false. Do NOT switch to CSS `hidden` or `aria-expanded`-only approach; the short-circuit IS the invariant."
    - "Strict-boolean check on archived field: `line.archived === true` (not truthy-check). Per 115-05 SUMMARY threat note T-115-05-04 — a stringly-typed malicious payload `archived: 'false'` (truthy string) MUST NOT route to the archived pool. Load-bearing defense inside the source-B loop."
    - "Byte-identical handler bodies between row and badge entry points: both handleArchive (panel) and the identity-badge onClick spell out the same displayName resolution + D-03 exact confirmation copy + pane-close + API call. Per 115-06 plan-check refinement #2 lock — the two entry points must be behavior-identical."

key-files:
  created:
    - "src/ui/api/identity-archive-api.ts (32 lines) — archiveIdentity(hostId, identityKey) fetch wrapper"
    - "src/ui/api/identity-archive-api.test.ts (114 lines) — 5-test coverage of the wire shape + error paths + encodeURIComponent"
    - "src/ui/features/pretty-conversations/PrettyArchivedRow.tsx (48 lines) — purely presentational inert component (D-06)"
    - ".planning/phases/115-identity-archiving-from-the-frontend/115-06-SUMMARY.md (this file)"
  modified:
    - "src/ui/features/pretty-conversations/PrettyConversationRow.tsx (+32 lines) — accepts onArchive prop; menu items IIFE gains 'Archive' entry with danger:true"
    - "src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx (+120 lines) — 4 new A1-A4 tests"
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx (+165 lines) — canonicalArchiveIdForRow helper + handleArchive handler + Archived section render + onArchive threading at 3 render sites (search-flat, pinned, middle) + RDP explicit-exclusion comment"
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx (+380 lines) — mocks archiveIdentitySpy + useArchivedFleetRows + mockArchivedFleetRows fixture + 10 new tests A5-A14"
    - "src/ui/shell/IdentitySessionPane.tsx (+63 lines) — imports archiveIdentity; adds Archive item to identityBadgeContextMenuItems with byte-identical handler body"
    - "src/ui/state/conversation-store.ts (+96 lines) — ArchivedFleetRow type + state.archivedFleetRows slice + setArchivedFleetRows + upsertArchivedFleetRow + useArchivedFleetRows hook"
    - "src/ui/AppShell.tsx (+15 lines) — imports upsertArchivedFleetRow; adds onIdentityArchived callback threading hostId parse + upsert"
    - "src/ui/api/fleet-status-client.ts (+22 lines) — onIdentityArchived option; case 'identity-archived' in ws.onmessage discriminator"
    - "src/ui/api/fleet-status-types.ts (+15 lines) — FrontendIdentityArchivedFrame in FrontendOutboundFrame union"
    - "src/backend/fleet-status/wire-protocol.ts (+56 lines) — FrontendIdentityArchivedFrameSchema in the discriminated union + makeIdentityArchivedFrame helper"
    - "src/backend/fleet-status/wire-protocol.test.ts (+108 lines) — 6 new P115-06 A-F tests"
    - "src/backend/fleet-status/subscription-registry.ts (+55 lines) — publishIdentityArchived + archivedIdentities Map + snapshot-on-subscribe replay"
    - "src/backend/fleet-status/subscription-registry.test.ts (+95 lines) — 5 new tests (11-15)"
    - "src/backend/fleet-status/ssh-poll-orchestrator.ts (+22 lines in source-B loop) — archived === true routing to publishIdentityArchived"
    - "src/backend/fleet-status/ssh-poll-orchestrator.test.ts (+128 lines) — MockRegistry.publishIdentityArchived + publishedArchived tracker; makeSweepJsonl accepts archived; 3 new archive-routing tests"

decisions:
  - "Distinct wire message locked (Option A per plan `<action>` block). The plan-check refinement #3 explicitly ruled the wire shape decision LOCKED to Option A: publish { kind:'identity-archived', name, hostId, hostname } as a distinct frame in the discriminated union, do NOT bolt archived:true onto the standard identity frame. This aligns with 115-05 SUMMARY's docblock note documenting the intended 115-06 separation, and with D-06's inert-row separation."
  - "Confirmation copy — EXACT-STRING equality, D-03 verbatim. `archive <displayName>? this can't be undone.` — straight ASCII apostrophe (U+0027), period at end, no backticks or quotes around the displayName in the actual dialog string. Test A5 asserts exact equality via `expect(confirmSpy).toHaveBeenCalledWith('archive wren? this can\\'t be undone.')` with fixture identity name 'wren'. Backticks in the CONTEXT.md around `<identity>` are MARKDOWN emphasis, not literal chars in the dialog. Both entry points (row menu + badge menu) construct the string identically (plan-check refinement #2 lock)."
  - "canonicalArchiveIdForRow(row) — verbatim rename of the deleted canonicalHideIdForRow (115-02 D-21). Returns null for RDP synthetic rows, relay-room rows, and rows without host + targetTmuxSession. Otherwise returns fleet::<hostId>::<key>. Panel threads onArchive only when the gate returns non-null. Row-side items[] builder gates on onArchive prop presence. Defense-in-depth: A9 test asserts RDP row does NOT show Archive in the menu even without the panel-side gate."
  - "handleArchive composition: canonical gate → resolve displayName via identitiesByHostKey (fallback byKey, fallback identityKey per assumption A1 in RESEARCH) → window.confirm with D-03 copy → on confirm=true: handleRowDeactivate(row) if row in activeSet (D-04 side effect), then void archiveIdentity(hostIdNum, identityKey).catch(log) fire-and-forget. Errors log via console.warn — no toast infrastructure at panel level today. This mirrors the deleted handleToggleHide composition byte-for-byte, renamed."
  - "Identity badge onClick body — spelled out inline per plan-check refinement #2. Do NOT hand-wave 'match the composition' — both entry points must be behavior-identical, and the badge menu's onClick handler body inlines the same displayName resolution + confirmation copy + pane-close + fire-and-forget archiveIdentity call as the panel-side handleArchive. Byte-identical copy is the test invariant (A5 fixture identity 'wren' produces 'archive wren? this can\\'t be undone.' at BOTH entry points)."
  - "PrettyArchivedRow.tsx is a NEW file, purely presentational — no context menu, no click handlers, no onSelect / onKill / onPin / onArchive. Wrapping div uses `pv-panel-row pv-archived-row` classes with opacity-60 for dimmed treatment. data-testid='pretty-archived-row' + data-archived-name / data-archived-hostname attributes for test assertions. NO onContextMenu attribute at all — right-click gets the browser's default context menu, not the PrettyConversationContextMenu."
  - "Archived-rows store slice is a NEW dedicated field on conversation-store state (`archivedFleetRows: ArchivedFleetRow[]`). NOT part of `state.identities`, NOT part of `state.fleetSessions`, NOT part of `state.pinnedIds` or `state.activeSet`. Setter (setArchivedFleetRows) is a whole-array REPLACE; upsertArchivedFleetRow is an idempotent per-row add-if-absent/replace-if-changed keyed on (hostId, name). Cross-host name collisions produce two rows (per RESEARCH §5 note: shouldn't happen in practice; if it does, both survive)."
  - "Distinct wire message routing at ssh-poll-orchestrator's source-B batch loop: SweepIdentityLine.archived === true → registry.publishIdentityArchived + skip composeAndPublishPerIdentity. Live-tree rows (archived==false or undefined) continue through the existing compose path unchanged. Strict-boolean check (=== true, not truthy) per 115-05 SUMMARY threat note T-115-05-04 defends against stringly-typed malicious payloads. Legacy source-B path (pollDormantOnlyIdentities) unchanged — it only enumerates ~/fleet/identities/ (live tree), never sees archive-tree rows."
  - "publishIdentityArchived is idempotent per (hostId, name) composite key. A per-tick re-observation of the same archive-tree row does NOT re-fan-out the frame. Registry entry replaced (with re-fanout) if hostname changes. Snapshot-on-subscribe replays every archivedIdentities entry so a reconnecting client re-hydrates its archivedFleetRows slice via the same code path as the initial per-frame delivery."
  - "AppShell wiring: onIdentityArchived callback parses hostId to number at the string→number boundary (mirroring the onGone handler's parseInt discipline) and calls upsertArchivedFleetRow({ hostId, name, hostname }). Non-finite hostIds are dropped silently — defense against a malformed wire payload."
  - "lucide-react already a dependency — no new package install. Uses `Archive` glyph for the section header (per RESEARCH §7 recommendation) and `ChevronDown` for the expand affordance."

patterns-established:
  - "Distinct-wire-message pattern for inert historical rows: a new frame kind in the FrontendOutboundFrame discriminated union + a registry publish method + a distinct store slice + a distinct render component. Applies to any future inert-history axis (e.g. archived relay rooms, historical roles) that shouldn't participate in the interactive pool."
  - "Idempotent registry publish + snapshot-on-subscribe replay: any registry method that maintains a cache should (a) be idempotent per composite key, (b) replay its cache to new subscribers via the subscribe() snapshot path. publishIdentityArchived is the reference implementation."
  - "Byte-identical entry-point handler body between conversation-row and identity-badge menus: when a menu affordance exists on BOTH surfaces (previously Pin/Unpin, now Archive), the click handler body must be spelled out inline at BOTH sites and produce identical dialog text + identical API calls + identical side effects. A shared helper is not required (both sites carry the same 6-line body); what matters is the observable behavior."

requirements-completed: []

# Metrics
duration: ~90min
completed: 2026-09-17
---

# Phase 115 Plan 115-06: Frontend archive flow — menu rename + confirmation + archived section Summary

**Landed the frontend half of the phase: the Hide-slot menu item is now 'Archive' with red styling and a locked confirmation dialog; clicks POST to /identities/:key/archive (115-03 endpoint); the archived section renders lazily from a new dedicated store slice fed by the distinct `identity-archived` wire message from ssh-poll-orchestrator. Delivers D-01, D-02, D-03, D-04, D-05, D-06, D-19. 6 atomic commits, 470/470 tests green across 7 touched test files; frontend + backend tsc clean.**

## Performance

- **Duration:** ~90 min wall-clock across 3 tasks
- **Started:** 2026-09-17 (executor spawn)
- **Task 1 (API client):** RED `2911fa97` → GREEN `dac3958c` (5 tests)
- **Task 2 (menu rename + confirmation):** RED `f4e1dc0d` → GREEN `7020e90d` (row+badge only) + GREEN `d3f1b99b` (panel handler + section + store + component + tests A5-A14)
- **Task 3 (wire message + backend publish + frontend consumer):** GREEN `30df5594` (wire-protocol + registry + orchestrator + AppShell + fleet-status-client + tests P115-06 A-F wire + 11-15 registry + archive-routing-1/2/3 orchestrator)

## Accomplishments

### Task 1 — archiveIdentity() API client (RED `2911fa97`, GREEN `dac3958c`)

**`src/ui/api/identity-archive-api.ts` (NEW):**
- `archiveIdentity(hostId: number, identityKey: string): Promise<{ ok: true }>` — POST /identities/${encodeURIComponent(identityKey)}/archive with body { hostId }, using authApi + handleApiError from `@/main-axios` (mirrors sibling identities-api.ts convention).
- One-shot POST — no batch, no un-archive companion (D-05 lock).

**Test coverage (5/5 green):**
1. Happy: `archiveIdentity(42, 'wren')` → POST /identities/wren/archive with body { hostId: 42 } → returns { ok: true }.
2. 400 → throws with 'archive identity' message prefix.
3. 404 → throws.
4. 500 → throws.
5. `archiveIdentity(1, 'wren name/x')` → URL is /identities/wren%20name%2Fx/archive (encodeURIComponent, not double-encoded).

### Task 2 — menu rename + confirmation prompt (RED `f4e1dc0d`, GREEN `7020e90d` + `d3f1b99b`)

**Row (`PrettyConversationRow.tsx`):**
- New `onArchive?: () => void` prop.
- Menu items IIFE (~L1350 area) gains a new entry gated on `onArchive !== undefined`:
  ```
  items.push({ label: "Archive", onClick: onArchive, danger: true });
  ```
- Preserves existing Pin/Unpin, (retired) Hide slot (still guarded on onToggleHide which panel no longer threads), Open-in-new-window, Kill.

**Identity badge (`IdentitySessionPane.tsx`):**
- New import: `archiveIdentity` from `@/api/identity-archive-api`.
- `identityBadgeContextMenuItems` useMemo (L147 area) gains an Archive entry gated on `shadowFleetId !== null && effectiveTmuxSession !== null`. The onClick handler body is spelled out inline (plan-check refinement #2 lock): resolves `displayName` via `identitiesByHostKey?.get(\`${hostIdNum}::${identityKey}\`) ?? identitiesByKey.get(identityKey)`, falls back to identityKey. window.confirm with the EXACT D-03 copy. onCloseTab?.(tabId) as the pane-close side effect. Fire-and-forget archiveIdentity(hostIdNum, identityKey).catch(console.warn).
- useMemo deps updated: added hostIdNum, identitiesByHostKey, identitiesByKey.
- Mobile branch unchanged (empty menu).

**Panel (`PrettyConversationsPanel.tsx`):**
- New `canonicalArchiveIdForRow(row)` helper (module-scoped near the retired canonicalHideIdForRow comment): returns null for `row.rdpHostRow === true`, `row.kind === "relay-room"`, or rows without `host + targetTmuxSession`; otherwise returns `fleetRowId(hostIdNum, row.targetTmuxSession)`.
- New `handleArchive(row)` panel-level handler: gate on canonicalArchiveIdForRow, resolve displayName (byHostKey → byKey → identityKey fallback), window.confirm with D-03 exact copy, on confirm=true call handleRowDeactivate(row) if row.id ∈ activeSet (D-04 side effect), then fire-and-forget archiveIdentity(hostIdNum, identityKey).catch(console.warn).
- Threads `onArchive={canonicalArchiveIdForRow(row) !== null ? () => handleArchive(row) : undefined}` at 3 render sites (search-flat, pinned, middle). RDP render site does NOT thread onArchive at all — explicit exclusion comment documents the affordance-narrowing gate.
- New imports: `Archive` and `ChevronDown` from `lucide-react` (already a dep); `archiveIdentity` from the new API module; `PrettyArchivedRow` component; `useArchivedFleetRows` hook.

**Row tests (`PrettyConversationRow.test.tsx`):**
- 4 new A1-A4 tests (all green):
  - A1: label 'Archive' (exact case) appears when onArchive provided.
  - A2: Archive menu item has danger styling (color #ff9a8a via jsdom-normalized rgb(...)).
  - A3: onArchive omitted → Archive item absent from menu.
  - A4: click Archive → onArchive fires exactly once.

**Panel tests (`PrettyConversationsPanel.test.tsx`):**
- Mock for `@/api/identity-archive-api` → archiveIdentitySpy (vi.fn returning `Promise<{ ok: true }>`).
- Mock for `useArchivedFleetRows` in the conversation-store mock — backed by `mockArchivedFleetRows` mutable fixture, defaulted to empty in beforeEach.
- 5 new A5-A9 tests for handleArchive:
  - A5: **EXACT-STRING equality assertion** — `expect(confirmSpy).toHaveBeenCalledWith("archive wren? this can't be undone.")` with fixture identity name 'wren'. Straight ASCII apostrophe, period, no backticks or quotes around name. Plan-check refinement #1 lock.
  - A6: confirm=false → archiveIdentity NOT called, onDeactivateRow NOT called (no pane close).
  - A7: confirm=true → archiveIdentity called exactly once with (42, "wren") — parseInt of hostId.
  - A8: identity not yet resolved in identities-store → displayName falls back to identityKey ('wren').
  - A9: RDP host row → 'Archive' menu item absent from menu (affordance-narrowing gate preserved).

### Task 3 — archived section render + PrettyArchivedRow + store slice + backend plumbing (`d3f1b99b` + `30df5594`)

**Frontend section render (`PrettyConversationsPanel.tsx`):**
- New state: `const [archivedExpanded, setArchivedExpanded] = useState(false);`
- New subscription: `const archivedRows = useArchivedFleetRows();`
- Section render block replaces the retired Hidden comment slot (~L1853 area):
  ```
  {archivedRows.length > 0 && (
    <div className="pv-panel-group pv-archived-section">
      <button
        type="button"
        onClick={() => setArchivedExpanded((v) => !v)}
        data-testid="pretty-conversations-archived-header"
        aria-expanded={archivedExpanded}
        aria-controls="pv-archived-section-content"
      >
        <Archive /> <span>Archived</span> <div gradient rule /> <ChevronDown />
      </button>
      {archivedExpanded && (
        <div id="pv-archived-section-content">
          {archivedRows.map((r) => (
            <PrettyArchivedRow
              key={`${r.hostId}::${r.name}`}
              name={r.name}
              hostname={r.hostname}
            />
          ))}
        </div>
      )}
    </div>
  )}
  ```
- **D-19 lazy invariant**: `{archivedExpanded && archivedRows.map(...)}` short-circuits when collapsed — rows are NOT in DOM until section expands. `.pv-archived-section` class allows CSS to style the section header/rows dimly if desired (styles are additive; no CSS added this plan).

**PrettyArchivedRow.tsx (NEW file, 48 lines):**
- Props: `{ name: string; hostname: string }`.
- Renders `<div className="pv-panel-row pv-archived-row px-4 py-2 opacity-60" data-testid="pretty-archived-row" data-archived-name={name} data-archived-hostname={hostname}>` containing the identity name + `(hostname)` parenthetical.
- **NO onContextMenu, NO onClick, NO onSelect, NO onKill, NO onPin, NO onArchive** — fully inert per D-06.
- Purely presentational — no hooks, no state, no effects.

**Store slice (`conversation-store.ts`):**
- New type: `export type ArchivedFleetRow = { hostId: number; name: string; hostname: string }`.
- New state field: `archivedFleetRows: ArchivedFleetRow[]` (empty on boot).
- `setArchivedFleetRows(rows)` — whole-array REPLACE with identity-equal no-op guard for churn defense.
- `upsertArchivedFleetRow(row)` — idempotent per (hostId, name) composite key: add if absent, replace if hostname changed, no-op if byte-identical.
- `useArchivedFleetRows()` hook — useSyncExternalStore-backed.

**Panel section tests (A10-A14, all green):**
- A10: archivedRows non-empty → section header renders with 'Archived' label.
- A11: **D-19 lazy invariant** — archivedExpanded=false → zero `[data-testid="pretty-archived-row"]` elements in DOM.
- A12: click header → section expands → PrettyArchivedRow instances render with correct data-archived-name / data-archived-hostname attributes.
- A13: **D-06 inert invariant** — right-click on PrettyArchivedRow does NOT open a role="menu" element (`screen.queryByRole("menu")` returns null).
- A14: archivedRows empty → section header NOT rendered (short-circuit at `.length > 0`).

**Backend wire (`wire-protocol.ts`):**
- New `FrontendIdentityArchivedFrameSchema` — z.object with `type: "identity-archived"`, `name`, `hostId`, `hostname` (all strings; hostId is string to match SessionState convention).
- Added to `FrontendOutboundFrame` discriminated union.
- New helper: `makeIdentityArchivedFrame(name, hostId, hostname)`.
- **FRAME_SCHEMA_VERSION held at 1** — additive union entry, older clients drop unknown frames silently at the `default` branch of ws.onmessage switch. Same T-41-03-05 mitigation invariant every prior additive extension has followed.

**Backend wire tests (`wire-protocol.test.ts`, 6 new P115-06 A-F, all green):**
- A: valid identity-archived frame parses.
- B: missing `name` field → reject.
- C: missing `hostId` field → reject.
- D: missing `hostname` field → reject.
- E: **regression guard** — SessionStateSchema does NOT bolt on an `archived` field (parses cleanly but the archived key is undefined in the parsed data — locks the D-06 separation invariant against future refactors that might try to fold archived onto the standard identity frame).
- F: discriminated-union routing self-check — identity-archived frame's `type` field is exactly `"identity-archived"`, distinct from snapshot/update/gone/pong.

**Backend registry (`subscription-registry.ts`):**
- New `publishIdentityArchived(name, hostId, hostname)` method on the SubscriptionRegistry interface.
- New `archivedIdentities: Map<string, {name, hostId, hostname}>` cache, keyed on `${hostId}::${name}` composite.
- Publish behavior: idempotent — if the map already has a byte-identical entry, no fanout. Otherwise map is updated and the frame fans out to every subscriber.
- **Snapshot-on-subscribe replay**: after delivering the initial makeSnapshotFrame, the subscribe path also replays every entry from archivedIdentities as an `identity-archived` frame so a reconnecting client re-hydrates its archivedFleetRows slice.
- No `publishIdentityUnarchived` — D-05 out of scope. The map only grows.

**Backend registry tests (`subscription-registry.test.ts`, 5 new tests 11-15, all green):**
- Test 11: publishIdentityArchived fans an identity-archived frame to subscribers.
- Test 12: idempotent — republishing the same (name, hostId, hostname) does NOT re-fan-out; only ONE frame in the receivedFrames buffer after 3 identical publishes.
- Test 13: late subscriber receives replay frames — 2 archived identities published BEFORE subscribe → late subscriber sees 2 archived frames as part of its initial state.
- Test 14: cross-host name collision — (wren, 42, thenasty) + (wren, 99, workstation) produce 2 distinct entries and 2 distinct frames.
- Test 15: hostname change → NOT idempotent — republishing (wren, 42) with a different hostname re-fans-out the frame.

**Backend orchestrator (`ssh-poll-orchestrator.ts`):**
- Source-B batch loop (~L1730): added a branch on `identityLine.archived === true` (strict-boolean check, not truthy — 115-05 SUMMARY threat note T-115-05-04). Archive-tree rows route to `deps.registry.publishIdentityArchived(identity, host.id, host.name)` and SKIP the standard compose path.
- Live-tree rows (archived==false or undefined) continue through `identityLineToPerIdentityFetched` + `composeAndPublishPerIdentity` unchanged.
- Legacy source-B path (`pollDormantOnlyIdentities`) unchanged — it only enumerates `~/fleet/identities/` (live tree) via a `find -mindepth 1` exec, never sees archive-tree identities. Archive-tree flow exists only on the batch path (via 115-05's unified walk in the sweep script).

**Backend orchestrator tests (`ssh-poll-orchestrator.test.ts`):**
- MockRegistry gains `publishIdentityArchived` + `publishedArchived: Array<{name, hostId, hostname}>` tracker.
- `makeSweepJsonl` helper accepts optional `archived` field on identity lines.
- 3 new tests (P115-06 archive-routing-1/2/3, all green):
  - archive-routing-1: identity line with `archived: true` → publishIdentityArchived (with correct name/hostId/hostname); NOT in publishedStates.
  - archive-routing-2: identity line with `archived: false` → publishSessionState (live-tree unchanged); NOT in publishedArchived.
  - archive-routing-3: identity line WITHOUT `archived` field (pre-115-05 host or legacy source-B) → publishSessionState (fail-open); NOT in publishedArchived.

**Frontend types mirror (`fleet-status-types.ts`):**
- `FrontendIdentityArchivedFrame` interface mirrors backend byte-for-byte.
- Added to `FrontendOutboundFrame` union.

**Frontend client (`fleet-status-client.ts`):**
- `FleetStatusClientOptions` gains `onIdentityArchived?: (name, hostId, hostname) => void`.
- `case "identity-archived"` in ws.onmessage discriminator dispatches to the callback + emits a structured `fleet_status_client_identity_archived` log line.

**AppShell (`AppShell.tsx`):**
- Imports `upsertArchivedFleetRow` from conversation-store.
- `onIdentityArchived: (name, hostIdRaw, hostname) => { const hostIdNum = parseInt(hostIdRaw, 10); if (!Number.isFinite(hostIdNum)) return; upsertArchivedFleetRow({ hostId: hostIdNum, name, hostname }); }` — one parseInt at the string→number boundary, defensive Number.isFinite guard.

## Task Commits

1. **Task 1 RED — API test** — `2911fa97` (`test`)
2. **Task 1 GREEN — API implementation** — `dac3958c` (`feat`)
3. **Task 2 RED — row tests A1-A4** — `f4e1dc0d` (`test`)
4. **Task 2 GREEN partial — row + badge menus** — `7020e90d` (`feat`)
5. **Task 2 GREEN full + Task 3 partial — panel handler + section + store + component + tests A5-A14** — `d3f1b99b` (`feat`)
6. **Task 3 backend + frontend wiring — wire message + registry + orchestrator + AppShell + client + tests** — `30df5594` (`feat`)

## Test-Case Pass/Fail Matrix

### `identity-archive-api.test.ts` (5/5 pass)

| # | Test | Result |
|---|------|--------|
| 1 | happy (POST /identities/wren/archive with body { hostId: 42 } → { ok: true }) | PASS |
| 2 | 400 → throws with 'archive identity' prefix | PASS |
| 3 | 404 → throws | PASS |
| 4 | 500 → throws | PASS |
| 5 | encodeURIComponent (`wren name/x` → `wren%20name%2Fx`) | PASS |

### `PrettyConversationRow.test.tsx` (97/97 pass — 4 new)

| # | Test | Result |
|---|------|--------|
| A1 | onArchive provided → menu contains 'Archive' entry (exact case) | PASS |
| A2 | Archive menu item has danger styling (color #ff9a8a) | PASS |
| A3 | onArchive omitted → Archive item absent | PASS |
| A4 | click Archive → onArchive fires exactly once | PASS |

### `PrettyConversationsPanel.test.tsx` (97/97 pass — 10 new)

| # | Test | Result |
|---|------|--------|
| A5 | click Archive → window.confirm called with EXACT 'archive wren? this can\'t be undone.' | PASS |
| A6 | confirm=false → no API call, no pane close | PASS |
| A7 | confirm=true → archiveIdentity(42, 'wren') fires exactly once | PASS |
| A8 | identity not yet resolved → displayName falls back to identityKey | PASS |
| A9 | RDP row → Archive item absent from menu | PASS |
| A10 | archivedRows non-empty → section header renders 'Archived' | PASS |
| A11 | D-19 lazy — collapsed section has zero PrettyArchivedRow instances in DOM | PASS |
| A12 | click header → expands → PrettyArchivedRow instances render | PASS |
| A13 | D-06 inert — right-click on archived row does NOT open menu | PASS |
| A14 | archivedRows empty → section header NOT rendered | PASS |

### `wire-protocol.test.ts` (59/59 pass — 6 new)

| # | Test | Result |
|---|------|--------|
| P115-06 A | valid identity-archived frame parses | PASS |
| P115-06 B | missing name → reject | PASS |
| P115-06 C | missing hostId → reject | PASS |
| P115-06 D | missing hostname → reject | PASS |
| P115-06 E | SessionStateSchema does NOT bolt on archived (D-06 separation guard) | PASS |
| P115-06 F | discriminated-union routing self-check | PASS |

### `subscription-registry.test.ts` (21/21 pass — 5 new)

| # | Test | Result |
|---|------|--------|
| 11 | publishIdentityArchived fans an identity-archived frame | PASS |
| 12 | idempotent — same (hostId, name, hostname) 3× → 1 frame | PASS |
| 13 | late subscriber receives replay frames | PASS |
| 14 | cross-host name collision → 2 distinct entries + 2 frames | PASS |
| 15 | hostname change → NOT idempotent → re-fanout | PASS |

### `ssh-poll-orchestrator.test.ts` (165/165 pass — 3 new)

| # | Test | Result |
|---|------|--------|
| P115-06 archive-routing-1 | archived:true → publishIdentityArchived, NOT publishSessionState | PASS |
| P115-06 archive-routing-2 | archived:false → publishSessionState (unchanged) | PASS |
| P115-06 archive-routing-3 | archived absent (pre-115-05) → publishSessionState (fail-open) | PASS |

### `fleet-status-client.test.ts` (26/26 pass — regression scope)

All 26 pre-existing tests pass with the new `identity-archived` switch case + optional `onIdentityArchived` callback. Additive-optional: existing tests don't pass the callback, and the case is a no-op when unset.

### Total: 470/470 pass across 7 touched test files

## Decisions Made

1. **Distinct wire message locked (Option A per plan `<action>` block).** The plan-check refinement #3 explicitly ruled the wire shape decision LOCKED to Option A: publish `{ kind:'identity-archived', name, hostId, hostname }` as a distinct frame in the discriminated union. Not bolting `archived: true` onto the standard identity frame. Rationale (a) D-06 rows are inert and never join the interactive session pool; a phantom boolean would be dead weight on every active identity, (b) frontend routing maps 1:1 onto a distinct store slice (archivedFleetRows) rather than filtering identity frames post-hoc, (c) future archive-only fields (archived-at, etc.) live on this frame without polluting the standard frame.

2. **Confirmation copy — EXACT-STRING equality, D-03 verbatim.** `archive <displayName>? this can't be undone.` — straight ASCII apostrophe (U+0027), period at end, no backticks or quotes around the displayName in the actual dialog string. Test A5 asserts exact equality via `expect(confirmSpy).toHaveBeenCalledWith("archive wren? this can't be undone.")` with fixture identity name 'wren'. Backticks in the CONTEXT.md around `<identity>` are MARKDOWN emphasis around the placeholder, not literal chars in the dialog.

3. **canonicalArchiveIdForRow(row) — verbatim rename of the deleted canonicalHideIdForRow (115-02 D-21).** Same logic: null for RDP synthetic rows, relay-room rows, and rows without host + targetTmuxSession. Otherwise returns `fleetRowId(hostIdNum, row.targetTmuxSession)`. Panel threads onArchive only when the gate returns non-null. Defense-in-depth: A9 test asserts RDP row does NOT show Archive in menu even without the panel-side gate (the row-side items[] builder still gates on onArchive prop being defined).

4. **Identity badge onClick body spelled out inline (plan-check refinement #2 lock).** Do NOT hand-wave 'match the composition'. Both entry points must be behavior-identical. The badge menu's onClick body inlines: `const displayName = resolved?.displayName ?? identityKey;`, `if (!window.confirm(\`archive ${displayName}? this can't be undone.\`)) return;`, `onCloseTab?.(tabId);`, `void archiveIdentity(hostIdNum, identityKey).catch(console.warn);`. Byte-identical copy is the test invariant across both entry points.

5. **Strict-boolean check `line.archived === true`, not truthy.** Per 115-05 SUMMARY threat note T-115-05-04. A stringly-typed malicious payload `archived: 'false'` (truthy string) MUST NOT route to the archived pool. Load-bearing defense inside the source-B loop.

6. **Idempotent registry publish + snapshot-on-subscribe replay.** publishIdentityArchived is a no-op if the (hostId, name) composite key already exists with byte-identical fields. Reconnecting client's subscribe() call replays every archivedIdentities entry as `identity-archived` frames after the initial makeSnapshotFrame. Same discipline as the existing SessionState snapshot delivery.

7. **PrettyArchivedRow is a NEW file, purely presentational, no context menu.** No onContextMenu attribute → right-click gets the browser's default context menu, not the PrettyConversationContextMenu. No onClick, onSelect, onKill, onPin, or onArchive props. data-testid + data-archived-name / data-archived-hostname attributes for test assertions.

8. **Archived-rows store slice is a NEW dedicated field.** `state.archivedFleetRows: ArchivedFleetRow[]` — NOT part of state.identities, state.fleetSessions, state.pinnedIds, or state.activeSet. Setter is a whole-array REPLACE; upsertArchivedFleetRow is idempotent per (hostId, name). Cross-host name collisions produce two rows per RESEARCH §5.

9. **Backend routing at source-B batch loop only.** Legacy `pollDormantOnlyIdentities` unchanged — it only enumerates `~/fleet/identities/` (live tree). Archive-tree flow exists only on the batch path via 115-05's unified walk. This is intentional — the batch path is the deployed reality on all managed hosts once the sweep script + orchestrator update ships.

10. **lucide-react is already a dependency.** No new package install. Verified `grep -c "lucide-react" package.json` returns 1 (existing entry); the panel imports `Archive` and `ChevronDown` from it alongside existing icons.

## Deviations from Plan

- **[Rule 2 — Correctness / defense-in-depth] Added `Number.isFinite(hostIdNum)` guard inside canonicalArchiveIdForRow.** The plan's helper spec did NOT explicitly require the numeric-hostId guard; the deleted canonicalHideIdForRow also lacked it (per grep). But hosts with non-numeric ids (test fixtures, malformed backend fanout) would produce `fleetRowId(NaN, session)` = `fleet::NaN::session` — a functional string but not a legitimate archive target. Added the guard to fail-closed on non-numeric hostIds, matching the same discipline the panel's handleTogglePin uses at L1305. Documented inline.

- **[Rule 3 — Blocking issue] MockRegistry in ssh-poll-orchestrator.test.ts required `publishIdentityArchived` method to satisfy the extended `SubscriptionRegistry` interface.** TypeScript's strict interface conformance failed without it. Added the method + `publishedArchived: Array<{name, hostId, hostname}>` tracker so batch-path tests can assert archive routing. No behavior change to existing tests (backwards-compatible addition).

- **[Rule 3 — Blocking issue] `makeSweepJsonl` helper needed to accept an optional `archived` field on identity lines** so the new archive-routing tests could produce archive-tree fixtures. Added a conditional spread `...(raw.archived !== undefined ? { archived: raw.archived } : {})` matching the existing pattern for identity_cosmetics / role_cosmetics / role / pinned. No behavior change to existing tests (undefined = live-tree, matching pre-115-05 host simulation).

- **[Rule 3 — Blocking issue] PrettyConversationsPanel.test.tsx needed a new `useArchivedFleetRows` mock entry + a `mockArchivedFleetRows` fixture.** Without them, EVERY panel test's `useArchivedFleetRows()` call would return undefined → `.length` on undefined → test crash. Backed by a mutable `let mockArchivedFleetRows: readonly ArchivedFleetRow[] = []` that's reset in beforeEach to preserve existing test behavior (empty archived-rows array → section absent → no change to any test's assertions).

- **[Scope-choice] Task 2 landed as TWO commits — row+badge together as `7020e90d`, panel handler + section + store + component + tests as `d3f1b99b` — rather than one atomic commit per task.** Rationale: the row + badge changes are self-contained (Row tests A1-A4 pass against just those changes) and represent a distinct logical slice. Splitting them from the panel/section changes makes bisect-friendly commits without violating atomicity — each commit is complete on its own. Commit granularity is a subjective call; the plan's `<verify>` gate is a scoped-vitest run which is green after either commit.

None of the deviations required Rule 4 (architectural) escalation. All rules 1-3 applied automatically per the executor's deviation-rule discipline.

## Issues Encountered

- **Panel tests initially failed with "Unable to find menuitem name 'Archive'" (3 fails).** RCA: the test fixture's `makeHost("h1", "hostA")` used a non-numeric hostId (`"h1"`) which fails `Number.isFinite(parseInt("h1", 10))`. canonicalArchiveIdForRow returned null → panel didn't thread onArchive → row's items[] builder didn't render Archive item. Fix: swapped fixture to `makeHost("1", "hostA")` in A5-A8. Documented inline: "Use a numeric-string hostId — canonicalArchiveIdForRow parses via parseInt". Non-numeric hostIds silently drop the Archive affordance — same discipline as handleTogglePin's fleetRowId construction guard.

- **Initial panel test run after adding archived-section render failed all 87 pre-existing tests with `useArchivedFleetRows is undefined`.** RCA: the panel's new `useArchivedFleetRows()` call in the render body hit the mock's return value (undefined) since the mock hadn't yet been extended. Fix: added `useArchivedFleetRows: () => mockArchivedFleetRows` to the conversation-store mock + `mockArchivedFleetRows = []` in beforeEach reset. All 87 pre-existing tests then passed unchanged (empty array → section absent → no assertion change).

## `<output>` requirements

Per the plan's `<output>` section:

- **Archived-rows wire shape chosen:** Option A LOCKED — distinct wire message `{ kind: "identity-archived", name, hostId, hostname }`. NOT bolted onto standard identity frame as `archived: true`. Matches plan-check refinement #3 lock and 115-05 SUMMARY's docblock note about the intended 115-06 separation.
- **Confirmation-copy string as it lands in code (verbatim):** `archive ${displayName}? this can't be undone.` — straight ASCII apostrophe, period at end, no backticks/quotes around the displayName. Test A5 asserts EXACT-STRING equality via `expect(confirmSpy).toHaveBeenCalledWith("archive wren? this can't be undone.")` with fixture 'wren'.
- **lucide-react import check:** EXISTING dependency (`grep -c "lucide-react" package.json` = 1). Panel imports `Archive` + `ChevronDown` alongside pre-existing icons (Drama, Globe, Loader2, Monitor, MoreVertical, Search, SquarePen, X). No package legitimacy audit needed — the package is already installed.
- **RESEARCH.md-cited line numbers that drifted:** The plan's `<read_first>` block cited PrettyConversationRow.tsx L1336-1421 (menu items IIFE) and IdentitySessionPane.tsx L154-222 (identityBadgeContextMenuItems useMemo). Both matched at edit time — no drift. Panel's L748 hiddenExpanded slot cited by the plan matched at L720 area post-115-02 comment retirement — trivial drift, anchored via grep for "prior hiddenExpanded state retired". PrettyConversationsPanel.tsx L1848/L1881/L1911/L2021 cited for render sites approximated post-115-02 — actual locations after the panel changes are L1728/L1759/L1785/L1837, anchored via grep for "PrettyConversationRowLive".
- **Manual smoke result:** NOT PERFORMED — vitest gate only. The plan's `<done>` for Task 3 explicitly marks manual smoke as optional; the 10 new panel tests (A5-A14) + 4 row tests (A1-A4) + 6 wire tests (P115-06 A-F) + 5 registry tests (11-15) + 3 orchestrator tests (P115-06 archive-routing-1/2/3) + 5 API tests are the enforcement gate. Deploy motion (orchestrator scope) will drive the manual smoke path via the fleet-status ws frame + backend endpoint + supervisor sentinel scan.

## Metrics detail

- **Frontend tsc:** `npx tsc --noEmit` → 0 errors.
- **Backend tsc:** `npx tsc --noEmit -p tsconfig.node.json` → 0 errors.
- **Line delta:** +32/-0 identity-archive-api.ts (new); +114/-0 identity-archive-api.test.ts (new); +32/-0 PrettyConversationRow.tsx; +120/-0 PrettyConversationRow.test.tsx; +165/-8 PrettyConversationsPanel.tsx; +380/-2 PrettyConversationsPanel.test.tsx; +63/-1 IdentitySessionPane.tsx; +96/-2 conversation-store.ts; +15/-1 AppShell.tsx; +22/-2 fleet-status-client.ts; +15/-4 fleet-status-types.ts; +56/-2 wire-protocol.ts; +108/-0 wire-protocol.test.ts; +55/-1 subscription-registry.ts; +95/-0 subscription-registry.test.ts; +22/-1 ssh-poll-orchestrator.ts; +128/-0 ssh-poll-orchestrator.test.ts; +48/-0 PrettyArchivedRow.tsx (new). Total: ~+1666 / -22.

## Grep sweep results

```
$ grep -F 'label: "Archive"' src/ui/features/pretty-conversations/PrettyConversationRow.tsx | wc -l
1
$ grep -F 'label: "Archive"' src/ui/shell/IdentitySessionPane.tsx | wc -l
1
$ grep -F "danger: true" src/ui/features/pretty-conversations/PrettyConversationRow.tsx | wc -l
2   # Archive + Kill
$ grep -Fc "archived: true" src/backend/fleet-status/wire-protocol.ts
0   # standard identity frame has no archived field (D-06 separation invariant)
$ grep -Ec "useArchivedFleetRows|archivedFleetRows" src/ui/state/conversation-store.ts
10
$ grep -F "canonicalArchiveIdForRow" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx | wc -l
8   # 1 helper decl + 1 handleArchive gate + 3 render-site conditional threads + 1 test file (not counted here)
$ grep -F "archivedExpanded && archivedRows" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx | wc -l
1   # D-19 lazy invariant literal
$ grep -Fc '.hidden' src/ui/features/pretty-conversations/PrettyConversationRow.tsx src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx src/ui/shell/IdentitySessionPane.tsx src/ui/features/pretty-conversations/PrettyArchivedRow.tsx src/ui/state/conversation-store.ts src/backend/fleet-status/wire-protocol.ts src/backend/fleet-status/ssh-poll-orchestrator.ts src/backend/fleet-status/subscription-registry.ts src/ui/api/identity-archive-api.ts
# 7 matches — ALL retirement-note comments referencing 115-02's D-21 for lineage; no code path re-introduces .hidden
```

## Threat Flags

Nothing new surfaced beyond the plan's `<threat_model>`. All six registered threats are addressed or accepted per the register:

- **T-115-06-01** (EoP — JS bypass of window.confirm): accepted. Confirmation is UX-only, not security. Compensating control: canonicalArchiveIdForRow's affordance-narrowing gate limits which rows can even offer the archive click, and the backend (115-03) enforces JWT auth + resolveHostById ownership.
- **T-115-06-02** (DoS — rapid clicking): mitigated. Backend endpoint is idempotent (sentinel-scan is idempotent; retire on already-archived-tree folder is a no-op). Frontend fire-and-forget doesn't queue; each click drops one POST. Not a real DoS surface.
- **T-115-06-03** (Tampering — malicious archived-flag sweep frame): mitigated. Strict-boolean check `line.archived === true` (not truthy) defends against stringly-typed malicious payloads per 115-05 SUMMARY threat note T-115-05-04.
- **T-115-06-04** (Info disclosure — archived section visible to all users): accepted. Same one-user-sees-all-identities model as pinned/live sections.
- **T-115-06-05** (Repudiation): accepted. Backend logs userId+hostId+key on the POST (115-03 SUMMARY).
- **T-115-06-SC** (Supply chain — lucide-react): existing dependency. `grep -c "lucide-react" package.json` returns 1. No new install; no Package Legitimacy Gate protocol needed.

## Self-Check: PASSED

**File existence:**
- `src/ui/api/identity-archive-api.ts` — FOUND
- `src/ui/api/identity-archive-api.test.ts` — FOUND
- `src/ui/features/pretty-conversations/PrettyArchivedRow.tsx` — FOUND
- `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` — FOUND (modified)
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — FOUND (modified)
- `src/ui/shell/IdentitySessionPane.tsx` — FOUND (modified)
- `src/ui/state/conversation-store.ts` — FOUND (modified)
- `src/ui/AppShell.tsx` — FOUND (modified)
- `src/ui/api/fleet-status-client.ts` — FOUND (modified)
- `src/ui/api/fleet-status-types.ts` — FOUND (modified)
- `src/backend/fleet-status/wire-protocol.ts` — FOUND (modified)
- `src/backend/fleet-status/subscription-registry.ts` — FOUND (modified)
- `src/backend/fleet-status/ssh-poll-orchestrator.ts` — FOUND (modified)

**Commit existence:**
- `2911fa97` — `test(115-06): add failing test for archiveIdentity API client` — PRESENT
- `dac3958c` — `feat(115-06): add archiveIdentity() API client — POST /identities/:key/archive` — PRESENT
- `f4e1dc0d` — `test(115-06): add failing tests A1-A4 for Archive row-menu item` — PRESENT
- `7020e90d` — `feat(115-06): wire Archive menu item into row + identity-badge menus` — PRESENT
- `d3f1b99b` — `feat(115-06): panel handleArchive + PrettyArchivedRow + archived-rows store slice` — PRESENT
- `30df5594` — `feat(115-06): distinct identity-archived wire message + backend publish + frontend consumer` — PRESENT

**Done-criteria greps (from plan `<done>` blocks):**
- Task 1: `grep -c "archive" src/ui/api/identity-archive-api.ts` → 6 (≥3). PASS.
- Task 1: no un-archive helper exported (grep -F "unarchive" identity-archive-api.ts → 0 matches). PASS.
- Task 2: `grep -F 'label: "Archive"' src/ui/features/pretty-conversations/PrettyConversationRow.tsx | wc -l` → 1 (≥1). PASS.
- Task 2: `grep -F 'label: "Archive"' src/ui/shell/IdentitySessionPane.tsx | wc -l` → 1 (≥1). PASS.
- Task 2: `grep -F "danger: true" src/ui/features/pretty-conversations/PrettyConversationRow.tsx | wc -l` → 2 (Archive + Kill). PASS.
- Task 2: `grep -F "canonicalArchiveIdForRow" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx | wc -l` → 8 (≥3 uses beyond definition). PASS.
- Task 3: PrettyArchivedRow.tsx purely presentational — grep for `onContextMenu\|onClick\|onSelect` → 0 matches inside the file (only test-side `fireEvent.contextMenu` references exist). PASS.
- Task 3: `grep -F "archivedExpanded && archivedRows.map" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx | wc -l` → 1 (D-19 lazy invariant literal). PASS.
- Task 3: `grep -F '"Archived"' src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx | wc -l` → 1 (section label). PASS.
- Task 3: `grep -Ec "useArchivedFleetRows|archivedFleetRows" src/ui/state/conversation-store.ts` → 10 (≥2). PASS.

**Verify commands (from plan `<verify>` blocks):**
- Task 1: `npx vitest run src/ui/api/identity-archive-api.test.ts` → 5/5 pass. PASS.
- Task 2: `npx vitest run src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` → 194/194 pass (97+97). PASS.
- Task 3: `npx vitest run src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx src/backend/fleet-status/subscription-registry.test.ts src/backend/fleet-status/wire-protocol.test.ts src/backend/fleet-status/ssh-poll-orchestrator.test.ts` → all four pass (97 + 21 + 59 + 165 = 342). PASS.
- `npx tsc --noEmit` (frontend) → 0 errors. PASS.
- `npx tsc --noEmit -p tsconfig.node.json` (backend) → 0 errors. PASS.

**TDD gate compliance:**
- Task 1 gate sequence: test(2911fa97) → feat(dac3958c). PASS.
- Task 2 gate sequence: test(f4e1dc0d) → feat(7020e90d) → feat(d3f1b99b). PASS.
- Task 3 (not TDD-flagged in plan, but implicit RED/GREEN via the wire+registry+orchestrator test additions in the single GREEN commit `30df5594`). Test file additions are alongside implementation additions in the same commit — acceptable per prior 115 executor precedent (115-03 SUMMARY Decision 7 established this norm).
- Fail-fast rule: Task 1 RED confirmed failure (5 tests fail with module-not-found before source lands). Task 2 RED confirmed failure (3 of 4 tests fail — A3 passes trivially because "menu item absent" is the pre-source state). No unexpected passes in RED phase.

## Next Plan Readiness

- **115-07 (end-to-end retire test extension, Wave 4):** Ready. The frontend archive gesture now closes the loop click → confirm → POST → sentinel drop → supervisor tick → retire → sweep re-observation → archived-section row via the distinct wire message. E2E test can drive a real click through PrettyConversationRow's context menu, observe the POST hits the backend endpoint (via a real or mocked SSH channel), and assert the retire flow completes end-to-end.
- **HEAD `30df5594` LOCAL** — NOT pushed / NOT built / NOT deployed. Held at push boundary per fleet's greenlight-at-push rule. Orchestrator picks up ship motion on user greenlight.

---

## Post-code-review cleanup pass (2026-09-17, five atomic commits)

Applied a 5-fix cleanup pass surfaced by the unbiased Phase 115 code review (44 files, no HIGH-severity blockers). All non-behavioral: two MED (dead type field, missing collision defense) and three LOW (dead branch removal, orphan-file delete, redundant middleware). Each landed as its own atomic commit on `feat/tab-title-from-tmux`, no rework of Phase 115 core logic:

- **Fix 1** `1a56d92c` — remove dead `hidden: boolean` field from `IdentityAppearance` in `src/ui/api/fleet-status-types.ts` (leftover from Phase 107; backend schema no longer emits it, so TS said `boolean` while runtime was silently `undefined`); updated docblock enumerating appearance fields.
- **Fix 2** `90d6774e` — add State-3 collision defense to `substrate/scripts/fleet-status-sweep.py`'s `_enumerate_identities`: `seen_names: set[str]` accumulator across both tree walks, live-tree-wins semantics, structured `identity_name_collision` warning log via existing `_log()` helper. Extended `fleet-status-sweep.test.sh` with case 7 asserting single emission + warning; all 7 tests green.
- **Fix 3** `9f9ded03` — remove dead Hide/Unhide branch from `PrettyConversationRow.tsx` (dropped `hidden` and `onToggleHide` props + their interface fields, the `if (onToggleHide)` menu-items push, and a residual `hidden && "hidden"` className toggle in `rowClassName`); updated one doc-comment in the row test file. 105 row tests + 111 panel/context-menu tests green.
- **Fix 4** `d9ed8c99` — delete orphan `src/ui/features/pretty-conversations/HideAction.tsx` (no imports anywhere; only doc-comment mentions in siblings, retained as intentional historical breadcrumbs).
- **Fix 5** `a7fa8306` — remove redundant `express.json()` middleware from the `POST /identities/:key/archive` route in `src/backend/database/routes/identity-archive.ts` (app-level `bodyParser.json({limit:"1gb"})` at `database.ts:312` already runs first, making the route-level parser a no-op). All 8 identity-archive tests still pass.

Verification after the full pass: `npx tsc --noEmit -p tsconfig.node.json` clean; `npx tsc --noEmit -p tsconfig.app.json` error count unchanged from pre-fix baseline (568, all pre-existing, none in the touched files); `bash substrate/scripts/tests/fleet-status-sweep.test.sh` 7/7 pass. HEAD `a7fa8306` LOCAL — NOT pushed / NOT built / NOT deployed.

---
*Phase: 115-identity-archiving-from-the-frontend*
*Completed: 2026-09-17*

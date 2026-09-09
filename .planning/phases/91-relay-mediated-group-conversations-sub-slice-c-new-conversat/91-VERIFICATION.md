---
phase: 91-relay-mediated-group-conversations-sub-slice-c-new-conversat
verified: 2026-09-09T12:15:00Z
status: human_needed
score: 12/12 locked decisions verified (code-level)
overrides_applied: 0
human_verification:
  - test: "Open the Skynet PWA on a mobile device (iPhone or Android). Tap the three-dot menu at the top of the conversation list. Verify 'New conversation' appears. Tap it. Verify the modal fills the screen (mobile-first layout, inset-4). Pick one human and one agent, enter a room name, tap Create."
    expected: "Modal occupies the screen, not a tiny centered dialog. Chips appear on selection. Create becomes enabled only after name + valid participants. Room appears in sidebar. Pane opens."
    why_human: "CSS media-query breakpoints (absolute inset-4 vs md:max-w-[560px]) cannot be triggered in jsdom tests. Mobile layout is asserted structurally (Test 18 in modal tests) but visual/interactive correctness requires a real device."
  - test: "Open Skynet on desktop (viewport >= 768px). Open the three-dot menu, launch 'New conversation'. Verify the dialog is centered at ~560px width, not full-screen."
    expected: "Dialog appears centered at 560px max-width, not an edge-to-edge fill. X and Esc close it. Clicking outside does not close it."
    why_human: "Same CSS breakpoint limitation as mobile — jsdom cannot evaluate the md: Tailwind prefix. Desktop centering requires a real browser viewport."
  - test: "On a deployed instance: create a room with one human and one agent. Observe the sidebar immediately after Create completes (without a page reload)."
    expected: "The new room appears in the sidebar conversation list within a second or two (W5 explicit fleet refresh via getSessionList()), and the pane opens automatically."
    why_human: "End-to-end materialization involves the live relay backend (Matrix room creation, inviteToRoom, materializeRelayRoomSession, /sessions/list refresh). Cannot simulate without a deployed relay instance and real user mxids."
---

# Phase 91: New-Conversation Modal + Create-Room Flow — Verification Report

**Phase Goal:** Land a "New conversation" modal (variant D — sectioned single list + search) accessible from the three-dot menu at the top of the conversation list, with create-room-and-invite backend wiring and sidebar materialization.
**Verified:** 2026-09-09T12:15:00Z
**Status:** human_needed (all 12 code-level decisions verified; 3 UAT checkpoints deferred per arc-hold)
**Re-verification:** No — initial verification.

---

## Goal Achievement

### Observable Truths (12 Locked Decisions)

| # | Decision | Status | Evidence |
|---|----------|--------|----------|
| 1 | Modal design = variant D (sectioned single list: Humans + Agents section headers, type-to-filter search) — NOT tabs, NOT wizard | VERIFIED | `ParticipantList.tsx` renders two `SectionHeader` divs ("Humans", "Agents") with toggle rows; `ParticipantSearchInput.tsx` wired into `useNewConversationForm.searchQuery`; `NewConversationModal.tsx` composes them in a single column layout |
| 2 | Icon placement = three-dot menu at top of conversation list | VERIFIED | `PrettyConversationsPanel.tsx:2101` adds `{ label: "New conversation", onClick: () => setNewConversationModalOpen(true) }` to the existing `MoreVertical` menu array at position 0 (before Phase 44 Pitfall 8 locked items) |
| 3 | Mandatory room name | VERIFIED | `useNewConversationForm.ts:117` gate returns `{ ok: false, reason: 'no-room-name' }` when `roomName.trim() === ""`; backend `relay-room-create.ts:232` also enforces independently (400 `room_name_required`); Test 3 (gate) + Test 5 (flow) confirm |
| 4 | No rename in v1 | VERIFIED | No rename endpoint exists in any relay-room backend route. No rename affordance in `NewConversationModal.tsx`. Scope explicitly marked "Out" in CONTEXT.md |
| 5 | Zero-participant rooms disallowed — Create disabled + hint | VERIFIED | Gate reason `no-participants` at `useNewConversationForm.ts:121`; `NewConversationModal.tsx:349` disables button when `!form.gate.ok`; hint text "Pick at least one participant" rendered below button; backend also enforces (400 `no_participants`); flow test Test 4 confirms |
| 6 | Single-agent-only disallowed — Create disabled + hint | VERIFIED | Gate reason `single-agent-only` at `useNewConversationForm.ts:123-125` (exactly one picked AND role === 'agent'); backend enforces at `relay-room-create.ts:277`; hint "A single-agent conversation already exists in your list"; flow test Test 3 confirms |
| 7 | Participants sourced from existing humans (getUsersListBasic) + existing agents (useIdentities) only — no agent creation path | VERIFIED | `NewConversationModal.tsx:38-39` imports only `getUsersListBasic` and `useIdentities`; T-91-FE-02 grep-gate test (Test 17) asserts no other user-listing import; no "create agent" link or path in modal |
| 8 | Agents auto-join room invites via receivers (invite fan-out only, no acceptance ceremony) | VERIFIED | `relay-room-create.ts:323-339` loops `inviteToRoom(roomId, mxid, viewerMxid)` over all participants including agents; no "wake agent" or "prompt agent to accept" code present; auto-join is a relay-infrastructure concern (pre-existing receiver processes per master shape §Prior context) |
| 9 | Humans auto-join via observation loop (Slice B integration) | VERIFIED | `relay-room-create.ts:341-363` calls `materializeRelayRoomSession(userId, roomId, trimmed)` — the D-14 schema-as-coordinator fast path; the Slice B observation loop at Phase 89-03 is the documented safety net; AppShell wiring also triggers explicit `/sessions/list` refresh (W5 fleet refresh at `AppShell.tsx:2215-2226`) |
| 10 | Post-confirm sequence: create room via user's relay identity → invite participants → materialize session → sidebar entry → pane opens | VERIFIED | Route uses `createRoomAsUser(viewerMxid, ...)` (viewer is PL100 creator, not admin); invite loop at steps 10-11; `materializeRelayRoomSession` at step 11; `AppShell.tsx:2193-2201` calls `openTab(null, "terminal", undefined, { sessionKind: "relay-room", relayRoomId, relayRoomTitle })` + `selectConversationDeferred(newTabId)` on `onCreateRelayRoom` callback |
| 11 | Mobile + desktop parity — both surfaces validated in test | VERIFIED (code-level) | Test 18 in `NewConversationModal.test.tsx:596-609` asserts `"absolute inset-4"` AND `"md:max-w-[560px]"` in DialogContent className; CSS-only breakpoint, no dual component tree. Live-device parity deferred to human UAT (arc-hold in effect) |
| 12 | Threat model T-91-BE-01..04 + T-91-FE-01..02 mitigations present with tests | VERIFIED | See Threat Model section below |

**Score:** 12/12 decisions verified at code level. 3 human UAT items pending (arc-hold — no deployed environment yet).

---

### Deferred Items

No items deferred to later phases. Wave 6 UAT (Plan 07) is intentionally held per the arc-wide ship-hold (sub-slices C, D, E deploy together). This is expected, not a gap.

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/ui/features/pretty-conversations/NewConversationModal.tsx` | Modal shell with data sourcing, submit, debounce | VERIFIED | 375 lines; Radix DialogPrimitive; `useNewConversationForm` hook; `getUsersListBasic` + `useIdentities` data sourcing; `submitInFlightRef` debounce; gate-driven Create button |
| `src/ui/features/pretty-conversations/NewConversationModal.test.tsx` | 18 unit tests for modal | VERIFIED | 18 tests pass (confirmed via vitest run); includes Tests 7 (debounce), 17 (T-91-FE-02 grep-gate), 18 (mobile/desktop CSS) |
| `src/ui/features/pretty-conversations/NewConversationModal.flow.test.tsx` | 8 end-to-end flow tests | VERIFIED | 8 tests pass; drives full PrettyConversationsPanel → menu → modal → form → API → callback chain |
| `src/ui/features/pretty-conversations/participant-types.ts` | Shared types (PickedParticipant, GateState, CreateRelayRoomRequest/Response) | VERIFIED | Exports all four types; zero backend imports |
| `src/ui/features/pretty-conversations/useNewConversationForm.ts` | Form-state hook (picked set, search, gate, submitting, error) | VERIFIED | Gate logic confirmed in code (4 negative reasons + `ok: true`); self-exclude, case-insensitive filter, alphabetical sort all present |
| `src/ui/features/pretty-conversations/useNewConversationForm.test.ts` | Hook unit tests | VERIFIED | Tests pass (confirmed in overall suite run) |
| `src/ui/features/pretty-conversations/ParticipantList.tsx` | Sectioned list with avatar discs, hue-tinting, check circles, N-of-M counts | VERIFIED | Two section headers; `--pv-hue` CSS custom property emission; check circle (emerald when selected); `SectionHeader` shows `(N of M)` when `filterActive` |
| `src/ui/features/pretty-conversations/ParticipantList.test.tsx` | List tests (11 tests) | VERIFIED | 11 tests pass |
| `src/ui/features/pretty-conversations/ParticipantChip.tsx` | Individual chip with swatch + name + X remove | VERIFIED | Color swatch (`hsl(${hue ?? 210}, 8%, 50%)` fallback); X remove via `onRemove(participant.mxid)` |
| `src/ui/features/pretty-conversations/ParticipantChipStrip.tsx` | Chip strip with empty-state placeholder | VERIFIED | Renders placeholder text when `picked.length === 0`; ARIA list when populated |
| `src/ui/features/pretty-conversations/ParticipantSearchInput.tsx` | Search input with clear button | VERIFIED | `pv-search-*` CSS classes; clear button appears when value non-empty |
| `src/ui/features/pretty-conversations/ParticipantSubComponents.test.tsx` | Sub-component tests (8 tests) | VERIFIED | 8 tests pass |
| `src/ui/api/relay-room-create-api.ts` | Frontend API client for POST /relay-room/create | VERIFIED | `authApi.post("/relay-room/create", req)` via authenticated axios; `handleApiError` on failure; types imported from `participant-types.ts` |
| `src/backend/database/routes/relay-room-create.ts` | Backend route (auth, validation, Matrix create, invite, materialize) | VERIFIED | 402 lines; all 15 test behaviors covered and passing |
| `src/backend/database/routes/relay-room-create.test.ts` | Backend route tests (15 tests) | VERIFIED | All 15 pass (confirmed via live vitest run) |
| `src/backend/matrix/matrix-admin-client.ts` (extended) | `inviteToRoom` + `createRoomAsUser` primitives | VERIFIED | `inviteToRoom` at L1345 follows all 6 per-primitive invariants; `createRoomAsUser` at L1421 mints per-user token via `loginAsUser(senderMxid)`; `encodeURIComponent(roomId)` on URL path; AbortController + 30s timeout; discriminated return |
| `src/backend/database/database.ts` (modified) | Route mount for `/relay-room/create` | VERIFIED | `import relayRoomCreateRoutes from "./routes/relay-room-create.js"` at L75; `app.use("/relay-room", relayRoomCreateRoutes)` at L1943 |
| `src/backend/database/routes/user-admin-routes.ts` (modified) | Widened `/users/list-basic` SELECT with mxid | VERIFIED | `mxid: users.mxid` in SELECT list at L121-124; JSDoc updated |
| `src/backend/database/routes/users-list-basic.test.ts` (modified) | 7 tests including mxid coverage | VERIFIED | Tests 6 + 7 confirm mxid present and null-preserved |
| `src/ui/api/user-management-api.ts` (modified) | BasicUser.mxid: string | null | VERIFIED | Field at L41 confirmed |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (modified) | "New conversation" menu item + modal mount + onCreateRelayRoom prop | VERIFIED | Item at L2101 (position 0); modal mount at L2064-2073; `newConversationModalOpen` state at L603; prop declared at L395 |
| `src/ui/AppShell.tsx` (modified) | onCreateRelayRoom → openTab + selectConversationDeferred + W5 fleet refresh | VERIFIED | Handler at L2179-2227; opens relay-room tab; triggers `getSessionList()` refresh |
| `src/ui/AppShell.new-conversation.test.tsx` (created) | Structural wiring tests for AppShell (12 tests) | VERIFIED | 12 tests pass (confirmed in Plan 05 suite run: 330 total passing) |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `NewConversationModal.tsx` | `getUsersListBasic()` | import + useEffect on open | WIRED | Fetch on modal open; null-mxid users filtered before shaping into `PickedParticipant` |
| `NewConversationModal.tsx` | `useIdentities()` | import + useMemo | WIRED | Agents derived as `@${identityKey.toLowerCase()}:${serverName}` |
| `NewConversationModal.tsx` | `createRelayRoom()` | import + handleSubmit | WIRED | Called on submit with `{ roomName, humanMxids, agentMxids }` |
| `NewConversationModal.tsx` | `useNewConversationForm` | import + destructure | WIRED | All form state threaded through hook |
| `PrettyConversationsPanel.tsx` | `NewConversationModal` | import + JSX mount + state | WIRED | `open={newConversationModalOpen}` controlled; `onCreated` callback fires `onCreateRelayRoom?.(result)` |
| `PrettyConversationsPanel.tsx` | `onCreateRelayRoom` prop | menu item → `setNewConversationModalOpen(true)` → modal → callback | WIRED | Full chain confirmed in flow test |
| `AppShell.tsx` | `openTab` + `selectConversationDeferred` | `onCreateRelayRoom` callback | WIRED | `openTab(null, "terminal", undefined, { sessionKind: "relay-room", ... })` followed by `selectConversationDeferred(newTabId)` |
| `AppShell.tsx` | fleet refresh | `getSessionList().then(updateFleetSessions)` | WIRED | W5 explicit refresh on successful create |
| `relay-room-create.ts` | `createRoomAsUser` | import + Step 9 | WIRED | Room creation uses viewer's own token |
| `relay-room-create.ts` | `inviteToRoom` | import + Step 10 invite loop | WIRED | Best-effort fan-out; per-invite failure logged, not fatal |
| `relay-room-create.ts` | `materializeRelayRoomSession` | import + Step 11 | WIRED | D-14 fast path; forceSave handled internally by store |
| `database.ts` | `relay-room-create` router | `app.use("/relay-room", relayRoomCreateRoutes)` | WIRED | L1943; adjacent to participants routes mount |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `NewConversationModal.tsx` | `humans` (PickedParticipant[]) | `getUsersListBasic()` → `/users/list-basic` → `db.select({ id, username, mxid })` | Yes — real DB query with mxid widening from Plan 00 | FLOWING |
| `NewConversationModal.tsx` | `agents` (PickedParticipant[]) | `useIdentities()` → `identities-store.ts` (fleet-local store) | Yes — live identity store data | FLOWING |
| `NewConversationModal.tsx` | `viewingUserMxid` | `useViewingUserMxid()` → `viewing-user-store.ts` | Yes — JWT-derived viewer identity | FLOWING |
| `relay-room-create.ts` | `viewerMxid` | JWT `userId` → `lookupViewingUserMxid()` → `db.select(users.mxid)` | Yes — real DB lookup | FLOWING |
| `relay-room-create.ts` | `humanMxids` (post-filter) | `loadFleetMxidRegistry()` → `db.$client.prepare(SELECT mxid FROM users)` | Yes — real DB set membership check | FLOWING |
| `relay-room-create.ts` | `roomId` | `createRoomAsUser(viewerMxid, ...)` → Matrix `/_matrix/client/v3/createRoom` | Yes — real Matrix API call | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Backend: 15 route tests (auth, validation, STRIDE mitigations, happy path) | `npx vitest run src/backend/database/routes/relay-room-create.test.ts` | 15 passed in 820ms | PASS |
| Frontend: 34 modal/flow tests | `npx vitest run NewConversationModal.test.tsx useNewConversationForm.test.ts NewConversationModal.flow.test.tsx` | 34 passed in 6.0s | PASS |
| Sub-components: 19 tests | `npx vitest run ParticipantList.test.tsx ParticipantSubComponents.test.tsx` | 19 passed in 1.9s | PASS |
| Foundation: 7 users-list-basic tests | `npx vitest run users-list-basic.test.ts` | 7 passed in 573ms | PASS |
| TypeScript clean | `npx tsc --noEmit` | No output (clean) | PASS |

---

### Probe Execution

No probe scripts declared for this phase. Phase 91 is a UI + backend API phase with no standalone probe scripts.

---

### Requirements Coverage

All requirements declared in PLAN frontmatter are covered:

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| shape-91-users-list-basic-mxid | Plan 00 | BasicUser includes mxid on every row | SATISFIED | `user-admin-routes.ts:124` SELECT widened; Tests 6+7 in users-list-basic.test.ts |
| shape-91-picker-gate | Plan 01 | Gate: zero, single-agent, no-name | SATISFIED | `useNewConversationForm.ts:113-128`; all 4 reasons wired |
| shape-91-single-agent-disallowed | Plans 01+03 | FE + BE both refuse single-agent-only | SATISFIED | Hook reason `single-agent-only` + route `single_agent_disallowed` + Tests |
| shape-91-zero-participant-disallowed | Plans 01+03 | FE + BE both refuse zero participants | SATISFIED | Hook reason `no-participants` + route `no_participants` |
| shape-91-mandatory-room-name | Plans 01+03 | Both surfaces require non-blank room name | SATISFIED | Gate + backend trim check |
| shape-91-create-room-endpoint | Plan 03 | POST /relay-room/create route | SATISFIED | Route at database.ts:1943; full orchestration |
| shape-91-materialize-at-create | Plan 03 | materializeRelayRoomSession called at create time | SATISFIED | `relay-room-create.ts:349`; Test 2 confirms session row materialized |
| T-91-BE-01 | Plan 03 | JWT auth on route | SATISFIED | `authenticateJWT` middleware on `router.post("/create")`; Test 1 confirms 401 without JWT |
| T-91-BE-02 | Plan 03 | Viewer mxid derived server-side, not from body | SATISFIED | `lookupViewingUserMxid(userId)` at step 8; Test 7 confirms 400 on null mxid |
| T-91-BE-03 | Plan 03 | MAX_PARTICIPANTS=32 cap post-filter | SATISFIED | `MAX_PARTICIPANTS=32` constant; Test 8 confirms 400 `too_many_participants` |
| T-91-BE-04 | Plan 03 | Two-layer mxid defense (grammar + fleet registry) | SATISFIED (with documented limitation — see below) | MXID_RE grammar filter + `loadFleetMxidRegistry` for humans; Tests 9+10 |
| T-91-FE-01 | Plans 01+05 | Double-click debounce via submitInFlightRef | SATISFIED | `submitInFlightRef = useRef(false)` + sync set before await; Test 7 in modal tests + flow test Test 2 |
| T-91-FE-02 | Plan 05 | Tenant scoping — only getUsersListBasic + useIdentities | SATISFIED | Test 17 grep-asserts no other user-listing import; `NewConversationModal.tsx:76` comment |

---

### Threat Model — T-91-BE-04 Agent mxid Gating: Documented Limitation

**Decision acknowledged in Plan 03 PLAN.md and in `relay-room-create.ts` docblock (L59-66):**

The `identities` DB table was dropped in Phase 68. Agent mxids live on-disk in `~/.claude/identities/<name>/relay.json`. There is no database registry the backend can query to verify a submitted `agentMxid` maps to a real fleet agent. As a result:

- **Human mxids:** Two-layer defense (MXID_RE grammar + `users.mxid` DB registry). Solid.
- **Agent mxids:** One-layer defense only (MXID_RE grammar). A caller with a valid JWT and knowledge of the MXID grammar could invite a valid-looking but non-fleet agent mxid.

**Assessment:** This weakens T-91-BE-04 for agent mxids from "fleet-registry gated" to "grammar-only gated." The practical blast radius is limited: (a) the route is JWT-authenticated so only Skynet-authenticated users can exploit it; (b) the worst outcome is an invite to a non-existent/external Matrix user, which simply produces a room with a pending invite that nobody accepts; (c) the frontend picker only surfaces real fleet agents via `useIdentities()`, so a legitimate user never accidentally submits a non-fleet agent mxid. The weakness requires a deliberate bypass of the frontend (raw API call with a crafted agent mxid). This is a **WARNING**, not a BLOCKER: the limitation is documented, intentional, and bounded by JWT auth. A DB-backed agent registry would require re-introducing what Phase 68 deliberately removed.

**Verdict:** Acceptable for v1. Document as a known limitation for the fleet-registry rebuild if one is ever warranted.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | — | — | — | All Phase 91 files scanned; no TBD/FIXME/XXX markers; no empty return stubs in production paths; no `dangerouslySetInnerHTML`; no `JSON.stringify(event/error)` in structured logs |

The two `return null` calls in `NewConversationModal.tsx` (L50 `gateHint` when gate.ok is true, L85 `serverName` when mxid absent) are correct: they suppress optional UI elements, not core rendering. Not stubs.

---

### Human Verification Required

Phase 91 code is complete. Arc-hold prevents deployment until sub-slices C, D, E ship together. The three UAT checkpoints below should be run against the live instance after arc-close deploy.

#### 1. Mobile layout (iPhone PWA)

**Test:** Open Skynet PWA on mobile. Tap the three-dot (MoreVertical) menu at the top of the conversation list. Tap "New conversation". Interact with the modal.
**Expected:** Modal fills the screen (inset-4 mobile layout, not centered dialog). Room name field, chips strip, search input, Humans/Agents sectioned list all visible. Picking participants shows chips. Create is disabled with appropriate hint until all three conditions met. Tapping Create opens the new room in the pane.
**Why human:** CSS media-query breakpoints cannot be evaluated in jsdom. Mobile modal fill is asserted structurally (Test 18) but visual and interactive correctness on a real touch device is not covered.

#### 2. Desktop layout

**Test:** Open Skynet in a desktop browser (viewport >= 768px). Open the three-dot menu, launch "New conversation".
**Expected:** Modal appears centered at approximately 560px width (not full-screen fill). X and Esc close it. Clicking outside does NOT close it. Search field narrows the list. Double-clicking Create fires only one create request.
**Why human:** Same CSS breakpoint limitation. Desktop centering requires a real browser with a sufficient viewport width.

#### 3. End-to-end sidebar materialization + pane open (deployed instance)

**Test:** On a deployed instance with a real relay (Synapse), create a room with at least one human participant (another Skynet user) and one agent. Observe the sidebar immediately after Create completes.
**Expected:** The new room appears in the sidebar conversation list within ~2 seconds (explicit fleet refresh). The pane opens to the new empty relay-room session, ready to compose the first message. The invited human sees the room appear in their own sidebar via the observation loop. The agent auto-joins without any ceremony.
**Why human:** Requires a live Matrix relay (Synapse instance) with real mxids provisioned. The observation loop, `materializeRelayRoomSession`, and agent receiver behavior cannot be tested without an actual relay deployment.

---

### Gaps Summary

No gaps. All 12 locked decisions are verified at the code level. Tests are green across backend (15 tests), frontend modal/flow (34 tests), sub-components (19 tests), and foundation (7 tests). TypeScript is clean. The three human verification items above are expected per the arc-hold — they are deferred, not blocked.

The single acknowledged limitation (T-91-BE-04 agent mxid grammar-only gating) is documented, intentional (identities table dropped Phase 68), and bounded by JWT authentication. It is not a BLOCKER.

---

_Verified: 2026-09-09T12:15:00Z_
_Verifier: Claude (gsd-verifier)_

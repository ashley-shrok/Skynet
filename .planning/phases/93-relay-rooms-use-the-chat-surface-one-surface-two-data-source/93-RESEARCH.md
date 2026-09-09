# Phase 93: Relay rooms use the chat surface — one surface, two data sources — Research

**Researched:** 2026-09-09
**Domain:** Refactor — fold standalone relay-room pane into PrettyView chat surface via discriminated-union source prop
**Confidence:** HIGH (all findings verified against local codebase; 21 CONTEXT decisions pre-locked so no external library research required)

## Summary

Phase 93 is a **grounded refactor**, not a new-feature investigation. Slice D (Phase 90) shipped a standalone relay-room pane tree (11 files, ~4,275 LOC) built as a fresh parallel implementation of the harness chat surface. Ashley's 2026-09-09 UAT reformulation reversed that choice: **the harness chat surface (`PrettyView`) IS the shared thing**, extended once to accept a discriminated-union `source` prop that swaps in a relay-adapter hook + hides compose-box ambient chrome + extends the single upper-right identity badge anchor into a leftward-growing badge set. The standalone pane retires entirely, and the retirement is atomic with the extension work — no thin wrapper survives.

Every piece the planner needs is a code-mapping problem, not a design problem: CONTEXT.md D-01 through D-21 lock the 21 gray areas, and the shape file's "Tempting but no" section explicitly rejects the extract-and-rebuild path that would be tempting to re-do here. Research below inventories the seven concrete code sites the plan will touch and enumerates every file referencing the relay-room-pane tree for retirement.

**Primary recommendation:** Structure the plan as five slices in this order — (1) source-prop plumbing on PrettyView/ComposeBox with harness-adapter still driving today's ingestion (harness-case regression-clean); (2) multi-badge extension of the badge anchor (harness supplies one, visually unchanged); (3) relay-adapter hook + relay send path landed inside PrettyView but not yet routed to; (4) atomic retirement + dispatcher swap + tabUtils.tsx:314 early-return removal; (5) test migration. Each slice's regression gate is "harness case looks and behaves EXACTLY as today" — non-negotiable per shape file § "What would make it wrong."

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01 through D-21)

**Multi-badge row:**
- **D-01:** Extend the EXISTING upper-right badge anchor; N badges grow LEFTWARD from where the current single badge sits. Not a new top-of-pane participants row. Harness case supplies exactly one badge (visually unchanged); relay case supplies many.
- **D-02:** Meters attach to badges that need them; harness supplies one badge WITHOUT a meter (meter stays in compose upper row), relay supplies badges WITH meters on the agent ones (Slice D's D-08 shrunk-meter+reset appendage is the visual reference), human badges have no meter (Slice D's D-09).
- **D-03:** Per-badge ordering — humans first, agents second, alphabetical within each role. Reuses Slice D's D-07 rule.

**Retirement of the standalone pane:**
- **D-04:** Delete the entire standalone pane component tree; route relay tabs to the shared chat surface via prop. `src/ui/features/relay-room-pane/` deletes entirely (all 11 files + tests). `src/ui/shell/RelayRoomSessionPane.tsx` deletes entirely (+ test). No thin wrapper survives.
- **D-05:** `sessionKind` STAYS as the tab-level discriminator. Phase 93 does NOT collapse "relay-room" sessionKind into "harness."
- **D-06:** The `renderTabContent` early-return branch at `tabUtils.tsx:314` (Phase 91 UAT fix) also retires. The relay branch of `TerminalOrIdentitySessionPane` becomes the sole entry point with host-optional handling internally.

**Source-prop shape (case cue):**
- **D-07:** Shared chat surface consumes a discriminated-union `source` prop:
  ```ts
  type ChatSurfaceSource =
    | { kind: "harness"; host: string; sessionId: string; /* etc. */ }
    | { kind: "relay"; roomId: string; viewingUserMxid: string; /* etc. */ };
  ```
  TypeScript makes invalid states unrepresentable. Dispatcher constructs the correct variant per tab.
- **D-08:** `source.kind` is the ONE hard case-discriminator inside the surface. Do NOT sprinkle case-detection logic based on other fields.

**Message-list source integration:**
- **D-09:** One message store on the shared surface; source-specific adapter hooks feed it. Harness-adapter wraps existing session-transcript ingestion (untouched); relay-adapter wraps `use-relay-room-stream`'s WS pipeline. Downstream rendering is entirely case-agnostic.
- **D-10:** The relay adapter absorbs the retired `use-relay-room-stream` behavior. Do NOT keep the file at its old path as a shim. Backend `src/backend/relay-room-stream/` STAYS.

**Compose box case-based hiding:**
- **D-11:** Hide attach button on textarea AND compose upper row (reset, context meter, interrupt, thumbs, recap) monolithically when `source.kind === "relay"`. Not per-feature applicability.
- **D-12:** Textarea + Send button visual shell stays exactly as today between cases.

**Send round-trip:**
- **D-13:** Send handler is case-selected inside the shared surface. Harness → existing harness send path (session stdin via pvSendInputRef). Relay → Matrix `/send` via the room's send-endpoint the standalone pane already used.
- **D-14:** Optimistic-bubble behavior on relay case matches harness pattern (Phase 81 rule: every compose-box send emits an optimistic bubble; live_event echo replaces it).

**Per-message rendering (already resolved):**
- **D-15:** Bubbles right = viewer's blue, unchanged. No case-branching.
- **D-16:** Bubbles left = other participants' identity colors. Reuses tiffany's already-shipped `RelayInboundBubble` primitive (bounty `relay-inbound-bubble-sender-hue-recolor`, 2026-08-18). Slice D's forked `RelayRoomInboundBubble.tsx` deletes with the rest.
- **D-17:** Message types the relay data source doesn't emit simply don't appear — data over configuration. NO per-case conditional hiding for message kinds.

**Edge cases:**
- **D-18:** Badge-click in relay rooms — no-op v1. Harness case badge-click unchanged.
- **D-19:** Empty relay room state — badge row + empty middle + compose bar. No special empty-state chrome.
- **D-20:** Room-not-found / membership-lost — friendly error state. Slice D's `error-state.tsx` is a starting reference (deletes with the pane); planner's call whether existing PrettyView error path absorbs it.

**Test migration:**
- **D-21:** Slice D pane tests retire; equivalent assertions land at shared-surface level with `source.kind === "relay"`. `tabUtils.test.tsx` updated to assert "sessionKind relay-room routes to shared chat surface with relay source."

### Claude's Discretion

- Concrete file layout for the shared surface's case-aware bits (inline in PrettyView.tsx vs. sibling component vs. `pretty-view/sources/` subfolder). Planner's call, follow existing conventions.
- Slice breakdown for the phase. Each slice ships with harness case regression-clean.
- Retirement ordering — all-at-once (risks broken interim) vs. incremental (risks unused-code interim). Planner's call.
- Concrete error-state UX / copy for D-20.
- Concrete optimistic-bubble plumbing for relay send — match harness pattern, don't reinvent.
- Whether `use-relay-room-stream`'s content moves as one blob into the new relay-adapter hook or gets factored during migration.

### Deferred Ideas (OUT OF SCOPE)

- Badge-click affordance in relay rooms (own future bounty).
- Relay-message system-event kinds (participant joins/leaves as bubbles).
- Collapsing `sessionKind` entirely (D-05 keeps it).
- Mobile / narrow-viewport polish for multi-badge row (Slice D's D-20 deferral holds).
- Extract-and-rebuild refactor path (rejected per shape "Tempting but no").
</user_constraints>

## Project Constraints (from CLAUDE.md)

No `./CLAUDE.md` exists at the working directory root, and no project skills directory (`.claude/skills/`, `.agents/skills/`) is present. Constraints below come from CONTEXT.md § Constraints, the shape file § Vehicle notes, and Slice D's still-applicable fleet rules.

- **NO worktrees** (fleet rule). All work in main working tree on `feat/tab-title-from-tmux`.
- **Executor doesn't ship** (fleet rule, Ashley 2026-08-08). Plans MUST NOT include a "ship" task at executor scope. Executor's remit stops at code + commit + scoped tests green. Deploy motion (push, docker build, docker compose up, verify, coord-post) is orchestrator-owned.
- **Scoped tests during dev; full suite at deploy gate** (fleet rule, Ashley 2026-08-20 + 2026-09-07). Executor's green-gate is `npx vitest run --related <changed-files>` OR targeted paths (e.g. `src/ui/features/pretty-view/`), NOT full suite.
- **No message streaming anywhere** (fleet rule). Do NOT design any streaming state, do NOT add streaming affordances.
- **Regression floor: harness case unchanged.** Every slice ships with Ashley's daily chat surface looking + behaving EXACTLY as today. If a slice can't clear that gate, stop and rework. This is the strongest "what would make it wrong" from the shape.
- **Multi-identity role — `git pull --rebase before every push`** (fleet rule, no coord-room post required for push-only, per 2026-09-05 rule).
- **Every backend write to a user row must be paired with `DatabaseSaveTrigger.forceSave`** (Skynet in-memory-DB invariant). NOT expected to apply — Phase 93 is frontend-primary.

<phase_requirements>
## Phase Requirements

This phase is driven by CONTEXT.md decisions D-01 through D-21 (no separate REQ-IDs in `.planning/REQUIREMENTS.md` — that document covers patch #43 v1 requirements and has not been updated for the current UX-pass campaign). The 21 decisions ARE the requirements. Mapping to research findings below:

| ID | Description | Research Support |
|----|-------------|------------------|
| D-01 | Extend upper-right badge anchor to N badges growing leftward | `IdentityBadge.tsx:110` — badge carries its own `absolute top-4 right-5 z-[101]` positioning; mount site is `PrettyView.tsx:3349-3366`. Multi-badge extension needs a wrapper container at the anchor, badges become in-flow relative children ordered rightmost-first (viewing-user's current single badge is rightmost, additional badges grow left). |
| D-02 | Meters attach per-badge in relay; harness supplies plain badge | Harness's meter today lives inside ComposeBox's Row 1 (`ComposeBox.tsx:2312-2321` "instrument bar"), NOT attached to a badge. Relay case reuses Slice D's `AgentBadgeWithAppendage` visual pattern (shrunk meter + reset below badge) but its code deletes with the pane tree — reimplement inside the new multi-badge component using the same `useSessionContextPct` hook + `/agent-reset` endpoint the appendage consumes today. |
| D-03 | Per-badge ordering: humans → agents, alphabetical within | Slice D's `IdentityBadgeRow.tsx:252-259` shows the exact sort implementation to port. |
| D-04 | Delete `src/ui/features/relay-room-pane/` + `RelayRoomSessionPane.tsx` entirely | Deletion inventory: 15 production files + tests, ~4,275 LOC (see § "Deletion Graph" below). External refs to update: `tabUtils.tsx`, `AppShell.tsx:1448+2156`, `conversation-store.ts:193`, `matrix-message-fetch.ts:106` (comment only), `viewing-user-store.ts` (JSDoc comments), `fleet-status-client.ts:292` (comment). |
| D-05 | `sessionKind` STAYS at tab level | No code changes needed to `Tab` type (`types/ui-types.ts:228-230`); dispatcher branch in `tabUtils.tsx:204` remains. Only the branch BODY changes. |
| D-06 | Retire early-return at `tabUtils.tsx:314` | Standalone `case "terminal"` branch that renders `<RelayRoomSessionPane>` before host-null gate; retire by hoisting relay-branch logic into `TerminalOrIdentitySessionPane` where host-optional handling lives internally. |
| D-07 | Discriminated-union `source` prop | Pattern precedent: `sessions-api.ts:22` — sessions API already uses `kind: "harness" \| "relay-room"` discriminator; `session-file-parser.ts` uses `kind: "relay_outbound" \| "relay_inbound"`. Apply same pattern for `ChatSurfaceSource`. |
| D-08 | `source.kind` is the ONE hard case-discriminator | Coding discipline: every case-based branch reads `source.kind`, delegates via adapter hook selection, does NOT sprinkle detection on other fields. |
| D-09 | One message store; source-specific adapters | Today: PrettyView.tsx:541 `const [messages, setMessages] = useState<StreamEvent[]>([])` — local component state, single message array populated by 8+ `setMessages(...)` sites inside the WS ingestion effect (PrettyView.tsx:2160-2332). Refactor: hoist message-state ownership stays inside PrettyView, but the *ingestion effect body* (~1600 lines from ~L1854 to ~L2770) gets encapsulated as a `useHarnessAdapter(source: {kind:"harness",...})` hook that returns `{ messages, sendInput, ... }`. Relay-adapter is a peer. |
| D-10 | Relay adapter absorbs `use-relay-room-stream` | Full read below in § "Existing Code Insights → use-relay-room-stream anatomy." Backend `src/backend/relay-room-stream/` untouched. |
| D-11 | Hide compose upper row + attach monolithically when `source.kind === "relay"` | ComposeBox already accepts `showPaperclip?: boolean` prop (`ComposeBox.tsx:300`). Add a single `mode?: "harness" \| "relay"` prop (or reuse `source.kind`); gate Row 1 render + `showPaperclip` from that single prop. Existing `ComposeBoxShell` primitive already supports this via `upperArea={undefined}` + `attachButton={undefined}` slots (Slice D's Plan 02 pattern) — planner's call whether ComposeBox itself becomes the primitive with a mode toggle OR ComposeBox delegates to ComposeBoxShell when relay. |
| D-12 | Textarea + Send visual shell unchanged between cases | ComposeBoxShell primitive extracted verbatim from ComposeBox Row 2 — the primitive already exists at `src/ui/components/ComposeBoxShell.tsx`. |
| D-13 | Case-selected send handler | Harness path today: `PrettyView.tsx:1179` `handleComposeSend → onSend(text, mqid)` → `IdentitySessionPane.tsx:280 onSend → pvSendInputRef.current(text, mqid)` (its own WS). Relay path: `stream.sendMessage(body, mqid)` on the relay-adapter (see use-relay-room-stream L197-271). Both share the same mqid contract. |
| D-14 | Optimistic-bubble parity | Harness optimistic-bubble mechanism: PrettyView's own message-append on send + pending-send state (PrettyView.tsx:1112-1304 shape referenced in use-relay-room-stream L17). Relay-adapter already implements the same pattern (fail-immediately if WS not open, 20s timeout, live_event echo replacement) — port it. |
| D-15 | Bubbles right = viewer's blue | Existing `OutboundBubble` at `src/ui/components/OutboundBubble.tsx` (Slice D Plan 02 extraction) — already shared primitive. |
| D-16 | Bubbles left = sender identity colors | Existing `RelayInboundBubble` at `src/ui/features/pretty-view/RelayInboundBubble.tsx` (166 lines, 2026-08-18 tiffany). Slice D forked this into `RelayRoomInboundBubble.tsx` — the fork deletes; use the pretty-view original for both cases. |
| D-17 | Data-over-configuration for message kinds | Relay-adapter never emits `MalformedLineEvent`, `ImageEvent`, WIP indicator frames, etc. — the shared surface renders whatever's in the store. No conditional hiding. |
| D-18 | Badge-click no-op in relay | Current harness badge onClick opens `IdentityModal` (`PrettyView.tsx:3353`). In relay case, wrap onClick in a case-check: `source.kind === "relay" ? undefined : () => setIsIdentityModalOpen(true)`. |
| D-19 | Empty relay room = normal empty middle | Falls out naturally from data-driven rendering. |
| D-20 | Friendly error state for room-not-found / auth-expired | Slice D's `error-state.tsx` (112 lines) is the reference; inline into PrettyView or create a small shared `ChatSurfaceErrorState`. Existing PrettyView error paths: `PrettyViewErrorOverlay.tsx` exists — check whether it can absorb the relay error semantics. |
| D-21 | Test migration | New assertion sites: `PrettyView.compose-send.test.tsx` (send path case-selection), `PrettyView.multi-badge.test.tsx` (new file for badge extension), `PrettyView.relay-source.test.tsx` (new file for relay case regression), `tabUtils.test.tsx` (dispatch assertion updated). |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Discriminated-union `source` prop consumption | Browser (React component prop) | — | The source is a runtime discriminator inside `PrettyView`; TypeScript enforces valid-state invariants at compile time. |
| Multi-badge rendering | Browser (React) | — | Layout / positioning / hue tinting are all pure client rendering; badge data comes from participants + identity resolution. |
| Case-based ambient-chrome hiding | Browser (React) | — | Conditional rendering of ComposeBox rows; no server involvement. |
| Harness message ingestion | Browser (WebSocket client) + Backend (session-file tail → WS server) | — | Existing PrettyView WS at `authApi` open path; entirely untouched by this refactor. |
| Relay message ingestion | Browser (WebSocket client) + Backend (`src/backend/relay-room-stream/`) | — | Backend WS server + Synapse admin API pivot (Phase 91 UAT fix) untouched; only the frontend adapter hook re-materializes inside the shared surface. |
| Send path (harness) | Browser → Backend session stdin injection (via pvSendInputRef WS) | — | Unchanged from today. |
| Send path (relay) | Browser → Backend relay-room-stream WS → Synapse `PUT /rooms/{id}/send` | — | Unchanged from Slice D; the send call site moves from RelayRoomPane's compose handler into PrettyView's case-selected `onSend`. |
| Participants list | Backend (`/relay-room/:id/participants` REST + WS `participants` frame) | Browser (identity resolution via `resolveMxidToIdentity`) | Server-side classifier + client-side identity-store enrichment; both untouched. |
| Tab-level dispatch (which pane component) | Browser (`tabUtils.tsx` dispatcher) | — | Per D-05, `sessionKind` stays as tab-level discriminator; only what the dispatcher's relay branch mounts changes. |

## Standard Stack

### Core (no new dependencies needed)
| Library / Module | Version | Purpose | Why Standard |
|---|---|---|---|
| React | 18.x (project baseline) | Component tree | Existing project stack; `useState`, `useEffect`, `useRef`, `useCallback`, `useSyncExternalStore` all in use. |
| TypeScript | 5.x (project baseline) | Discriminated-union `source` prop enforcement | Compile-time invariant enforcement for D-07 unrepresentable-invalid-states goal. |
| Zustand (implicit via existing stores) | project baseline | `useIdentities`, `useViewingUserMxid`, `useViewingUserId`, conversation-store subscriptions | Existing pattern — the relay-adapter reads via existing hooks. |
| Vitest | ^4.1.8 | Test framework | Project baseline; scoped tests via `npx vitest run --related <files>` per fleet rule. |
| Tailwind v4 | (project baseline) | Styling | All positioning classes (`absolute top-4 right-5 z-[101]`) already in use. |

**No new packages are required for this refactor. Package Legitimacy Audit is therefore skipped as `N/A — no packages installed by this phase`.**

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|---|---|---|
| Discriminated-union `source` prop | Explicit `mode: "harness" \| "relay"` prop | REJECTED by D-07 — permits invalid state (`mode: "relay"` with harness-shaped props still typechecks). |
| Discriminated-union `source` prop | Duck-typed inference from which optional props are present | REJECTED by D-07 — most fragile, silently mis-behaves on both/neither. |
| One shared surface with adapter hooks | Two panes side-by-side (Slice D's D-01/D-02/D-03 model) | REJECTED — this phase REVERSES Slice D. |
| Extract-and-rebuild refactor | Extract primitives from PrettyView, rebuild both cases on top | REJECTED by shape file § "Tempting but no" — the right shape is smaller (extend existing surface, retire duplicate). |

## Architecture Patterns

### System Architecture Diagram

```
                        ┌──────────────────────────────────────────────────┐
                        │ tabUtils.tsx dispatcher                          │
                        │   TerminalOrIdentitySessionPane                  │
                        │   ├── if tab.sessionKind === "relay-room" →      │
                        │   │      <PrettyView source={{kind:"relay",…}}/> │
                        │   │      (host is optional — internal handling)  │
                        │   └── else if identity pane →                    │
                        │          <PrettyView source={{kind:"harness",…}}/│
                        │          via IdentitySessionPane                 │
                        └────────────────────────┬─────────────────────────┘
                                                 │ source prop
                                                 ▼
                        ┌──────────────────────────────────────────────────┐
                        │ PrettyView (chat surface)                        │
                        │                                                  │
                        │ Multi-badge anchor (upper right, growing left)   │
                        │   ┌─────────┐  ┌─────────┐  ┌─────────┐          │
                        │   │agent B  │  │human A  │  │self ←── │  z=101   │
                        │   │+meter   │  │no meter │  │(harness │          │
                        │   │(relay)  │  │(relay)  │  │ only)   │          │
                        │   └─────────┘  └─────────┘  └─────────┘          │
                        │                                                  │
                        │  Message list  (renders whatever adapter feeds)  │
                        │  ┌──────────────────────────────────────────┐    │
                        │  │  ChatMessage / RelayInboundBubble /      │    │
                        │  │  OutboundBubble / ImageBubble / WipBubble│    │
                        │  │  (only kinds the source emits appear)    │    │
                        │  └──────────────────────────────────────────┘    │
                        │                                                  │
                        │  ComposeBox                                      │
                        │  ┌──────────────────────────────────────────┐    │
                        │  │ Row 1 (upper): meter+reset+queue+stop+   │    │
                        │  │        thumbs+recap — HIDDEN when relay  │    │
                        │  │ Row 2: [attach|hidden-when-relay] TXT [S]│    │
                        │  └──────────────────────────────────────────┘    │
                        │                                                  │
                        │  onSend = case-selected:                         │
                        │    harness → pvSendInputRef WS (existing)        │
                        │    relay   → relayAdapter.sendMessage() (WS)     │
                        └────────────────────────┬─────────────────────────┘
                                                 │ adapter hook
                     ┌───────────────────────────┴────────────────────────┐
                     │                                                    │
                     ▼                                                    ▼
        ┌────────────────────────────┐                    ┌────────────────────────────┐
        │ useHarnessAdapter          │                    │ useRelayAdapter            │
        │ (source.kind === "harness")│                    │ (source.kind === "relay")  │
        │                            │                    │                            │
        │ Wraps existing session-    │                    │ Absorbs use-relay-room-    │
        │ transcript WS ingestion    │                    │ stream.ts contents         │
        │ (PrettyView.tsx L1854-2770)│                    │ (WS to relay-room-stream)  │
        │                            │                    │                            │
        │ Frames: pane-state, image, │                    │ Frames: session, history_  │
        │ chat-message, aside, task, │                    │ batch, live_event, send_   │
        │ session-boundary,          │                    │ ack/error, participants,   │
        │ malformed-line, more…      │                    │ inactive, error            │
        └────────────┬───────────────┘                    └────────────┬───────────────┘
                     │                                                 │
                     ▼                                                 ▼
        ┌────────────────────────────┐                    ┌────────────────────────────┐
        │ Backend claude-session WS  │                    │ Backend relay-room-stream  │
        │ /claude-session/…          │                    │ WS (untouched by Phase 93) │
        │ (tail session JSONL)       │                    │ + Synapse admin API        │
        │ (untouched by Phase 93)    │                    │ (Phase 91 UAT fix)         │
        └────────────────────────────┘                    └────────────────────────────┘
```

### Recommended Project Structure

The planner has D-discretion (see CONTEXT.md § Claude's Discretion) on concrete layout. Recommendation informed by existing conventions:

```
src/ui/features/pretty-view/
├── PrettyView.tsx                    # extended once (add source prop, case-selected onSend, multi-badge anchor)
├── ComposeBox.tsx                    # extended once (case-based Row 1 + attach hide via new `mode` prop)
├── sources/                          # NEW subfolder for case-aware adapter hooks + source-prop type
│   ├── chat-surface-source.ts        # exports `ChatSurfaceSource` discriminated-union type
│   ├── use-harness-adapter.ts        # extracted harness ingestion (or a thin re-export wrapping existing ingestion)
│   └── use-relay-adapter.ts          # absorbed use-relay-room-stream contents
├── MultiBadgeAnchor.tsx              # NEW small sibling (badges + optional meters, growing leftward)
├── ChatSurfaceErrorState.tsx         # NEW small sibling for D-20 (absorbs Slice D's error-state.tsx pattern)
├── RelayInboundBubble.tsx            # UNCHANGED (tiffany's shipped primitive; both cases use it)
├── OutboundBubble is at src/ui/components/OutboundBubble.tsx (from Slice D Plan 02) — reuse as-is
└── … (all existing files unchanged)

src/ui/features/relay-room-pane/     # DELETED ENTIRELY
src/ui/shell/RelayRoomSessionPane.tsx # DELETED (+ test)
```

Alternative that stays inside PrettyView.tsx if the new sibling would push scope: put adapter hooks in `pretty-view/use-harness-adapter.ts` and `pretty-view/use-relay-adapter.ts` as flat siblings. The subfolder is planner's discretion per CONTEXT.md.

### Pattern 1: Discriminated-Union `kind` Props
**What:** TypeScript enforces that each variant carries exactly its own fields; the `switch (source.kind)` reader gets full type narrowing.
**When to use:** D-07 requires this shape for the source prop. Existing precedents in codebase:

```typescript
// src/ui/api/sessions-api.ts:22 — sessions discriminator
// | RelayRoomSessionRow, discriminated on `kind: "harness" | "relay-room"`

// src/backend/database/routes/sessions.ts:262-268
kind: "harness";
// vs the appended stored-table items with kind: "relay-room"

// src/backend/claude-session/session-file-parser.ts:115+124
kind: "relay_outbound";
kind: "relay_inbound";
```

**Example for `ChatSurfaceSource`:**
```typescript
// src/ui/features/pretty-view/sources/chat-surface-source.ts
export type ChatSurfaceSource =
  | {
      kind: "harness";
      hostId: number;
      tmuxSession: string;
      identityKey: string | null; // resolved via sessionMatchKey at dispatcher
      tabId?: string;
    }
  | {
      kind: "relay";
      roomId: string;
      roomTitle: string | null;
      viewingUserMxid: string; // sourced via useViewingUserMxid in adapter
    };
```

### Pattern 2: Adapter-Hook Encapsulation
**What:** Each source's ingestion pipeline is encapsulated as a hook that returns a uniform `{ messages, sendMessage, error, ... }` shape. Case-selected at the top of `PrettyView`.
**When to use:** D-09 + D-10 require this — adapter is the ONLY case-aware layer downstream of D-07.
**Example:**
```typescript
// Inside PrettyView, case-selected once:
const adapter =
  source.kind === "relay"
    ? useRelayAdapter(source)
    : useHarnessAdapter(source);
// From here down, PrettyView reads adapter.messages, calls adapter.sendMessage(), etc.
// It does not read source again except for D-08 conditional-rendering gates.
```

**⚠️ Rules-of-hooks caveat:** React forbids conditional hook calls. The above ternary is unsafe. Either:
- **Preferred:** Always call BOTH hooks, but only run the effect body of the inactive one as a no-op (guarded on `source.kind` inside each hook's own effects — the pattern `use-relay-room-stream` uses today with `isVisible` gates).
- **OR:** Split the shared surface into `<PrettyView>` → `<PrettyViewHarness>` / `<PrettyViewRelay>` wrapper thin components that each call one adapter unconditionally. Loses some data-driven purity but is React-idiomatic.
- **Or:** Move all adapter effect setup into a single hook `useChatSurfaceAdapter(source)` that internally switches on `source.kind` inside its own body — this preserves hooks-order regardless of source variant. Planner's call.

### Anti-Patterns to Avoid
- **Sprinkling case-detection based on other fields** (D-08 violation). Any read of `source.roomId` outside a `source.kind === "relay"` branch is a smell.
- **Reintroducing a thin `RelayRoomSurface` wrapper** — shape file § "What would make it wrong": "The standalone relay pane concept comes back later 'for one small reason.' Once it dissolves, it stays dissolved."
- **Per-message-kind conditional hiding** (D-17 violation). If a message kind should not appear in relay, the relay adapter must not emit it — do NOT add `if (source.kind === "relay" && msg.kind === "wip") return null` gates in the render loop.
- **Extract-and-rebuild** (shape file "Tempting but no"). The right shape is smaller — extend the existing surface, retire the duplicate.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Sender-attributed inbound bubble | Don't fork or reimplement the bubble tinting logic | `src/ui/features/pretty-view/RelayInboundBubble.tsx` (166 lines, tiffany 2026-08-18, bounty `relay-inbound-bubble-sender-hue-recolor`) | Already ships per-sender hue, left-alignment, resolved-identity dot, file-pointer support, and security review. Slice D's fork (`RelayRoomInboundBubble.tsx`) deletes; go back to the original. |
| Outbound "you speaking" bubble | Don't rebuild | `src/ui/components/OutboundBubble.tsx` (Slice D Plan 02 extraction — this file survives Phase 93) | Already shared primitive; handles pending-send `sending`/`failed` states. |
| Compose textarea + Send visual shell | Don't refactor visual shell | `src/ui/components/ComposeBoxShell.tsx` (Slice D Plan 02 primitive — SURVIVES Phase 93; planner may keep it as an extraction ComposeBox delegates to when relay, OR merge back into ComposeBox with a mode toggle) | Already handles Enter-to-send, Shift+Enter newline, clear-on-send. |
| WS lifecycle (open + reconnect + isVisible-gate) | Don't reinvent | `use-relay-room-stream.ts` L303-475 already implements linear-with-cap backoff (2s/4s/6s/8s/8s, MAX_RECONNECT_ATTEMPTS=5, full-jitter per R-54-07), isVisible-gated close, cleanup on unmount | Port verbatim into `useRelayAdapter`. |
| Pending-send FIFO with timeout + echo correlation | Don't reinvent | `use-relay-room-stream.ts` L169-271 already implements the D-16 mirror of PrettyView's L1112-1304 pattern | Move-as-blob into the relay adapter. |
| Participant classification (humans vs agents) | Don't touch | Backend `src/backend/relay-room-stream/participants-classifier.ts` + REST `/relay-room/:id/participants` + WS `participants` frame | Untouched by Phase 93; frontend consumes existing wire. |
| mxid → identity resolution | Don't reinvent | `src/ui/features/pretty-view/relay-mxid-resolve.ts` (`resolveMxidToIdentity(mxid, byKey)`) | Already used by both `RelayInboundBubble` and Slice D's `IdentityBadgeRow`. |
| Per-agent context meter data source | Don't invent new plumbing | `useSessionContextPct(hostId, tmuxSession)` — Wave 0 hook | Slice D's `AgentBadgeWithAppendage` already consumes it; port into the multi-badge extension. |
| Per-agent reset action | Don't invent new plumbing | `POST /agent-reset/:hostId/:tmuxSession` — Wave 0 endpoint | Slice D's `AgentBadgeWithAppendage` already dispatches it. |
| Discriminated-union tab kinds at tab level | Don't collapse | Existing `Tab.sessionKind: "harness" \| "relay-room"` in `types/ui-types.ts:228-230` | D-05: `sessionKind` STAYS. |
| Backend WS server + Synapse admin API | Don't touch | `src/backend/relay-room-stream/` + Phase 91 UAT fix `771bfcc9` | Untouched by Phase 93. |

**Key insight:** Nearly every "building block" this phase needs already exists somewhere — either inside PrettyView's harness path, inside Slice D's soon-to-be-deleted pane tree, or as an already-extracted primitive (ComposeBoxShell, OutboundBubble). The work is porting + retirement, not novel invention. The one genuinely new component is the multi-badge anchor extension.

## Runtime State Inventory

Phase 93 is a refactor that involves deleting a component tree, but it does NOT rename any strings, database keys, disk paths, or user-visible identifiers. All the following categories are cross-checked below:

| Category | Items Found | Action Required |
|---|---|---|
| Stored data | None — Phase 93 does not rename any database columns, ChromaDB collections, Mem0 user_ids, or Redis keys. No data-store schema touched. | None. |
| Live service config | None — Phase 93 does not rename any Datadog services, Tailscale ACLs, Cloudflare Tunnels, or n8n workflows. | None. |
| OS-registered state | None — Phase 93 does not rename any Windows Task Scheduler tasks, pm2 process names, launchd plists, systemd units. | None. |
| Secrets and env vars | None — Phase 93 does not rename any SOPS keys, `.env` variables, or CI/CD env-var names. | None. |
| Build artifacts / installed packages | **Potential vitest cache staleness** after the deletion. `.vitest/` cache may retain references to `src/ui/features/relay-room-pane/*.test.tsx` files that no longer exist. | Delete vitest cache before running scoped tests post-retirement: `rm -rf node_modules/.vitest` (or `--no-cache`). Planner should include this as an executor step in the retirement slice. |

**Nothing else found in category:** Verified by (a) grep of `relay-room-pane` string across `src/`, `docker/`, `.planning/config.json`, `package.json`, `scripts/` — no external system references the retired directory beyond source imports; (b) the retired code contains no persisted-state writes — `RelayRoomPane` is stateless w.r.t. any store other than the ephemeral WS/REST state that dies with the pane; (c) no localStorage/sessionStorage keys carry the string `relay-room-pane` (grep confirms).

## Common Pitfalls

### Pitfall 1: Harness regression via unintended cross-branch effect
**What goes wrong:** The multi-badge extension or source-prop plumbing accidentally shifts harness-case badge position by 1px, changes hue calculation, or introduces a stray z-index conflict. Ashley notices in daily use; regression escalates.
**Why it happens:** The extension goes in the same anchor location as the current single badge, and PrettyView's badge positioning is delicate (comment at PrettyView.tsx:3311-3320 lists a hard-lock on background-image with reasoning about stacking contexts).
**How to avoid:**
- Snapshot the harness case's current DOM at the badge anchor BEFORE any refactor (visual regression test or `render()` + serialize the tree in a test file).
- Every slice's regression gate: mount PrettyView with `source={{kind:"harness",...}}` and assert (a) exactly one badge renders, (b) at the same position class `absolute top-4 right-5 z-[101]`, (c) with the same onClick behavior (opens IdentityModal), (d) with the same hue calculation from `pvHue`.
- Explicit rule: the multi-badge extension in the harness case MUST render exactly the same DOM subtree at the anchor as today. When `source.kind === "harness"`, the anchor renders the existing `<IdentityBadge>` directly — no wrapper container, no new intermediate div, no altered classNames. Multi-badge behavior is opt-in via the relay case only, or via a shared component whose harness-mode branch matches the current markup byte-for-byte.
- Run PrettyView's full existing test suite (all 15 `PrettyView*.test.tsx` files) as part of each slice's green gate. Even though the fleet rule scopes to `--related`, PrettyView is the hot path — a slightly wider scope is warranted here.

**Warning signs:** Any diff in `PrettyView.test.tsx` snapshots, any layout-shift in `PrettyView.task-pill.test.tsx` (the task pill sits at z-[100] BELOW the badge's z-[101] — see PrettyView.tsx:3378-3399), any change to `IdentityBadge.test.tsx` behavior.

### Pitfall 2: Adapter hook conditionally called (React rules-of-hooks)
**What goes wrong:** Naive implementation writes `const adapter = source.kind === "relay" ? useRelayAdapter(source) : useHarnessAdapter(source);` and React throws "Rendered fewer hooks than expected" the moment source.kind flips.
**Why it happens:** `source.kind` can theoretically change if a tab is re-purposed, but even without that, conditional hook calls are a linter/React error regardless.
**How to avoid:** Wrap the whole PrettyView body in two thin sub-components (`<PrettyViewHarness>` / `<PrettyViewRelay>`) and switch at the top, OR write a single `useChatSurfaceAdapter(source)` hook whose internal effect body switches on `source.kind` — hooks always call in the same order. See Pattern 2 anti-pattern note in "Architecture Patterns" above.
**Warning signs:** ESLint `react-hooks/rules-of-hooks` complaint; runtime "Rendered fewer hooks than expected" error.

### Pitfall 3: `use-relay-room-stream` deleted but the file still imported somewhere
**What goes wrong:** Retirement misses one import — some test file or dev-tool imports from the deleted path. Build passes on isolated file compile, fails on full-project build.
**Why it happens:** grep-based deletion sweeps sometimes miss non-obvious import paths (test files, mocks in unrelated tests that use `vi.mock("@/features/relay-room-pane/...")`).
**How to avoid:**
- Run this exact command AFTER the retirement slice: `grep -rn "features/relay-room-pane\|shell/RelayRoomSessionPane\|use-relay-room-stream\|RelayRoomInboundBubble\|AgentBadgeWithAppendage" src/ tests/ scripts/ 2>/dev/null`. Zero hits required.
- Run `npx tsc --noEmit` at least once during the retirement slice — catches any dangling type references.
- The `.test.tsx` files in `src/ui/features/relay-room-pane/` reference their production siblings — they die together; no orphan tests.

### Pitfall 4: Matrix `unsigned.transaction_id` echo-back correlation drift
**What goes wrong:** Relay-adapter's send → live_event correlation stops matching, so outbound bubbles show as duplicates (optimistic + echo).
**Why it happens:** The `unsigned.transaction_id` echo is documented in `use-relay-room-stream.ts` L50-57 as "Assumption A4" — trusts Matrix to echo the client-supplied txnId back on `/sync`. Backend `matrix-message-send.ts` passes the frontend mqid verbatim as the Matrix txnId. If someone rewires this without knowing, correlation breaks silently.
**How to avoid:** Preserve the exact contract when porting: the `relay-optim-` mqid prefix (from `RelayRoomPane.tsx:59-62`) OR the harness path's prefix — planner decides which prefix wins in the shared surface, but the value MUST flow from ComposeBoxShell.fireSend → adapter.sendMessage → WS payload.txnId → Matrix → live_event.unsigned.transaction_id → adapter correlation lookup → pending removal + history append. One end-to-end test for this correlation is Test 5 in `use-relay-room-stream.test.ts` (referenced in file header L52-57) — port it into the new adapter's test file.

### Pitfall 5: Optimistic bubble timing skew between harness and relay cases
**What goes wrong:** Harness path emits optimistic bubble on send-attempt (before WS ack); relay path emits on WS ack (after network round-trip). User experiences visible latency asymmetry.
**Why it happens:** D-14 requires parity but the two adapters were written by different authors at different times. Slice D's `sendMessage` (`use-relay-room-stream.ts` L197-271) already emits an optimistic bubble on send-attempt via the `pendingSends` state — good. Harness path optimistic-bubble mechanism is at `PrettyView.tsx:1112-1304` (referenced in use-relay-room-stream L17).
**How to avoid:** Cross-read both paths before writing the new adapter. If they diverge, align on send-attempt emission (Slice D's model, and the Phase 81 fleet rule of "every compose-box send emits an optimistic bubble" per CONTEXT D-14).

### Pitfall 6: Retirement leaves ambient conversation-store shim references
**What goes wrong:** `conversation-store.ts:193` and adjacent comments reference `RelayRoomSessionPane`. `AppShell.tsx:1448` + `2156` reference `RelayRoomSessionPane` in comments. `matrix-message-fetch.ts:106` references `RelayMessageList.extractBody`. If deleted, comment references become stale (harmless but confusing); if any of these were actual runtime references, the app breaks.
**Why it happens:** Comments and JSDoc referencing deleted symbols confuse future readers.
**How to avoid:** Sweep comments during retirement:
```bash
grep -rn "RelayRoomSessionPane\|RelayRoomPane\|RelayMessageList\|IdentityBadgeRow\|AgentBadgeWithAppendage\|RelayRoomInboundBubble\|use-relay-room-stream\|relay-room-pane" src/ 2>/dev/null
```
Expected zero hits after retirement completes.

## Deletion Graph (D-04)

Every file/reference the retirement slice must handle:

### Production files (DELETE)
```
src/ui/features/relay-room-pane/
├── AgentBadgeWithAppendage.tsx        (292 lines)
├── IdentityBadgeRow.tsx               (290 lines)
├── RelayMessageList.tsx               (212 lines)
├── RelayRoomInboundBubble.tsx         (166 lines — FORK of pretty-view sibling)
├── RelayRoomPane.tsx                  (316 lines)
├── error-state.tsx                    (112 lines)
├── relay-room-api.ts                  (230 lines)
└── use-relay-room-stream.ts           (488 lines) — content re-materializes inside useRelayAdapter per D-10
                                       Total: 2,106 lines of production code

src/ui/shell/RelayRoomSessionPane.tsx  (152 lines)
```

### Test files (DELETE)
```
src/ui/features/relay-room-pane/
├── AgentBadgeWithAppendage.test.tsx   (299 lines)
├── IdentityBadgeRow.test.tsx          (273 lines)
├── RelayMessageList.test.tsx          (209 lines)
├── RelayRoomInboundBubble.test.tsx    (201 lines)
├── RelayRoomPane.test.tsx             (715 lines)
├── error-state.test.tsx               (76 lines)
└── use-relay-room-stream.test.ts      (396 lines)

src/ui/shell/RelayRoomSessionPane.test.tsx  (exists per grep)
                                       Total: ~2,169 lines of test code deleting
                                       Grand total deletion: ~4,275 lines
```

### External refs (EDIT — do NOT delete these files, update the specific lines)
```
src/ui/shell/tabUtils.tsx
├── L23-25:  lazy-import of RelayRoomSessionPane — DELETE
├── L204-222: TerminalOrIdentitySessionPane relay branch — REPLACE with PrettyView-with-relay-source mount
└── L306-326: renderTabContent case "terminal" early-return — DELETE (per D-06)
             (host-optional handling moves into TerminalOrIdentitySessionPane per D-06)

src/ui/AppShell.tsx
├── L1448:  comment ref to "RelayRoomSessionPane" — UPDATE to "PrettyView with relay source"
├── L2151-2170: onRelayRoomRowClick — UNCHANGED (still calls openTab with sessionKind: "relay-room";
│              only the DOWNSTREAM tabUtils dispatcher branch changes)
└── L2156:  comment ref to "RelayRoomSessionPane" — UPDATE

src/ui/state/conversation-store.ts
└── L193:   comment "either PrettyView or RelayRoomSessionPane" — UPDATE to "PrettyView (either source)"

src/backend/relay-room-stream/matrix-message-fetch.ts
└── L106:   comment ref to "RelayMessageList.extractBody" — UPDATE (extractBody moves into RelayMessageList's replacement in the new adapter/message-list path)

src/ui/state/viewing-user-store.ts
├── L6-10:  JSDoc mentioning IdentityBadgeRow + RelayMessageList — UPDATE

src/ui/api/fleet-status-client.ts
└── L292:   comment "Plan 06 AgentBadgeWithAppendage" — UPDATE to reference the new multi-badge component

src/ui/shell/tabUtils.test.tsx
├── L8, L16: JSDoc mentioning "RelayRoomSessionPane" — UPDATE
├── L35-42: vi.mock of RelayRoomSessionPane — REPLACE with vi.mock of PrettyView
├── L205, L242: assertions "sessionKind relay-room → RelayRoomSessionPane" — UPDATE to
│              "sessionKind relay-room → PrettyView with source.kind === 'relay'"
```

### External refs that are file COMMENTS ONLY (harmless if left, sweep for cleanliness)
- `use-relay-room-stream.test.ts` JSDoc — dies with the file.
- Any test file that mocks `@/features/relay-room-pane/*` — dies with the file.

## Existing Code Insights

### PrettyView anatomy — badge anchor location (D-01 landing site)

- **File:** `src/ui/features/pretty-view/PrettyView.tsx` (4,087 lines total).
- **Badge mount:** `L3349-3366` — `<IdentityBadge identityKey={pvIdentityKey} hostId={hostId} onClick={() => setIsIdentityModalOpen(true)} onLongPress={onTogglePrettyMode} tabId={tabId} onContextMenu={...} />`.
- **Positioning:** `IdentityBadge.tsx:110` — the badge itself carries `absolute top-4 right-5 z-[101]` in its `rootClassName`. So the "anchor" is the badge's own absolute positioning against PrettyView's root `relative overflow-hidden` (L3288).
- **Data flow:** `pvIdentityKey` = `sessionMatchKey(tmuxSession)` (via `identities-store.byKey.get(pvIdentityKey)`); the badge component internally resolves color hue + displayName from that key.
- **Extension for D-01:** The multi-badge extension needs a wrapper container at the same anchor position that:
  - When `source.kind === "harness"`: renders exactly `<IdentityBadge identityKey={pvIdentityKey} ... />` as today (no wrapper container visible in DOM, or a wrapper that CSS-collapses to identical layout).
  - When `source.kind === "relay"`: renders a flex-row container growing leftward (`right-5` anchor with `flex-row-reverse` OR `right-5` + explicit right-to-left ordering) containing badge cells for humans + agents (each cell is `<IdentityBadge>` for humans, or `<IdentityBadge>` + shrunk meter+reset appendage for agents).
- **Sibling constraint:** The centered task pill (L3391-3399) sits at `absolute top-4 left-1/2 -translate-x-1/2 z-[100]`. The multi-badge row growing leftward must NOT collide horizontally with the task pill when the participant count exceeds a threshold. Slice D's D-20 (mobile deferral) applies — v1 overflow behavior is planner's discretion.

### PrettyView anatomy — message state (D-09 landing site)

- **State declaration:** `PrettyView.tsx:541` — `const [messages, setMessages] = useState<StreamEvent[]>([])`.
- **State type:** `L291-296` — `StreamEvent = ChatMessageEvent | ImageEvent | RelayOutboundEvent | RelayInboundEvent | MalformedLineEvent`. (The `RelayOutboundEvent` and `RelayInboundEvent` shapes are the harness-parses-recv.sh-lines path from Phase 17, distinct from Phase 90's relay-room WS pipeline.)
- **Population sites:** `setMessages(...)` fires at 8 sites inside the WS ingestion effect (L1854-2770): initial reset at L1862, session-boundary reset at L2118 + L2587 + L2648, per-frame appends at L2160/L2194/L2210/L2226/L2243/L2278/L2293/L2332.
- **Ingestion effect deps:** `[hostId, tmuxSession, retryKey]` — re-fires on host/session change and on manual reconnect retry.
- **D-09 refactor shape:** The refactor extracts the entire ingestion effect body into `useHarnessAdapter(source: {kind:"harness",...})` returning `{ messages, sendInput, ... }`. `useRelayAdapter(source: {kind:"relay",...})` is a peer that returns the same shape. PrettyView's render body reads `adapter.messages` and never touches `setMessages` directly.
- **Complexity risk:** The ingestion effect at L1854-2770 is ~900 lines. A careful extraction is required — read it end-to-end before the refactor slice starts. Alternative: leave the effect in place inside PrettyView and simply gate it on `source.kind === "harness"`; add the relay-adapter as a peer effect gated on `source.kind === "relay"`. This is lower-risk — no functional change to the harness path, just adding a conditional wrapper around the existing effect setup. Planner's call.

### ComposeBox anatomy — Row 1 hiding (D-11 landing site)

- **File:** `src/ui/features/pretty-view/ComposeBox.tsx` (3,739 lines).
- **Row 1 mount:** L2312-2321 comment describes the "instrument bar" containing meter well + spacer + aux buttons; L2321 `<div className={cn("flex items-center gap-2 mb-[3px]", isTouchDevice ? "min-h-[44px]" : "min-h-8")}>` opens the wrapper. Row 1 continues through the meter well (L2322-2492), aux button group (L2492+), and closes before Row 2 (`Row 2 — compose bar` comment at L2668).
- **Attach button location:** L2881-2907 — Paperclip attach button, wrapped in `showPaperclip && (...)`. `showPaperclip` prop is at L300 of the props interface. Renders as absolute-positioned child inside the textarea wrapper at `left-1 bottom-0.5`.
- **D-11 refactor shape:**
  - Simplest: add a single new prop `mode?: "harness" | "relay"` (defaulting to `"harness"` for backward-compat). Gate Row 1 render: `{mode !== "relay" && <div className="Row 1 wrapper">...</div>}`. Gate attach: `{showPaperclip && mode !== "relay" && (...)}`, OR just have PrettyView pass `showPaperclip={false}` for relay case (existing prop already supports this).
  - Alternative: pass `source` prop through to ComposeBox and let it read `source.kind`. Slightly more coupling but consistent with D-08 "one hard discriminator."
- **Existing conditional patterns in ComposeBox to reuse for hiding gates:** ComposeBox already has extensive prop-driven conditional rendering (`showPaperclip`, `recycleActive`, `planPendingActive`, `queueArmed`, `hasAttachments`) with `disabled`-vs-`hidden` distinctions well-established. Adding `mode` fits the existing shape.

### PrettyView send-path anatomy (D-13 landing site)

- **PrettyView `handleComposeSend`:** `PrettyView.tsx:1176-1180` — `const handleComposeSend = useCallback((text, mqid) => { onSendFired(); return onSend ? onSend(text, mqid) : false; }, [onSend, onSendFired]);`.
- **`onSend` prop origin:** `IdentitySessionPane.tsx:280-336` — the `onSend` callback captures the outer `pvSendInputRef.current` at call-time, routes through PrettyView's OWN WS (not the terminal's SSH WS, per Phase 35 rewire).
- **Register-on-mount pattern:** `PrettyView.tsx` calls `onRegisterSendInput?.(sendInput)` in a mount effect; the parent stores `pvSendInputRef.current = fn`. MessageQueueDrawer reads `pvSendInputRef.current` at call-time so a stale capture never bites.
- **D-13 refactor shape:**
  - Case-select onSend inside the shared surface: `const handleSend = source.kind === "relay" ? (text) => adapter.sendMessage(text, generateMqid()) : (text, mqid) => onSend?.(text, mqid)`.
  - Preserve the mqid contract in both cases — same `relay-optim-*` OR harness-path prefix, same threading through to backend echo correlation.
  - Existing PrettyView `handleComposeSend` (L1176-1180) becomes a thin wrapper that reads case-select from adapter or from `source.kind` inside its closure.

### use-relay-room-stream anatomy (D-10 landing site)

**Full read summary of `src/ui/features/relay-room-pane/use-relay-room-stream.ts` (488 lines):**

- **Constants (L74-80):** `PENDING_SEND_TIMEOUT_MS_NORMAL = 20_000`, `MAX_RECONNECT_ATTEMPTS = 5`, `LOAD_OLDER_COUNT = 20`.
- **State:** `history`, `participants`, `error`, `pendingSends`, `hasOlder`, `loadOlderStatus`, `loadOlderError`.
- **Refs:** `wsRef`, `pendingSendsRef`, `reconnectAttemptsRef`, `reconnectTimeoutRef`, `viewingUserMxidRef`, `roomIdRef`.
- **WebSocket lifecycle (L303-475):**
  - Opens via `openRelayRoomSocket()` on mount when `isVisible === true`.
  - Fires `connectToRoom { roomId }` on `onopen`.
  - Dispatches server frames via `switch (parsed.type)` on `onmessage`.
  - On `onclose`, schedules reconnect with linear-with-cap backoff (2s/4s/6s/8s/8s; full-jitter random within cap per R-54-07).
  - On `isVisible === false` OR unmount: closes WS, clears every pending-send timer.
- **Frames handled (L341-417):**
  - `session` — stored implicitly (no state effect; roomTitle already carried via prop).
  - `history_batch` — replaces history, sets `hasOlder` from `hasMore`.
  - `live_event` — appends event; if `sender === viewingUserMxid` AND `event.unsigned.transaction_id` matches a pending mqid, cancels timer + removes pending + appends real event (Pitfall 4 correlation, D-14 optimistic-echo replacement).
  - `send_ack { txnId, eventId }` — removes matching pending (belt-and-suspenders vs. live_event echo).
  - `send_error { txnId, reason }` — flipToFailed.
  - `participants` — updates participants state (W#9 initial + live updates).
  - `inactive` — sets error → `"room-not-found"` (D-20 room-not-found source).
  - `error` — sets error → `"protocol"`; connection stays open.
- **Outward API (L197-301):**
  - `sendMessage(body, mqid)`: `ws.send({ type: "send_message", body, txnId: mqid })`; inserts pending record; 20s no-echo timer → flipToFailed. If WS not open, seeds pending as `failed` immediately (fail-immediately model, simpler than PrettyView's queued-send path).
  - `fetchOlder(beforeEventId)`: `ws.send({ type: "fetch_older_range", beforeEventId, count: 20 })`; sets `loadOlderStatus = "in-flight"`.
- **Structured logging discipline:** Every boundary event logs via `console.info` with explicit fields. Log operations: `relay_room_ws_open`, `relay_room_ws_close`, `relay_room_ws_reconnect`, `relay_room_send_message`, `relay_room_send_ack`, `relay_room_send_error`, `relay_room_fetch_older`, `relay_room_participants_update`. NEVER logs raw event bodies or Matrix response payloads.
- **Assumption A4 (L50-57):** Matrix `unsigned.transaction_id` echo-back is trusted from backend `matrix-message-send.ts` passing frontend mqid verbatim as Matrix txnId.

**Backend WS wire types (from `relay-room-api.ts` L59-221):**
- Server → client: `session`, `participants`, `history_batch`, `live_event`, `send_ack`, `send_error`, `inactive`, `error`.
- Client → server: `connectToRoom`, `send_message`, `fetch_older_range`.

**Port plan for `useRelayAdapter`:** Move-as-blob per CONTEXT.md § Claude's Discretion. The 488-line hook is coherent, has no natural seams that would benefit from decomposition, and porting-in-place preserves all the discipline (structured logs, ref-based state, cleanup semantics) that took Slice D 7 plans to get right.

### Sender-attributed inbound bubble primitive (D-16 already resolved)

- **File:** `src/ui/features/pretty-view/RelayInboundBubble.tsx` (166 lines).
- **Origin:** tiffany's `relay-inbound-bubble-sender-hue-recolor` bounty, 2026-08-18.
- **Props:** `RelayInboundBubbleProps = Pick<RelayInboundEvent, "room" | "sender" | "body"> & { hostId: number; ts?: number }` (L56-67).
- **Data flow:** `resolveMxidToIdentity(sender, byKey)` → `{colorHue, displayName}` → applied as bubble tint + sender-dot color + display-name label.
- **Reuse plan:** Both harness case (already using this today for peer-agent-chatter parsed out of session transcript) and relay case (would need this after the retirement) consume this same primitive. Slice D's `RelayRoomInboundBubble.tsx` fork deletes; both cases use the shared original.
- **Wire-shape compatibility:** The harness case emits `RelayInboundEvent` shapes from session-transcript parsing (L124 in `session-file-parser.ts`). The relay case's WS `live_event` shapes are `MatrixEvent`. The relay-adapter must transform `MatrixEvent` → a shape compatible with `RelayInboundBubble` (sender, body, ts) OR the shared surface's message-list dispatch renders `MatrixEvent`s through a wrapper that adapts to `RelayInboundBubbleProps`. Planner's call — the transformation is one map step.

### Case-discrimination patterns in the codebase (D-07 precedent)

Confirmed precedents (grep-verified):
- **`src/ui/api/sessions-api.ts:22`** — `| RelayRoomSessionRow, discriminated on kind: "harness" | "relay-room"`. Same axis Phase 89 Slice B established at the session-model layer.
- **`src/backend/database/routes/sessions.ts:262-268`** — the sessions-list Promise.all block MUST set `kind: "harness" as const` for harness rows; other blocks use `kind: "relay-room"` for relay rows.
- **`src/backend/claude-session/session-file-parser.ts:115+124`** — `kind: "relay_outbound"` and `kind: "relay_inbound"` for parsed session events.
- **`src/ui/state/conversation-store.ts:121+199`** — `kind?: "harness" | "relay-room"` on FleetSession + row shapes.

The Phase 93 `ChatSurfaceSource` type follows the same convention; use "harness" | "relay" (not "relay-room") to name the axis at the pane level since D-05 keeps `sessionKind` distinct.

### Existing test structure for PrettyView + ComposeBox

- **PrettyView tests (15 files):**
  - `PrettyView.test.tsx` (main behavior)
  - `PrettyView.aside.test.tsx`
  - `PrettyView.autoplay.test.tsx`
  - `PrettyView.compose-send.test.tsx` ← **D-13 landing site for new relay-case send assertion**
  - `PrettyView.editable-file.test.tsx`
  - `PrettyView.hydration-cap.test.tsx`
  - `PrettyView.load-more.test.tsx`
  - `PrettyView.optimistic-bubbles.test.tsx` ← **D-14 landing site**
  - `PrettyView.phase29.test.tsx`
  - `PrettyView.plain-dom.test.tsx`
  - `PrettyView.reconnect-recovery.regression.test.tsx`
  - `PrettyView.role-modal-swap.test.tsx`
  - `PrettyView.session-rotation.test.tsx`
  - `PrettyView.task-pill.test.tsx`
  - `PrettyViewErrorOverlay.test.tsx` + `PrettyViewLoadingOverlay.test.tsx`

- **ComposeBox tests (13 files):** `ComposeBox.test.tsx`, `ComposeBox.aside-morph.test.tsx`, `ComposeBox.aside-props.test.tsx`, `ComposeBox.hold-to-mic.test.tsx`, `ComposeBox.plan-pending-disable.test.tsx`, `ComposeBox.queue-plus-tab.test.tsx`, `ComposeBox.queued-attachment.test.tsx`, `ComposeBox.queued-slot-paste.test.tsx`, `ComposeBox.reconnecting-disable.test.tsx`, `ComposeBox.recycle-disable.test.tsx`, `ComposeBox.send-funnel.test.tsx`, `ComposeBox.send-log-hook.test.tsx`, `ComposeBox.voice.test.tsx`.

- **Test-file convention:** Feature-specific tests live next to the production file with `<Feature>.<aspect>.test.tsx` naming. New Phase 93 tests should follow the same convention:
  - `PrettyView.source-prop.test.tsx` — asserts source prop routing (D-07/D-08)
  - `PrettyView.multi-badge.test.tsx` — asserts badge extension (D-01/D-02/D-03)
  - `PrettyView.relay-source.test.tsx` — end-to-end relay-case rendering (D-09/D-10/D-11/D-13)
  - `ComposeBox.mode-hide.test.tsx` — asserts Row 1 + attach hidden when mode=relay (D-11/D-12)
  - Existing `tabUtils.test.tsx` — update assertion (D-04/D-06)

- **Test mocking convention:** Existing tests use `vi.mock("./RelayRoomSessionPane", () => ({...}))` and `vi.mock("@/features/relay-room-pane/RelayRoomPane", () => ({...}))`. Update pattern: `vi.mock("@/features/pretty-view/PrettyView", () => ({ PrettyView: (props: {source: ChatSurfaceSource, ...}) => <div data-testid="mock-pretty-view" data-source-kind={props.source.kind}>...</div> }))`.

### Backend surface — untouched but referenced

Per D-10, the backend stays untouched. Confirmed contract points the new relay-adapter consumes:

- **WS endpoint (untouched):** `src/backend/relay-room-stream/relay-room-stream-server.ts` — the wire. Boot-imported per fix `57fcf2c2` (2026-09-09).
- **Wire types (from `relay-room-api.ts`):** documented above under "use-relay-room-stream anatomy → Backend WS wire types."
- **REST endpoint:** `GET /relay-room/:roomId/participants` returns `RelayRoomParticipantsResponse = { humans: HumanParticipant[], agents: AgentParticipant[] }`. Used as bootstrap fallback before WS `participants` frame lands.
- **Synapse admin API pivot (Phase 91 UAT fix `771bfcc9`, 2026-09-09):** Backend now uses Synapse admin API for message reads (no room-membership required for the `@skynet-admin` bot). Frontend consumes what backend serves; no adapter change needed.
- **Matrix send round-trip:** `matrix-message-send.ts` in the backend passes the frontend-supplied mqid verbatim as the Matrix txnId, enabling echo-correlation. Documented as Assumption A4 in the hook.

## Code Examples

### `ChatSurfaceSource` discriminated union (new)
```typescript
// src/ui/features/pretty-view/sources/chat-surface-source.ts
// Source: this document — pattern derived from CONTEXT.md D-07 + existing conventions
// verified at src/ui/api/sessions-api.ts:22, src/backend/database/routes/sessions.ts:262

export type ChatSurfaceSource =
  | {
      kind: "harness";
      hostId: number;
      tmuxSession: string;
      tabId?: string;
      // ... other harness-only fields (see PrettyViewProps for full list)
    }
  | {
      kind: "relay";
      roomId: string;
      roomTitle: string | null;
      // viewingUserMxid resolved inside the adapter via useViewingUserMxid()
      // per W#8 Slice D pattern — do NOT thread as prop
    };
```

### Case-selected adapter mount (new)
```typescript
// Source: proposed pattern — must satisfy React rules-of-hooks (see Pitfall 2)
// Option: single unified hook that internally switches, keeping call-order stable

// src/ui/features/pretty-view/sources/use-chat-surface-adapter.ts
export function useChatSurfaceAdapter(source: ChatSurfaceSource) {
  // Always call both underlying hooks — each internally no-ops for the
  // other case via an isVisible-style gate. Hook call order is stable.
  const harnessState = useHarnessAdapter(
    source.kind === "harness" ? source : { kind: "harness-idle" },
  );
  const relayState = useRelayAdapter(
    source.kind === "relay" ? source : { kind: "relay-idle" },
  );
  return source.kind === "relay" ? relayState : harnessState;
}
```

### Multi-badge anchor (new)
```typescript
// src/ui/features/pretty-view/MultiBadgeAnchor.tsx
// Source: pattern derived from CONTEXT.md D-01/D-02/D-03 + existing IdentityBadge.tsx anatomy

export interface MultiBadgeAnchorProps {
  source: ChatSurfaceSource;
  participants?: RelayRoomParticipantsResponse; // undefined for harness
  identityKey?: string | null; // for harness case
  hostId?: number; // for harness case
  // ... other pass-through props for IdentityBadge (onClick etc)
}

export function MultiBadgeAnchor(props: MultiBadgeAnchorProps) {
  if (props.source.kind === "harness") {
    // BYTE-IDENTICAL to today's L3349-3366 render — no wrapper container,
    // just the existing IdentityBadge with its own absolute positioning.
    // See PrettyView.tsx:3349-3366 for the exact prop threading.
    return props.identityKey != null ? (
      <IdentityBadge
        identityKey={props.identityKey}
        hostId={props.hostId!}
        /* … other props unchanged … */
      />
    ) : null;
  }
  // Relay case: leftward-growing row anchored at top-4 right-5.
  // Order: humans (alphabetical) then agents (alphabetical) per D-03,
  // right-aligned so the "first" (leftmost) participant is the "last" in DOM order,
  // achieved via flex-row-reverse anchored to the right edge.
  return (
    <div
      className="absolute top-4 right-5 z-[101] flex flex-row-reverse items-start gap-2"
      data-testid="multi-badge-anchor"
    >
      {/* Agents first-DOM (rightmost visually is the first "additional" badge
          adjacent to where the harness case would have its single badge) */}
      {sortedAgents.map((a) => (
        <AgentBadgeWithMeter key={a.mxid} agent={a} />
      ))}
      {sortedHumans.map((h) => (
        <HumanBadge key={h.mxid} human={h} />
      ))}
    </div>
  );
}
```

**⚠️ Layout caveat:** The exact `flex-row-reverse` vs. explicit ordering strategy needs a small experiment during the multi-badge slice — the goal is to preserve the harness case's exact badge position (`right-5` from viewport, badge itself ~200px wide). The relay case's leftward-growth achieves this by anchoring the container's right edge at `right-5` and letting badges push left as they're added. Planner may find `flex-row` + explicit right-to-left DOM ordering cleaner than `flex-row-reverse` (depends on how RTL text handling interacts). Verify with a quick render test during slice execution.

### ComposeBox mode-gate (extend existing)
```typescript
// src/ui/features/pretty-view/ComposeBox.tsx — added prop + conditional wrappers
// Source: pattern derived from CONTEXT.md D-11 + existing conditional-render patterns
// verified at ComposeBox.tsx:300 (showPaperclip) and L2312-2321 (Row 1 wrapper)

export interface ComposeBoxProps {
  // ... all existing props unchanged
  /**
   * Chat surface mode. When "relay", the Row 1 instrument bar (meter/reset/
   * queue/stop/thumbs-up/recap) and the Paperclip attach button are HIDDEN
   * monolithically per Phase 93 D-11. Textarea + Send visual shell unchanged
   * per D-12. When absent or "harness" (default), all existing chrome renders
   * as today.
   */
  mode?: "harness" | "relay";
}

// Inside render:
{mode !== "relay" && (
  <div className={cn("flex items-center gap-2 mb-[3px]", isTouchDevice ? "min-h-[44px]" : "min-h-8")}>
    {/* … existing Row 1 body verbatim … */}
  </div>
)}
{/* … */}
{showPaperclip && mode !== "relay" && (
  <button /* Paperclip attach */ />
)}
```

## State of the Art

Not applicable — this is a refactor of internal code, not adoption of a new library or ecosystem shift. Slice D shipped ~2 days ago (Phase 90, 2026-09-08 planning; Phase 91 UAT fix 2026-09-09). Phase 93 reverses Slice D's architectural choice within the same week based on Ashley's UAT reformulation.

## Assumptions Log

All findings above are verified via direct source-file reads (grep, line-referenced Read tool calls) or against locked CONTEXT.md decisions. No external documentation was consulted (none needed — no new libraries).

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The full 900-line ingestion effect at PrettyView.tsx:1854-2770 can be encapsulated cleanly as an adapter hook without harness-case regressions. | Existing Code Insights → PrettyView message state | If cleanroom extraction proves too risky, fallback to gating the existing effect on `source.kind === "harness"` and adding relay-adapter as a peer effect (lower risk, minor duplication). |
| A2 | `MatrixEvent` shapes from the relay WS can be adapted to `RelayInboundBubble` props (which today consume `RelayInboundEvent`) via a simple mapper. | Existing Code Insights → sender-attributed bubble | If shapes drift significantly, may need a thin `<RelayInboundBubbleForMatrixEvent>` wrapper. Minor. |
| A3 | `flex-row-reverse` anchored at `right-5` will visually preserve the harness case's single-badge position byte-identically. | Code Examples → Multi-badge anchor | If layout drift is visible, fall back to explicit right-to-left DOM ordering + `flex-row`. Verify during slice execution. |
| A4 | Vitest `.vitest/` cache staleness after deletion is the only build-artifact concern for retirement. | Runtime State Inventory | If additional build cache exists (e.g., TS incremental build info), executor may need `rm -rf` more paths. `npx tsc --noEmit` during retirement catches these. |
| A5 | The `renderTabContent` early-return at `tabUtils.tsx:314` (Phase 91 UAT fix) can be retired by hoisting the host-optional handling into `TerminalOrIdentitySessionPane` without other host-null-affecting behavior change. | Deletion Graph — external refs | If other code paths depended on the early-return's ordering (e.g., some effect that fires before the host-null check for relay tabs), those need explicit handling. Sweep during retirement slice. |

## Open Questions

1. **Should the harness-adapter extraction be a full clean rewrite or a gated-in-place approach?**
   - What we know: the ingestion effect at PrettyView.tsx:1854-2770 is ~900 lines with 8 `setMessages` sites, deeply intertwined with WS lifecycle + session-rotation + hydration cap + pane-state handling.
   - What's unclear: whether a full extraction can preserve every subtle behavior without regressions.
   - Recommendation: **gated-in-place** for slice 1 — leave the effect where it lives inside PrettyView, add a top-of-effect `if (source.kind !== "harness") return;` gate, and add relay-adapter as a peer effect gated on `source.kind === "relay"`. This ships the D-09 architectural goal (one message store, source-specific adapter feeding it) with minimum harness-case risk. A future convergence phase can do a clean extraction into a separate `useHarnessAdapter` file once the pattern proves out.

2. **Where does the multi-badge component live, and what's the shape?**
   - What we know: CONTEXT.md § Claude's Discretion explicitly leaves this to planner. The current single badge lives at PrettyView.tsx:3349-3366; extension is at the same anchor.
   - What's unclear: single vs. multi as a runtime shape — does the harness case ALSO route through the multi-badge component (with `participants.length === 1`), or does it keep the existing `<IdentityBadge>` call site byte-identical?
   - Recommendation: keep the harness case call site byte-identical (D-08 discipline: one hard case-check at the outer level). Multi-badge component is only mounted when `source.kind === "relay"`. This maximizes harness regression safety at the cost of a slight case-branch inside PrettyView.

3. **Does `IdentityBadge`'s absolute-positioning need loosening for cell use inside the multi-badge row?**
   - What we know: `IdentityBadge.tsx:110` bakes `absolute top-4 right-5 z-[101]` into its `rootClassName`. Slice D's `IdentityBadgeRow.tsx:110-114` worked around this by wrapping each badge in a `<div className="relative h-[72px] w-[220px]">` cell that establishes a positioning context so the absolute is scoped to the cell.
   - What's unclear: whether the multi-badge anchor should adopt the same wrapper-cell pattern (which works but is a hack) OR whether IdentityBadge should accept an optional `positioning?: "fixed" | "in-flow"` prop for cleaner in-row use.
   - Recommendation: adopt Slice D's wrapper-cell pattern for v1 (proven to work, minimum change). If the multi-badge extension proves too fiddly with the wrapper-cell hack, propose a small IdentityBadge extension in a followup slice.

## Environment Availability

No external tools required by this phase — pure frontend refactor. Vitest, TypeScript, React, Node.js all pre-installed and in use.

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| Node.js | dev + test | ✓ | project baseline | — |
| npm / vitest | test execution | ✓ | vitest ^4.1.8 | — |
| TypeScript | compile-time invariant enforcement (D-07) | ✓ | project baseline | — |
| React | component tree | ✓ | project baseline | — |

No missing dependencies. No fallbacks needed.

## Validation Architecture

`.planning/config.json` has `workflow.nyquist_validation: false`. Section skipped per the researcher role instructions.

## Security Domain

`.planning/config.json` has `workflow.security_enforcement: true`, `security_asvs_level: 1`, `security_block_on: "high"`. Applying:

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V2 Authentication | no | Phase 93 is a refactor with no auth-surface change. Existing auth (session cookies via `authApi`) unchanged. |
| V3 Session Management | no | Session tokens flow untouched through existing `authApi` interceptor. |
| V4 Access Control | no | Access control to relay rooms is enforced backend-side (`/relay-room/:id/participants` returns 403/404 for non-members, backend canonicalizes to same code per V8 no-existence-oracle discipline — see RelayRoomPane.tsx:181-190 comment). |
| V5 Input Validation | yes | Message body flows through React JSX children ({body}), NEVER through `dangerouslySetInnerHTML`. Preserved from tiffany's RelayInboundBubble.tsx:37 discipline (`T-17-03-01: body rendered via {body} in JSX`). Refactor MUST preserve this — Test 5 in `RelayInboundBubble.test.tsx` should port over. |
| V6 Cryptography | no | No new crypto surfaces. |
| V8 Information Disclosure | yes | Slice D's D-18 friendly-error state deliberately canonicalizes 403 (not-member) and 404 (not-exists) to the same UX ("This conversation is no longer available") to avoid an existence oracle. Phase 93 preserves this — the shared surface's error rendering must not distinguish the two. |
| V14 Configuration | no | No configuration surface changed. |

### Known Threat Patterns for {React + WebSocket + Matrix client}

| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| XSS via message body | Tampering | React JSX text-child rendering; NEVER use `dangerouslySetInnerHTML`. Preserved from RelayInboundBubble discipline. Test 5 in the bubble test asserts a body containing `<script>` tags renders as literal text. |
| Existence oracle via HTTP status | Information Disclosure | Backend canonicalizes 403 + 404 to same UX branch. Frontend adapter must not distinguish (see RelayRoomPane.tsx:181-190). |
| WS message injection / raw event log | Information Disclosure | Structured logging discipline (PATTERNS.md § 2 discipline from use-relay-room-stream.ts:41-48) — NEVER `JSON.stringify` a raw WS event or SyntheticEvent; explicit fields only. Preserve when porting. |
| Sensitive body content in logs | Information Disclosure | Structured `console.info` calls in send/ack/error paths NEVER log the body (privacy discipline). Preserve. |
| Matrix mxid enumeration via participants endpoint | Information Disclosure | Server-side already filters (participants endpoint returns only room members visible to the requester). Frontend consumes what's served; no additional gate needed. |
| Path traversal via roomId | Tampering | `encodeURIComponent(roomId)` on the participants REST URL (RelayRoomPane.tsx:163) — defense-in-depth vs. Matrix roomId chars `!` and `:`. Preserve when porting to the adapter. |

## Sources

### Primary (HIGH confidence — verified via direct source reads)
- `.planning/phases/93-relay-rooms-use-the-chat-surface-one-surface-two-data-source/93-CONTEXT.md` — all 21 locked decisions
- `.planning/shapes/shape-relay-room-pane-reuse-prettyview-pieces.md` — philosophy + scope edges
- `.planning/phases/90-relay-mediated-group-conversations-sub-slice-d-relay-session/90-CONTEXT.md` — Slice D's D-01/02/03 rationale being reversed
- `.planning/STATE.md` Roadmap Evolution entry 2026-09-09 — Phase 93 seed
- `src/ui/features/pretty-view/PrettyView.tsx` (4,087 lines) — badge anchor L3349-3366; message state L541; ingestion effect L1854-2770; handleComposeSend L1176-1180
- `src/ui/features/pretty-view/ComposeBox.tsx` (3,739 lines) — Row 1 L2312-2321; Paperclip L2881-2907; showPaperclip prop L300
- `src/ui/features/pretty-view/RelayInboundBubble.tsx` (166 lines) — tiffany's shared primitive (D-16)
- `src/ui/features/terminal/IdentityBadge.tsx` (338 lines) — badge anatomy + positioning L110
- `src/ui/shell/tabUtils.tsx` (373 lines) — dispatcher L187 + early-return L314
- `src/ui/shell/IdentitySessionPane.tsx` — PrettyView mount site + onSend wiring L268-336
- `src/ui/shell/RelayRoomSessionPane.tsx` (152 lines) — shell wrapper deleting
- `src/ui/features/relay-room-pane/*` (11 files, 4,275 lines) — full deletion inventory + use-relay-room-stream + AgentBadgeWithAppendage + IdentityBadgeRow + RelayMessageList + RelayRoomInboundBubble + error-state + relay-room-api reads
- `src/ui/components/ComposeBoxShell.tsx` (243 lines) — surviving primitive
- `src/ui/state/conversation-store.ts` — external comment ref L193
- `src/ui/AppShell.tsx` — external refs L1448 + L2151-2170
- `src/ui/state/viewing-user-store.ts` — JSDoc refs L6-10
- `src/ui/api/sessions-api.ts:22` — discriminated-union precedent
- `src/backend/database/routes/sessions.ts:262-268` — discriminated-union precedent
- `src/backend/claude-session/session-file-parser.ts:115+124` — discriminated-union precedent
- `.planning/config.json` — workflow toggles (nyquist_validation off; security_enforcement on)
- `package.json` — vitest version + test scripts

### Secondary (MEDIUM confidence — comment references)
- `src/backend/relay-room-stream/matrix-message-fetch.ts:106` — untouched but comment reference
- `src/ui/api/fleet-status-client.ts:292` — untouched but comment reference

### Tertiary (LOW confidence — none)
No LOW-confidence findings. All claims are directly verified against source files or locked CONTEXT.md decisions.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, all libraries in-project.
- Architecture: HIGH — 21 locked decisions + direct source reads; only planner discretion (per CONTEXT) remains at the fine-grained file-layout level.
- Pitfalls: HIGH — 6 pitfalls each grounded in a specific file+line reference or an explicit CONTEXT decision.
- Deletion graph: HIGH — full grep-verified inventory of external references.
- Test migration: MEDIUM — the mechanical shape is clear (D-21 spells it out) but the exact new-test-file breakdown is planner discretion.

**Research date:** 2026-09-09
**Valid until:** 30 days (refactor of stable codebase; no fast-moving external dependencies). Effectively valid until the phase ships or something else touches PrettyView / ComposeBox / relay-room-pane in the interim — if any of those files change before planning starts, re-read that file section.

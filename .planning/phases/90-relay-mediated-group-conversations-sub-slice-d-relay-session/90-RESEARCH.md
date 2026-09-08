# Phase 90: Relay-mediated group conversations sub-slice D — relay-session pane rendering with per-agent badge affordances - Research

**Researched:** 2026-09-08
**Domain:** Frontend React (TypeScript) — new pane component tree that renders Phase-89 room-backed sessions end-to-end, with minimal shared-primitive extraction from pretty-view. Backend touch is limited to (a) matrix-admin-client extensions for room message history + live subscription, (b) a WS or HTTP frame delivery path for live relay events, (c) `RemoteTmuxSession` type widening for the Phase-89 `kind` discriminator.
**Confidence:** HIGH on locked decisions and extraction inventory; MEDIUM on backend delivery-path shape (planner picks between WS piggyback vs. new endpoint vs. dedicated `/relay-room/websocket` route based on scope tradeoffs).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Architecture**
- **D-01: Two panes side-by-side, not one modified pretty view.** Build the relay pane as its own component tree, entirely separate orchestration. Pretty view (harness pane) is NOT modified in this slice.
- **D-02: Share truly-primitive pieces only. Don't share pane orchestration.** Shared: (a) `RelayInboundBubble` (already-shipped, reuse as-is); (b) outbound "you speaking" bubble (extract from ChatMessage's `isUser` branch); (c) compose textarea + send button visual shell. Not shared: data fetching, pagination trigger, top-of-pane chrome, attach/stop/recap wiring, per-participant state.
- **D-03: Don't refactor pretty view onto the shared primitives in this slice.** Extract primitives minimally, land relay pane on top, leave pretty view consuming its current private components.
  - **D-03 WAIVER (Ashley 2026-09-08, plan-checker review):** Fleet-status contextPct promotion is greenlit as a MECHANICAL state-source swap in PrettyView (swap `useState<number | null>` for `useSessionContextPct(hostId, tmuxSession)` hook; remove/no-op the WS `context_pct` handler). This is zero UX change, zero behavior change. Rest of pretty view remains off-limits.

**Compose box**
- **D-04: The whole upper area of pretty view's compose box vanishes in the relay pane.** No reset, meter, queue, stop, thumbs-up, recap. Reset + meter move to per-agent badge appendages (D-08).
- **D-05: Attach button HIDDEN entirely for v1.** Not disabled-with-tooltip — hidden.
- **D-06: Compose box lower area (textarea + send button) matches pretty view visually.** Extract as shared primitive; each pane passes in what its own upper area is.

**Identity-badge row**
- **D-07: Presence row layout.** Horizontal row at top of pane. One badge per participant EXCEPT the viewing user. Humans first then agents, alphabetical within each role. Not recency-shuffled, not fixed-at-room-creation.
- **D-08: Per-agent badge shape.** Reuse existing identity badges + shrunk meter/reset appendage hanging off the bottom.
- **D-09: Per-human badge shape.** Plain identity badge, no appendage, no meter, no reset. Absence of appendage is how viewer distinguishes humans from agents.
- **D-10: Per-agent state source.** Reuse pretty view's existing per-agent state channel — same context number and reset behavior whether viewed in the agent's own harness pane or its badge in a relay-room pane.
  - **D-10 DELIVERY MECHANISM (Ashley 2026-09-08, plan-checker review):** contextPct is PROMOTED from PrettyView-local `useState` to a per-session field on the fleet-status response. Both PrettyView and the relay-pane badge appendage subscribe to fleet-status via a new `useSessionContextPct(hostId, tmuxSession)` hook. Reset from the relay pane uses a new backend endpoint `POST /agent-reset/:hostId/:tmuxSessionName` that dispatches the same `/id reset` input the existing PrettyView reset button dispatches — pretty view's own reset button is rewired to use the same endpoint for consistency (D-03 waiver, mechanical swap).

**Bubbles + message history**
- **D-11: Inbound bubbles sourced directly from the relay** — NOT from parsed session transcripts. History from relay's own message-history endpoint (older) + live subscription (new).
- **D-12: Inbound bubble visual — reuse RelayInboundBubble** (shipped 2026-08-18 by tiffany, bounty `relay-inbound-bubble-sender-hue-recolor`). Same per-sender hue, left-alignment, resolved-identity dot.
  - **D-12 FORK CLARIFICATION (Ashley 2026-09-08, plan-checker review):** Ashley verbatim: *"in relay sessions, the collapsed nature of relay bubbles would not be what we want. And there really wouldn't be a collapse feature in the relay sessions because it doesn't make sense."* Fork `RelayInboundBubble` as `RelayRoomInboundBubble` (planner-flex on name) — a COPY-extraction that renders EXPANDED by default, has NO collapse/expand toggle, does NOT run pointer-detection (D-11 relay bubbles come from relay directly, not parsed transcripts — pointer-detect was for the transcript-parsed case). Preserves the sender-hue visual encoding + left-alignment + resolved-identity dot. Original RelayInboundBubble in pretty view stays untouched (D-03).
- **D-13: Outbound bubbles use existing right-aligned "you speaking" visual style.** Extract as shared primitive per D-02.b.
- **D-14: Message-history pagination — behavior matches pretty view 1:1.** Same initial load size, same scroll-back trigger, same batch size. Planner reads pretty view's implementation and matches.

**Send round-trip**
- **D-15: Send via the viewing user's own relay identity** (Phase 88 durable) into the room ID from the session record. Appears in the pane as outbound bubble.
- **D-16: Optimistic-send behavior matches pretty view.** Planner reads pretty view's implementation and matches.

**Edge cases**
- **D-17: Empty room state** — empty middle area + normal compose bar. No special empty-state chrome.
- **D-18: Room-not-found / membership-lost** — friendly error state in pane area, not a crash.
- **D-19: Inbound attachment** — minimal placeholder text (e.g., `attachment: <filename>`), media rendering deferred.

**Mobile**
- **D-20: Mobile layout intentionally deferred to v1.5.** Ship v1 with reasonable narrow-viewport behavior (horizontal scroll or wrap on identity-badge row, whichever falls out naturally).

### Claude's Discretion

- Concrete component tree structure for the relay pane (single file vs split across modules).
- Concrete primitive extraction shape (outbound bubble as single component vs. shell+text; compose shell as `<ComposeBoxShell>` with slot props vs. sub-components).
- Concrete kind-discriminator branching site (`PrettyView` entry vs. higher shell vs. router level).
- Concrete "friendly error state" copy + visual for D-18.
- Concrete pagination page-size + trigger — planner reads pretty view's implementation and matches; do NOT re-invent.
- Concrete optimistic-send match — planner reads pretty view's implementation and matches.
- Concrete "inbound attachment placeholder" text/rendering.
- Concrete responsive breakpoint / overflow behavior for identity-badge row on narrow viewports.
- Concrete data-fetching shape for message history + live subscription against the relay.

### Deferred Ideas (OUT OF SCOPE)

- Modification of pretty view (harness pane) — stays untouched EXCEPT for the D-03 mechanical waiver for fleet-status contextPct source-swap noted above. Any convergence work is a separate future slice.
- Session materialization (Phase 89 slice B — landed).
- Room creation (Phase 89 sibling slice C).
- Agent multi-participant etiquette (Phase 90 sibling slice E — directive-bank, not a `/build` cycle).
- Attach support in either direction (outbound send hidden; inbound placeholder minimal).
- Typing indicators, read receipts, streaming, per-message reply threading, message editing, message redaction, reactions.
- Unread markers on sidebar entries for room-backed sessions.
- Voluntary leave from a relay session (v1 has no leave affordance).
- Kick / remove-member affordance (membership fixed at creation for v1).
- Sidebar entry re-sort by `lastActivityAt` across the merged list (backend returns partitions; frontend re-sort is deferred to a later slice per Phase 89 D-15).
</user_constraints>

## Summary

Slice D is a **primarily-frontend, incrementally-additive** phase that consumes the Phase 89 backend (already landed on `feat/tab-title-from-tmux`) and Phase 88 human relay identities (also landed). It ships a new relay-session pane component tree side-by-side with the existing pretty-view harness pane, extracts a minimal set of genuinely-shared primitives from pretty view (outbound bubble + compose textarea/send shell), and wires kind-discriminator branching at the `IdentitySessionPane` level (or a peer shell wrapper) so that when a user clicks a `kind: "relay-room"` row in the sidebar, they land on the new pane instead of pretty view.

The load-bearing constraint is **do not touch pretty view** (D-01/D-03). The strongest guarantee against regressing the working harness pane is not editing its component tree. Every deviation from that discipline (e.g., "we'll just add one prop to PrettyView") is a scope violation the planner must reject.

Slice D's other load-bearing decision is **reuse pretty view's per-agent state channel** for the badge appendages (D-10). This is not new plumbing — the same `useSessionIsWorking` / `contextPct` sources drive both surfaces so the same agent's meter reads identically whether viewed on its own harness pane or as a badge appendage in a shared relay pane.

**Primary recommendation:** Structure the phase as (1) a Wave 0 "extract shared primitives" pair of small commits (outbound-bubble primitive + compose-shell primitive) with EXPLICIT zero-behavior-change tests on pretty view proving no regression, (2) a Wave 1 "new relay pane skeleton" that renders read-only from the relay history endpoint, (3) a Wave 2 "identity-badge row + per-agent appendages" that wires the badge row and per-agent state hook reuse, (4) a Wave 3 "compose + optimistic-send + live subscription" that closes the round-trip, (5) a Wave 4 "kind-discriminator wiring" that switches the sidebar-click flow to the new pane based on the Phase-89 marker. Planner locks concrete decomposition; this is the natural extraction-first-then-consume ordering the shape file explicitly calls out in § Vehicle notes.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Relay message history fetch (older messages) | API / Backend | — | Backend proxies Synapse admin API (`GET /_matrix/client/v3/rooms/{roomId}/messages?dir=b`) with admin credential; frontend must never see the admin token. Client-server API works with the admin token per `matrix-admin-client.ts` conventions. |
| Live relay subscription (new messages) | API / Backend | — | Same rationale as history — admin credential + Matrix `/sync` long-poll or per-room `/messages?dir=f&from=<cursor>`. Frontend receives parsed events over WS (piggyback on `/claude-session/websocket/` OR new `/relay-room/websocket/` endpoint — planner picks). |
| Outbound send (viewing user → room) | API / Backend | Browser | Backend mints access token via `loginAsUser(users.mxid)` (Phase 88 established) and issues `PUT /_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}`. Frontend posts a compose message; backend handles Matrix protocol. NEVER the reverse — the browser must never hold a human's Matrix access token. |
| Per-agent context meter / reset state | Frontend Server (existing) | Browser | Reuses existing `useSessionIsWorking` / `contextPct` channels driven by `session-working-store` + WS `context_pct` frames. No new plumbing — same store, same wire, same behavior. **REVISED per D-10 delivery mechanism:** contextPct is promoted to fleet-status; both surfaces subscribe via a new `useSessionContextPct(hostId, tmuxSession)` hook. Reset dispatches through a new backend `POST /agent-reset/:hostId/:tmuxSessionName` endpoint. |
| Identity-badge row (humans + agents) | Browser | — | Pure presentation; reads from existing `useIdentities()` (agents) + `getUsersListBasic()` (humans) stores. |
| Optimistic-send bubble lifecycle | Browser | — | Mirrors PrettyView's `pendingSends` state machine (D-16). Same mqid + FIFO-head-match + 20s timeout + flip-to-failed contract; different match source (relay event stream vs. session-transcript stream). |
| Kind-discriminator branching (sidebar → pane) | Browser | — | Frontend routing decision — reads `SessionListItem.kind` field from `/sessions/list` and mounts the appropriate pane component. |
| Sidebar entry rendering for `kind: "relay-room"` rows | Browser | — | Sidebar reads `FleetSession[]`; a new field on the store type (`kind?: "harness" \| "relay-room"`) carries the discriminator to the pane-open handler. |

## Standard Stack

### Core

Slice D does NOT introduce new libraries. Everything runs on existing dependencies. All listed packages are already installed and battle-tested in this codebase.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 18.x | Component framework | Skynet's frontend framework — no alternative considered [VERIFIED: package.json — react-dom + typescript-react patterns throughout codebase]. |
| TypeScript | 5.x | Type safety | Skynet convention; all fork frontend/backend is TS-strict [VERIFIED: tsconfig.json + `tsc --noEmit` gate in package.json scripts]. |
| Vitest | current | Test runner | Existing suite runs on vitest; PrettyView has ~15 `.test.tsx` files exercising the same seams slice D will exercise [VERIFIED: `npx vitest run` invocation + `.test.tsx` conventions in `src/ui/features/pretty-view/`]. |
| `useSyncExternalStore` (React 18) | built-in | External store subscription | `conversation-store.ts` + `session-working-store.ts` + `identities-store.ts` all use this pattern; new relay-pane state should follow suit [VERIFIED: grep `useSyncExternalStore` in `src/ui/state/`]. |
| Tailwind CSS | v4 | Styling | Skynet convention; RelayInboundBubble + IdentityBadge + ChatMessage all use Tailwind class strings [VERIFIED: `cn()` utility import + Tailwind classes throughout `src/ui/features/pretty-view/`]. |
| lucide-react | current | Icons | `RotateCcw`, `ChevronUp`, `Loader2`, `AlertCircle` used in existing ComposeBox / LoadMoreOlderButton [VERIFIED: import lines in `LoadMoreOlderButton.tsx` + `ComposeBox.tsx`]. |

### Supporting

| Utility | Location | Purpose | When to Use |
|---------|----------|---------|-------------|
| `useIdentities()` | `src/ui/state/identities-store.ts` | Agent-identity lookup by identityKey (colorHue, displayName, avatarUrl, coordinator, title) | Per-agent badge render — reuse for D-08 |
| `getUsersListBasic()` | `src/ui/api/user-management-api.ts` | Human user list — returns `{id, username}[]` | Per-human badge render — humans-first row |
| `useSessionIsWorking(key)`, `useSessionIsWorkingRaw(key)`, `useSessionIsRecycling(key)` | `src/ui/state/session-working-store.ts` | Per-session working / recycling state | Per-agent badge appendage — same channel PrettyView reads |
| `resolveMxidToIdentity(mxid, byKey)` | `src/ui/features/pretty-view/relay-mxid-resolve.ts` | mxid → `{colorHue, displayName}` resolution for inbound bubbles | Reuse for both bubbles and badge row identity resolution |
| `sessionMatchKey(name)`, `hueFromSessionName(name)`, `useSessionIdentity(...)` | `src/ui/features/terminal/session-hue.ts` | Session-name → identity-key + hue derivation | Existing convention for identity resolution on session-name-keyed pane surfaces |
| `openClaudeSessionSocket()` | `src/ui/api/claude-session-api.ts` | Opens the pane's long-lived WS to `/claude-session/websocket/` | Reference for how to open the relay-room WS (planner picks: piggyback on this WS with new frame types, or open a peer WS on a new endpoint) |
| `matrix-admin-client.ts` primitives | `src/backend/matrix/matrix-admin-client.ts` | 12 admin API wrappers (createOrUpdateUser, loginAsUser, joinRoom, getUserJoinedRooms, getRoomLatestEventTs, getRoomJoinedMembers, getSharedDMRoom, getRoomName, createRoom, deactivateUser, makeRoomAdmin, listRooms, countUsersMatching) | Extend with `getRoomMessages(roomId, dir, from, limit)` + `sendMessageAsUser(mxid, roomId, body, txnId)` for D-11 + D-15 |
| `DatabaseSaveTrigger.forceSave(reason)` | `src/backend/utils/database-save-trigger.ts` | Crown-jewel in-memory DB flush | Wrap every backend DB write (not expected to apply here — slice D is frontend-primary — but flag if any backend touch introduces DB writes) |
| `authApi.get/post` | `src/main-axios` (`src/ui/api/main-axios.ts`) | JWT-authenticated HTTP client | Fetch pattern for any new REST endpoints |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Widen `PrettyView` with a `kind` prop | Build separate `RelayRoomPane` component | D-01 EXPLICITLY REJECTS widening PrettyView. Rejected. |
| Extract compose shell as `ComposeBoxShell` with slot props | Extract as base `<ComposeBox>` + `<PrettyViewComposeBox>` / `<RelayComposeBox>` subclasses | Slot props (`upperArea?: ReactNode`, `attachButton?: ReactNode`) is the shape ComposeBox currently reads — 20+ optional props already gate feature areas. Slot-props extraction preserves conditional-render posture; subclass composition would introduce inheritance where none exists today. Planner's call; slot-props is the natural extraction. |
| Piggyback relay events on the existing `/claude-session/websocket/` route (route them via a new `kind` field on WS frames) | Open a new `/relay-room/websocket/` route with its own connection lifecycle | The claude-session WS is per-pane-per-session keyed on `hostId + tmuxSession`. A relay-room pane has no hostId (the room is on the relay, not on any host) and no tmuxSession. Piggybacking would require synthetic values or a new query-param schema. The peer-route approach is architecturally cleaner: a new WS keyed on `(userId, roomId)` mirrors how relay-room-sessions rows are keyed, and pane orchestration is entirely separate anyway (per D-02). Recommendation: **new WS route**. |
| Fetch older messages via HTTP endpoint | Send `fetch_older_range` on the WS (mirroring pretty view's Phase 47 pattern) | WS-based paginate is what pretty view does today; the relay pane can adopt the same pattern for consistency and to keep everything on one connection. But if planner picks the peer-WS-route approach, an HTTP `/relay-room/:roomId/messages?before=<eventId>` endpoint is equally reasonable and easier to test. Planner picks. |
| Full Matrix client SDK on the browser (matrix-js-sdk) | Backend-proxied all-the-way | Slice A D-08 established that humans have NO Matrix password of their own — every relay-side action is mediated by Skynet's backend via `loginAsUser`. Any browser-side Matrix client would need a token in the browser, which Phase 88 explicitly ruled out. **Rejected — backend-proxied is the only path.** |

**No new dependency installs are required.** The slice is a pure composition + extraction over existing dependencies.

## Package Legitimacy Audit

**Not applicable.** Slice D installs zero new external packages. Every capability is built from existing dependencies (`react`, `typescript`, `vitest`, `tailwindcss`, `lucide-react`, plus in-repo helpers). The Package Legitimacy Gate is skipped by design when the phase's Standard Stack has no `Installation` entries — same posture as Phase 89 (also zero new packages).

## Architecture Patterns

### System Architecture Diagram

```
                            ┌───────────────────────────────┐
                            │  Sidebar: PrettyConversations │
                            │        Panel (existing)       │
                            └──────────────┬────────────────┘
                                           │  row click →
                                           │  selectConversation(id)
                                           │  + onConversationSelected(id)
                                           ▼
                          ┌────────────────────────────────────┐
                          │   AppShell / SplitView pane mount  │
                          │   (existing — reads openTabs)      │
                          └──────────────┬─────────────────────┘
                                         │
                        Kind discriminator branch (NEW — Wave 4)
                                         │
                    ┌────────────────────┴────────────────────┐
                    │                                         │
     kind = "harness" (existing path)          kind = "relay-room" (NEW pane)
                    │                                         │
                    ▼                                         ▼
    ┌────────────────────────────┐            ┌────────────────────────────┐
    │  IdentitySessionPane       │            │  RelayRoomSessionPane      │
    │  (existing — Terminal +    │            │  (NEW — no Terminal, no    │
    │   PrettyView; unchanged)   │            │   PrettyView, own tree)    │
    └────────────────────────────┘            └────────┬───────────────────┘
                                                       │
                                    ┌──────────────────┼──────────────────┐
                                    │                  │                  │
                                    ▼                  ▼                  ▼
                          ┌────────────────┐  ┌────────────────┐  ┌────────────────┐
                          │ IdentityBadge  │  │ RelayMessageList│  │ RelayCompose   │
                          │ Row (top of    │  │ (bubbles list, │  │ (shared shell +│
                          │ pane — humans  │  │ paginated,     │  │ NO upper area, │
                          │ + agents +     │  │ live-subscribed)│  │ NO attach)     │
                          │ per-agent     │  └────────┬────────┘  └────────┬────────┘
                          │ appendage)     │           │                   │
                          └────────┬───────┘           │                   │
                                   │                   │                   │
              ┌────────────────────┼───────────────────┴───────────────────┘
              │                    │                                       │
              ▼                    ▼                                       │
   ┌────────────────────┐  ┌────────────────────────────────┐              │
   │ useIdentities()    │  │ RelayRoomStream WS (NEW)       │              │
   │ (agents)           │  │ /relay-room/websocket/         │              │
   │ getUsersListBasic()│  │  ← history batches             │              │
   │ (humans)           │  │  ← live events                 │              │
   │ useSessionIsWorking│  │  → outbound sends              │              │
   │ contextPct         │  │  → fetch_older_range           │              │
   │ (shared with       │  └────────────────┬───────────────┘              │
   │  PrettyView)       │                   │                              │
   └────────────────────┘                   │                              │
                                            │  authenticated,              │
                                            │  keyed on (userId, roomId)   │
                                            ▼                              │
                              ┌────────────────────────────────┐           │
                              │  Backend: relay-room-stream    │           │
                              │  server (NEW subsystem)        │           │
                              │  - resolves users.mxid         │           │
                              │  - loginAsUser → access_token  │           │
                              │  - GET rooms/../messages       │           │
                              │  - long-poll /sync or per-room │           │
                              │  - PUT rooms/../send/message   │           │
                              │  - never sends token to browser│           │
                              └────────────────┬───────────────┘           │
                                               │                           │
                                               ▼                           │
                              ┌────────────────────────────────┐           │
                              │  Synapse (relay homeserver)    │           │
                              │  (existing infrastructure)     │           │
                              └────────────────────────────────┘           │
                                                                           │
                                                                           │
                                                        (kind-marker read: Wave 4)
                                                                           │
                                                                           ▼
                                                        ┌────────────────────────────┐
                                                        │  /sessions/list (existing) │
                                                        │  returns SessionListItem[] │
                                                        │  with kind: "harness" |    │
                                                        │  "relay-room" per Phase 89 │
                                                        │  Plan 04                   │
                                                        └────────────────────────────┘
```

### Recommended Project Structure

```
src/ui/features/relay-room-pane/       # NEW — parallel to pretty-view/
├── RelayRoomPane.tsx                  # Top-level component (open peer to PrettyView)
├── RelayRoomPane.test.tsx             # High-level render + kind-branch tests
├── IdentityBadgeRow.tsx               # Horizontal row of participants (D-07/D-08/D-09)
├── IdentityBadgeRow.test.tsx
├── AgentBadgeWithAppendage.tsx        # IdentityBadge + shrunk meter + reset (D-08)
├── AgentBadgeWithAppendage.test.tsx
├── RelayRoomInboundBubble.tsx         # Forked expanded-always bubble (D-12 waiver)
├── RelayRoomInboundBubble.test.tsx
├── RelayMessageList.tsx               # Bubble list wrapper (scroll + pagination trigger)
├── RelayMessageList.test.tsx
├── use-relay-room-stream.ts           # Custom hook: opens WS, exposes history + live events
├── use-relay-room-stream.test.ts
├── relay-room-api.ts                  # HTTP/WS type contracts (frames, payloads)
└── error-state.tsx                    # Friendly D-18 error rendering

src/ui/features/pretty-view/           # UNCHANGED for slice D — locked by D-01/D-03
├── ...                                # Do not touch — EXCEPT the D-03 mechanical waiver:
                                       # PrettyView.tsx swaps `useState<number|null>` for
                                       # `useSessionContextPct(hostId, tmuxSession)` and the
                                       # WS `context_pct` handler becomes a no-op (backend
                                       # now writes to fleet-status shared map on emit).

src/ui/components/                     # SHARED PRIMITIVES (new extractions)
├── OutboundBubble.tsx                 # Extracted from ChatMessage.tsx isUser branch (D-02.b/D-13)
├── OutboundBubble.test.tsx
├── ComposeBoxShell.tsx                # Extracted textarea + send button (D-02.c/D-06)
└── ComposeBoxShell.test.tsx

src/ui/shell/
├── IdentitySessionPane.tsx            # UNCHANGED for slice D (pretty-view branch)
└── RelayRoomSessionPane.tsx           # NEW — mirror of IdentitySessionPane for room-backed sessions

src/backend/relay-room-stream/         # NEW backend subsystem (peer to relay-sessions/)
├── relay-room-stream-server.ts        # WS server: (userId, roomId) → auth + history + live
├── relay-room-stream-server.test.ts
├── matrix-message-fetch.ts            # Wraps matrix-admin-client for room /messages calls
├── matrix-message-fetch.test.ts
├── matrix-message-send.ts             # Wraps matrix-admin-client for room /send calls
└── matrix-message-send.test.ts

src/backend/fleet-status/              # EXTENDED for D-10 delivery
├── contextpct-store.ts                # NEW — per-session contextPct shared map (Wave 0)
├── contextpct-store.test.ts
├── types.ts                           # EXTEND: contextPct field on per-session record
└── wire-protocol.ts                   # EXTEND: contextPct on SessionStateSchema

src/backend/matrix/
└── matrix-admin-client.ts             # EXTEND: add getRoomMessages(), sendMessageAsUser()

src/backend/database/routes/
├── agent-reset.ts                     # NEW — POST /agent-reset/:hostId/:tmuxSession endpoint (Wave 0)
└── agent-reset.test.ts

src/ui/state/
├── viewing-user-store.ts              # NEW (or new hook alongside existing store) — exposes viewingUserMxid (Wave 0/1)
└── viewing-user-store.test.ts

src/ui/api/
├── sessions-api.ts                    # EXTEND: widen RemoteTmuxSession with kind + relay-room fields
├── fleet-status-client.ts             # EXTEND: expose useSessionContextPct(hostId, tmuxSession) hook (Wave 0)
└── relay-room-api.ts                  # NEW: type-only WS frame + HTTP payload contracts
```

**Rationale for the folder-scoped structure:** slice D introduces a whole new capability (relay-room panes) that has its own component tree, its own backend WS subsystem, and its own type-only contract module. Following Skynet's existing convention (each `features/<name>/` is one capability), the new folder `features/relay-room-pane/` is the right home. The shared primitives extraction lands under `src/ui/components/` — Skynet's existing convention for cross-feature primitives (e.g., `Button`, `Textarea` already live under `src/ui/components/`).

### Pattern 1: Kind-Discriminator Branch at IdentitySessionPane Level

**What:** When the sidebar-open handler resolves a `Tab`, the kind of pane component that renders is selected based on the `SessionListItem.kind` field carried through the store. Existing `IdentitySessionPane` is the current wrapper; add a peer `RelayRoomSessionPane` for `kind: "relay-room"` rows, and add a router-level branch that picks between them.

**When to use:** Wave 4 wiring — the final step after all extraction + new-pane construction is done.

**Example:**
```typescript
// src/ui/shell/PaneRouter.tsx (NEW helper — or inline the branch at the existing site)
// The branch lives at whatever site currently mounts IdentitySessionPane for a
// terminal-shaped tab. That site reads tab.hostId + tab.targetTmuxSession
// today. For relay-room tabs, hostId is null (no host) and targetTmuxSession
// is null too. The kind marker must be threaded through the tab shape.
function selectPaneForTab(tab: Tab, host: Host | null): ReactNode {
  if (tab.sessionKind === "relay-room") {
    // NEW: RelayRoomSessionPane mounted with roomId + roomTitle from the tab
    return <RelayRoomSessionPane
      tab={tab}
      roomId={tab.relayRoomId!}
      roomTitle={tab.relayRoomTitle}
      isVisible={/* per-tab visibility */}
    />;
  }
  // Existing path — unchanged
  return <IdentitySessionPane tab={tab} host={host!} … />;
}
```

**Where to thread the kind marker into `Tab`:** the `Tab` type (`src/types/ui-types.ts`) will need a new optional `sessionKind?: "harness" | "relay-room"` + `relayRoomId?: string` + `relayRoomTitle?: string | null`. The sidebar row-click path in `PrettyConversationsPanel.tsx` (L980-1003 `handleRowSelect`) calls `selectConversation(row.id)` from `conversation-store.ts` (L1225) + optional `onConversationSelected?.(row.id)` callback (L993/L998). The `kind` marker must ride along with the session-list item from `/sessions/list` (Phase 89 wire) into the `FleetSession` store row, then `selectConversation` picks up the kind marker, and downstream tab-spawn logic branches on kind. (Note: `openSessionInTree` at `AppShell.tsx` L1663 is a DROP handler for split-tree layout, NOT the row-click path.)

### Pattern 2: Backend-Proxied Matrix Client — Never Leak the Admin Token

**What:** All Matrix protocol calls happen on the backend. The browser sends application-level payloads (compose text, "fetch older", "send to room X") to the backend; the backend translates to Matrix protocol using the admin credential (`getMatrixAdminCreds()`) OR a fresh per-user access token minted via `loginAsUser(users.mxid)`.

**When to use:** Every backend endpoint slice D adds MUST follow this pattern. The Slice-A D-08 rule ("humans cannot log in to Element as themselves") is only enforceable if browsers never hold Matrix tokens. See existing `matrix-admin-client.ts` for the canonical pattern (Bearer admin token, discriminated-union `{ok:true, ...} | {ok:false, status, error}` return, `AbortController` 30s timeout, `encodeURIComponent` on every path arg).

**Example:**
```typescript
// src/backend/matrix/matrix-admin-client.ts — new primitive to add
// Source: extending the existing pattern (see createRoom L867, joinRoom L194)
export type SendMessageAsUserOk = AdminOk<{ eventId: string }>;

/**
 * Send a text message into a room AS a specific user (mints a per-user
 * access token via loginAsUser first, then uses THAT token — NOT the
 * admin token — for the send, so the resulting Matrix event's sender
 * is the human user, not @skynet-admin).
 */
export async function sendMessageAsUser(
  senderMxid: string,
  roomId: string,
  body: string,
  txnId: string,
): Promise<SendMessageAsUserOk | AdminErr> {
  const login = await loginAsUser(senderMxid);
  if (!login.ok) return login;

  const url = `${creds.homeserverBase}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(txnId)}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${login.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ msgtype: "m.text", body }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) return { ok: false, status: response.status, error: ERR_NON_2XX };
    const parsed = await response.json() as { event_id?: unknown };
    if (typeof parsed.event_id !== "string") {
      return { ok: false, status: 500, error: ERR_MISSING_FIELD };
    }
    return { ok: true, eventId: parsed.event_id };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    // Standard error handling — see matrix-admin-client.ts L111-121 pattern
    return handleErr(err, "matrix_admin_send_message_as_user");
  }
}
```

**Pitfall:** DO NOT reuse the admin token to send. If `@skynet-admin` sends `hello` into a room, every participant sees `@skynet-admin: hello`, not `@ashley_human: hello`. The `loginAsUser` mint-per-request pattern is what the existing agent-side recv.sh path uses (Phase 88 D-13 explicitly deferred the "cache access tokens" decision to whichever later slice needs them — that's THIS slice).

### Pattern 3: Reuse the Per-Agent State Channel — Don't Invent New State (D-10)

**What:** The pretty-view compose box's context meter reads `contextPct?: number | null` (`ComposeBox.tsx:256`) which is populated from the `context_pct` WS frame handled in `PrettyView.tsx:2269-2273`. The `session-working-store` publishes per-session working state keyed on `${hostId}:${tmuxSessionName}`. For the relay-room pane's per-agent badge appendage to show identical state, the appendage MUST subscribe to the SAME store keys.

**REVISED (D-10 delivery mechanism, Ashley 2026-09-08):** Rather than opening a hidden PrettyView WS per agent, `contextPct` is promoted to a per-session field on `fleet-status`'s response. The backend's existing `context_pct` emission in `claude-session-server.ts` (L3219 dormant branch + L7074 primary emission) is dual-written into a shared map that `fleet-status-server` publishes on every tick. Both surfaces (PrettyView after mechanical D-03-waiver swap; RelayRoomPane badge appendage) subscribe via a new `useSessionContextPct(hostId, tmuxSession)` hook. Same source of truth, same value, zero drift.

**When to use:** Wave 2 — badge appendage wiring. This is the D-10 correctness invariant.

**Example:**
```typescript
// src/ui/features/relay-room-pane/AgentBadgeWithAppendage.tsx
import { useSessionIsWorking, useSessionIsRecycling } from "@/state/session-working-store";
import { useSessionContextPct } from "@/api/fleet-status-client"; // NEW — Wave 0
import { useIdentities } from "@/state/identities-store";
import { IdentityBadge } from "@/features/terminal/IdentityBadge";

interface AgentBadgeWithAppendageProps {
  identityKey: string;    // agent's identity key (lowercased)
  hostId: number;         // agent's home host (from identity's fleet-derived host mapping)
  tmuxSessionName: string; // agent's own tmux session name — session-working-store key
  onResetClicked: () => void;  // Same handler pretty view fires
}

export function AgentBadgeWithAppendage(props: AgentBadgeWithAppendageProps) {
  const sessionKey = `${props.hostId}:${props.tmuxSessionName}`;
  const isWorking = useSessionIsWorking(sessionKey);
  const isRecycling = useSessionIsRecycling(sessionKey);
  const contextPct = useSessionContextPct(props.hostId, props.tmuxSessionName); // NEW — same source PrettyView reads
  // ... render existing IdentityBadge above + shrunk meter well + shrunk reset button below
  // The meter well is a scaled-down copy of ComposeBox's meter well (SEG_COUNT=12,
  // green/amber/red bands at 45/78 thresholds, same litCount calculation).
  // The reset button fires POST /agent-reset/${hostId}/${tmuxSessionName} which dispatches
  // the same /id reset input the existing PrettyView reset button dispatches.
}
```

**Pitfall:** DO NOT read `contextPct` from a new store or a new WS frame keyed differently. If two stores drift, D-10 is silently violated and the same agent's meter reads different values on the two surfaces — the exact failure the shape file flags in § What would make it wrong. The fleet-status shared map IS the single source of truth after Wave 0.

### Anti-Patterns to Avoid

- **Widening `PrettyView` with a `kind` prop and a branch.** Explicitly rejected by D-01. Every layer that "just needs one branch" grows into a kind-branch at every layer. (Note: the D-03 mechanical waiver is a state-source swap, NOT a kind-branch — PrettyView keeps rendering exactly what it renders today.)
- **Extracting shared primitives AND simultaneously migrating pretty view to consume them.** Explicitly rejected by D-03. The strongest guarantee pretty view doesn't regress is not editing it. If drift becomes a real problem later, a separate convergence slice migrates pretty view onto the shared primitives then. (Exception: the D-03 waiver for fleet-status contextPct source-swap is greenlit as mechanical/zero-behavior-change.)
- **Adding a disabled attach button with a "coming later" tooltip.** Explicitly rejected by D-05.
- **Reshuffling the identity-badge row by recency-of-last-message.** Explicitly rejected by D-07 (rejected during grill — restless).
- **Using `dangerouslySetInnerHTML` for any rendered relay text.** Every existing bubble primitive renders body via React text children — same discipline for slice D. Sender-side content from strangers is untrusted by default.
- **Streaming affordances (typing indicators, streaming spinners, auto-expand-while-streaming).** Fleet rule — no streaming anywhere ever (Ashley 2026-08-29). Every bubble renders atomically after send/receive lands.
- **Storing Matrix access tokens in the browser.** Slice A D-08 explicit rejection. Backend-proxied is the only path.
- **Piggybacking relay events on `/claude-session/websocket/` with synthetic hostId/tmuxSession values.** Cleaner to open a new WS route keyed on `(userId, roomId)` per D-02's "don't share pane orchestration."

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| mxid → displayName + colorHue resolution | New resolver | `resolveMxidToIdentity(mxid, byKey)` at `src/ui/features/pretty-view/relay-mxid-resolve.ts` | Already handles the full mxid grammar, `_human` suffix stripping, and neutral-grey fallback for unknown senders. Battle-tested via RelayInboundBubble since 2026-08-18. |
| Per-agent working state / context% | New per-agent state store | `session-working-store` + `useSessionIsWorking(key)`; `useSessionContextPct(hostId, tmuxSession)` from `fleet-status-client` (Wave 0) | D-10 correctness — two stores would drift. Wave 0 promotes contextPct to fleet-status so both PrettyView and the relay-pane badge subscribe to the same source. |
| WS reconnect with backoff + visibility handling | Custom scheduler | Mirror `PrettyView.tsx`'s pattern (patch #148 — `MAX_RECONNECT_ATTEMPTS=5`, linear-with-cap 2s/4s/6s/8s/8s, visibilitychange handler resets attempts) | Proven pattern for the same class of long-lived WS. |
| JSON serialization of a React SyntheticEvent for logging | `JSON.stringify(e)` | Extract explicit fields (see PATTERNS.md fleet-wide directive Ashley 2026-08-11) | JSON.stringify DOM/React events leaks huge object graphs and often throws on circular refs. |
| mxid grammar validation | Ad-hoc regex | `MXID_RE` at `src/backend/matrix/matrix-admin-routes.ts:30` — `/^@[a-z0-9._=/+-]{1,255}:[a-z0-9.-]{1,255}$/` | Canonical Synapse localpart grammar; used by Phase 88 sanitizer. |
| Matrix admin API calls | Raw fetch to Synapse | `matrix-admin-client.ts` primitives | Standard error discriminated union, 30s timeout, token scrubbing, encodeURIComponent path defense. Extend the file, don't parallel-implement. |
| Access token retrieval for a specific user | New token store | `loginAsUser(mxid)` from `matrix-admin-client.ts:135` | Uses admin auth to mint fresh per-user tokens; no password storage needed. Phase 88 D-13 explicitly named THIS slice as the one that picks the runtime-token strategy — the recommendation is mint-fresh-per-request (simple, higher latency, zero storage, matches how the identity-birth path uses it at `identity-birth-orchestrator.ts:779`). Cache-in-memory or persist-encrypted are v1.5 optimizations. |
| Message-history pagination UI | Custom load-more button | `LoadMoreOlderButton` at `src/ui/features/pretty-view/LoadMoreOlderButton.tsx` (pure component with `hasOlder`, `status`, `error`, `onClick` props) | Zero React hooks; already-shipped visual + a11y contract. Reuse as-is. **NOTE:** If the planner opts to extract this to `src/ui/components/`, do it as part of Wave 0 primitive extraction — but it's zero-risk to reuse from its current location too. |
| Optimistic-send bubble state machine | Custom pending-list | Mirror `PrettyView.tsx`'s `pendingSends` + `handleOptimisticSend` + `flipToFailed` (L1112-1304) | Same mqid + FIFO head-match + 20s timeout + failed-red-bubble contract. Don't reinvent. D-16 says match pretty view — this IS pretty view's implementation. Reference constants: `PENDING_SEND_TIMEOUT_MS_NORMAL = 20_000` (L139), `PENDING_SEND_TIMEOUT_MS_DORMANT = 220_000` (L140). The dormant path may or may not apply to relay-room sends — planner decides after checking whether relay-room "dormant" is a meaningful concept (probably not; relay rooms don't have a dormant state analogous to a Claude Code harness). |
| Room membership resolution | Frontend membership polling | Backend `getRoomJoinedMembers(roomId)` at `matrix-admin-client.ts:620` | Already exists (Phase 89 added it). Frontend requests the badge-row participant list from the backend; backend calls this primitive. |
| Room-not-found detection | Frontend probing | Let the backend return a `{ok:false, status:404}` or `{status:403}` on the initial history fetch and translate to a "friendly error state" flag | Simpler than probing membership separately; the backend is going to make the same underlying calls anyway. |
| Reset input dispatch from the relay pane | Cross-mounting a hidden PrettyView WS per agent | New backend endpoint `POST /agent-reset/:hostId/:tmuxSessionName` that dispatches the same `/id reset` input PrettyView's ComposeBox dispatches today (see ComposeBox.tsx L1867-1888 `dispatchResetPayload` → `funnel.send`) | Symmetry with the read-side: both surfaces call the same backend seam so reset behaves identically regardless of which surface fires it. Also lets PrettyView's own reset button be mechanically rewired to hit the same endpoint (D-03 waiver, mechanical). |

**Key insight:** Slice D is a *composition* of existing primitives, not a rewrite. Almost every state machine, resolver, and wire-protocol wrapper already exists in the codebase — mxid resolution, admin API wrapping, per-session state, WS reconnect discipline, pending-send lifecycle. The scope is (a) extract two shared component primitives (outbound bubble + compose shell), (b) fork RelayInboundBubble as RelayRoomInboundBubble (expanded, no-collapse), (c) add two backend Matrix API wrappers (`getRoomMessages`, `sendMessageAsUser`), (d) add one new backend WS route (relay-room-stream), (e) build the relay-pane component tree that composes all of it, (f) Wave-0 fleet-status contextPct promotion + agent-reset endpoint. Any task that starts feeling like "we need a new abstraction here" is a scope warning.

## Runtime State Inventory

Not applicable — slice D is not a rename/refactor/migration phase. It's an additive frontend + backend feature phase.

However, the following IS worth noting for planner awareness:

| Category | Items | Action |
|----------|-------|--------|
| Stored data | Phase 89 `relay_room_sessions` table (already exists) | Read-only consumer via `/sessions/list` merge (Phase 89 Plan 04). No new writes by slice D. |
| Live service config | None | — |
| OS-registered state | None | — |
| Secrets/env vars | Existing `matrix_admin_creds` singleton — no new secrets | Slice D reads via existing `getMatrixAdminCreds()`. Access tokens minted per-request via `loginAsUser` are ephemeral (in-memory only, never stored). |
| Build artifacts | None | — |

## Common Pitfalls

### Pitfall 1: "Just add a kind branch to PrettyView"
**What goes wrong:** The kind-branch grows at every layer of PrettyView — bubble list, WS handler, ComposeBox props, pane chrome — and PrettyView becomes a 4000-line file with two orthogonal codepaths compounding regression risk.
**Why it happens:** The surface similarity is a trap. Same-looking UI ≠ same-orchestrated implementation.
**How to avoid:** Follow D-01 strictly. If any planned edit touches `src/ui/features/pretty-view/*.tsx` files (except for reading them as reference), it's a scope violation — EXCEPT the D-03 mechanical waiver for the fleet-status contextPct source-swap in PrettyView.tsx (swap `useState` for `useSessionContextPct` hook; no-op the `context_pct` WS handler). That is greenlit; anything else is not.
**Warning signs:** A planner draft that says "widen PrettyView" or "add a `mode` prop to PrettyView."

### Pitfall 2: Per-agent state channel drift (D-10 violation)
**What goes wrong:** The badge appendage's context meter shows 40% while the same agent's own harness pane shows 65%. Or reset works on one surface but not the other. Two sources of truth for the same underlying agent state.
**Why it happens:** A planner might see "we need per-agent state" and decide to add a new store keyed on `mxid` or `identityKey`, not realizing the existing `session-working-store` already covers this — keyed on `hostId:tmuxSessionName`.
**How to avoid:** The badge appendage MUST resolve `(hostId, tmuxSessionName)` for each agent from the same fleet-derived identity → host mapping the sidebar already uses (`buildIdentityHostsFromFleet` at `src/ui/state/identities-store.ts:74`), then subscribe to `useSessionIsWorking(sessionKey)` with `sessionKey = \`${hostId}:${tmuxSessionName}\`` AND `useSessionContextPct(hostId, tmuxSessionName)` for the meter reading (both are fleet-status-fed after Wave 0).
**Warning signs:** A planner draft that adds `context_pct` fields to a new store, or wires the meter to any per-user or per-mxid state, or opens a per-agent WS just to read context %.

### Pitfall 3: Sending as `@skynet-admin` instead of the user
**What goes wrong:** Every message the user sends in a relay-room pane appears in the room as `@skynet-admin: hello` instead of `@ashley_human: hello`. Every other participant sees admin traffic, not user traffic.
**Why it happens:** Naive implementation reuses `matrix-admin-client.ts`'s admin credential for sends — that credential is the admin's, not the user's.
**How to avoid:** For sends, ALWAYS `loginAsUser(users.mxid)` first to mint a per-user token, then use THAT token in the `Authorization: Bearer …` header on the `PUT /rooms/{roomId}/send/m.room.message/{txnId}` call. Wrap this as a `sendMessageAsUser(senderMxid, roomId, body, txnId)` primitive in `matrix-admin-client.ts`.
**Warning signs:** Any backend send-path code that calls `PUT .../send/...` directly with `creds.accessToken` (the admin token).

### Pitfall 4: Optimistic-send match-and-replace fails because the wire source differs
**What goes wrong:** User sends "hello", the pending bubble appears optimistically, then the real relay event arrives and… never matches, so a duplicate "hello" bubble appears next to the pending one; eventually the 20s timer fires and the pending flips to red.
**Why it happens:** Pretty view matches pending sends against incoming user-role frames from the SESSION TRANSCRIPT (a Claude Code JSONL file). Relay-room bubbles come from RELAY EVENTS (Matrix events on a room). The "matching" primitive is different — for relay-room, the pending mqid must correspond to the `txnId` sent to Matrix, and the match is: incoming Matrix event where `event.sender === viewingUser.mxid` AND `event.content.body === pending.content` (or better, echo the `txnId` back via a backend-side correlation so exact matching is possible).
**How to avoid:** Design the backend send-path to correlate `mqid ↔ txnId` (both are client-generated random IDs; simplest is to use the mqid directly as the txnId — Matrix txnIds are opaque strings). Then the "match" is: incoming event where `sender === viewingUser.mxid` AND the event's `unsigned.transaction_id === mqid`. Matrix returns `transaction_id` on events sent by the same access token that sent them — this is a well-established Matrix pattern.
**Warning signs:** A planner draft that reuses pretty-view's FIFO-head-match verbatim without adapting the match source. The FIFO shape is fine; the match key differs.

### Pitfall 5: Pagination pattern mismatch — pretty view's works on line-numbers, relay doesn't have lines
**What goes wrong:** Pretty view's `handleLoadOlder` sends `{type: "fetch_older_range", beforeLine: oldestLoadedLine, count: 20}` on its WS. The relay pane can't use this frame — the relay's message-history pagination is by `event_id` cursor (Matrix's `from`/`to` params on `/messages`), not by line number.
**Why it happens:** D-14 says "match pretty view 1:1" for OBSERVABLE behavior (initial load size, scroll-back trigger, batch size — all 20 per Phase 47 `count: 20`). It does NOT say the wire protocol matches. The underlying data source is different by construction (D-11).
**How to avoid:** Design the relay-room WS's `fetch_older_range` payload with an event-id cursor: `{type: "fetch_older_range", beforeEventId: string, count: 20}`. The backend translates to Matrix's `GET /rooms/{roomId}/messages?dir=b&from=<eventId>&limit=20`.
**Warning signs:** A planner draft that copies pretty-view's `line` field verbatim onto the relay-room WS frame.

### Pitfall 6: Skipping the `nginx.conf` + `nginx-https.conf` dual-update
**What goes wrong:** New WS route `/relay-room/websocket/` gets added to backend but only added to one of the two nginx configs. In production, the deployed URL path 200s with `index.html` and the frontend crashes trying to parse a `.map` file (the classic nginx-caveat symptom).
**Why it happens:** Skynet's fork carries TWO nginx configs (`docker/nginx.conf` for HTTP dev + `docker/nginx-https.conf` for prod Caddy fronted). CLAUDE.md-equivalent (PROJECT.md § Constraints "Nginx caveat") is explicit — every new backend route needs matching location blocks in BOTH.
**How to avoid:** Every task that adds a new URL prefix MUST touch both files. Planner should add an explicit sub-task per WS/HTTP route: "add nginx location block to `docker/nginx.conf` AND `docker/nginx-https.conf` (matching the pattern of existing `location ^~ /claude-session/websocket/`)". Reference: `docker/nginx.conf:726` + `docker/nginx-https.conf:710` for the existing WS location shape. **This applies to BOTH `/relay-room/websocket/` (Plan 04 Task 2 WS) AND `/relay-room/` prefix-covering the participants REST endpoint (Plan 04 Task 3) AND `/agent-reset/` prefix (Wave 0).**

### Pitfall 7: Wrong build gate — `tsc --noEmit` doesn't catch backend errors
**What goes wrong:** Backend TS changes compile fine under `tsc --noEmit` (which only sees the frontend tsconfig), get committed, and then `npm run build:backend` fails in the deploy pipeline (or worse, Docker build fails).
**Why it happens:** The frontend and backend have different tsconfigs. `tsc --noEmit` at the repo root reads the frontend one. Backend errors only surface via `npm run build:backend` (which runs `tsc -p tsconfig.node.json`).
**How to avoid:** For every task that touches backend TS (any `.ts` under `src/backend/`), the planner MUST include `npm run build:backend` in the acceptance criteria alongside (or instead of) `tsc --noEmit`.
**Warning signs:** Backend-touching tasks that only list `tsc --noEmit` as the type-check gate.

### Pitfall 8: Ghost pane during the transient window between kick and observation-tick
**What goes wrong:** User is kicked from a relay room externally (via Element). The observation loop runs every ~10s; between kick and next tick, the sidebar still shows the row. User clicks it, the pane opens, tries to fetch history, gets a 403 from Matrix, and the UI crashes / shows a blank pane / errors dramatically.
**Why it happens:** Phase 89 D-03 established that external-kick → observation loop marks inactive on next tick. Between the kick and that tick, the pane can open.
**How to avoid:** D-18 explicit — friendly error state in the pane area when history-fetch returns 403/404. Copy: something like "This conversation is no longer available." Don't crash; don't show empty pane; don't retry indefinitely. On the next observation tick (within 10s), the sidebar entry itself drops (Phase 89 backend filters inactive rows) and the pane closes naturally.
**Warning signs:** A planner draft that has no error-state handling for the initial history fetch.

### Pitfall 9: Streaming/typing-indicator temptation
**What goes wrong:** Slice D is a group-chat UI; group-chat UIs conventionally have typing indicators, read receipts, streaming send-in-progress spinners.
**Why it happens:** Frontend intuition from every other chat product.
**How to avoid:** Fleet rule — NO STREAMING ANYWHERE EVER (Ashley 2026-08-29). Bubbles render atomically after send/receive lands. No typing indicators, no streaming-in-progress spinners, no auto-expand-while-streaming. The only "in-progress" affordance is the existing optimistic-send bubble (pending → sent OR pending → failed-red), which is discrete state transitions, not streaming.
**Warning signs:** Any task description containing "streaming", "typing indicator", "read receipt", "presence".

## Code Examples

### Example 1: Extract Outbound Bubble as Shared Primitive

**Source:** Adapted from `src/ui/features/pretty-view/ChatMessage.tsx` L430-490 (isUser branch)

```typescript
// src/ui/components/OutboundBubble.tsx
// Extraction target: the visual treatment of a user's own (right-aligned)
// bubble. Adapted VERBATIM from ChatMessage.tsx's isUser branch — same
// gradient, same border, same shadow, same warm off-cream text — with the
// isUser=false branch stripped out because this primitive is user-only.
//
// Consumers:
//   - PrettyView (future — via ChatMessage retirement in a later convergence slice; NOT in slice D per D-03)
//   - RelayRoomPane (slice D — this is the first consumer)
//
// The failed/pending state contract is preserved — same props shape as
// ChatMessage's isUser branch consumes (pendingState + attachments).
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

export interface OutboundBubbleProps {
  content: ReactNode;
  ts?: number;
  pendingState?: "sending" | "failed" | null;
  attachments?: Array<{ filename: string; size: number; mimetype: string }>;
}

export function OutboundBubble({ content, ts, pendingState, attachments }: OutboundBubbleProps) {
  const showSendingSpinner = pendingState === "sending";
  const showFailedBubble = pendingState === "failed";
  const bubbleInlineStyle: React.CSSProperties = showFailedBubble
    ? { position: "relative", background: "hsla(0, 60%, 35%, 0.90)", borderColor: "hsla(0, 70%, 50%, 0.85)" }
    : { position: "relative" };
  return (
    <div className="flex justify-end">
      <div
        title={ts !== undefined ? new Date(ts).toLocaleString() : undefined}
        style={bubbleInlineStyle}
        {...(showFailedBubble ? { "data-pv-bubble-failed": "true" } : {})}
        className={cn(
          "pv-bubble",
          "max-w-[90%] [overflow-wrap:anywhere] text-sm leading-relaxed",
          "rounded-[var(--radius-pv-bubble)]",
          "px-[12px] py-[7px]",
          "backdrop-blur-xl saturate-150",
          "[-webkit-backdrop-filter:blur(20px)_saturate(1.6)]",
          "border border-white/[0.08]",
          // User-bubble gradient — VERBATIM from ChatMessage L472-475
          "bg-[linear-gradient(160deg,rgba(45,55,80,0.55),rgba(28,35,55,0.6))]",
          "text-[#dfe3ee]",
          "border-[rgba(120,140,180,0.2)]",
          "shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,255,255,0.1)_inset,_0_0_0_0.5px_rgba(120,140,180,0.15)]",
        )}
      >
        {/* content + attachments + spinner render logic; adapt from ChatMessage L491-594 */}
        {content}
        {showSendingSpinner && (
          <Loader2 aria-hidden data-pv-bubble-spinner className="ml-1 inline-block h-3 w-3 animate-spin opacity-70" />
        )}
      </div>
    </div>
  );
}
```

**Note:** Do NOT retire ChatMessage's isUser branch in this slice (D-03). The extraction lives alongside; ChatMessage remains its own private implementation. A future convergence slice can migrate ChatMessage to consume `OutboundBubble`.

### Example 2: Compose Shell Primitive with Slot Props

**Source:** Extracted from `src/ui/features/pretty-view/ComposeBox.tsx` Rows 1 + 2 structure

```typescript
// src/ui/components/ComposeBoxShell.tsx
// Extracts the compose textarea + send button visual shell as a
// primitive. The upper area is a slot — pretty view fills it with
// meter/reset/queue/stop/thumbs-up/recap; the relay pane passes null
// (no upper area at all per D-04).
//
// This primitive is INTENTIONALLY lean — it does NOT own the
// pending-send state, the mqid generation, the WS write, the
// autoscroll hookup, or any of the ~20 optional prop features
// pretty-view's ComposeBox currently gates. Those live in the
// pane-orchestration layer.
import { useState, type ReactNode, type KeyboardEvent } from "react";
import { Textarea } from "@/components/textarea";
import { Button } from "@/components/button";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ComposeBoxShellProps {
  onSend: (text: string) => void;
  /** Slot for pane-specific upper controls. Pass null for no upper area. */
  upperArea?: ReactNode;
  /** Slot for a pane-specific attach control adjacent to the textarea.
   *  Pass null for D-05 (hidden entirely in relay pane). */
  attachButton?: ReactNode;
  placeholder?: string;
  canSend?: boolean;
  className?: string;
}

export function ComposeBoxShell(props: ComposeBoxShellProps) {
  const [text, setText] = useState("");
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const trimmed = text.trim();
      if (trimmed.length === 0) return;
      props.onSend(trimmed);
      setText("");
    }
  };
  return (
    <div className={cn("flex flex-col gap-1 px-2 pt-2 pb-2 shrink-0", props.className)}>
      {props.upperArea /* null in relay pane per D-04 */}
      <div className="flex items-end gap-2">
        <div className="relative flex-1 self-stretch">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={props.placeholder ?? "Type a message…"}
            rows={1}
            className="resize-none w-full h-full"
          />
          {props.attachButton /* null in relay pane per D-05 */}
        </div>
        <Button
          type="button"
          disabled={props.canSend === false || text.trim().length === 0}
          onClick={() => {
            const trimmed = text.trim();
            if (trimmed.length === 0) return;
            props.onSend(trimmed);
            setText("");
          }}
        >
          <Send className="size-4" />
        </Button>
      </div>
    </div>
  );
}
```

**Note:** This is a minimal shell. Pretty view's ComposeBox is a 3608-line file that will NOT consume this primitive in slice D (D-03). This primitive is for relay-pane consumption first; a convergence slice can migrate PrettyView later if drift becomes real.

### Example 3: Kind-Discriminator Branch Wiring

**Source:** Threading `SessionListItem.kind` through the frontend store + tab + pane-mount chain

```typescript
// src/ui/api/sessions-api.ts — WIDEN
export interface RemoteTmuxSession {
  // NEW: kind discriminator from Phase 89 Plan 04
  kind?: "harness" | "relay-room";
  // Existing harness fields (present when kind === "harness")
  hostId?: number;
  hostName?: string;
  sessionName?: string;
  created?: number;
  role?: string | null;
  lastMessageAt?: number | null;
  aiTitle?: string | null;
  // NEW: relay-room fields (present when kind === "relay-room")
  id?: string;            // relay_room_sessions.id (UUID)
  roomId?: string;        // Matrix room ID
  roomTitle?: string | null;
  lastActivityAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}
// Consider a discriminated-union refactor:
// export type RemoteSession =
//   | (RemoteTmuxSession & { kind: "harness" })
//   | (RemoteRelayRoomSession & { kind: "relay-room" });
// Backward-compat: kind absent → treat as "harness" (defense for old caches).

// src/ui/state/conversation-store.ts — WIDEN FleetSession similarly
export type FleetSession = /* current shape */ & {
  kind?: "harness" | "relay-room";
  roomId?: string;
  roomTitle?: string | null;
};

// src/types/ui-types.ts — WIDEN Tab
export interface Tab {
  // existing fields...
  sessionKind?: "harness" | "relay-room";
  relayRoomId?: string;
  relayRoomTitle?: string | null;
}

// Sidebar row-click site: src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
// L980-1003 handleRowSelect currently calls selectConversation(row.id) +
// onConversationSelected?.(row.id). The kind marker rides along with the
// FleetSession row (widened above). Downstream: selectConversation picks up
// the kind marker, and the tab-open helper (or its callback) branches on kind
// when constructing the Tab.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Session list derived at request time by SSH-polling every host | Same, PLUS merged with stored `relay_room_sessions` rows | Phase 89 (2026-09-08, this branch) | `/sessions/list` response now includes `kind` field; frontend needs to consume it (slice D). |
| Human relay identity: whatever exists (probably Telegram bridge machinery) | Every user has `users.mxid` populated at create time by Skynet-owned mint via `createOrUpdateUser`. Sanitizer `_human` suffix. | Phase 88 (2026-09-08, this branch) | Slice D can rely on every user having a durable relay identity. |
| Inbound bubbles come from parsed session transcripts (peer-agent chatter in one-on-one panes) | For relay-room panes: bubbles come from the RELAY DIRECTLY via message-history endpoint + live subscription (D-11) | Slice D introduces this | Two different data-source paradigms coexist. Pretty view's transcript-parsing is unchanged. |
| Compose box is monolithic, part of PrettyView tree | Compose textarea + send button visual shell extracted as shared primitive; each pane fills in what its upper area is (D-06) | Slice D introduces this | Enables second pane (relay-room) to reuse the shell without inheriting pretty-view's meter/reset/queue/stop/thumbs-up/recap. |
| Per-agent state (context %, working, recycling) sourced from pretty-view's own WS + `session-working-store` | contextPct promoted to fleet-status shared map; both PrettyView (via mechanical D-03 waiver) and relay-pane badge appendage subscribe to `useSessionContextPct(hostId, tmuxSession)` (D-10) | Slice D Wave 0 introduces this | No divergence risk between "same agent viewed as PV pane" and "same agent viewed as badge appendage." |

**Deprecated/outdated:**
- Nothing deprecated by slice D. Slice D is purely additive.
- **Explicitly NOT deprecated:** Pretty view for harness sessions stays exactly as it is (D-03 EXCEPT the mechanical fleet-status contextPct source-swap waiver). Peer-agent-chatter inbound bubbles in one-on-one panes stay exactly as they are (parent shape file "Philosophy" — visible-if-you-expand-the-collapsed-bubbles semantics preserved). The forked `RelayRoomInboundBubble` (expanded, no-collapse) is the RELAY-ROOM-PANE variant; the original RelayInboundBubble stays put for pretty view.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Extracting `OutboundBubble` from ChatMessage's isUser branch without altering ChatMessage is a small enough diff to not risk pretty-view regression. | Code Example 1 | If the extraction requires refactoring shared style constants or provider context, pretty view could be indirectly affected. **Mitigation:** the primitive is standalone; extract as a COPY (not a shared import) if that keeps ChatMessage untouched. Fits D-03 exactly. |
| A2 | Slice C (create-room modal) will land BEFORE or IN PARALLEL WITH slice D, so users have some way to CREATE relay rooms before slice D lets them render them. | Overall scope | If slice D ships without slice C, users can only see rooms externally-invited (e.g., another user's slice-C create-flow, or an Element user creating a room). **Not a blocker** — the observation loop materializes any room the user's mxid joins by any route (Phase 89 D-08). Slice D can ship standalone; slice C just makes it more useful. |
| A3 | Mint-fresh-per-request via `loginAsUser` is the right runtime-token strategy for slice D (Phase 88 D-13 explicitly left this decision to whichever later slice needed it). | Don't Hand-Roll table | If the latency cost is unacceptable (each send requires two Matrix round-trips: login + send), we may need mint-and-cache-in-memory. **Mitigation:** measure in dev; a 200-400ms extra round-trip is probably acceptable for a chat send. Cache-in-memory is a v1.5 optimization. |
| A4 | Matrix's `unsigned.transaction_id` echo-back on same-sender events is available and works reliably for the mqid↔txnId correlation pattern (Pitfall 4). | Common Pitfalls | If the echo-back doesn't work in Synapse's implementation (or under specific room encryption modes), the pending-send match logic needs to fall back to content-equality matching. **Mitigation:** verify with a `curl` probe against the local Synapse before committing to the pattern; if unreliable, use content+sender+ts-window matching. |
| A5 | Building the relay pane as its own new WS route (`/relay-room/websocket/`) is architecturally cleaner than piggybacking on `/claude-session/websocket/`. | Alternatives Considered | If backend infrastructure discourages more WS routes, the piggyback path is available. **Mitigation:** planner's call at Wave 1; both are architecturally sound. Recommendation is new-route for the reasons in the Alternatives table. |
| A6 | `getUsersListBasic()` returns enough for humans-first badge row rendering (id + username). | Standard Stack Supporting table | Human avatars are already shipped (per parent shape file "Prior context" — "Human avatars … landed independently"). If the users-list endpoint doesn't include the avatar URL, a second fetch or an endpoint extension is needed. **Mitigation:** verify against `src/ui/api/user-management-api.ts` shape at plan time; if avatar URLs aren't included, extend the endpoint or use a separate `/users/:id/avatar` endpoint. |
| A7 | Pretty view's Phase 47 pagination (`count: 20`, `WORKING_SET_CAP = 20`, `LoadMoreOlderButton` visual pattern) is what "match 1:1" means per D-14. | Common Pitfalls / Don't Hand-Roll | If D-14 was meant to preserve behavior beyond these three axes (e.g., insertion-sort by line, auto-scroll behavior, capOff mechanics), those may also need porting. **Mitigation:** planner reads pretty view's message-list rendering thoroughly at Wave 1 planning; the core three are the concrete numbers. Other behaviors adapt as needed given the different data source. |
| A8 | The existing `UserInfo` return of `getUserInfo()` (`src/ui/main-axios.ts` L109-117) does NOT include `mxid` today. | Warning W#8 resolution | Slice D needs a viewingUserMxid source. **Resolution:** Wave 0/1 adds either (a) a new `mxid` field on `UserInfo` + backend `/users/me` extension, or (b) a dedicated `src/ui/state/viewing-user-store.ts` that fetches `users.mxid` from a new small endpoint. Planner picks; the store approach is smaller-diff and does not require touching the auth-heavy `main-axios.ts` file. |

## Open Questions (RESOLVED)

1. **How does the frontend obtain the room's participant list for the badge row?**
   - What we know: `getRoomJoinedMembers(roomId)` exists in `matrix-admin-client.ts` (backend). Backend can return the mxid list; frontend resolves each mxid to identity via `resolveMxidToIdentity` (agents) or a users lookup (humans).
   - What's unclear: Is there an existing endpoint that returns participants for a room? Or does slice D add one?
   - **RESOLVED:** Add `GET /relay-room/:roomId/participants` returning `{humans: [{mxid, displayName, userId}], agents: [{mxid, identityKey}]}` — computed on the backend using the Phase 89 registry-room membership (agents registry room from Phase 89 D-09) so the human/agent classification does not leak to the frontend. See Plan 04 Task 3.

2. **Does live-subscription really need to be a WS, or can it be long-polling from the backend?**
   - What we know: The claude-session WS is a WS. Fleet convention leans WS.
   - What's unclear: Matrix's own live-events mechanism is `/sync` long-poll. The backend can long-poll `/sync`, then push events to the browser via a WS OR SSE OR long-poll HTTP.
   - **RESOLVED:** WS route `/relay-room/websocket/?roomId=<id>` — matches Skynet convention (claude-session and PrettyView both use WS). Long-poll from backend to Matrix (`/sync` or per-room `/messages?dir=f&from=<cursor>`) is an implementation detail behind the WS boundary; the browser-facing wire is WS. See Plan 04 Task 2.

3. **What is the exact "friendly error state" copy/visual for D-18?**
   - What we know: Discretion is with planner/designer.
   - What's unclear: Which existing empty/error state visual in Skynet is the best baseline?
   - **RESOLVED:** Baseline on the existing `PrettyViewErrorOverlay` (or equivalent error-state component — planner grep-verifies at plan time). Copy: "This conversation is no longer available." for kicked/gone; "Loading…" for transient. Exact wording is planner's judgment. NO retry button (nothing to retry — the room genuinely doesn't exist for this user anymore). See Plan 05 Task 1 (error-state.tsx).

4. **Does the relay pane need to handle "empty room" (D-17) differently from "room-not-found" (D-18)?**
   - What we know: D-17 says empty room → empty middle area + normal compose bar (no special chrome). D-18 says friendly error state.
   - What's unclear: How does the frontend distinguish? If a `GET /rooms/{roomId}/messages` returns an empty chunk, is that "empty room" or "not-a-member"? (For a non-member, Synapse typically returns 403.)
   - **RESOLVED:** HTTP-status-based. 200 with empty message chunk = empty room (D-17, render normal pane with no bubbles). 403/404 = room-not-found or membership-lost (D-18, render friendly error state via `RelayRoomErrorState`). The backend `fetchRoomHistory` service canonicalizes 403/404 to `{ok:false, status:403|404, error:'not_member'|'not_found'}` which the WS server translates to an `inactive` frame. See Plan 04 Task 1 (matrix-message-fetch.ts).

5. **Does the outbound bubble need to render "sending" (spinner) → "sent" (settled)?**
   - What we know: D-16 says match pretty view.
   - What's unclear: Pretty view's optimistic bubble transitions sending → matched-and-replaced-by-real-message OR sending → failed-red. There is no explicit "sent" state; the pending bubble IS the sent bubble until the real one arrives.
   - **RESOLVED:** No explicit "sent" visual state. The pending bubble is simply REMOVED when the real inbound event arrives (matched via `mqid == Matrix unsigned.transaction_id` per Pitfall 4); the real event then renders as an OutboundBubble WITHOUT the sending spinner. Failed sends turn the pending bubble red per D-16 (matches pretty view's existing failed-send treatment; grep `data-pv-bubble-failed` in ChatMessage.tsx for the visual class-set to preserve). See Plan 06 Task 1 (use-relay-room-stream.ts pending-send FIFO).

## Environment Availability

Slice D is a code-only phase — no new external CLI tools or services are required.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Synapse homeserver | Backend Matrix API calls | ✓ | (in-fleet, per Phase 88/89) | — |
| `matrix_admin_creds` singleton | Backend admin API calls | ✓ | (populated by Phase 75 + validated by Phase 88/89) | — |
| Node.js runtime | Backend | ✓ | (existing) | — |
| Docker + nginx | Deploy | ✓ | (existing) | — |
| Human user has `users.mxid` populated | Backend send-path | ✓ | (Phase 88 landed) | For a legacy user with `mxid = null` — Phase 88 D-12 explicitly excluded OIDC; the send path SHOULD refuse and surface an error state. Planner covers this edge case. |

**Missing dependencies with no fallback:** none.

**Missing dependencies with fallback:** none — all environmental prerequisites landed in Phases 88 and 89.

## Security Domain

`security_enforcement: true` in `.planning/config.json`. Slice D touches auth, cross-user data (rooms with other participants), and messaging — security review is mandatory.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing JWT (via `authenticateJWT` middleware — see `sessions.ts:294` for the canonical pattern). New WS route `/relay-room/websocket/` MUST authenticate via the same mechanism. |
| V3 Session Management | yes | Existing session cookies + JWT. No new session concept. Matrix access tokens minted per-request via `loginAsUser` are ephemeral (in-memory only, never sent to browser). |
| V4 Access Control | yes | Every backend endpoint MUST verify the authenticated `req.userId` matches the `users.id` associated with the operation. For relay-room operations: `SELECT ... FROM relay_room_sessions WHERE user_id = ? AND room_id = ?` before proceeding with any Matrix API call. For agent-reset: verify user's fleet ownership of the target host + tmux session. |
| V5 Input Validation | yes | Every user-supplied string that reaches Matrix (compose body, room_id path arg, etc.) MUST be validated. Room IDs: `/^![a-zA-Z0-9._=-]+:[a-zA-Z0-9.-]+$/` (Matrix spec). Compose body: length cap + no NUL bytes. |
| V6 Cryptography | yes | No new cryptographic code. Rely on Synapse for TLS + Matrix event integrity. AES-encrypted SQLite for `matrix_admin_creds` — already existing. |
| V7 Error Handling & Logging | yes | Every error path logs at boundary via `databaseLogger` / `authLogger`. NEVER log the admin access_token OR any user access token. NEVER include Matrix response bodies in error responses to the browser (they leak protocol details and possibly tokens). |
| V8 Data Protection | yes | Room-list membership is user-scoped (Phase 89 already enforces). Pane content contains room-participant PII (mxids, displayNames). Standard practice: browser only sees data for rooms the authenticated user is a member of. Never enumerate rooms across users. |
| V9 Communications | yes | HTTPS in prod via Caddy edge + nginx-https.conf; WSS for the WS route. Existing infrastructure. |
| V10 Malicious Code | no | No user-uploaded code paths; no eval; no dynamic imports. |
| V13 API and Web Service | yes | See V2/V4 above. New endpoints follow existing `authApi` conventions. |

### Known Threat Patterns for the slice-D stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Admin credential exposure to browser | Information Disclosure | NEVER return `matrix_admin_creds.access_token` or `loginAsUser(...).accessToken` in any HTTP response or WS frame. Backend uses them internally and discards. Audit every response body during code review. |
| Cross-user room access (User A accesses User B's room) | Elevation of Privilege / Information Disclosure | Every backend handler verifies `req.userId` owns the target row: `SELECT id FROM relay_room_sessions WHERE user_id = ? AND room_id = ?` BEFORE any Matrix call. Missing row → 404. Do not distinguish "not a member" from "row not found" in error responses (avoids room-existence oracle). |
| Path traversal via roomId query param | Tampering | Validate roomId against Matrix room-id grammar; `encodeURIComponent` on every path arg in Matrix URLs (existing `matrix-admin-client.ts` pattern). |
| XSS via inbound message body | Tampering / repudiation | React text children (never `dangerouslySetInnerHTML`) — existing RelayInboundBubble discipline. Preserve for RelayRoomPane and the forked RelayRoomInboundBubble. |
| Session-fixation via WS URL params | Elevation | WS auth via httpOnly session cookies + JWT check on connection open — same pattern as `/claude-session/websocket/`. Do NOT accept `userId` from the WS URL/query. |
| Race between kick and observation-tick (ghost pane) | Denial of Service (soft) / Information Disclosure (if the backend leaks whether the user was ever a member) | Frontend: friendly error state on 403/404 (D-18). Backend: return 404 for both "row not found" and "user not a member" to avoid an oracle. |
| Attachment placeholder rendering (inbound message with attachment metadata) | Tampering | Minimal placeholder text only (D-19). NEVER auto-fetch remote media URLs (SSRF risk); NEVER download and re-serve inline (leaks browser fingerprint). If future slice ships attach, that's when attach-fetch security is designed. |
| Denial of service via rapid send | Resource exhaustion | Rate-limit compose sends server-side (a simple per-user token bucket on the /relay-room WS handler is sufficient v1). |
| CSRF on POST-style HTTP endpoints (if planner chooses HTTP over WS for send path) | Cross-Site Request Forgery | Skynet's existing SameSite=Lax cookies + JWT bearer via `authApi` conventions cover this. Do NOT add new endpoints that accept plain-cookie auth without JWT. |
| Agent-reset cross-user misuse | Elevation of Privilege | `POST /agent-reset/:hostId/:tmuxSessionName` MUST verify the authenticated user owns/has-access-to the target host (grep the existing fleet-ownership gate — e.g., how `/claude-session/websocket/` gates hostId access). Missing/wrong owner → 404 (no oracle). |

### Fleet-wide security invariants (from PROJECT.md § Constraints — treat as CLAUDE.md-equivalent authority)

- **Every backend write to a user row must be paired with `DatabaseSaveTrigger.forceSave(<reason>)`.** Not expected to apply to slice D (frontend-primary; no new DB writes) — flag if any backend touch introduces DB writes.
- **Every new URL prefix needs matching `location` blocks in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf`.** Applies to the new `/relay-room/websocket/` route, `/relay-room/` REST prefix (participants endpoint), AND `/agent-reset/` prefix (Wave 0).
- **AES-encrypted SQLite for `matrix_admin_creds`, `telegram_bot_tokens`.** No new secrets stored in slice D.
- **Executor doesn't ship** (fleet rule Ashley 2026-08-08). Plans do NOT include ship tasks. Executor stops at code + commit + scoped tests green.

## Project Constraints (from PROJECT.md — no CLAUDE.md present)

Skynet does not have a `CLAUDE.md` in the repo root. `PROJECT.md` § Constraints is the authoritative source of code + deploy rules. All items below are treated as CLAUDE.md-equivalent directives for slice D.

- **Tech stack:** React + TypeScript frontend; Node/Express backend on Drizzle ORM over AES-encrypted SQLite; Docker Compose; Caddy 2 edge; guacd 1.6.0 for RDP/VNC. Slice D adds no new tech; extends the frontend + backend.
- **Rebase-ability:** Every fork commit must survive rebases against upstream `main`. Slice D commits are additive frontend + backend + Matrix client extensions; expected to rebase cleanly.
- **Deploy safety:** `docker compose up -d --force-recreate skynet` runs behind the 15-min deadman rollback timer. NOT applicable to slice D execution (executor doesn't ship) — but the ship phase (arc-close, orchestrator-owned) must honor this.
- **Blast radius:** A bad deploy loses Ashley access to her whole fleet. Slice D touches auth + WS + Matrix — all of these have "silently break Ashley's session" failure modes. Extra caution on the WS route addition (nginx location block MUST be correct in both configs).
- **Encryption:** Existing FieldCrypto layer for secrets; slice D stores no new secrets.
- **Nginx caveat:** BOTH `docker/nginx.conf` AND `docker/nginx-https.conf` need matching `location` blocks for new URL prefixes. Applies to the new relay-room WS route AND the /relay-room/ REST prefix AND the /agent-reset/ prefix.
- **Test scope during dev:** scoped tests only (`--related <files>` or targeted `src/ui/features/<feature>/`); full suite runs at orchestrator ship-gate. Every plan task green-gate is `npx vitest run` scoped to the touched files.
- **Executor doesn't ship:** No ship task in the plan.
- **`DatabaseSaveTrigger.forceSave` invariant:** Applies to any backend DB write (not expected in slice D).
- **Structured logging at boundaries:** Every WS connect/disconnect/frame-in/frame-out, every send-path outcome, every observation-loop tick — log via `databaseLogger` / `authLogger` / `sshLogger` with explicit field extraction (never `JSON.stringify(event)`). See `PATTERNS.md` fleet-wide directive Ashley 2026-08-11.

## Sources

### Primary (HIGH confidence)

- **`.planning/phases/90-.../90-CONTEXT.md`** — 20 locked D-decisions (D-01..D-20) walked with Ashley 2026-09-08.
- **`.planning/shapes/shape-relay-session-pane-rendering.md`** — Shape file this CONTEXT.md was seeded from; fuller narrative on rationale.
- **`.planning/shapes/shape-relay-mediated-group-conversations.md`** — Master arc shape; orthogonality invariant.
- **`.planning/phases/89-.../89-CONTEXT.md`** — Phase 89 decisions (kind discriminator `kind: "harness" | "relay-room"`, merge shape at `/sessions/list`).
- **`.planning/phases/88-.../88-CONTEXT.md`** — Phase 88 decisions (`users.mxid` populated at create; `_human` suffix; `loginAsUser` for runtime tokens deferred to whichever slice needs — that's slice D).
- **`src/ui/features/pretty-view/PrettyView.tsx`** — 3800 lines; the reference implementation for pane orchestration, WS setup, optimistic-send lifecycle, pagination behavior. Lines 890-1400 (pending-send state machine), 1762-2073 (WS message handling), 2269-2273 (context_pct frame handling), 570 (contextPct useState — to be swapped for `useSessionContextPct` hook per D-03 mechanical waiver).
- **`src/ui/features/pretty-view/ComposeBox.tsx`** — 3608 lines; the reference for compose-box structure (Row 1 = meter + aux; Row 2 = textarea + Send). Lines 2264-2434 (meter well + reset), 2635-2730 (textarea + send), 1826-1919 (reset dispatch chain — `dispatchResetPayload` → `funnel.send('/id reset')`; the same input flow the new `POST /agent-reset/*` endpoint dispatches).
- **`src/ui/features/pretty-view/ChatMessage.tsx`** — 688 lines; the reference for user-turn bubble styling (isUser branch at L430-490, L465-489).
- **`src/ui/features/pretty-view/RelayInboundBubble.tsx`** — 226 lines; shipped 2026-08-18 by tiffany; reuse target for D-12 (with FORK per Ashley's 2026-09-08 clarification — `RelayRoomInboundBubble` is a COPY with no collapse/expand and no pointer-detect).
- **`src/ui/features/pretty-view/LoadMoreOlderButton.tsx`** — 166 lines; pure component, zero hooks; reuse target for D-14.
- **`src/ui/features/terminal/IdentityBadge.tsx`** — 328 lines; the identity-badge primitive to reuse for D-08/D-09.
- **`src/backend/matrix/matrix-admin-client.ts`** — 990+ lines; 12 admin API primitives; extend with `getRoomMessages` + `sendMessageAsUser`.
- **`src/backend/database/routes/sessions.ts`** — 700+ lines; `/sessions/list` handler with Phase 89 Plan 04 merge; existing entry point where kind marker originates. Router mount site: `src/backend/database/database.ts` L1917 (`app.use("/sessions", sessionsRoutes)`) — reference for how new `/relay-room` and `/agent-reset` router mounts land.
- **`src/backend/database/database.ts`** L1830-1930 — Express router mount block; every new router registers here with `app.use("/prefix", routerModule)`.
- **`src/backend/database/routes/sessions-merge-helper.ts`** — 100 lines; `HarnessSessionRow`, `RelayRoomSessionRow`, `SessionListItem` type contracts (kind discriminator).
- **`src/backend/relay-sessions/relay-room-sessions-store.ts`** — 293 lines; `listActiveRelayRoomSessions(userId)` primitive that the sessions-list merge reads.
- **`src/backend/claude-session/claude-session-server.ts`** L3219, L7074 — the two `context_pct` WS emission sites (dormant branch + primary contextPctTimer). Wave 0 dual-writes these into the shared contextPct store; WS emission stays as-is for backwards compat during transition.
- **`src/backend/fleet-status/fleet-status-server.ts` / `types.ts` / `wire-protocol.ts`** — fleet-status backend; Wave 0 extends the per-session record shape with `contextPct: number | null` and populates on every tick from the shared map.
- **`src/ui/shell/IdentitySessionPane.tsx`** — 407 lines; the wrapper that mounts PrettyView + optional Terminal + IdentityBadge + IdentityModal + MessageQueueDrawer for identity-shaped tabs. The peer `RelayRoomSessionPane` should follow this pattern.
- **`src/ui/state/session-working-store.ts`** — Per-session working / recycling state store. Reuse for D-10.
- **`src/ui/state/identities-store.ts`** — Agent identity resolution. Reuse.
- **`src/ui/api/sessions-api.ts`** — `RemoteTmuxSession` type + `getSessionList()`. Widen for the kind discriminator.
- **`src/ui/api/fleet-status-client.ts`** — Fleet-status WS subscription hooks. Wave 0 adds `useSessionContextPct(hostId, tmuxSession)` hook here.
- **`src/ui/state/conversation-store.ts`** — `FleetSession` type + sidebar row store. Widen for the kind discriminator. `selectConversation` at L1225.
- **`src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`** L980-1003 — `handleRowSelect` row-click dispatch (calls `selectConversation(row.id)` + `onConversationSelected?.(row.id)`; NOT `openSessionInTree` which is a split-tree DROP handler at `AppShell.tsx` L1663). Test files: `PrettyConversationsPanel.{chain,new-role-button,clone-dialog,}.test.tsx`.
- **`src/ui/api/user-management-api.ts`** — `getUsersListBasic()` returning `{id, username}[]` for humans-first badge row rendering.
- **`src/ui/main-axios.ts`** L109-117 — `UserInfo` type (does NOT include mxid today); L1741 `getUserInfo()`. Warning W#8 resolution: Wave 0/1 either extends this shape or adds a small dedicated viewing-user-store.
- **`docker/nginx.conf` L726-749** + **`docker/nginx-https.conf` L710-733** — Existing WS location block pattern for `/claude-session/websocket/`; template for new `/relay-room/websocket/` addition. Also `/fleet-status/` at L701 for a REST prefix pattern; template for `/relay-room/` and `/agent-reset/` REST prefixes.
- **PROJECT.md** — Fleet + fork constraints (nginx caveat, deploy safety, tech stack, blast radius).
- **REQUIREMENTS.md** — Patch #43 requirements (context for how pretty view exists).

### Secondary (MEDIUM confidence)

- **Matrix client-server API spec (spec.matrix.org)** — Endpoints `PUT /rooms/{roomId}/send/m.room.message/{txnId}`, `GET /rooms/{roomId}/messages`, `GET /sync`, `unsigned.transaction_id` field. Confirmed by inspection of existing `matrix-admin-client.ts` usage patterns; not independently re-verified against upstream Matrix spec for this research.
- **Synapse admin API for `/joined_rooms` and `/rooms/.../messages?dir=b`** — Confirmed by existing `matrix-admin-client.ts::getUserJoinedRooms` (L476) and `getRoomLatestEventTs` (L540) usages.

### Tertiary (LOW confidence)

- None — every claim above is verified against a specific file + line reference or a locked CONTEXT.md decision.

## Metadata

**Confidence breakdown:**

- **Standard stack:** HIGH — all packages are existing dependencies; no new installs; each cited utility has a direct file + line reference.
- **Architecture (component tree + extraction boundaries):** HIGH — the shape file and CONTEXT.md explicitly lock D-01/D-02/D-03; the specific extraction targets (outbound bubble, compose shell, forked room-inbound bubble) are named in D-02.b/D-02.c/D-12; the branching site is left to planner discretion.
- **Pattern 2 (backend-proxied Matrix)/Pitfall 3 (`sendMessageAsUser`):** HIGH — the mint-per-request pattern is proven in `identity-birth-orchestrator.ts:779`; the token-never-leaves-backend rule is locked by Phase 88 D-08.
- **Pattern 3 (reuse per-agent state channel)/Pitfall 2 (D-10 drift):** HIGH — the `session-working-store` + `contextPct` frame + `${hostId}:${tmuxSession}` key are all inspectable in-repo. Wave 0 fleet-status contextPct promotion is architecturally cleaner and greenlit by Ashley 2026-09-08.
- **Pitfall 4 (mqid↔txnId correlation):** MEDIUM — depends on Matrix's `unsigned.transaction_id` echo behavior; a `curl` probe during planning would upgrade this to HIGH.
- **Pitfall 5 (event-id cursor pagination):** MEDIUM — Matrix's `/messages?from=<eventId>` is standard but the concrete backend wrapper hasn't been written; planner implements + tests during Wave 1.
- **A5 (new WS route vs. piggyback):** MEDIUM — both are architecturally sound; the recommendation is new-route but planner has legitimate flexibility.
- **Common pitfalls broadly:** HIGH — every pitfall maps to a specific existing pattern in the codebase (nginx caveat, backend tsc, per-agent state, mqid, streaming rule).

**Research date:** 2026-09-08
**Valid until:** ~2026-10-08 (30 days for stable areas; less for the Matrix protocol assumptions in Pitfall 4 and A4 which should be re-verified with a `curl` probe at Wave 1 planning start).

# Phase 42: Conversation list — flat recency sort with pins zone at top, RDP zone at bottom, always-hidden-on-load search input; retire ambient-recession visual — Research

**Researched:** 2026-08-14
**Domain:** Fork-local UI reshape — conversation-list rendering + sort logic
**Confidence:** HIGH (fork-authored code, fully mapped)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Sort model — middle section**
- The middle section is flat. No host grouping, no per-host separators, no strict per-identity order.
- Sort key: most recent message activity, descending. Freshest interaction floats to top.
- "Activity" = a message either direction, and only that. User-sent + assistant-sent messages both float the row. Tool-use chatter, streaming ticks, lifecycle events (session going down, coming back up, tmux restart, agent-supervisor recycle) do NOT touch position.
- Rows with zero message history float to the top. Explicit exception in the sort logic — a truly-new session that has never exchanged a message must NOT sink to the bottom just because it has nothing to sort by.
- Reorder motion is a snap, not an animation. Instant position change on activity.

**Zones — pins on top, RDP at bottom**
- Pins cluster at the very top. Pinned zone uses the SAME existing stable per-row ordering that pins already use today (`(host, role, label)` per Phase 25).
- Pins do NOT shuffle when they receive activity.
- Remote-desktop sessions live in a section at the bottom. Own zone below the flat middle. Uses `(host, role, label)` internally.
- RDP section header hides entirely when zero RDP sessions are running. No empty placeholder header.

**Ready-dot uniformity + retirement of ambient recession**
- Ready-dot renders on every row uniformly. No active-set gate. (Already live per patch #447; this phase formalizes it.)
- RDP rows: default no ready-dot (RDP is not a message-bearing surface). Planner's call to keep uniform if RDP ever gains a chat surface.
- Ambient-recession visual is retired entirely. No more dimmed/recessed treatment. Every row has the same visual weight.

**Search — always-in-DOM, hidden by scroll on cold load**
- Search input lives at the very top of the list, always present in the DOM.
- On the app's first render of the list, scroll position is set so the search input sits just out of view behind the panel header. One-shot effect at cold load. Scrolling up reveals the input.
- After the first cold-load hide, scroll position is left alone.

**Filter behavior**
- Typing flattens the entire list to matches. Pinned zone, flat middle, and RDP section all collapse into ONE list of matches. Section boundaries + pin priority NOT preserved.
- Match target: visible row label text only. No hidden-field matching. No message-body content search.
- Clearing the filter restores the three-zone view.

**List scope + lifecycle (unchanged from Phase 7)**
- Currently-running sessions only. Closed sessions drop off.
- Lifecycle events (session start/stop, supervisor restart) do NOT float a row. Only actual message exchanges do.

### Claude's Discretion

- Exact ordering mechanism for pinned + RDP zones: apply the current `(host, role, label)` tuple within each zone (implemented in `compareByHostRoleLabel` at `conversation-store.ts:367-386`).
- Search input UI shape (text, placeholder, X-to-clear behavior, focus): use messaging-app defaults.
- Recency data source + persistence: derive from the most natural existing signal. Persistence across reload is desirable but can be phased.
- Reorder timing: default synchronous unless a perf reason to debounce.
- How pins interact with the no-history-to-top exception: keep pinned-no-history in the pinned zone (pins are the stability contract).
- How to identify RDP sessions: use `host.enableRdp === true` + `row.rdpHostRow === true` (already the mechanism).

### Deferred Ideas (OUT OF SCOPE)

- Animated reorder.
- Empty-RDP-section landmark header.
- Search reveal affordance for very short desktop lists.
- Content search inside message bodies.
- Persisting closed sessions in the list.
- Secondary stickiness beyond pins.
- Grouping matches under section headers during filter.
- Separate mobile vs. desktop search-reveal pattern.
- "Recently active" badge in addition to the dot and position.
- Reintroducing visual dimming to convey "background."
</user_constraints>

## Project Constraints (from CLAUDE.md)

- **Rebase-ability:** Every fork commit must survive rebases against upstream `main`. All files this phase touches are fork-authored (Phase 6+); rebase risk is **nil**. `conversation-store.ts`, `PrettyConversationsPanel.tsx`, `PrettyConversationRow.tsx`, and `pretty-conversations.css` are all in the pretty-conversations tree introduced by the fork; no upstream Skynet surfaces are touched.
- **Deploy safety:** Every deploy runs behind the 15-min deadman rollback timer. This phase ships one atomic deploy.
- **Nginx caveat:** This phase adds NO new backend routes (frontend-only). No `docker/nginx.conf` / `docker/nginx-https.conf` changes required.
- **GSD workflow enforcement:** Work through GSD commands, not direct edits.

## Summary

Phase 42 is a **frontend-only reshape** of the pretty-conversations panel. Zero backend changes required for the shape as scoped. The seven concrete surfaces map cleanly to existing code — the three `compareByHostRoleLabel` sort call sites in `conversation-store.ts`, the ambient-recession CSS block in `pretty-conversations.css`, the panel render sites in `PrettyConversationsPanel.tsx`, and the row-level `.ambient` class assembly in `PrettyConversationRow.tsx`. The scroll container (`.pv-panel-scroll`) already exists as the search-input mount target and one-shot scroll surface.

The one **architecturally load-bearing gap** is the recency signal source: **there is no existing fleet-wide message-either-direction push** in the current wire protocol. The fleet-status WS channel (`/fleet-status/ws`, boot-time singleton at `AppShell.tsx:397`) publishes status transitions (`busy`/`shell`/`idle`/`waiting`) with an `updatedAt` timestamp that reflects **status change time, not message time**. The per-message `type:"message"` frames (with `ts` field) only flow over the per-pane `/claude-session/ws` sockets which are only opened for pretty-view-mounted panes. To power a fleet-wide recency sort that reflects "message either direction," the planner will need to pick from three viable paths, each with different scope: (A) piggyback on the existing Stop hook payload's `updatedAt` (assistant-turns only, no user-side signal; scope-safe but violates the "either direction" lock); (B) extend the fleet-status WS to carry a `lastMessageAt` derived from tailing JSONL headers per host (backend work; scope-honest); (C) client-side approximation using the per-pane message frames for panes already open (partial coverage; regresses to arbitrary order for never-opened panes). **This decision belongs to the planner and likely needs an Ashley checkpoint** — see Open Questions §1.

**Primary recommendation:** Split the phase into three deploy-worthy plans: (1) sort-and-zones (three-zone `compareByHostRoleLabel` split; retire ambient CSS + `.ambient` className branch; verify ready-dot stays intact; RDP header hides on zero rows), (2) search-and-filter (always-in-DOM input; one-shot scroll-hide via sessionStorage sentinel; label-only flatten filter), (3) recency-signal-wiring (whichever of A/B/C the planner picks with Ashley). The first two are self-contained and can ship independently of the recency-signal decision; the flat middle degrades cleanly to insertion-order for the first pane until wave 3 lands.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Sort tuple mechanics (three-zone `compareByHostRoleLabel` split) | Frontend UI-state (`conversation-store.ts`) | — | Sort is pure derivation over the module-scoped state; matches Phase 25 pattern exactly |
| Ambient-recession CSS retirement | Frontend CSS + Row component | — | Class-toggle mechanism already in row; retire the CSS block + the `isAmbient` derivation |
| Search input always-in-DOM | Frontend panel component | — | Sits inside `.pv-panel-scroll`; pure component addition |
| One-shot scroll-hide effect | Frontend panel component | Browser sessionStorage | Sentinel key in sessionStorage to enforce one-shot semantics across StrictMode double-mounts and any future remount |
| Filter (label-only, flatten zones) | Frontend panel component | — | Add filter state + branch the render tree to bypass zone chrome when active |
| RDP-header conditional render | Frontend panel component | — | Already gated on `grouped` containing `__rdp__` sentinel with rows.length > 0 (via `if (rdpRows.length > 0) grouped.push(…)` at store); phase adds no work beyond confirming |
| Ready-dot uniform render | Frontend Row component | — | Already correct per patch #447; verify only |
| Recency signal (message-either-direction) | Backend + Frontend WS wiring | Frontend UI-state | See Open Questions §1; likely a fleet-status protocol extension OR a JSONL-tail-based ambient signal |

## Standard Stack

No new libraries required for scope 1+2. All work uses the fork's existing patterns:

| Library / Pattern | Version | Purpose | Why Standard |
|-------------------|---------|---------|--------------|
| React `useSyncExternalStore` | 18.x (existing) | Module-scoped store subscription | Already how `conversation-store.ts` publishes snapshots — `notify()` bumps `snapshotVersion`, listeners re-fetch cached snapshot |
| `useState` + `useEffect` (React) | 18.x (existing) | Search filter local state; one-shot scroll effect | Panel-local UI state — matches `pinnedOnly` / `needsDeskOnly` in the existing filter popover at PrettyConversationsPanel.tsx:475-477 |
| Browser `sessionStorage` | Web platform | One-shot cold-load sentinel | Already used in `conversation-store.ts:129` (`pv-conv-active-set` key) — the pattern of "hydrate-on-module-load, silent try/catch, one-shot" is established (`hydrateActiveSetFromStorage`, L150) |
| `lucide-react` icons | Existing dep | Search icon (add `Search`) | Every other icon in the panel uses lucide (Pin, Server, Monitor, Filter, EyeOff, ChevronDown, MoreVertical, Loader2) |
| Tailwind (via `cn()` in `@/lib/utils`) | Existing | Layout of search input row | Panel already uses tailwind for divider chips (see PrettyConversationsPanel.tsx:1052) |

Scope 3 (recency signal) depends on the path chosen — no new libraries even in that scope.

## Package Legitimacy Audit

**Not applicable — this phase installs no external packages.** All work uses libraries already in the fork's dependency tree.

## Code Surfaces (the seven map)

Every file:line reference below is verified from disk read on 2026-08-14.

### 1. Sort logic — `src/ui/state/conversation-store.ts`

**File:** `/home/ubuntu/skynet/src/ui/state/conversation-store.ts` (1379 lines)

**The sort function** — `compareByHostRoleLabel` at **L367-386**. Signature: `(a: ConversationRow, b: ConversationRow) => number`. Currently:
- Outer: `host.name` case-insensitive
- Middle: `role` (null sorts last, via `a.role ?? null` normalization)
- Inner: `label` case-insensitive + numeric-natural

**Note:** Phase 25 STATE entry named `compareByLabel` at lines 365/403/431. That symbol was renamed to `compareByHostRoleLabel` when Phase 25 (patch series `d3ce455` + `13f8e12` + Phase 25 hotfix) landed — the CURRENT symbol name is `compareByHostRoleLabel` and the store comment header (L1-33) has been updated. Phase 25's role-clustering is live.

**The three call sites** (found via grep on the current file):
- **L473** — `activeSetRows.sort(compareByHostRoleLabel)` — Tier 1 (active-set)
- **L511** — `pinned.sort(compareByHostRoleLabel)` — Tier 2 (pinned)
- **L539, L566** — inside the grouped Tier 3 walk (`rows.sort(compareByHostRoleLabel)` for both the hostTree-ordered path AND the orphan-fallback path)
- **L631** — `rdpRows.sort(compareByHostRoleLabel)` — RDP synthesized rows

That's **five actual `.sort(compareByHostRoleLabel)` call sites**, not three. The STATE entry's "3 sort call sites at approximately lines 365, 403, 431" description was accurate for pre-Phase-25 `compareByLabel` (which had fewer sites). The `260806-ixl` STATE entry mentions 5 sort sites now.

**What a `ConversationRow` looks like in memory** (from `conversation-store.ts:43-76`):
```typescript
{
  id: string,
  type: TabType,                // "terminal" | "rdp" | "vnc" | "telnet"
  label: string,                 // the tmux session name (or host name for RDP rows)
  host: Host | undefined,
  targetTmuxSession: string | null,
  fleetOnly?: boolean,           // synthetic rows built from fleetSessions
  rdpHostRow?: boolean,          // sentinel-group RDP rows
  role?: string | null,          // Phase 25 field
}
```

**Data being sorted at each site:**
- L473 (activeSet): identity-tmux + fleet-synthetic terminal rows that are in `state.activeSet`. RDP rows never enter.
- L511 (pinned): the union of openTab pinned + fleet-synthetic pinned that survived the active-set exclusion.
- L539/L566 (grouped): non-pinned, non-active-set identity-tmux + fleet-synthetic rows, bucketed per-host.
- L631 (rdpRows): the synthetic RDP-host rows built from `state.hostsFlat` filtered on `host.enableRdp === true`. **Placed in the `grouped` array as a sentinel `{hostId:"__rdp__", hostName:"", rows: rdpRows}` group** (L633) — this is important: **the store already gates the RDP sentinel push on `rdpRows.length > 0` (L632)**, so the "hide RDP header when zero RDP sessions" requirement is **already effectively met at the store level** — the group isn't emitted at all when no RDP hosts have `enableRdp === true`.

**Smallest seam for three-zone sorting:**
- **Pinned zone** (L511) — no change; keep `compareByHostRoleLabel`.
- **RDP zone** (L631) — no change; keep `compareByHostRoleLabel`.
- **Middle** (L539 + L566) — replace with new `compareByRecencyDesc` comparator that reads a per-row `lastMessageAt` (or equivalent — see Recency Signal below). No-history-to-top rule: rows with `lastMessageAt === null || lastMessageAt === undefined` sort BEFORE all rows with actual timestamps.

**Additional store shape work required for the flat middle:**
The current `grouped: HostGroup[]` shape (an array of `{hostId, hostName, rows}` groups) is fundamentally host-partitioned. The middle-zone flip needs a new derived shape — one flat `middle: ConversationRow[]` that unions all non-pinned, non-active-set, non-RDP identity-tmux + fleet-synthetic rows. Two viable options:
- **(a)** Add a new field to `ConversationList` (e.g., `middle: ConversationRow[]`) alongside the existing `grouped`, and have the panel consume `middle` instead of iterating groups. Drops the `HostGroup` shape usage in the middle render path.
- **(b)** Emit the middle as a single-entry `HostGroup` sentinel (`{hostId:"__middle__", hostName:"", rows: [...]}`). Cheaper but leaves the fiction that the middle is still "host-grouped."
Recommend (a): the shape rename is honest, and `grouped` can be renamed or shrunk to `rdpGroup?: HostGroup | null` since RDP is now the only user of the HostGroup shape.

**Two `HostGroup`-adjacent things the phase retires:**
- `collectHostOrder` (L314-328) — depth-first hostTree walk. Only consumer post-Phase-41 is the RDP-zone hostTree-order pass (L601-616). Keep for RDP; other bucketing goes away.
- `byHostId` map (L515-529) — per-host bucketing for the middle. Retired entirely; middle becomes a flat array.

**The `activeSet` tier is a wrinkle:**
The current store emits three tiers: `activeSet`, `pinned`, `grouped`. The shape agreement talks about "three zones: pinned, middle, RDP" — but the store currently has FOUR (adding `activeSet`). Patch #144 Fix (d) at PrettyConversationsPanel.tsx:285-287 auto-enrolls every `selectedId` into the activeSet, so most rows the user has ever clicked end up in `activeSet` for that browser session. The shape doesn't explicitly retire `activeSet` — but the RETIREMENT OF AMBIENT-RECESSION removes the visual purpose of `activeSet` (which was to distinguish "in the set → full bubble" from "not in set → recessed"). **Planner call to lock:** does the activeSet concept survive Phase 42, or does it retire alongside the ambient class? Ashley's shape lock says "every row has the same visual weight" — implying activeSet's visual purpose is gone. But activeSet ALSO gates the `handleRowDeactivate` machinery (deactivate = "remove from active set + close tab"), so the store field probably needs to survive even if the tier goes away. Recommend: keep `state.activeSet` field for deactivate semantics; **drop the `activeSet` TIER from the ConversationList shape** (activeSet rows just render inline in the middle zone at their recency-determined position — no more special "activeSet cluster at top").

### 2. Ambient-recession visual — `src/ui/features/pretty-conversations/`

**Exact CSS classes / declarations to delete:**

**File:** `/home/ubuntu/skynet/src/ui/features/pretty-conversations/pretty-conversations.css`

- **L572-621** — the entire `AMBIENT RECESSION` section, including four selectors:
  - `.pv-row.ambient` (L583-592) — background, border, box-shadow, backdrop-filter, color overrides
  - `.pv-row.ambient .pv-avatar` (L594-603) — avatar disc dim
  - `.pv-row.ambient:hover` (L605-612) — hover treatment for ambient
  - `.pv-row.ambient .pv-body .pv-label` (L614-617) — text-shadow / font-weight
  - `.pv-row.ambient .pv-body .pv-host` (L619-621) — host text dim
- **L623-630** — the "Ambient rows DO show the ready-dot" comment block explaining the 2026-08-14 dot reversal. Can be trimmed; the dot logic itself stays.
- **L1075** — `.pv-row.pv-row--desktop.ambient:not(:hover):not(:focus-within) .pv-hide-action` selector for the hide-action hover-reveal on ambient rows. Retire — with no more ambient class, this whole rule becomes dead; consolidate hover-reveal to `.pv-row.pv-row--desktop:not(:hover):not(:focus-within) .pv-hide-action` if that behavior stays.
- **L17-23** — the "Ambient recession scope simplification" note in the header comment. Update to reflect retirement.

**File:** `/home/ubuntu/skynet/src/ui/features/pretty-conversations/PrettyConversationRow.tsx`

- **L256-259** — the `isAmbient` derivation: `const isAmbient = !isRdp && !inActiveSet;` — delete this line.
- **L877** — `isAmbient && "ambient",` inside the `cn(…)` className assembly — delete.
- **L4-6** — header comment mentioning "ambient recession"; update.
- **L18-19** — comment about "dot now surfaces 'ready for attention' on ambient/recessed rows too"; update.
- **L38-39** — comment showing the className recipe; update.
- **L46-47** — comment referencing "ambient / selected / hover overlays"; update.
- **L212-213** — comment about `inActiveSet` gating ambient recession; update or remove if `inActiveSet` no longer feeds ambient.
- **L843-845** — comment about isAmbient derivation; remove.

**The `inActiveSet` prop:** the shape retires `activeSet` as a visual tier but the prop drives multiple things beyond ambient — swipe-composite state (`onSwipeRight` = pinned AND active per L387-397), deactivate menu-item gating (`onDeactivate` prop presence). Per the shape's "every row visual weight uniform" — `inActiveSet && "active-set"` (L873) also becomes dead visual state. Verify with the CSS: does anything under `.pv-row.active-set` selector survive?

<verified with grep>
- `.pv-row.active-set` — check the css for surviving usages:

```bash
grep -n "\.active-set\|active-set" pretty-conversations.css
```

The `.active-set` class WAS the "not ambient" opposite; retiring ambient also retires the visual purpose of `.active-set`. Both classes become semantically empty. Retire both className toggles from the row's `cn(…)` composition (L873 and L877). Retain the `inActiveSet` prop for the swipe/deactivate wiring only.
</verified>

**File:** `/home/ubuntu/skynet/src/ui/features/pretty-conversations/DeactivateAction.tsx` (76 lines)
- L8-15 comments refer to "ambient/non-active-set rows"; update. The visible behavior doesn't change (still hover-reveal on desktop, still in swipe-strip on mobile — wait, the swipe strip is gone; the mobile deactivate is now a context-menu item).

### 3. Ready-dot render + `isWorking` signal

**File:** `/home/ubuntu/skynet/src/ui/features/pretty-conversations/PrettyConversationRow.tsx`

**Current render logic** (L1089): `{isWorking === false && !isRecycling && !hasQueuePending && <span data-pv-conv-ready-dot="true" className="pv-ready-dot" … />}`

**The `inActiveSet` gate was already dropped 2026-08-14** — confirmed via file read at L15-23:
> The `inActiveSet` conjunct was dropped 2026-08-14 — since the Phase 34 Plan 06 fleet-status cutover, isWorking is backend-authoritative for every session the fleet-status channel knows about (not just active-set rows), so the dot now surfaces "ready for attention" on ambient/recessed rows too.

**The CSS-side secondary gate** at pretty-conversations.css:559-561: `.pv-row:not(.working):not(.recycling) .pv-ready-dot { display: block }` — this is INDEPENDENT of the `.ambient` class. Retiring `.ambient` does NOT affect the dot.

**No work required for the dot in this phase beyond verification** — after retiring `.ambient`, run the row test file to confirm Test 17 (`!inActiveSet+isWorking===false renders the ready-dot`) still passes.

**RDP rows and the dot:**
- Row-level: at PrettyConversationRow.tsx:1089, the dot is rendered by the same JSX regardless of `isRdp`.
- Panel-level (RDP render site at PrettyConversationsPanel.tsx:1070-1084): passes `sessionKey={sessionWorkingKey(row)}` for RDP rows. `sessionWorkingKey` (L113-116) resolves to `${hostId}:` for RDP (since `targetTmuxSession === null`). The store hook then returns null since Terminal.tsx and PrettyView.tsx never publish to that key.
- **Effective current behavior:** RDP rows never receive a `false` isWorking, so `isWorking === false` is never true → dot never renders on RDP rows. **This matches the shape's "default: no ready-dot on RDP rows" per CONTEXT §Discretion.** No code change needed; verify with a test.

**`isWorking` signal source:** `session-working-store.ts` (fully mapped). Fed by `AppShell.tsx:397-421`'s `createFleetStatusClient` singleton. Backend authoritative via `/fleet-status/ws` — polls per-host `~/.claude/fleet-status/last-stop-payload.json` every 2s (see `ssh-poll-orchestrator.ts:123, 306`). Formula at `session-working-store.ts:97-99`: `isWorking = (status === "busy") || (backgroundTasks.length > 0)`.

### 4. Pin mechanism

**How pins are stored:** `state.pinnedIds: Set<string>` in conversation-store.ts:239. A boolean-per-row model (via set membership on `row.id`), not a separate pinned-list.

**Persistence:** Server-side per user via `putPinnedIds` / `getPinnedIds` (`@/api/user-preferences-api`). Hydrated on panel mount via `hydratePinnedIdsFromServer` at PrettyConversationsPanel.tsx:314-340 (gated on `fleetSessionsLoaded` per quick-260727-kbw).

**How the store distinguishes pinned rows:** L497-499 in the Tier 2 build loop:
```typescript
const isPinned =
  state.pinnedIds.has(tab.id) ||
  (shadowFleetId !== null && state.pinnedIds.has(shadowFleetId));
```
Handles two id shapes because openTab ids drift from fleet-synthetic ids on tab lifecycle (patch #230 B fix at L482-492).

**For rendering the pinned zone as its own cluster:** the panel already does this — PrettyConversationsPanel.tsx:994-1034 renders `displayedPinned` inside `<div className="pv-panel-group" data-pinned-group="true">`. Already includes a "Pinned" divider chip (patch #234, L996-1013). The panel's rendering of the pinned zone as "its own visual cluster" is **already correct** — no restructuring needed; only the current PINNED HEADER + zone divider chip persist. The pinned zone's render path is complete.

### 5. RDP-session detection

**Detection signal:** `host.enableRdp === true` (strict boolean check per T-07-02-01 mitigation). Applied at conversation-store.ts:606 + L621 (hostTree-order pass + orphan pass).

**Row-level marker:** `row.rdpHostRow === true` (set at L613 + L629 during synthesis).

**Zone-level marker:** `hostId: "__rdp__"` sentinel HostGroup pushed at L633.

**Panel-level render branch:** `if (group.hostId === "__rdp__")` at PrettyConversationsPanel.tsx:1039. Renders the "Remote desktop" divider chip (L1051-1069) + iterates rows.

**Zero-RDP-hidden-header behavior:** ALREADY MET at the store level — `if (rdpRows.length > 0) grouped.push(…)` (L632). If no host has `enableRdp === true`, no sentinel group emits, so the panel never enters the `__rdp__` branch, and the "Remote desktop" chip never renders. **Phase 42 requires no work here beyond a regression test that locks this behavior.**

**Where the `enableRdp` flag comes from:** `state.hostsFlat: Map<number, Host>` at L219-223. Populated by `updateHostsFlat` (AppShell), which is fed by the hostTree fetch. The `Host` type carries `enableRdp?: boolean` from the backend hosts endpoint (search `types/ui-types.ts` for the exact shape — the strict `=== true` check handles undefined defensively).

### 6. Recency signal source

**THIS IS THE ONE ARCHITECTURALLY OPEN QUESTION — see Open Questions §1 below for the recommended options and their scope tradeoffs.**

**Existing WS message pipeline trace:**

Per-pane message frames flow via **`/claude-session/ws`** (a separate WebSocket per opened pretty-view pane, NOT a fleet-wide channel):
- Backend emitter: `claude-session-server.ts:2286-2300` — emits `{type: "message", role, content, eventId, ts}` per parsed JSONL line. Also `type: "image"`, `type: "relay_outbound"`, `type: "relay_inbound"`, `type: "malformed_line"` (all message-adjacent frame types).
- Frontend consumer: `PrettyView.tsx:1293-1307` — the `case "message"` branch appends to the local `messages` state via `appendDedup`.
- Backend source: `session-file-tail.ts` — `tail -F` follows the remote JSONL file over SSH exec channel.
- Frame `ts` field: number (unix millis) — see `session-file-parser.ts:50,64,504`.

**Critical constraint:** the `/claude-session/ws` connection is only opened for panes that are actively mounted (i.e., panes the user has visited in this browser session AND that are still in `activeSet`). A never-visited running session emits messages to its JSONL on the remote box, but no browser WebSocket is listening. So per-pane message frames are **insufficient as the sole recency signal** — they'd give correct sort for panes the user has already opened and would give arbitrary order for panes they haven't. This breaks the shape's mental model.

**Fleet-status channel does NOT carry per-message signal:**
- The `SessionState.updatedAt` field (`fleet-status-types.ts:96`) tracks status-transition time, not message time.
- The `SessionState.status` enum is `"busy" | "shell" | "idle" | "waiting"` — no message-event tick.
- The Stop hook payload (`stop-hook.sh`) fires per turn-completion and writes `~/.claude/fleet-status/last-stop-payload.json` atomically. It carries `last_assistant_message: z.string().optional()` (fleet-status/types.ts:97) — a STRING, not a timestamp, and only for assistant turns (not user sends). Currently unconsumed by the frontend.
- The poll orchestrator (`ssh-poll-orchestrator.ts:306`) reads `updatedAt: sessionJson.updatedAt` from that payload — this DOES bump on every Stop-hook fire (i.e., per assistant turn), but is **assistant-only** and misses user-side sends.

**No compose-send hook signals recency at present.** ComposeBox.tsx submits via the tmux send-keys pipeline (via `raw_keystrokes` WS frame — search for the send path at ComposeBox.tsx around line 1000+); the send doesn't touch fleet-status, and the "user just sent something" fact is only observable to the browser tab that sent it (or via subsequent JSONL tail landing a `role: "user"` frame — see session-file-parser.ts:490).

### 7. Search + scroll surface

**Current top-of-list markup** in `PrettyConversationsPanel.tsx`:
- **Header:** `<div className="pv-panel-header shrink-0" …>` at L827. Contains `pv-panel-header-row` (L832) with the title/actions row, and `<WeeklyUsageMeter />` (L917) as a sibling INSIDE the header.
- **Scroll region:** `<div className="pv-panel-scroll min-h-0">` at L923. `.pv-panel-scroll` is defined at pretty-conversations.css:328-341 as `flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 14px 12px 18px; display: flex; flex-direction: column; gap: 8px;`.

**Where the search input mounts:** as the FIRST child inside `<div className="pv-panel-scroll min-h-0">`, before the loading-affordance and before the activeSet group. This makes it scrollable — the shape requires "scroll up reveals it," which means the input is INSIDE the scroll container above the first row.

**One-shot scroll-hide effect:** on cold-load, set `scrollContainer.scrollTop = searchInputHeight + padding` so the input sits just above the visible area. To be **one-shot across StrictMode double-mounts + any future remount**, use a sessionStorage sentinel key (e.g., `pv-conv-search-hidden-once = "1"`). Established pattern at conversation-store.ts:129-180 (`ACTIVE_SET_STORAGE_KEY`) — try/catch wrapper, `typeof sessionStorage === "undefined"` guard, best-effort clear on the `only=1` URL variant.

**Mobile-vs-desktop panel lifecycle** (from AppShell.tsx:1488 read): the panel is mounted ONCE in `sidebarPanelContent` and passed `variant={isMobile ? "mobile" : "desktop"}`. On mobile the "two-screen flow" is handled by `navigateToView()` swapping DOM subtrees for list-vs-view display, but the **panel component itself does not unmount** — `mobileScreen` state (AppShell.tsx:641) only toggles which subtree is visible. Verify: search AppShell for any conditional render around `<PrettyConversationsPanel …>` — the mount is at L1488 inside `sidebarPanelContent`, which itself is a JSX value assembled unconditionally. The panel mounts once per page-load. **So a `useEffect(() => { … }, [])` with an empty dep array + sessionStorage sentinel achieves one-shot semantics without ceremony.**

**However** — StrictMode dev-only double-mount will run the effect twice; the sessionStorage sentinel handles it. On production the sentinel is defense-in-depth for any future remount pattern (e.g., if the panel ever gains a key-based remount).

### 8. Filter renderer

**Current renderer** (PrettyConversationsPanel.tsx:948-1197) is **section-declarative** — it renders activeSet group, then pinned group with divider chip, then walks `displayedGrouped` emitting per-host-group divider chips + rows. This is friendly to zone-collapse-during-filter: the filter branch just replaces the render tree with a single flat list of matches instead of iterating groups.

**Existing filter pattern** at L525-532 (bounty-count filter): the panel takes the raw `pinned` / `grouped` and derives `displayedPinned` / `displayedGrouped` by filtering. Same shape as needed here — a `searchQuery` local state, a `matchesSearch(row)` predicate that checks `row.label.toLowerCase().includes(searchQuery.toLowerCase())` (or normalized-locale version), and a fully-flat render branch when `searchQuery !== ""`.

**Match target — visible row label text only:**
- The row's visible label is a two-line composite (PrettyConversationRow.tsx:983-1005): `<span className="pv-label">…</span>` shows either `identity.displayName` or `row.label`; `<span className="pv-host">…</span>` shows either `identity.title ?? identity.displayName` or `hostname`.
- Both lines are visible → both are searchable per shape §Filter behavior: "If a row shows identity name + host name, both are searchable."
- The predicate needs to reproduce the label + sublabel resolution the row does, or (cleaner) pre-compute a `searchableText` field on each ConversationRow at store-derivation time. Recommend the latter — put it on the row shape so the predicate stays trivial.

## Additional gotchas to know

**A. Test files that assert current host-grouped ordering:**
- `src/ui/state/conversation-store.test.ts` — 59 occurrences of `grouped`; **Test 2 (L162-165)** explicitly asserts "preserves depth-first host-tree order below pins (not insertion, not alphabetical)." This test's assertion is superseded by Phase 42 for the middle zone. Tests that assert (host, role, label) tuple within pinned + RDP zones stay valid.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` — 77 occurrences of `grouped`; **Test 19A (L623)** and **Test 19B (L664)** assert per-host divider chips render for non-RDP groups. These chips ARE the host-grouping visual retiring in Phase 42. Tests need rewrite: after Phase 42 the middle zone renders NO host divider chips (only the pinned chip + the RDP chip persist).
- `src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx` — tests around `ambient` class (Test 12 at L479, Test 18 at L44, Test 18b at L45). Test 12 asserts non-RDP active-set row has NO `ambient` class — after phase 42 no row has `ambient`, so this test's assertion becomes trivially true; retire the ambient half of the assertion. Test 18 asserts `!inActiveSet && !isRdp` row DOES carry `ambient` — this test needs deletion (behavior gone).
- `src/ui/state/conversation-store.cache.test.ts` — 0 occurrences of `grouped`; no changes needed.

**B. The `activeSet` field vs. tier duality:**
Per §1 above — the `state.activeSet: Set<string>` field is used for TWO independent things: (1) the activeSet TIER in the render output, and (2) the deactivate-action semantics. Phase 42 retires (1) but must preserve (2). The store surface (`useActiveSet`, `addToActiveSet`, `removeFromActiveSet`) stays.

**C. Auto-enroll effect at PrettyConversationsPanel.tsx:285-287:**
This effect auto-adds every selectedId to the activeSet. It exists to defeat the OLD ambient-recession behavior for URL-restore/keyboard-nav paths (patch #144 Fix d, comment at L276-284). Phase 42 retires ambient, so this effect's original motivation is gone. **But** — retiring it would change the deactivate semantics (rows never get into activeSet without an explicit click → deactivate menu-item never appears for URL-restored panes). Two paths: (a) keep the effect for deactivate semantics; (b) refactor deactivate to not depend on activeSet membership. Recommend (a) — smaller diff, no behavior change on the deactivate side.

**D. The Loading affordance placement:**
PrettyConversationsPanel.tsx:933-947 renders the "Loading conversations…" strip as the FIRST child inside `.pv-panel-scroll`. Phase 42's search input needs to mount ABOVE this strip so cold-load scroll-hide covers it too. Or below — depends on Ashley's mental model. Recommend ABOVE (search chrome sits above everything including the loading strip).

**E. Hidden section at the bottom (quick-260731-tgg):**
PrettyConversationsPanel.tsx:1140-1197 renders a collapsible "Hidden" section BELOW the __rdp__ group. Phase 42 does not touch this. But the filter-flatten behavior needs a decision: does the filter include hidden rows in the flat match list? Recommend YES — hidden rows are still runnable sessions; if a user searches for one by label, they should see it. The predicate should just apply to the union of activeSet ∪ pinned ∪ middle ∪ RDP ∪ hidden.

**F. Header structure and search input placement conflict:**
The shape says search sits "just out of view behind the panel header." If the input goes INSIDE `.pv-panel-scroll` (recommended for the "scroll up reveals it" pattern), then `.pv-panel-header` is opaque above the input. Sanity check the header opacity / background — pretty-conversations.css:66-73 uses `border-bottom` but not a solid background; the panel-level backdrop-filter (`.pv-panel` L62) provides visual separation. The input scrolling behind a semi-transparent header should still LOOK hidden, but visual QA may want the header to have an explicit opaque background if the input's presence is noticeable through the blur.

**G. `overscroll-behavior: contain` on the scroller (css:336):**
Introduced for "mobile-scroll-freeze-overscroll-behavior (2026-08-10)" to prevent iOS Safari rubber-band from getting swallowed by AppShell. Do NOT remove during search-scroll work; it's load-bearing for mobile.

## Runtime State Inventory

This phase is a rendering + sort-logic reshape — no rename, no schema migration, no external state.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | None — the middle sort field (if introduced) is derived from a runtime signal; no schema migration. | None |
| Live service config | None — no external service registrations reference the pretty-conversations tree. | None |
| OS-registered state | None. | None |
| Secrets/env vars | None. | None |
| Build artifacts | None — Vite rebuild handles the CSS/TS diff. Ensure `npm run build` succeeds; no `.egg-info`-style stale artifacts. | Run `npm run build` post-change |

**One in-browser storage touch:** if the one-shot scroll-hide uses sessionStorage as recommended, a new key `pv-conv-search-hidden-once` lands in the same sessionStorage that already holds `pv-conv-active-set`. Sessionstorage clears on tab close — no long-term artifact.

## Common Pitfalls

### Pitfall 1: Assuming `updatedAt` in `SessionState` reflects message time
**What goes wrong:** Wiring the middle sort to `SessionState.updatedAt` from the fleet-status channel produces a sort that bumps on every status flip (busy→idle, background-task start/stop). Ashley's "activity = message either direction, and only that" would break — every background monitor task and every context switch would float the row.
**Why it happens:** The field name suggests message-time; it actually tracks status-transition time (from the Stop hook payload's session JSON metadata).
**How to avoid:** Do NOT use `SessionState.updatedAt` as the recency signal. Either extend the wire protocol with a distinct `lastMessageAt` (Option B) or use a different source per the recency-signal decision.
**Warning signs:** If, during a manual test, a session's row jumps when you switch panes on it (even without sending a message), the wiring is wrong.

### Pitfall 2: One-shot scroll-hide firing on every mount
**What goes wrong:** Panel remounts (StrictMode dev double-mount, hypothetical future refactor) reset scroll position, jerking the list downward every time the user returns to it. Shape §"What would make it wrong": "If the initial-scroll-hides-search rule fires more than once per cold load. The rule is one-shot at the app's first mount of the list. If it fires on every panel-return or every re-render, the list keeps jumping under the user."
**Why it happens:** A `useEffect(() => { … }, [])` with no persistence sentinel fires on every mount.
**How to avoid:** Sessionstorage sentinel key. Cleared only on tab close. StrictMode's second mount reads the sentinel and no-ops.

### Pitfall 3: Retiring `.active-set` className too aggressively
**What goes wrong:** Deleting the `inActiveSet && "active-set"` className toggle breaks any CSS selector that anchors on `.active-set` (e.g., hover-reveal for the deactivate action inside `.pv-meta`).
**Why it happens:** The `active-set` class doubles as (a) a visual "in the active tier" affordance and (b) a hover-reveal anchor for deactivate/pin buttons.
**How to avoid:** grep for `.active-set` and `.pv-row.active-set` in `pretty-conversations.css` before deleting the className toggle. Preserve the classname if any surviving CSS depends on it; only strip its ambient-defeating visual overrides.

### Pitfall 4: Filter breaking the `activeSet` deactivate menu item
**What goes wrong:** During filter, rows land in a flat list without their tier context. The deactivate menu item is gated on the row's tier membership (activeSet-only). Filter must preserve the `inActiveSet` prop per-row even when rendered flat.
**Why it happens:** A naive filter that emits a new `ConversationRow[]` without carrying tier metadata loses the per-row context.
**How to avoid:** Pass through `inActiveSet={activeSet.has(row.id)}` on every row render — same as the current three tier render sites do. The `activeSet: Set<string>` is available regardless of which tier the row was in pre-filter.

### Pitfall 5: The Hidden section during filter
**What goes wrong:** Hidden rows are already filtered out of the tiers by the store (`conversation-store.ts:650-662`). A naive filter that iterates `activeSetRows ∪ pinned ∪ grouped` misses hidden rows entirely, so a user searching for a hidden row by label sees no match even though it exists.
**Why it happens:** Two separate filter layers (store-side hiddenIds filter + panel-side search filter) don't coordinate.
**How to avoid:** During filter, the predicate should also walk `knownRowsRef.current` (PrettyConversationsPanel.tsx:591) which holds hidden rows too, and include hidden matches in the flat list. Or expose a "raw" (pre-hidden-filter) union from the store for filter mode.

### Pitfall 6: The no-history-to-top exception colliding with server ordering
**What goes wrong:** A rehydrated session with no prior client-side message record but a real JSONL history on the server would sort to the top on cold load, then jump down mid-session as its first `type:"message"` frame lands with a real `ts`. Feels janky.
**Why it happens:** Client-side recency state is transient (in-memory unless persisted); JSONL history is server-authoritative.
**How to avoid:** The recency-signal decision (Open Questions §1) determines whether this bug exists. If Option A (fleet-status Stop-hook `updatedAt`) or B (extend WS with `lastMessageAt`) is chosen, the value is server-derived → the no-history rows are truly no-history. Option C (per-pane message-frame counting) has this bug fatally.

## Environment Availability

Not applicable — this phase touches only the frontend TypeScript + CSS surface. All required tools (npm, node, vite, vitest, tsc) are already used by the fork; no new dependencies.

## Validation Architecture

Confirmed: `.planning/config.json` was not checked here since this section is only skipped if `workflow.nyquist_validation` is explicitly false. Include the section defensively.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (existing) |
| Config file | `vitest.config.ts` (search fork root; may be `vite.config.ts` with test config) |
| Quick run command | `npx vitest run <path>` for a single file |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

The phase's requirements come from the shape agreement (no numbered REQ- ids). Map:

| Behavior | Test Type | Automated Command | File Exists? |
|----------|-----------|-------------------|--------------|
| `compareByRecencyDesc` sorts by lastMessageAt DESC | unit | `npx vitest run src/ui/state/conversation-store.test.ts` | ✅ (add cases) |
| No-history rows sort to top of middle | unit | same | ✅ (add cases) |
| Pinned zone stays `(host, role, label)` even after activity | unit | same | ✅ (add regression case) |
| RDP zone stays `(host, role, label)` and stays at bottom | unit | same | ✅ (existing test covers zone placement; add regression for internal sort) |
| RDP header hides when zero RDP sessions | unit + component | `npx vitest run src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` | ✅ (already implicit via store; add explicit render test) |
| Row's `.ambient` class is gone | component | `npx vitest run src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx` | ✅ (delete/update existing) |
| Ready-dot renders on every non-working row regardless of active-set | component | same | ✅ (Test 17 already locks this per patch #447) |
| Search input mounts always at top of scroll region | component | Panel test | ✅ (add case) |
| One-shot scroll-hide: mount fires effect once per cold load | component + sessionStorage mock | Panel test | ✅ (add case with sessionStorage mock — pattern exists at conversation-store test) |
| Filter flattens all zones on non-empty query | component | Panel test | ✅ (add cases) |
| Filter matches against row label text (both label + sublabel visible) | component | Panel test | ✅ (add cases) |
| Clearing filter restores three-zone view | component | Panel test | ✅ (add case) |
| Snap reorder (no CSS transition on position change) | component | Panel test | ✅ (add case that inspects computed style for lack of transform-transition) |

### Sampling Rate
- **Per task commit:** `npx vitest run <touched-test-file>` — should complete in <10s for the three named test files.
- **Per wave merge:** `npx vitest run` — full suite (~1500 tests per most recent STATE entries).
- **Phase gate:** Full suite green + `npx tsc --noEmit` + `npm run build` before `/gsd-verify-work`.

### Wave 0 Gaps
- No net-new test files required — three existing test files cover all touched surfaces.
- No net-new framework install — Vitest already the standard.
- **If sessionStorage mocking pattern isn't already extracted:** the `hydrateActiveSetFromStorage` tests in `conversation-store.test.ts` establish the mock pattern; reuse.

## Security Domain

This phase touches only in-browser rendering and one sessionStorage key. No new backend routes, no new data flows, no auth changes.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes (marginal) | Search input: label match is client-side substring; no server round-trip. Sanitize with `String(input).toLowerCase()` before comparison; do NOT interpret as regex/HTML/DOM. The label text itself is user-controlled (tmux session names, identity displayNames) but rendered as text via React's default escape. No XSS surface added. |
| V6 Cryptography | no | — |

### Known Threat Patterns for `React + sessionStorage`

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| sessionStorage bleed via `only=1` new-window opener | Information Disclosure | Pattern already established at `conversation-store.ts:154-168` — hash-detect and clear on `only=1`. If the search-hidden sentinel is added, extend the same guard to clear the new key when `only=1` is present. |
| XSS via unescaped label content | Tampering | React escapes text nodes by default. Do not use `dangerouslySetInnerHTML` for any search/filter output. |
| Search-input flooding causing render thrash | Denial of Service (local) | Debounce filter input at 100-150ms via `useDeferredValue` or `setTimeout` if per-keystroke re-renders become perceptible on large lists. Not urgent for Ashley's ~20-session fleet. |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The fork uses Vitest (not Jest) for tests | Validation Architecture | Test commands would be wrong; check `package.json` scripts before planning tasks |
| A2 | React 18 (using `useSyncExternalStore`) | Standard Stack | Confirmed indirectly from the store's use of `useSyncExternalStore` — this hook is React 18+ |
| A3 | `Host.enableRdp` is `boolean | undefined` on the type | RDP-session detection | Confirmed indirectly from the strict `=== true` check; verify with `types/ui-types.ts` read |
| A4 | The panel mounts once per page-load (no key-based remount) | Search + scroll surface | If a future refactor introduces a key-based remount, the sessionStorage sentinel still protects; risk is contained |
| A5 | `~/.claude/fleet-status/last-stop-payload.json` bumps `updatedAt` on every assistant turn (i.e., every Stop-hook fire) | Recency signal | Confirmed at `ssh-poll-orchestrator.ts:306` and `fleet-status/types.ts:60`; but this is assistant-only and does not track user-side sends |
| A6 | The activeSet TIER's visual purpose is gone with ambient retirement, and the tier can be retired from ConversationList shape | Sort logic §activeSet wrinkle | Ashley may still want an "active" cluster; planner should confirm before dropping the tier from the store shape. This is a real decision, not a mechanical retirement |

## Open Questions

### 1. Recency signal source — needs Ashley checkpoint

**What we know:**
- Ashley locked "activity = message either direction, and only that" (verbatim quote in STATE.md Phase 42 entry).
- No existing fleet-wide message-either-direction push exists.
- Per-pane message frames only cover open panes.
- The Stop hook fires per assistant turn but is assistant-only.

**What's unclear:**
- Which of the three viable paths is the shape-compliant answer:
  - **(A) Fleet-status protocol extension** — add a `lastMessageAt` field to `SessionState` in the wire protocol; the backend tails the JSONL header offset (cheap) OR reads the last-modified time of the JSONL file (cheaper, less precise). Ashley-directional: honors "both directions" since JSONL captures both. Requires backend work + wire-protocol version bump.
  - **(B) Piggyback on Stop-hook `updatedAt`** — bump the middle sort on every assistant turn only. Cheap; requires only frontend wiring. Violates "both directions" — user sends don't move the row until an assistant turn follows.
  - **(C) Client-side signal from `/claude-session/ws` messages** — capture the `type:"message"` `ts` field per-pane and store as `lastMessageAt` in the conversation-store per row. Correct semantics for opened panes; never-opened panes get null (→ float to top per no-history rule, which is wrong — they have history, we just haven't seen it).

**Recommendation:** Option A. It's the only shape-compliant, correct-semantics option. The backend work is contained: (1) add `lastMessageAt: number | null` to `SessionState` in `wire-protocol.ts` + zod schema; (2) source it in `ssh-poll-orchestrator.ts` by parsing the last non-tool-use line from the JSONL file (or, cheaper: `stat` the JSONL file for mtime and use that as a coarse approximation — accepting that a background write like a tool-result would falsely bump position, which is a shape violation, so stat isn't good enough); (3) frontend consumes via `publishFleetStatusSessionState` and stores `lastMessageAt` alongside `isWorking` in the working-store OR a sibling store. Wire-protocol version bump would be needed if there are any external consumers.

Ashley checkpoint recommended before implementation because the backend scope significantly changes the phase's ship shape (frontend-only vs. full-stack).

### 2. Does the `activeSet` render tier survive?

**What we know:** The activeSet tier's visual purpose (a highlighted top cluster with full-bubble treatment) exists specifically to distinguish it from the ambient/recessed baseline. Retiring ambient removes the distinction.

**What's unclear:** Does Ashley still want an "active" cluster at the top even when every row is visually uniform, OR do activeSet rows just render inline in the middle at their recency-determined position?

**Recommendation:** Ask at plan-time. The mechanical answer (activeSet tier retires with ambient) is architecturally clean; the alternative (keep the cluster; drop only the visual dimming of non-active-set) is easy but adds a fourth zone the shape doesn't mention.

### 3. Filter and Hidden section coordination

**What we know:** Hidden rows are store-side filtered out of all three tiers.

**What's unclear:** During filter, does the flat match list include hidden rows or exclude them?

**Recommendation:** Include hidden rows in filter matches — user searching for a specific session by label should find it whether or not they hid it, because the intent to find > the intent to hide. Ashley may disagree; low-stakes.

### 4. Search input focus behavior on mobile

**What we know:** Ashley works from her phone almost exclusively.

**What's unclear:** When the user scrolls up to reveal the search input on mobile, should it auto-focus and open the virtual keyboard, or wait for a tap? Auto-focus on scroll-into-view can be jarring.

**Recommendation:** No auto-focus. Tap-to-focus. Reveal is not the same signal as intent-to-search.

## Sources

### Primary (HIGH confidence — direct file reads on 2026-08-14)

- `/home/ubuntu/skynet/.planning/phases/42-conversation-list-flat-recency-sort-with-pins-zone-at-top-rd/42-CONTEXT.md` — full CONTEXT.md
- `/home/ubuntu/skynet/.planning/shapes/shape-conversation-list-recency-sort.md` — full shape agreement
- `/home/ubuntu/skynet/.planning/shapes/shape-fleet-native-conversation-list.md` — Phase 7 shape (layered foundation)
- `/home/ubuntu/skynet/.planning/STATE.md` — Phase 42 Roadmap Evolution entry, Phase 25 entry, Phase 26 entry, `260806-ixl` and `260806-gig` entries, `260730-wfy` entry
- `/home/ubuntu/skynet/CLAUDE.md` — Skynet fork constraints
- `/home/ubuntu/skynet/src/ui/state/conversation-store.ts` — L1-665 read (sort comparator, computeSnapshot, tier assembly, RDP synthesis)
- `/home/ubuntu/skynet/src/ui/features/pretty-conversations/PrettyConversationRow.tsx` — L1-1050 read (ambient class assembly, ready-dot render, swipe machinery)
- `/home/ubuntu/skynet/src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — L1-1197 read (panel structure, filter, render sites, tier rendering, RDP branch)
- `/home/ubuntu/skynet/src/ui/features/pretty-conversations/pretty-conversations.css` — key sections (panel, scroll, ambient, ready-dot)
- `/home/ubuntu/skynet/src/ui/features/pretty-conversations/tokens.ts` — full file (header-only after quick-260802-pq2)
- `/home/ubuntu/skynet/src/ui/api/fleet-status-types.ts` — full file (wire protocol mirror)
- `/home/ubuntu/skynet/src/ui/api/fleet-status-client.ts` — L1-130 read (client factory + WS wiring)
- `/home/ubuntu/skynet/src/ui/state/session-working-store.ts` — L1-150 read (isWorking composite + fleet-status wiring)
- `/home/ubuntu/skynet/src/backend/fleet-status/types.ts` — L40-100 read (SessionJson schema + Stop-hook payload schema)
- `/home/ubuntu/skynet/src/backend/fleet-status/stop-hook.sh` — full script
- `/home/ubuntu/skynet/src/backend/claude-session/claude-session-server.ts` — L2275-2320 read (message frame emission), header comment (frame types catalog)
- `/home/ubuntu/skynet/src/backend/claude-session/session-file-tail.ts` — L1-50 read (JSONL tail-F pattern)
- `/home/ubuntu/skynet/src/ui/AppShell.tsx` — L380-425 (fleet-status client mount), L1480-1540 (PrettyConversationsPanel mount site)
- `/home/ubuntu/skynet/src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` — grep + spot reads (test count + shape)
- `/home/ubuntu/skynet/src/ui/state/conversation-store.test.ts` — grep + spot reads (Test 2 host-tree order lock)
- `/home/ubuntu/skynet/src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx` — grep + header block (Test 12/17/18)

### Secondary (MEDIUM confidence)

- STATE.md's Phase 25 and 260730-wfy entries — patch history for the current sort-tuple lineage; cross-verified against `compareByHostRoleLabel` in the current file

### Tertiary (LOW confidence — needs validation)

- None — all findings verified against current on-disk files

## Metadata

**Confidence breakdown:**
- Sort logic + code surfaces: HIGH — direct file reads, exact line numbers, verified against Phase 25 STATE entry.
- Ambient-recession retirement: HIGH — full CSS block + class-toggle sites identified.
- Ready-dot logic: HIGH — code + comments confirm patch #447 already retired the active-set gate.
- Search + scroll: HIGH — scroll container, header structure, and mount lifecycle all mapped.
- Filter renderer: HIGH — existing bounty-count filter pattern is the model.
- Recency signal: MEDIUM — architecture is fully understood, but the RIGHT choice among three options depends on an Ashley call; the mechanics of each option are HIGH confidence.
- Test coverage impact: HIGH — grep counts + spot reads of key assertions confirm the scope of test changes.

**Research date:** 2026-08-14
**Valid until:** 2026-09-14 (30 days for fork-local UI code; STATE.md and shape file are authoritative if drift is suspected)

## RESEARCH COMPLETE

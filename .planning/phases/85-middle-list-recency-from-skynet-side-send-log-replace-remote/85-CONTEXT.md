# Phase 85: middle-list recency from Skynet-side send-log — Context

**Gathered:** 2026-09-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the source of the middle-zone recency signal in the conversation list.
Today `SessionState.lastMessageAt` is derived by remote SSH tail-scan of each
identity's newest JSONL for lines matching a strict "Ashley's real user turn"
predicate. That derivation fails often enough that the middle-zone ordering is
noticeably wrong — most obviously, an identity that recycled itself sinks
below identities Ashley hasn't touched in weeks. This phase records the
timestamp on the send side instead, keyed on identity name, in Skynet's own
durable state, and swaps the backend derivation of `SessionState.lastMessageAt`
to read from that store.

**In scope:** new SQLite table + hook on the universal compose-send funnel +
source-swap on the backend derivation + client-side optimistic reorder +
in-process test coverage.

**Out of scope:** any change to the pinned or RDP zones, any change to the
wire shape / working-store contract / frontend comparator, any change to the
other consumers of the transcript-scan pipeline (ai-title, isWorking,
dormant, recycling, lastStopAt, activityMtime), any starting-point backfill
of the new store, any capture of non-Skynet interaction paths (phone Matrix
DMs bypassing Skynet's compose surface), any manual reset-recency affordance,
any multi-user keying of the store (Skynet single-tenant on t1000).

</domain>

<decisions>
## Implementation Decisions

### Storage location
- **D-01:** New table in the `skynet-data` SQLite database (Drizzle schema
  at `src/backend/database/db/schema.ts`). Same volume as every other durable
  fleet state on this box — survives container restart automatically. Naming
  and column layout is planner's call, but the primary key is identity name
  and the record holds "when was Ashley's last send to this identity, in
  unix millis." No user column (single-tenant); add later if Skynet ever
  runs multi-tenant.

### Key shape
- **D-02:** The store is keyed on **identity name only** — not
  `(hostId, tmuxSession)`, not host id alone, not the working-store's
  session-key format. Identity is the durable thing; sessions recycle, boxes
  reboot, transports change. Fleet convention holds that identity name ===
  tmux session name === `/id <name>` target, so the identity name is
  already available at every send site.

### What counts as a send
- **D-03:** Universal rule — anything that fires a message-shaped payload
  from the compose surface counts. The hook is architectural, not an
  enumerated allowlist. Text submit + reset button + thumbs-up + recap +
  any current or future compose-surface button all count automatically.
  Ashley 2026-09-07 verbatim: *"if anything within the compose box sends a
  message into the harness, then it counts."*
- **D-04:** Hook site is `useComposeSend.send` at
  `src/ui/features/pretty-view/ComposeBox.tsx:447-493` — the Phase 68
  universal send funnel that every button already routes through. The
  identity name is available at this call site via the `identityName` prop
  already threaded to ComposeBox (`ComposeBox.tsx:509`). The existing
  `[compose] submit-entry` log line proves the funnel is truly universal:
  every send origin (text, reset, thumbs-up, recap, quick-send) surfaces
  through it with a `trigger=` field.

### Attempts vs. delivery
- **D-05:** Attempts count. If the send fails because the target is
  unreachable, the stamp still fires. Ashley 2026-09-07 verbatim: *"Attempts
  count."* The intent to talk to the identity IS the recency signal;
  filtering by delivery success re-introduces the class of bug this phase
  exists to remove.

### Client-side responsiveness
- **D-06:** The row moves the instant Ashley hits send — optimistic
  client-side stamp on the frontend `session-working-store` on the same
  frame as the send dispatches, not waiting for the backend round-trip +
  next fleet-status frame. The store's existing max-wins helper
  (`advanceSessionLastMessageAt` at `session-working-store.ts:758`) already
  handles this shape: an optimistic stamp is just a local
  `advanceSessionLastMessageAt(key, Date.now())` call at the send site.

### Backend derivation source-swap
- **D-07:** The backend calculation of `SessionState.lastMessageAt` swaps
  from `scanTailForNewestMessageAt` (`ssh-poll-orchestrator.ts:508`) reading
  the JSONL tail to a lookup against the new send-log store, keyed on
  identity name. The wire field name + type + working-store max-wins +
  comparator + snapshot pipeline are all untouched — only the number's
  origin changes. Planner picks the exact seam (call site for the lookup,
  cache invalidation, fingerprint impact).

### Old transcript-scan mechanism
- **D-08:** The transcript-scan pipeline stays alive for its other
  consumers (ai-title, isWorking, dormant, recycling, lastStopAt,
  lastStatusChangeAt, activityMtime, stoppedMtime). Only the
  recency-derivation role retires. `isRealUserTurn`
  (`ssh-poll-orchestrator.ts:418`) still runs — the tail scan just stops
  being called for `lastMessageAt`.

### First-ship behavior
- **D-09:** No backfill. On ship day the store is empty; every identity
  starts at "never" and rises naturally as Ashley sends to them. Ashley
  2026-09-06 verbatim: *"we don't even have to have the mechanism run on
  first ship. I'm okay with it just kind of happening naturally."* Middle
  zone falls through to insertion-order fallback until natural fill
  populates. Accepted tradeoff — natural fill is fast enough.

### Multi-device consistency
- **D-10:** Both of Ashley's devices (phone + desktop) read from the same
  Skynet backend, so both see the same value on their next fleet-status
  frame after any send. The device that DID the send sees the optimistic
  stamp instantly; the OTHER device sees it on the next status frame
  (~2 second poll cadence). Acceptable — she's not looking at the other
  device while sending.

### Claude's Discretion
- Exact table + column names (Drizzle schema)
- Migration mechanics
- The specific seam where backend swaps derivation source (in-orchestrator
  read vs pre-computed value passed in) — planner picks based on
  fingerprint/publish-trigger impact analysis
- Whether the stamp lookup happens per fleet-status tick or is cached
- Whether the client-side optimistic stamp goes through
  `advanceSessionLastMessageAt` directly or via a thin wrapper

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape + prior /open agreement
- `.planning/shapes/shape-middle-recency-from-send-log.md` — this phase's
  shape file, opened + locked + greenlit 2026-09-07. Every downstream
  decision defers to this file when in doubt.

### Prior shape context
- `.planning/shapes/shape-conversation-list-recency-sort.md` (2026-08-14) —
  the three-zone model + middle-recency-sort direction. Everything in this
  shape stays; Phase 85 narrows to the ranking source only.
- `.planning/shapes/shape-compose-send-funnel.closed.md` — establishes the
  universal send funnel on the compose surface (Phase 68). Hook target
  landed at `useComposeSend` in `ComposeBox.tsx`.

### Load-bearing implementation sites (READ these before planning)
- `src/ui/features/pretty-view/ComposeBox.tsx:440-496` — `useComposeSend`
  hook, THE universal send funnel. Every compose-surface button ends up
  calling `send(payload, options)` here. This is the hook site (D-04).
- `src/ui/features/pretty-view/ComposeBox.tsx:498-520` — ComposeBox props
  including `identityName`, `hostId`, `tmuxSession`. `identityName` is the
  D-02 store key.
- `src/backend/fleet-status/ssh-poll-orchestrator.ts:508-521` —
  `scanTailForNewestMessageAt`, the current recency derivation. D-07
  swaps this out for the store lookup.
- `src/backend/fleet-status/ssh-poll-orchestrator.ts:418-476` —
  `isRealUserTurn`, the "Ashley's real user turn" predicate (locked
  2026-08-23). Stays alive per D-08 for other consumers; retires from the
  lastMessageAt path.
- `src/backend/fleet-status/ssh-poll-orchestrator.ts:769` — fingerprint
  composition. A change to `lastMessageAt` still needs to trigger a
  publish; the new store's update must flow through here or an equivalent
  fingerprint axis.
- `src/backend/fleet-status/wire-protocol.ts:325` — `SessionState.lastMessageAt`
  wire field. Shape unchanged (D-07); only the source of the value
  changes.
- `src/ui/state/session-working-store.ts:738-798` —
  `advanceSessionLastMessageAt`, max-wins reconciliation. Client-side
  optimistic stamp (D-06) calls this directly.
- `src/ui/state/session-working-store.ts:816-823` —
  `seedSessionLastMessageAt`, called from AppShell on `/sessions/list`
  page-load. Backend `/sessions/list` derivation also swaps to the new
  store (parallel to D-07).
- `src/ui/state/conversation-store.ts:565-584` — `compareByRecencyDesc`,
  the middle-zone comparator. Unchanged.
- `src/ui/state/conversation-store.ts:417-426` — `resolveLastMessageAt`,
  the working-store lookup at snapshot-time. Unchanged.
- `src/backend/database/db/schema.ts` — Drizzle SQLite schema. New table
  lands here.
- `src/backend/database/db/index.ts` — DB init + migration invocation.
  New migration for the new table lands via this path.

### Fleet directives from role file
- Container-mutation coordination (§ Container mutations serialize) —
  BEFORE + AFTER coord-room announces on every deploy motion (skip if all
  peers dormant per § Skip coord-room post when all peers are dormant).
- Push-gate discipline (§ deploy-window boundary at git push) — per-push
  "may I?" required; deferred authorization is NOT standing authorization.
- Test discipline (§ Test discipline scoped vs full suite) — executor runs
  scoped tests for touched files; orchestrator runs full suite as the
  ship-gate immediately before `docker build`.
- Executor-vs-orchestrator remit (§ Subagents don't do deploys) — executor
  stops at code + commit + scoped-tests green; orchestrator owns pull +
  full-suite + coord + push + build + recreate + verify + coord.
- No worktrees (§ NEVER use git worktrees) — all work happens in the main
  `~/skynet-tiffany` tree on `feat/tab-title-from-tmux`.
- Skynet in-memory DB (§ Load-bearing invariants) — after ANY backend
  `db.insert/update/delete().run()`, call
  `await DatabaseSaveTrigger.forceSave("<reason>")` (pattern reference
  `host-autostart-routes.ts:173-181`). Direct writes only reach RAM until
  forceSave flushes to disk.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`useComposeSend.send`** (`ComposeBox.tsx:447-493`) — the universal send
  funnel from Phase 68. Every send path (text, reset, thumbs-up, recap,
  quick-send) routes through it. The single hook site for D-04.
- **`advanceSessionLastMessageAt`** (`session-working-store.ts:758-798`) —
  max-wins timestamp reconciliation with notify. The client-side
  optimistic stamp (D-06) is one call to this function.
- **Drizzle SQLite table pattern** (`src/backend/database/db/schema.ts`) —
  every existing durable table is a `sqliteTable(...)` declaration. Adding
  one for the send-log follows the same shape.
- **`DatabaseSaveTrigger.forceSave`** pattern (from role file, reference
  `host-autostart-routes.ts:173-181`) — mandatory after backend writes
  because SQLite is decrypted into RAM at startup; unflushed writes are
  lost on non-graceful shutdown.

### Established Patterns
- **Fingerprint-driven publish** (`ssh-poll-orchestrator.ts:725-769`) — a
  change on any axis of `SessionState` triggers a fresh publish only when
  the fingerprint string changes. The new derivation must still produce a
  changed fingerprint when the send-log advances.
- **Max-wins reconciliation** (`session-working-store.ts:758`) — the
  client-side working store never regresses to a stale value. Optimistic
  client stamps and backend-published stamps compose safely under this
  contract.
- **`identityName` threaded to ComposeBox** — the identity name is already
  a prop at every ComposeBox instantiation. No new plumbing to surface it
  at the hook site.
- **Log-first diagnostic discipline** (§ Standing directives) — every
  send-log write and every backend derivation-source-swap read should log
  with structured context (identityName, ts, callsite) at
  `/opt/skynet/console-forward-logs/console-forward.log`.

### Integration Points
- **Frontend send → backend stamp**: the client fires a stamp on send
  through an HTTP or WS path (planner picks — likely a new lightweight
  POST or piggyback on the existing send channel). Both the identity name
  and the timestamp cross the wire; server writes the record.
- **Backend derivation source-swap**: `scanTailForNewestMessageAt` is
  currently invoked in the per-tick per-session poll (see
  `ssh-poll-orchestrator.ts:1588`). The swap replaces that call with a
  lookup against the new store, keyed on the identity name resolved for
  the session.
- **Fingerprint / publish trigger**: a store-write must translate into a
  fingerprint delta so the fleet-status frame publishes the fresh value
  to all connected clients. Planner picks: the poll's next tick naturally
  reads the fresh store value → fingerprint changes → publish, OR a
  direct-publish path on write.

</code_context>

<specifics>
## Specific Ideas

- Concrete case Ashley used to name the bug (2026-09-06): "Ivy stood up a
  VM for Stacy within the last 24 hours, I think... yet she shows up
  underneath Lulabelle, who hasn't had a message sent to her since at
  least two and a half weeks ago." Ivy lives on workstation. Ivy recycled
  overnight (context-watch 80% nudge triggered on heavy work) → her
  newest JSONL was empty of real user turns → she sank to null-to-bottom.
  Lulabelle's ancient real-user-turn timestamp still floats her above.
  Phase 85 makes this class of bug structurally impossible.
- The context-watch 80% nudge amplifier: the more actively an identity
  works, the more often she recycles, the more often her transcript-based
  lastMessageAt resets to null. This is the pathological interaction —
  today's mechanism actively punishes the most productive identities.
- Ashley's mental model of the list is messaging-app: "who did I last
  talk to." One-directional signal only (Ashley → identity). The bug
  wasn't "the sort is wrong" — the sort is right; the SOURCE of what
  gets sorted is measuring the wrong thing.

</specifics>

<deferred>
## Deferred Ideas

- **Capture Ashley's phone Matrix DMs that bypass Skynet's compose
  surface.** The old mechanism didn't count these either (predicate
  excludes `<remote-content>`-wrapped turns). Adding that path is a
  different piece of work — different signal source, different plumbing
  (agent-relay hook, not Skynet compose funnel).
- **Multi-user keying** of the send-log store. Skynet on t1000 is
  single-tenant for Ashley, so the record needs no user column today. If
  Skynet ever runs multi-tenant (Stacy's Skynet on T800 is per-user), add
  the user dimension then.
- **Non-compose Skynet interaction paths.** If a future affordance adds a
  way to talk to an identity from outside the compose surface, wire it
  through the same stamp hook when that affordance is designed.
- **Manual "reset this identity's recency" affordance.** Recency decays
  naturally as other identities get talked to. Add only if practice shows
  a need.
- **Broadening the signal to "any message either direction."** Rejected
  in shape — makes noisy agents dominate the top rather than answering
  "who did I last talk to."

</deferred>

---

*Phase: 79-middle-list-recency-from-skynet-side-send-log*
*Context gathered: 2026-09-07*
</content>
</invoke>
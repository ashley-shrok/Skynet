# Phase 111: Conversation list arrives complete and stays live - Context

**Gathered:** 2026-09-16
**Status:** Ready for planning
**Source:** Shape file at `.planning/shapes/shape-conversation-list-complete-and-live.md` (opened + greenlit 2026-09-16 via `/build` → `/open`). This CONTEXT.md is seeded FROM that shape file — do NOT re-elicit decisions already captured there. The four decisions below (D-01..D-04 groups) are the NEW gray areas settled during discuss-phase, post-shape.

<domain>
## Phase Boundary

Deliver ONE complete answer — existence + appearance + resolved inheritance + pinned + hidden — served identically to the opening request and to the continuous fleet-status pulse, so the conversation list arrives finished on first paint and never lags behind while the client is open.

**The scope anchor, stated as the bar:** no row is ever seen in a state it then grows out of. The undressed window is GONE, not shortened. A correction-flicker is a failure of this phase even when the final state is right — especially so, because a rare machine-dependent flicker is the hardest kind of wrongness to track down.

**Critical scouting finding that resizes this phase (established by reading source, 2026-09-16):** the architecture the shape describes ALREADY EXISTS and is carrying the wrong cargo. `subscription-registry.ts:125` holds `const state = new Map<string, SessionState>()` — a live server-side map of every session — and `:139-153` already sends a full `snapshot` frame to every newly-subscribed frontend. `SessionStateSchema` (`wire-protocol.ts:355-389`) already carries 14 fields (status, backgroundTasks, lastMessageAt, aiTitle, dormant, recycling, contextPct, …). Everything is present EXCEPT the four appearance fields the list needs to be dressed (displayName, title, colorHue, avatar/task) plus pinned + hidden. So "server holds the picture, browser is a viewer, answer instantly" is NOT something to build — it is something to EXTEND. This is widening an existing carriage, not laying track.

</domain>

<decisions>
## Implementation Decisions

### Where appearance enters the pulse — HOST-SIDE (sweep), not server-side

- **D-01:** **Appearance rides the host-side sweep script** (`substrate/scripts/fleet-status-sweep.py`), NOT a server-side read while assembling frames. The sweep is already standing in the identity folder with the file open (`_enumerate_identities` at `:783` already scandirs `~/fleet/identities/*` and stats three sentinels per identity). Having the server read instead means going back out over the network for something the sweep could have carried — the same mistake this phase fixes one layer down.
- **D-02:** **Cost lands where it is cheapest and scales per-host.** Measured on this box (73 identities): current sweep shape 1.10ms median; naive read-everything (frontmatter + role resolve + `.pinned` + `.hidden`, no gating) 2.10ms median. Against a total sweep cost of 600-750ms wall, dominated by `discover_identity_jsonl_path` (617ms cumulative) + `scan_tail_for_layer1_recycling_signal` (272ms) per profile of a 1.04s run. The added work is ~1/600th of what the tick already spends.
- **D-03:** **NO change-detection / mtime-gating. Explicitly rejected on evidence, not overlooked.** A gate that decides "nothing changed, skip the read" is a mechanism that can be WRONG, and when it is wrong the symptom is a silently-stale list with nothing to indicate it. Trading ~1ms for a class of invisible staleness bugs is a bad trade. If a future agent proposes mtime-gating as an optimization, this decision is the answer: it was measured and declined. (An mtime-gated variant WAS benchmarked at 1.16ms — i.e. it saves ~0.9ms. Not worth a correctness risk.)
- **D-04:** **Add appearance as OPTIONAL FIELDS at the existing `SWEEP_SCHEMA_VERSION`. Do NOT bump the version.** The parser is deliberately lenient — it does no per-field validation and ignores fields it doesn't recognize — so optional additions need no version change. Bumping buys nothing and costs something: version comparison is strict equality (`sweep-schema.ts:236`), a mismatch latches for the whole SSH-channel lifetime (`ssh-poll-orchestrator.ts:1315-1317`), and a latched host reverts to the legacy per-file fan-out that Phase 92 existed to eliminate. The distributor pushes scripts out from the container at boot (`starter.ts:874-890`, `catalog.ts:259-261`), so a bump would trip every host at once during the seconds between app start and distribution — a window that self-corrects and is not worth designing around either way. **User's call, 2026-09-16, verbatim:** *"dude the distributor gets everything out to all the hosts when the app boots. we are not going to have a whole discussion and implementation around the few seconds between when the new version of the app starts, and when that distribution happens"*. So: no version negotiation, no fallback-behaviour analysis, no compatibility ceremony. Optional fields at version 1, and move on.
  - ⚠️ **Correction of record:** an earlier draft of D-04 asserted the opposite (bump the version; Phase 92's mismatch fallback makes it safe). That was written without reading the fallback, and it is wrong — the "fallback" is the legacy fan-out, not a graceful degrade. Kept here so a future session doesn't rediscover the bump idea and think it was considered and approved.

### What the frozen one-shot request becomes — KEEP IT, DEMOTE IT

- **D-05:** **Keep `GET /sessions/list`; stop the list being BUILT from it.** It becomes the backstop for what the pulse structurally CANNOT see. Deleting it would be cleaner in the diagram and worse in practice.
- **D-06:** **The specific cases the backstop exists for:** (a) a just-born identity that exists on disk before it is running — the pulse enumerates what's RUNNING, so it can never see this, no matter how well built; (b) any conversation on a host the pulse has not reached yet. Deliberately NOT special-cased into the fast path — a special case on the hot path for the rarest event in the system is how hot paths rot.
- **D-07:** **Change the TIMING RULE, not the existence.** Today `AppShell.tsx:711-714,793` carries a documented shape lock: fetched EXACTLY ONCE per page load, empty dep array, no polling, no refetch on focus. That lock is amended by this phase: the request fires **on open AND on becoming visible again** (pairs with D-11). Same path both times — one path to build, one path to get right. Update the shape-lock comment in place rather than leaving it contradicting the code.
- **D-08:** **The two existing hand-wired refresh exceptions** (identity create, relay-room create) should be re-examined once rows can appear on their own — they likely become unnecessary. Bounty `sidebar-fleet-sessions-refresh-after-identity-create` likely closes as superseded. Planner's call whether removal lands in this phase or is left as a follow-up; do NOT break them.

### What "one write authority" means concretely — PULSE DRESSES, NEVER ADJUDICATES EXISTENCE

- **D-09:** **The pulse MAY fill in appearance; appearance-writing stays ADDITIVE, never wholesale-replacing.** An answer that knows less must never blank out one that knew more, or the list would UNDRESS itself on a later tick — the same symptom this phase fixes, arriving from the opposite direction. All appearance writes funnel through the existing single door in `identities-store.ts` (`setIdentities` / a new additive-merge sibling). Exactly ONE place appearance can be written; both paths go through it.
- **D-10:** **⚠️ The `loaded` flag stays owned by the fuller request — the pulse must NOT set it.** This is the decision with a real bug behind it. `identities-store` answers TWO questions with one piece of data: "what does this look like?" AND "is this an agent at all?" The second drives the pane discriminator in `tabUtils.tsx:205` (`byKey.has(k) || !loaded`), and answering it wrongly-early already caused a Terminal to boot an xterm + real SSH WS and then unmount, leaking listeners (see the 2026-09-08 comment block at `identities-store.ts:258-273`, and the deliberate empty-map skip-guard at `:274-277` that exists solely to prevent it; bounty `terminal-first-flash-on-reload-plus-listener-leak`). Rule: **the pulse makes rows pretty; it never makes the app conclude an agent does not exist.** Single-authority for appearance is preserved; the existing hydration-race guard stays exactly as load-bearing as it is now.

### How much the reconnect gives up — NEVER PERMANENTLY, AND WAKE ON VISIBLE

- **D-11:** **Never give up permanently.** Today `fleet-status-client.ts:209` gives up after `MAX_RECONNECT_ATTEMPTS` = 5 with backoff `[2s,4s,6s,8s,8s]` ≈ 28s, then logs `fleet_status_client_gave_up` and is deaf for the life of the tab. That is tuned for a flaky network, not for a phone in a pocket — and a phone in a pocket is the NORMAL case, so today the common path is the failing path. Keep the existing backoff ladder for the first attempts, then settle into a slow steady retry (~30s) indefinitely rather than giving up. Cheap when nothing is listening; never unrecoverably deaf.
- **D-12:** **Add reconnect-on-visible.** Returning to the app reconnects immediately rather than waiting for the next slow retry, and re-asks for the current picture (pairs with D-07). This is the whole of "coming back shows what's current."
- **D-13:** **NO replay, NO gap-reconciliation, NO catch-up-on-what-was-missed.** The reconnect asks for the CURRENT picture; the re-ask IS the backstop. Correctness must never rest on reconciliation logic being perfect. Preserve the existing full-jitter draw (`:218-220`) so a multi-tab restore does not re-clump the herd.

### Claude's Discretion

- **Plan slicing.** Reference Phase 92's 5-plan structure and Phase 107's 3-4 plan collapse. Natural seams here: (1) sweep-side appearance + schema version bump, (2) server-side frame/snapshot widening, (3) frontend store additive-merge + one-shot demotion, (4) reconnect resilience. Planner may merge or split if the dependency graph reads better.
- **Exact wire field names** on the widened `SessionStateSchema` — match the existing `publicIdentity()` field names (`displayName`, `title`, `colorHue`, `task`, `avatarUrl`, `avatarEtag`, `coordinator`, `pinned`, `hidden`) so the frontend merge is a straight field copy rather than a translation layer.
- **Whether the sweep emits appearance on the existing identity line or a new line kind.** `SweepIdentityLine` already exists (`_build_identity_line` at `:660`); extending it is the default. A new line kind is acceptable if the schema reads cleaner.
- **Role-inheritance memo shape on the sweep side.** Must read each role file AT MOST ONCE per host per tick (Phase 85's `roleReadCache` at `identities.ts:382-407` is the reference — it stores the in-flight promise, not the resolved value, to collapse parallel reads). Python-side equivalent is a plain dict since the sweep is synchronous.
- **Whether to add a diagnostic log line on fail-closed appearance-read errors** — mirror Phase 92/107 log discipline; planner's call.
- **Whether the frozen-shape-lock comment amendment (D-07) is a code comment edit or a wider refactor** of that effect.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The agreement this phase implements
- `.planning/shapes/shape-conversation-list-complete-and-live.md` — **THE shape contract.** Greenlit 2026-09-16. `/close conversation-list-complete-and-live` verifies the built result against it, both ways (nothing missing, nothing added). Read the "What would make it wrong" and "Scope edges" sections especially.
- `.planning/shapes/campaign-conversation-list-live.md` — the superseded 3-shape campaign plan, retained as the record of WHY the sequence collapsed. Its success-criteria list (5 items) is still the acceptance frame.

### Reference implementations to mirror (READ FIRST)
- `.planning/phases/92-fleet-status-poller-batch-sweep-one-exec-per-host-not-one-pe/92-CONTEXT.md` — the sweep-script pattern being extended: one exec per host per tick, distributor-shipped not hand-installed, versioned schema with graceful fallback, "enumerate current fields explicitly then lock v1" discipline. **The backward-compat rule in this file is load-bearing for D-04.**
- `.planning/phases/107-hide-identity-rows-via-disk-sentinel-mirror-phase-92-for-the/107-CONTEXT.md` — sentinel read/write contracts, fail-closed discipline (`.catch(() => false)` — a stat failure must NEVER paint an identity as hidden/pinned by mistake), both-loaded hydrate gate.
- `.planning/phases/105-pin-sentinel-migration-move-identity-pin-state-from-skynet-d/105-CONTEXT.md` — the `.pinned` sentinel origin.

### Host-side sweep (D-01..D-04 touch site)
- `substrate/scripts/fleet-status-sweep.py` — `_enumerate_identities` `:783` (already scandirs identity folders + stats 3 sentinels), `_build_identity_line` `:660`, `main` `:844`, `SCHEMA_VERSION`. Profile: `discover_identity_jsonl_path` `:218` and `scan_tail_for_layer1_recycling_signal` `:441` are the 600ms+ dominators — do NOT make them worse.
- `src/backend/fleet-status/sweep-schema.ts` + `.test.ts` — the parsed shape of each sweep line; schema version gate lives here.
- `src/backend/distributor/catalog.ts` — sweep script distribution registration. **Never hand-edit installed copies on any box** (standing fleet directive) — edits land via the distributor sweep.

### Server-side held picture + wire (D-09 touch site)
- `src/backend/fleet-status/subscription-registry.ts` — `:125` the `Map<string, SessionState>` that IS the server-held picture; `:139-153` the existing snapshot-on-subscribe delivery. **This is why "answer instantly" is an extension, not a build.**
- `src/backend/fleet-status/wire-protocol.ts` — `SessionStateSchema` `:355-389` (the 14 fields to widen), `makeSnapshotFrame` `:487`, `makeUpdateFrame` `:493`, `makeGoneFrame` `:497`, `FRAME_SCHEMA_VERSION` `:14`.
- `src/backend/fleet-status/ssh-poll-orchestrator.ts` — poll dispatch.

### The two requests being merged
- `src/backend/database/routes/sessions.ts` — `GET /list` `:294`. **`:407` `resolveRoleForIdentity` already does a full `readIdentityFile` per session and discards everything but the `role:` line** — the read this phase stops wasting. `TmuxSessionRow` `:260-281`. Relay-room merge block `:569+` (must not regress).
- `src/backend/database/routes/identities.ts` — `GET /` `:317`. **`:328-334` uses ONLY the hostId VALUES of `identityHosts`; the identity-name KEYS are ignored** (stacy's comment) — the client-supplied mapping is a host-set in disguise. `publicIdentity()` `:160-277` = the canonical appearance shape + identity-over-role merge `:210-227`. Per-host role memo `:382-407` = the read-once pattern. Parallel `.pinned`/`.hidden` probes `:426-448` with fail-closed `.catch(() => false)`.
- `src/backend/claude-session/identity-artifact-reader.ts` — `resolveRoleForIdentity` `:334-351`, `readIdentityFile`, `listIdentityKeysOnHost` `:506`, `IDENTITY_KEY_RE` (guarantees lowercase on-disk keys), `extractCosmeticsFromFrontmatter`.

### Frontend store + guard (D-09, D-10 touch sites)
- `src/ui/state/identities-store.ts` — `setIdentities` `:64` (the single write door), `byHostKey` composite-key rationale `:18-27`, `buildIdentityHostsFromFleet` `:111`, `deriveDiskPinnedIds` `:162`, `deriveDiskHiddenIds` `:206`, `ensureFleetSubscription` `:236`, and **`:255-298` `fetchOnce` — the empty-map skip-guard + the 2026-09-08 comment block explaining the terminal-flash/listener-leak bug that D-10 exists to preserve.**
- `src/ui/shell/tabUtils.tsx:205` — `byKey.has(k) || !loaded` pane discriminator. The consumer of the `loaded` flag D-10 protects.
- `src/ui/AppShell.tsx` — `:702-793` the one-shot fetch effect with the TG-17 shape-lock comment (D-07 amends this) + the localStorage row-set cache seed `:726`.
- `src/ui/state/conversation-store.ts` — row construction `:695,734`, `fleetRowId`, the row-set cache `:1228`, pin/hide state.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — the both-loaded-gated hydrate effect (~`:475`, `:502`), `handleToggleHide` ~`:1355`.

### Reconnect resilience (D-11..D-13 touch site)
- `src/ui/api/fleet-status-client.ts` — `MAX_RECONNECT_ATTEMPTS` gate `:209`, `BACKOFF_SCHEDULE_MS` `[2000,4000,6000,8000,8000]`, full-jitter draw `:218-220`, attempt reset on open `:92-93`, `fleet_status_client_gave_up` log.
- `src/ui/api/fleet-status-client.test.ts` — Test 5 `:195-220` locks the current give-up behaviour; **this test must be updated deliberately, not deleted.**

### Standing constraints (role-level, non-negotiable)
- **Skynet has NO message streaming, anywhere.** Do not design around streaming state or add streaming affordances.
- **In-memory SQLite:** any backend `db.insert/update/delete().run()` MUST be followed by `await DatabaseSaveTrigger.forceSave("<reason>")` in try/catch. (Likely not touched by this phase — no DB writes expected — but if a plan adds one, this applies.)
- **Per-host SSH channel semaphore** (cap 8, sized against sshd `MaxSessions=10`): the cap is per-CHANNEL not per-identity. Respect it; do not assume headroom. Bounty `ssh-channel-cap-enforce-structurally-not-by-convention`.
- **Test discipline:** scoped `npx vitest related --run <files>` during dev/executor. Full suite + playwright smoke is a per-DEPLOY gate, orchestrator-only, AFTER ship greenlight — never at executor scope.
- **Executors do NOT deploy.** Executor remit stops at code + commit + scoped tests green. No "ship" task at executor scope.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **The server-held state map + snapshot-on-subscribe** (`subscription-registry.ts:125,139-153`) — the entire "server holds the picture, browser is a viewer" requirement is already implemented. Widen the payload; do not rebuild the mechanism.
- **The sweep's existing identity-folder walk** (`fleet-status-sweep.py:783`) — already scandirs every identity folder and stats three sentinels per identity. Appearance + `.pinned` + `.hidden` are two more stats and one capped read on a visit that already happens.
- **`publicIdentity()`** (`identities.ts:160`) — the canonical appearance shape INCLUDING the identity-over-role merge. Reuse its field names and merge semantics rather than re-deriving; divergence here would be a second authority by the back door.
- **Phase 85's role read-once memo** (`identities.ts:382-407`) — the exact pattern for "read each role file at most once regardless of how many identities share it."
- **Phase 92's schema-version + graceful-fallback plumbing** — already handles the mid-rollout older-box case D-04 depends on.
- **Full-jitter reconnect ladder** (`fleet-status-client.ts:218-220`) — keep; only the terminal give-up changes.

### Established Patterns
- **Fail-closed on sentinel read error** — `.catch(() => false)`. A stat failure must NEVER paint an identity as pinned or hidden by mistake. Extends to appearance: a failed read yields safe-default appearance, NEVER a missing row.
- **Per-host silent-swallow with a LOG LINE** — one dead box contributes zero rows rather than failing the endpoint, but it MUST log (`identities.ts:473-478,495-499` — a prior version silently dropped a whole host with no trace; stacy 2026-09-15 fixed exactly that). Preserve this: independence per host, but never invisible.
- **Composite `${hostId}::${identityKey}` keying** for cross-host name collisions (quick-260912-0t4). Two identities named the same on different hosts must not collide. Any new appearance path must key the same way.
- **Lowercase-on-disk invariant** — `IDENTITY_KEY_RE` forbids uppercase, so folder-name keys are already lowercase and match `session.sessionName` from the wire byte-for-byte.

### Integration Points
- **Sweep line → `sweep-schema.ts` parse → `SessionState` → snapshot/update frame → frontend client → `identities-store` (appearance, additive) + `conversation-store` (rows/order/membership).** That is the one path this phase widens end to end.
- **`GET /sessions/list`** stays as the backstop, re-fired on open + on visible (D-07).
- **`GET /identities`** stays UNCHANGED and alive for the identity modal, avatar handling, and role-defaults inheritance display. The list stops DEPENDING on it; it is not being removed.

</code_context>

<specifics>
## Specific Ideas

- **The user's framing that collapsed the 3-shape campaign into one, verbatim:** *"i mean, i don't know if this makes things simpler for you, but like as far as i understand it, we have the initial load of the list. and then we have polling that happens after that. and since things can change in the list in all manner of ways, then would it be simplest just to request everything needed to render the list correctly initially and then just request that same set of stuff every time we poll so that it updates when needed and that's the whole story?"* — Yes, and measurement showed it is affordable by three orders of magnitude.
- **On inheritance being in scope, verbatim:** *"fully dressed includes inheritance"*.
- **On pin/hide (position + membership) being in scope, verbatim:** *"how can the list arrive without all the info needed?"* — this closed the door on shipping appearance-only and following up with ordering. A list that rearranges under your thumb has not arrived.
- **On the standing bar for the whole effort, verbatim:** *"i want to just take the right pass at it and i don't even care if we completely redo pieces that i'm talking about because i want it to be done right"*.
- **On the phone case, verbatim:** *"if somebody comes back to the app then they should be seeing what is current just like any other time"* — fresh-load vs resume-and-catch-up was left as ours to choose; D-13 chooses re-ask over reconciliation.
- **On the target hardware, verbatim:** *"i don't know what would be too much on let's say a four gig graviton ec2 host because that's sort of the smallest host that i'm targeting to be running agents"* — answered by measurement: memory peak per tick is ~74MB and is dominated by transcript-tail scanning, NOT by anything this phase adds; cost scales with agents-per-host, not fleet size.

</specifics>

<deferred>
## Deferred Ideas

- **The slow first-ever-load experience** — what to show when there is no cache and real work must happen before anything can be shown, and distinguishing "still looking" from "found nothing" from "couldn't reach some hosts". Today it is a single "Loading conversations…" line that flips to showing nothing on failure, indistinguishable from having no conversations. **Deferred by explicit user decision** during campaign concept-open; it only bites the first time anybody opens the app. Becomes its own phase.
- **Making an individual conversation open faster** — the sibling "opening a specific conversation is slow" complaint. Different surface. Bounty `speed-up-pretty-view-initial-load`.
- **Multi-user re-scoping of pinned/hidden** — the sentinels are identity-scoped, so one user's pin/hide affects everyone. Acknowledged tradeoff carried forward from Phase 107 (user: *"i realize that means that one user hiding them would hide them for everyone else. i'm okay with that right now"*). A future phase would migrate both axes to per-user sentinels.
- **Removing the per-host SSH channel semaphore** — deferred indefinitely per Phase 92; a loose safety net is fine.
- **Retiring the two hand-wired refresh exceptions** (identity create, relay-room create) — see D-08. May land here or as a follow-up; planner's call. Do NOT break them in the meantime.

</deferred>

---

*Phase: 111-conversation-list-arrives-complete-and-stays-live*
*Context gathered: 2026-09-16*

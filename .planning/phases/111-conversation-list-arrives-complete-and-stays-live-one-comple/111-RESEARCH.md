# Phase 111: Conversation list arrives complete and stays live — Research

**Researched:** 2026-09-16
**Domain:** Cross-tier data-shape widening (host-side Python sweep → SSH orchestrator → zod wire → WS client → React stores) in an existing production codebase
**Confidence:** HIGH on all source-read claims (every file:line below was opened and read this session). MEDIUM on the two design recommendations flagged as such.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Where appearance enters the pulse — HOST-SIDE (sweep), not server-side**

- **D-01:** **Appearance rides the host-side sweep script** (`substrate/scripts/fleet-status-sweep.py`), NOT a server-side read while assembling frames. The sweep is already standing in the identity folder with the file open (`_enumerate_identities` at `:783` already scandirs `~/fleet/identities/*` and stats three sentinels per identity). Having the server read instead means going back out over the network for something the sweep could have carried — the same mistake this phase fixes one layer down.
- **D-02:** **Cost lands where it is cheapest and scales per-host.** Measured on this box (73 identities): current sweep shape 1.10ms median; naive read-everything (frontmatter + role resolve + `.pinned` + `.hidden`, no gating) 2.10ms median. Against a total sweep cost of 600-750ms wall, dominated by `discover_identity_jsonl_path` (617ms cumulative) + `scan_tail_for_layer1_recycling_signal` (272ms) per profile of a 1.04s run. The added work is ~1/600th of what the tick already spends.
- **D-03:** **NO change-detection / mtime-gating. Explicitly rejected on evidence, not overlooked.** A gate that decides "nothing changed, skip the read" is a mechanism that can be WRONG, and when it is wrong the symptom is a silently-stale list with nothing to indicate it. Trading ~1ms for a class of invisible staleness bugs is a bad trade. If a future agent proposes mtime-gating as an optimization, this decision is the answer: it was measured and declined. (An mtime-gated variant WAS benchmarked at 1.16ms — i.e. it saves ~0.9ms. Not worth a correctness risk.)
- **D-04:** **Older-box degradation is the deciding factor and it is already solved.** Phase 92 established a graceful fallback when a peer box has not yet received the new sweep script (schema_version mismatch → fall back to legacy plumbing, never hard-fail). Appearance riding the sweep means an un-updated box reports the OLD fields and its agents arrive UNDRESSED until the distributor catches up — which is exactly today's behaviour. Worst case is "no better yet," never "newly broken." Bump `SCHEMA_VERSION` in the sweep + `sweep-schema.ts` accordingly.

**What the frozen one-shot request becomes — KEEP IT, DEMOTE IT**

- **D-05:** **Keep `GET /sessions/list`; stop the list being BUILT from it.** It becomes the backstop for what the pulse structurally CANNOT see. Deleting it would be cleaner in the diagram and worse in practice.
- **D-06:** **The specific cases the backstop exists for:** (a) a just-born identity that exists on disk before it is running — the pulse enumerates what's RUNNING, so it can never see this, no matter how well built; (b) any conversation on a host the pulse has not reached yet. Deliberately NOT special-cased into the fast path — a special case on the hot path for the rarest event in the system is how hot paths rot.
- **D-07:** **Change the TIMING RULE, not the existence.** Today `AppShell.tsx:711-714,793` carries a documented shape lock: fetched EXACTLY ONCE per page load, empty dep array, no polling, no refetch on focus. That lock is amended by this phase: the request fires **on open AND on becoming visible again** (pairs with D-11). Same path both times — one path to build, one path to get right. Update the shape-lock comment in place rather than leaving it contradicting the code.
- **D-08:** **The two existing hand-wired refresh exceptions** (identity create, relay-room create) should be re-examined once rows can appear on their own — they likely become unnecessary. Bounty `sidebar-fleet-sessions-refresh-after-identity-create` likely closes as superseded. Planner's call whether removal lands in this phase or is left as a follow-up; do NOT break them.

**What "one write authority" means concretely — PULSE DRESSES, NEVER ADJUDICATES EXISTENCE**

- **D-09:** **The pulse MAY fill in appearance; appearance-writing stays ADDITIVE, never wholesale-replacing.** An answer that knows less must never blank out one that knew more, or the list would UNDRESS itself on a later tick — the same symptom this phase fixes, arriving from the opposite direction. All appearance writes funnel through the existing single door in `identities-store.ts` (`setIdentities` / a new additive-merge sibling). Exactly ONE place appearance can be written; both paths go through it.
- **D-10:** **⚠️ The `loaded` flag stays owned by the fuller request — the pulse must NOT set it.** This is the decision with a real bug behind it. `identities-store` answers TWO questions with one piece of data: "what does this look like?" AND "is this an agent at all?" The second drives the pane discriminator in `tabUtils.tsx:205` (`byKey.has(k) || !loaded`), and answering it wrongly-early already caused a Terminal to boot an xterm + real SSH WS and then unmount, leaking listeners (see the 2026-09-08 comment block at `identities-store.ts:258-273`, and the deliberate empty-map skip-guard at `:274-277` that exists solely to prevent it; bounty `terminal-first-flash-on-reload-plus-listener-leak`). Rule: **the pulse makes rows pretty; it never makes the app conclude an agent does not exist.** Single-authority for appearance is preserved; the existing hydration-race guard stays exactly as load-bearing as it is now.

**How much the reconnect gives up — NEVER PERMANENTLY, AND WAKE ON VISIBLE**

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

### Deferred Ideas (OUT OF SCOPE)

- **The slow first-ever-load experience** — what to show when there is no cache and real work must happen before anything can be shown, and distinguishing "still looking" from "found nothing" from "couldn't reach some hosts". Today it is a single "Loading conversations…" line that flips to showing nothing on failure, indistinguishable from having no conversations. **Deferred by explicit user decision** during campaign concept-open; it only bites the first time anybody opens the app. Becomes its own phase.
- **Making an individual conversation open faster** — the sibling "opening a specific conversation is slow" complaint. Different surface. Bounty `speed-up-pretty-view-initial-load`.
- **Multi-user re-scoping of pinned/hidden** — the sentinels are identity-scoped, so one user's pin/hide affects everyone. Acknowledged tradeoff carried forward from Phase 107 (user: *"i realize that means that one user hiding them would hide them for everyone else. i'm okay with that right now"*). A future phase would migrate both axes to per-user sentinels.
- **Removing the per-host SSH channel semaphore** — deferred indefinitely per Phase 92; a loose safety net is fine.
- **Retiring the two hand-wired refresh exceptions** (identity create, relay-room create) — see D-08. May land here or as a follow-up; planner's call. Do NOT break them in the meantime.
</user_constraints>

---

## Summary

The phase is four independent widenings connected by one data path, and the shape of each is already established by precedent in this repo. **Nothing here requires a new mechanism.** The sweep script already visits every identity folder and stats three sentinels (`fleet-status-sweep.py:783-816`); the wire schema already carries 14 optional per-session fields and has a seven-times-repeated convention for adding more without a version bump (`wire-protocol.ts:79-353`); the server already holds a live `Map<string, SessionState>` and already sends a full snapshot on subscribe (`subscription-registry.ts:125,146-151`); the frontend already has a single appearance write door (`identities-store.ts:64` `setIdentities`).

**Three findings materially change the plan versus what CONTEXT.md anticipated**, all confirmed by source reading:

1. **D-04's "graceful fallback already exists" is TRUE but its cost is much higher than the phrase suggests, and bumping `SWEEP_SCHEMA_VERSION` is the WRONG lever.** The fallback works (`ssh-poll-orchestrator.ts:1271-1318`), but a `schema-mismatch` verdict **latches for the whole SSH-channel lifetime** (`:1315-1317`) and drops that host onto the legacy path — which is the ~75-90-exec-per-tick fan-out Phase 92 existed to kill (`92-CONTEXT.md:12-14`), the exact thing that saturated `sshd MaxSessions=10`. Worse, the direction of the mismatch is inverted from what D-04 assumes: **bumping the constant makes the NEW server reject every OLD box's output**, not the reverse. The sweep script is distributed by a container-boot sweep (`starter.ts:874-890`, `catalog.ts:253-262`) — so on deploy, the new server briefly faces old scripts on peer boxes. See **Pitfall 1**. The recommendation is to add appearance as **optional fields at `SWEEP_SCHEMA_VERSION` 1** (`parseSweepJsonl` already tolerates unknown/missing fields — it does no per-field validation, `sweep-schema.ts:242-250`), which yields *exactly* the degradation D-04 wants ("old box reports old fields, its agents arrive undressed") without ever touching the legacy path.

2. **Fingerprint suppression will silently swallow appearance changes** unless every new field is added to a fingerprint. Source A uses `computeFingerprint()` (`ssh-poll-orchestrator.ts:983`, a 12-segment template literal); source B uses a separate 2-segment string (`:1923`). A frame whose *only* change is `colorHue` will be **computed, then not published** — this is not a hypothetical, it is how both compose helpers are written. See **Pitfall 2**. This is the single highest-risk item after D-10.

3. **Row creation/removal on the live path does not exist at any level and is the largest single piece of new work.** The `gone` frame is fully wired end-to-end (`wire-protocol.ts:497` → `fleet-status-client.ts:163-175` → `AppShell.tsx:559-563`) but every consumer only *marks state* — `publishFleetStatusSessionGone`, `publishFleetStatusWaitingFor(null)`, `publishFleetStatusTmuxSessionGone`. **No WS path calls `updateFleetSessions` or `removeFleetSession`.** Rows are built exclusively from `state.fleetSessions` (`conversation-store.ts:695,734`), which is written only by the one-shot fetch, the localStorage cache seed, and two hand-wired exceptions. The seam is precise and small, but it is genuinely new. See **Architecture Pattern 3**.

**Primary recommendation:** Slice as 5 plans — (1) sweep-side appearance at schema v1, additive-optional, no version bump; (2) wire + fingerprint widening (both fingerprints, three type mirrors); (3) row appear/disappear on the pulse (the new-work plan, isolated so it can be reverted alone); (4) frontend additive appearance merge via a new `mergeIdentityAppearance` door that provably cannot touch `loaded`; (5) reconnect resilience + visibility re-ask. Plans 1→2 are strictly sequential; 3, 4, 5 are independent of each other but all depend on 2.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Read identity frontmatter (title/colorHue/displayName/task) | Host-side sweep script (Python) | — | D-01 locked. The walk already happens at `fleet-status-sweep.py:783`; the file is 286 bytes on this box. Reading server-side would mean a network round-trip for a byte already under the sweep's hand. |
| Read role frontmatter for inheritance | Host-side sweep script | — | Role files live at `~/fleet/roles/<role>/<role>.md` on the same box (`role-file-watch.py:281` confirms path shape on managed hosts). Must be memoized per tick (Discretion item). |
| Resolve identity-over-role merge (`identity ?? role ?? null`) | **Ambiguous — see Open Question 1** | — | `publicIdentity()` at `identities.ts:209-227` is the canonical merge today. Doing it in Python duplicates the authority in a second language; doing it in the orchestrator keeps one TS implementation but puts a merge on the hot compose path. |
| Read `.pinned` / `.hidden` sentinels | Host-side sweep script | — | Two more `os.path.exists` on a `scandir` entry that is already open (`fleet-status-sweep.py:800-804` does exactly this for three siblings). |
| Frame assembly + fan-out | Backend `subscription-registry` | `ssh-poll-orchestrator` | Already owns the held picture (`:125`) + snapshot-on-subscribe (`:146-151`). |
| Publish/suppress decision (fingerprint) | Backend `ssh-poll-orchestrator` | — | Both compose helpers own it; appearance MUST enter both fingerprints. |
| Appearance storage + lookup for render | Frontend `identities-store` | — | D-09 locked: one door. `PrettyConversationRow.tsx:333-351` reads `byHostKey`/`byKey` — it does NOT read `SessionState`. Appearance on the wire must land in this store to reach a pixel. |
| Row existence (membership) | Frontend `conversation-store` | — | `computeSnapshot` builds rows from `state.fleetSessions` only (`:734`). This is the tier that must learn to add/remove from the pulse. |
| "Is this an agent at all?" (`loaded`) | Frontend `identities-store`, **written only by `GET /identities`** | — | D-10 locked. Consumer is `tabUtils.tsx:284`. |
| WS transport resilience | Frontend `fleet-status-client` | — | Sole owner of the reconnect ladder (`:197-236`). |

---

## Standard Stack

No new dependencies. This phase is entirely internal-API work against the existing stack.

### Core (already present, versions from repo)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `zod` | in `package.json` | Wire-frame validation | `wire-protocol.ts:8` — every frame schema. `.optional().nullable()` is the established additive-extension idiom (7 precedents). [VERIFIED: source read] |
| `js-yaml` (as `yaml`) | in `package.json` | Frontmatter parse, TS side | `identity-artifact-reader.ts` `extractCosmeticsFromFrontmatter` `:2356`, `extractRoleFromMarkdown` `:280`. [VERIFIED: source read] |
| Python 3 stdlib only | 3.6+ floor | Sweep script | Hard constraint declared at `fleet-status-sweep.py:80-82`: *"Python 3.6+ stdlib ONLY (no pip installs)."* [VERIFIED: source read] |
| `vitest` | in `package.json` | All TS tests | Scoped runs only per fleet directive. |

### On PyYAML — do NOT use it

`python3 -c "import yaml"` succeeds on **this** box (PyYAML 6.0.1) [VERIFIED: ran this session]. **This is not evidence it is available fleet-wide, and the sweep script's own contract forbids relying on it** (`fleet-status-sweep.py:80-82`). An `ImportError` inside the sweep would hit the top-level catch at `:920-930` → stderr + exit 0 + **empty stdout** → the orchestrator reads zero lines → `empty-output-on-nonempty-box` → **that host falls to the legacy exec fan-out every single tick, silently**. That is the Phase 92 regression, reintroduced by an import statement.

**Use the existing hand-rolled fence-scan pattern instead.** Two in-fleet precedents, both battle-tested:

| Precedent | Location | Notes |
|-----------|----------|-------|
| `_read_frontmatter` | `substrate/scripts/ambient-monitor.py:240-283` | **The better model.** `utf-8-sig` encoding (BOM-safe), `#`-comment skip, quote-strip, strict value validation, returns safe defaults on any `OSError`. Handles `role:` + `coordinator: true`. |
| `_parse_role_from_frontmatter` | `substrate/scripts/role-file-watch.py:58-84` | Simpler; `import re` inside the loop; no BOM handling, no comment skip. Weaker — do not mirror this one. |

Neither extracts `title` / `colorHue` / `displayName` / `task`, so the parser needs extending regardless. Extend the **ambient-monitor** shape.

### Installation

None. No `npm install`, no `pip install`.

---

## Package Legitimacy Audit

**Not applicable — this phase installs zero external packages.**

Per the Package Legitimacy Gate protocol: the gate applies "whenever this phase installs external packages." Every capability required by D-01..D-13 is served by code already in the repository or by Python 3 stdlib. `slopcheck` was therefore not run, and there is no package table to emit. The one package that a naive implementation might reach for (PyYAML) is **explicitly rejected above** — not on legitimacy grounds but on the sweep script's own stdlib-only contract, and because its failure mode is a silent fleet-wide regression to the legacy exec path.

If a plan is written that adds any dependency, that plan must run the gate before install.

---

## Architecture Patterns

### System Architecture Diagram

```
                    HOST-SIDE (per managed box, once per ~2s tick)
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  ~/.local/bin/fleet-status-sweep   (fleet-status-sweep.py)               │
  │                                                                          │
  │  scandir ~/fleet/identities/*  ──┬─→ .dormant / .recycled-at /          │
  │     (_enumerate_identities :783) │    .recycle-requested   [EXISTS]      │
  │                                  ├─→ .pinned / .hidden     [ADD, D-01]   │
  │                                  └─→ <key>/<key>.md frontmatter [ADD]    │
  │                                        │                                 │
  │                                        ↓ role: <name>                    │
  │                                  ~/fleet/roles/<r>/<r>.md  [ADD]         │
  │                                  (memoized dict, ≤1 read/role/tick)      │
  │  glob ~/.claude/sessions/*.json ─→ PID lines  [EXISTS, untouched]        │
  │                                                                          │
  │  stdout: JSONL, one obj/line, schema_version:1  (_emit :838)             │
  └──────────────────────────────────────────────────────────────────────────┘
                    │  ONE channel.exec per host per tick
                    ↓
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  ssh-poll-orchestrator.ts                                                │
  │                                                                          │
  │  pollOneHost :1219  ──probe─→ sweep present?                             │
  │       ├─ yes → pollOneHostBatch :1445                                    │
  │       │        parseSweepJsonl :1489 ──schemaMismatch?──→ LATCH + legacy  │
  │       │        ├─ pid lines  → pidLineToPerPidFetched :1573              │
  │       │        │              → composeAndPublishPerPid :2268            │
  │       │        │                └─ computeFingerprint :937  ⚠️ GATE      │
  │       │        └─ id lines   → identityLineToPerIdentityFetched :1611    │
  │       │                       → composeAndPublishPerIdentity :1858       │
  │       │                         └─ 2-seg fingerprint :1923  ⚠️ GATE      │
  │       └─ no  → pollOneHostLegacy :1376  (~75-90 execs — AVOID)           │
  └──────────────────────────────────────────────────────────────────────────┘
                    │  publishSessionState(hostId, SessionState)
                    ↓
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  subscription-registry.ts   ★ THE SERVER-HELD PICTURE                    │
  │    state: Map<`${hostId}:${tmux}`, SessionState>  :125                   │
  │    publishSessionState :203 → state.set + fanOut(makeUpdateFrame)        │
  │    subscribe :132        → makeSnapshotFrame(all values)  :146-151       │
  │    publishSessionGone :221 → state.delete + fanOut(makeGoneFrame)        │
  └──────────────────────────────────────────────────────────────────────────┘
                    │  WS /fleet-status/ws
                    ↓
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  fleet-status-client.ts  (browser)                                       │
  │    onmessage :111 → switch(type)                                         │
  │      snapshot :128 → onSnapshot(states)                                  │
  │      update   :147 → onUpdate(state)                                     │
  │      gone     :163 → onGone(hostId, tmux, sessionId)                     │
  │    onclose :197 → ladder [2,4,6,8,8]s, full-jitter :222                  │
  │                   ⚠️ :209 gives up forever after 5   (D-11 fixes)        │
  │                   ⚠️ no visibilitychange listener    (D-12 adds)         │
  └──────────────────────────────────────────────────────────────────────────┘
                    │  AppShell.tsx:537-566 callback wiring
        ┌───────────┴──────────────┬────────────────────────┐
        ↓                          ↓                        ↓
  session-working-store     identities-store         conversation-store
  session-waiting-store     ← APPEARANCE lands       ← ROW EXISTENCE lives
  session-tmux-store          here (D-09 door)         here (fleetSessions)
  [EXISTS, untouched]         [ADD merge, D-09/10]     [ADD add/remove — NEW]
                                     │                        │
                                     └────────┬───────────────┘
                                              ↓
                              PrettyConversationRow.tsx:333-351
                              reads byHostKey/byKey for appearance;
                              reads row.* from conversation-store
```

**The two moments, on this diagram (shape file § "Two moments, one answer"):**
- *Opening*: browser subscribes → `subscribe :132` replies from the Map — **no host round-trip**. Already true today.
- *Continuous*: same Map, same `SessionState` shape, via `makeUpdateFrame`. Already true today.
- What is missing is only the **cargo** (appearance fields) and the **row-membership consumer** at the bottom-right.

### Recommended Structure (no new files required, but two are optional)

```
substrate/scripts/
└── fleet-status-sweep.py           # extend: _read_identity_appearance(),
                                    #   role memo dict, _build_identity_line
src/backend/fleet-status/
├── sweep-schema.ts                 # extend SweepIdentityLine + parity map
├── ssh-poll-orchestrator.ts        # extend both adapters + BOTH fingerprints
└── wire-protocol.ts                # extend SessionStateSchema (optional+nullable)
src/ui/api/
├── fleet-status-types.ts           # MIRROR #1 — hand-maintained, must match
└── fleet-status-client.ts          # reconnect ladder + visibility
src/ui/state/
├── identities-store.ts             # NEW: mergeIdentityAppearance() door
└── conversation-store.ts           # NEW: upsert/remove one FleetSession
src/ui/
└── AppShell.tsx                    # amend TG-17 lock comment; wire callbacks
```

---

### Pattern 1: Additive-optional wire extension WITHOUT a version bump

**What:** Every new `SessionState` field is `.optional().nullable()`, and `FRAME_SCHEMA_VERSION` is deliberately **held at 1**.

**When to use:** Every field this phase adds to `SessionStateSchema`.

**This is the single most well-established convention in the file — seven consecutive precedents, each documenting the same reasoning:**

```
Phase 41 lastMessageAt                    → held at 1
Phase 47 aiTitle                          → held at 1
Phase 52 dormant                          → held at 1
Phase 53 recycling                        → held at 1
Phase 59 lastStopAt + lastStatusChangeAt  → held at 1
Phase 62 activityMtime + stoppedMtime     → held at 1
Phase 90 contextPct                       → held at 1
```
— lineage table quoted verbatim from `wire-protocol.ts:308-315`. [VERIFIED: source read]

The rule, quoted from `wire-protocol.ts:96-99`:

> *"Because the field is `.optional().nullable()`, FRAME_SCHEMA_VERSION is deliberately HELD AT 1 — additive+optional extensions never require a version bump (T-41-03-05 mitigation). If a future breaking change lands, THAT change bumps the version."*

**Answering research question 2 directly: `FRAME_SCHEMA_VERSION` is bumped ONLY for breaking changes. This phase must NOT bump it.**

**Is `SessionStateSchema` zod-validated on both ends? No — asymmetric, and this matters.**
- **Backend inbound** (watcher→backend): yes, `WatcherInboundFrame` discriminated union `:416`, consumed at `fleet-status-server.ts`.
- **Backend outbound** (backend→browser): schemas exist (`FrontendOutboundFrame` `:474`) but frames are built by the `make*Frame` helpers `:487-513` which **stamp and pass through without `.parse()`**. `subscription-registry.ts:146,218,235` call them directly.
- **Browser:** **no zod at all.** `fleet-status-client.ts:12-16` states this explicitly: *"No zod on the browser side — avoids a 10KB+ bundle cost for a validation layer the backend already provides."* It is a bare `JSON.parse` + `as` cast at `:116`.

**Strictness implication:** `z.object` is non-strict by default (unknown keys stripped, not rejected), so adding optional fields is safe in both directions. But because the browser does no validation, **the browser's type mirror is the only thing keeping the frontend honest** — see Pitfall 3.

**Example (the exact shape to follow):**
```typescript
// Source: src/backend/fleet-status/wire-protocol.ts:383-388 (Phase 90 precedent)
  // Phase 90 Plan 00 (Wave 0, D-10 delivery mechanism) — per-session context %
  // fill (0-100, integer). Populated by subscription-registry.publishSessionState
  // + getSnapshot at frame-publish time from the contextpct-store shared map...
  contextPct: z.number().nullable().optional(),
```

---

### Pattern 2: Two-tier sweep line, joined on `identity`

**What:** The sweep emits `line_kind: "identity"` lines (one per folder) and `line_kind: "pid"` lines (one per live claude PID), joined by the `identity` field.

**Where appearance belongs: on `SweepIdentityLine`.** This is the CONTEXT.md default and source reading confirms it is right — the identity line is the one keyed by identity folder, which is exactly where appearance lives on disk. The rationale for two tiers is documented at `sweep-schema.ts:4-17`:

> *"A single flat 'one line per identity' shape would (a) force null-padding of the PID axis for identities with no live claude process, and (b) force array-nesting when one identity has multiple live PIDs."*

**Do NOT add a third `line_kind`.** `parseSweepJsonl` counts unrecognised kinds into `unknownLines` and **drops them** (`sweep-schema.ts:246-250`) — a new kind would need parser work for zero benefit, and the parity-map test (`sweep-schema.test.ts:271-292`) asserts an exact 19-key set that a new kind would not naturally extend.

**How `_build_identity_line` composes today** (`fleet-status-sweep.py:660-684`) — appearance slots in as additional dict keys, and the sentinels dict passed from `main` is the natural carrier:

```python
# Source: substrate/scripts/fleet-status-sweep.py:675-684 (current, verbatim)
    return {
        "line_kind": "identity",
        "schema_version": SCHEMA_VERSION,
        "identity": name,
        "dormant": sentinels["dormant"],
        "recycled_at": sentinels["recycled_at"],
        "recycle_requested": sentinels["recycle_requested"],
        "jsonl_path": jsonl_path,
        "layer1_recycling": layer1,
    }
```

**Least-disruptive insertion points, in call order:**

| Site | Line | What to add |
|------|------|-------------|
| `_enumerate_identities` | `:800-810` | Two more `os.path.exists` (`.pinned`, `.hidden`) into the returned dict — byte-parallel with the three already there at `:800-804`. |
| `_enumerate_identities` | `:805-810` | Frontmatter read for the identity — `entry.path` is already in hand, so the path join is local. |
| `main` | `:884-887` | The role-memo dict belongs here, beside `identity_jsonl_paths = {}` — same lifetime (one tick), same pattern. |
| `_build_identity_line` | `:660,675-684` | New params + new dict keys. |

**Current `SCHEMA_VERSION` is `1`** (`fleet-status-sweep.py:102`), matching `SWEEP_SCHEMA_VERSION = 1 as const` (`sweep-schema.ts:42`). The script's docblock at `:14-19` declares the contract: *"Field names + types below must be BYTE-IDENTICAL to the TypeScript."*

---

### Pattern 3: Row appear/disappear on the live path — THE NEW SEAM

**Answering research question 3 precisely.**

**Is there an existing `gone` path wired to row removal? No. It is wired end-to-end but every consumer only marks state.**

The frame plumbing is complete:
- `makeGoneFrame` `wire-protocol.ts:497`, published by `publishSessionGone` `subscription-registry.ts:221-238` (which no-ops if the key is absent, `:229-231`).
- Backend publishers: `ssh-poll-orchestrator.ts:2431` (legacy stale-reap), `:2784` (sweep stale-reap), `fleet-status-server.ts:387` (watcher-driven).
- Client dispatch: `fleet-status-client.ts:163-175` → `onGone`.
- AppShell wiring, **verbatim** (`AppShell.tsx:559-563`):
```typescript
      onGone: (hostId, tmuxSession, sessionId) => {
        publishFleetStatusSessionGone(hostId, tmuxSession, sessionId);
        publishFleetStatusWaitingFor(hostId, tmuxSession, null);
        publishFleetStatusTmuxSessionGone(hostId, tmuxSession);
      },
```
All three targets are per-session *state* stores. **Grep-verified: no WS callback anywhere calls `updateFleetSessions` or `removeFleetSession`.** The only `removeFleetSession` caller in the app is the manual Kill handler at `AppShell.tsx:2400`.

**Why rows cannot appear or disappear today:** `computeSnapshot()` iterates `state.fleetSessions` twice — `:695` (role map) and `:734` (the synthetic-row builder) — and `state.fleetSessions` is written by exactly three things: `updateFleetSessions` (`:1110`), the cache seed (`AppShell.tsx:726`), and `removeFleetSession` (`:1163`).

**The precise seam:**

| Direction | Where | What is needed |
|-----------|-------|----------------|
| **Appear** | `AppShell.tsx` `onUpdate` + `onSnapshot` | Upsert a `FleetSession` derived from the frame. Needs: `hostId` (**string on the wire → must `parseInt`**, see Pitfall 5), `hostName` (**not on the wire** — resolve from `hostsFlat`, see Open Question 2), `sessionName` = `state.tmuxSession`, `created`, `role`. |
| **Disappear** | `AppShell.tsx` `onGone` | Add `removeFleetSession(parseInt(hostId,10), tmuxSession)` — **the function already exists** at `conversation-store.ts:1163-1180` with a same-content no-op guard and cache trim. This half is nearly free. |

**Two existing helpers make this tractable:**
- `removeFleetSession` (`:1163`) already: filters by `(hostId, sessionName)`, returns early when nothing changed (`:1168`), and trims the localStorage cache (`:1177`).
- `updateFleetSessions` (`:1110-1147`) already has a shallow-equality guard (`:1117-1128`) so a churn-free re-write does not notify.

**Recommendation (MEDIUM confidence):** add a **narrow `upsertFleetSession(session: FleetSession)`** to `conversation-store.ts`, sibling to `removeFleetSession`, rather than routing the pulse through `updateFleetSessions` (which takes a whole array and unconditionally flips `fleetSessionsLoaded` — `:1129,1143`). Flipping that flag from the pulse is a **D-10-adjacent hazard**: `fleetSessionsLoaded` gates the panel hydrate effect (`PrettyConversationsPanel.tsx:557`) and interacts with the pin-pruner referenced at `:552-556`. Keeping the pulse on a surgical single-row door mirrors what `removeFleetSession` already does and avoids the array-replacement blast radius entirely.

**Ordering constraint that protects the no-flicker bar:** the appearance merge (Pattern 4) must land **before or in the same tick as** the row upsert. If a row is created by the pulse before its appearance reaches `identities-store`, `PrettyConversationRow.tsx:343-350` resolves `identity = null` → `hue = null` → the row paints undressed and dresses a moment later. That is precisely the failure the shape names first (§ "What would make it wrong": *"A row is ever seen in a state it then grows out of"*). Both writes originate in the same `onSnapshot`/`onUpdate` callback body, so the fix is ordering within that body — appearance first, then row — plus React batching. **Call this out as a plan-level task, not an incidental detail.**

---

### Pattern 4: Additive appearance merge that cannot touch `loaded` (D-09 + D-10)

**Answering research question 4 — the highest-risk item.**

**How the bug actually works.** `identities-store` conflates two questions in one datum. The comment block at `:258-273` is the primary source; verbatim excerpt:

> *"With Phase 69's disk-fanout backend, GET /identities?identityHosts={} returns []; that response flips state.loaded=true with byKey=empty, which sabotages TerminalOrIdentitySessionPane's hydration-race guard in tabUtils.tsx (byKey.has(k) || !loaded evaluates to false → Terminal component mounts for identity-shape panes during the ms window before the fleet-status subscription fires refreshIdentities). Terminal boots an xterm + real SSH WS + then unmounts when the discriminator flips, leaking listeners."*

The consumer, **exact source** (`tabUtils.tsx:280-284` — note: the discriminator is at **`:284`**, `useIdentities()` is at `:205`; CONTEXT.md cites `:205` for the discriminator, which is the hook call, not the expression):

```typescript
// Source: src/ui/shell/tabUtils.tsx:283-284
  const isIdentityPane = ...
    (identitiesByKey.has(identityKey) || !identitiesLoaded);
```

Read the boolean truth table:

| `byKey.has(k)` | `loaded` | Result | Consequence |
|---|---|---|---|
| true | true | identity pane | correct |
| true | false | identity pane | correct (pre-load optimism) |
| false | **false** | identity pane | **the safe state** — optimism holds |
| false | **true** | **Terminal** | **the bug** — xterm + SSH WS boot then unmount |

**So the hazard is exactly one transition: `loaded` going true while `byKey` is missing the key.** The guard at `:274-277` prevents this by refusing to fetch (and therefore refusing to set `loaded`) while `identityHosts` is empty.

**How a pulse-fed write could trigger it.** `setIdentities` (`:64-94`) is the only writer, and it **unconditionally sets `loaded: true`** at `:91`. Therefore:

- **Any** pulse path that calls `setIdentities` sets `loaded` — including the existing `patchIdentityFlag` (`:426-448`), which calls `setIdentities(nextList)` at `:447`.
- **The specific catastrophe:** a pulse frame arrives for host 6 / `willow` on a cold reload before `GET /identities` has returned. A naive merge appends a partial `Identity` for `willow` and calls `setIdentities` → `loaded: true`, `byKey` = `{willow}` only. Now **every other identity pane in the tab set** (`tabitha`, `moxie`, …) hits `byKey.has(k)===false && loaded===true` → the false-Terminal branch → N xterms + N real SSH WS connections boot and unmount. The pulse would make the bug **worse** than the original, which affected the window rather than a subset.
- **Second-order:** `setIdentities` also rebuilds `byKey`/`byHostKey` from scratch (`:74-86`). A merge that drops a field silently un-dresses a row on the next tick — the D-09 "answer that knows less blanks out one that knew more" failure.

**Recommended concrete shape (MEDIUM confidence on naming, HIGH on structure):**

Add a **separate merge entry point** in `identities-store.ts` that does not call `setIdentities`:

```typescript
// NEW — src/ui/state/identities-store.ts, sibling to patchIdentityFlag (:426)
//
// D-10: this function MUST NOT write state.loaded. It is called from the
// fleet-status pulse, which is not an authority on whether an identity
// exists — only on what one looks like. `loaded` stays owned by fetchOnce /
// refreshIdentities (GET /identities). See the 2026-09-08 comment block at
// :258-273 and tabUtils.tsx:284.
export function mergeIdentityAppearance(
  hostId: number,
  identityKey: string,
  appearance: Partial<Pick<Identity,
    "displayName" | "title" | "colorHue" | "task" |
    "avatarUrl" | "avatarEtag" | "coordinator" | "role" | "pinned" | "hidden">>,
): void {
  // 1. Locate by (hostId, identityKey) — composite, per quick-260912-0t4.
  // 2. If ABSENT: do nothing, or stage into a side map. Do NOT append a
  //    partial row to state.identities — that is the path that would
  //    poison byKey while loaded is true.
  // 3. If PRESENT: field-wise merge, skipping undefined/null so an answer
  //    that knows less never blanks one that knew more (D-09).
  // 4. Rebuild byKey/byHostKey + notify WITHOUT touching state.loaded.
}
```

**Three structural properties the planner should require of it, each independently testable:**

1. **`loaded` is not in the assignment.** Enforce with a test asserting `loaded === false` after a merge on a cold store, plus a grep-gate in the plan (`mergeIdentityAppearance` body must not contain `loaded`).
2. **Absent-key merges do not create rows.** Property 2 above is what prevents the amplified bug. The pulse arriving before `GET /identities` must be a **no-op or a staged side-write**, never an append.
3. **`undefined`/`null` fields are skipped, not written.** This is D-09 mechanically. `patchIdentityFlag`'s idempotence guard (`:446` `if (!changed) return`) is the right precedent for suppressing no-op notifies.

**Why not reuse `setIdentities` with a flag?** A boolean parameter that sometimes suppresses `loaded` puts the hazard one careless argument away, forever. A separate named door makes the invariant greppable and reviewable — and the shape file's own rule (§ Philosophy, *"One authority per fact, structurally"*) asks for structure, not convention. Note both doors still funnel through the same normalization + notify tail, so D-09's "exactly one place appearance can be written" is satisfied in the sense that matters: one module, one normalization, two call sites with different authority.

**Do NOT reuse `applyIdentityChange` (`:360-407`)** — it takes a whole `Identity` and ends in `setIdentities` (`:406`). Wholesale replacement is exactly what D-09 forbids.

---

### Pattern 5: Never-give-up reconnect with wake-on-visible (D-11..D-13)

**Answering research question 5.**

**Current behaviour, exact:**

| Element | Location | Value |
|---------|----------|-------|
| `MAX_RECONNECT_ATTEMPTS` | `fleet-status-client.ts:35` | `5` |
| `BACKOFF_SCHEDULE_MS` | `:36` | `[2000, 4000, 6000, 8000, 8000]` |
| Give-up gate | `:209-216` | `if (reconnectAttempts >= MAX) { warn(gave_up); return; }` — **bare `return`, no timer scheduled** |
| Cap index | `:219-221` | `Math.min(reconnectAttempts, BACKOFF_SCHEDULE_MS.length - 1)` — already clamps, so a longer ladder needs no index change |
| Full-jitter draw | `:222` | `Math.floor(Math.random() * capMs)` — **preserve verbatim (D-13)** |
| Attempt reset | `:92-93` | `reconnectAttempts = 0` in `ws.onopen` |
| Visibility listener | — | **none in this file** [VERIFIED: grep] |

**(a) Minimal change to never give up.** Replace the early-`return` at `:209-216` with a **terminal steady-state cap**. The clamp at `:219-221` already handles an over-long attempt counter, so the smallest correct change is to make the schedule lookup fall through to a slow constant instead of returning:

```typescript
// Shape only — replaces the :209-216 early return.
const SLOW_RETRY_MS = 30_000;   // D-11 steady state
const capMs = reconnectAttempts < BACKOFF_SCHEDULE_MS.length
  ? BACKOFF_SCHEDULE_MS[reconnectAttempts]
  : SLOW_RETRY_MS;
const delayMs = Math.floor(Math.random() * capMs);   // :222 UNCHANGED (D-13)
```

Log discipline: keep an operation-tagged line on the transition into slow mode (the existing `fleet_status_client_gave_up` string is what dashboards match, and the shape file's *"must fail loudly rather than silently stop"* argues for keeping a signal). Recommend emitting a **new** `fleet_status_client_slow_retry` on the transition and retiring `gave_up` — but note that **two tests assert `gave_up` is logged** (see Test Surface), so whichever way the planner goes must be deliberate.

**(b) Reconnect on visible.** Add a `document.visibilitychange` listener inside `createFleetStatusClient` (so `dispose()` can remove it — the existing disposer at `:243-265` is the natural home). On `visibilityState === "visible"`: if there is no live socket, clear any pending `retryTimer`, reset `reconnectAttempts = 0`, and `connect()` immediately.

**Guard requirements, learned from the in-repo iOS-PWA precedents:**
- **Reset the attempt budget** on visible. `PrettyView.tsx:2919` documents the same idea: *"No further timer scheduled. visibilitychange:visible gives a fresh budget."*
- **Do not reset on `ws.onopen` alone.** `PrettyView.tsx:1633` warns: *"NOT reset on ws.onopen (defeats the cap on rapid cycles)."* (Here `:92-93` already resets on open; the note matters for not adding a *second* reset path that defeats the ladder.)
- **Guard against duplicate connects.** iOS PWA fires `visibilitychange` spuriously — `PrettyView.tsx:2986` notes a guard exists *"to prevent the iOS visibilitychange foreground event from"* double-firing. Check `ws !== null` before connecting.
- **Respect `disposed`.** Every handler in this file early-returns on `disposed`; the new one must too.

**Does anything already listen for visibility? Yes — nine other sites, and none of them conflict.** [VERIFIED: grep across `src/ui`]

| File | Line | Purpose | Conflict? |
|------|------|---------|-----------|
| `PrettyView.tsx` | `2949-2999` | iOS PWA force-reconnect of the **PrettyView** WS | **No** — different socket. **Best pattern to mirror.** |
| `Terminal.tsx` | `385-424` | Terminal WS reopen | No — different socket |
| `GuacamoleDisplay.tsx` | `503-517` | RDP pause/resume | No |
| `console-forwarder.ts` | `209-210` | flush on hidden | No |
| `main-axios.ts` | `374-375`, `498` | flush on hidden | No |
| `ComposeBox.tsx` | `1145-1151` | draft keepalive flush on hidden | No |
| `MessageQueueDrawer.tsx` | `186-192` | queue flush on hidden | No |
| `compose-drafts-api.ts` / `message-queue-api.ts` | `67` / `68` | comments only | No |
| `use-gamepad-tab-nav.ts` | `42` | `!document.hidden` poll gate | No |

All are `document.addEventListener` with paired `removeEventListener` in cleanup. **Six of the nine fire on `hidden`, not `visible`** — so a new `visible` handler is not duplicating existing work. `is-ios-pwa.ts:2` explicitly references *"(PrettyView.tsx) visibilitychange force-reconnect useEffects"* as a known pair, confirming the multi-listener pattern is established and accepted here.

**(c) D-07's re-ask, on the same event.** The `/sessions/list` re-fire (research question 6) should hang off **the same visibility transition**, so the two halves of "coming back shows what's current" cannot diverge. See Pattern 6.

---

### Pattern 6: Amending the TG-17 exactly-once lock (D-07)

**Answering research question 6.**

**The lock, verbatim** (`AppShell.tsx:706-713`):

> *"TG-17 hard shape lock: fleet fetch is EXACTLY ONCE per page-load. No polling, no interval, no focus/visibility refetch, NOT wired to `skynet:hosts-changed`. Cross-device staleness acceptable — user refreshes to update. The empty-dep-array useEffect enforces the lock."*

and at `:793`: `}, []); // EMPTY DEP ARRAY — TG-17 shape lock: exactly once per mount.`

**What the lock was protecting against, read from the code around it:** the effect body does four things beyond the fetch — seeds from `readFleetSessionsCache()` (`:726`), calls `updateFleetSessions(cached)` (`:728`), runs a seed loop over `seedSessionLastMessageAt` + `seedSessionAiTitle` (`:743-746`), and on success calls `writeFleetSessionsCache(fresh)` (`:756`). Re-running the **whole body** would re-seed from a now-stale cache and re-run the seed loops. The `cancelled` flag (`:781-783`) guards unmount, not re-entry. Note also the `catch` branch calls `updateFleetSessions([])` (`:779`) whose only purpose is the `fleetSessionsLoaded` false→true flip (quick-260821-m36) — re-running that on every visibility change would be churn.

**Cleanest amendment (MEDIUM confidence — this is a judgment call the discretion list explicitly hands to the planner):**

**Split the effect into two.** Keep the mount-only effect for the cache seed + first fetch (empty dep array, lock comment amended to say *why* it is still mount-only). Extract the **fetch-and-apply** portion into a stable `useCallback`, and add a **second, small effect** that calls it on `visibilitychange → visible`. This gives D-07 "same path both times — one path to build, one path to get right" literally: one function, two triggers.

Requirements for the re-ask path:
- **Skip the cache seed.** The seed exists for cold paint; on a re-ask the store is already populated and re-seeding from `localStorage` would push *older* data into the working store.
- **Keep `writeFleetSessionsCache(fresh)`.** Refreshing the cache on a successful re-ask is strictly good.
- **Do NOT call `updateFleetSessions([])` on failure in the re-ask path.** That branch (`:779`) exists solely to flip `fleetSessionsLoaded` on cold-start failure. On a re-ask the flag is already true and an empty array would wipe every row on a transient network blip — a direct hit on the shape's *"A failed record read removes a conversation"* failure. **This is a real trap: the naive "extract the whole body and call it twice" refactor introduces it.**
- **Coalesce.** An in-flight guard (a ref) so rapid hidden/visible cycling on mobile does not stack fetches. Precedent: `identities-store.ts:239,244-247` `refreshInflight`.
- **Amend the comment, do not delete it.** D-07 says so, and the lock's *reasoning* (no polling, no interval, not wired to `hosts-changed`) survives intact — only "no focus/visibility refetch" is repealed.

---

### Anti-Patterns to Avoid

- **Bumping `SWEEP_SCHEMA_VERSION` for additive fields.** Drops every not-yet-updated box onto the legacy exec fan-out for its whole SSH-channel lifetime. See Pitfall 1.
- **Bumping `FRAME_SCHEMA_VERSION`.** Breaks the seven-precedent convention and would invalidate `z.literal(FRAME_SCHEMA_VERSION)` on every frame schema (`wire-protocol.ts:398,404,410,429,435,450,456,462,470`) simultaneously — a fleet-wide frame rejection, not a graceful degradation.
- **Adding appearance to `SessionState` without adding it to BOTH fingerprints.** Silently swallows changes. Pitfall 2.
- **Calling `setIdentities` from the pulse.** Sets `loaded`. Pattern 4 / Pitfall 4.
- **Routing pulse row-appearance through `updateFleetSessions(wholeArray)`.** Flips `fleetSessionsLoaded` and replaces the array. Pattern 3.
- **`import yaml` in the sweep script.** Silent fleet-wide fallback to legacy on any box without PyYAML. Standard Stack § On PyYAML.
- **Reading role files per-identity without a memo.** 73 identities sharing ~10 roles = 73 reads of files up to 44,642 bytes (measured: `~/fleet/roles/box-maintainer/box-maintainer.md`) = ~3.2MB of pointless I/O per tick. The memo is a Discretion item but it is not optional.
- **Unbounded `_read_text_file` on role files.** `fleet-status-sweep.py:598-605` reads whole files. Frontmatter is the first ~5 lines; cap the read.
- **Letting a failed appearance read drop a row.** Shape § *"A failed record read removes a conversation"* is a named failure. Fail-closed to safe-default appearance, never to absence.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Frontmatter parse in Python | A new YAML parser, or `import yaml` | Extend `_read_frontmatter` at `ambient-monitor.py:240-283` | Already BOM-safe (`utf-8-sig`), comment-skipping, quote-stripping, `OSError`-safe, and stdlib-only. |
| Frontmatter parse in TS | Anything | `extractCosmeticsFromFrontmatter` (`identity-artifact-reader.ts:2356`) | Already narrows `colorHue` to `0..359` (`:2411-2418`), logs YAML failures loudly (`:2380-2387`), returns `{}` fail-open. |
| Identity-over-role merge | A new merge | `publicIdentity()` (`identities.ts:160-277`), merge at `:209-227` | Canonical. Divergence = "a second authority by the back door" (CONTEXT.md § Reusable Assets). |
| Read-role-once memo | A new cache abstraction | Phase 85 `roleReadCache` (`identities.ts:382-407`) as the *semantic* reference | Stores the in-flight promise, not the value, to collapse parallel reads. Python equivalent is a plain dict (sweep is synchronous) — Discretion item confirms. |
| Sentinel presence read | A new primitive | `os.path.exists` in the sweep (mirroring `:800-804`); `identityFileExists` on the TS side | Three sentinels already read this exact way on the same `scandir` entry. |
| Row removal from the list | New pruning logic | `removeFleetSession` (`conversation-store.ts:1163-1180`) | Already filters by `(hostId, sessionName)`, no-ops when unchanged, trims the cache. |
| Reconnect backoff + jitter | A new ladder | The existing `:218-236` block; change only the terminal condition | Full-jitter draw at `:222` is locked by D-13 and by tests 9a/9b/9c. |
| Optional-field wire tolerance | Per-field validation in `parseSweepJsonl` | Nothing — it already tolerates | The parser deliberately does **not** deep-validate: *"the parser's job is 'shape it enough for the caller'"* (`sweep-schema.ts:153-157`). Missing appearance fields arrive as `undefined`. |
| JSONL emit formatting | A new serializer | `_emit` (`fleet-status-sweep.py:838-841`) | Compact separators, one line, `\n`-terminated. |

**Key insight:** every one of the four widenings has a same-shaped predecessor in this repo, usually with a comment block explaining the trap it was written to avoid. The failure mode for this phase is not inventing a bad mechanism — it is **partially applying a good one** (widening the schema but not the fingerprint; adding a merge door but letting it set `loaded`; extracting the fetch but carrying the `updateFleetSessions([])` catch-branch along).

---

## Common Pitfalls

### Pitfall 1: Bumping `SWEEP_SCHEMA_VERSION` drops hosts onto the legacy exec fan-out — and the mismatch runs the opposite direction from D-04's assumption

**⚠️ This is the one place where research contradicts a locked decision's *mechanism* (not its *goal*). Flagging once, with evidence, per the standing instruction.**

**What goes wrong.** D-04 instructs: *"Bump `SCHEMA_VERSION` in the sweep + `sweep-schema.ts` accordingly."* Doing so produces this chain:

1. `parseSweepJsonl` compares **every line** against the constant and flips `schemaMismatch` on any difference (`sweep-schema.ts:236-240`) — the version check is *equality*, not *greater-or-equal*.
2. `pollOneHostBatch` returns `{ ok: false, reason: "schema-mismatch" }` (`ssh-poll-orchestrator.ts:1490-1503`).
3. `pollOneHost` **latches** it: `hostState.sweepSchemaMismatchThisConnection = true` (`:1315-1317`), and the dispatch gate at `:1272-1275` then requires `!sweepSchemaMismatchThisConnection`.
4. The latch is only cleared when the SSH **channel object identity** changes (`:1236-1240`) — i.e. on reconnect / container restart. The code says so: *"a schema-version bump is a container-restart-scope event"* (`:1443` region, `:439-443`).
5. So that host runs `pollOneHostLegacy` (`:1376`) **every tick** — the ~75-90-exec-per-cycle fan-out (`92-CONTEXT.md:12-14`) that saturated `sshd MaxSessions=10` and broke Tabitha's file share.

**Why the direction is inverted from D-04's expectation.** D-04 reasons about *an old server meeting a new script*. The actual deploy order is the reverse:

- The sweep script is distributed **from the container** — `catalog.ts:259-261` maps `/app/fleet-substrate/scripts/fleet-status-sweep.py` → `~/.local/bin/fleet-status-sweep`, pushed by the substrate orchestrator started at container boot (`starter.ts:874-890`), fire-and-forget (`:863-865`: *"start() is called fire-and-forget (.catch(), NOT await) so the boot IIFE does NOT block on network I/O"*).
- Therefore at deploy: **new server + new constant (2) meets old scripts still emitting 1** on every peer box until each is swept. `parsed.schemaMismatch` fires, latches, and **every peer box runs legacy** until its push lands and its SSH channel recycles.
- The degradation is not "agents arrive undressed" (D-04's stated worst case). It is "the Phase 92 fix is disabled fleet-wide for an indeterminate window." That is *"newly broken,"* which D-04 explicitly rules out.

**How to avoid — and this fully satisfies D-04's intent.** Add the appearance fields as **optional fields at `SWEEP_SCHEMA_VERSION` 1**. This works because the parser was deliberately built to allow it:

> *"The parser is deliberately LENIENT (never throws)"* — `sweep-schema.ts:20-23`
> *"Deliberately does NOT deep-validate every field — the parser's job is 'shape it enough for the caller'"* — `sweep-schema.ts:153-157`

`isSweepLineOfCurrentSchema` checks **only** `schema_version` and `line_kind` (`:158-163`). The bucket push is a bare cast: `identityLines.push(parsed as SweepIdentityLine)` (`:243`). So an old box's line simply arrives with the appearance keys **absent → `undefined`**, and the adapter's `?? null` coalescing yields safe-default appearance. **That is precisely D-04's desired outcome — "its agents arrive UNDRESSED until the distributor catches up" — reached without ever touching the legacy path.**

Make the TS field types `?:` optional to encode this at the type level, mirroring how `FleetSession` handles the same problem (`conversation-store.ts:182-197`: *"Optional so pre-Phase-44 backend responses ... deserialize into a FleetSession object that simply omits the field"*).

**Warning signs.** `operation: "fleet_status_sweep_schema_mismatch"` in container logs; `operation: "fleet_status_poll_end"` with `path: "legacy"` after deploy; a return of `Channel open failure` spam (the Phase 92 verification criterion, `92-CONTEXT.md:45`).

**If the planner still wants a version bump**, the only safe form is a **parser change first**: accept `schema_version <= SWEEP_SCHEMA_VERSION` instead of `===`. That is a real change to a locked contract with its own test surface (`sweep-schema.test.ts:151-169` asserts the equality behaviour directly) and should be its own task with explicit user sign-off — not a side effect of this phase.

---

### Pitfall 2: Fingerprint suppression silently swallows appearance-only changes — and there are TWO separate fingerprints

**What goes wrong.** Both compose helpers publish only on fingerprint delta. Add `colorHue` to `SessionState` but not to the fingerprints, and a colour change on disk is read by the sweep, carried on the wire, assembled into a frame — **and then not sent**, because nothing else about the session changed. The list stays wrong while looking settled, which the shape names as a failure (§ *"The list goes quietly stale"*).

**Source A** (`composeAndPublishPerPid`, gate at `:2493-2495`):
```typescript
const newFingerprint = computeFingerprint(state);
const lastFingerprint = livenessMap.get(pid)?.lastPublishedFingerprint;
if (newFingerprint !== lastFingerprint) { deps.registry.publishSessionState(...) }
```
`computeFingerprint` (`:937-984`) is a 12-segment template literal ending at `:983`.

**Source B** (`composeAndPublishPerIdentity`) uses a **completely different, 2-segment** fingerprint (`:1923`):
```typescript
const fingerprint = `${isDormant ? "1" : "0"}|${isRecycling ? "1" : "0"}`;
```
with its own suppression at `:1925-1937`.

**Why it is easy to miss:** they live 500 lines apart, source B's is an inline local rather than a named helper, and source B is where identity-keyed data (i.e. appearance) most naturally arrives. **A plan that only updates `computeFingerprint` will make appearance work for identities with a live PID and silently fail for dormant ones** — a machine-dependent, subset-dependent flicker, exactly the *"hardest kind of wrongness to ever track down"* the shape warns about.

**A third trap inside source B.** Its published frame is **hardcoded** at `:1897-1911` and `:1954-1968` — `sessionId: "__dormant__"`, `aiTitle: null`, `lastMessageAt: null`. There are **two** construction sites (the pre-evict transition frame and the normal frame). Appearance must be added to **both**, or the recycling-transition frame blanks appearance and D-09's "undress itself on a later tick" happens on that one edge.

**A fourth trap.** Source B's cache `IdentityRecycleCacheEntry` does not carry appearance. The lockstep discipline is documented at `:2528-2530`: *"every axis MUST be stamped on both branches so the cache stays lockstep with derivation."* Both the publish branch (`:1944-1951`) and the suppress branch (`:1929-1936`) write the cache; appearance must be stamped in both or the fingerprint compares against a stale value.

**How to avoid.** Extend the fingerprint at **both** sites; append new segments at the **END** of the template literal — the file states this rule twice (`:970-972`, `:988-990`): *"Fingerprint segments MUST live at the END of the template literal so any future axis is appended after these two without disturbing the delta contract."* Follow the `?? ""` / `"1"/"0"/""` tri-valued normalization already used so a first-time-null publish stays distinguishable from a cold cache.

**Warning signs.** Colour/title changes on disk that appear only after a page reload; appearance updating for busy agents but not dormant ones.

---

### Pitfall 3: Three hand-maintained copies of `SessionState` must move together

**What goes wrong.** The backend zod schema is **not** the only definition. `src/ui/api/fleet-status-types.ts` is a deliberate duplicate:

> *"These types are intentionally DUPLICATED from src/backend/fleet-status/wire-protocol.ts rather than imported from it... CONSTRAINT: Field names and discriminants must match wire-protocol.ts EXACTLY. Any change to the backend wire-protocol MUST be mirrored here."* — `fleet-status-types.ts:1-16`

Because the browser does **no** runtime validation (`:14-16`), a missed mirror is not a caught error — it is `undefined` at runtime with a green typecheck on the backend.

| # | File | Definition | Notes |
|---|------|-----------|-------|
| 1 | `src/backend/fleet-status/wire-protocol.ts:355-389` | `SessionStateSchema` (zod) | Source of truth |
| 2 | `src/ui/api/fleet-status-types.ts:88+` | `interface SessionState` | Hand-mirrored. `hostId: string` at `:89` |
| 3 | `src/backend/fleet-status/sweep-schema.ts:79-88` | `SweepIdentityLine` | The host→server hop |

Plus the **Python** side (`fleet-status-sweep.py:675-684`) as a fourth, cross-language copy — its docblock at `:16-19` says: *"Field names + types below must be BYTE-IDENTICAL to the TypeScript."*

**And a fifth, if appearance reaches rows via `FleetSession`:** `conversation-store.ts:172-220` re-declares the session shape *again*, deliberately (`:165-170`: *"Re-declared here (not imported from `@/api/sessions-api`) so the UI-state layer does NOT depend on the API layer"*). If Plan 3 carries appearance onto rows, this is a sixth site — plus `isFleetSession` (`:1230`) and the **cache version key** (see Pitfall 6).

**How to avoid.** Make "update all N mirrors" an explicit enumerated task with the file list, not an implied consequence. Every prior phase that widened this wire touched at least sites 1 and 2 together — the comment lineage in both files is the evidence.

---

### Pitfall 4: `setIdentities` unconditionally sets `loaded: true` — the D-10 trap is one function call deep

**What goes wrong.** Covered mechanically in Pattern 4; restated here as a pitfall because of how *short* the path to it is. `setIdentities` (`identities-store.ts:64-94`) ends with:

```typescript
  state = { identities: normalized, byKey, byHostKey, loaded: true };
  notify();
```

There is no branch. **Every** existing writer goes through it: `fetchOnce` (`:288`), `refreshIdentities` (`:346`), `applyIdentityChange` (`:406`), `patchIdentityFlag` (`:447`). So "just reuse the existing door" — the most natural reading of D-09 — is simultaneously a **violation of D-10**.

The amplified failure mode (a pulse frame for one identity arriving before `GET /identities`, causing `loaded: true` with a one-entry `byKey`, which sends *every other* identity pane down the false-Terminal branch at `tabUtils.tsx:284`) is worse than the original bug, which affected only a millisecond window.

**How to avoid.** Pattern 4's separate `mergeIdentityAppearance` door with three grep-checkable invariants: no `loaded` in the body; absent keys do not append; `undefined`/`null` skipped.

**Warning signs.** Terminal flash on reload; `xterm` mounting for identity panes; listener-leak warnings; bounty `terminal-first-flash-on-reload-plus-listener-leak` reopening.

---

### Pitfall 5: `hostId` is a string on the wire and a number in the row/store space

**What goes wrong.** Every join between the pulse and the row/appearance space needs a coercion, and getting it wrong produces a **silent lookup miss** — appearance that never lands, or a duplicate row.

| Space | Type | Evidence |
|-------|------|----------|
| `SessionState.hostId` (both ends) | **`string`** | `wire-protocol.ts:356` `hostId: z.string()`; `fleet-status-types.ts:89` |
| Orchestrator `host.id` | `string` | passed straight through at `ssh-poll-orchestrator.ts:1891,1953,2472` |
| `FleetSession.hostId` | **`number`** | `conversation-store.ts:173` |
| `Identity.hostId` | **`number`** | `identities-api.ts:11`; store guards with `typeof i.hostId === "number" && Number.isFinite(...)` (`identities-store.ts:83`) |
| `Host.id` (UI type) | `string` | `PrettyConversationRow.tsx:341` does `parseInt(row.host.id, 10)` |
| `byHostKey` key | `` `${hostId}::${nameLc}` `` from a **number** | `identities-store.ts:84` |

**The concrete trap:** `` `${"6"}::willow` `` and `` `${6}::willow` `` both stringify to `"6::willow"`, so a naive template-literal join **appears to work** — until a `Number.isFinite` guard (`identities-store.ts:83`) or a `typeof hostId !== "number"` filter (`deriveDiskPinnedIds` `:173`, `deriveDiskHiddenIds` `:217`) rejects the string and the entry is silently dropped. The derive functions `continue` on non-number, so a string hostId means **pinned/hidden state silently never hydrates**.

**How to avoid.** Coerce **once**, at the AppShell callback boundary, with a finiteness guard — mirroring `AppShell.tsx:2400` (`parseInt(row.host.id, 10)`) and `PrettyConversationRow.tsx:341-346`. Do not thread strings inward.

---

### Pitfall 6: The `FleetSession` localStorage cache is versioned and its writer whitelists fields

**What goes wrong.** Two independent traps in the cache layer if appearance touches `FleetSession`:

1. **The version key must be bumped.** `conversation-store.ts:1191-1220` documents a v1→v2→v3→v4 lineage, each bump tied to a field addition. Not bumping means a stale-shape rehydrate seeds objects lacking the new fields. Bumping forces *"one clean cold-start after deploy"* (`:1220-1224`).
2. **`writeFleetSessionsCache` serializes a whitelist.** `:1379-1381`: *"Serializes only the 4 canonical `FleetSession` fields so future field additions on FleetSession don't silently leak to storage."* So a new field is **silently not persisted** unless the writer is also updated — appearance would survive the tab but not a refresh, making the cold-paint undressed window *return* for exactly the case the cache exists to fix.
3. **`isFleetSession` (`:1230`)** validates rehydrated entries; entries failing it are dropped (`:1333-1336`).

**How to avoid.** If appearance rides `FleetSession`: bump the key, extend the writer whitelist, extend `isFleetSession`, all in one task. **Or** keep appearance strictly in `identities-store` and let the pulse re-dress on connect (the server answers from its Map instantly per `subscription-registry.ts:146-151`, which is what makes browser-side appearance caching *"largely unnecessary"* per the shape file § Prior context). **The second option is simpler and the shape explicitly prefers it.** Recommend it.

---

### Pitfall 7: One slow or unreadable role file must not delay or undress a whole host

**What goes wrong.** The sweep is **synchronous** (single-threaded Python, no `asyncio`). A role file on a slow/NFS-ish mount, or a 44KB role read done per-identity without a memo, adds latency to the whole host's sweep — which is bounded at `SWEEP_EXEC_TIMEOUT_MS = 8000` (`ssh-poll-orchestrator.ts:1206`). Exceeding it → `null-exec` → `sweepScriptPresent = null` → re-probe → **legacy path this tick** (`:1310-1312`).

**Compounding:** the sweep already spends 600-750ms/host/tick (D-02), and `_read_text_file` (`fleet-status-sweep.py:598-605`) reads **whole files** with no cap.

**How to avoid.**
- **Memoize role reads per tick** (Discretion item; treat as mandatory). Dict in `main` beside `identity_jsonl_paths = {}` (`:883`).
- **Cap the read.** Frontmatter ends within the first few lines; the file already has a bounded-read precedent — `DISCOVERY_HEAD_BYTES = 4096` (`:130`) with `fh.read(DISCOVERY_HEAD_BYTES)` at `:267`. Reuse that shape rather than reading 44KB for 4 lines.
- **Fail-closed per identity, never per host.** Wrap each appearance read in its own `try/except OSError` returning safe defaults — mirroring `_mtime_ms` (`:589-595`) and `_read_tail_bytes` (`:476-491`), both of which swallow `OSError` and return `None`. A single unreadable file must yield one plain row, not a missing row and not a dead host.
- **Log to stderr only.** `_log` (`:156-169`) exists for this. **stdout is the JSONL wire** — the docblock at `:33-43` is emphatic: *"ANY unhandled exception at the top level logs to stderr and returns exit 0 with empty stdout... Never emit tracebacks or error strings on stdout."*

---

### Pitfall 8: Relay-room rows must not regress

**What goes wrong.** Relay-room sessions have a **completely different shape** — no `hostId`, no `sessionName`, no `role`. The row-builder branches on `session.kind === "relay-room"` **first** and `continue`s (`conversation-store.ts:711-733`), with a comment recording the exact prior bug: *"Passing them through the harness synthetic-row loop below produces a malformed row (host:undefined, id='fleet::undefined::undefined') that never surfaces in the sidebar."*

Any new row-upsert path (Pattern 3) that assumes `sessionName` is a non-empty string will **crash or produce a phantom row**. `sessionMatchKey` returns `null` for empty/undefined (`session-hue.ts:4-10`), which is what filters relay rooms out of `buildIdentityHostsFromFleet` (`identities-store.ts:117-118`) — and `identities-store.ts:130-138` records the H2 lock forbidding naive `.toLowerCase()` iteration for exactly this reason.

Relay rows are appended server-side by `mergeRelayRoomsIntoFlat` (`sessions.ts:606`) after the harness partition — an **append-only** block (`:583-585`: *"D-01 scope anchor: the harness-derivation path above is byte-identical; this block is APPEND-ONLY"*). They arrive **only** via `/sessions/list`, never via the pulse.

**How to avoid.** Pulse-driven upsert must produce only harness-shaped sessions and must never remove a relay row. Since `removeFleetSession` filters on `(hostId, sessionName)` (`:1164-1167`) and relay rows have neither, they are structurally safe from removal — but a `gone` frame with `tmuxSession: null` (legal per `wire-protocol.ts:466`) needs an explicit guard so it does not match anything unintended.

---

### Pitfall 9: The per-host SSH channel semaphore (cap 8 against `MaxSessions=10`)

**What goes wrong.** `getHostSemaphore(hostId)` (`identities.ts:366`, from `ssh/host-semaphore-registry.js`) is now **shared** between fleet-status and substrate producers on the same hostId (`starter.ts:~903`: *"fleet-status + substrate producers running on the same hostId now share ONE 8-slot pool. Wilma-incident MaxSessions=10 citation: cap at 8 leaves 2 channels of headroom"*).

The cap is **per-channel, not per-identity** — `identities.ts:344-352` spells out why: *"the fanout opens 3 channels per identity (identity file + `.pinned` + `.hidden`), so an 8-slot cap applied per identity would still permit 24 concurrent channels and blow the ceiling."*

**Good news for this phase:** the sweep path uses **one** `channel.exec` per host per tick (`ssh-poll-orchestrator.ts:1459`) and appearance adds **zero** new channels — that is the whole point of D-01. **The risk is only in the failure direction:** anything that pushes a host onto the legacy path (Pitfalls 1, 7) restores the ~75-90-exec fan-out and re-creates the saturation. The semaphore is the symptom-catcher, not the fix (`92-CONTEXT.md:14`).

**How to avoid.** Do not add SSH channels. Prefer degradations that keep the batch path alive over any that fall back to legacy.

---

### Pitfall 10: In-memory SQLite `forceSave`

**No DB writes are expected in this phase** — appearance is disk-authoritative on managed hosts, sentinels are files, and the wire is in-memory. But the standing rule holds: any `db.insert/update/delete().run()` MUST be followed by `await DatabaseSaveTrigger.forceSave("<reason>")` in try/catch (CONTEXT.md § Standing constraints; Phase 107 precedent used the tag `phase-107-hidden-sentinel-migration`). If a plan adds a write, tag it `phase-111-*`.

---

## Code Examples

### Additive-optional wire field (the exact convention to copy)
```typescript
// Source: src/backend/fleet-status/wire-protocol.ts:379-388
  // Phase 62 Plan 03 — mtime of the per-session activity marker (see block comment above).
  activityMtime: z.number().nullable().optional(),
  // Phase 62 Plan 03 — mtime of the per-session stopped marker (see block comment above).
  stoppedMtime: z.number().nullable().optional(),
  // Phase 90 Plan 00 (Wave 0, D-10 delivery mechanism) — per-session context %
  // fill (0-100, integer). Populated by subscription-registry.publishSessionState
  // + getSnapshot at frame-publish time from the contextpct-store shared map...
  contextPct: z.number().nullable().optional(),
```

### Per-tick sentinel stat on an already-open scandir entry (extend this)
```python
# Source: substrate/scripts/fleet-status-sweep.py:796-810
                name = entry.name
                if not SAFE_NAME_RE.match(name):
                    _log("identity_name_skipped", name=name[:40])
                    continue
                dormant = os.path.exists(os.path.join(entry.path, ".dormant"))
                recycled_at = os.path.exists(os.path.join(entry.path, ".recycled-at"))
                recycle_requested = os.path.exists(
                    os.path.join(entry.path, ".recycle-requested"),
                )
                out.append({
                    "name": name,
                    "dormant": dormant,
                    "recycled_at": recycled_at,
                    "recycle_requested": recycle_requested,
                })
```

### Frontmatter fence-scan, stdlib only (extend this, not role-file-watch's)
```python
# Source: substrate/scripts/ambient-monitor.py:255-282 (abridged)
    try:
        with open(identity_file, encoding="utf-8-sig") as f:
            lines = f.readlines()
    except OSError:
        return None, False
    fences = [i for i, ln in enumerate(lines) if ln.strip() == "---"]
    if len(fences) < 2:
        return None, False
    for line in lines[fences[0] + 1: fences[1]]:
        stripped = line.lstrip()
        if stripped.startswith("#"):
            continue
        m_role = re.match(r"^role:\s*(.+?)\s*(#.*)?$", line.rstrip("\n"))
        if m_role and role is None:
            raw = m_role.group(1).strip().strip('"').strip("'").strip()
            if _ROLE_NAME_OK.match(raw):
                role = raw
            continue
```

### Bounded head-read (reuse this for role files)
```python
# Source: substrate/scripts/fleet-status-sweep.py:129-130, 266-267
DISCOVERY_HEAD_BYTES = 4096
...
                with open(fpath, "rb") as fh:
                    head = fh.read(DISCOVERY_HEAD_BYTES)
```

### Identity-over-role merge (canonical — do not re-derive)
```typescript
// Source: src/backend/database/routes/identities.ts:209-227
  const mergedTitle =
    typeof cosmetics.title === "string"
      ? cosmetics.title
      : typeof roleCosmetics?.title === "string"
        ? roleCosmetics.title
        : null;
  const mergedColorHue =
    typeof cosmetics.colorHue === "number"
      ? cosmetics.colorHue
      : typeof roleCosmetics?.colorHue === "number"
        ? roleCosmetics.colorHue
        : null;
```
Note `task` is deliberately **NOT** merged with role (`identities.ts:240-243`: *"task is per-identity (D-05 write-once at birth)"*), and `displayName` falls back to `capitalizeFirst(identityKey)` (`:232-235`), not to the role. Copying "merge everything" would diverge from the canonical shape.

### Fail-closed sentinel probe (the discipline appearance must inherit)
```typescript
// Source: src/backend/database/routes/identities.ts:427-433
                  const hiddenPromise = withSlot(() =>
                    identityFileExists(identityKey, ".hidden", { hostId, conn }),
                  ).catch(() => false); // fail-closed per D-01 (HID-107-03)
```

### Idempotent single-field store patch (precedent for the merge door)
```typescript
// Source: src/ui/state/identities-store.ts:432-447
  const keyLc = identityKey.toLowerCase();
  let changed = false;
  const nextList = state.identities.map((i) => { /* ...match, compare... */ });
  if (!changed) return;         // ← no-op suppression to copy
  setIdentities(nextList);      // ← ⚠️ but this sets loaded:true — do NOT copy this line
```

### Surgical single-row removal (already exists; wire `onGone` to it)
```typescript
// Source: src/ui/state/conversation-store.ts:1163-1177
export function removeFleetSession(hostId: number, sessionName: string): void {
  const nextFleetSessions = state.fleetSessions.filter(/* ... */);
  if (nextFleetSessions.length === state.fleetSessions.length) return;
  state = { ...state, fleetSessions: nextFleetSessions };
  ...
    writeFleetSessionsCache(nextFleetSessions);
```

---

## Test Surface

**Answering research question 7.** Executor runs **scoped** tests only: `npx vitest related --run <files>`. Full suite + playwright is a deploy-time orchestrator gate, never executor scope (CONTEXT.md § Standing constraints). Line counts measured this session.

### Load-bearing (a change here WILL break these — plan for it)

| # | File | Lines | Why it breaks / what to update |
|---|------|-------|-------------------------------|
| 1 | `src/ui/api/fleet-status-client.test.ts` | 830 | **TWO tests lock give-up, not one.** Test 5 `:199-262` (*"fires reconnects at 2000, 4000, 6000, 8000, 8000 ms; then logs gave_up"*) asserts at `:241-244` that after the 6th close `instances.length` stays 6 — i.e. **no further reconnect ever**. Test 9's fourth case `:647-682` (*"attempt cap behavior unchanged..."*) is stricter: `expect(setTimeoutSpy).not.toHaveBeenCalled()`. **Both must be updated deliberately, not deleted (D-11).** Test 9's jitter cases `:545-646` must stay green untouched (D-13). |
| 2 | `src/backend/fleet-status/sweep-schema.test.ts` | 369 | `SWEEP_FIELD_PARITY` walk `:264-292` asserts an **exact 19-key set** (`A0..A12`, `B0..B5`). New appearance reads are new exec-sites conceptually → either extend `EXPECTED_KEYS` + the parity map, or document why appearance is outside the A/B inventory. `:299-345` asserts every declared `field` exists as a real key on the line types (typo protection) — new fields must be added to the known-fields list. `:73-80` asserts `SWEEP_SCHEMA_VERSION === 1` — **stays green under the recommended no-bump approach; breaks if bumped.** `:151-169` locks the equality-based mismatch behaviour. |
| 3 | `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` | **8,072** | The parity oracle. Its own docblock discipline (`ssh-poll-orchestrator.ts:2534-2537`) names the existing suite as the guarantee that batch and legacy publish identically. Fingerprint changes (Pitfall 2) and adapter changes land here. **By far the largest file in the phase — a plan touching both fingerprints should budget for it explicitly.** |
| 4 | `src/ui/state/identities-store.enrichment.test.ts` | 564 | Home for the new `mergeIdentityAppearance` tests. Must add: `loaded` stays `false` after a cold merge (D-10); absent-key merge does not append; `undefined`/`null` skipped (D-09); `byHostKey` composite keying preserved. `__resetIdentitiesStoreForTest` (`identities-store.ts:483-493`) is the isolation helper — **note it resets `hasRefreshedAfterFleetLoad` but NOT `hasSubscribedToFleet`** (`:491`), a real cross-test leak to be aware of. |
| 5 | `src/backend/fleet-status/wire-protocol.test.ts` | 609 | Schema-shape assertions for the widened `SessionStateSchema`; likely asserts `FRAME_SCHEMA_VERSION`. |
| 6 | `src/ui/state/conversation-store.test.ts` | **3,962** | Row construction, pin/hide, cache. Any `upsertFleetSession` + `onGone`-driven removal lands here. Relay-row regression coverage (Pitfall 8) lives in this space. |

### Secondary (likely touched)

| File | Lines | Why |
|------|-------|-----|
| `src/backend/fleet-status/subscription-registry.test.ts` | 393 | Snapshot/update/gone frame contents if appearance is re-stamped at publish time (the `contextPct` precedent at `:146-151,213-216,244-247` re-stamps on all three read paths). |
| `src/ui/AppShell.persistence.test.tsx` | 548 | The one-shot fetch effect + cache seed + the quick-260821-m36 flag-flip-on-failure assertion (`conversation-store.ts:229-232` exposes `fleetSessions`/`fleetSessionsLoaded` for **exactly this test**). D-07's split touches it. |
| `src/ui/state/conversation-store.cache.test.ts` | — | Only if `FleetSession` gains fields (Pitfall 6). |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` | **4,906** | The both-loaded hydrate gate (`:557-604`). Only touched if the hydrate path changes — **prefer not to touch it**; it is the largest UI test file and the gate is freshly-fixed (quick-260912-5q2). |
| `src/backend/distributor/catalog.test.ts` | — | Only if the catalog row changes (it should not — same slug, same paths). |
| `src/backend/database/routes/sessions.test.ts` | — | Only if `/sessions/list` changes. Under D-05 it should stay **unchanged**. |
| `src/backend/database/routes/identities.get-disk.test.ts` | 979 | Only if `publicIdentity` changes. Under D-05 `GET /identities` stays unchanged — **expect no diff here.** |

### Notably absent: no Python test harness for the sweep

`substrate/scripts/tests/` contains only `README.md` + `agent-supervisor-archive-scan.sh`, and the README declares the convention as **bash-native, no BATS, no vitest coupling**, listing exactly one driver (Phase 94's archive-scan). **There is no existing test for `fleet-status-sweep.py`.** [VERIFIED: `ls substrate/scripts/tests/`]

Phase 92 covered the script indirectly — via `sweep-schema.test.ts` fixtures asserting the parsed shape, and the docblock's ported-function parity notes (`fleet-status-sweep.py:69-79`). Options for the planner:

1. **Follow precedent:** fixture-based coverage in `sweep-schema.test.ts` (a hand-written JSONL blob including appearance fields) + a shape-parity assertion. Lowest friction, matches Phase 92.
2. **Add a bash driver** under `substrate/scripts/tests/` per the README convention (scratch fixture identity folders, run the script, assert on JSONL stdout). Higher value for the frontmatter parser specifically — partial-match and malformed-YAML cases are where a hand-rolled parser fails.

Recommend **1 as mandatory, 2 as a judgment call** — but note that the frontmatter parser is new hand-rolled string code, which is the one genuinely-new logic in the sweep, and option 1 cannot exercise it at all (it tests the *parser on the TS side*, not the *emitter on the Python side*).

### Per-plan scoped-test command sketch

```bash
# Plan 1 (sweep + schema)
npx vitest related --run src/backend/fleet-status/sweep-schema.test.ts
bash substrate/scripts/tests/<new-driver>.sh          # if option 2 chosen

# Plan 2 (wire + fingerprints)
npx vitest related --run src/backend/fleet-status/wire-protocol.test.ts \
  src/backend/fleet-status/ssh-poll-orchestrator.test.ts \
  src/backend/fleet-status/subscription-registry.test.ts

# Plan 3 (row appear/disappear)
npx vitest related --run src/ui/state/conversation-store.test.ts \
  src/ui/AppShell.persistence.test.tsx

# Plan 4 (appearance merge door)
npx vitest related --run src/ui/state/identities-store.enrichment.test.ts

# Plan 5 (reconnect + visibility)
npx vitest related --run src/ui/api/fleet-status-client.test.ts
```

---

## Risks / Landmines

**Answering research question 8.**

| # | Landmine | Severity | Mitigation |
|---|----------|----------|-----------|
| 1 | `SWEEP_SCHEMA_VERSION` bump latches hosts onto the legacy exec fan-out (Pitfall 1) | **HIGH** — reintroduces the Phase 92 disease fleet-wide | Add optional fields at v1. Do not bump. |
| 2 | Two separate fingerprints; appearance-only changes suppressed (Pitfall 2) | **HIGH** — silent staleness, subset-dependent | Extend both; append segments at END; stamp cache on both branches. |
| 3 | `setIdentities` sets `loaded` → amplified terminal-flash/listener-leak (Pitfall 4, D-10) | **HIGH** — real prior bug, made worse | Separate merge door with 3 grep-checkable invariants. |
| 4 | Row-appear without appearance-first ordering → the flicker the phase exists to end | **HIGH** — a "correction-flicker is a failure of this phase even when the final state is right" | Order writes within the same callback body; make it an explicit task. |
| 5 | Three (up to six) hand-maintained type mirrors; browser does no validation (Pitfall 3) | MEDIUM | Enumerate every mirror as a task checklist. |
| 6 | `hostId` string↔number; template-literal joins mask the bug (Pitfall 5) | MEDIUM | Coerce once at the AppShell boundary with a finiteness guard. |
| 7 | Per-host SSH channel semaphore, cap 8 vs `MaxSessions=10`, **shared** with substrate producers (Pitfall 9) | MEDIUM | Appearance adds zero channels. Risk is only via fallback-to-legacy — so prefer degradations that keep the batch path. |
| 8 | Cross-host identity name collisions; composite `${hostId}::${key}` keying (quick-260912-0t4) | MEDIUM | Every new appearance path keys composite. `byKey` is bare-name and **collides by design** (`identities-store.ts:66-73`: *"last wire-order wins... fine because those consumers only ask `.has(name)`"*). Never use `byKey` for appearance. |
| 9 | Relay-room rows have no `hostId`/`sessionName`/`role` (Pitfall 8) | MEDIUM | Upsert emits harness-shaped only; guard `gone` with `tmuxSession: null`. |
| 10 | `FleetSession` cache version + whitelisted writer (Pitfall 6) | MEDIUM | Prefer keeping appearance out of `FleetSession` entirely. |
| 11 | Role-file read cost/latency; 44,642-byte role file measured; sweep is synchronous; 8s exec timeout (Pitfall 7) | MEDIUM | Per-tick memo + bounded head-read + per-identity try/except. |
| 12 | `import yaml` in the sweep → silent fleet-wide legacy fallback | MEDIUM | stdlib fence-scan only. Encode as a plan-level prohibition. |
| 13 | Lowercase-on-disk invariant | LOW | `IDENTITY_KEY_RE = /^[a-z0-9_-]{1,64}$/` (`identity-artifact-reader.ts:175`) forbids uppercase, and the sweep's `SAFE_NAME_RE = ^[a-zA-Z0-9_-]+$` (`fleet-status-sweep.py:114`) is **wider** (permits uppercase). Folder names in practice are lowercase and match `session.sessionName` byte-for-byte. `.toLowerCase()` calls in the derive functions are documented as defense-in-depth (`identities-store.ts:153-156`). Keep them. |
| 14 | In-memory SQLite `forceSave` | LOW | No DB writes expected; rule stands if one appears. |
| 15 | `hasSubscribedToFleet` not reset by the test helper (`identities-store.ts:483-493`) | LOW | Test-isolation flake risk when adding store tests. |
| 16 | Sweep script's **execute bit** is load-bearing | LOW | `fleet-status-sweep.py:25-31`: a mode-drift bug *"would ship a non-executable script to every managed box and permanently pin the fleet on the legacy fallback path"* (the probe is `test -x`, `:1260`). Do not `chmod` it. |
| 17 | Never hand-edit installed copies on any box | LOW | Standing fleet directive; edits land via the distributor. |

---

## Runtime State Inventory

Included because appearance-on-the-wire changes what runtime systems hold, even though this is not a rename.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| **Stored data** | **None.** Appearance is disk-authoritative in `~/fleet/identities/<key>/<key>.md` + `~/fleet/roles/<r>/<r>.md`; `.pinned`/`.hidden` are presence-only files. Phase 107 dropped `hidden_conversation_ids` and Phase 105/92 dropped the pinned column — no DB mirror remains. No migration. [VERIFIED: `107-CONTEXT.md:32-39`; `identities.ts` reads disk at request time] | none |
| **Live service config** | **Installed sweep scripts on every managed box** at `~/.local/bin/fleet-status-sweep` — the running copy is NOT the repo copy. Updated only by the distributor sweep at container boot (`starter.ts:874-890`, `catalog.ts:253-262`). This is the mid-rollout window D-04 addresses and Pitfall 1 re-scopes. | Ship script + server together; rely on optional-field tolerance during the window. **Never hand-edit installed copies.** |
| **OS-registered state** | **None.** The sweep is invoked on demand over SSH per tick (`ssh-poll-orchestrator.ts:1459`) — no cron, no systemd unit, no tmux registration for this path. | none |
| **Secrets / env vars** | **None new.** `IDENTITIES_HOST_DIR` / `ROLES_HOST_DIR` / `IDENTITIES_LOCAL_HOST_IDS` (`identity-artifact-reader.ts:218-243,184-192`) already exist and are unchanged. The **sweep** reads `$HOME` directly (`fleet-status-sweep.py:845`) and does not consult these — a pre-existing asymmetry, not introduced here. | none |
| **Build artifacts** | **`localStorage` fleet-sessions cache** (`FLEET_CACHE_KEY`, versioned v4, `conversation-store.ts:1191-1224`) — browser-side stale shape survives deploy. Only relevant if `FleetSession` gains fields (Pitfall 6). Python `__pycache__/` exists in `substrate/scripts/` but the sweep is invoked as a script, not imported, so stale bytecode is not a concern. | Bump the cache key only if `FleetSession` changes. |

**Explicitly checked and found nothing:** no cron/systemd/launchd registration for the sweep; no DB column for appearance/pin/hide; no new secret keys; no compiled artifacts on the TS side beyond the normal build.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3 on every managed box | Sweep script execution | ✓ | 3.6+ floor asserted | Legacy exec path (undesirable) |
| Python stdlib (`os`, `re`, `json`, `glob`, `subprocess`, `datetime`, `traceback`) | Sweep | ✓ | — | — |
| PyYAML | **NOT USED — deliberately** | ✓ on this box (6.0.1) | 6.0.1 | **N/A — do not depend on it.** Contract at `fleet-status-sweep.py:80-82` forbids non-stdlib. |
| `~/fleet/roles/<role>/<role>.md` path shape on managed hosts | Role inheritance read | ✓ | — | Safe-default appearance (fail-closed) |
| `zod`, `js-yaml`, `vitest` | Backend + tests | ✓ | in `package.json` | — |
| GNU `find` with `-printf` | Legacy source-B enumeration only | ✓ | — | Not on the batch path |
| `tmux` on managed boxes | Sweep PID→session resolution (existing) | ✓ | — | Existing `None` return path |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none.

**Verified this session:** `python3 -c "import yaml"` → PyYAML 6.0.1 present on t1000. `~/fleet/identities/` → 73 entries. `~/fleet/identities/pixel/pixel.md` → 286 bytes. `~/fleet/roles/box-maintainer/box-maintainer.md` → 44,642 bytes (the read-cap case). Identity frontmatter observed carrying `role`, `displayName`, `task`; role frontmatter carrying `title`, `colorHue`, `avatar` — i.e. **the inheritance case is live on this box right now** (pixel has no `title`/`colorHue` of its own and inherits both from box-maintainer). That makes t1000 a valid test surface for D-01's inheritance requirement without fixture setup.

---

## Validation Architecture

**Skipped.** `.planning/config.json` sets `workflow.nyquist_validation: false` [VERIFIED: read this session]. Per the section's own skip condition, it is omitted. Test coverage guidance is in **Test Surface** above.

---

## Security Domain

`workflow.security_enforcement: true`, `security_asvs_level: 1`, `security_block_on: "high"` [VERIFIED: `.planning/config.json`].

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface changes. `/sessions/list` + `/identities` keep `authenticateJWT` (`sessions.ts:293`, `identities.ts:317`) — unmodified. |
| V3 Session Management | no | No session/cookie changes. |
| V4 Access Control | **yes (preserve)** | Both routes are `userId`-scoped: `/sessions/list` filters `hosts.userId` (`sessions.ts:296-300`); `resolveHostById(hostId, userId)` gates host decrypt. The fleet-status WS carries `ctx.userId` through `subscribe` (`subscription-registry.ts:42`) for the orchestrator's decrypt subject. ⚠️ **Note the pre-existing property that appearance now amplifies:** the registry's `state` Map is **process-global, not per-user**, and `subscribe` sends the full snapshot (`:146-151`). Appearance is not more sensitive than the `aiTitle` / `tmuxSession` / `contextPct` already broadcast there, so this phase does not change the posture — but it does put display names and task strings on that channel. Worth one explicit acknowledgement in the plan; **not** a new control (single-user deployment today). |
| V5 Input Validation | **yes** | New: identity/role frontmatter parsed on the host and its values placed on the wire. Existing controls to reuse: `SAFE_NAME_RE` on folder names (`fleet-status-sweep.py:114,797`); `IDENTITY_KEY_RE` (`identity-artifact-reader.ts:175`); `ROLE_NAME_PATTERN` gate **before any I/O** in `readRoleFileByName` (`:641-644`); `colorHue` range-narrowing to `0..359` (`:2411-2418`). **The Python side must apply its own role-name validation before joining it into a path** — `ambient-monitor.py:237,278-280` already does exactly this (`_ROLE_NAME_OK`), with the rationale spelled out at `:250-254`: *"a malformed role like `role: ../../tmp` returns (None, ...) so the caller falls through to the unresolved-role branch rather than doing a path-traversal makedirs."* |
| V6 Cryptography | no | None introduced. Host credential decrypt (CSKEK/DEK) unchanged. |
| V7 Error Handling / Logging | **yes** | Established: per-host swallow **with** a log line (`identities.ts:473-478,495-499` — a prior silent version made SSH exhaustion look like a UI glitch); sweep logs to **stderr only** because stdout is the wire (`fleet-status-sweep.py:33-43,156-169`); frontmatter YAML failures log loudly with a 200-char bounded snippet (`identity-artifact-reader.ts:2380-2387`). Appearance-read failures must follow all three. |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via `role:` frontmatter value | Tampering / EoP | Validate role name against a strict pattern **before** path join, on **both** sides. `_ROLE_NAME_OK` (`ambient-monitor.py:237`) and `ROLE_NAME_PATTERN` (`identity-artifact-reader.ts:641-644`) are the in-repo controls. |
| Shell-metacharacter injection via identity/role name | Tampering | Batch path uses `subprocess.run` with an **arg list** (no shell) — `fleet-status-sweep.py:541-542` notes this is *"inherently safe from shell metacharacters."* Legacy path uses `shellSingleQuote` (`ssh-poll-orchestrator.ts:1725`). Do not introduce string-interpolated shell on the appearance path. |
| Malformed/hostile YAML in an identity or role file | DoS / Tampering | Bounded head-read (Pitfall 7) caps parse input. Fence-scan is not a full YAML parser, so YAML-bomb classes do not apply to the Python side. TS side already logs-and-returns-`{}` on parse failure. A real incident exists: a bare `: ` inside a plain `task:` scalar silently tripped `yaml.load` (`identity-artifact-reader.ts:~300` root-cause note, 2026-09-12) — **`task` values are free-form user prose, so this is the most likely field to malform.** |
| stdout pollution corrupting the JSONL wire | Tampering | Never write diagnostics to stdout in the sweep (`:33-43`); the caller's parser would attempt JSON on them. |
| Unbounded output size on the wire | DoS | `task` is free-form prose (the observed value on this box is ~240 chars) and 73 identities × appearance rides one exec's stdout. Not a practical concern at fleet scale, but **prefer not to add unbounded new string fields**; if `task` proves long in practice, cap it at emit time. Note the existing wire already carries a 256KB `jsonl_tail` per PID (`TAIL_BYTES`, `:136`), so appearance is negligible by comparison. |
| Cross-host identity name collision serving wrong appearance | Spoofing / Information disclosure | Composite `${hostId}::${identityKey}` keying (quick-260912-0t4). Landmine 8. |

**No HIGH-severity security findings.** Nothing here crosses the `security_block_on: "high"` threshold: no new endpoint, no new auth path, no new crypto, no new shell interpolation, no new persistence. The one item worth a sentence in the plan is the V4 note that the registry snapshot is process-global.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| O(hosts × identities × sentinels) SSH exec fan-out (~75-90/tick) | ONE `channel.exec` per host per tick running a distributed Python sweep | Phase 92, 2026-09-09 | The batch path is the norm; legacy is a fallback that must not be re-triggered. |
| Pin/hide in `user_preferences` DB columns | Per-identity disk sentinels `.pinned` / `.hidden`, read at request time | Phases 105 (pin) + 107 (hidden), 2026-09-12 | Columns **dropped**. No DB mirror, no cache — disk is truth. The sweep can read them locally. |
| `getPinnedIds()` / `getHiddenIds()` from `/user-preferences` | `deriveDiskPinnedIds` / `deriveDiskHiddenIds` projecting `identities-store` fields into row-id space, behind a both-loaded hydrate gate | Phases 105/107 + quick-260912-5q2 | Both fetches **retired**. The hydrate gate is freshly-fixed — treat as delicate. |
| Bare-name `byKey` appearance lookup | Composite `byHostKey` (`${hostId}::${key}`), `byKey` retained for existence-checks only | quick-260912-0t4 | Appearance MUST use the composite map. |
| `contextPct` in PrettyView-local `useState` | Promoted to a `SessionState` wire field, re-stamped on all three registry read paths | Phase 90 Wave 0 | **The closest precedent to this phase** — the exact template for adding a field and re-stamping at publish/snapshot/read time. |
| `lastMessageAt` from JSONL tail scan | From the identity send-log store | Phase 85 (D-07/D-08) | The scan function stays defined for byte-parallel discipline; only the call retired. |
| Standalone relay-room pane | Relay rooms render through PrettyView with `source.kind === "relay"` | Phase 93 | Relay rows are a live, differently-shaped row class. |

**Deprecated / outdated:**
- `pollOneHostLegacy` (`ssh-poll-orchestrator.ts:1376`) — retained **only** as the mandatory backward-compat fallback (*"Do NOT hard-fail if the sweep script is absent"*). Not a path to route work onto.
- The box-wide `last-stop-payload.json` (A3) — legacy, superseded by per-session; sweep deliberately does not emit it (`sweep-schema.ts:323-327`).
- `avatarUrlWithHost` helper — removed in Phase 68; `hostId` is baked into `avatarUrl` by `publicIdentity` (`identities.ts:250-253`).
- `getPinnedIds` / `getHiddenIds` — retired.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `~/fleet/roles/<role>/<role>.md` is the correct path on **every** managed box (verified on t1000 + one in-fleet Python precedent at `role-file-watch.py:281`, plus the TS `readRoleFileByName` REMOTE branch at `identity-artifact-reader.ts:668`) | Arch Map; Pitfall 7 | Role inheritance silently yields safe-defaults on non-conforming boxes → agents on those boxes arrive partially undressed. Fail-closed, so not a crash. Cheap verification: run the sweep manually on one peer box. |
| A2 | Python 3.6+ with the listed stdlib modules exists on every managed box | Env Availability | Sweep dies → empty stdout → legacy path. Mitigated by the fact the sweep already runs fleet-wide today with the same imports, so this is really "unchanged." |
| A3 | A separate `mergeIdentityAppearance` door is the best structural answer to D-09 + D-10 (vs. a flag on `setIdentities`, or a staging side-map) | Pattern 4 | Named as MEDIUM confidence. The **invariants** are HIGH confidence (they follow from `setIdentities:91` and `tabUtils.tsx:284`); the **packaging** is a judgment call the planner may re-shape. |
| A4 | A narrow `upsertFleetSession` beats routing the pulse through `updateFleetSessions(array)` | Pattern 3 | MEDIUM. If wrong, the cost is a `fleetSessionsLoaded` flip from the pulse, which interacts with the hydrate gate + pin-pruner. Erring narrow is the safer default. |
| A5 | Splitting the AppShell effect (mount-only seed+fetch / callable fetch-and-apply) is the cleanest D-07 amendment | Pattern 6 | MEDIUM — explicitly a Discretion item. The **traps** identified (skip cache seed; do NOT run `updateFleetSessions([])` on re-ask failure; coalesce in-flight) are HIGH confidence regardless of packaging. |
| A6 | `SLOW_RETRY_MS ≈ 30_000` is the right steady-state interval | Pattern 5 | Taken from D-11's own text (*"~30s"*). Not independently derived. |
| A7 | Appearance strings (notably free-form `task`) are small enough to ride the existing wire without caps | Security § DoS | LOW risk — the wire already carries a 256KB `jsonl_tail` per PID. If a pathological `task` appears, cap at emit. |
| A8 | The registry's process-global snapshot is acceptable for appearance because it already broadcasts `aiTitle`/`tmuxSession`/`contextPct` | Security V4 | Correct as a statement about *unchanged posture*; it is **not** a claim that the posture is ideal. Single-user deployment today. |

---

## Open Questions (RESOLVED)

> All four resolved during planning 2026-09-16; resolutions live in the plans'
> `resolved_open_questions` blocks. Summary: (Q1) merge in TypeScript via a shared
> `identity-appearance.ts` that BOTH the route and the pulse call — not reimplemented
> in Python — see 111-02; (Q2) `hostName` resolved from `hostsFlat` rather than
> widened onto the wire — see 111-05; (Q3) NO `fleetSessionsLoaded` gate on
> pulse-upsert, because a gate would suppress exactly the D-06 backstop case — see
> 111-05; (Q4) yes, `SWEEP_FIELD_PARITY` gains B6..B9 to preserve typo protection —
> see 111-02.

1. **Where does the identity-over-role merge execute — Python or TypeScript?**
   - *What we know:* CONTEXT.md Discretion asks for wire field names matching `publicIdentity()` *"so the frontend merge is a straight field copy rather than a translation layer"* — which implies **pre-merged** values on the wire. The sweep is the only place with both files in hand cheaply (D-01), so merging there is natural. But `publicIdentity()` (`identities.ts:209-227`) is the canonical merge and CONTEXT.md § Reusable Assets warns that divergence *"would be a second authority by the back door."*
   - *What's unclear:* whether reimplementing the three-way `identity ?? role ?? null` cascade in Python (with its non-obvious carve-outs: `task` is NOT inherited, `displayName` falls back to `capitalizeFirst(identityKey)` not to the role) is acceptable duplication, or whether the sweep should emit **raw** identity-cosmetics + **raw** role-cosmetics as two objects and let the orchestrator apply the existing TS merge.
   - *Recommendation:* **emit both raw sets on the wire; merge in the orchestrator adapter by calling the existing TS merge logic.** Rationale: keeps one merge authority (satisfying the § Reusable Assets warning and the shape's *"One authority per fact, structurally"*), keeps the Python side to pure I/O (which is what it is good at and what is testable by fixture), and costs only a slightly wider wire. The merge is pure field-comparison — it does not belong on the "hot path" in any meaningful sense. **Flag for the planner as a real decision, not a foregone one** — the counter-argument (wider wire, and `publicIdentity` is a route-layer function not currently importable from `fleet-status/`) is legitimate. If merging in Python wins, the plan must include a parity test pinning Python output against `publicIdentity()` for the carve-out cases.

2. **Where does `hostName` come from when the pulse creates a row?**
   - *What we know:* `FleetSession` requires `hostName: string` (`conversation-store.ts:174`). `/sessions/list` supplies it from the host row (`sessions.ts:325`). `SessionState` carries **only** `hostId: string` — **no host name on the fleet-status wire.**
   - *What's unclear:* whether to resolve from `state.hostsFlat` (populated from `realHostTree`, `AppShell.tsx:795-813`) at upsert time, add `hostName` to the wire, or tolerate a fallback.
   - *Recommendation:* resolve from `hostsFlat`. `computeSnapshot` already handles the absent-host case (`conversation-store.ts:~730` `fleetHostNameFallback`, and the row-builder tolerates `host: undefined` — Test 28 per the comment at `:727-731`), so a miss degrades to today's behaviour rather than breaking. **Do not widen the wire for a value the client already has.**

3. **Should the pulse's row-upsert be gated on `fleetSessionsLoaded`?**
   - *What we know:* a WS frame can arrive before the one-shot fetch resolves (that ordering is the whole premise of the `identities-store` skip-guard at `:274-277`).
   - *What's unclear:* whether an upsert landing first, then the array-replacing `updateFleetSessions(fresh)` at `AppShell.tsx:752`, could drop the pulse-created row (it would — the fetch replaces the whole array) and whether that transient matters.
   - *Recommendation:* it is self-healing (the fetch's snapshot is a superset in the steady state) and losing a row for one round-trip is invisible. But if the row was pulse-created for a session the fetch **cannot** see, it would vanish — which is D-06's territory inverted. Suggest the planner add one test: pulse-upsert → one-shot fetch resolves → assert the row survives or is correctly superseded. Low effort, closes a real ambiguity.

4. **Does `SWEEP_FIELD_PARITY` need new keys for appearance reads?**
   - *What we know:* the map's 19 keys are the Phase 92 RESEARCH exec-inventory rows (A0-A12, B0-B5), asserted exactly by `sweep-schema.test.ts:271-292`. Appearance reads are new B-series-shaped work with no legacy exec-site to be parity with.
   - *Recommendation:* extend with `B6` (identity frontmatter), `B7` (role frontmatter), `B8` (`.pinned`), `B9` (`.hidden`) and update `EXPECTED_KEYS`. The map's stated purpose is typo + documentation protection (`sweep-schema.ts:275-281`), both of which still apply. The alternative (a doc note saying appearance is outside the inventory) loses the typo protection on four new field names.

---

## Sources

### Primary (HIGH confidence) — all read in full or in the cited ranges this session

**Host-side sweep**
- `substrate/scripts/fleet-status-sweep.py` (all 931 lines) — `SCHEMA_VERSION` `:102`, `SAFE_NAME_RE` `:114`, `DISCOVERY_HEAD_BYTES` `:130`, `TAIL_BYTES` `:136`, `_log` `:156`, `_read_text_file` `:598`, `_mtime_ms` `:589`, `_build_identity_line` `:660`, `_build_pid_line` `:687`, `_enumerate_identities` `:783`, `_emit` `:838`, `main` `:844`, top-level catch `:920-930`
- `substrate/scripts/ambient-monitor.py:236-283` — `_read_frontmatter`, `_ROLE_NAME_OK`
- `substrate/scripts/role-file-watch.py:58-84,281` — weaker parser + role path shape
- `substrate/scripts/pv-context-pct-sweep.py:14-15,76-79` — second-sweep schema precedent
- `substrate/scripts/tests/README.md` — bash-native test convention

**Backend fleet-status**
- `src/backend/fleet-status/sweep-schema.ts` (all 356 lines)
- `src/backend/fleet-status/wire-protocol.ts` (all 513 lines) — additive-optional lineage `:79-353`, `SessionStateSchema` `:355-389`, frame helpers `:487-513`
- `src/backend/fleet-status/subscription-registry.ts` (all 267 lines)
- `src/backend/fleet-status/ssh-poll-orchestrator.ts` (2,877 lines; read `:405-470`, `:520-600`, `:930-1000`, `:1180-1380`, `:1420-1640`, `:1700-1990`, `:2400-2440`, `:2480-2570`, `:2760-2800`)
- `src/backend/fleet-status/sweep-schema.test.ts:72-365`
- `src/backend/fleet-status/types.ts` (scanned)

**Backend routes + readers**
- `src/backend/database/routes/identities.ts:150-510` — `publicIdentity` `:160-277`, `parseIdentityHosts` `:293`, GET handler `:317-510`, `identityHosts`-keys-ignored comment `:328-334`, semaphore `:344-366`, `roleReadCache` `:382-407`, sentinel probes `:412-434`
- `src/backend/database/routes/sessions.ts:250-640` — `TmuxSessionRow` `:260-281`, GET `/list` `:293`, role resolve `:400-420`, relay merge `:569-610`
- `src/backend/claude-session/identity-artifact-reader.ts` — `IDENTITY_KEY_RE` `:175`, roots `:218-243`, `extractRoleFromMarkdown` `:280`, `resolveRoleForIdentity` `:334`, `readIdentityFile` `:441`, `listIdentityKeysOnHost` `:506`, `readRoleFileByName` `:636`, `extractCosmeticsFromFrontmatter` `:2356`
- `src/backend/distributor/catalog.ts:38-58,253-272`
- `src/backend/starter.ts:860-910,1050-1085`

**Frontend**
- `src/ui/state/identities-store.ts` (all 493 lines)
- `src/ui/state/conversation-store.ts` (read `:165-235`, `:590-620`, `:680-800`, `:1110-1230`, `:1319-1390`, `:1555-1730`)
- `src/ui/api/fleet-status-client.ts` (all 398 lines)
- `src/ui/api/fleet-status-types.ts:1-30,85-270`
- `src/ui/api/identities-api.ts:1-92`
- `src/ui/AppShell.tsx` (read `:505-600`, `:690-820`, `:2350-2420`)
- `src/ui/shell/tabUtils.tsx:160-230,280-284`
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:460-640`
- `src/ui/features/pretty-conversations/PrettyConversationRow.tsx:300-360,1120-1310`
- `src/ui/features/terminal/session-hue.ts:1-30`
- `src/ui/api/fleet-status-client.test.ts:1-90,180-265,540-690`

**Planning artifacts**
- `.planning/phases/111-.../111-CONTEXT.md` (all)
- `.planning/shapes/shape-conversation-list-complete-and-live.md` (all)
- `.planning/phases/92-.../92-CONTEXT.md` (all)
- `.planning/phases/107-.../107-CONTEXT.md` (all)
- `.planning/STATE.md:33,387-390,635-652`
- `.planning/REQUIREMENTS.md` (structure scanned — no Phase 111 requirement IDs; coverage is D-01..D-13)
- `.planning/config.json` (all)

**Filesystem / runtime probes run this session**
- `python3 -c "import yaml"` → 6.0.1
- `ls ~/fleet/identities/ | wc -l` → 73
- `ls -la ~/fleet/identities/pixel/pixel.md` → 286 bytes; contents read (`role`, `displayName`, `task`; **no** `title`/`colorHue` → inherits)
- `ls -la ~/fleet/roles/*/[a-z]*.md | sort -k5 -n | tail` → largest 44,642 bytes; `box-maintainer.md` frontmatter read (`title`, `colorHue`, `avatar`)
- `ls -a ~/fleet/identities/pixel/` → no `.pinned`/`.hidden` present (absence = safe default)
- `ls substrate/scripts/tests/` → README + one bash driver only
- Test-file line counts via `grep -c ""`
- Multiple targeted greps (visibility listeners; `removeFleetSession` callers; `publishSessionGone` sites; fingerprint sites)

### Secondary (MEDIUM confidence)
- Cross-file comment archaeology used to establish *intent* (e.g. why `FRAME_SCHEMA_VERSION` is held at 1; why the empty-map skip-guard exists). The comments are primary text; the inferred intent is a reading of them.
- Phase 92/105/107 CONTEXT files as authority on prior decisions (they are decision records, not code).

### Tertiary (LOW confidence)
- **None.** No WebSearch, Context7, or external documentation was used or needed — this phase is entirely internal to the repository. No claim in this document rests on training data about a third-party library.

---

## Metadata

**Confidence breakdown:**
- **Standard stack:** HIGH — no new dependencies; every library confirmed present in the repo. The PyYAML rejection is HIGH (the prohibition is written in the script's own docblock at `:80-82`).
- **Architecture / integration seams:** HIGH — every seam was traced end-to-end by reading source, not names. The one-way data path from `_build_identity_line` to `PrettyConversationRow` was walked in both directions.
- **Pitfalls 1-9:** HIGH — each is a specific mechanism at a specific line, verified by reading the code that implements it. Pitfall 1's inverted-direction claim rests on the deploy path (`starter.ts:874-890` + `catalog.ts:259-261`) plus the equality check (`sweep-schema.ts:236`) plus the channel-lifetime latch (`ssh-poll-orchestrator.ts:1236-1240,1315-1317`) — three independent reads agreeing.
- **Design recommendations (A3-A6):** MEDIUM, individually flagged. Invariants HIGH, packaging MEDIUM.
- **Open Question 1 (merge location):** genuinely open — recommendation given with its counter-argument.
- **Test surface:** HIGH on which files exist and what they assert (opened and read); MEDIUM on completeness of the "secondary" list.

**Research date:** 2026-09-16
**Valid until:** ~2026-10-16 for the architectural findings (internal codebase, stable). **Shorter — days — for the exact line numbers**, since this is an active tree on `feat/tab-title-from-tmux` with concurrent peer agents. Line numbers should be treated as *strong hints plus a symbol name to grep*, not immutable coordinates. Every citation above pairs a line number with a symbol or quoted string for exactly this reason.

# Phase 111 — Discussion Log

**Date:** 2026-09-16
**Participants:** Ashley + pixel (box-maintainer)
**Mode:** default (no flags). Seeded from `shape-conversation-list-complete-and-live.md`; only post-shape gray areas discussed.

> Human-reference record only — NOT consumed by researcher / planner / executor.
> The canonical output is `111-CONTEXT.md`.

## Pre-discussion: scouting finding that resized the phase

Before presenting gray areas, source reading established that the architecture
the shape describes already exists:

- `subscription-registry.ts:125` — server already holds `Map<string, SessionState>`.
- `:139-153` — already sends a full snapshot frame to each new subscriber.
- `wire-protocol.ts:355-389` — `SessionStateSchema` already carries 14 fields.

Missing: only the four appearance fields + pinned + hidden. Reported to the user
as "widening an existing carriage, not laying track." No decision required — it
narrowed what the gray areas needed to cover.

## Gray areas presented

Four, each phase-specific rather than a generic category:

1. Where appearance enters the pulse (sweep-side vs server-side).
2. What the frozen one-shot request becomes (delete vs keep as backstop).
3. What "one write authority" means concretely (given the store's dual job).
4. How much the reconnect gives up (5 tries / ~28s / permanent today).

User response: *"give me your recs"* — so all four were led with a
recommendation rather than an open question, then confirmed together.

## Area 1 — Where appearance enters the pulse

**Options weighed:** host-side sweep carries appearance / server reads it while
assembling frames.

**Recommended + accepted: host-side sweep.**

Reasoning surfaced:
- The sweep is already standing in the identity folder with the file open.
- Server-side reading = going back over the network for something the sweep
  could have carried — the same mistake being fixed one layer down.
- Cost scales per-host rather than fleet-wide.
- **Deciding factor was older-box degradation:** Phase 92's schema-version
  fallback already exists, so an un-updated box reports old fields and its
  agents arrive undressed until the distributor catches up. Worst case is
  "no better yet," never "newly broken."

→ D-01, D-02, D-03, D-04

## Area 2 — What the frozen one-shot request becomes

**Options weighed:** delete it (cleaner) / keep it as a backstop (safer).

**Recommended + accepted: keep it, demote it, change its timing rule.**

Reasoning surfaced:
- The pulse enumerates what is RUNNING, so it structurally cannot see a
  just-born identity that exists on disk before it runs — no matter how well
  built.
- Special-casing that onto the hot path for the rarest event in the system is
  how hot paths rot.
- What changes is the timing: fires on open AND on becoming visible, not
  "exactly once per page load." Same path both times.

→ D-05, D-06, D-07, D-08

## Area 3 — What "one write authority" means concretely

**The complication raised:** `identities-store` answers TWO questions with one
piece of data — "what does this look like?" and "is this an agent at all?" The
second drives the pane discriminator, and answering it wrongly-early already
caused a Terminal to boot an xterm + real SSH WS then unmount, leaking
listeners (comment block at `identities-store.ts:258-273`; the empty-map
skip-guard at `:274-277` exists solely to prevent it).

**Recommended + accepted: the pulse may dress rows; it must never adjudicate
existence.**

- Appearance writes are additive, through the single existing door.
- The `loaded` flag stays owned by the fuller request.
- Framing recorded: *"the pulse makes rows pretty; it never makes the app
  conclude an agent doesn't exist."*

→ D-09, D-10

## Area 4 — How much the reconnect gives up

**Current behaviour established from source:** `MAX_RECONNECT_ATTEMPTS = 5`,
backoff `[2s,4s,6s,8s,8s]` ≈ 28s, then `fleet_status_client_gave_up` and deaf
for the life of the tab.

**Recommended + accepted: never give up permanently + reconnect on visible.**

Reasoning surfaced:
- 28s is tuned for a flaky network, not a phone in a pocket — and a phone in a
  pocket is the normal case, so today the common path is the failing path.
- Keep the existing ladder for early attempts, then settle into slow steady
  retry (~30s) indefinitely.
- Explicitly NO replay / gap-reconciliation: the re-ask is the backstop.
  Correctness must not rest on reconciliation being perfect.
- Preserve the full-jitter draw so multi-tab restore does not re-clump.

→ D-11, D-12, D-13

## Measurement performed during discussion

Prompted by the user's question: *"i don't know what would be too much on let's
say a four gig graviton ec2 host … what would be okay for those?"*

Benchmarked on this box (73 identities, warm cache):

| Shape | Median | p95 |
|---|---|---|
| Current sweep identity-walk | 1.10ms | 1.36ms |
| Naive read-everything (frontmatter + role + 2 sentinels) | 2.10ms | 3.54ms |
| mtime-gated variant | 1.16ms | 1.95ms |

Full sweep script per tick: 600–750ms wall, ~74MB peak RSS. Profile of a 1.04s
run: `discover_identity_jsonl_path` 617ms cumulative,
`scan_tail_for_layer1_recycling_signal` 272ms, 10,020 `json.loads` calls.

**Consequence:** the added work is ~1/600th of the existing tick cost. This
reversed a caution stated earlier in the session (that the added reads were
worth engineering around) and led directly to D-03 — mtime-gating rejected on
evidence, since it saves ~0.9ms in exchange for a mechanism that can be
silently wrong.

It also collapsed the 3-shape campaign into a single shape, on the user's
framing that one complete answer serving both moments is "the whole story."

## Scope creep

None. The two out-of-scope items (slow first-ever load; making an individual
conversation open faster) were already excluded at shape time and were not
re-litigated.

## Claude's discretion (recorded in CONTEXT.md)

Plan slicing; exact wire field names; sweep line shape (extend existing vs new
line kind); Python-side role memo shape; whether to log fail-closed appearance
read errors; how far the shape-lock comment amendment reaches.

---

*Phase: 111-conversation-list-arrives-complete-and-stays-live*
*Logged: 2026-09-16*

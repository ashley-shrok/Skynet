# Phase 89 Discussion Log

**Date:** 2026-09-08
**Mode:** Seeded from shape file (per `/build` convention — no standard discuss-phase gray-area questionnaire run; the /open conversation for the shape already gathered the decisions)

## Source of decisions

All 16 D-decisions in `89-CONTEXT.md` come from the walked-one-at-a-time `/open` conversation with Ashley on 2026-09-08 for the shape file at `.planning/shapes/shape-relay-session-model-generalization.md`. Each decision was greenlit `thumbs up` before advancing.

## Discussion arc (chronological)

1. **Pitch back the seed shape.** taylor summarized the seed's intent and reflected the two-peer-paths reading. Ashley confirmed with an important scoping addition — exclusion applies ONLY to (user + one agent) two-party rooms, because that pattern is already covered by harness sessions.

2. **Exclusion rule sharpening.** Discussed what "one agent" means — foreign agents, other humans, 3+ member rooms. Locked: exclude ONLY (user + one agent) two-party rooms; everything else materializes (D-08).

3. **Agent identification mechanism — investigated codebase.** taylor initially proposed correlating identity name → Matrix account. Ashley pushed back — account name format is changing, and the rigid tie should be via each identity's `relay.json` on disk. taylor investigated the current state of Skynet's session storage + identity model — surfaced findings: (a) no stored session-record table for harness sessions (derived at request time), (b) Skynet already creates Matrix accounts for both agents (Phase 75) and humans (Phase 88), (c) the natural join hook lives Skynet-side.

4. **Reframing the storage question.** Given no stored harness session record exists, the seed's "grow a discriminator" framing was updated to "two peer paths, new stored table for relay-room only, merge at /sessions/list" (D-01).

5. **Registry rooms proposal.** taylor raised the host-down fragility problem for a disk-based agent identification. Ashley agreed and asked about Matrix-native mechanisms. taylor proposed three options (registry room, account_data, custom profile field). Registry room won on cleanness. Ashley refined to TWO registry rooms — agents room + humans room — both created by Skynet at account-creation time since Skynet is already the creator of both types (D-10, D-11).

6. **Registry room exception + ignore-list.** Ashley noted the registry rooms themselves must not appear in the conversation list. Locked: Skynet-instance-owned internal ignore-list, general-purpose bucket for admin rooms (D-13, D-16).

7. **Race guard.** Discussed the race between observation loop and slice C's create-room flow. Locked: DB uniqueness on (user, room), both paths idempotent (D-14).

8. **Failure mode — poll unreachable.** Locked: no destruction on poll failure, per-user backoff (10s → 30s → 60s → cap 5min), reconcile on recovery, per-user isolation, no user-visible failure banners (D-06, D-07).

9. **Row shape + sort key source.** Locked: `id, user_id, room_id, room_title, state, last_activity_at, created_at, updated_at` with unique(user_id, room_id) and same-tick augmentation for last_activity_at (D-02, D-05).

10. **External-kick handling.** Locked: state transition (active|inactive), row preserved for history + re-invite reactivation (D-03).

11. **Vehicle decision.** Ashley greenlit single GSD phase — full pipeline: /gsd:phase → discuss (seeded from shape) → plan → execute → verify → unbiased general-purpose subagent code review → hand-off → hold at push.

## Scope creep

None during /open. All discussion stayed within the slice B backend scope. Frontend rendering (slice D), create-room modal (slice C), voluntary-leave handling, and id-substrate multi-agent-etiquette directives (slice E) were all explicitly deferred to their own slices.

## Deferred ideas surfaced during discussion

- Real-time membership subscriptions (per-user Matrix sync clients) — rejected in favor of admin-poll cadence.
- Caching room member lists / messages in stored row — rejected in favor of live relay queries.
- Additional session-kind concepts (RDP-session) — one concern per slice.
- User-visible admin surface for ignore-list — future admin console phase if ever needed.
- Pruning inactive rows / voluntary leave / unread markers — future slices.

## Prior context loaded

- `.planning/PROJECT.md` (Skynet core value + fleet-substrate ownership)
- `.planning/STATE.md` (Phase 88 complete, Phase 89 next)
- `.planning/phases/88-*/88-CONTEXT.md` (14 D-decisions from slice A)
- `.planning/shapes/shape-relay-mediated-group-conversations.md` (master shape)
- `.planning/shapes/shape-relay-session-model-generalization.md` (this slice's shape)

## Claude's discretion items

Documented in `89-CONTEXT.md § Claude's Discretion` — concrete table name, module structure, marker field name, poll cadence exact value, backfill trigger mechanism, registry-room naming choices. All planner-level; none require re-consulting Ashley.

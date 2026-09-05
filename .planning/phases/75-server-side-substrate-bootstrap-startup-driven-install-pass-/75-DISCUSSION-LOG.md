# Phase 75: Discussion Log

**Vehicle:** `/build` → `/open` → GSD phase → `/gsd:discuss-phase` (seeded from shape file per build-skill convention)

**Discussion source-of-truth:** `.planning/shapes/shape-server-side-substrate-bootstrap.md` (opened + greenlit `thumbs up` 2026-09-05).

CONTEXT.md was seeded from the shape file rather than re-eliciting decisions through the interactive gray-area picker, per the build-skill directive: *"seed discuss-phase from the shape file. shape-<slug>.md already captures the 'why + what + constraints + scope edges' that /gsd:discuss-phase would otherwise re-elicit into CONTEXT.md — either drop the shape file in as CONTEXT.md directly, or generate CONTEXT.md from it. Don't re-do the discovery work `/open` already did."*

## Where each CONTEXT.md decision came from

All decisions in CONTEXT.md trace to specific turns in the `/open` session with Ashley on 2026-09-05:

| Decision | Turn in `/open` where it was locked |
|---|---|
| D-01 (serial startup pass) | Turn: "with what is in the substrate right now, I can't imagine it takes very long at all to distribute it. So if you agree with that, I think doing it serially is fine." |
| D-02 (on-add fire-and-forget) | Captured by me in shape doc without asking — obvious call, host-create should be snappy |
| D-03 (retry piggybacks on 30s host-list refresh) | Turn: "piggybacking on the 30 second thing seems like a good idea and you know the benefit of it is that it would catch a host that comes back up pretty quickly which is nice" |
| D-04 (remove browser-driven hook) | Turn: "the browser driven install feels like it could be done away with unless you have any objections" — no objection, proceed |
| D-05 (once-per-uptime invariant preserved) | Turn: "the substrate can't change without an app restart anyway right now so it's not like we need sky net to be like periodically trying to update substrate on hosts that it's already hit at least once during that uptime" |
| D-06 (loud alert after N failures) | Turn: "Um, either first or second, whichever you think is better." — I chose option 2 (loud alert after N failures) per AI+ project's already-locked "fail loud, trust operator to diagnose" stance |
| D-07 (alert once per host per uptime) | Implicit in option 2; captured by me without re-asking |
| D-08/D-09/D-10 (CSKEK wrap for substrate hosts, one representation, non-substrate unchanged) | Turn: "if I'm being honest with you, I feel like it's bullshit that the system can't just use the keys it already has" → me offering three shapes (A: system-key-only, B: dual-wrap, C: escrow) → Ashley: "if you're telling me option A involves just locking the credentials with the systems key instead of the users key, but the users can still log in and do everything the same way, then I think that sounds great" |
| D-11 (substrate-flag-toggle-off deferred) | Captured by me in shape doc — rare edge case flagged as deferred |
| D-12/D-13/D-14/D-15 (one-shot operator-run migration) | Turn: "I know the credentials for every user currently on both this instance and Stacey's instance, which are the only two instances of the app that exists. So maybe that can give us our answer because I can provide those and we can do a migration." |
| D-16 through D-19 (test coverage) | Not explicitly discussed — planner-standard test coverage for the change surface |

## Scope creep redirected

None during `/open`. Two adjacent topics that came up were properly deferred:
- Substrate-flag-toggle-off (flag flipping from true to false on existing host) — deferred, rare in practice
- Fleet-wide relaxation of per-user DEK model — explicitly rejected as out-of-scope; relaxation stays scoped to substrate hosts

## Discussion posture

`/open` took Ashley through: shape pitch (me offering the shape I'd heard via her Stacy DM quote) → clarification (she clarified "no flag for un-bootstrapped state, existing runsFleetSubstrate stays") → discussion of the ongoing-update bummer (she confirmed she cares about updates rolling out server-side, not just Stacy's initial install case) → shape reframe (system-side periodic-ish pass, not browser-driven) → crypto discussion (three options offered, she picked A) → sanity check on "is this standard?" (she sought reassurance that scoped-backend-secrets is normal, I confirmed with the 1Password comparison) → grill on parallel-vs-serial, retry-forever-vs-alert, migration → vehicle selection (GSD phase).

Grill closed cleanly with `thumbs up` on the shape file.

---

*Phase: 75 — Server-side substrate bootstrap*
*Discussion logged: 2026-09-05*

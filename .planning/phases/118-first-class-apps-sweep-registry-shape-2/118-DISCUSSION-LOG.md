# Phase 118: First-class apps — sweep + registry (shape 2) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-18
**Phase:** 118-first-class-apps-sweep-registry-shape-2
**Areas discussed:** Discovery inclusion filter, Unhealthy tile treatment, Health message authorship, Icon field shape

---

## Context

Phase 118 is shape 2 of the four-shape `first-class-apps` campaign. Per the build-skill rule, `/gsd:discuss-phase` was seeded from the shape file at `.planning/campaigns/first-class-apps/shape-sweep-and-registry-api.md` (opened + greenlit via `/open` earlier this session, 2026-09-18) rather than re-eliciting decisions.

The formal gray-area menu was skipped because the shape file's scope-edges + philosophy sections already resolve every gray area a discuss-phase would surface. The `/open` session's own grill beat surfaced and resolved four decisions live with Ashley; those are the entries below. All other CONTEXT.md decisions (D-05..D-23) are derived unambiguously from the shape file, prior phases (especially Phase 115's reconciliation pattern), and standing fleet directives.

---

## Discovery inclusion filter

| Option | Description | Selected |
|--------|-------------|----------|
| Structural filter | Folder exists + card parses | |
| Functional filter | Folder + card + systemd unit is currently active | ✓ |
| Everything | Include any folder even without a working unit | |

**User's choice:** Functional. Verbatim (Ashley 2026-09-18): "i guess no because you can't actually use the app."
**Notes:** Landed as CONTEXT D-01. Applies uniformly regardless of which of the three checks fails — folder + card + unit-active all required. Silent absence for all other misses.

---

## Unhealthy tile treatment

| Option | Description | Selected |
|--------|-------------|----------|
| Fully binary (no health tier) | Anything that's not running just disappears silently | |
| One health carve-out for stopped units | Show the app with an unhealthy flag + short message ONLY when the unit exists but is currently stopped; all other misses still silent | ✓ |
| Multi-tier health | Chase every failure mode (crashes, port collisions, response-time, app-level healthchecks) | |

**User's choice:** One-carve-out. Verbatim tension (Ashley 2026-09-18): "part of me wants to display apps that seem to have some sort of issue and have something showing that they're unhealthy but at the same time i don't want to try to chase down every way an app can break and try to accommodate that you know what i mean" — then greenlit the "one honest failure mode: unit exists but isn't currently active" framing.
**Notes:** Landed as CONTEXT D-02. Silent-disappearance stays for missing folder / missing card / missing unit (those aren't "apps that broke," they're "not really apps present"). The single carve-out earns a place because the systemctl check is already free (D-02 rationale). The healthMessage register borrowed from her framing: "ask an agent to check on it."

---

## Health message authorship

| Option | Description | Selected |
|--------|-------------|----------|
| Backend authors the string | Backend emits `{ isHealthy: false, healthMessage: "..." }` — client renders verbatim | ✓ |
| Frontend authors the string | Backend emits `{ isHealthy: false }`; client owns all copy | |

**User's choice:** Delegated ("whatever you think is best" — Ashley 2026-09-18).
**Notes:** Landed as CONTEXT D-03. Chose backend-authors because the backend knows the specific diagnostic that produced the state, and future health types would be backend-only changes with the frontend just rendering. Puts content near the diagnostic that produced it.

---

## Icon field shape

| Option | Description | Selected |
|--------|-------------|----------|
| Boolean (`hasIcon: true`) | Client constructs the fetch URL from slug + host once serving lands | ✓ |
| URL (`iconUrl: "..."`) | Backend hands the client a ready-made URL string per app | |

**User's choice:** Boolean. Ashley asked for my take ("what do you think?" — 2026-09-18) and greenlit the boolean recommendation with a thumbs-up.
**Notes:** Landed as CONTEXT D-06. Rationale: shape 2 shouldn't invent a URL for a resource whose serving path (shape 4) hasn't been designed yet; boolean is what shape 2 actually knows from disk observation. Client-side URL construction is cheaper to change later than a backend-locked URL contract.

---

## Claude's Discretion

Called out in CONTEXT.md `<decisions>` § Claude's Discretion. Ashley delegated the small tactical calls at planner + executor scope:
- Exact TypeScript naming of the sibling map + data holder on the subscription registry.
- Exact healthMessage phrasing for the one health case (register locked, exact words open).
- Whether reconciliation code sits inline in the orchestrator or in a small sibling module.
- Exact WS frame-type verbs (`app-snapshot` vs `app-add`, etc.) matching existing session-frame naming.
- Python sweep script's per-app enumeration mechanics (single find/stat batch vs iteration).
- Systemd PORT extraction mechanism.
- Extension shape on `PerHostState` (new field vs sibling struct).

---

## Deferred Ideas

All captured in CONTEXT.md `<deferred>`. Key ones:
- Eager-refresh signal for just-created apps — deferred unless shape 3's UAT reveals the natural 2s cadence feels bad.
- Plain HTTP snapshot endpoint alongside the WS subscription — YAGNI until asked.
- Additional health tiers (application-level healthchecks, crash counting, port-collision detection, etc.).
- Server-authored per-user app state (favorites, hidden, custom labels) — shape 3 owns this.
- Push / register API on the app side — not the pattern; disk is truth.
- Backend-constructed icon URLs — shape 4 territory.
- Owning-agent / provenance display — CLOSED (Ashley: "no benefit").
- Orphan systemd unit cleanup on folder delete — shape 1's disk-side flow owns this.

---

## Session mechanics

- **Prior context loaded:** `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md` (roadmap-evolution + accumulated context), `.planning/phases/115-*/115-CONTEXT.md` (the reconciliation pattern this phase leans on), the shape file, the closed shape 1 archive, the campaign artifact.
- **Codebase scout:** No `.planning/codebase/` maps exist. Substituted with the recon done during `/open` (unbiased general-purpose Explore agent that walked `ssh-poll-orchestrator.ts`, `fleet-status-server.ts`, `subscription-registry.ts`, `sweep-schema.ts`, `wire-protocol.ts`, `types.ts`, `identity-appearance.ts`, `host-id-resolver.ts`, `host-resolver.ts`, `substrate/skills/app-development/**`). Findings folded into CONTEXT.md's `<code_context>`.
- **Todos:** No matching todos surfaced by `todo.match-phase 118`.
- **SPEC.md:** None. Shape file is the requirements source for this phase.
- **Format:** Free-text conversation during `/open` grill, not the standard `AskUserQuestion` gray-area menu — per build skill rule to not re-do discovery.

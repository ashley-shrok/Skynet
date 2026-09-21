# Phase 127: wake-ups redesign phase 1 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-21
**Phase:** 127-wake-ups-redesign-phase-1
**Areas discussed:** On-disk spec path, Create-request file schema coordination, Migration strategy, Backwards-compat window

---

## On-disk spec path

| Option | Description | Selected |
|--------|-------------|----------|
| Flat `~/fleet/wakeups/*.json` | One file per wake-up, matches older per-identity/per-role convention | |
| Subdir `~/fleet/wakeups/<slug>/wakeup.json` | Slug-folder + fixed-sentinel-file, mirrors bounty/runbook/skill convention; enables companion files (migration provenance, continuity scratch, last-fired log) | ✓ |

**User's choice:** Subdir with fixed sentinel (Claude's recommendation).
**Notes:** Adopts newer fleet convention rather than propagating older flat one. The older per-identity `~/fleet/identities/<name>/wakeups/*.json` stays flat as-is — different scope, no unify pressure.

---

## Create-request file schema — coordination with multi-role identity work

| Option | Description | Selected |
|--------|-------------|----------|
| Phase 1 defines schema, multi-role adopts | Wake-ups drives the extension; multi-role implements what wake-ups needs | |
| Phase 1 waits on multi-role to lock, then aligns | Multi-role drives, wake-ups adapts | |
| Phase 1 defines pragmatically — researcher checks multi-role state at plan time and either locks or aligns; ownership of who-implements-which-side is Claude's call | Spec-in-hand approach; no blocking | ✓ |

**User's choice:** Third option (Claude's recommendation).
**Notes:** User explicitly delegated the "which shape handles each piece" call to Claude ("if this is just asking which shape handles each part then that kind of thing is up to you"). Phase 1 does NOT wait on multi-role.

---

## Migration strategy for existing per-role wake-ups

| Option | Description | Selected |
|--------|-------------|----------|
| Automatic conversion on distributor sweep | Distributor pushes migration logic to every host | |
| One-time manual command | A CLI or script the user/orchestrator runs once fleet-wide | |
| Hand-migrate what's found during phase 1 execution | Sweep hosts, convert small count by hand, drop `migrated-from.md` companions | ✓ |

**User's choice:** Hand-migrate (Claude's recommendation).
**Notes:** Spot-check on this host showed zero per-role specs; fleet-wide count likely 0–5. Automation would exceed the work. Escalation threshold (~10) baked into D-15 — if the fleet-wide count blows past that, we swap to a small script mid-execution. That call is deferred to plan-execution time.

---

## Backwards-compat window

| Option | Description | Selected |
|--------|-------------|----------|
| Dual-mode window (per-role wake-ups keep firing alongside new global ones for a rollout period) | Overlap gives peers time to converge | |
| Hard cutover at deploy (per-role plumbing removed same-day as global launches) | Migration + code-removal happen together per-host | ✓ |

**User's choice:** Hard cutover (Claude's recommendation).
**Notes:** Small fleet-wide per-role population makes dual-mode unnecessary overhead. Distribution timing (peer A gets new code before peer B) is normal fleet-substrate rollout — self-contained per host, migration+code-removal happen together, no special-casing needed.

---

## Claude's Discretion

- **Which side of the multi-role/wake-up boundary implements the request-file extension** (per D-13). User delegated.
- **Exact JSON field ordering / key naming polish** beyond the roles[] + skills[] + name + prompt extensions.
- **Migration escalation threshold** if fleet-wide per-role count exceeds ~10 (per D-15).
- **Test / logging conventions** — mirror existing fleet-substrate scripts rather than inventing new ones.

## Deferred Ideas

All deferrals are captured in CONTEXT.md `<deferred>` section — they include:
- Phase 2 scope (Skynet backend CRUD API + role/skill enumeration endpoints).
- Phase 3 scope (Skynet UI modal — the settled tasting design at the bounty's prototype.html).
- Rejected additions (dual-mode compat, automated migration script by default, wake-up-provided continuity, cross-host wake-ups, templates, past-fires history view).

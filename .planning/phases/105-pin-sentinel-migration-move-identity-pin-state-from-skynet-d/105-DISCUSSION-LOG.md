# Phase 92: pin-sentinel-migration — move identity pin state from Skynet DB to `.pinned` on-disk sentinel per identity folder - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-09
**Phase:** 92-pin-sentinel-migration
**Areas discussed:** Read path, Wire mechanism, Write philosophy (sync vs. async), UI feel + failure UX, DB table disposition, Migration approach, Sentinel contents

**Discuss mode:** Seed-from-shape (per build-skill convention). The /open pass on 2026-09-09 with Alice grilled every gray area; discuss-phase used the resulting shape file (`.planning/shapes/shape-pin-sentinel-migration.md`) as the authoritative source rather than re-eliciting. Below is the audit reconstruction of the grill exchanges that landed the decisions in CONTEXT.md.

---

## Read path

| Option | Description | Selected |
|--------|-------------|----------|
| Direct disk-read at request time | Same pattern the task field (Phase 80) and cosmetic fields (Phase 86) already use — identity API reaches disk when serving | ✓ |
| DB mirror cache | Disk stays source of truth; DB still holds pin-state boolean per identity, refreshed from disk during periodic per-host identity scan; row-render reads from mirror | |

**User's choice:** Direct disk-read.
**Notes:** Alice thumbs-up on the argument that Phase 69 killed the DB identities table and Phase 80/86 established the disk-read-at-request-time pattern; mirror cache would reintroduce the two-sources-of-truth risk the whole move is designed to eliminate.

---

## Wire mechanism (for writes)

| Option | Description | Selected |
|--------|-------------|----------|
| Piggyback on identity-birth SFTP wire, generalize | Extend the Phase 77 identity-birth SFTP mechanism into a per-identity file-touch primitive with two callers (birth + pin) | ✓ |
| New parallel wire dedicated to pin | Build a fresh host file-touch mechanism specifically for pin sentinels, separate from birth's wire | |
| Interactive terminal channel | Use the existing SSH terminal wire for pin sentinel touches | |
| Substrate distributor sweep | Use the periodic distributor mechanism to sync pin sentinels | |

**User's choice:** Generalize the identity-birth wire.
**Notes:** Alice: *"Okay, then we can use it then."* Rejected alternatives: new parallel wire (duplicates auth + lifecycle + error handling), terminal channel (stateful, wrong use case), distributor sweep (scheduled sweeps ≠ transactional one-shots).

---

## Write philosophy (sync vs. async)

| Option | Description | Selected |
|--------|-------------|----------|
| Synchronous | Pin toggle succeeds or fails right now over the wire, no queue, no optimistic-then-reconcile, no shadow desired-state store | ✓ |
| Eventually consistent | UI accepts pin action immediately, backend queues write, retries in background until it lands; UI shows "pending" state | |

**User's choice:** Synchronous.
**Notes:** Alice verbatim: *"Yeah, synchronous. Keep it simple."* Rejected alternative would reintroduce the drift risk the shape's "what would make it wrong" explicitly closes.

---

## UI feel (during and after toggle)

| Option | Description | Selected |
|--------|-------------|----------|
| Unchanged from current behavior | Whatever pattern the pin toggle uses today (optimistic-flip / spinner / instant) stays exactly as-is | ✓ |
| Optimistic flip with rollback | UI shows pinned instantly, rolls back on failure | |
| Wait-then-flip with pending indicator | Spinner during wire round-trip, flips when write lands | |

**User's choice:** Unchanged.
**Notes:** Alice verbatim: *"This isn't changing, so however it feels now is how it's going to feel after this."* This is a plumbing move, not a UX pass.

---

## Failure UX

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse existing generic wire-error treatment | Whatever failure surface the app already shows for other failable ops handles pin-wire failures too | ✓ |
| Bespoke pin-failure treatment | Inline "couldn't reach host" note next to the row, or a dedicated toast | |

**User's choice:** Reuse existing.
**Notes:** Alice verbatim: *"We are not complicating this, so however it would have failed already is how it will fail today, even if it's more likely now than before."*

---

## DB pin table disposition

| Option | Description | Selected |
|--------|-------------|----------|
| Drop in same schema migration | Column is removed as part of this phase's code deploy; no dormant table left | ✓ |
| Leave dormant | Code stops reading/writing but column stays as inert bytes | |

**User's choice:** Drop.
**Notes:** Alice verbatim: *"Drop it."* Dormant table invites future accidental re-consultation; matches the "no shadow source of truth" invariant.

---

## Migration approach for existing pinned identities

| Option | Description | Selected |
|--------|-------------|----------|
| Manual per-box maintainer step | Each box's maintainer touches `.pinned` for each currently-pinned identity before deploy; no code participates | ✓ |
| Backend one-shot at first-run | App enumerates DB pin state, writes sentinels via wire, retry on unreachable | |
| Periodic reconciliation loop | Identity-refresh scan writes missing sentinels on each cycle until all migrated | |

**User's choice:** Manual per-box.
**Notes:** Alice verbatim: *"we're not doing anything fancy for migration if that's what your second thing that you were talking about is in reference to, you know, Skynet is not doing any migrating. That's such an easy step for you to just do manually that we're not going to get into extra pieces for that."* Manual sequencing keeps the pin-visible window closed (touch before deploy; new code finds sentinels already in place).

---

## Sentinel file contents

| Option | Description | Selected |
|--------|-------------|----------|
| Presence-only, empty file | Sentinel's existence IS the pinned-ness; file body never read | ✓ |
| Body encodes metadata | Pinned-at timestamp, admin identifier, priority order, etc. | |

**User's choice:** Presence-only.
**Notes:** Alice thumbs-up on the argument that any encoded metadata reopens the drift question (two things to keep in sync per identity — file existence and its contents); any metadata that becomes desired later belongs elsewhere if it belongs anywhere.

---

## Claude's Discretion

- **Refactor shape** for extending the identity-birth SFTP mechanism into a per-identity file-touch primitive (helper function vs class method vs standalone module — planner picks based on the orchestrator's existing shape).
- **Test seams** — presence check / write / unpin / wire-failure scenarios; planner picks the assertions.
- **Frontend API surface preservation vs. redesign** — whether `putPinnedIds([...])` stays as a batch call or splits per-identity; planner decides based on how the UI currently batches.

## Deferred Ideas

- Sibling `.hidden` sentinel to replace `hidden_conversation_ids` on the same user_preferences row — structurally identical move but out of scope for Shape 1. Reconsider only if the planner finds the DB migration cleaner as a paired drop.
- Pin metadata (pinned-at, pinned-by, priority order) — deliberately excluded; separate future phase if ever desired.
- Auto-pinning heuristics — actively rejected (UI is sole author).
- Per-role or per-workspace pinning — out of scope for this campaign.
- Bulk pin ops ("pin all" / "unpin all") — out of scope.

---

## Discovered during scout

- The current pin storage is NOT a per-identity boolean column. It's `user_preferences.pinned_conversation_ids` — a text column holding a comma-separated list of identity keys, scoped per-user. Under Skynet's single-tenant reality this makes the identity-global sentinel model a clean move without semantic loss, but it's a shift from "per-user pin list" to "per-identity pinned-ness" that CONTEXT.md flags to the planner. Sibling column `hidden_conversation_ids` on the same row structurally mirrors and stays out of scope.

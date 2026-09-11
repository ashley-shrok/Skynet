# Phase 87: User avatars — baseline backend support — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-07
**Phase:** 85-user-avatars
**Discussion vehicle:** `/build user avatars` → `/open user avatars` — the shape-file grill (per build-skill convention, CONTEXT.md is seeded from `.planning/shapes/shape-user-avatars.md` and this phase does NOT re-run `AskUserQuestion` gray-area presentation).

**Areas discussed (during /open):** storage layout, mandatoriness enforcement, endpoint contract (single-call vs two-step), server-side vs managed-host disk placement.

---

## Storage layout

| Option | Description | Selected |
|--------|-------------|----------|
| Bytes as a column on the users row | Simple — everything about a user in one place. Backup story unchanged. Cost: inflates in-memory SQLite (fully decrypted into RAM at startup), list queries drag bytes. | |
| File on disk, users row holds pointer | Matches how identity avatars work. Keeps DB lean. Two things to keep in sync (row + file), lifecycle question, "where exactly" sub-question. | ✓ |
| Hybrid: thumbnail in row + full on disk | Premature at this scale but named for completeness. | |

**User's choice:** File on disk with a pointer — the standard web-app go-to.
**Notes:** Alice verbatim: *"you know this is about as standard as i think you can get for wanting avatar support for an app um so unless you can think of a reason to do otherwise i would ask what the standard go-to way would be for doing this and then we probably just go with that"*. No Skynet-specific reason to deviate; the crown-jewel in-memory SQLite invariant actively supports keeping bytes OUT of the DB.

---

## Disk location — Skynet server vs managed host

| Option | Description | Selected |
|--------|-------------|----------|
| Skynet server's own encrypted data volume | Rides existing backup, same lifecycle as other per-user Skynet state, no cross-host coordination. | ✓ |
| A managed host over SSH | Not a real candidate — clarified because "disk" in a fleet-manager context could ambiguously mean elsewhere. | |
| Operator-config bind mount | Similar to the global-files.json debate; but avatars aren't hand-edited by the operator, so the argument for a bind mount doesn't carry. | |

**User's choice:** Skynet server's own encrypted data volume.
**Notes:** Alice verbatim clarification: *"just to be clear, they would go on the machine that Skynet is running on, if they're going to go on disk, and not on hosts registered in Skynet"*. Explicitly captured because ambiguity was real.

---

## Endpoint contract — single call vs two-step

| Option | Description | Selected |
|--------|-------------|----------|
| Single-call create (bytes + JSON in one multipart request) | Simple happy path. Only one endpoint changes. Downside: doesn't naturally give a change-avatar-later endpoint. | Partial (see below) |
| Two-step (create user JSON → separate follow-up call to set avatar) | Same endpoint serves both create-time set and later change-time updates. Downside: mandatory + two-step at backend requires pending-state / ticket / reservation flow. | Partial (see below) |
| **Hybrid: single-call mandatory create + separate change endpoint sharing internal helper** | Best of both. Real backend mandatoriness (create refuses without bytes). No pending state. Change endpoint exists for downstream self-serve flow. Byte-work factored to shared helper — not real duplication. | ✓ |

**User's choice:** Hybrid.
**Notes:** Alice's initial lean was single-call for simplicity. Then she raised mandatoriness. My initial two-step recommendation over-indexed on avoiding duplication of the avatar-upload logic. Mid-discussion I walked it back once mandatoriness came up — the "duplication" argument for pure two-step is weak once you factor bytes-work to a shared helper. Hybrid gives real backend-enforced mandatoriness AND a change endpoint AND no messy pending state. Alice: *"if wanting them to be mandatory poses issues, then I'm willing to drop it"* — it did NOT pose issues, so mandatoriness stays.

---

## Mandatoriness enforcement — backend vs frontend

| Option | Description | Selected |
|--------|-------------|----------|
| Frontend hides submit button until avatar picked | Fragile — direct API caller can skip. Not a real guarantee. | |
| Backend refuses create without bytes | Real guarantee. Direct API callers cannot produce an avatar-less user. | ✓ |
| Pending-user state (create → upload → activate) | Real guarantee but adds pending-vs-active state to manage, orphaned-pending cleanup, list-user endpoints hiding pending. | |
| Ticket / reservation flow | Real guarantee but adds ticket concept. | |

**User's choice:** Backend refuses without bytes.
**Notes:** Combined with the hybrid endpoint decision above, this is cheap — no extra state needed.

---

## Claude's Discretion

Areas Alice deferred to me or left to the planner:

- Exact column name for the avatar pointer field on the users row.
- Exact filename convention on disk (userId+ext vs hash+ext vs other).
- Change-endpoint HTTP verb (PUT vs POST) and exact path shape.
- Whether the serve endpoint sets caching / ETag headers.
- Standard trio of accepted image formats (I named PNG/JPEG/WebP as the codebase's existing convention from `identity-avatar-batch.ts`; Alice didn't push back).
- Byte size cap (I named 5 MB matching the codebase's identity-avatar-batch convention; Alice didn't push back).

---

## Deferred Ideas

Mentioned during discussion, explicitly out of scope for this phase:

- **Frontend rendering of user avatars.** The whole reason to build this plumbing. Alice verbatim: *"they're going to start getting used in some of the front end changes that aren't part of this build."*
- **Self-serve avatar-change UI** (modal, form, drag-drop, picker). Alice verbatim: *"I know it would be tempting to add somewhere that it shows up right from the get go on the front end, and possibly UI affordances for changing avatars, but we are not going to do those things right now."*
- **Backfill for existing users.** They keep null pointers until a future mechanism gives them an avatar.
- **Image transforms** (resize, crop, thumbnails, EXIF-strip).
- **Content moderation.**
- **Cache / CDN work on the serve path** beyond Content-Type.
- **Historical avatar retention / multi-avatar.**
- **Anything touching the agent-side identity avatar system.**

---

*Full design contract lives in `.planning/shapes/shape-user-avatars.md` — this log is a compressed record of the alternatives explored during /open, before decisions were locked into CONTEXT.md.*

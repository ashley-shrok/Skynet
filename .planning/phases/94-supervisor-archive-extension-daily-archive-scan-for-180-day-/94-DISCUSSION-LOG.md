# Phase 94 Discussion Log

**Session date:** 2026-09-09
**Discussed by:** Alice + tanya (box-maintainer)
**Mode:** shape-seeded — /open pass produced `.planning/shapes/shape-supervisor-archive.md`; CONTEXT.md is a direct capture of the locked shape decisions, no re-discussion in the discuss-phase pass.

## Summary

Phase 94 skipped the discuss-phase's normal gray-area-selection + question-by-question flow because every gray area was already grilled to closure in the /open pass earlier in the same session (2026-09-09). CONTEXT.md is written directly from `shape-supervisor-archive.md`, mirroring the pattern used for Phase 92 (Shape 1 of the same id-skill-revamp campaign).

## /open pass — grill exchanges (in order)

The /open pass ran pitch → discuss → grill per skill spec. Direction was settled through the following exchanges; each is a locked decision in CONTEXT.md.

1. **Pitch** — I offered the shape I saw (daily archive-scan, three guards, three-step retire, silent) since I had context from the campaign shape file. Alice confirmed.
2. **Discussion — heartbeat signal semantics.** I initially claimed the cursor mtime only advanced on inbound messages. Alice pushed back — she'd been told "whatever file was planned to be looked at related to the relay got affected when there was any activity at all from them just running the monitor." I re-read `recv.sh` line 235 and confirmed she was right: the cursor rewrite is unconditional after CURSOR GUARD passes, so mtime advances every ~30s any session is up. That correction became the cleanness of the freshness signal — no supplementary heuristics needed.
3. **Discussion — coordinators.** I offered "no special case for coords, treat them like actors" with the reasoning that in practice coords would have `.no-dormancy`. Alice corrected: *"Coordinators are not expected to be no dormancy, that's just not a thing, and I think we should not archive coordinators."* — became D-05 with the coord marker as a third guard.
4. **Grill #1 — failure handling.** Options: abort + retry, log + continue, retry in-loop. Landed on abort + retry with move-first ordering + retire-stuck sentinel after N failures. Also flipped the campaign shape's step order (kill → deactivate → move) to move-first, because the reversed order created a nastier failure mode (dead matrix account with folder still in active tree). Locked as D-10/D-11/D-12/D-13/D-14.
5. **Grill #2 — false-positive retirement guards.** I raised: matrix deactivate is permanent per Synapse, so an in-error retire loses the account forever. Options: none, second heuristic, announce-first-retire-later, two-stage. Alice: *"unarchiving will be a concept that we get into formally later"* — collapsed the whole question. Un-archive out of scope, no guards needed. Locked as D-16.
6. **Grill #3 — announcement.** Options: silent, log-only, history entry, coord DM, Alice DM, all. Alice: *"No announcement of any kind."* Locked as D-15.
7. **Grill #4 — cadence.** Options: every 6h, once per supervisor start, daily, every tick. Landed on daily — threshold measured in days, being off by hours is invisible. Locked as D-01.
8. **Grill #5 — cursor absent (brand-new identity).** Options: fall back to folder mtime, skip, treat as stale. Landed on fall-back-to-folder-mtime — honest signal that handles the brand-new case correctly. Locked as D-07.
9. **Grill #6 — cursor mtime robustness (backup restore, cross-fs move, etc.).** Options: trust it, second signal, sanity guard. Landed on trust it — signal is clean on the current fleet; defensive complexity for problems that haven't happened. Locked as D-09.
10. **Grill #7 — code location (embed in supervisor vs separate script).** Landed on inside supervisor as a daily branch on the reconcile loop. One file, one distribution path, no drift. Locked as D-01.

## Vehicle decision

GSD phase (same treatment as Shape 1). Alice thumbs-up. Recorded as vehicle in the shape file, phase entry created via `/gsd:phase add` (initially assigned slot 93; rescue-rebased to 94 pre-commit after collision with Taylor's rescue-renumbered P93).

## Deferred ideas

All captured in CONTEXT.md `<deferred>` section:
- Un-archive path (D-16)
- User-facing archive UI in Skynet
- Configurable threshold
- Signal heuristics beyond cursor mtime
- Announcement wire for routine retirements
- Per-identity-class differentiated thresholds
- Cross-box coordination for retirement
- Guards against mtime-resetting filesystem operations

## Claude's discretion (planner-owned)

Enumerated in CONTEXT.md `<decisions>` § Claude's Discretion:
- Exact "last archive scan ran at" state persistence
- Exact retire-stuck counter form
- Handling of existing `archive/<name>/` collision (should be impossible under this shape)
- Inline vs backgrounded daily branch execution
- Test seams for guards + retire action + retry idempotency + retire-stuck sentinel

---

*Phase: 94-supervisor-archive-extension*
*Log written: 2026-09-09*

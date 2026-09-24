# Phase 135: wake-ups-redesign campaign shape 3 (UI modal) — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-23
**Phase:** 129-wake-ups-redesign-campaign-shape-3-ui-modal-skynet-front-end
**Discussion vehicle:** `/build → /open` (shape-first pipeline) — the /open session on 2026-09-23 produced the settled shape agreement at `.planning/campaigns/wake-ups-redesign/shape-wake-ups-modal.md`. Per build-skill rule ("If the vehicle is a GSD phase, seed discuss-phase from the shape file — don't re-do the discovery work /open already did"), this discuss-phase was seeded from that shape file rather than re-eliciting via AskUserQuestion.

---

## Beat 1: sizing pass (build-skill § 1 enumeration)

Enumerated the pieces of shape 3 to confirm single-shape scope (nesting guard applied — session invoked from active `wake-ups-redesign` campaign, so campaign escalation was NOT offered; if shape 3 turned out multi-shape, would have split within the existing campaign per campaign runbook).

Enumeration presented:
1. Header icon button (7th in `PrettyConversationsPanel` cluster).
2. Modal shell (Radix Dialog + glass-morphism chrome).
3. List view (filter bar + rows + footer).
4. Create/edit form (name / prompt / roles / host / schedule).
5. Delete confirmation.
6. Wire-up to shape 2's REST endpoints.

**Sizing call:** one shape. **User: thumbs-up.**

**Two amendments raised before /open:**
- Skills-picker discrepancy — shape file's form fields named a skills picker, but campaign D-04 ruled skills OUT for the modal. User: "roles not skills" — confirmed skills-picker OUT, form loses that field.
- Host picker — shape file's filter bar had role + skill but no host, and create form had no host either. Fleet-wide list needs per-item host awareness + create needs a host target. User: "we will need a host picker since wake-ups live per host" — confirmed host picker IN (dropdown in list-view filter bar + single-select mandatory in create form).

---

## Beat 2: discuss beat (build-skill § 2 discussion)

Shape file was declared at campaign concept-open (2026-09-21) with visual design tasting-settled during shape 1's /open. The discuss beat was compressed to a pitch-and-check because both parties already had context. Full shape recap presented (button placement, modal chrome, list view mechanics, create/edit form fields with skills-out + host-in folded in, behavior rules on refetch discipline + per-host philosophy). **User: thumbs-up.**

---

## Beat 3: grill beat (build-skill § 3 — 11 grill exchanges to close)

Each of the following exchanges is a Q → user's-thumbs-up-on-Claude's-proposed-answer (Q1 through Q11). All 11 answers are locked into CONTEXT.md D-XX.

### Q1: Host editability on edit-existing

| Option | Description | Selected |
|--------|-------------|----------|
| Editable (allows "move wake-up between hosts") | Modal shows host as regular field; save triggers write-then-cleanup across two hosts | |
| **Baked in at create, read-only on edit** | Delete-and-recreate on target host if the user wants to "move" | ✓ |

**User's choice:** baked in / read-only. **Rationale:** aligns with shape 1's per-host philosophy + shape 2 D-06 rejected cross-host management; showing a mutable field with no backing write is the wrong kind of wrong.
**Locked as:** CONTEXT.md D-21.

---

### Q2: Host picker scope (which hosts show)

| Option | Description | Selected |
|--------|-------------|----------|
| All fleet-managed hosts | Every host in Skynet's DB, regardless of user access | |
| **User's accessible hosts only** | Per-user-per-host access grants scope the list, matching every other Skynet surface | ✓ |

**User's choice:** user's accessible hosts only. **Rationale:** showing hosts the user can't SSH into would result in 403 on save (or worse — silent no-op). Consistency with every other user-scoped surface.
**Locked as:** CONTEXT.md D-10 + D-20 (host chip-picker scoping).

---

### Q3: Delete confirmation UX

| Option | Description | Selected |
|--------|-------------|----------|
| Native browser `confirm()` | Free, out-of-chrome | ✓ |
| Inline "click again to confirm" | Fast but easy to mis-trigger | |
| Small confirmation modal-over-modal | Chrome-fidelity but stacks dialogs | |
| Toast with undo | Modern; requires new toast surface | |

**User's choice:** *"yeah can we just do a javascript modal"* → native `window.confirm()`.
**Locked as:** CONTEXT.md D-14.

---

### Q4: Save error UX

| Option | Description | Selected |
|--------|-------------|----------|
| **Inline error banner at top of form body** | API message verbatim; fields intact; dismissible | ✓ |
| Modal-over-modal alert | Clunky; doesn't leave failing field visible | |
| Toast | No toast surface today | |

**User's choice:** inline banner at top of form body, verbatim API message, dismissible, no data loss.
**Locked as:** CONTEXT.md D-25.

---

### Q5: Loading state

| Option | Description | Selected |
|--------|-------------|----------|
| Skeleton rows | Placeholder rows with shimmer | |
| Centered spinner | Bounded, but new to Skynet chrome | |
| **Loading text like role modal** | Reuse existing pattern | ✓ |

**User's choice:** *"let's just do loading text like the role modal does"* — reuse existing pattern.
**Locked as:** CONTEXT.md D-15.

---

### Q6: Empty state

| Option | Description | Selected |
|--------|-------------|----------|
| **Centered helper line pointing at + button** | "No wake-ups on any host. Click + to create one." | ✓ |
| Fancy empty-state illustration | Marketing-block treatment | |
| Nothing (just blank) | | |

**User's choice:** centered helper line, dim, no illustration. Same treatment when filter narrows to zero ("No wake-ups match this filter.").
**Locked as:** CONTEXT.md D-16.

---

### Q7: Row click behavior

| Option | Description | Selected |
|--------|-------------|----------|
| **Click row → open edit mode** | Toggle + kebab stopPropagation to keep their clicks from bubbling | ✓ |
| Nothing (only kebab Edit opens edit) | Whole-row cursor:pointer would be misleading | |

**User's choice:** click row opens edit. Matches Skynet's conversation-list row-opens-conversation pattern.
**Locked as:** CONTEXT.md D-11.

---

### Q8: Enable toggle behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Optimistic (flip visually, revert on failure) | Feels snappier | |
| **Pessimistic (wait for API ack)** | Correct-by-construction — no visual/disk mismatch | ✓ |

**User's choice:** pessimistic. **Rationale:** durable state change writing to remote host over SSH; can't have modal showing "off" while disk says "on".
**Locked as:** CONTEXT.md D-12.

---

### Q9: Kebab menu content

| Option | Description | Selected |
|--------|-------------|----------|
| **Edit + Delete only** | Only things with shape-2 endpoints behind them | ✓ |
| Add "Fire now" (test-trigger) | Needs new shape-2 endpoint | |
| Add "Duplicate" | Already deferred at campaign concept-open | |
| Add "Copy prompt to clipboard" | Trivial but not asked-for | |

**User's choice:** Edit + Delete only. "Fire now" is a natural follow-up shape / side-bounty; others deferred.
**Locked as:** CONTEXT.md D-13.

---

### Q10: Filter state persistence

| Option | Description | Selected |
|--------|-------------|----------|
| **Reset on close** | Every open starts fresh | ✓ |
| Persist within session | Remember last filter | |
| Persist per-user (DB-backed) | Full preference | |

**User's choice:** reset on close. No URL state, no per-user persistence in v1.
**Locked as:** CONTEXT.md D-17.

---

### Q11: Mobile behavior (7th header button)

| Option | Description | Selected |
|--------|-------------|----------|
| **Accept the squeeze** | 7th button gets the same density treatment as the existing 6 | ✓ |
| Collapse some/all buttons into "More" overflow at narrow widths | Special-case shape 3 | |
| Put wake-ups button in "More" overflow always | Out of primary bar | |

**User's choice:** accept the squeeze. Responsive header consolidation is a separate cross-cutting concern.
**Locked as:** CONTEXT.md D-05.

---

### Q12: Anything else worth surfacing?

**User's choice:** *"nope we are good"* — direction settled.

---

## Vehicle decision (build-skill § ending)

| Option | Description | Selected |
|--------|-------------|----------|
| Inline | Undersizes the work | |
| Harness plan mode | Undersizes | |
| /gsd:quick | Undersizes per fleet rule (phase-sized → phase) | |
| **GSD phase** | Standard vehicle for shape-sized work | ✓ |
| Bounty | Parks it | |

**User's choice:** thumbs-up on GSD phase. Auto-proceeded to `/gsd:phase add` → `/gsd:discuss-phase` (this file's parent workflow), seeded from shape file per build-skill rule.

---

## Claude's Discretion

- **Host indicator per row.** Shape file didn't cover it (drafted pre-fleet-wide-LIST); adding it is a straightforward consequence of shape 2's fan-out. Claude's default: small chip in the metadata line alongside schedule kind + next-fire. If the user disagrees at plan-review, easy to move slot. **Locked as:** CONTEXT.md D-09.
- **Exact icon for header button** — clock/timer flavored per prototype; planner picks Lucide entry.
- **Exact modal component name** — `WakeupsModal.tsx` natural; planner confirms with sibling pattern.
- **Wave decomposition** — probably one plan; planner picks split if genuinely parallel-safe.
- **Weekly day-picker single vs multi-select** — planner reads `wakeup-scheduler.py` to see what the parser accepts, mirrors.
- **URL paths for shape 2's endpoints** — planner reads shape 2's routes files.
- **Wire-payload type reuse** — reuse `WakeupSpecWire` from claude-session-api.ts; planner picks additional wire types for LIST response.

## Deferred Ideas

See CONTEXT.md § `<deferred>` for the full list. Highlights:
- "Fire now" test-trigger button (needs new shape-2 endpoint; natural follow-up bounty).
- Duplicate-and-edit affordance (deferred at campaign concept-open).
- History-of-past-fires view (needs history data).
- Session-persistent filter state (v2 if usage warrants).
- Skills picker (per campaign D-04; may revisit).
- Templates library.
- Responsive header consolidation for mobile.
- Toast surface (Skynet has none).
- Deep-link / URL state.

---

*This log records the /open + /gsd:discuss-phase merge. The shape file at `.planning/campaigns/wake-ups-redesign/shape-wake-ups-modal.md` is the authoritative agreement; CONTEXT.md is the downstream-agent-facing decision list; this log is the audit trail.*

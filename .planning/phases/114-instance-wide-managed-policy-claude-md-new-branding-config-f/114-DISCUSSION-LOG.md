# Phase 114: Instance-wide managed-policy CLAUDE.md — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-17
**Phase:** 112-instance-wide-managed-policy-claude-md
**Session type:** Seeded from `/build` → `/open` shape session. No interactive AskUserQuestion pass — per fleet build rule ("seed discuss-phase from the shape file"), CONTEXT.md was generated from the shape file's locked decisions.

**Areas discussed** (during the preceding `/open` grill, before this phase existed):
- Mechanism (native vs. built) — verified pre-shaping
- Storage on the Skynet server (host-side branding dir vs. repo path vs. new volume)
- Editing surface (SSH-and-file-edit vs. admin UI)
- Propagation timing (immediate vs. next sweep)
- Content shape (free-form prose vs. structured scalars)

---

## Mechanism — build vs. use existing

| Option | Description | Selected |
|--------|-------------|----------|
| Build our own tier | Custom loader + custom on-disk convention + wire it into id-skill body | |
| Use Claude Code's native managed-policy CLAUDE.md tier | System-level path Claude Code loads natively at every session start, above the user file | ✓ |
| Use Claude Code's `claudeMd` key in managed-settings.json | Inline instruction content in the settings JSON blob | |
| Use Claude Code's `@import` mechanism | Import directive inside a managed CLAUDE.md pulling from another path | |

**User's choice:** Native managed-policy CLAUDE.md tier.
**Notes:** Verified empirically before commitment — PASS on t1000 (subscription OAuth), T800 (subscription OAuth), test08 (Bedrock via IAM instance profile). Primary-source-confirmed via `code.claude.com/docs/en/memory`. `claudeMd` key rejected as awkward (multi-line markdown escaping in JSON). `@import` rejected because it's a feature we might USE inside the file later, not a distribution mechanism.

## Storage of the twinkie on the Skynet server

| Option | Description | Selected |
|--------|-------------|----------|
| Baked into each fork's repo | `substrate/instance/CLAUDE.md` in the Skynet repo, per-fork content | |
| Per-instance server state via admin surface | Crown-jewel volume holds it; admin UI edits | |
| Host-side branding folder | Alongside icons in `/opt/skynet/branding/`, filename referenced from branding config | ✓ |

**User's choice:** Host-side branding folder — same pattern icons already use.
**Notes:** Chosen because the branding-assets pattern already handles per-instance separation (each Skynet server has its own local branding dir; fork pulls don't stomp it). Solves the "Aither pulls from the user's repo but shouldn't inherit the user's twinkie" problem for free.

## Editing surface

| Option | Description | Selected |
|--------|-------------|----------|
| SSH-and-file-edit | Admin SSHes into server, edits the file with $EDITOR | ✓ |
| Admin UI textarea | Build a form field in the Skynet UI | |

**User's choice:** SSH-and-file-edit — no admin UI.
**Notes:** User verbatim: *"I've been putting off the admin interface for a while now and so I think I'm gonna just stick with no interface."* Matches branding's current stance across all fields.

## Propagation timing

| Option | Description | Selected |
|--------|-------------|----------|
| Immediate | Manual "push now" affordance available; edit hits managed hosts within seconds | |
| Next scheduled distributor sweep | Existing sweep cadence carries the change | ✓ |

**User's choice:** Next sweep.
**Notes:** User verbatim: *"next sweep."* No new trigger, no manual push button.

## Content shape

| Option | Description | Selected |
|--------|-------------|----------|
| Structured scalars | Branding config fields for `companyName`, `companyType`, etc. | |
| Free-form markdown blob (twinkie) | Single markdown file; admin authors whatever they want | ✓ |

**User's choice:** Free-form twinkie.
**Notes:** User verbatim: *"everybody puts whatever they want in their twinkies."*

## Vehicle

| Option | Description | Selected |
|--------|-------------|----------|
| Inline | Do it in the current session | |
| Plan mode | Single-shot planned change | |
| `/gsd:quick` | Single quick task with GSD guarantees | |
| GSD phase | Full pipeline: discuss → plan → execute → verify → ship | ✓ |
| Bounty | Park for later | |

**User's choice:** GSD phase.
**Notes:** Scope justifies a full phase — branding config schema change, config loader update, catalog schema extension, first-of-kind root-write plumbing on managed hosts, tests across all of it. Quick would risk mid-execution scope surprise with no plan to catch it.

---

## Claude's Discretion

Items surfaced in CONTEXT.md as planner-decidable (short list):
- Exact field name on `BrandingConfig` (D-02) — user has no strong opinion.
- Precise shape of the `CatalogEntry` extension for the two new axes (`sourceKind` / `installMode`) — D-12; discriminated union vs. optional flags.
- Whether `readInstancePolicyBytes()` is a new export on the branding loader or a small dedicated module.
- Whether to update file-level docstrings (catalog.ts row-count reconciliation, branding-loader header) to reflect the new field — recommend yes.

## Open Questions for Researcher

Surfaced in CONTEXT.md § Open Questions (not scope creep — genuinely unresolved technical decisions):
- **Q1**: Elevation strategy for root-write on managed hosts (assume-root-SSH vs. NOPASSWD sudoers carve-out vs. per-catalog-row elevation). Depends on the current SSH-user distribution across the fleet; researcher checks `~/fleet/roles/box-maintainer/box-map.md` for current state.
- **Q2**: Removal semantics — when the admin clears the field, should the sweep issue an `rm -f` on managed hosts (clean unset), leave stale bytes in place (sticky), or push a zero-byte file (empty marker)?
- **Q3**: First-boot ordering — should Skynet-server startup surface a loud log if the branding field is set but the referenced file is missing (misconfiguration alarm), or leave it silent for the sweep log to catch?

## Deferred Ideas

Explicitly scope-edged out of Phase 114 by the shape file; captured here so they don't get lost:
- Admin UI editor for the twinkie — deferred to whenever a broader Skynet admin surface returns.
- Per-role or per-agent instruction overrides layered on top of the instance-wide tier — future phase if it becomes a live need.
- Delivery via the `claudeMd` key in Claude Code's managed-settings.json — fallback only if the standalone-file mechanism ever fails us.
- Manual "push now" trigger — not built; ops runs the sweep on its own cadence.
- Templating or variable substitution in twinkie content — deliberately not supported; if per-instance content ever needs variables, that's a different problem.
- Per-host variance within a single Skynet instance — deferred; not on the roadmap.

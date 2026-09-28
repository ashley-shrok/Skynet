# Phase 138 Discussion Log

**Date:** 2026-09-27
**Mode:** Skipped standard discuss-phase — CONTEXT.md seeded directly from shape file per `/build` guidance.

## Context

Design was settled during the `/open interactive-messages` session (see `.planning/shapes/shape-interactive-messages.md`). That session covered:

- What interactive messages are (widget-in-bubble message type)
- Where widgets live (agent's host, reusing full-app machinery, own folder root)
- The new skill (opinionated common shapes: poll, checklist, form, list-actions, ranking, color picker + custom-widget authoring)
- Three-mode taxonomy (terminal-on-click / terminal-on-submit / non-terminal), agent-chosen per widget, per-template curated mode sets
- Anchor-URL trigger + server-provided allowlist type discriminator
- Invisible-submit-message via existing blacklist mechanism
- Local-filesystem state reads
- Multi-widget-per-message
- Lifecycle: agent-driven teardown + seven-day backstop
- Mobile as first-class
- Multi-phase arc (this phase = plumbing + first template, subsequent phases = more templates/modes, lifecycle, custom-widget authoring)

Full detail lives in the shape file, which is CONTEXT.md for this phase.

## Deferred to research/planning

- Exact mechanism for extending the existing URL-detection allowlist with a type discriminator (add a per-URL type field vs. parallel typed lists — researcher inspects existing code)
- Exact mechanism for hooking the iframe-emitted signal into the existing invisible-message blacklist (researcher inspects existing blacklist plumbing)
- Retry-on-load-fail parameters (lean: 3 retries over ~5 seconds, planner to confirm against existing iframe retry idioms if any)
- Exact schema of widget descriptor file (small; planner locks)
- First template (poll) concrete implementation shape (vanilla JS in durable-service shape vs. lighter — planner picks based on existing full-app template conventions)

No user-facing decisions remained after the shape session; user greenlit skipping further discussion via `/build` inline recommendation.

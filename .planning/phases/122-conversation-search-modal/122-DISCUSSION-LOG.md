# Phase 122: Conversation search modal - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-20
**Phase:** 122-conversation-search-modal
**Areas discussed:** search trigger, include-archived toggle, corpus + data source, click behavior on archived results, modal state persistence, sort order, page size, case sensitivity, keyboard shortcut, sidebar filter removal

---

> **Discussion source:** interactive `/open` session with the user before phase creation, not the standard interactive `discuss-phase` flow. All decisions below were surfaced and settled during that session. The resulting shape file (`.planning/shapes/shape-conversation-search-modal.md`) was the artifact that seeded 122-CONTEXT.md. This log preserves the alternatives-considered for audit; it is condensed from the /open transcript, not a verbatim reproduction.

---

## Shape framing (biggest reframe)

Original starting point was "a client archive section" — presumably a collapsed section at the bottom of the sidebar that expands on click to load archived rows. User (Ashley) reframed to "kill the archive section entirely; replace with a proper search modal that happens to include archived." Rationale: nobody browses the archive; when you go there you know what you're looking for. And the existing sidebar filter-as-you-type is weak anyway — one shape can solve both problems.

**Selected:** search modal replaces both sidebar filter AND fills the archive-access role.

---

## Include-archived toggle

| Option | Description | Selected |
|--------|-------------|----------|
| Always search all (no toggle) | Modal searches active + archived together, no user choice | ✓ |
| Include-archived checkbox | User opts in to include archived per query | |
| Segmented control (active/archived/all) | Three explicit modes | |

**User's choice:** Always search all. **Notes:** "If you're looking for something you care more about finding it regardless of where it's at."

---

## Search trigger

| Option | Description | Selected |
|--------|-------------|----------|
| Fire on Enter | User commits query with Enter key; spinner while grep runs | ✓ |
| Debounced (250-500ms) | Query fires after typing pauses | |
| Fire on every keystroke | Instant results but hammers hosts | |

**User's choice:** Fire on Enter. **Notes:** Cross-host grep isn't free; modal search is intentional. Confirmed via a quick timing test showing ~600ms wall time for the full corpus grep on t1000.

---

## Modal close on result-click

| Option | Description | Selected |
|--------|-------------|----------|
| Modal closes on select | Jump-and-close | ✓ |
| Modal stays open | Browse-mode you dwell in | |

**User's choice:** Modal closes on active-result select (archived-result click keeps modal open per D-15). **Notes:** User initially said "mode" — clarified as voice-to-text confusion for "modal"; jump-and-close is the intent.

---

## Modal state persistence between opens

| Option | Description | Selected |
|--------|-------------|----------|
| Remember query + results | Reopen shows last query and accumulated results | ✓ |
| Reset on every open | Fresh state each time | |

**User's choice:** Remember. **Notes:** Common workflow "search → wrong click → come back → try another" would suffer with reset.

---

## Click behavior on archived results

| Option | Description | Selected |
|--------|-------------|----------|
| Dimmed style + silent no-op | No cursor pointer, no hover, click does nothing | |
| Browser alert "coming soon" | JS `alert()` message | ✓ |
| Info modal with explanation | More formal dialog | |
| Normal-looking + archived pill + info panel on click | Full custom affordance | |

**User's choice:** Browser alert "coming soon". **Notes:** Chose the simplest honest signal. Unarchiving is out of scope for this phase; the alert is deliberately blunt to avoid soft misdirection.

---

## Corpus + data source

User proposed: for each identity in `~/fleet/identities/` (active) AND `~/fleet/identities-archive/` (archived), on each host, find the LATEST transcript file and grep it. Reuse the existing identity → latest-transcript mapping code (already used in the pretty-view open-conversation flow) rather than reinventing.

**Selected:** latest-transcript-per-identity, both active + archived dirs, cross-host aggregation. Prior art in pretty-view.

---

## Snippets in results

**Selected:** yes to snippets with highlighting. User said "if snippets are easy to show then that's fine because I think it is helpful when you're trying to pick which conversation was the one you were looking for."

---

## Sort order

| Option | Description | Selected |
|--------|-------------|----------|
| Recency-first | Most recent conversation at top | ✓ |
| Relevance-first | Query density / match count as ranking | |

**User's choice:** Recency-first for v1. **Notes:** Matches the sidebar's mental model; relevance sort deferred.

---

## Page size + load-more mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Numbered pagination (1, 2, 3...) | Search-engine SERP style | |
| Load-more button at bottom | Click to reveal next batch (offset/limit re-query) | ✓ |
| Infinite scroll | Auto-load on scroll | |

**User's choice:** Load-more button. Batch size 20 per fetch. **Notes:** Server re-runs the same query with next offset. Simple; matches the modal's "find and jump" tool feel over search-engine SERP.

---

## Case sensitivity

| Option | Description | Selected |
|--------|-------------|----------|
| Case-insensitive | Universal convention | ✓ |
| Literal case-sensitive | Match exactly | |

**User's choice:** Case-insensitive.

---

## Keyboard shortcut to open modal

| Option | Description | Selected |
|--------|-------------|----------|
| No shortcut | Button-click only | ✓ |
| cmd-K / ctrl-K | Universal search convention | |

**User's choice:** No shortcut. **Notes:** Search isn't the primary sidebar interaction; a button is enough.

---

## Claude's Discretion

- Exact endpoint URL and field names.
- Frontend modal architecture (component hierarchy, state management approach).
- Snippet extraction algorithm (chars around hit, hits per result, highlight rendering).
- Server-side grep implementation choice (spawn `grep`, Node fs streams, ripgrep, etc.).
- Cross-host fan-out mechanism — must reuse existing codebase pattern; specifics up to planner.

## Deferred Ideas

- Unarchiving (whole separate design + phase).
- Keyboard shortcut to open the modal.
- Fuzzy matching.
- Relevance-ranked sort.
- Per-field search (title-only, body-only).
- Regex query support.
- Search history dropdown.
- Include-archived / exclude-archived toggle.
- Numbered page controls.
- Index-based search (inverted index at write time).
- "Recently archived" panel.
- Read-only opening of archived results.

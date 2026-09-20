# Phase 122: Conversation search modal - Context

**Gathered:** 2026-09-20
**Status:** Ready for planning

> **Note:** This CONTEXT.md was seeded from `/open`'s shape file at
> `.planning/shapes/shape-conversation-search-modal.md` — the discovery work
> was done in-session with the user before phase creation. The shape file is
> the load-bearing source; this CONTEXT.md restructures its content into the
> standard downstream-agent format. Both files should stay in sync if either
> is updated.

<domain>
## Phase Boundary

**What this delivers:** replace the sidebar's inline filter-as-you-type input with a proper search modal that content-searches conversations across the fleet, subsuming the "how do users find archived conversations" problem in the process. Both active AND archived conversations are searched by content-searching the LATEST transcript per identity, across every host in the fleet.

**Two problems solved by one shape:**
1. The existing filter-as-you-type input in the sidebar is weak — only searches what's already loaded (active), and doesn't scale as the list grows.
2. Archived conversations accumulate unbounded with no client UI to browse or find them. A dedicated "archive section" was rejected in favor of "search finds everything."

**What ships in this phase, at a glance:**
- A magnifying-glass button in the sidebar header (next to existing header buttons)
- A modal with a search input, results area, and load-more button
- A backend content-search endpoint that fans out across managed hosts
- Removal of the existing sidebar filter-as-you-type input

</domain>

<decisions>
## Implementation Decisions

### Search trigger + input behavior
- **D-01:** Search fires on Enter key, NOT on keystroke. Content-grep across many hosts is not free; keystroke-firing would hammer hosts.
- **D-02:** Query is case-insensitive plain substring. No regex, no fuzzy matching, no per-field search (title-only vs body-only). All deferred.
- **D-03:** No keyboard shortcut to open the modal (e.g. no cmd-K). Button-click only. Search isn't the primary sidebar interaction.

### Modal lifecycle + state
- **D-04:** Clicking a result closes the modal (jump-and-close pattern). Exception: archived-result click keeps the modal open (see D-11).
- **D-05:** Modal REMEMBERS its state across opens — the last query AND accumulated results are still there when the user reopens. This is not polish; it's a workflow-enabler for "search → wrong click → come back → try another." A fresh workspace on every open would make the modal feel like a fresh tool every time instead of a place you leave and return to.
- **D-06:** Empty state is shown only on first-ever open or after the user clears the input.

### Corpus construction
- **D-07:** Search corpus is the **latest transcript file per identity**, aggregated across ALL hosts in the fleet.
- **D-08:** Enumeration on each host walks BOTH the active identities directory (`~/fleet/identities/`) AND the archived identities directory (`~/fleet/identities-archive/`).
- **D-09:** The mapping "identity → latest transcript file" should reuse the existing code path that the pretty-view open-conversation flow uses today (do not reinvent).

### Results + sort + pagination
- **D-10:** Results sort recency-first (most recent conversation at top). Relevance/ranking is deferred.
- **D-11:** Each result row shows: conversation title, identity + host, and a highlighted snippet of the matching text (so the user can see WHY it hit).
- **D-12:** Pagination is offset/limit — 20 results per fetch. First fetch is 0-19; "Load more" button at the bottom fires a second server call for 20-39; and so on. Load-more RE-runs the same query with the next offset (server does the grep again). No numbered page controls.
- **D-13:** Total wall time for a naive grep across the latest transcript per identity on t1000 (157 identities, ~1GB total) is ~600ms — sub-second regardless of query specificity. Not a bottleneck at current corpus size. Grep streams so memory is not a concern even on the 4GB Graviton target minimum. Index-based search (inverted index at write time) is deferred to a future phase if corpus grows an order of magnitude.

### Click behavior
- **D-14:** Clicking an ACTIVE result: opens the conversation (via the existing open-conversation flow), modal closes.
- **D-15:** Clicking an ARCHIVED result: shows a browser alert ("coming soon" / "opening archived conversations isn't wired up yet"). Modal stays open. Archived conversations have no viewing machinery on the client today; the alert is deliberately blunt — no soft misdirection.
- **D-16:** Unarchiving does NOT ship in this phase. It's a whole separate design conversation and shape. Archived results are visible in search but currently non-openable — visibility alone is useful ("yes it still exists, on host X").

### Sidebar filter removal
- **D-17:** The existing filter-as-you-type input at the top of the sidebar is REMOVED as part of this same phase. The modal replaces it, not supplements it.
- **D-18:** **Ordering constraint:** the removal must NOT land before the modal is usable. A window where neither exists is a regression. Executor should either land both together or land modal first, remove filter second — never remove-first.

### Cross-host fan-out mechanism
- **D-19:** Cross-host fan-out is implementation detail, not a shape-level decision. Prefer whatever cross-host aggregation pattern the codebase already uses (fleet-status-client fan-out, host-API-key auth, etc.). Do NOT invent a new pattern for this feature.

### Claude's Discretion
- Exact endpoint URL and field names — planning decides.
- Frontend modal architecture (component hierarchy, state management approach) — planning decides.
- Snippet extraction algorithm (how many chars around the hit, how many hits per result, how to render highlighting) — planning decides, with the constraint that snippet + highlight is IN SCOPE.
- Server-side implementation language of the grep (spawn `grep`, use Node fs streams + regex, ripgrep, etc.) — planning decides. Current sub-second measurement was naive `grep`; any equally-fast approach is fine.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape / decision source (this phase)
- `.planning/shapes/shape-conversation-search-modal.md` — the /open shape file. Source of truth for what/why. This CONTEXT.md restructures it; if there's ever a conflict, the shape file wins on intent and this CONTEXT.md wins on downstream-agent format.

### Related surfaces to reuse (not modify)
- Existing sidebar conversation list — `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (~3.3k lines, the panel + filter-as-you-type input)
- Existing archived-rows slice — `src/ui/state/conversation-store.ts` (`archivedFleetRows`, fed by `identity-archived` wire messages via fleet-status-client)
- Existing conversation-open flow (pretty-view side) — the code path that resolves identity → latest transcript when opening a conversation is the load-bearing prior art for D-09
- Fleet-status-client cross-host pattern — for D-19 fan-out reference

[No external ADRs. All architectural decisions for this feature captured above.]

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Identity → latest transcript resolver** (existing, unknown exact location — researcher to identify): pretty-view already resolves the "latest transcript file for this identity on this host" mapping. Search's per-identity corpus lookup should call the same code, not fork.
- **Fleet-status-client** (`src/ui/api/fleet-status-client.ts` / `src/backend/fleet-status/...`): established cross-host wire pattern. If the search endpoint fans out from the local backend to peers, this is the pattern to mirror.
- **Sidebar header** (part of `PrettyConversationsPanel.tsx` chrome): already hosts existing buttons. New magnifying-glass button lands here.
- **Archived state slice** (`archivedFleetRows` in `conversation-store.ts`): tells the client which conversations are archived — search results need to know this to render the archived pill AND to trigger the "coming soon" alert on click.

### Established Patterns
- **Two-tier data model**: localStorage-seeded stores + WS-live updates (see identities-appearance-cache, projects cache, pinned-ids cache — all recently added). Search results are transient (in-memory only, tab-lifetime) — no localStorage persistence.
- **useSyncExternalStore for module-scoped stores**: modal state (query + accumulated results) fits this pattern for a search-store slice, if the modal's state needs to survive component unmount (D-05 says it does).
- **Modal composition**: the codebase already has modals (NewConversationModal, IdentityModal, etc.). Reuse the modal chrome pattern; don't build a new modal system.

### Integration Points
- Sidebar header: new button lands here alongside existing buttons.
- Sidebar filter input: removed here (D-17).
- Fleet-status-client / backend cross-host RPC layer: new search endpoint plugs in here.
- On-host identity + transcript enumeration: new backend code walks `~/fleet/identities/` + `~/fleet/identities-archive/` and calls the existing identity→transcript resolver.
- Frontend click handler: routes based on `isArchived` — active → existing open-conversation flow; archived → `alert()`.

</code_context>

<specifics>
## Specific Ideas

- **The alert content on archived-result click:** deliberately blunt — a plain browser `alert()` with wording like "coming soon" is fine. No soft misdirection or fancy dialog. The point is honest feedback that the interaction is a dead end today.
- **Snippet highlighting:** the matched text should be visually highlighted within the snippet (bold, background color, or similar). Not just returning the text with no visual cue.
- **Ashley tasted the grep speed during /open** — 5ms per file, ~600ms wall time for 157 identities on t1000. This gives the shape confidence that naive grep is fine at current scale; it's not a premature-optimization guess.

</specifics>

<deferred>
## Deferred Ideas

These came up during /open discussion and were explicitly ruled out of THIS phase. Preserve for future roadmap consideration.

- **Unarchiving.** The ability to bring an archived conversation back. Whole separate design conversation — how does it interact with existing sessions, what happens to the transcript, does the identity re-enter the active pool. Needs its own shape and phase.
- **Keyboard shortcut to open the modal** (e.g. cmd-K / ctrl-K). Skipped in v1 because "search isn't the primary sidebar interaction."
- **Fuzzy matching.** Plain substring only in v1.
- **Relevance-ranked sort** (query density, match count as ranking factors). Recency-first in v1.
- **Per-field search** (title-only, body-only, participant-only). Everything is body-grep in v1.
- **Regex query support.** Plain substring only in v1.
- **Search history** (recent queries dropdown). Modal state persistence covers the "last query" case; broader history is deferred.
- **"Search only archived" or "search only active" toggle.** Explicitly rejected — always search all. Revisit only if a real user need appears.
- **Numbered page controls / page counters.** Load-more button is the primitive; numbered pages make it feel like a search-engine SERP.
- **Index-based search** (inverted index built at write time). Naive grep is sufficient at current corpus size. Revisit if corpus grows 10x.
- **A dedicated "recently archived" panel next to search.** Would reintroduce the browse-the-archive model the shape is explicitly killing.
- **"Read-only" opening of archived results.** Starts the unarchiving design conversation, which is out of scope.

</deferred>

---

*Phase: 122-conversation-search-modal*
*Context gathered: 2026-09-20*

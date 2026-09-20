# Shape: Search modal that subsumes archive access

**Opened:** 2026-09-20
**Vehicle:** GSD phase

## What this is

The sidebar has a filter-as-you-type input at the top for finding conversations. It's weak — it only sees what's already loaded, and the filter model doesn't scale as the list grows. Meanwhile, archived conversations pile up unbounded and there's no client-side way to browse or find them at all. This shape solves both problems with one thing: replace the inline filter with a proper search modal, triggered by a magnifying-glass button in the sidebar header. The modal searches across ALL conversations — active AND archived — by content-searching the latest transcript per identity, across every host in the fleet.

## Shape

- A magnifying-glass button in the sidebar's header, next to the existing header buttons.
- A modal that opens on click. Modal has a search input, a results area, and a "load more" button at the bottom of the results.
- User types a query, presses Enter. Modal shows a spinner while the search runs.
- The search runs on the backend and fans out across every managed host in the fleet.
- On each host, enumeration walks both the active identities directory AND the archived identities directory.
- For each identity, the latest transcript file is identified. That single file is the search corpus for that identity.
- Content search runs across those transcripts for the query (case-insensitive plain substring).
- Results are aggregated across hosts, sorted by recency (most recent conversation first), and returned as a batch (offset/limit style — first 20).
- Each result row shows: the conversation title, its identity and host, and a highlighted snippet of the matching text so the user can tell WHY it hit.
- User clicks a result:
  - If the conversation is active: the conversation opens, modal closes.
  - If the conversation is archived: a browser alert says "coming soon" (archived conversations don't yet have viewing machinery). Modal stays open.
- Load-more: server re-runs the same query and returns results 21-40 (offset/limit continuation). Appended to the existing results in the modal.
- Modal state persists across opens: closing and reopening shows the last query and the accumulated results. Empty state is only shown on first-ever open or after clearing the input.
- The existing inline filter-as-you-type input at the top of the sidebar is removed as part of this same shape.

## Philosophy

- **Search is the browse mechanism for the archive.** There's deliberately NO archive section that lists items to scroll through. If you're going to the archive, you know what you're looking for.
- **One search box covers everything.** No "search only archived" or "search only active" toggle — clutter without earned value. If the search is any good, the user's query narrows the answer.
- **Search is intentional, so it fires on Enter, not on keystroke.** Content search across many hosts isn't cheap; keystroke-firing would hammer the hosts.
- **Modal state persists** because "I clicked the wrong result, let me try another" is a real workflow. Losing the query on every close would make the modal feel like a fresh tool every time instead of a workspace you leave and return to.
- **Archived results are visible even though they can't be opened yet.** Seeing that a conversation still exists (and where it lives) is useful even without an unarchive path. The "coming soon" alert is deliberately blunt — no soft misdirection about what will happen.
- **No keyboard shortcut.** Search isn't the primary sidebar interaction; a button is enough.
- **Unarchiving is deliberately out.** That's its own conversation and deserves its own shape.

## Prior context

- The sidebar's current filter-as-you-type input finds only what's already loaded (active conversations). Ashley considers it weak and wants better.
- Archived conversations currently accumulate in an in-memory slice fed by wire messages, but there's no client UI that displays them. They exist but are hidden.
- Archiving already exists as a server-side concept and is not going to change in this shape.
- Unarchiving does not exist as a feature yet. Archived conversations are, by design, currently unopenable — the client machinery to view them is missing entirely.
- On the box the search runs on (t1000, 157 identities, ~1GB of transcripts), a naive content search across the latest transcript per identity takes ~600ms wall time, sub-second regardless of query specificity. At the target minimum host size (4GB Graviton) this is still expected to fit comfortably — grep streams, so memory is not a concern, and CPU is trivial. Room to scale via a smarter implementation later; not a bottleneck at current corpus size.
- Existing code paths already resolve identity → latest transcript when opening a conversation in the main view. The search feature should mirror or reuse that mapping strategy rather than reinvent it.

## What would make it wrong

- If clicking an archived result silently does nothing, the modal reads as broken. The "coming soon" alert isn't a nicety — it's the affordance that keeps the interaction honest.
- If the search fires on every keystroke, it hammers hosts. Enter-triggered is load-bearing.
- If archived results are hidden from the search, the search doesn't solve the "manage growing archive" problem — it just moves the sidebar's weak filter into a modal.
- If the modal resets on every open, common workflows (search → wrong click → come back → try another) become friction. Modal state persistence is not polish — it's the workflow-enabler.
- If pagination requires numbered page controls, the modal starts to feel like a search-engine results page rather than a "find and jump" tool. Load-more is the right primitive.
- If snippets aren't shown, content search feels like a slower title search — the user has to open results to figure out why they hit. Snippet + highlight is what makes content search feel like content search.
- If the corpus enumeration misses the archived identities directory, the whole point of the shape is defeated.

## Scope edges

**In:**
- Magnifying-glass button in the sidebar header.
- Modal with search input, results area, load-more button.
- Backend content-search endpoint that fans out across hosts, enumerates active + archived identities, greps the latest transcript per identity, returns aggregated results with snippets.
- Snippets in results, with the matched text highlighted.
- Recency-first sort (most recent conversation first).
- Case-insensitive plain-substring query.
- Offset/limit pagination — 20 results per fetch, load-more re-queries with next offset.
- Modal state persistence across opens (query + accumulated results).
- Click-active-result opens the conversation and closes the modal.
- Click-archived-result shows a "coming soon" browser alert; modal stays open.
- Removal of the existing sidebar filter-as-you-type input.

**Out — deferred:**
- Unarchiving. Whole separate conversation and shape.
- Keyboard shortcut to open the modal.
- Fuzzy matching, ranked-by-relevance sort, per-field search (title-only vs body-only), regex support.
- Search history.
- "Search only archived" or "search only active" toggle.
- Numbered page controls / page counters.
- Index-based search (inverted index built at write time). Naive grep is sufficient at current corpus size; revisit if the corpus grows an order of magnitude.

**Tempting but no:**
- Auto-firing search after debounce. Feels responsive but hammers hosts and encourages half-formed queries.
- A dedicated "recently archived" panel next to search. Reintroduces the browse-the-archive model the shape is explicitly killing.
- Opening an archived result "in read-only mode." Sounds close but is the beginning of the whole unarchiving design conversation, which is out of scope.

## Vehicle notes

- GSD phase — this crosses backend (new content-search endpoint, cross-host fan-out, identity + transcript enumeration on each host) and frontend (new modal component, new header button, click handling, sidebar filter removal, tests both sides). Too broad for `/gsd:quick`, too integrated for inline.
- **Prior art to reuse:** the existing pretty-view open-conversation path already resolves identity → latest transcript on a host. Search's per-identity transcript lookup should share that mapping code, not fork.
- **Suggested endpoint contract** (implementation guidance, not shape-binding): offset/limit-style, one call per fetch (initial + each load-more), returns `{ results: [{title, identity, host, snippet, isArchived, id}, ...], hasMore: bool }`. Actual field names get pinned in planning.
- **Cross-host fan-out mechanism** is implementation, not shape. Prefer whatever cross-host aggregation pattern the codebase already uses; don't invent a new one for this feature.
- **Ordering constraint:** the "remove the existing filter-as-you-type input" work should land together with the modal being usable, not before. A window where neither exists is a regression.
- **Handoff to planning:** this shape file should seed `/gsd:discuss-phase` CONTEXT.md rather than re-eliciting the same decisions. All the "why + what + constraints + scope edges" needed are here.

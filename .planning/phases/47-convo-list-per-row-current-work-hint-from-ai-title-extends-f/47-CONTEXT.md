# Phase 47: Convo-list per-row current-work hint from ai-title

**Gathered:** 2026-08-19
**Status:** Ready for planning
**Source:** Design LOCKED via extended interactive tasting session between Ashley and tanya on 2026-08-19 (no separate `/gsd:discuss-phase` run — decisions captured inline via prototype.html 21 variants, ring-patterns.html 18 spinner variants, live-app v14-console-snippet.js taste on the running Skynet PWA, and back-and-forth iteration). Design artifact + tasting files at `~/.claude/roles/box-maintainer/bounties/convo-list-current-work-hint/`.

<domain>
## Phase Boundary

**In scope:**
- **Wire type surface** (fleet-session shape returned by `/sessions/list` + published on fleet-status WS): add optional `aiTitle: string | null` alongside the existing `lastMessageAt` (Phase 44's extension). Mirror shape/optionality treatment.
- **Backend JSONL scraper** for latest ai-title per session — mirrors the `discoverIdentitySessionFile` + `tail`-scan flow Phase 44 established. Reads the tail of each discovered JSONL for the LAST `{"type":"ai-title","aiTitle":"…","sessionId":"…"}` line and returns its `aiTitle` string. Cheap tail-read (last ~256KB); a session with no ai-title returns null.
- **`/sessions/list` route extension** (`src/backend/database/routes/sessions.ts`) — emit `aiTitle` per session row inline, dispatched in parallel with the existing per-session discovery work (same `Promise.all(rows.map(...))` pattern Phase 44 used for `lastMessageAt`). Additive optional field.
- **Fleet-status WS publish path** — emit `aiTitle` alongside `lastMessageAt` in `SessionState`. Publishing cadence unchanged; new field is null when unknown, string when discovered.
- **`session-working-store.ts`** — add third axis alongside `isWorking` and `lastMessageAt`: `aiTitle: string | null`. New public API `seedSessionAiTitle(hostId, tmuxSession, title)` + `advanceSessionAiTitle(key, title)` chokepoint (mirror shape of Phase 44's `seedSessionLastMessageAt` / `advanceSessionLastMessageAt`). Reconciliation rule: **last-wins** (newer value replaces older) since ai-titles evolve over the course of a session as the topic drifts — this is opposite to `lastMessageAt` which is max-wins. Publishing cadence: only notify when the value actually changed.
- **AppShell seed wire consumer** — the existing `/sessions/list` handler that already seeds `lastMessageAt` per session row also seeds `aiTitle`. Same call site, same iteration, add the second seed call.
- **Cache-key bump** — `FleetSession` interface v2 → v3 (v1 was pre-Phase-44, v2 added `lastMessageAt`, v3 adds `aiTitle`). Client-side cache invalidates any v2-cached payloads on load.
- **`PrettyConversationRow.tsx`** redesign per v14 locked shape (see § Locked design under decisions). Retires the `.pv-meta` right column entirely (its content is now on the avatar corners); switches idle affordance to a WORKING affordance; adds ai-title as fade-truncated subtitle; hostname migrates to parens on title line.
- **`PrettyBountyCountBadge.tsx`** — REFACTOR-BY-RELOCATION only. The V12 notification-badge style shipped in patch #468 (commit c33b5ff8) is reused verbatim; the two wraps (Pin + Monitor) are relocated from `.pv-meta` right-column to absolute-positioned avatar corners (Pin bottom-left, Monitor bottom-right). CSS classes `.pv-bounty-badge-wrap`, `.pv-bounty-badge-icon`, `.pv-bounty-badge-num` unchanged in styling; only their positioning context changes. Component's own JSX likely stays the same — positioning happens via new avatar-corner slot markup in `PrettyConversationRow.tsx` that renders the badge inside `.pv-avatar`.
- **`pretty-conversations.css`** — kill `.pv-meta` slot's ready-dot rules (idle-dot retiring); add avatar-relative positioning for the two badge wraps at bottom corners; add `.pv-avatar::before` (or equivalent) for the working spinner ring using the p05-slow-dashed pattern (see § Locked design); add mask-image right-edge fade to `.pv-label` and `.pv-host` for fade-truncation instead of ellipsis; adjust padding/heights to accommodate corner overflow of the badge pills.
- **Test coverage** for wire parse (aiTitle in `/sessions/list` and fleet-status frame), backend scraper (empty case, valid case, malformed line case), working-store aiTitle seed/publish/replace/no-op, `PrettyConversationRow` render for all state combos (idle, working, both counts, one count, no counts, no ai-title, active-set vs ambient), `PrettyBountyCountBadge` remains passing after relocation.

**Out of scope:**
- No changes to how `isWorking`/`isRecycling`/`hasQueuePending` are computed — the working spinner uses the EXISTING inputs, just inverted (Ashley 2026-08-19 verbatim: *"make the spinner work on the same logic as the idle indicator, except you invert it as the final step of logic there."*). Do NOT widen the state check — that would reintroduce the Phase 39 ambient-monitor gap where every session got permanently marked working. Ashley accepted the tradeoff verbatim: *"and that is fine for now."*
- No new UI for surfacing ai-title elsewhere in the app (not in header, not in pretty-view, not in modal chrome). Row-level display only.
- No cross-identity aggregation, filtering, sorting by ai-title.
- No harness-level modifications — the `{"type":"ai-title"}` line is written by Claude Code itself; we only consume it as a read-only source.
- No LLM call on our side for summarization — the ai-title IS the summary, produced by the harness for free. This was explicitly the direction Ashley wanted after empirical investigation confirmed the source is universal (~92% coverage across 216 sessions, not gated on plan mode).
- No new sort keys / recency semantics changes — Phase 44 already owns the recency sort; this phase adds a display axis only.
- No changes to the RDP row tier or the pinned tier.

</domain>

<decisions>
## Implementation Decisions

### Wire shape mirror of Phase 44

- `FleetSession` interface gets `aiTitle: string | null` field, optional in TypeScript, always emitted by backend (null when unknown). Backend cache-key v2 → v3.
- Both `/sessions/list` payload AND fleet-status WS `SessionState` carry the field. Additive; no version bump on the wire protocol itself — the field is optional at both consumer sites, so older clients would ignore it (though we bump cache-key to force fresh fetches after upgrade).

### Backend scraper mechanics

- Reuses `discoverIdentitySessionFile(conn, identityName)` from Phase 32 (already used by Phase 44). Same identity name convention (tmux session name === /id target).
- After discovery, run: `tail -c 262144 <path> | grep '"type":"ai-title"' | tail -1 | jq -r '.aiTitle // empty'`. Return the string or null on empty/failure. Tail bounded to 256KB per session to protect from unbounded JSONL sizes.
- Dispatched in parallel with the Phase 44 discovery-based `lastMessageAt` scan — SAME SSH connection, SAME `Promise.all(rows.map(...))` pattern. If Phase 44's scan already reads/discovers the JSONL, the ai-title tail-read can share the same discovery lookup result to avoid a duplicate `discoverIdentitySessionFile` call per row. Look for the current implementation shape in `sessions.ts` (post-Phase-44 landing state) — Phase 44's discovery cache MAY already exist as a hook per row; if so, extend it to return both `lastMessageAt` and `aiTitle` from one pass. If not present, add a small helper (`readSessionRecencySignals(conn, tmuxSession) → { lastMessageAt, aiTitle }`) that does the discovery + one tail read + returns both.
- Per-session failure isolation: each row wraps its own `Promise.race(PER_HOST_TIMEOUT_MS)` and try/catch. On failure: `aiTitle = null`, `lastMessageAt = null`, log debug, continue. No single row's failure kills the host's row set.

### Working-store third axis

- Store record shape today: `{ isWorking: boolean, lastMessageAt: number | null }` (Phase 44 addition).
- New shape: `{ isWorking: boolean, lastMessageAt: number | null, aiTitle: string | null }`.
- New public API: `useSessionAiTitle(sessionKey): string | null` (hook, `useSyncExternalStore` pattern matching `useSessionIsWorking` + `useSessionLastMessageAt` — read code for shape).
- New seed API: `seedSessionAiTitle(hostId, tmuxSession, title): void` — called from AppShell's `/sessions/list` handler per row.
- New chokepoint: `advanceSessionAiTitle(key, title)` — internal helper.
- **Reconciliation rule: LAST-WINS (not max-wins).** Different from `lastMessageAt` which is monotonically increasing. Ai-title EVOLVES over a session (topic drifts across turns) — the freshest value from either source (WS or seed) is the correct one. If WS says "Debug X" and later WS says "Fix Y", we want "Fix Y". No cross-source comparison needed — just accept whichever arrived last.
- Notify-guard: skip notify when the new value === existing value (Object.is equality on strings). Prevents needless renders when a WS frame carries the same title as the cached one.

### Frontend row redesign — the locked v14 shape

**Title line:**
- Content: identity name (bold-ish, existing weight) + one space + hostname wrapped in parens `(skynet-ec2)`.
- Parens styling: SAME font-size as identity name (not smaller), alpha `.85` (subtly softer to signal parenthetical), inherits font-family from label. This is the "part of the same text" treatment Ashley locked after iteration.
- Right-edge fade-truncation via `mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 22px), transparent 100%)` + `text-overflow: clip` (not ellipsis). Long identity/hostname combos taper into transparency instead of hard-cutting.

**Subtitle line (formerly hostname; now the ai-title):**
- Content: the identity's current ai-title string. When ai-title is null (fresh session, no title yet), fallback text is `"…"` (single ellipsis char, italic, muted alpha 0.58) OR empty — decide at implementation time. Ashley's tasting used a visible placeholder for testing; for production either the ellipsis or blank line is acceptable. Slight preference for the ellipsis so the row visually anchors the same height regardless of ai-title presence.
- Styling: color `#f0ece0` (bright, near-full brightness), `font-size: 13.5px`, `font-weight: 500`, `text-shadow: 0 1px 2px rgba(0,0,0,0.4)` for contrast on hue-tinted rows, same mask-image right-edge fade as the title line.

**Working indicator (INVERSION — replaces the current idle-dot):**
- Old behavior: idle rows get a bright cream ready-dot in `.pv-meta` right column when `inActiveSet && isWorking === false && !isRecycling && !hasQueuePending`. Working rows have no dot.
- New behavior: **idle rows have NOTHING**. Working rows get a slow dashed spinner ring around the avatar in the identity's hue.
- **Gate rule (Ashley 2026-08-19 verbatim):** *"make the spinner work on the same logic as the idle indicator, except you invert it as the final step of logic there."* Concretely:
  - `showSpinner = !(inActiveSet && isWorking === false && !isRecycling && !hasQueuePending)` — same four inputs the current idle-dot uses, evaluated the same way, INVERT THE FINAL BOOLEAN. Do NOT widen or narrow the state check.
  - Same JS gate as the ready-dot (which reads `useSessionQueuePending` + `useSessionIsWorking` + `useSessionRecycling`), just the final `?` on the render inverted.
  - The `.pv-row.working` CSS class Skynet already applies is a NARROWER signal (only `status === "busy"`, excludes shell + waiting per Phase 39). That is DELIBERATELY excluded from the widening — Ashley accepted verbatim *"that is fine for now"* after understanding tool-executing sessions won't spin.
- Spinner visual: `.pv-avatar::before` conic-gradient of 18 dashes spanning 10° each with 10° gaps between, masked to a thin outer ring via `radial-gradient` mask, animated with `transform: rotate(360deg)` over **3 seconds per revolution** (slow — Ashley picked from a ring-patterns tasting). Color: identity's `--pv-hue` at `hsla(var(--pv-hue), 70%, 65%, 1)`. Exact CSS is captured in the ring-patterns.html `.av.p05` variant and in the console snippet `v14-console-snippet.js` — copy the CSS block verbatim.
- No transition on the spinner's appearance/disappearance (turning on/off is instant; the rotation itself is the motion).

**Badge relocation (V12 style reuse):**
- The Pin (pinned count) + Monitor (needs-desk count) icon-wraps that patch #468 shipped as the V12 notification-badge style REMAIN VISUALLY UNCHANGED — same lucide icons at 16px, 70% opacity, warm-off-white color; same cream corner-count pill (`#f0ebe0` bg, `#0a0b12` text, 9px/700, tabular-nums slashed-zero).
- Reposition them to absolute corners of the avatar:
  - Pin wrap → absolute-positioned bottom-left of avatar (icon center approximately at `bottom: -4px; left: -8px` relative to `.pv-avatar`; count pill remains at the icon's top-right per V12).
  - Monitor wrap → absolute-positioned bottom-right of avatar (icon center approximately at `bottom: -4px; right: -8px`).
- Each wrap only renders when its count > 0 (existing V12 behavior).
- `.pv-avatar` gets `position: relative; overflow: visible;` so the wraps can extend outside the circle bounds.
- CSS classes `.pv-bounty-badge`, `.pv-bounty-badge-wrap`, `.pv-bounty-badge-icon`, `.pv-bounty-badge-num` — DO NOT MODIFY. Reused verbatim from patch #468. Only container positioning changes.

**`.pv-meta` right column retirement:**
- The right column of the row (`.pv-meta`) currently holds the ready-dot and the two-wrap bounty badge. After this phase:
  - Bounty badge wraps moved to avatar corners (see above).
  - Ready-dot removed entirely — the inverted working-spinner-on-avatar replaces it as the "come look" cue.
  - `.pv-meta` element can be removed from the row markup, OR kept as a stub for future use. Decision at implementation time; either is acceptable, favor removal for cleanliness.
- Grid template on `.pv-row` changes from `40px 1fr auto` (avatar / body / meta) to `40px 1fr` (avatar / body).
- The row's `.pv-pin-indicator` (absolute-positioned top-left row-level flag) stays — separate concern from the .pv-meta bounty badge.

**Fallback: no ai-title yet:**
- Some sessions won't have an ai-title (fresh session that hasn't accumulated enough turns yet; edge-case sessions the harness missed). Render behavior:
  - Subtitle line renders as a single italic ellipsis "…" at muted alpha (~0.55), OR
  - Subtitle line renders empty (row still has its full height because title line + subtitle spacing anchors it).
- Either is acceptable; slight preference for the visible ellipsis so the row keeps its visual weight and doesn't collapse-look.

### Test surface

- **Wire parse tests**: `/sessions/list` response includes `aiTitle` per row (null and string cases). Fleet-status WS frame includes `aiTitle` (null and string).
- **Backend scraper tests**: JSONL with 0 ai-title lines → null. JSONL with 1 ai-title line → returns that title. JSONL with multiple ai-title lines → returns the LAST one. JSONL with malformed ai-title JSON → returns null, logs. Empty JSONL / missing file → returns null.
- **Working-store tests**: `seedSessionAiTitle` writes value + notifies. `advanceSessionAiTitle` no-op-notifies when value unchanged (Object.is). WS publish overwrites seed value (last-wins semantics). Notification cadence matches Phase 44's pattern (test alongside existing `advanceSessionLastMessageAt` cases).
- **`PrettyConversationRow` render tests** — new tests for:
  - Title line renders `identityName (hostname)` when both are present.
  - Title line renders just `identityName` when hostname is null (RDP rows / no host).
  - Subtitle renders ai-title text when present; renders `…` or blank when null.
  - Working state (per the inverted-boolean rule) applies the spinner class; idle does not.
  - Pin badge wrap renders at bottom-left of avatar iff pinnedCount > 0.
  - Monitor badge wrap renders at bottom-right of avatar iff needsDeskCount > 0.
  - `.pv-meta` element is absent from the row markup (post-retirement).
- **`PrettyBountyCountBadge` tests**: existing 8 tests all continue to pass unchanged (component's own behavior didn't change; only its host does).
- **`PrettyConversationsPanel` integration tests**: existing 71 row tests continue to pass (subtitleMode prop can be retired since hostname is now on title line; check if the prop is still needed elsewhere or delete).

### Bundle with Phase 44 ship

- Phase 44 (convo-list recency signal fix) is code-complete on this branch, ship on hold pending bundled follow-ups per Ashley directive 2026-08-18: *"okay i would just say hold that work then and we can throw a few more things on before you deploy"*. This phase's work is a natural bundle candidate — same file family (`PrettyConversationRow.tsx`, `session-working-store.ts`, `sessions.ts`, fleet-session wire type), same architectural shape (extend FleetSession + backend scraper + working-store field + frontend consumer), one deploy carries both.
- Also candidates to bundle at deploy time (from Phase 44 handoff): Phase 41 `setIsIdle` leftover in `Terminal.tsx:1441`, `<BountyCard>` test backfill. These are separate concerns; leaving to Ashley to bundle at deploy time.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design decision source
- `~/.claude/roles/box-maintainer/bounties/convo-list-current-work-hint/bounty.json` — the design-lock bounty, has full history + verbatim Ashley quotes on the working-spinner rule and the "fine for now" tradeoff acceptance.
- `~/.claude/roles/box-maintainer/bounties/convo-list-current-work-hint/prototype.html` — 21 display variants; v14 is the anchor + v17-v21 are the working-indicator variants tasted.
- `~/.claude/roles/box-maintainer/bounties/convo-list-current-work-hint/ring-patterns.html` — 18 spinner-pattern variants; `.av.p05` (slowed to 3s) is the chosen dashed-spinner CSS.
- `~/.claude/roles/box-maintainer/bounties/convo-list-current-work-hint/v14-console-snippet.js` — live-app v14 taste (last state has the final agreed styling: bottom-left counts, hostname parens same-size, fade truncation, working spinner via `.pv-row.active-set:is(.working,.recycling)` — note this snippet uses the CSS-level classes but the real implementation should use the JS store-based gate for the full 4-input boolean).

### Architecture mirror source
- `.planning/phases/44-fix-convo-list-recency-signal-switch-dormant-live-paths-to-i/44-CONTEXT.md` — Phase 44 design decisions, especially the max-wins reconciliation chokepoint, wire-type extension shape, seed-wire consumer pattern. Phase 47 mirrors this architecturally.
- `.planning/phases/44-fix-convo-list-recency-signal-switch-dormant-live-paths-to-i/44-01-SUMMARY.md` — Phase 44 Plan 01 shipped `/sessions/list` extension for `lastMessageAt`; extend the same route for `aiTitle`.
- `.planning/phases/44-fix-convo-list-recency-signal-switch-dormant-live-paths-to-i/44-02-SUMMARY.md` — Phase 44 Plan 02 landed the orchestrator swap to `discoverIdentitySessionFile` + JSONL path caching. That cache is the pattern to extend for shared discovery between `lastMessageAt` and `aiTitle` reads.
- `.planning/phases/44-fix-convo-list-recency-signal-switch-dormant-live-paths-to-i/44-03-SUMMARY.md` — Phase 44 Plan 03 landed `advanceSessionLastMessageAt` + `seedSessionLastMessageAt` in the working-store. Mirror shape for `advanceSessionAiTitle` + `seedSessionAiTitle`.
- `.planning/phases/44-fix-convo-list-recency-signal-switch-dormant-live-paths-to-i/44-04-SUMMARY.md` — Phase 44 Plan 04 landed `FleetSession` type extension + AppShell seed wiring + cache-key bump. Mirror for `aiTitle`.

### Badge style source (verbatim reuse)
- Commit `c33b5ff8` (patch #468 by tiffany, 2026-08-18) — introduced the V12 notification-badge style. Reference for the CSS classes (`.pv-bounty-badge-wrap`, `.pv-bounty-badge-icon`, `.pv-bounty-badge-num`) and the component (`PrettyBountyCountBadge.tsx`) that get REUSED VERBATIM in this phase (only their positioning host changes from `.pv-meta` to avatar corners).
- `src/ui/features/pretty-conversations/PrettyBountyCountBadge.tsx` — current file (post-#468 landing).
- `src/ui/features/pretty-conversations/pretty-conversations.css` — search for `.pv-bounty-badge` block for the current CSS.

### Working-indicator gate source
- `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` line ~1109 — the current ready-dot JS render gate: `{isWorking === false && !isRecycling && !hasQueuePending && (...)}`. The working-spinner render is this exact boolean INVERTED.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` line 179 — the `useSessionIsWorking(sessionKey)` hook call. The new spinner needs the same three hook subscriptions (isWorking, isRecycling, queue-pending) to compute its gate.
- `src/ui/state/session-working-store.ts` — comment block at top explains `isWorking = main || bg` where `main = status === "busy"` and Phase 39's deliberate exclusion of `status === "shell"`. The spinner will NOT show during tool-exec turns; that is Ashley-accepted and NOT to be widened here.

### Harness ai-title source
- Format: `{"type":"ai-title","aiTitle":"<string>","sessionId":"<uuid>"}` — one JSON line, appended to the session JSONL by Claude Code itself as topic drifts. Empirically confirmed universal (not plan-mode-gated): 199/216 sessions on this box have ai-title lines, 196 of those 199 never invoked `ExitPlanMode` (evidence gathered 2026-08-19 during the design session).
- Location: `~/.claude/projects/<project-hash>/<session-uuid>.jsonl` on the target box (same discovery path Phase 44 already reads).
- Behavior: multiple ai-title lines can exist in a single JSONL as the session evolves — the LAST one is the current title.

</canonical_refs>

<specifics>
## Specific Ideas

### File shape prediction (planner: verify against post-Phase-44 landing state)

- **Backend** (`src/backend/`):
  - `database/routes/sessions.ts` — extend the per-session row build. If Phase 44's cache already exists as a helper (like `readSessionRecencySignals(conn, tmuxSession)` returning `{ lastMessageAt }`), extend that helper's return shape to `{ lastMessageAt, aiTitle }`. If no such helper exists, add one to keep the tail-read shared with the existing `lastMessageAt` derivation.
  - `fleet-status/ssh-poll-orchestrator.ts` — pipe `aiTitle` through the WS publish frame. Uses the same per-PID discovery path Phase 44 landed.
  - `fleet-status/session-state-types.ts` (or wherever `SessionState` is defined) — add `aiTitle?: string | null` field. Zod `.optional().nullable()` treatment matching Phase 44's `lastMessageAt` extension.

- **Frontend state** (`src/ui/state/`):
  - `session-working-store.ts` — extend `WorkingRecord` type; add `seedSessionAiTitle`, `advanceSessionAiTitle`, `useSessionAiTitle`. Mirror Phase 44's file structure exactly.
  - `session-working-store.test.ts` — add coverage for the aiTitle axis (seed, WS publish, last-wins, notify-guard).

- **Frontend row** (`src/ui/features/pretty-conversations/`):
  - `PrettyConversationRow.tsx` — biggest surface change. Update markup: retire `.pv-meta`, restructure `.pv-body` (label line = identity + hostname parens, host line = ai-title), add badge wraps inside `.pv-avatar`. Update className concat to add the working-spinner conditional class based on the inverted-boolean rule. Delete the ready-dot JSX render + comments.
  - `PrettyConversationsPanel.tsx` — the `PrettyConversationRowLive` wrapper (line ~144) already subscribes to `useSessionIsWorking`, `useSessionRecycling`, `useSessionQueuePending`. Add `useSessionAiTitle(sessionKey)`. Thread through as `aiTitle` prop. Also thread the `subtitleMode` prop can be retired (hostname now always inline on title line, no more toggle) — check every render site.
  - `pretty-conversations.css` — new: `.pv-avatar::before` for the working spinner (copy the p05-slow CSS from ring-patterns.html); relocate `.pv-bounty-badge` positioning context; mask-image on `.pv-label` and `.pv-host`; kill `.pv-ready-dot` block; kill `.pv-meta` block (or leave as an empty stub).
  - `PrettyConversationRow.test.tsx` — new render tests per the test surface list above.

- **Wire types** (`src/ui/api/` or shared types dir):
  - `FleetSession` type (or equivalent) — add `aiTitle?: string | null`.
  - Cache-key bump wherever the current v2 sentinel lives (search for the string literal used in Phase 44's Plan 04 bump).

### Verify against post-Phase-44 landing state before planning waves

Phase 44's four plans landed the ARCHITECTURE this phase mirrors. The planner MUST read Phase 44's four SUMMARY.md files first to see the exact shape of what shipped, since some naming / structure decisions in this CONTEXT.md are predictions based on Phase 44's design at the time — the actual code post-Phase-44 landing may differ in specifics. Trust the SUMMARY files as ground truth.

</specifics>

<deferred>
## Deferred Ideas

- **Widening the working-state gate to include tool-executing sessions** — Ashley accepted the current narrow gate ("that is fine for now"). Fixing the Phase 39 ambient-monitor problem (which prevents widening) is a separate future concern; not this phase.
- **LLM-based summary fallback for sessions without ai-title** — considered during design, rejected in favor of the free harness-produced signal. Fallback is null/ellipsis, not a fabricated summary.
- **Ai-title display anywhere other than the conversation list row** — no header, no pretty-view chrome, no modal. Deferred; may or may not ever surface.
- **Cross-identity aggregation, filter-by-topic, search-by-ai-title** — not for this phase. Search bar (Phase 42) matches row labels only.
- **Backend cache of the tail-read result across successive polls** — the tail-read is cheap enough (<10ms typical) that per-poll re-reading is acceptable v1. If observed cost is meaningful, cache with a short TTL keyed on JSONL mtime.

</deferred>

---

*Phase: 47-convo-list-per-row-current-work-hint-from-ai-title-extends-f*
*Context gathered: 2026-08-19 via bounty tasting session (prototype.html + ring-patterns.html + v14-console-snippet.js live taste)*

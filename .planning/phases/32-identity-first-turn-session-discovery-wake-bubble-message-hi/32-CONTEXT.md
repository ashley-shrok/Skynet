---
phase: 32-identity-first-turn-session-discovery-wake-bubble-message-hi
type: context
source: ROADMAP.md § Phase 32 (LOCKED via design conversation with Ashley 2026-08-12)
authority: "Every D-nnn below is a LOCKED decision. Plans and executors MUST NOT re-litigate. Every task in every plan MUST cite at least one D-nnn in its action and appear in the plan's `requirements` frontmatter."
---

# Phase 32 — Decision Ledger (D-01..D-09)

**Source of truth:** `.planning/ROADMAP.md` § Phase 32: Identity-first-turn session discovery + wake-bubble message history (lines 1011-1049). The nine "Deliberate design choices" bullets from ROADMAP are captured verbatim below and assigned IDs D-01..D-09. All D-nnn are LOCKED — no re-litigation permitted at plan or execution time.

**Consumer context (from ROADMAP, verbatim):** "wake bubble message history (from the just-shipped `dormancy-bubble-in-flow` quick task) is the first and currently only consumer. Ashley 2026-08-12: *'the bubble looks good, but unfortunately, the rest of the messages that would be in that session are not showing up.'*"

**Depends on:** Phase 31 (structured logging — the dormant-branch tail-open path will emit `[ws]` / `[session]` boundary logs consistent with the Phase 31 taxonomy).

**Rebase risk:** LOW — additive: new helper file + wire into an existing branch that emits only a single dormant frame today + explicit tail-close ordering at the wake transition + fallback preserves existing behavior. No upstream Skynet surfaces touched.

---

## Locked Decisions

### D-01 — Byte-pattern match, not JSON parse

Same shape as the Layer 1 detector at `src/backend/claude-session/layer1-detect.ts:82-106` (`isUserTurn` + `isIdResetUserTurn`) — production-proven, cheap, tolerant to minor JSONL shape drift. `line.includes` only. **No `JSON.parse` in `discoverIdentitySessionFile` or any of its helpers.** This is the SINGLE place the byte-shape assumption lives for identity-first-turn detection; a shape drift upstream is fixed here in one spot.

**Byte-pattern spec** for the identity-first-turn match line:
- Contains `"role":"user"` (delegate to `isUserTurn` from `layer1-detect.ts` if extractable, or mirror the two-check pattern: has `"type":"user"` AND does NOT contain `"tool_result"`).
- Contains `<command-name>/id</command-name>` (literal).
- Contains `<command-args><identityName>` where the character IMMEDIATELY AFTER `<identityName>` is one of: `<`, ` ` (space), `\r`, or end-of-line.
  - Rationale: real identity names have no whitespace, so real JSONLs write `<command-args>tanya<` (see empirical sample at `~/.claude/projects/-home-ubuntu-skynet-tanya/*.jsonl` — every file matches `command-args>tanya<`). The delimiter check prevents partial-name matches (`<command-args>tiff` MUST NOT match identity `tiffany`).

### D-02 — First user-role line only

`/id <name>` is always the first user turn of an identity session by convention (id-skill invocation is how identities bootstrap). The helper reads the file until the FIRST line where `"role":"user"` (equivalently `"type":"user"` with no `"tool_result"`) is present, then applies the byte-pattern check to THAT line only. Later mentions of `/id <name>` in the transcript body do NOT match.

**Implementation hint:** `head -c 4096` (or `grep -m 1 '"role":"user"'` via SSH) is sufficient; short-circuit on first hit. Planner decides whether to issue N SSH round-trips (one per file) or a single script that finds+greps+sorts server-side — see D-07 for cost bound.

### D-03 — Mtime-latest tiebreak when multiple JSONLs match

New `/id reset` recycles create fresh JSONLs with the same first-turn signature; latest = current. Order candidate matches by mtime descending and return the newest. Implementation: `stat -c '%Y %n'` (or equivalent) on the match set, sort numerically descending, take first.

### D-04 — Throwaway/non-identity panes naturally excluded

Their first user turn isn't `/id <name>` (Ashley opens a shell, launches claude with no `/id` invocation), so they never match — the helper is identity-only BY CONSTRUCTION. **No explicit throwaway-pane filter needed.** This falls out of D-02 + D-01.

### D-05 — Cold-start works

No prior visit / no cache / no bootstrap needed. Every session that's ever been started for an identity is discoverable from disk alone. **No cache layer, no warm-up step, no first-visit fallback.** The helper is pure I/O + pattern-match; state is entirely on the remote filesystem.

### D-06 — Stronger identity attribution than pane-based mechanism

If two identities share a repo cwd (both `cd` into e.g. `/home/ubuntu/skynet-plain`), the existing pane-based mtime-newest chain can't disambiguate which identity wrote which JSONL. First-turn signature makes each identity's JSONL unmistakable. **Nice-to-have for this phase; would be load-bearing if this mechanism ever expands to the live path** (see D-09 for the explicit deferral).

### D-07 — Cost negligible at current scale

~4 project dirs × dozens of JSONLs × `grep -m 1 '"role":"user"'` (early-bails on the first user line, typically within the first ~1KB of a file) = well under 100ms per lookup. **Mtime pre-filter is a trivial future optimization** if the JSONL count ever grows past thousands — do NOT implement it in this phase; keep the code simple.

### D-08 — Recycle-boundary latency parity with pane-based

As soon as the newly-recycled session writes its first user turn, mtime-latest-matching correctly points at the new file — same window as pane-based waiting for the new PID's first JSONL write. **No additional latency budget vs the existing live-path chain.** No sync barrier / retry loop needed.

### D-09 — OUT OF SCOPE for Phase 32: migrating the LIVE-path discovery to this helper

Additive only — the helper is wired into the dormant branch and no other site. Live path stays on pane-based (which is proven and works for throwaways). A future phase can consider a broader migration; explicitly deferred here to keep blast radius minimal.

**Consequences for planning:**
- The active-flow tail-open call at `claude-session-server.ts:4634` (inside `startActiveSessionFlow`) MUST NOT be changed to consume `discoverIdentitySessionFile`. Active flow keeps `discoverClaudeSession`.
- The new helper is called at exactly ONE production site: the dormant branch at `claude-session-server.ts:4675-4799`, immediately after the `dormantPollTimer = setInterval(...)` block and before `enteredDormantPoll = true;`.
- Tests, wire sites, and imports MUST reflect this scope. Do not add speculative call sites.

---

## Cross-cutting invariants (derived from D-nnn — enforced across all plans)

1. **Fallback preserves status quo** (D-05, D-09): if `discoverIdentitySessionFile` returns `null`, the dormant branch is byte-identical to today — dormant frame sent, no tail opened, no messages. Include a plan-checker-gated integration test asserting the null-return path.

2. **Wake-transition safe-close ordering** (implicit consequence of adding a dormant tail): when `__applyDormantPollWithRediscoveryForTests` detects rediscovery→active and invokes `startActiveFlow`, the pre-existing dormant `tailHandle` MUST be `.stop()`'d + set to `null` BEFORE the active-flow `tailHandle = tailSessionFile(...)` assignment at `claude-session-server.ts:4634`. Otherwise two tails on different files briefly overlap and produce duplicate/out-of-order message emissions. Add a plan-checker-gated integration test asserting no `eventId` is emitted twice across the handoff window.

3. **UI byte-untouched** (from ROADMAP § 6, verbatim): This is a pure backend addition — `DormancyOverlay.tsx`, `PrettyView.tsx`, and all pretty-view components must have ZERO source diffs this phase. Existing tests (`DormancyOverlay.test.tsx`, `PrettyView.test.tsx`) must pass unchanged.

4. **Full test suite green at end of each wave**: `npx vitest run` must complete with zero failures at the end of each plan.

5. **Structured logging consistent with Phase 31** (from Depends-on): every log emission in the new dormant-branch tail-open path uses the `sshLogger`/`databaseLogger` structured pattern already established (`operation:` key, tagged prefix like `[session]` / `[ws]`, camelCase field names).

---

## Not permitted in this phase (explicit exclusions)

- Changing the active-flow discovery to use `discoverIdentitySessionFile` (D-09).
- Adding a cache / warm-up / bootstrap step (D-05).
- Adding an mtime pre-filter (D-07 — future optimization, not this phase).
- Modifying any file under `src/ui/features/pretty-view/` (invariant 3).
- Adding new WS frame types or wire-protocol changes. The dormant branch continues to emit exactly the same `{type:"dormant",dormant:true,wakingSince}` frame it emits today; messages arrive via the existing `session` + line-emit pipeline through `onLine`+`appendDedup`+`eventId` (same code path as active).
- Committing the deploy runbook (`~/.claude/roles/box-maintainer/box-map.md`) to skynet-tiffany git — that file is OUTSIDE the repo tree and must be edited via the Edit tool without any `git add`.

---

## Consumer sequencing

Wake-bubble message history (from the just-shipped `dormancy-bubble-in-flow` quick task, patch #422, 2026-08-12) is the first and currently only consumer. The predecessor quick-task SUMMARY is at `.planning/quick/260812-ma8-dormancy-bubble-in-flow/260812-ma8-SUMMARY.md`. Ashley's verbatim direction after that ship: *"the bubble looks good, but unfortunately, the rest of the messages that would be in that session are not showing up."* Phase 32 closes that gap.

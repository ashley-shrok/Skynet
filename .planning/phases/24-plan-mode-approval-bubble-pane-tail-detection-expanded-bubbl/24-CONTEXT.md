# Phase 24: Plan-mode approval bubble — Context

**Gathered:** 2026-08-04
**Status:** Ready for planning
**Source:** Design conversation with Ashley (this session, 2026-08-04)

<domain>
## Phase Boundary

Make the Claude Code plan-approval prompt actionable from the pretty view. Five coordinated pieces:

1. **Fix** `plan-pending-parser.ts` fingerprint so it actually detects the pinned fleet Ink prompt. Current fingerprint targets strings that never appear in the fleet variant (`No, keep planning`, `Here is Claude's plan:`, `Ready to code?`) — was authored in quick `260802-rps` (2 days ago) but never verified against a live fleet pane. Effectively dead detection since it landed. This is a **string-fix**, not a mechanism swap; the pane-scrape mechanism itself is correct.
2. **Extract** the plan file path from the pane footer (`ctrl-g to edit in  Vim  · ~/.claude/plans/<slug>.md`) alongside the presence detection — new helper on the same pane text.
3. **Extend** the WS `plan_pending` frame shape from bare presence → `{planFilePath, planContent, contentError}`. `planContent` fetched async via side-SSH SFTP on the tab's existing SSH connection; bubble renders as soon as presence is known, upgrades when content arrives.
4. **Expand** `PlanPendingBubble` (currently 60 lines, presence-only text) → renders plan contents inline + [Approve] button (sends `1\r`) + [Feedback] button (opens modal → textarea → Submit sends `3<feedback>\r`).
5. **Add** `planPendingActive` boolean prop on ComposeBox → OR into existing disabled predicates alongside `asideActive`/`recycleActive`. Disables: reset, send, mic, send-while-idle (queue), thumbs up, recap. Matches existing compose-disable pattern verbatim (do NOT invent a new visual affordance).

**NOT in this phase:**
- Option 2 ("Yes, manually approve edits") button. Approve = option 1 only.
- Markdown-rendering upgrades beyond what the current bubble does. Plan contents render as plain/pre-formatted text with light styling; full markdown parse is a follow-up if the plain view feels bad.
- Multi-plan detection edge cases (multiple plans queued back-to-back is theoretically possible but not observed; not designed for).
- Any change to the patch #63 legacy JSONL scan. Docblock in `plan-pending-parser.ts` already declares it dead as of Claude Code 2.1.150; if any residual JSONL scan code still exists, leave it alone unless the planner determines removal is trivial and orthogonal.
- Changes to the RDP tab surface. Plan-mode is a Claude Code / SSH-only concept.

</domain>

<decisions>
## Implementation Decisions

### Detection (backend, `plan-pending-parser.ts`)
- **Keep the two-condition fingerprint shape** (bottom-slice marker AND header-anywhere) — the rationale in the current docblock still holds; only the string values are wrong.
- **New fingerprint for the pinned fleet Ink variant:**
  - Bottom-slice (last ~30 lines): `shift+tab to approve with this feedback` — appears only in the plan-approval prompt's footer.
  - Header-anywhere: `Claude has written up a plan and is ready to execute. Would you like to proceed?` — the full header string of this variant.
- **Bottom-slice bound** stays 30 lines (matches the current file's parseContextPct rationale). No tuning needed.
- **Test file** `plan-pending-parser.test.ts` gets its synthetic pane fixtures updated to the pinned variant. Existing negative-case tests (empty, prose-quote, etc.) should still pass structurally with the new fingerprint.
- **Fleet is pinned to a single Claude Code version** (Ashley verified 2026-08-04). Do NOT plan for multiple variant handling, version-drift fallback, or "either old-or-new fingerprint OR." The pinned variant is the only variant.

### Plan file path extraction (backend, same file)
- **New helper `parsePlanFilePath(paneText: string): string | null`** in the same pure-helper file, same posture as `isPlanPending` (zero I/O, testable with synthetic pane strings).
- Footer line looks like: `ctrl-g to edit in  Vim  · ~/.claude/plans/groovy-watching-leaf.md` (double-space between "in" and "Vim" is Ink's rendering, preserve if it helps disambiguation).
- Return `null` when not found; do NOT throw. Detection presence is authoritative — a missing path just means content-fetch skips.
- **Path validation lives in the SFTP-fetch code path** (see below), NOT in the parser. Parser is pure text extraction; the fetch caller is the security boundary.

### WS frame shape (backend, `claude-session-server.ts`)
- **`{type: "plan_pending", pending}` frame extended.** When `pending` is non-null, shape is now:
  ```
  { planFilePath: string | null, planContent: string | null, contentError: string | null }
  ```
- `pending: null` (no prompt visible) stays unchanged.
- **Emit sequence for a new prompt appearance:**
  1. Detection fires → emit immediately with `{planFilePath, planContent: null, contentError: null}` so the bubble mounts with the path visible and a "loading plan contents…" state.
  2. Kick off async SFTP read.
  3. On success → emit with `{planFilePath, planContent: "…", contentError: null}`.
  4. On failure → emit with `{planFilePath, planContent: null, contentError: "…"}`.
- **De-dup guard** stays: use the existing `planPendingLastSerialized` compare so we don't spam identical frames on every setInterval tick.
- **Fetch happens once per (tmuxSession, planFilePath) pair** per pending window. When the prompt clears (detection returns false), invalidate the cache. If the SAME planFilePath re-appears immediately (edge case: Ashley picks feedback → Claude regenerates → same slug), refetch — cache keyed by pending window, not global.

### Plan file fetch (backend, new module)
- **Side-channel SFTP on the tab's existing SSH connection**, not a fresh handshake. Skynet already holds the SSH `Client` for each tab's PTY channel; open a second SFTP subsystem channel on the same `Client`. Zero new handshake, zero re-auth, reuses established host-key trust.
- **If** the existing SSH abstraction does NOT expose the underlying `Client` (planner verifies during planning): fall back to a fresh SSH conn using the stored host key from the encrypted `skynet-data` volume. Same known-hosts trust. Slower (~300ms handshake per fetch) but still safe and functional. Note this as a fallback branch, not the primary path.
- **SFTP subsystem, NOT `cat` over a shell.** SFTP has no shell parsing → no path-injection surface. `Client.sftp((err, sftp) => sftp.readFile(absPath, cb))` shape.
- **Home directory resolution:** the SSH login user is known per tab (Skynet already stores it). Cache `/home/<user>` (or the user's actual `$HOME` if it's non-standard — one-shot `stat`/`echo $HOME` at cache-miss, cached for the tab's lifetime).
- **Path validation (security boundary, MUST have tests):**
  - Slug regex: `^[a-z0-9-]+$`. Nothing else.
  - Full path must be exactly `<resolvedHome>/.claude/plans/<slug>.md`. String comparison after normalization.
  - Reject: `..` anywhere, `/` in slug, backticks, quotes, `$`, absolute paths that don't start with the resolved home + `.claude/plans/`.
  - On validation reject: emit `contentError: "invalid plan path"` and skip the SFTP call. Never touch the network with an unvalidated path.
- **Read cap: 500KB.** Use `readFile` with a byte cap OR truncate after read. Prevents an attacker-controlled path (defense-in-depth after validation) from OOMing the backend by pointing at `/dev/zero` or similar.
- **Encoding:** UTF-8 decode explicit; the plan files are always UTF-8.

### Bubble UI (frontend, `PlanPendingBubble.tsx`)
- **Expand the existing bubble in place** — don't create a new component. Same file, same identity-hue treatment, same assistant-aligned mounting via PrettyView. Grow it downward from a 1-line indicator into a card with:
  - Header: existing "Plan proposed — awaiting your approval" line (keep the ClipboardList glyph).
  - Middle: plan contents section — renders `planContent` in `<pre>` or equivalent monospace/preserved-whitespace block, styled to read comfortably (planner picks specifics within bubble aesthetic). Fallback states: `planContent: null && !contentError && planFilePath` → "Loading plan…" italic; `contentError` non-null → small dim "Plan contents unavailable ({error})" line, buttons still work; `planFilePath: null` → skip the middle section entirely, buttons still work.
  - Footer: [Approve] primary button + [Feedback] secondary button, side-by-side.
- **Approve button** sends `1\r` (chooses option 1 = "Yes, and bypass permissions"; the cursor defaults there anyway, and sending the digit is deterministic regardless of cursor position).
- **Feedback button** opens a modal with a textarea + Submit + Cancel. On Submit: sends `3<feedback>\r` (which per Ashley's live test on Amelia's pane 2026-08-04 drops the Ink cursor into the feedback input, types the string, then submits). Modal follows existing Skynet modal patterns (planner picks — DialogModal or similar existing primitive).
- **CRITICAL: send path.** The existing ComposeBox split-send (body + `\r` with 60ms gap, patch #44) is NOT recognized by Ink Plan Mode as a keystroke selection (Ashley verified 2026-07-18 per PlanPendingBubble.tsx docstring). So neither button can reuse compose's send path. Need a **new send-raw-keystrokes WS event type** that writes the bytes in one shot, no split. Planner names it (`type: "raw_keystrokes"` or similar) and both buttons plus the modal Submit funnel through it. Backend handler writes directly to the PTY without the split.
- **Bubble visual growth** shouldn't fight the existing identity-hue treatment. Keep the same background gradient / border / shadow tokens; just expand the vertical container.

### Compose-box disable (frontend, `ComposeBox.tsx` + parent `PrettyView.tsx`)
- **Add `planPendingActive?: boolean` prop** to ComposeBox alongside the existing `asideActive` and `recycleActive` props.
- **Parent (PrettyView) supplies it** from the WS `plan_pending` state — true when `pending` is non-null, false otherwise.
- **OR the new prop into every existing disabled predicate** that already reads `asideActive === true || recycleActive === true`. Same pattern verbatim — DO NOT invent a new visual affordance, DO NOT add tooltips, DO NOT add a banner. Grey-out is the existing pattern's affordance and that's what we use.
- **Disabled controls (Ashley's locked list):** reset cell, Send button, mic, send-while-idle (queue), thumbs up, recap. This matches the current `recycleActive` disable set closely — planner should audit `recycleActive` usages and copy each to also-OR in `planPendingActive`.
- **Textarea typing:** stays enabled (matches `recycleActive` behavior — textarea remains typeable during recycle so Ashley can pre-draft). Same treatment here.
- **Do NOT collapse** `planPendingActive` / `recycleActive` / `asideActive` into a combined `interactionsDisabled` flag. The Send-button-behavior-differs rationale from the current codebase (asideActive morphs Send into an X/Resume; recycleActive keeps Send but disables it) means keeping props independent stays correct — planPendingActive follows the recycleActive treatment (Send stays as Send, disabled).

### Failure modes / edge cases
- **SFTP fetch fails** (network flake, permission, file missing): bubble shows small dim "Plan contents unavailable ({error})" line; Approve + Feedback still work. User can still act on the prompt they can see in the tmux pane.
- **`planFilePath` extraction returns null** (footer format changes / unusual output): same fallback — bubble renders without the middle section, buttons still work.
- **Prompt disappears mid-fetch** (Ashley resolved it in the tmux pane directly with keyboard): WS emits `pending: null` → bubble unmounts. Any in-flight SFTP result gets dropped on arrival (frame's tmuxSession/planFilePath won't match current state).
- **Same prompt re-appears after resolution** (rare — Ashley picks feedback → new plan generated with same slug): treat as a fresh pending window, refetch. Cache is per pending-window, not global.
- **Very long plan** (> 500KB after cap): truncate + append a "[truncated]" line before emitting. Ashley can Ctrl+Shift+O to see the full pane if she needs it.

### Claude's Discretion (planner picks during planning)
- Exact WS event type name for the raw-keystroke send (`raw_keystrokes` vs `plan_reply` vs other).
- Exact `contentError` string shape (structured vs string vs enum). Simple string is probably fine.
- Which existing modal primitive the Feedback modal uses.
- Whether the "Loading plan…" state gets a spinner glyph or stays static (PlanPendingBubble docstring cautions against spinners for "waiting on you" states — planner respects that rationale).
- Whether `planContent` renders in `<pre>` monospace or a lightly-styled markdown-preserved block. Plain `<pre>` is the safe MVP.
- Bubble button styling (variants, hue treatment) — use existing button primitives, no new components.
- Home-directory resolution details (one-shot `stat` vs `echo $HOME` vs Skynet host-record field if one exists).
- The `Client`-exposed vs fallback-handshake decision for SFTP is verified at planning-time by reading the SSH abstraction (`src/backend/ssh/` or wherever). If the `Client` IS exposed, use it; document the fallback but don't build it unless needed.
- Whether the compose textarea shows any subtle visual cue when disable-siblings are active (probably not — match recycleActive treatment).
- Backend module organization for the new SFTP-fetch code (new file vs extension of an existing module).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing detection + wiring (backend)
- `src/backend/claude-session/plan-pending-parser.ts` — 82-line pure helper. Docblock explains WHY pane-scrape replaced JSONL scan; fingerprint STRINGS are wrong for the pinned fleet variant (this phase fixes them). Extend with `parsePlanFilePath` here.
- `src/backend/claude-session/plan-pending-parser.test.ts` — vitest suite driving synthetic pane strings. Fixtures need updating to the pinned variant.
- `src/backend/claude-session/claude-session-server.ts` — WS session server. `isPlanPending` call site at ~line 3355; `planPendingLastSerialized` dedup at ~line 1045; WS frame emit at ~line 3364 and ~line 1461. Extend the `pending` object shape here + add the async SFTP-fetch trigger.

### Existing bubble + parent wiring (frontend)
- `src/ui/features/pretty-view/PlanPendingBubble.tsx` — 61 lines, presence-only. Expand in place. Note the docstring warnings about (a) NOT using spinner glyphs for "waiting on you" states, (b) NOT reusing compose's split-send for keystroke replies.
- `src/ui/features/pretty-view/PrettyView.tsx` — mounts PlanPendingBubble as a sibling of WipBubble at the tail of the content wrapper when WS reports `plan_pending`. Supplies `recycleActive={showOverlay}` and `asideActive={asideText !== null || asidePending}` to ComposeBox — add `planPendingActive={planPendingState !== null}` (or equivalent) here.
- `src/ui/features/pretty-view/ComposeBox.tsx` — 2689 lines. The two existing disable props are documented in-line around line 234 (`asideActive`) and line 257 (`recycleActive`). New `planPendingActive` prop follows the recycleActive docblock verbatim (why-independent, disable-effect, textarea-stays-typeable). Disabled predicates are OR-chains at lines 1614, 1836, 1866, 2135, plus the `canReallySend` composite around lines 1439–1445 and the `sendDisabled` predicate at 1477.
- `src/ui/api/claude-session-api.ts` — frontend WS client. Extend the `plan_pending` frame decoding to carry `planFilePath` / `planContent` / `contentError`.

### SSH plumbing (backend, for side-channel SFTP)
- `src/backend/ssh/` (or the actual SSH abstraction location — planner locates during planning). Look for the `Client` handle exposure; if it's wrapped, decide reuse vs fallback-handshake per Decisions above.
- Encrypted host key storage lives in the `skynet-data` docker volume via Drizzle ORM. Existing host-CRUD backend already reads keys for PTY connection setup — SFTP fetch reuses the same host record.

### Test conventions
- Vitest is the frontend + pure-helper test runner (`plan-pending-parser.test.ts` is the shape). Non-mocked integration tests hitting real SSH/SFTP are OK for the fetch path but MUST use a fixture host, not a fleet host.

### Related patches / prior context
- Patch #63 (retired) — original JSONL scan for `ExitPlanMode` tool_use. Docblock in `plan-pending-parser.ts` explains why it went dead (Claude Code Ink v2 buffers the tool_use until after resolution).
- Patch #67 — retracted the "reply 1/2" copy from PlanPendingBubble after Ashley verified the split-send doesn't work in Ink. Load-bearing lesson for this phase: the button send-path CANNOT reuse compose's split-send.
- Quick `260731-ulo` — `recycleActive` + `mic-available-when-composebox-disabled`. The pattern this phase reuses; audit its usages for the `planPendingActive` OR-in.
- Quick `260729-j8l` — added `recycleActive` prop to ComposeBox. The direct precedent for `planPendingActive`'s prop shape and OR-in convention.
- Quick `260802-rps` — added `plan-pending-parser.ts` (the file this phase corrects).

</canonical_refs>

<specifics>
## Specific Ideas

- **Anchor strings for detection** (verbatim, do NOT paraphrase in code):
  - Header: `Claude has written up a plan and is ready to execute. Would you like to proceed?`
  - Bottom-slice marker: `shift+tab to approve with this feedback`
- **Approve keystroke bytes:** literal `1` followed by `\r` (0x31 0x0D), sent as ONE write to the PTY, no split, no gap.
- **Feedback keystroke sequence:** literal `3` (0x33) → then the user's feedback string (UTF-8) → then `\r` (0x0D). Sent as one write or as sequential writes with no split (planner picks; the load-bearing constraint is "not the split-send pattern").
- **Plan file footer format** (verbatim from Amelia's pane 2026-08-04): `ctrl-g to edit in  Vim  · ~/.claude/plans/<slug>.md` — note double space between "in" and "Vim", middle dot `·` (U+00B7) between "Vim" and the path, single-space separators on either side of the middle dot.
- **Slug regex:** `^[a-z0-9-]+$` — Claude Code plans are always kebab-case English words joined by hyphens (`groovy-watching-leaf.md`, `twinkling-strolling-eclipse.md`).
- **500KB read cap** = 500 * 1024 bytes = 512000 bytes. Explicit in code as a named constant.

</specifics>

<deferred>
## Deferred Ideas

- **Prettified markdown rendering of the plan contents** (rendered headings, bold, code blocks). MVP is plain `<pre>` monospace. Upgrade if the plain view feels bad in real use.
- **Option 2 button** ("Yes, manually approve edits"). Adds one button, straightforward, but Ashley picks option 1 exclusively and other fleet users are expected to too. Add later only if user requests.
- **Feedback modal enhancements** (paste-image, markdown preview, template snippets). MVP is plain textarea + Submit + Cancel.
- **Optimistic bubble dismissal** after clicking Approve (fade out immediately instead of waiting for detection to clear). MVP waits for WS `pending: null`. Add later if the ~1s round-trip feels laggy.
- **Multi-plan queuing** UI. Not observed in practice.
- **Cross-tab plan-mode indication** (e.g. dot on the conversation row when a plan is pending). Out of scope; the ambient dot is already ready-for-attention (see box-maintainer role file § Skynet conversation-list dot semantics) and plan-pending is IN that semantic space by default.
- **Cleanup / removal of any remaining patch #63 JSONL scan code paths.** Only touch if trivial + orthogonal.

</deferred>

---

*Phase: 24-plan-mode-approval-bubble-pane-tail-detection-expanded-bubbl*
*Context gathered: 2026-08-04 via design conversation with Ashley*

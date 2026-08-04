---
phase: 24-plan-mode-approval-bubble-pane-tail-detection-expanded-bubbl
reviewed: 2026-08-04T22:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - src/backend/claude-session/plan-pending-parser.ts
  - src/backend/claude-session/plan-pending-parser.test.ts
  - src/backend/ssh/plan-file-fetch.ts
  - src/backend/ssh/plan-file-fetch.test.ts
  - src/backend/claude-session/claude-session-server.ts
  - src/ui/api/claude-session-api.ts
  - src/ui/features/pretty-view/PlanPendingBubble.tsx
  - src/ui/features/pretty-view/ComposeBox.tsx
  - src/ui/features/pretty-view/ComposeBox.plan-pending-disable.test.tsx
  - src/ui/features/pretty-view/PrettyView.tsx
findings:
  critical: 1
  warning: 5
  info: 4
  total: 10
status: issues_found
---

# Phase 24: Code Review Report

**Reviewed:** 2026-08-04T22:00:00Z
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Adversarial review of the Phase 24 plan-mode approval bubble implementation.
All five CONTEXT.md-locked BLOCK guardrails were verified and pass:
(1) SFTP path validation IS fail-closed — every rejection returns before any
`sftp()`/`realpath`/`stat`/`readFile` call, with test coverage for each case.
(2) No `cat` or shell exec in the SFTP fetch path — everything routes through
SFTP subsystem callbacks. (3) No `interactionsDisabled` combined flag —
`asideActive`, `recycleActive`, `planPendingActive` remain three independent
props. (4) No new visual affordance for `planPendingActive` compose-disable —
it uses the existing greyed-out treatment verbatim. (5) The `raw_keystrokes`
send path is a single-shot `tmux send-keys -l`, NOT a re-use of the
patch-#44 split-send. (6) The backend `raw_keystrokes` handler uses
connection-captured `currentTmuxSession`, ignoring any client-supplied
target (mirrors `aside_dismissed` T-14-02-01 pattern). (7) The parser has
no version-drift branching — single pinned-variant fingerprint.

However, one **BLOCKER-tier correctness bug** exists in the backend
async-fetch stale-guard, and several WARNING-tier issues were found — most
consequentially, `parsePlanFilePath` scans the whole pane instead of the
footer slice (a locus-of-truth gap that lets earlier scrollback prose steer
which slug is fetched).

## Critical Issues

### CR-01: Async plan-file-fetch stale-result guard leaks across pending-window boundaries

**File:** `src/backend/claude-session/claude-session-server.ts:3488-3532`

**Issue:** The `.then()` handler for `fetchPlanFile` guards ONLY the
"pending fully closed" case (`planPendingLastSerialized === "null"`). It
does NOT check whether the `targetPath` captured at fetch-start still
matches the current pane's `planFilePath`. Two concrete corruption scenarios
result:

1. **Different-slug swap.** Timeline:
   - T1: pending A detected, emit `{planFilePath: A, planContent: null, ...}`,
     fetch A starts, `planPendingLastSerialized = "{A,null,null}"`.
   - T2: pane transitions to `!isPending` briefly, cache cleared, emit
     `pending: null`, `planPendingLastSerialized = "null"`.
   - T3: pending B (different slug) detected, emit `{planFilePath: B, null, null}`,
     `planPendingLastSerialized = "{B,null,null}"`, fetch B kicked off.
   - Fetch A resolves LATE. Guard `planPendingLastSerialized === "null"` →
     **FALSE** (it's `"{B,null,null}"`). Guard is bypassed.
     `.then()` writes A's content into `planPendingContentByPath[A]`,
     builds `nextPending = {planFilePath: A, planContent: A-content, ...}`,
     and emits it. `planPendingLastSerialized` is now A's serialization,
     overwriting UI state to show plan A even though pane is on B.
   - T4: parser yields planFilePath = B, cache has no entry for B,
     `pendingSerialized = "{B, null, null}"` !== `planPendingLastSerialized`
     (currently `"{A, A-content, null}"`), so it emits again. UI **flip-flops**
     between A and B.

2. **Same-slug regenerate (the CONTEXT-called-out "Ashley picks feedback →
   Claude regenerates → same slug" edge case).** After the intermediate
   `!isPending` tick clears the cache, fetch B is started for the new
   window. If fetch A (which was in-flight over the pending-close boundary)
   resolves before fetch B, the stale content for the same-slug prior
   window gets written into `planPendingContentByPath[A === B]` and
   emitted. The dedup then MATCHES on subsequent ticks (cache is
   populated), so the bubble sticks on the OLD plan's content forever
   until the current pending window closes again — violating the
   explicit CONTEXT invariant: "cache keyed by pending window, not global".

**Fix:** Bind a per-pending-window token at fetch-kickoff time and
compare in the `.then()` guard. Minimum shape:

```typescript
// At outer scope alongside planPendingLastSerialized:
let planPendingWindowToken = 0;

// In the transition-to-closed branch (~L3440):
if (
  !isPending &&
  (planPendingContentByPath.size > 0 || planPendingFetchInFlightForPath.size > 0)
) {
  planPendingContentByPath.clear();
  planPendingFetchInFlightForPath.clear();
  planPendingWindowToken += 1; // invalidate any in-flight fetch closures
}

// At fetch kickoff (~L3486):
const fetchToken = planPendingWindowToken;
const targetPath = planFilePath;
const activeSshConn = sshConn;
void fetchPlanFile(activeSshConn, targetPath)
  .then((result) => {
    planPendingFetchInFlightForPath.delete(targetPath);
    // Two-part guard: window token still current AND the current
    // pane's planFilePath still matches what we fetched for.
    if (fetchToken !== planPendingWindowToken) return;
    // ...populate cache + emit as today...
  })
  .catch((err) => {
    planPendingFetchInFlightForPath.delete(targetPath);
    if (fetchToken !== planPendingWindowToken) return; // same guard on error too
    // ...cache error as today...
  });
```

Also bump `planPendingWindowToken` in `teardownPane` (~L1136) and the
session-changed clean-slate (~L1836) alongside the existing
`planPendingContentByPath.clear()` calls.

## Warnings

### WR-01: `parsePlanFilePath` scans whole pane instead of bottom slice

**File:** `src/backend/claude-session/plan-pending-parser.ts:121-126`

**Issue:** `paneText.match(regex)` (no `/g` flag) returns the FIRST
occurrence of the footer pattern anywhere in the pane. `isPlanPending`
correctly anchors its footer-marker check to the bottom-30 slice (matching
`parseContextPct`'s locus-of-truth rationale documented at L47-52) so
prose/transcript quotes cannot false-positive. But the sibling
`parsePlanFilePath` scans the WHOLE pane, so a prior turn that quoted a
plan-file-shaped path in transcript prose (e.g., `assistant: "the last
plan I generated was ctrl-g to edit in  Vim  · ~/.claude/plans/old-slug.md"`)
takes precedence over the real footer path.

Consequence: the bubble shows plan CONTENTS for a slug that ISN'T what
Ink is currently prompting on. Ashley approves based on stale content.
Approval keystroke `1\r` still hits the real Ink prompt (approval works),
but she may approve a plan she didn't actually read. Slug is constrained
to `[a-z0-9-]+` so no injection surface, but the UX-integrity gap is real
and violates the parser's own docblock claim (L60): "these helpers are
what make it observable" — implying the footer is authoritative.

**Fix:** Match against the bottom slice, same as `isPlanPending`:

```typescript
export function parsePlanFilePath(paneText: string): string | null {
  const bottomSlice = paneText.split("\n").slice(-30).join("\n");
  const match = bottomSlice.match(
    /ctrl-g to edit in\s+Vim\s+·\s+(~\/\.claude\/plans\/[a-z0-9-]+\.md)/,
  );
  return match ? match[1] : null;
}
```

Add a corresponding test case: prose-earlier-decoy at line 5, real footer
at line 80 (past the bottom-30 window would return `null`; within it would
return the real one). Current tests only cover "no footer" and single-line
happy path.

### WR-02: `showSlotArmButton` scope-creeps `recycleActive` behavior beyond Phase 24

**File:** `src/ui/features/pretty-view/ComposeBox.tsx:2469-2474`

**Issue:** Pre-Phase-24, `showSlotArmButton = !asideActive && !slotArmed && slotHasText`
(git show 4490620:src/ui/features/pretty-view/ComposeBox.tsx L2440-2443).
The Phase 24 diff extends it to add BOTH `!recycleActive && !planPendingActive`.
Adding `!planPendingActive` is in-scope; adding `!recycleActive` is a
DIFFERENT behavior change (slot arm-idle button was previously visible
during session recycle; now it's hidden). The 24-05-SUMMARY key-decisions
block acknowledges this as a "pre-existing consistency gap" being closed
opportunistically, but this is exactly the kind of scope-creep that
subverts phase boundaries — a bug in the pre-existing behavior should
have its own commit/quick, not ride in on a plan-pending phase.

Impact: low (the gate is already narrow — slot text present + not armed +
not aside; and the CONTEXT does list "the queued-row aux buttons parity"
as a valid target). But the phase test suite does not cover the
recycleActive-only regression: if the pre-Phase-24 behavior was
intentional for a reason not documented (defensive UX for interrupted
composition?), the change is silent-breaking.

**Fix:** Either (a) split into a separate commit with its own quick
reference and its own test case for the recycleActive-only path, or (b)
add explicit prose in the code comment acknowledging the parity change
and a test in `ComposeBox.recycle-disable.test.tsx` for the slot arm-idle
disable-under-recycle assertion so the change is durable.

### WR-03: `raw_keystrokes` payload has no server-side size cap

**File:** `src/backend/claude-session/claude-session-server.ts:3196-3216`

**Issue:** The handler pattern is `String(msg.bytes ?? "")` with only an
`if (bytes.length === 0) return;` guard. A misbehaving/buggy client
(or forced payload) with a multi-megabyte feedback string flows straight
into `tmux send-keys -l -t 's1' 'huge...'`. The single-argv shell
command hits POSIX `ARG_MAX` (~128KB on many systems, higher on Linux)
and fails via `execCommand`'s reject path — that's fine on the send
side. But there is no upper bound before the shell attempt, so the
backend still spends time serializing a huge string and issuing an
exec channel that guaranteed-fails. Also, log line at L3213 records
`bytesLength: bytes.length` which is unbounded in the log payload —
fine for size but relevant if `bytes` is ever accidentally logged
verbatim by a future refactor.

Trust-boundary IS correct (uses `currentTmuxSession` bound at connect;
docblock is explicit about ignoring client-supplied targets). This is
robustness, not security.

**Fix:** Add a cap (e.g., 8KB is a comfortable upper bound for a
plan-feedback message):

```typescript
const MAX_RAW_KEYSTROKES_BYTES = 8 * 1024;
if (bytes.length > MAX_RAW_KEYSTROKES_BYTES) {
  sshLogger.warn("raw_keystrokes rejected: too large", {
    operation: "raw_keystrokes_reject_size",
    hostId: currentHostId,
    tmuxSession: currentTmuxSession,
    bytesLength: bytes.length,
  });
  return;
}
```

### WR-04: SFTP truncation slices UTF-8 mid-codepoint, corrupting the final characters

**File:** `src/backend/ssh/plan-file-fetch.ts:222-229`

**Issue:** `data.subarray(0, MAX_PLAN_BYTES).toString("utf8")` byte-slices
at exactly 512000. If that offset lands mid-codepoint (any file with
non-ASCII), Node.js's `toString("utf8")` inserts U+FFFD (replacement char)
for the incomplete trailing bytes. For a plan file with UTF-8 punctuation
(smart quotes, em-dashes, non-ASCII names in file paths), the last
character or two of the visible content will be garbled. Small integrity
issue but silent — Ashley won't know the truncation lost bytes vs
corrupted the boundary.

**Fix:** Use `TextDecoder({ fatal: false, ignoreBOM: false })` or the
`stream: true` decoder pattern, OR walk backward from `MAX_PLAN_BYTES`
to the last UTF-8 lead-byte boundary before slicing:

```typescript
function utf8SafeCutoff(buf: Buffer, maxBytes: number): number {
  if (buf.length <= maxBytes) return buf.length;
  let cut = maxBytes;
  // Walk back to the byte before a UTF-8 continuation byte (10xxxxxx).
  while (cut > 0 && (buf[cut] & 0xc0) === 0x80) cut -= 1;
  return cut;
}
// Then:
const cut = utf8SafeCutoff(data, MAX_PLAN_BYTES);
return {
  content: data.subarray(0, cut).toString("utf8") + TRUNCATED_SUFFIX,
  truncated: true,
};
```

### WR-05: `fetchPlanFile` opens TWO SFTP channels per cold fetch

**File:** `src/backend/ssh/plan-file-fetch.ts:192-198, 246-267`

**Issue:** `resolveHomeDir` calls `openSftp(sshConn)` internally to run
`realpath(".")`, then discards the handle. The exported `fetchPlanFile`
subsequently calls `openSftp(sshConn)` AGAIN to get another handle for
`stat` + `readFile`. On a cache-miss (first fetch per pane lifetime),
this doubles the SFTP channel opens. Channel open is not free on
higher-latency links (~50-150ms RTT each). Not a correctness bug
because SSH channel multiplexing supports it, and this happens exactly
once per pane. Performance is out-of-scope for v1, but this is also
a clarity issue — the code reads as if it deliberately isolates home
resolution, but the isolation costs a whole channel.

**Fix:** Fold the home-resolve call to accept a pre-opened sftp, and
pass the fetch's `sftp` in:

```typescript
async function resolveHomeDir(
  sshConn: SSHClientType,
  sftp: SftpLike,
): Promise<string> {
  const cached = homeDirCache.get(sshConn);
  if (cached) return cached;
  const resolved = await sftpRealpath(sftp, ".");
  homeDirCache.set(sshConn, resolved);
  return resolved;
}

// In fetchPlanFile:
const sftp = await openSftp(sshConn);
const resolvedHome = await resolveHomeDir(sshConn, sftp);
const absPath = `${resolvedHome}/.claude/plans/${format.slugWithExt}`;
const { content } = await sftpReadFileCapped(sftp, absPath);
```

## Info

### IN-01: `__resetHomeDirCacheForTest` is dead code — an exported no-op

**File:** `src/backend/ssh/plan-file-fetch.ts:85-90`

**Issue:** Exports an empty function whose body just has a comment
explaining WeakMap doesn't expose iteration. It's callable by tests but
does nothing useful. If a future test wants to actually reset the cache
between two calls that use the SAME mock Client instance, this hook
gives false confidence — the "reset" is a no-op.

**Fix:** Either delete it (preferred — tests currently construct fresh
mock Clients per case so the WeakMap does invalidate naturally), or
implement it correctly by swapping the module-level `homeDirCache` with
a fresh WeakMap:

```typescript
// Change `const homeDirCache = new WeakMap<...>()` to `let homeDirCache = ...`
export function __resetHomeDirCacheForTest(): void {
  homeDirCache = new WeakMap<SSHClientType, string>();
}
```

### IN-02: Feedback modal has no Escape-key handler

**File:** `src/ui/features/pretty-view/PlanPendingBubble.tsx:227-273`

**Issue:** `role="dialog" aria-modal="true"` on the overlay but no `onKeyDown`
that closes on Escape. Accessibility convention is Escape closes a modal
dialog. Backdrop-click closes correctly (L233-235), Cancel button works,
but keyboard-only users must Tab to Cancel.

**Fix:** Add a keydown handler to the dialog root:

```tsx
<div
  role="dialog"
  aria-modal="true"
  aria-label="Provide feedback for Claude"
  onKeyDown={(e) => { if (e.key === "Escape") closeFeedback(); }}
  className="..."
>
```

Also consider Cmd/Ctrl+Enter submitting (matches most textareas in the
codebase — a follow-up nit only).

### IN-03: Detection fingerprint could break if pane wraps the marker line

**File:** `src/backend/claude-session/plan-pending-parser.ts:74-76`

**Issue:** `bottomSlice.includes("shift+tab to approve with this feedback")`
requires the marker to appear on ONE line. If tmux window width is narrow
enough that Ink wraps that line (splitting on `this\n feedback`), detection
fails silently — bubble never mounts, Ashley never sees the actionable UI.
CONTEXT states the fleet is pinned to a specific Ink variant and terminal
setup, so this is unlikely in production, but the failure mode is
silent-broken (returns `false`) rather than raising a signal.

**Fix (defer-worthy):** Not required for MVP. If it does bite, a
whitespace-collapsing pre-normalize would fix it:

```typescript
const bottomSliceNormalized = bottomSlice.replace(/\s+/g, " ");
if (!bottomSliceNormalized.includes("shift+tab to approve with this feedback"))
  return false;
```

Or split the marker into two shorter substrings and require both
present in bottom slice.

### IN-04: `contentError` string is passed to UI unfiltered (surface size, not security)

**File:** `src/backend/ssh/plan-file-fetch.ts:270`, `src/ui/features/pretty-view/PlanPendingBubble.tsx:186`

**Issue:** `error: message` propagates whatever `err.message` returned by
ssh2's SFTP callback (e.g., `ENOENT: no such file or directory, open
'/home/ashley/.claude/plans/foo.md'`). That includes the full absolute
path, which then renders inside the bubble as `Plan contents unavailable
({contentError})`. React auto-escapes so no XSS, but:
(a) the string can be arbitrarily long, blowing out the bubble layout, and
(b) it leaks the actual home directory path into the UI, which is fine
for Ashley's local ops posture but slightly leaky for the "small dim line"
CONTEXT-specified affordance.

**Fix (defer-worthy):** Cap or classify the error at the fetch boundary:

```typescript
} catch (err) {
  const raw = err instanceof Error ? err.message : String(err);
  // Cap length + strip absolute-path noise for UI surfacing.
  const message = raw.length > 200 ? raw.slice(0, 200) + "…" : raw;
  return { error: message };
}
```

Or map to a small enum (`"not_found" | "permission_denied" | "network_error"
| "other"`) and let the UI localize per case.

---

_Reviewed: 2026-08-04T22:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

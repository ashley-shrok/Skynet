# Phase 24: Plan-mode approval bubble — Pattern Map

**Mapped:** 2026-08-04
**Files analyzed:** 9 (7 modifies + 2 new)
**Analogs found:** 9/9 (all files have strong analogs already in-tree)

## File Classification

| New/Modified File | Kind | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|------|-----------|----------------|---------------|
| `src/backend/claude-session/plan-pending-parser.ts` | MODIFY | pure text-helper | transform (pane→predicate/path) | `src/backend/claude-session/context-pct-parser.ts` (co-file sibling, same posture) | exact — same file gets extended |
| `src/backend/claude-session/plan-pending-parser.test.ts` | MODIFY | vitest pure-helper suite | synthetic-in/assert-out | `src/backend/claude-session/context-pct-parser.test.ts` (Ashley's fingerprint style) | exact |
| `src/backend/claude-session/claude-session-server.ts` | MODIFY | WS server + PTY orchestrator | request-response + emit-on-diff | itself (existing `plan_pending` emit site + `aside_arm`/`aside_dismissed` dispatch) | in-place extension |
| `src/backend/ssh/plan-file-fetch.ts` (proposed name) | NEW | SSH SFTP helper module | file-I/O (SFTP read once per pending window) | `src/backend/ssh/pretty-view-upload.ts` (SFTP write orchestrator) + `src/backend/ssh/file-manager-download-routes.ts` (SFTP readFile idiom) | strong role-match |
| `src/backend/ssh/plan-file-fetch.test.ts` (proposed name) | NEW | vitest SFTP-mock suite | mock-in/assert-out | `src/backend/ssh/pretty-view-upload.test.ts` (mockSftp harness) | exact |
| `src/ui/features/pretty-view/PlanPendingBubble.tsx` | MODIFY | React presentational component | props-in, buttons-out (fires WS-send callbacks) | itself (Phase 4 Glass treatment stays) + `src/ui/features/pretty-view/AsideBubble.tsx` (button-bearing bubble) | in-place expansion |
| `src/ui/features/pretty-view/PrettyView.tsx` | MODIFY | React feature root, WS consumer | event-driven state, prop-drill down | itself (existing `plan_pending` case handler + ComposeBox prop wiring for `asideActive`/`recycleActive`) | in-place extension |
| `src/ui/features/pretty-view/ComposeBox.tsx` | MODIFY | React composed input surface | prop-driven predicate gating | itself (existing `asideActive`/`recycleActive` prop shape) | in-place extension |
| `src/ui/api/claude-session-api.ts` | MODIFY | WS wire-type declarations | type declarations only | itself (existing `PlanPendingEvent` type) | in-place extension |
| Feedback modal (planner-choice — inline in `PlanPendingBubble.tsx` OR new file) | NEW-OR-INLINE | React modal | textarea input, Submit callback | `src/ui/features/pretty-view/IdentityModal.tsx` (radix-ui `DialogPrimitive` pattern) + `src/ui/sidebar/NewSessionDialog.tsx` L977-986 (raw `<textarea>` styled with `--color-pv-*` tokens) | role-match |

## Pattern Assignments

### `src/backend/claude-session/plan-pending-parser.ts` (pure text-helper, transform)

**Analog:** the file itself, plus `src/backend/claude-session/context-pct-parser.ts` for the co-file convention (zero imports, single named export, docblock heavy).

**Fingerprint-string fix (Decision § Detection — the load-bearing correction):**

Current (WRONG for pinned fleet Ink variant) at `plan-pending-parser.ts` L66-79:
```typescript
const bottomSlice = paneText.split("\n").slice(-30).join("\n");
if (!bottomSlice.includes("No, keep planning")) return false;
if (
  !paneText.includes("Here is Claude's plan:") &&
  !paneText.includes("Ready to code?")
) {
  return false;
}
return true;
```

Replace with (verbatim from CONTEXT § Specific Ideas — do NOT paraphrase these strings):
```typescript
const bottomSlice = paneText.split("\n").slice(-30).join("\n");
if (!bottomSlice.includes("shift+tab to approve with this feedback")) return false;
if (!paneText.includes("Claude has written up a plan and is ready to execute. Would you like to proceed?")) {
  return false;
}
return true;
```

The two-condition fingerprint SHAPE stays (bottom-slice marker AND header-anywhere) — only the two strings and the reduction from two-header-variants to one change (pinned fleet is single-variant per Ashley 2026-08-04). Slice size stays 30 lines. Docblock's rationale for BOTTOM+HEADER combo still applies verbatim.

**New helper `parsePlanFilePath(paneText: string): string | null`** — added in the same file, same pure-helper posture, same zero-imports:

Footer line format (verbatim from CONTEXT § Specifics — Amelia's pane 2026-08-04):
```
ctrl-g to edit in  Vim  · ~/.claude/plans/<slug>.md
```

Note: double space between "in" and "Vim", middle-dot `·` (U+00B7) between "Vim" and the path.

Suggested implementation shape (planner locks specifics; the regex is illustrative):
```typescript
export function parsePlanFilePath(paneText: string): string | null {
  // Only the footer of the plan-approval prompt carries this line; safe to
  // scan whole pane because slug regex + full-path validation happen in the
  // SFTP-fetch caller (security boundary lives there, NOT in the parser).
  const match = paneText.match(/ctrl-g to edit in\s+Vim\s+·\s+(~\/\.claude\/plans\/[a-z0-9-]+\.md)/);
  return match ? match[1] : null;
}
```

Return `null` when not found; do NOT throw. Detection presence is authoritative — a missing path just means content-fetch skips.

**Docblock update:** the existing 30-line docblock (FINGERPRINT section) needs its `No, keep planning` / `Here is Claude's plan:` / `Ready to code?` prose rewritten to reflect the pinned variant. Preserve WHY-A-PANE-SCRAPE-INSTEAD-OF-THE-JSONL section verbatim (the patch #63 legacy-JSONL rationale stays intact; only the specific string names change).

---

### `src/backend/claude-session/plan-pending-parser.test.ts` (vitest pure-helper suite)

**Analog:** itself + `context-pct-parser.test.ts` (both use synthetic pane strings with no I/O / no mocks).

**Existing test structure to update** (`plan-pending-parser.test.ts` L17-107):
- Two positive tests currently target the 3-option (`--dangerously-skip-permissions`) and 2-option (default) header variants with `No, keep planning` marker.
- Update fixtures to the pinned fleet Ink variant — a single positive case with `Claude has written up a plan and is ready to execute. Would you like to proceed?` header and `shift+tab to approve with this feedback` in bottom-slice.
- Negative cases (empty, prose-quote, random terminal output) survive structurally with new fingerprint — the strings referenced in the prose quotes need swapping.

**New tests for `parsePlanFilePath`:**
```typescript
describe("parsePlanFilePath — footer path extraction (Phase 24)", () => {
  it("extracts the tilde-relative plans path from the footer with the exact Ink spacing", () => {
    const pane = [
      "some earlier lines",
      "ctrl-g to edit in  Vim  · ~/.claude/plans/groovy-watching-leaf.md",
    ].join("\n");
    expect(parsePlanFilePath(pane)).toBe("~/.claude/plans/groovy-watching-leaf.md");
  });
  it("returns null when the footer is absent (presence detection still authoritative)", () => {
    expect(parsePlanFilePath("no footer here")).toBeNull();
  });
  // Slug edge cases: reject `..`, `/`, uppercase, punctuation — verify the regex
  // in the parser only accepts `^[a-z0-9-]+$`.
});
```

Test conventions (copy from `context-pct-parser.test.ts` L1-9): `import { describe, it, expect } from "vitest";` + top-of-file scaffolding comment explaining the pure-helper posture.

---

### `src/backend/claude-session/claude-session-server.ts` (WS server + PTY orchestrator)

**Analog:** itself. Three existing sites to extend.

**Site 1: Sentinel state variable** (L1045):
```typescript
let planPendingLastSerialized = "null";
```
Add a companion cache for the fetched plan contents, keyed by `(pending-window-open, planFilePath)`. When the pending-window transitions closed (`isPlanPending` returns false), invalidate.

**Site 2: Emit site inside the setInterval** (L3345-3371):

Current shape:
```typescript
const currentPending = isPlanPending(output)
  ? { planFilePath: "" }
  : null;
const pendingSerialized = JSON.stringify(currentPending);
if (pendingSerialized !== planPendingLastSerialized) {
  planPendingLastSerialized = pendingSerialized;
  try {
    ws.send(
      JSON.stringify({
        type: "plan_pending",
        pending: currentPending,
      }),
    );
  } catch { /* ws may be mid-close */ }
}
```

Extended shape per CONTEXT § WS frame shape:
```typescript
const isPending = isPlanPending(output);
const planFilePath = isPending ? parsePlanFilePath(output) : null;
// New shape: { planFilePath, planContent, contentError } | null
const currentPending = isPending
  ? { planFilePath, planContent: null, contentError: null }
  : null;
// De-dup guard preserved (JSON-serialize compare)
const pendingSerialized = JSON.stringify(currentPending);
if (pendingSerialized !== planPendingLastSerialized) {
  planPendingLastSerialized = pendingSerialized;
  try {
    ws.send(JSON.stringify({ type: "plan_pending", pending: currentPending }));
  } catch { /* ws may be mid-close */ }
  // On transition-into-pending with a resolvable planFilePath, kick off async SFTP fetch.
  // On success/failure, emit a follow-up plan_pending frame with the contentError | planContent
  // populated. See fetch trigger below.
  if (isPending && planFilePath && sshConn) {
    void fetchPlanFileAndEmit({
      sshConn,
      username: currentSshUser, // planner threads from the connection's captured state
      planFilePath,
      ws,
      onEmit: (updated) => {
        // Re-emit the extended plan_pending frame with populated planContent OR contentError.
        // De-dup guard applies here too — JSON-serialize-compare against planPendingLastSerialized.
      },
    });
  }
}
```

**Site 3: Teardown reset** (L1121-1123):
```typescript
pendingPlans.clear();
pendingPlansLastSerialized = "null";
planPendingLastSerialized = "null";
```
Add: invalidate the fetched-content cache. This runs on `teardownPane` (rebind or disconnect).

**Site 4: Raw-keystroke send WS handler (NEW dispatch case).** Analog: L3090-3145 `aside_arm` / `aside_dismissed` handlers.

Copy the shape verbatim; call it (planner picks: `raw_keystrokes` or `plan_reply` — CONTEXT defers). Reuses `sshConn` + captured `currentTmuxSession`, ignores client-supplied hostId/tmuxSession per T-14-02-01 mitigation:

```typescript
if (msg.type === "raw_keystrokes") {
  if (!sshConn || !currentTmuxSession) return;
  const bytes = String((msg as { bytes?: unknown }).bytes ?? "");
  // Send in ONE shot (no split) via `tmux send-keys -l` (literal, so a leading
  // `1` doesn't get interpreted as a key-name). Terminating \r comes from
  // caller (Approve: "1\r"; Feedback: "3<feedback>\r"). shellQuote the payload.
  await execCommand(
    sshConn,
    `tmux send-keys -l -t ${shellQuote(currentTmuxSession)} ${shellQuote(bytes)}`,
  );
  return;
}
```

**CRITICAL — split-send anti-pattern.** Do NOT reuse the existing terminal.ts split-send (patch #44's body-event-then-\r-event with 60ms gap). Per PlanPendingBubble.tsx L14-21 lesson: Ink Plan Mode does NOT recognize the split as a keystroke selection. The load-bearing constraint is "one write, no split." Using `tmux send-keys -l` with the whole payload in one call satisfies this.

**Docblock stanza** (added to the WS FRAMES section around L85 — extending the existing `{ type: "plan_pending", pending }` line):
```
{ type: "plan_pending", pending }   // pending = { planFilePath, planContent, contentError } | null
{ type: "raw_keystrokes", bytes }   // client -> server; one-shot write to the PTY, no split (Phase 24)
```

---

### `src/backend/ssh/plan-file-fetch.ts` (NEW SFTP fetch module)

**Analog:** `src/backend/ssh/pretty-view-upload.ts` (SFTP-orchestrator posture) + `src/backend/ssh/file-manager-download-routes.ts` L98-168 (SFTP `readFile` callback shape).

**File-header docblock structure** (mirror `pretty-view-upload.ts` L1-28):
```typescript
/**
 * Plan-file SFTP fetch (Phase 24, side-channel).
 *
 * Reads the Claude Code plan file (~/.claude/plans/<slug>.md) via SFTP on
 * the pane's EXISTING SSH connection. Zero new handshake — the ssh2 Client
 * that already drives the pane's tmux capture-pane / send-keys traffic
 * also exposes .sftp() for a second subsystem channel.
 *
 * Threat mitigations:
 *   T-24-01  path traversal        — slug regex + full-path string compare
 *   T-24-02  network on bad input  — validate BEFORE calling .sftp()
 *   T-24-03  OOM via large file    — 500KB read cap (defense-in-depth)
 *   T-24-04  path injection        — SFTP subsystem, no shell (no `cat`)
 */
```

**Imports pattern** (from `pretty-view-upload.ts` L30-43):
```typescript
import type { Client as SSHClientType } from "ssh2";
import { sshLogger } from "../utils/logger.js";
```

**SFTP-open promise wrapper** (verbatim from `pretty-view-upload.ts` L187-198):
```typescript
function openSftp(sshConn: SSHClientType): Promise<SftpLike> {
  return new Promise((resolve, reject) => {
    (sshConn as unknown as {
      sftp: (cb: (err: Error | null, sftp: SftpLike) => void) => void;
    }).sftp((err, sftp) => {
      if (err) return reject(err);
      resolve(sftp);
    });
  });
}
```

**Read-with-cap pattern** (adapted from `file-manager-download-routes.ts` L135-142 + CONTEXT § Read cap 500KB):
```typescript
const MAX_PLAN_BYTES = 500 * 1024; // 512000 — CONTEXT § Specifics locked constant

function sftpReadFileCapped(sftp: SftpLike, path: string): Promise<{ content: string; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    sftp.readFile(path, (err: Error | null, data: Buffer) => {
      if (err) return reject(err);
      if (data.length > MAX_PLAN_BYTES) {
        // Truncate + append the [truncated] marker per CONTEXT § "Very long plan"
        resolve({
          content: data.subarray(0, MAX_PLAN_BYTES).toString("utf8") + "\n\n[truncated]",
          truncated: true,
        });
      } else {
        resolve({ content: data.toString("utf8"), truncated: false });
      }
    });
  });
}
```

Note: `file-manager-download-routes.ts` uses `sftp.stat` first to check size before reading. That's the safer pattern — planner should use `stat` first and refuse (or short-read) if `stats.size > MAX_PLAN_BYTES`, rather than relying on Node buffering the full read into memory. The `readFile` cap-then-slice above is illustrative; the stat-then-cap flow is preferred.

**Path validation (security boundary — CONTEXT § Path validation, MUST have tests):**

```typescript
const SLUG_RE = /^[a-z0-9-]+$/;

function resolveHomeDir(sshConn: SSHClientType): Promise<string> {
  // Cache per-tab lifetime. One-shot: `echo $HOME` via execCommand OR
  // sftp.realpath(".") shape from pretty-view-upload.ts L420-423.
  // planner picks; sftpRealpath is one fewer roundtrip.
}

function validatePlanPath(rawPath: string, resolvedHome: string): { ok: true; absPath: string } | { ok: false; error: string } {
  // Reject `..`, `/` in slug, backticks/quotes/$, absolute paths that don't
  // start with resolvedHome + "/.claude/plans/".
  if (rawPath.includes("..")) return { ok: false, error: "invalid plan path" };
  // Normalize tilde-prefix: `~/.claude/plans/<slug>.md` → `<resolvedHome>/.claude/plans/<slug>.md`
  const stripped = rawPath.replace(/^~\//, "");
  const expectedPrefix = ".claude/plans/";
  if (!stripped.startsWith(expectedPrefix)) return { ok: false, error: "invalid plan path" };
  const slugWithExt = stripped.slice(expectedPrefix.length);
  if (!slugWithExt.endsWith(".md")) return { ok: false, error: "invalid plan path" };
  const slug = slugWithExt.slice(0, -3);
  if (!SLUG_RE.test(slug)) return { ok: false, error: "invalid plan path" };
  return { ok: true, absPath: `${resolvedHome}/${stripped}` };
}
```

**Exported top-level fetch function** (planner picks exact signature):
```typescript
export async function fetchPlanFile(
  sshConn: SSHClientType,
  planFilePath: string, // tilde-relative from parser, e.g. `~/.claude/plans/groovy-watching-leaf.md`
): Promise<{ content: string } | { error: string }> {
  const resolvedHome = await resolveHomeDir(sshConn);
  const validated = validatePlanPath(planFilePath, resolvedHome);
  if (!validated.ok) return { error: validated.error };
  const sftp = await openSftp(sshConn);
  const { content } = await sftpReadFileCapped(sftp, validated.absPath);
  return { content };
}
```

**Deviation notes from `pretty-view-upload.ts`:**
- Read-only vs write-heavy: no batch state, no per-file map, no `messageQueueItemId`. This module is a single fetch call, not a pipeline.
- No WS frame emission from this module — the caller (`claude-session-server.ts`'s setInterval) owns the emit. This module returns `{content}|{error}` and the caller re-emits the extended `plan_pending` frame.
- Uses `sshLogger` from `../utils/logger.js` for failure logs (same import path as `pretty-view-upload.ts` L43).

**Fallback branch (CONTEXT § "if the SSH abstraction does NOT expose the underlying Client"):** planner verifies. Given the codebase evidence — `claude-session-server.ts` L969 declares `let sshConn: SSHClientType | null = null;` and passes this raw `SSHClientType` to `execCommand`, `injectBtw`, `dismissBtw`, `execCommand` all take a `Client` directly — the Client IS exposed. Fallback branch (fresh handshake) is DOCUMENTED-BUT-NOT-BUILT per CONTEXT § Claude's Discretion.

---

### `src/backend/ssh/plan-file-fetch.test.ts` (NEW vitest suite)

**Analog:** `src/backend/ssh/pretty-view-upload.test.ts` L1-100 (mockSftp harness + vitest structure).

**Mock SFTP shape** (adapt from `pretty-view-upload.test.ts` L59-100):
```typescript
interface MockSftp {
  realpath: Mock;
  stat: Mock;
  readFile: Mock;
  __plans: Map<string, Buffer>;
}

function makeMockSftp(plans: Record<string, string> = {}): MockSftp {
  const map = new Map<string, Buffer>(
    Object.entries(plans).map(([k, v]) => [k, Buffer.from(v, "utf8")]),
  );
  return {
    realpath: vi.fn((p, cb) => queueMicrotask(() => cb(null, "/home/ashley"))),
    stat: vi.fn((p, cb) => queueMicrotask(() => {
      if (map.has(p)) cb(null, { size: map.get(p)!.length, isFile: () => true });
      else { const e = new Error("ENOENT") as Error & { code: number }; e.code = 2; cb(e); }
    })),
    readFile: vi.fn((p, cb) => queueMicrotask(() => {
      if (map.has(p)) cb(null, map.get(p)!);
      else { const e = new Error("ENOENT") as Error & { code: number }; e.code = 2; cb(e); }
    })),
    __plans: map,
  };
}
```

**Mock SSH Client** (that returns the mock SFTP when `.sftp(cb)` is called) — copy the ssh2-Client mock shape from `pretty-view-upload.test.ts` (search for `sftp: vi.fn`).

**Required test cases** (per CONTEXT § Path validation MUST have tests):

| Case | Input | Expected |
|------|-------|----------|
| Happy path | `~/.claude/plans/groovy-watching-leaf.md` + file exists | `{ content: "..." }` |
| Traversal reject | `~/.claude/plans/../../../etc/passwd.md` | `{ error: "invalid plan path" }`, no `.sftp()` call |
| Backtick reject | `~/.claude/plans/\`whoami\`.md` | `{ error: "invalid plan path" }` |
| Quote reject | `~/.claude/plans/foo'bar.md` | `{ error: "invalid plan path" }` |
| Dollar reject | `~/.claude/plans/$USER.md` | `{ error: "invalid plan path" }` |
| Uppercase reject | `~/.claude/plans/FooBar.md` | `{ error: "invalid plan path" }` (slug regex `^[a-z0-9-]+$`) |
| Non-plans absolute path reject | `/etc/passwd` | `{ error: "invalid plan path" }` |
| Missing .md suffix | `~/.claude/plans/foo` | `{ error: "invalid plan path" }` |
| 500KB truncation | 600KB file | `{ content }` with content length ≤ MAX_PLAN_BYTES + "[truncated]" suffix |
| SFTP readFile error | ENOENT | `{ error: "..." }` (propagates SFTP error string) |
| Home directory resolution success | mock realpath returns `/home/ashley` | validated absPath uses `/home/ashley/.claude/plans/...` |

**Test skeleton** (mirroring `pretty-view-upload.test.ts` L1-25):
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchPlanFile } from "./plan-file-fetch.js";
// ... mock harnesses above ...

describe("plan-file-fetch — Phase 24 SFTP side-channel + path validation", () => {
  it("happy path returns file contents when slug matches regex + file exists", async () => { /* ... */ });
  it("rejects `..` in path without touching SFTP", async () => {
    const sftp = makeMockSftp({});
    const conn = makeMockSshClient(sftp);
    const result = await fetchPlanFile(conn, "~/.claude/plans/../../../etc/passwd.md");
    expect("error" in result).toBe(true);
    expect(sftp.realpath).not.toHaveBeenCalled(); // fail-closed before network
  });
  // ... other cases from table ...
});
```

---

### `src/ui/features/pretty-view/PlanPendingBubble.tsx` (React presentational component)

**Analog:** itself (Phase 4 Glass treatment stays verbatim per CONTEXT § Bubble UI "don't fight the existing identity-hue treatment") + `src/ui/features/pretty-view/AsideBubble.tsx` (only other bubble that currently carries interactive controls — for button styling precedent inside a bubble).

**Preserve verbatim from L32-60:**
- The outer `<div className={cn("flex", "justify-start")}>` wrapper.
- The `role="status"` inner div's className cascade — all Phase 4 Glass tokens (`rounded-[var(--radius-pv-bubble)]`, `backdrop-blur-xl saturate-150`, the identity-hue linear-gradient, border, shadow).
- The ClipboardList glyph + "Plan proposed — awaiting your approval" as the header line.

**Add: props interface** (new — currently the component takes zero props):
```typescript
export interface PlanPendingBubbleProps {
  planFilePath: string | null;
  planContent: string | null;
  contentError: string | null;
  onApprove: () => void;    // fires `raw_keystrokes` with "1\r"
  onFeedback: (feedback: string) => void; // fires `raw_keystrokes` with `3${feedback}\r`
}
```

**Add: middle plan-contents section** (grow the vertical container downward):

Fallback state matrix per CONTEXT § Bubble UI:
- `planContent === null && !contentError && planFilePath` → "Loading plan…" italic (NO spinner per docblock L23-27 — motion channel is owned by WipBubble; plan-pending is "waiting on you", opposite of spinner semantics).
- `contentError !== null` → small dim "Plan contents unavailable ({error})" line, buttons still work.
- `planFilePath === null` → skip middle section entirely, buttons still work.
- `planContent !== null` → render in `<pre>` monospace block per CONTEXT § Claude's Discretion "plain `<pre>` is the safe MVP".

**Add: footer with buttons** — planner picks button primitives (shadcn `Button` variant `default` for Approve, `secondary` for Feedback per CONTEXT § "use existing button primitives, no new components"). Approve = primary, Feedback = secondary, side-by-side.

**Docblock updates:**
- Preserve L14-21 (the split-send-anti-pattern warning) — this phase respects the lesson by using the new `raw_keystrokes` WS frame path, NOT compose's split-send.
- Preserve L23-27 (spinner-glyph warning) — this phase respects it by using an italic "Loading plan…" text state, not a spinner glyph.
- Add: patch tag (Phase 24) documenting the expansion and the button send-path rationale.

---

### `src/ui/features/pretty-view/PrettyView.tsx` (React feature root, WS consumer)

**Analog:** itself.

**Existing state (L210-212) — extend the shape:**
```typescript
const [planPending, setPlanPending] = useState<
  { planFilePath: string } | null
>(null);
```
Extended to match the new WS frame:
```typescript
const [planPending, setPlanPending] = useState<
  { planFilePath: string | null; planContent: string | null; contentError: string | null } | null
>(null);
```

**Existing WS handler (L643-646):**
```typescript
case "plan_pending": {
  setPlanPending(parsed.pending);
  break;
}
```
Stays byte-for-byte — the shape widening is invisible here since we just `setPlanPending(parsed.pending)`.

**Existing bubble mount (L1272):**
```typescript
{planPending && <PlanPendingBubble />}
```
Extend to pass props + handlers:
```typescript
{planPending && (
  <PlanPendingBubble
    planFilePath={planPending.planFilePath}
    planContent={planPending.planContent}
    contentError={planPending.contentError}
    onApprove={handlePlanApprove}
    onFeedback={handlePlanFeedback}
  />
)}
```

Handlers send `raw_keystrokes` WS frames via `wsRef.current?.send(JSON.stringify({...}))` — same pattern as the existing `aside_dismissed` send in `handleAsideDismiss`.

**Existing ComposeBox invocation (L1367-1435) — add `planPendingActive` prop:**

Current shape at L1379:
```typescript
recycleActive={showOverlay}
```

Add sibling prop:
```typescript
planPendingActive={planPending !== null}
```

Same pattern as `recycleActive={showOverlay}` and `asideActive={asideText !== null || asidePending}` — a boolean derived from an existing state variable.

**Docblock stanza** (near the setPlanPending state declaration) — expand L203-212's comment to reflect that `planFilePath` IS now displayed (bubble renders content), no longer just presence:
```typescript
// Phase 24: presence detection still authoritative for bubble mount/unmount,
// but the bubble now RENDERS the plan file contents (fetched async by the
// backend via SFTP side-channel) plus [Approve] + [Feedback] buttons.
```

---

### `src/ui/features/pretty-view/ComposeBox.tsx` (React composed input surface)

**Analog:** itself. Copy the `recycleActive` prop shape verbatim (Ashley 2026-08-04 CONTEXT lock: "match recycleActive treatment").

**Add prop to interface** (mirror L256-281 `recycleActive` docblock verbatim + rewrite for planPendingActive):

Add after L281 `recycleActive?: boolean;`:
```typescript
  // Phase 24: plan-mode approval prompt is pending. When true, every WS-side-
  // effecting compose control is disabled (Send button STAYS as Send but
  // disabled=true; reset, ThumbsUp, Recap, Queue all disabled). Textarea
  // REMAINS typeable so Ashley can pre-draft her feedback message while the
  // plan-approval prompt is open — matches the recycleActive behavior verbatim.
  //
  // Why SEPARATE from asideActive AND recycleActive (per CONTEXT § "Do NOT
  // collapse"): asideActive MORPHS Send into X/Resume; recycleActive keeps
  // Send as Send but disabled; planPendingActive follows the recycleActive
  // treatment. Because the Send-button behavior differs across the three,
  // props stay independent. For every aux-button disable predicate that
  // reads `|| recycleActive === true`, also OR-in `|| planPendingActive === true`.
  //
  // Value from PrettyView: `planPending !== null` — flipped by the WS
  // `plan_pending` frame handler.
  planPendingActive?: boolean;
```

**Add to destructured props (L307-310):**
```typescript
  recycleActive,
  planPendingActive,
```

**OR-in `planPendingActive` at every disable predicate that currently reads `recycleActive`.** Sites identified from canonical_refs + grep:

| Line | Current predicate | Add clause |
|------|-------------------|------------|
| 1374 | `if (recycleActive) return;` (Enter-key swallow in handleKeyDown) | `if (recycleActive || planPendingActive) return;` |
| 1445 | `!recycleActive` (`showPrimaryArmButton` gate) | `&& !planPendingActive` |
| 1477 | `recycleActive === true \|\|` (`sendDisabled` composite) | `planPendingActive === true \|\|` clause added |
| 1614 | `disabled={canSend === false \|\| asideActive === true \|\| recycleActive === true \|\| voice.state === "transcribing"}` (Reset button) | append `\|\| planPendingActive === true` |
| 1836 | `disabled={canSend === false \|\| asideActive === true \|\| recycleActive === true}` (ThumbsUp) | append `\|\| planPendingActive === true` |
| 1866 | `disabled={canSend === false \|\| asideActive === true \|\| recycleActive === true}` (Recap) | append `\|\| planPendingActive === true` |
| 1908-1909 | `asideActive={asideActive} recycleActive={recycleActive}` (QueuedRow props) | add `planPendingActive={planPendingActive}` |
| 2596 | `disabled={canSend === false \|\| asideActive === true \|\| recycleActive === true}` (queued-row Paperclip) | append `\|\| planPendingActive === true` |
| 2347-2348 | `QueuedRowProps.asideActive/recycleActive` interface | add `planPendingActive?: boolean;` |
| 2378-2379 | destructured props in QueuedRow | add `planPendingActive,` |
| 2440-2443 | `showSlotArmButton` gate `!asideActive && !slotArmed && slotHasText` | append `&& !planPendingActive` (parity with primary L1441-1445 + recycleActive's compose parity) |

**Textarea `disabled`:** DO NOT touch. Textarea stays typeable during planPendingActive per CONTEXT § "Textarea typing: stays enabled".

**Reset-click handler (L1374 pattern):** Already returns early on `recycleActive`. Add `|| planPendingActive` to that early return so the Reset button's click (if somehow reachable) is swallowed.

**Send button (~L2220-2247):** The button is `disabled` by the composite `sendDisabled` (L1475-1479) which now includes `planPendingActive`. No new morph. `asideActive` still morphs to X/Resume when set; `planPendingActive` alone does NOT morph (Send stays as Send). This matches recycleActive verbatim.

**Deviation from `recycleActive` pattern:** none. This is a straight copy — same shape, same call sites, same textarea-stays-typeable behavior.

---

### `src/ui/features/pretty-view/ComposeBox.recycle-disable.test.tsx` → template for NEW test file `ComposeBox.plan-pending-disable.test.tsx`

**Analog:** `ComposeBox.recycle-disable.test.tsx` (the recycleActive test file — verbatim shape template).

**Copy the file structure L1-148 verbatim,** substituting `recycleActive` → `planPendingActive` in prop names and test descriptions. Cases to mirror:

| Test ID | Existing recycleActive case (L66-148) | planPendingActive equivalent |
|---------|----------------------------------------|-------------------------------|
| B1 | Send button disabled but NOT morphed (still aria-label "Send") | same — planPendingActive doesn't morph |
| B2 | reset + thumbs-up + recap disabled | same — all three aux buttons disabled |
| B3 | textarea stays typeable | same |
| B4 | Enter key does NOT fire onSend | same — handleKeyDown early-return |
| B5 | baseline (planPendingActive=false) — Send fires normally | same |
| B6 | draft survives planPendingActive true→false transition | same |
| C1 | Paperclip stays usable during planPendingActive | same (mic-available-when-composebox-disabled bounty parity) |
| C2 | MicButton stays enabled | same |
| C3 | Voice transcript lands in textarea but does NOT dispatch | same |

---

### `src/ui/api/claude-session-api.ts` (WS wire-type declarations)

**Analog:** itself L108-111 (the existing `PlanPendingEvent`).

Current:
```typescript
export type PlanPendingEvent = {
  type: "plan_pending";
  pending: { planFilePath: string } | null;
};
```

Extended (in-place edit to the same type, since server-emit shape is widening):
```typescript
export type PlanPendingEvent = {
  type: "plan_pending";
  pending: {
    planFilePath: string | null;
    planContent: string | null;
    contentError: string | null;
  } | null;
};
```

**Add new client→server payload type** for the raw-keystroke send. Analog: `AsideDismissedPayload` L267-271.

```typescript
// Phase 24 — client -> server. One-shot write to the PTY of raw keystroke
// bytes. Used by PlanPendingBubble Approve ("1\r") + Feedback modal Submit
// ("3<feedback>\r"). Deliberately NOT the ComposeBox split-send path
// (patch #44's body+\r-with-60ms-gap) — Ink Plan Mode does NOT recognize
// split-send as a keystroke selection (see PlanPendingBubble.tsx L14-21).
// Backend writes via `tmux send-keys -l` in a single call.
export type RawKeystrokesPayload = {
  type: "raw_keystrokes";
  bytes: string;
};
```

---

### Feedback modal (planner picks: NEW file OR inline in `PlanPendingBubble.tsx`)

**Analog options** (planner-choice per CONTEXT § Claude's Discretion "planner picks whether new file or inline; use existing modal primitive"):

1. **radix-ui Dialog** — `src/ui/features/pretty-view/IdentityModal.tsx` L3-7 imports + L883-1420 usage. Uses `DialogPrimitive.Root` / `Portal` / `Overlay` / `Content` from `radix-ui`. Heavier — comes with backdrop, portal, focus trap.

2. **Inline overlay in the bubble** — simpler for a single textarea + Submit + Cancel. Same absolute-position pattern as the aside armed overlay (`ComposeBox.tsx` L2559-2589) can be reused.

**Textarea styling analog** — `src/ui/sidebar/NewSessionDialog.tsx` L977-986 (uses `--color-pv-*` tokens):
```typescript
<textarea
  id="feedback-body"
  aria-label="Feedback"
  value={feedback}
  onChange={(e) => setFeedback(e.target.value)}
  placeholder="Your feedback for Claude…"
  rows={3}
  className="w-full rounded-sm border border-[color:var(--color-pv-border-quiet)] bg-[color:var(--color-pv-surface-quiet)] px-3 py-2 text-xs text-[color:var(--color-pv-fg)] placeholder:text-[color:var(--color-pv-fg-dim)] outline-none resize-none disabled:opacity-50"
/>
```

**Submit behavior:** fires `onFeedback(feedback)` prop back up to `PlanPendingBubble` which fires `raw_keystrokes` with `3${feedback}\r`. Modal closes on Submit AND on Cancel. Empty feedback: planner picks (probably disable Submit when trimmed empty).

**MVP scope (CONTEXT § Deferred):** plain textarea + Submit + Cancel only. No paste-image, no markdown preview, no template snippets.

---

## Shared Patterns

### Two-file-parity for pretty-view frontend tests

**Source:** `ComposeBox.recycle-disable.test.tsx` for `recycleActive`; a NEW file `ComposeBox.plan-pending-disable.test.tsx` for `planPendingActive`.

**Apply to:** the planPendingActive prop tests.

**Rationale:** each of the three ComposeBox prop-based disable modes (asideActive, recycleActive, planPendingActive) gets its OWN test file so the disable-truth-table is exhaustively covered per prop without collision. Files are already `ComposeBox.aside-props.test.tsx`, `ComposeBox.aside-morph.test.tsx`, `ComposeBox.recycle-disable.test.tsx` — same convention.

### WS-frame emit-on-diff (backend)

**Source:** `claude-session-server.ts` L1455-1468 (existing plan_pending emit) + L3358-3370 (pane-scrape emit).

**Apply to:** the extended `plan_pending` frame with `planFilePath`/`planContent`/`contentError`. De-dup guard preserved — `JSON.stringify(currentPending) !== planPendingLastSerialized` before every ws.send. Same posture across the two emit sites (JSONL scan + pane scrape) — same sentinel, same JSON-stringify compare.

```typescript
const serialized = JSON.stringify(currentPending);
if (serialized !== planPendingLastSerialized) {
  planPendingLastSerialized = serialized;
  try {
    ws.send(JSON.stringify({ type: "plan_pending", pending: currentPending }));
  } catch { /* ws may be mid-close */ }
}
```

### Trust-boundary: connection-captured state, never client-supplied

**Source:** `claude-session-server.ts` L3127-3131 (aside_dismissed T-14-02-01 mitigation comment) + L3138-3139 (uses `currentTmuxSession`, IGNORES msg.tmuxSession).

**Apply to:** the new `raw_keystrokes` handler. hostId/tmuxSession derive from the connection's captured `currentHostId`/`currentTmuxSession` set during `connectToPane` discovery — never from the client payload.

### SFTP-open callback promise wrapper

**Source:** `pretty-view-upload.ts` L187-198.

**Apply to:** the new plan-file-fetch.ts. Verbatim reusable — same shape.

### Pure-helper test file structure (vitest, zero I/O, zero mocks)

**Source:** `context-pct-parser.test.ts` L1-9 header + `plan-pending-parser.test.ts` L1-16 header.

**Apply to:** the extended `plan-pending-parser.test.ts` (new `parsePlanFilePath` cases). Synthetic pane string in; boolean or string-or-null out. No SSH, no WebSocket mocks.

### tmux send-keys shellQuote convention

**Source:** `claude-session-server.ts` L228, L233, L286, L295 (`injectBtw` + `dismissBtw`) and terminal.ts L587, L773.

**Apply to:** the new `raw_keystrokes` backend handler's `execCommand` call. Payload string always wrapped in `shellQuote()`. For sending literal bytes (Approve `1\r`, Feedback `3<feedback>\r`), use `tmux send-keys -l` (literal flag) so that `1`, `3`, or `\r` inside the payload are not interpreted as key-names by tmux.

## No Analog Found

None. Every file has a strong existing analog in the codebase:
- The 3 modified backend files have prior-art in themselves or their pure-helper sibling.
- The 1 new backend file (SFTP fetch) has strong analogs in `pretty-view-upload.ts` + `file-manager-download-routes.ts`.
- The 4 modified frontend files have prior-art in themselves; ComposeBox has the exact-shape `recycleActive` precedent from quick 260729-j8l.
- The Feedback modal (new-or-inline) has two viable analogs (IdentityModal radix-ui + inline armed-overlay).

## Metadata

**Analog search scope:**
- `src/backend/claude-session/*.ts` (pure-helper conventions, WS server structure)
- `src/backend/ssh/*.ts` (SFTP + SSH Client abstraction, home-dir resolution, path validation)
- `src/ui/features/pretty-view/*.tsx` (bubble component patterns, ComposeBox disable-prop conventions, modal patterns)
- `src/ui/api/*.ts` (WS wire-type declarations)
- `src/ui/sidebar/NewSessionDialog.tsx` (textarea styling with pretty-view tokens)

**Files scanned:** ~60 (via grep + directory listings)

**Pattern extraction date:** 2026-08-04

**Key architectural anchors this phase respects (canonical_refs bakes them in):**
- Two-condition fingerprint SHAPE (bottom-slice + header-anywhere) stays; only strings change.
- Pane is the authoritative live signal (not JSONL) per patch #63 dead-detection lesson.
- Split-send is NOT reusable for plan-mode replies (patch #67 retraction lesson).
- ComposeBox disable-props stay INDEPENDENT (no combined interactionsDisabled flag).
- Textarea stays typeable across all three disable modes (aside, recycle, plan-pending).
- SFTP subsystem, NOT `cat` over a shell (path-injection defense).
- Trust-boundary: connection-captured hostId/tmuxSession, never client-supplied.
- Backend is a pure translator; the tmux pane IS source of truth (same posture as aside subsystem Phase 14).

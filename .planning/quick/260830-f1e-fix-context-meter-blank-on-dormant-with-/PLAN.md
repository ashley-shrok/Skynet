---
quick_id: 260830-f1e
slug: fix-context-meter-blank-on-dormant-with-
date: 2026-08-30
status: in-progress
---

# Fix Context-Meter-Blank-on-Dormant + Identity-Enum Hygiene

Two independent bugs, both surfaced by Ashley's UAT of dormant identities on workstation:

- **Fix A (hygiene)**: Skynet's identity enumeration on remote hosts uses `ls -1 ~/.claude/identities/` — picks up leftover backup tarballs (`.pre-migration-<ts>.tar.gz`, etc.) as if they were identities, firing wasted SSH-exec ghost-polls (dormancy stat, recycled-at stat, `find` for JSONL) against nonexistent identity dirs. **Fix**: filter enumeration to directories only.

- **Fix B (evidence-backed root cause of blank meter)**: `readContextPctFromJsonl` reads only the last **10 KB** of the JSONL to find the most recent assistant `usage` turn. Empirically verified 2026-08-30 that for 3 of 4 dormant identities Ashley just tested (Terry 1.16 MB / Pixie 1.29 MB / Holly 2.27 MB JSONLs), the last 10 KB contains **zero** assistant usage turns — the tail is dominated by tool_results, long user messages, or /exit echoes. Midna's 302 KB JSONL has one in its last 10 KB → her meter works. `readContextPctFromJsonl` returns null in all three failing cases, **silently** — no log, so the caller's `dormantSessionFile` gate short-circuits and no `context_pct` frame ever emits. Meter stays blank.
  **Fix**: iterative tail expansion — try successive tail sizes until an assistant usage turn is found or a bounded max is reached. Log a `warn` when we bail so future silent-null cases surface immediately.

---

## Fix A — enumerate directories only

**File**: `src/backend/fleet-status/ssh-poll-orchestrator.ts` line 781.

Current:
```ts
const listing = await channel.exec(
  "ls -1 ~/.claude/identities/ 2>/dev/null || true",
);
```

Replace with:
```ts
const listing = await channel.exec(
  "find ~/.claude/identities/ -mindepth 1 -maxdepth 1 -type d -printf '%f\\n' 2>/dev/null || true",
);
```

`find … -type d -printf '%f\n'` emits ONLY directory basenames (no path prefix), one per line — same shape as `ls -1` returned. Managed hosts that host identity dirs are all Linux (per `box-map.md` § Managed hosts), so GNU find + `-printf` is available.

**Tests**: `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` — find the existing test(s) for `pollDormantOnlyIdentities` (grep `pollDormantOnlyIdentities` or `source B`). Add:
- One positive test proving the swap: mock `channel.exec` to receive the new `find` command and return a directory-only listing; assert per-identity stat exec fires as expected.
- One regression test proving the enumeration no longer processes a listing containing tarball-shaped names — supply mock listing `["alice", "bob", "alice.pre-migration-...tar.gz"]` and assert only the two dir-shaped names get downstream stat exec calls. (This is a shape test — the fix relies on the shell command filtering, so the mock listing SHOULD be dir-only after the swap; the test asserts we call the correct new find command and process what comes back verbatim, no additional client-side filtering.)

---

## Fix B — iterative tail expansion + loud null-return

**File**: `src/backend/claude-session/context-pct-from-jsonl.ts`.

### Current shape

- Constant `TAIL_BYTES = 10_000` — the fixed tail width.
- `readContextPctFromJsonl(conn, sessionFile)` — one `tail -c 10000` SSH exec, reverse-scan the returned bytes for the last `"role":"assistant"` line with `"usage"`, compute pct or return null.
- Silent on every failure path — never logs.

### Target shape

Replace fixed `TAIL_BYTES` with an iterative expansion schedule:

```ts
// Iterative expansion — start small (cheap common case), fall back to
// larger tails when the small window doesn't contain an assistant usage
// turn (long tool_result tails, /exit echoes, sequential user messages,
// etc). 512 KB is the bounded ceiling — even multi-MB JSONLs are covered
// in ≤ 4 exec round-trips, and 512 KB pathological cases still fit inside
// one SSH exec well under the 3s dormant-poll interval.
const TAIL_EXPANSION_STEPS = [10_000, 50_000, 200_000, 512_000] as const;
```

Loop through the schedule:
1. `tail -c <size>` via SSH exec
2. Reverse-scan for last assistant usage
3. If found → compute pct, return it
4. If not found and there's a larger step available → try next
5. If exhausted → warn + return null

### Loud null-return

Import a logger (mirror the pattern in adjacent backend files under `src/backend/claude-session/` — most use `databaseLogger` or `sshLogger` from `../utils/logger.js`). Add one `.warn` per distinguishable null-return path:

| Reason              | Log message                                                        | Meta                                              |
|---------------------|--------------------------------------------------------------------|---------------------------------------------------|
| exec_fail           | `context-pct: exec returned null (SSH failure or timeout)`         | `{ sessionFileBasename, tailStepBytes }`          |
| empty_tail          | `context-pct: exec succeeded but tail is empty`                    | `{ sessionFileBasename, tailStepBytes }`          |
| no_asst_usage       | `context-pct: no assistant usage turn found within max tail bytes` | `{ sessionFileBasename, maxTailBytes: 512_000 }`  |
| exec_throw          | `context-pct: exec threw`                                          | `{ sessionFileBasename, err }`                    |

`sessionFileBasename` = `path.basename(sessionFile)` — no full path (T-32-05 mitigation shape used by adjacent code; the JSONL's session UUID is already discoverable via existing session-scoped logs, no need to disclose the encoded project-dir path segment).

Use `.warn` (not `.info`) — these are unexpected states that indicate a real gap in meter data. Ashley will grep for these next session to correlate the blank-meter class.

### Downstream caller

`src/backend/claude-session/claude-session-server.ts:2724-2730` (the dormant-poll's `readJsonlPct + dormantSessionFile` gate). Currently:
```ts
if (readJsonlPct && dormantSessionFile) {
  const sessionFile = dormantSessionFile();
  if (sessionFile !== null) {
    const pct = await readJsonlPct(connSnapshot, sessionFile);
    if (pct !== null) {
      wsSend(JSON.stringify({ type: "context_pct", pct, dormant: true }));
    }
    // NEW: else warn — pct came back null despite discovery succeeding
  }
}
```

Add a `sshLogger.warn` in the `pct === null` branch of this block (correlates to the specific-reason warns inside `readContextPctFromJsonl`; gives us the caller-site view AND the reason at the same grep). Include the session/host/tmuxSession context that the surrounding block already has access to.

### Tests

`src/backend/claude-session/context-pct-from-jsonl.test.ts` (may not exist yet — create if missing; mirror the shape of adjacent test files under `src/backend/claude-session/`).

Test cases:
1. **Common case (10 KB hit)** — mock SSH exec to return a 10 KB tail containing an assistant usage turn; assert pct is computed and returned; assert ONE exec call was made.
2. **Iterative expansion succeeds at step 2** — mock exec so first call returns 10 KB with NO usage turn, second call (50 KB) returns bytes with a usage turn; assert pct computed correctly; assert TWO exec calls were made with the two different `-c` sizes.
3. **All steps exhausted → null + warn** — mock exec so all four calls return bytes with no usage turn; assert null returned; assert the `no_asst_usage` warn fires with correct meta.
4. **Exec fail (null return)** — mock exec to return null on first call; assert one warn (`exec_fail`) fires and function returns null. (Does NOT proceed to next step — a null-return from exec means SSH failure, not "no bytes"; retrying doesn't help.)
5. **Exec throw** — mock exec to throw; assert `exec_throw` warn fires and function returns null.
6. **Empty tail on first step, then bytes on second** — mock first call to return empty string, second call to return 50 KB with usage; assert warn (`empty_tail`) fires for the first, function proceeds to step 2 and succeeds. (Optional — depending on whether empty tail is treated as "keep looking" or "bail." Recommended: bail on empty tail with warn; empty tail means the file is genuinely empty or truncated, retrying wider won't fix it. Actually — reconsider: if `tail -c 10000` of a file that DOES exist returns empty, that's the file itself being under 10 KB or corrupt. Bail. Only expand when we got bytes but they don't contain a usage turn.)

Executor: use judgment on the empty-tail-vs-no-usage distinction. Both paths distinct warn strings so the logs can tell them apart.

### One-liner comment near `TAIL_EXPANSION_STEPS`

Document why 512 KB is the ceiling: over-a-few-MB JSONLs are already unusual (Ashley's fleet median is well under 1 MB); the pathological cases (>512 KB tail with no assistant usage) are a genuine bug in Claude Code write patterns worth surfacing via the `no_asst_usage` warn rather than expanding the tail infinitely. If Ashley later reports that 512 KB isn't enough, bump the top of the schedule — don't add another expansion step.

---

## Constraints

- Working directory: `/home/ubuntu/skynet-tina`, branch `feat/tab-title-from-tmux`. Do NOT use git worktrees.
- **Do NOT deploy.** Commit only.
- **Do NOT touch** `~/.claude/roles/box-maintainer/skynet-patches.md`.
- **Do NOT run full-suite `npx vitest run`** — scoped tests only.
- Fix A + Fix B touch different files with no overlap.

## Scoped verification

- **After Fix A**: `npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts` — exit 0.
- **After Fix B**: `npx vitest run src/backend/claude-session/context-pct-from-jsonl.test.ts src/backend/claude-session/claude-session-server.dormant-poll.test.ts` (or whichever test file(s) cover the dormant-poll block that got the caller-side warn — grep to find; may only need the pct-from-jsonl test if the caller-site warn is trivially exercised there).
- **Final aggregate**: rerun all affected files together, exit 0, zero failures.

## Commits — three atomic

**Commit A** (hygiene enum):
```
fix(quick-260830-f1e): filter identity enumeration to directories only

ssh-poll-orchestrator's source-B enumeration was `ls -1 ~/.claude/identities/`
which picks up leftover backup tarballs from role migrations (e.g.
`pixie.pre-role-migration.20260804T050759Z.tar.gz`) as if they were
identity names. Skynet then fires ghost-polls per tick against nonexistent
identity dirs — wasted SSH exec + noise in fleet-status.

Swap to `find ~/.claude/identities/ -mindepth 1 -maxdepth 1 -type d -printf '%f\n'`
so only actual directories are enumerated. Regardless of any leftover
files in that dir (tarballs, backups, notes.txt, .DS_Store), enumeration
only sees identities.

Also incidentally fixes the mis-attribution in the "commander zoey" (with
space) vs "commander-zoey" (with hyphen) case — the space-containing entry
would still enumerate if it's a directory, but the hygiene rule now excludes
any regular file matching that name.
```

**Commit B** (iterative tail expansion + loud null-return):
```
fix(quick-260830-f1e): iterative tail expansion in readContextPctFromJsonl + warn on null-return

Empirical root cause of blank context meter on dormant identities with
large JSONLs (Ashley UAT 2026-08-30):

The fixed 10 KB tail scan misses the last assistant `usage` turn when
recent JSONL activity is dominated by tool_results, long user messages,
or /exit echoes. Verified 4-for-4 on workstation: Terry (1.16 MB JSONL),
Pixie (1.29 MB), Holly (2.27 MB) all have ZERO assistant usage turns in
their last 10 KB → meter blank. Midna (302 KB JSONL) has one → meter works.

Changes:
- context-pct-from-jsonl.ts: replace fixed TAIL_BYTES with iterative
  TAIL_EXPANSION_STEPS = [10_000, 50_000, 200_000, 512_000]. Start small
  (common case unchanged), fall back to larger tails when no usage turn
  found. 512 KB ceiling — pathological >512 KB no-usage tails are a real
  bug in Claude Code write patterns worth surfacing rather than tail-
  expanding infinitely.
- Loud warn logs on every null-return path (exec_fail / empty_tail /
  no_asst_usage / exec_throw) with sessionFileBasename in meta.
  Previously silent — Ashley couldn't diagnose which identities were
  missing the meter until we correlated JSONL tails by hand.
- claude-session-server.ts dormant-poll caller: warn when readJsonlPct
  returns null despite dormantSessionFile being set, so caller-site view
  is available at the same grep. Correlates to the specific-reason warn
  inside the helper.

Bounty: context-meter-blank-on-dormant-intermittent (root cause pinned).
```

**Commit C** (planning docs):
```
docs(quick-260830-f1e): PLAN.md for context-meter + enum hygiene fixes
```

## Return

Report to me: three commit SHAs (A, B, C), per-file test count deltas, and any surprises/deviations. The full ship motion (push → build → deploy) is orchestrator's — do NOT push, build, or force-recreate.

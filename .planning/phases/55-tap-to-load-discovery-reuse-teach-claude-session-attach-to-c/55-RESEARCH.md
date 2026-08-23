# Phase 55: tap-to-load-discovery-reuse — Research

**Researched:** 2026-08-23
**Domain:** Backend-only — claude-session attach path + fleet-status poller shared-cache integration
**Confidence:** HIGH

---

## Summary

Phase 55 eliminates ~4s of serial SSH round-trips on every cold-mount tap by
wiring the Claude-session attach path to read the fleet-status poller's
already-resolved `jsonlPath` before running its own discovery. This is a
purely server-side change with three distinct pieces: (1) a module-level
shared store that the orchestrator writes and the attach handler reads, (2) a
cache-hit branch in the attach handler that short-circuits `discoverClaudeSession`
entirely, and (3) a batched single-script fallback that compresses the current
serial 4-step SSH discovery into one round-trip when no cached answer exists.

The main technical risk is not correctness — downstream recovery (discovery-repoll
ticker + frontend `lastKnownSessionFileRef` rotation-reset) already handles
stale-cache reads. The risk is module coupling: the shared store must be a
read-only opportunistic read from the attach side, with zero lifecycle dependency
on the orchestrator being running.

**Primary recommendation:** Implement the shared store as a module-level
`Map<string, { sessionFile: string; pid: number; ts: number }>` in a new
`session-file-cache.ts` under `src/backend/fleet-status/`. The key is
`${hostId}::${tmuxSession}`. The orchestrator writes on each poll tick where
`jsonlPath !== null`; the attach handler reads before calling
`discoverClaudeSession`. No TTL, no lock, no lifecycle coupling. If the
orchestrator is stopped or has never polled, the Map is empty and the attach
handler falls through to the existing (or new batched) discovery path.

---

## Project Constraints (from CLAUDE.md)

- **Backend-only typecheck:** This phase touches only `src/backend/`. The
  correct pre-push typecheck is `npm run build:backend && npm run build`, NOT
  `npx tsc --noEmit` (which only catches frontend TS errors). Every plan task
  that produces backend TS must include the backend build check.
- **Nginx caveat:** No new HTTP routes in this phase (WebSocket-only changes).
  This constraint does not apply here, but must be remembered for any future
  route addition.
- **No git worktrees:** All work on `feat/tab-title-from-tmux`.
- **Deadman timer:** `docker compose up -d --force-recreate skynet` must never
  run without the 15-min rollback timer — executor scope stops at code + commit
  + tests green.
- **Executor ships no docker motions:** The plan MUST NOT include a ship task
  at executor scope.
- **Scoped tests during dev:** Tasks should say "run scoped tests for touched
  files," not `npx vitest run`. Full suite is the ship-gate before `docker build`.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|---|---|---|---|
| Shared session-file cache (write) | Backend fleet-status | — | Orchestrator already owns the resolved `jsonlPath`; it writes the cache as a side-effect of its existing poll |
| Shared session-file cache (read) | Backend claude-session | — | Attach handler reads opportunistically before discovery |
| Cache-hit fast path (skip discovery) | Backend claude-session | — | `startActiveSessionFlow` already owns the active-path call flow |
| Batched SSH discovery fallback | Backend claude-session (`session-file-discovery.ts`) | — | Compress existing serial SSH scripts into one exec |
| Downstream staleness recovery | Backend claude-session (repoll ticker) + Frontend (`PrettyView.tsx`) | — | Already implemented; this phase makes no changes here |
| Observability log line | Backend claude-session (connectToPane handler) | — | One log line at the decision point where cache-hit vs fallback branches |

---

## Research Question 1: Reader hookup — shim point and data shape

### Where discovery currently happens

The `discoverClaudeSession` call lives at **line 6776** of
`src/backend/claude-session/claude-session-server.ts`, immediately after
`startActiveSessionFlow` is defined (L6002–L6774). The call sequence is:

```
connectToPane message received (L5911)
  → resolveHostById (L5952)
  → connectOneShot → sshConn set (L5960-5978)
  → startActiveSessionFlow defined as closure (L6002-6774)
  → discoverClaudeSession(conn, tmuxSession) called (L6776)
  → result.status === "active"
      → startActiveSessionFlow({ pid: result.pid, sessionFile: result.sessionFile, … }) (L7199)
```

`startActiveSessionFlow` itself takes `{ pid, sessionFile, tmuxSession, hostId }`
and NEVER calls `discoverClaudeSession` internally — it goes straight to:
1. `readSessionFileRange` probe (totalLines) — L6028-6043 [one SSH exec]
2. Emit `{ type: "session", pid, sessionFile, totalLines }` — L6046-6053
3. Start context-% timer — L6126+
4. Start discovery-repoll timer — L6771
5. `tailSessionFile(sshConn!, sessionFile, onLine, onError)` — L6773

**Natural shim point:** Between `sshConn` being established (L5978) and
`discoverClaudeSession` being called (L6776). Specifically, insert a lookup
in the shared cache using `(hostId, tmuxSession)` as the key. If a cached
answer exists, call `startActiveSessionFlow({ pid, sessionFile, … })` directly
and skip `discoverClaudeSession` entirely.

**Data shape needed:** Both `sessionFile` (absolute path string) and `pid`
(number) are required — `startActiveSessionFlow` needs both as parameters, and
the `{ type: "session", pid, sessionFile }` metadata frame carries both to the
frontend. The cache entry must store `{ sessionFile: string; pid: number }` at
minimum. A `ts: number` (write timestamp) is useful for log instrumentation
only; no TTL logic consumes it.

**The readSessionFileRange probe (L6028-6043)** — This is already inside
`startActiveSessionFlow` and runs on both the cache-hit and fresh-discovery
paths. The probe is cheap (one round-trip on the shared SSH conn) and is
needed to populate `totalLines` in the `session` frame. It is NOT part of
discovery and does NOT need to be bypassed. The cache-hit path still runs it.

[VERIFIED: direct code read of `src/backend/claude-session/claude-session-server.ts`]

---

## Research Question 2: Writer hookup — where the orchestrator knows sessionFile

### Source A — `processPid` in `ssh-poll-orchestrator.ts`

The orchestrator resolves the JSONL path via `discoverIdentityJsonlPathViaChannel`
(L1088-1090) and stores it in `PidCacheEntry.jsonlPath` (L1268, L1281). The
per-PID `tmuxSession` is also cached in `PidCacheEntry.tmuxSession`.

Key insight: the orchestrator does NOT store the `pid` alongside `jsonlPath`.
`pid` is the session-JSON PID for that process, available at L958 as the
`processPid` argument. The composed `SessionState` at L1225 carries `pid`.

**Write site for source A:** After the liveness check passes (L1174) and before
`deps.registry.publishSessionState` is called (L1246), the orchestrator has:
- `pid` (function argument)
- `jsonlPath` (local variable, may be null)
- `tmuxSession` (local variable, may be null)
- `host.id` (from `hostState.host.id`)

If `jsonlPath !== null` AND `tmuxSession !== null`, write to the shared cache:
`cache.set(\`${host.id}::${tmuxSession}\`, { sessionFile: jsonlPath, pid })`.

### Source B — `pollDormantOnlyIdentities`

Source B (L712-951) resolves `jsonlPath` per identity (L775-811) and has
`name` (the identity name == tmuxSession) and `host.id`. However, source B
does NOT have a `pid` — it uses `sessionId: "__dormant__"` (L907) as a
synthetic placeholder.

**Source B CANNOT write to the cache** for this reason: `startActiveSessionFlow`
requires a real `pid`. Writing `pid: 0` or a sentinel would break the
`{ type: "session", pid }` metadata frame. Source B entries are for dormant
or recycling identities — by definition, no active Claude process is running.
The attach handler should only use a cache entry when a live PID is known.

**Resolution:** Only source A writes to the shared cache. Source B writes nothing.
On cache-miss, the attach handler falls through to fresh discovery.

[VERIFIED: direct code read of `src/backend/fleet-status/ssh-poll-orchestrator.ts`]

---

## Research Question 3: Fresh discovery batching

### Current serial SSH questions in `discoverClaudeSession`

`src/backend/claude-session/session-file-discovery.ts` (257 lines total) runs:

1. **`queryPanePid`** (L79): `tmux display-message -p -t '<name>' '#{pane_pid}'`
   — one round-trip via `tmux-helper.ts:queryPanePid`.

2. **`walkScript`** (L99-136): `ps -eo pid=,ppid=,comm= | awk BFS-walk…`
   — one round-trip to find the claude PID in the descendant tree.

3. **`pidFileScript`** (L165-171):
   `cat ~/.claude/sessions/$PID.json; printf '\n---HOME---\n'; printf '%s' "$HOME"`
   — one round-trip to read session-JSON + HOME.

4. **`testScript`** (L229-232):
   `if [ -f "<constructedPath>" ]; then printf '%s' "<constructedPath>"; fi`
   — one round-trip to verify the JSONL file exists.

Total: **4 serial exec round-trips**, each with its own `Promise.race` 3s timeout.
On a 50ms-RTT Tailscale link, latency alone is ~200ms minimum; in practice the
UAT shows ~4s total for these 4 steps.

### Batching precedent

`src/backend/claude-session/discover-identity-session-file.ts`'s
`buildDiscoveryScript` (L178-213) is the existing pattern for batching multiple
shell operations into a single exec call. It combines `find`, `sort`, `while-read`,
`head`, and `grep` into one script emitting a structured stdout that
`parseDiscoveryStdout` parses in JS.

The same approach can compress all 4 discovery steps into one script. The script
would:
1. Get pane_pid via `tmux display-message`
2. Walk process tree via `ps -eo pid=,ppid=,comm= | awk` (same BFS script)
3. Read `~/.claude/sessions/$CLAUDE_PID.json` + `$HOME`
4. Test the constructed JSONL path

All in one shell heredoc with structured output markers (e.g. `---DISCOVERY---`)
separating each field. The JS side parses the single stdout string.

**Key constraint:** The `shellSingleQuote` + statement-terminator discipline
(from the `session-file-discovery.ts` comments at L98-99 and L163-164) applies
here too: JS `+` concatenation joins everything onto ONE shell line, so every
statement must end with `;`.

### SSH exec mechanism

`src/backend/ssh/tmux-helper.ts:execCommand` (L21-54) opens a new `conn.exec()`
channel per call. Each call is a separate ssh2 channel multiplexed over the
same TCP connection. There is no per-exec connection overhead beyond the channel
open/close — but each exec still requires a network round-trip for the response.
Batching all 4 scripts into ONE `execCommand` call is exactly what the existing
`buildDiscoveryScript` pattern does.

[VERIFIED: direct code read of `src/backend/claude-session/session-file-discovery.ts`, `src/backend/ssh/tmux-helper.ts`, `src/backend/claude-session/discover-identity-session-file.ts`]

---

## Research Question 4: Test coverage patterns

### Existing test structure for `discoverClaudeSession`

`src/backend/claude-session/session-file-discovery.test.ts` — 14 cases covering
the 4-step serial discovery. Pattern: mock `execCommand` and `queryPanePid` at
the module level via `vi.mock('../ssh/tmux-helper.js', …)`. The `mockExecCommand`
helper dispatches on script content substrings (`"ps -eo"`, `".claude/sessions/"`,
`'if [ -f "'`) to route each exec call to the right mock output. The `fakeConn`
is `{} as Client` — the conn is never accessed directly.

### Existing test structure for `startActiveSessionFlow`

No direct tests for `startActiveSessionFlow` — it is a closure defined inside
`createClaudeSessionServer`. Tests reach it via the exported test seams:
- `__applyRepollResultForTests` — tests the discovery-repoll ticker reducer
- `__applyDormantPollWithRediscoveryForTests` — tests the dormant-poll seam
- `__classifyAttachInactiveForTests` — tests the attach-path inactive classifier

The pattern is: export a pure function seam that takes injected state/helpers
and can be exercised without spinning up a WebSocketServer + SSH pair.

### Existing test structure for `ssh-poll-orchestrator`

`src/backend/fleet-status/ssh-poll-orchestrator.test.ts` (4863 lines). Pattern:
inject a mock `SshChannel` with `exec: vi.fn()` returning string | null per call.
Use `vi.useFakeTimers()` to control poll intervals. Tests are large `describe`
blocks with a shared `buildFixture()` helper that creates the mock channel, mock
registry, and orchestrator. Discovery tests (Phase 44 Plan 02 `Tests G-K`, L1516+)
assert call counts on `discoverIdentityJsonlPathViaChannel` by inspecting how many
times the mock `exec` received the discovery script substring.

### Test plan for Phase 55

Three test areas needed:

**A. Shared cache module tests (new file, e.g. `session-file-cache.test.ts`)**
- Cache is empty on cold-start
- Write then read returns same `{ sessionFile, pid }`
- Key is `"${hostId}::${tmuxSession}"` — different (hostId, tmuxSession) pairs don't collide
- Stale write is overwritten by fresh write (no TTL enforcement — whatever is there is used)
- `clear(hostId)` removes all entries for that host (for stop/restart scenario)

**B. Attach handler cache-hit path (new test seam export needed)**
The natural seam: export a `__applyConnectToPaneForTests` that accepts an
injectable `getCacheEntry` function. Tests verify:
- Cache-hit: `discoverClaudeSession` is NOT called; `startActiveSessionFlow` is
  called with the cached `{ pid, sessionFile }`
- Cache-miss: falls through to `discoverClaudeSession` (fresh discovery)
- Cache-hit with stale sessionFile: `startActiveSessionFlow` is called; downstream
  recovery path (repoll ticker) picks up the mismatch normally — no special handling
  needed at the cache level

**C. Batched discovery script (new tests in `session-file-discovery.test.ts`)**
- Happy path: single exec returns structured stdout; JS parser extracts pid +
  sessionFile correctly
- PID file missing (exit 10 path): returns `{ status: "inactive", reason: "no_pid_session_file" }`
- No claude in tree (walk returns ""): returns `{ status: "inactive", reason: "not_claude" }`
- JSONL not found (test-f returns ""): returns `{ status: "inactive", reason: "no_open_session_file" }`
- Timeout: returns `{ status: "inactive", reason: "exec_error" }`
- SSH exec throws: returns `{ status: "inactive", reason: "exec_error" }`

**D. Orchestrator cache-write tests (additions to `ssh-poll-orchestrator.test.ts`)**
- processPid with jsonlPath resolved AND tmuxSession known → cache entry written
- processPid with jsonlPath null → cache NOT written
- processPid with tmuxSession null → cache NOT written
- Source B (pollDormantOnlyIdentities) → cache NOT written (no pid available)

[VERIFIED: direct code read of test files and seam patterns]

---

## Research Question 5: Bare-host-terminal panes do NOT go through claude-session-attach

The bare-host-terminal (plain SSH/xterm.js) path uses `src/backend/ssh/terminal.ts`,
which creates a WebSocketServer on **port 30002** (L119-121). The Claude-session
server uses **port 30011** (L7203). These are completely separate WS servers, each
handling their own connection lifecycle.

The terminal.ts server NEVER calls `discoverClaudeSession`, `connectToPane`, or
`startActiveSessionFlow`. It opens a raw PTY channel via `conn.shell()` and
streams bytes bidirectionally. There is no shared code path between terminal attach
and Claude-session attach.

Phase 55 changes touch only:
- `src/backend/fleet-status/ssh-poll-orchestrator.ts` (writer)
- `src/backend/claude-session/claude-session-server.ts` (reader — the shim at L6776)
- `src/backend/claude-session/session-file-discovery.ts` (batched fallback)
- New `src/backend/fleet-status/session-file-cache.ts` (the shared store)

None of these are imported by `terminal.ts`. Bare-host-terminal panes are
structurally isolated. [VERIFIED: grep of terminal.ts imports + port inspection]

---

## Research Question 6: Observability — log line placement and pattern

### Existing log patterns to mirror

`sshLogger` is the correct logger for this code path (imported at L7 of
`claude-session-server.ts`). The structured log pattern is:

```typescript
sshLogger.info("Claude session discovery result", {
  operation: "claude_session_discovery",
  userId,
  sessionId,
  hostId,
  tmuxSession,
  status: result.status,
});
```

The per-attach observability log line belongs at the decision point — immediately
after the cache lookup, before the branch executes. It should name the path taken
and include timing:

```typescript
const t0 = Date.now();
// ... cache lookup ...
// ... discovery (if needed) ...
sshLogger.info("Claude session discovery path", {
  operation: "claude_session_discovery_path",
  userId,
  sessionId,
  hostId,
  tmuxSession,
  path: "shared-hit" | "batched-fresh" | "fallback",
  durationMs: Date.now() - t0,
});
```

`t0` must be captured BEFORE the cache lookup (not before `connectOneShot`
which includes SSH connection time). The observability goal is to measure
discovery time only.

**Note:** The existing `"Claude session discovery result"` log at L6777 must be
preserved (it is the existing structured log for the `discoverClaudeSession` call
result). The new path log is ADDITIONAL, not a replacement.

[VERIFIED: direct code read of `claude-session-server.ts` log patterns]

---

## Research Question 7: Cache invalidation on `transitionToActiveNew`

`transitionToActiveNew` (L4021-4139) fires when the discovery-repoll ticker sees
a changed `sessionFile` (session rotated mid-flight). It updates
`currentSessionFile = newSessionFile` (L4089) and restarts the tail on the new file.

**Does it need to update the shared cache?**

No, for two reasons:

1. **The shared cache is a write-only path from the orchestrator.** The orchestrator
   polls every ~2s. When a session rotates, the orchestrator's next tick will resolve
   the new `jsonlPath` (via `discoverIdentityJsonlPathViaChannel`) and overwrite the
   cache entry with the fresh path. This happens within ~2s of the rotation.

2. **The cache is only consulted at attach time.** A `transitionToActiveNew` fires on
   an ALREADY-CONNECTED WS, not at attach time. The cache is not consulted during
   steady-state tail operation.

The only scenario where a stale cache entry causes user-visible issues is:
"User taps a pane; the cached sessionFile is stale; attach starts tailing the wrong
file." But this is exactly the downstream recovery case Phase 55's philosophy section
covers: "Unlucky-timed tap sees a brief flicker on the order of a couple seconds,
then it's right." The discovery-repoll ticker (L4204) catches it on the next tick.

**Resolution:** `transitionToActiveNew` does NOT write to the shared cache. The
orchestrator overwrites the cache on its next poll tick automatically. No
invalidation protocol needed.

[VERIFIED: code read + CONTEXT.md philosophy section]

---

## Standard Stack

### Core (no new dependencies)

All code in this phase uses existing project primitives. No new npm packages.

| Component | Version | Purpose |
|---|---|---|
| `ssh2` (existing) | already installed | SSH exec channels for the batched script |
| `vitest` (existing) | already installed | test framework |
| `sshLogger` (existing) | project util | structured logging |

**Installation:** No new packages. This phase is pure TypeScript.

---

## Package Legitimacy Audit

No external packages are installed in this phase.

---

## Architecture Patterns

### System Architecture Diagram

```
Fleet-status poll tick (every ~2s)
  ssh-poll-orchestrator.ts::processPid()
    → discoverIdentityJsonlPathViaChannel(channel, tmuxSession)
    → jsonlPath resolved
    → [NEW] session-file-cache.ts::write(hostId, tmuxSession, { sessionFile: jsonlPath, pid })
    → registry.publishSessionState(...)  [unchanged]

User taps a pane (connectToPane WS message)
  claude-session-server.ts (L5911)
    → resolveHostById, connectOneShot → sshConn
    → startActiveSessionFlow defined as closure
    → [NEW] session-file-cache.ts::read(hostId, tmuxSession)
        → cache HIT  → startActiveSessionFlow({ pid, sessionFile: cached })
                         → readSessionFileRange probe (1 SSH round-trip)
                         → emit "session" frame + start tail
                         → path="shared-hit" log
        → cache MISS → [NEW] discoverClaudeSessionBatched(conn, tmuxSession)
                              (one round-trip, all 4 questions)
                         → startActiveSessionFlow({ pid, sessionFile })
                         → path="batched-fresh" log
        → (fallback kept) OR original discoverClaudeSession if batched fails
```

### Recommended Project Structure

```
src/backend/
├── fleet-status/
│   ├── session-file-cache.ts        # NEW — shared module-level Map
│   ├── session-file-cache.test.ts   # NEW — cache unit tests
│   ├── ssh-poll-orchestrator.ts     # MODIFIED — writes to cache in processPid
│   └── ... (unchanged files)
└── claude-session/
    ├── session-file-discovery.ts    # MODIFIED — adds discoverClaudeSessionBatched
    ├── session-file-discovery.test.ts  # MODIFIED — new batched-script tests
    ├── claude-session-server.ts     # MODIFIED — cache-hit shim at L6776
    └── ... (unchanged files)
```

### Pattern 1: Shared module-level Map (session-file-cache.ts)

**What:** A module-level `Map` with a stable string key and a plain object value.
Exported as a singleton with typed read/write functions.

**When to use:** Any time two backend subsystems need to share computed state
without a round-trip dependency. The module is stateless beyond the Map itself.

```typescript
// Source: codebase pattern (session-file-discovery.ts RECORD_SEPARATOR precedent)
// session-file-cache.ts

interface SessionFileCacheEntry {
  sessionFile: string;
  pid: number;
  writtenAt: number; // Date.now() — for log instrumentation only
}

const cache = new Map<string, SessionFileCacheEntry>();

export function writeSessionFileCache(
  hostId: string,
  tmuxSession: string,
  entry: Omit<SessionFileCacheEntry, "writtenAt">,
): void {
  cache.set(`${hostId}::${tmuxSession}`, { ...entry, writtenAt: Date.now() });
}

export function readSessionFileCache(
  hostId: string,
  tmuxSession: string,
): SessionFileCacheEntry | null {
  return cache.get(`${hostId}::${tmuxSession}`) ?? null;
}

export function clearSessionFileCacheForHost(hostId: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`${hostId}::`)) cache.delete(key);
  }
}

// For tests only
export function __clearAllSessionFileCacheForTests(): void {
  cache.clear();
}
```

**Note on `hostId` type:** In `ssh-poll-orchestrator.ts`, `host.id` is typed as
`string` (from `HostRecord`). In `claude-session-server.ts`, `hostId` comes from
the `connectToPane` message and is typed as `number`. The cache key must reconcile
these — use `String(hostId)` in both callers, or type the cache key as `string`
everywhere and coerce at the call sites.

### Pattern 2: Batched discovery script

**What:** A single `execCommand` call running a shell script that answers all 4
discovery questions in sequence, emitting structured output.

**When to use:** Cache-miss path only. The script should closely mirror
`discoverClaudeSession`'s existing 4 steps but combined into one exec.

```typescript
// Source: discover-identity-session-file.ts buildDiscoveryScript precedent
// Proposed batched script pattern (to go in session-file-discovery.ts)

const batchedScript = (tmuxSession: string) =>
  // Step 1: pane_pid
  `TMUX_SESSION=${shellSingleQuote(tmuxSession)}; ` +
  `PANE_PID=$(tmux display-message -p -t "$TMUX_SESSION" '#{pane_pid}' 2>/dev/null); ` +
  `if [ -z "$PANE_PID" ] || ! [ "$PANE_PID" -gt 0 ] 2>/dev/null; then ` +
  `  echo "NO_TMUX_SESSION"; exit 0; ` +
  `fi; ` +
  // Step 2: descendant walk (same BFS awk as current session-file-discovery.ts)
  `CLAUDE_PID=$(ps -eo pid=,ppid=,comm= 2>/dev/null | awk -v root="$PANE_PID" '...'); ` +
  `if [ -z "$CLAUDE_PID" ]; then echo "NOT_CLAUDE"; exit 0; fi; ` +
  // Step 3: PID file read
  `PID_FILE="$HOME/.claude/sessions/$CLAUDE_PID.json"; ` +
  `if [ ! -f "$PID_FILE" ]; then echo "NO_PID_SESSION_FILE"; exit 0; fi; ` +
  `SESSION_JSON=$(cat "$PID_FILE"); ` +
  // Step 4: construct + verify JSONL path
  `...construct path from SESSION_JSON fields...; ` +
  `if [ ! -f "$JSONL_PATH" ]; then echo "NO_OPEN_SESSION_FILE"; exit 0; fi; ` +
  // Emit structured result
  `echo "OK"; echo "$CLAUDE_PID"; echo "$JSONL_PATH"`;
```

The JS parser reads: first line is status ("OK", "NO_TMUX_SESSION", etc.); on
"OK", second line is PID string, third line is sessionFile path.

**Anti-pattern to avoid:** Do NOT replicate the slug-construction logic in shell
(fragile across Claude Code versions). Instead, use the same approach the current
`pidFileScript` uses: `cat` the PID JSON file, print `---HOME---`, print `$HOME`,
then construct the path in JS (same slug logic at `session-file-discovery.ts:224`).

### Anti-Patterns to Avoid

- **Waiting on fleet-status:** The shim must NOT block on or poll the orchestrator.
  If `readSessionFileCache` returns null, proceed immediately to fresh discovery.
- **Bypassing `readSessionFileRange` probe:** The probe inside `startActiveSessionFlow`
  (L6028) runs even on the cache-hit path — it's needed for `totalLines` in the
  session frame. Do not skip it.
- **Source B writing to cache:** Source B has no `pid`; writing would produce
  a corrupt cache entry for the attach handler.
- **Using `String(hostId)` inconsistently:** Pick one form at the write site and
  mirror it exactly at the read site.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Shell escaping for identity/session names | Custom escaping | `shellSingleQuote` from `discover-identity-session-file.ts` (L221-223) | Already battle-tested; handles `'` → `'\''` correctly |
| One-round-trip shell scripts | Ad-hoc heredoc | Same JS `+` concatenation pattern as `session-file-discovery.ts:99-119` and `buildDiscoveryScript:201-213` | The pattern handles the "JS joins onto one line → need `;` terminators" hazard |
| Downstream staleness recovery | New staleness checker | Existing discovery-repoll ticker (L4197) + frontend `lastKnownSessionFileRef` (commit `3e0f7c54`) | Already handles stale-cache reads; no new mechanism needed |

---

## Common Pitfalls

### Pitfall 1: `hostId` type mismatch between orchestrator and attach handler

**What goes wrong:** The cache key silently mismatches because orchestrator uses
`host.id` (typed as `string` in `HostRecord`) while `connectToPane` delivers
`hostId` as `number` from the message payload. `"7::aqua"` !== `"7::aqua"` if
one coerces and the other doesn't — cache always misses.

**Why it happens:** `HostRecord.id` in `fleet-status/host-id-resolver.ts` is
a string (DB record ID). The `connectToPane` message field `hostId` is a `number`
as validated at L5921-5929 of `claude-session-server.ts`.

**How to avoid:** In `session-file-cache.ts`, accept `hostId: string | number`
and always coerce with `String(hostId)` before forming the key. Or use `number`
everywhere and coerce the string `host.id` in the orchestrator.

**Warning signs:** Cache-miss rate stays at 100% in logs after orchestrator has
been running for >2s.

### Pitfall 2: JS `+` concatenation hazard in batched script

**What goes wrong:** Shell script constructed via JS string concatenation has
adjacent statements without `;` separators. Shell parses them as one broken
statement and either errors silently or returns empty stdout — discovery returns
exec_error for every call.

**Why it happens:** JS `+` joins strings onto ONE line. Shell needs explicit `;`
between statements. The existing `walkScript` (session-file-discovery.ts:99) has
a comment block (L93-99) documenting exactly this hazard — it burned the original
ship.

**How to avoid:** Terminate every shell statement with `;`. Do NOT rely on
newlines inside JS template strings.

**Warning signs:** Batched discovery always returns `"not_claude"` or empty stdout.

### Pitfall 3: Cache-hit path bypasses mandatory `readSessionFileRange` probe

**What goes wrong:** The `totalLines` field in the `{ type: "session", … }` frame
is 0 for all cache-hit attaches. The frontend's "load more" button never mounts
(its guard: `totalLines > messages.length`; 0 fails the gate).

**Why it happens:** `readSessionFileRange` runs inside `startActiveSessionFlow`
at L6028-6043 and is NOT part of discovery. A cache-hit path that calls
`startActiveSessionFlow` directly is fine — but if the shim accidentally calls
`ws.send({ type: "session", … })` manually before `startActiveSessionFlow`, it
would skip the probe.

**How to avoid:** The shim ONLY calls `startActiveSessionFlow({ pid, sessionFile, … })`.
All internal logic (probe, emit, tail-start) stays inside `startActiveSessionFlow`.
Do not duplicate the session frame emission at the shim site.

### Pitfall 4: Source B cache pollution (dormant/recycling identities)

**What goes wrong:** Source B writes to the cache for a dormant identity with
`pid: 0` (or a sentinel). The next cold-mount tap reads the cache, calls
`startActiveSessionFlow({ pid: 0, sessionFile: "…" })`, emits
`{ type: "session", pid: 0, … }` to the frontend, and the frontend may break
on a non-positive pid.

**Why it happens:** Source B iterates all identities including dormant ones and
resolves `jsonlPath` for them. Without explicit guard, a writer might call
`writeSessionFileCache` from source B's loop.

**How to avoid:** Only call `writeSessionFileCache` from `processPid` (source A),
inside the `if (jsonlPath !== null && tmuxSession !== null)` branch, using the
real `pid` function argument (always a positive integer from the session-JSON
PID file).

### Pitfall 5: SSH connection is established BEFORE cache lookup, not after

**What goes wrong:** `connectOneShot` (L5962) opens a new SSH connection before
the cache is checked. On a cache-hit, the SSH connection is still needed (for
`readSessionFileRange` and `tailSessionFile`). This is correct behavior. But if
the implementation accidentally checks the cache BEFORE `connectOneShot`, there's
no `sshConn` for `startActiveSessionFlow` to use.

**How to avoid:** The shim goes at L6776 (after `sshConn = conn`), not before
`connectOneShot`. The SSH connection is needed regardless of cache-hit or miss.

---

## Code Examples

### Cache write site (in `processPid`, `ssh-poll-orchestrator.ts`)

```typescript
// Source: direct codebase read — processPid at L1245-1285
// Insert BEFORE the liveness map update at L1261

if (jsonlPath !== null && tmuxSession !== null && !stale) {
  writeSessionFileCache(host.id, tmuxSession, { sessionFile: jsonlPath, pid });
}
```

The `!stale` guard ensures we don't write a cache entry for a PID that is about
to be reaped (the liveness check at L1175 already handles this, but the guard
makes the intent explicit).

### Cache read shim (in connectToPane handler, `claude-session-server.ts`)

```typescript
// Source: direct codebase read — L6776 in claude-session-server.ts
// Replace the current single discoverClaudeSession call with:

const discoveryT0 = Date.now();
const cached = readSessionFileCache(String(hostId), tmuxSession);
if (cached) {
  sshLogger.info("Claude session discovery path", {
    operation: "claude_session_discovery_path",
    userId, sessionId, hostId, tmuxSession,
    path: "shared-hit",
    durationMs: Date.now() - discoveryT0,
  });
  startActiveSessionFlow({ pid: cached.pid, sessionFile: cached.sessionFile, tmuxSession, hostId });
  // Aside subsystem registration (same block that follows line 7199 today)
  // ...
  return;
}

// Cache miss — batched fresh discovery
const result = await discoverClaudeSessionBatched(conn, tmuxSession);
// OR fall through to existing discoverClaudeSession if batched not implemented yet
sshLogger.info("Claude session discovery path", {
  operation: "claude_session_discovery_path",
  userId, sessionId, hostId, tmuxSession,
  path: "batched-fresh",
  durationMs: Date.now() - discoveryT0,
});

// ... existing inactive handling and active path ...
```

**Critical:** The aside subsystem registration block (currently at L7199+ inline
in the `connectToPane` handler after `startActiveSessionFlow` is called) must
also run on the cache-hit branch. The code review should verify this does not
get accidentally skipped.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| mtime-based JSONL discovery | PID-file-based discovery (`sessionId` + `cwd` slug) | Phase 32+ | Correct-first-time even when two agents share a cwd |
| Serial 4-step SSH discovery (4 exec calls) | Same 4 steps, still serial | Today | Phase 55 target for batching |
| No shared answer between fleet-status and attach | (none — this is the new thing) | Phase 55 | Cache-hit makes cold-mount ~50ms instead of ~5s |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | `HostRecord.id` is a `string` in `fleet-status/host-id-resolver.ts` | Writer hookup | Cache key mismatch on every lookup — 100% miss rate |
| A2 | The aside subsystem registration block (after `startActiveSessionFlow` at L7199) can be reached on the cache-hit path without refactoring | Code Examples | Aside not registered for cache-hit attaches; BTW extraction broken on first attach |

A1 can be verified by inspecting `src/backend/fleet-status/host-id-resolver.ts`
in the planning wave — confirmed as medium-risk.

A2 is LOW risk: the aside block is inline in the `connectToPane` handler after
the `startActiveSessionFlow` call, and the cache-hit branch replaces only the
`discoverClaudeSession` call + the `startActiveSessionFlow` call site. The aside
block follows `startActiveSessionFlow` in both paths. The planner must verify this
ordering in the actual code.

---

## Open Questions (RESOLVED)

1. **`HostRecord.id` type** — **RESOLVED**
   - What we know: `host.id` is used as a Map key in `perHostState` and as
     `fleetHostId` in log payloads throughout `ssh-poll-orchestrator.ts`
   - What's unclear: whether it's typed as `string` or `number` in `HostRecord`
   - Recommendation: Read `src/backend/fleet-status/host-id-resolver.ts` in
     Wave 0 and pick the cache key type accordingly. Use `String(x)` coercion
     at both sites for safety.
   - **Resolution (during 55-01 planning):** `HostRecord.id` is `string` (confirmed
     at `src/backend/fleet-status/host-id-resolver.ts:14-17`); the `connectToPane`
     message `hostId` is validated as `number` at `claude-session-server.ts:5921-5929`.
     The cache module (`src/backend/fleet-status/session-file-cache.ts`, plan 55-01)
     accepts `hostId: string | number` and coerces via `String(hostId)` at both
     write and read sites, so writer/reader resolve the same entry regardless of
     which side calls it. Enforced by 55-01 acceptance grep on `String(hostId)` +
     Tests 3 & 4 exercising both orderings.

2. **Aside subsystem registration on cache-hit path** — **RESOLVED**
   - What we know: the aside registration block runs inline after
     `startActiveSessionFlow` at L7199 in the `connectToPane` handler
   - What's unclear: whether the cache-hit early-return would accidentally skip it
   - Recommendation: The planner should explicitly mark which lines of the aside
     block must run on cache-hit vs only on fresh-discovery paths. Wave B task
     should include a test that confirms aside registration fires on cache-hit attach.
   - **Resolution (during 55-03 planning):** Confirmed at
     `claude-session-server.ts:7192-7198` — the file's own comment states the aside
     subsystem (fan-out registration, connect-time probe, extraction poller,
     harness-tasks poller, discovery-repoll timer, tail start) is ALL inside
     `startActiveSessionFlow`. Cache-hit path calls `startActiveSessionFlow({pid,
     sessionFile})` and returns immediately after; the closure's internal aside
     setup runs unchanged. Assumption A2 = LOW risk. Plan 55-03 Task 2 includes
     an executor STOP-and-surface directive if a re-read of L7192-7199 finds
     the assumption broken before shipping.

---

## Environment Availability

Step 2.6: SKIPPED (no external dependencies identified — purely TypeScript
backend changes using existing SSH primitives and project test infrastructure).

---

## Security Domain

`security_enforcement: true` in config. Phase 55 is backend-only, no new HTTP
routes, no new user-controlled inputs reaching the shell beyond what already
exists.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V2 Authentication | No | N/A — no new auth path |
| V3 Session Management | No | N/A — no new sessions |
| V4 Access Control | No | N/A — cache is process-local, not cross-user |
| V5 Input Validation | Yes | `tmuxSession` already validated to safe subset at WS-attach layer (L5921-5929). Cache key uses `tmuxSession` directly — the existing validation gate covers it. |
| V6 Cryptography | No | N/A |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| Cache key injection via malformed `tmuxSession` | Tampering | `tmuxSession` is validated to `[a-zA-Z0-9_-]` at WS attach (L5921-5929); `shellSingleQuote` wraps it in the batched script — both guards already in place |
| Stale cache serving wrong session | Spoofing | Downstream recovery (discovery-repoll ticker + frontend rotation-reset) already handles; stale entry is replaced on next orchestrator tick (~2s) |

---

## Sources

### Primary (HIGH confidence)
- Direct code read of `src/backend/claude-session/claude-session-server.ts` (7207 lines)
- Direct code read of `src/backend/fleet-status/ssh-poll-orchestrator.ts` (1577 lines)
- Direct code read of `src/backend/claude-session/session-file-discovery.ts` (257 lines)
- Direct code read of `src/backend/claude-session/discover-identity-session-file.ts`
- Direct code read of `src/backend/ssh/tmux-helper.ts`
- Direct code read of `src/backend/ssh/terminal.ts` (port 30002 confirmed)
- Direct code read of test files: `session-file-discovery.test.ts`,
  `ssh-poll-orchestrator.test.ts`, `claude-session-server.repoll.test.ts`
- `.planning/phases/55-.../55-CONTEXT.md` — phase shape + philosophy

### Secondary (MEDIUM confidence)
- `.planning/config.json` — `nyquist_validation: false` confirmed (Validation Architecture section omitted)

---

## Metadata

**Confidence breakdown:**
- Shim point (reader): HIGH — exact line numbers confirmed by code read
- Writer hookup (orchestrator): HIGH — `jsonlPath` storage confirmed in `PidCacheEntry` and `IdentityRecycleCacheEntry`
- Data shape needed: HIGH — both `pid` and `sessionFile` required, confirmed by `startActiveSessionFlow` signature
- Batching precedent: HIGH — `buildDiscoveryScript` pattern confirmed as working prior art
- Test patterns: HIGH — all three test seam patterns confirmed by reading test files
- Bare-host isolation: HIGH — port 30002 vs 30011 confirmed; no shared imports
- Source B cannot write to cache: HIGH — confirmed no `pid` available in source B
- Cache invalidation (none needed): HIGH — confirmed by policy + downstream recovery analysis

**Research date:** 2026-08-23
**Valid until:** 2026-09-23 (stable backend, no fast-moving deps)

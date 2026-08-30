---
phase: quick-260724-aoq
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/backend/database/routes/debug.ts
  - src/backend/database/database.ts
  - src/ui/lib/console-forwarder.ts
  - src/main.tsx
  - docker/nginx.conf
  - docker/nginx-https.conf
  - src/ui/lib/console-forwarder.test.ts
  - src/backend/database/routes/debug.test.ts
autonomous: true
requirements:
  - PATCH-146

must_haves:
  truths:
    - "Any frontend console.log/warn/error call made after main.tsx boot is preserved (still fires the original console method) AND is enqueued into the forwarder batch buffer"
    - "The forwarder flushes to POST /debug/console-log every 500ms or when 20 entries accumulate (whichever first)"
    - "On visibilitychange->hidden or pagehide, the forwarder issues a final flush via navigator.sendBeacon so an iOS-PWA tab-close still delivers the tail of logs"
    - "POST /debug/console-log requires the standard JWT/session auth cookie; anonymous POSTs return 401"
    - "A valid POST appends each entry as one JSON line to the file path in SKYNET_CONSOLE_FORWARD_LOG_PATH (default /tmp/skynet-console-forward.log)"
    - "The endpoint keeps the most recent 1000 entries in an in-memory ring buffer (overflow drops oldest)"
    - "When the mirror file exceeds 5 MB, the endpoint truncates it and writes a [LOG_ROTATED at <iso-ts>] marker as the first line of the fresh file before continuing"
    - "File-write failures are caught, logged via apiLogger.error, and never crash the process or fail the HTTP response"
    - "Malformed POST bodies (missing entries array, wrong entry shape) return 400"
    - "The wire path is disjoint from the terminal WebSocket — the /debug proxy block in BOTH nginx configs routes to backend, independent of /terminal or any WS location"
  artifacts:
    - path: "src/ui/lib/console-forwarder.ts"
      provides: "initConsoleForwarder() — installs console.log/warn/error patches, batching, and pagehide flush"
      exports: ["initConsoleForwarder"]
      min_lines: 60
    - path: "src/backend/database/routes/debug.ts"
      provides: "Express Router with POST /console-log — auth-gated, ring buffer, file mirror with rotation"
      exports: ["default (Router)"]
      contains: "SKYNET_CONSOLE_FORWARD_LOG_PATH"
      min_lines: 60
    - path: "src/ui/lib/console-forwarder.test.ts"
      provides: "Vitest — proves console.error still calls original method AND enqueues an envelope"
      min_lines: 20
    - path: "src/backend/database/routes/debug.test.ts"
      provides: "Vitest — proves POST with valid body appends one JSON line to the (env-overridden tmpdir) mirror file"
      min_lines: 20
    - path: "src/main.tsx"
      provides: "initConsoleForwarder() call at top of file, before snapshotPendingTab()"
      contains: "initConsoleForwarder"
    - path: "src/backend/database/database.ts"
      provides: "app.use('/debug', debugRoutes) in the route registration block"
      contains: "app.use(\"/debug\", debugRoutes)"
    - path: "docker/nginx.conf"
      provides: "location ~ ^/debug(/.*)?$ block proxying to 127.0.0.1:30001"
      contains: "location ~ ^/debug"
    - path: "docker/nginx-https.conf"
      provides: "location ~ ^/debug(/.*)?$ block proxying to 127.0.0.1:30001 (HTTPS variant)"
      contains: "location ~ ^/debug"
  key_links:
    - from: "src/main.tsx"
      to: "src/ui/lib/console-forwarder.ts"
      via: "top-of-file import + initConsoleForwarder() call before snapshotPendingTab()"
      pattern: "initConsoleForwarder\\(\\)"
    - from: "src/ui/lib/console-forwarder.ts"
      to: "POST /debug/console-log"
      via: "fetch({ credentials: 'include' }) on batch flush; navigator.sendBeacon on pagehide"
      pattern: "/debug/console-log"
    - from: "src/backend/database/database.ts"
      to: "src/backend/database/routes/debug.ts"
      via: "import debugRoutes from './routes/debug.js' + app.use('/debug', debugRoutes)"
      pattern: "app.use\\(\"/debug\", debugRoutes\\)"
    - from: "docker/nginx.conf & docker/nginx-https.conf"
      to: "127.0.0.1:30001 backend /debug/*"
      via: "location ~ ^/debug(/.*)?$ block copied from /compose-drafts pattern"
      pattern: "location ~ \\^/debug"
---

<objective>
Patch #146: build a prototype log-forwarder that mirrors frontend console.log/warn/error output to a server-side file greppable via `sudo docker exec skynet cat /tmp/skynet-console-forward.log`. Unblocks iOS-PWA reconnect debugging (patches #143 v1/v2 both shipped guesses because Ashley's iPhone-installed PWA console was unreachable).

Purpose: give Tina + Ashley a side-channel signal path that DOES NOT share fate with the terminal WebSocket, so when the socket misbehaves, log output still gets through.

Output: new frontend interceptor + backend POST endpoint + in-memory ring + best-effort file mirror with 5 MB rotation + nginx routing in both http/https configs + 2 tests. ~200 net new lines. NO deploy — batched with patch #145 for Ashley's next greenlight.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md

@src/main.tsx
@src/backend/database/routes/compose-drafts.ts
@src/backend/database/database.ts
@docker/nginx.conf
@docker/nginx-https.conf
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create backend /debug/console-log route with ring buffer + file mirror</name>
  <files>src/backend/database/routes/debug.ts, src/backend/database/routes/debug.test.ts</files>
  <behavior>
    Backend test (debug.test.ts, Vitest) — uses supertest-style Express app OR a direct handler-call harness. Set SKYNET_CONSOLE_FORWARD_LOG_PATH to a per-test tmpdir path via `os.tmpdir() + '/skynet-console-forward-test-' + randomHex + '.log'`. NEVER write to /tmp/skynet-console-forward.log during tests. Assertions:
    - Test 1: POST { entries: [{ ts, level: 'error', tabId: 't1', msg: 'boom' }] } with a valid JWT-authenticated request returns 204 (or 200 — pick one and stick with it; 204 preferred, matches compose-drafts.ts convention). After the call, the tmpdir file exists and contains exactly one JSON line whose parsed shape matches the entry.
    - Test 2: POST with malformed body ({} or { entries: 'not-an-array' } or { entries: [{ level: 'bogus' }] }) returns 400. No file write.
    - Cleanup: unlink the tmpdir file in afterEach.
    - If mocking the auth middleware is heavier than the value here, the test may bypass by exercising the raw handler function directly — see host-normalizers.test.ts pattern (function-level tests, no Express harness).
  </behavior>
  <action>
    Create `src/backend/database/routes/debug.ts` mirroring the shape of `src/backend/database/routes/compose-drafts.ts` — same imports (express, AuthenticatedRequest, AuthManager, apiLogger from ../../utils/logger.js — confirm exact export name matches compose-drafts.ts), same Router() + authenticateJWT middleware wiring. Export default the Router.

    Module-scoped state (top of file, after imports, before router construction):
    - `const LOG_PATH = process.env.SKYNET_CONSOLE_FORWARD_LOG_PATH ?? "/tmp/skynet-console-forward.log";` — read once at module load. This is the ONLY read of the env var (per must_haves: grep must find at least 1 hit).
    - `const MAX_RING = 1000;`
    - `const MAX_FILE_BYTES = 5 * 1024 * 1024;`
    - `const ring: LogEntry[] = [];` — in-process Array. .push() then while (ring.length > MAX_RING) ring.shift().

    Define type `LogEntry = { ts: string; level: 'log' | 'warn' | 'error'; tabId: string; hostId?: number; sessionKey?: string; msg: string }`. Add a runtime validator `isValidEntry(x: unknown): x is LogEntry` that checks: object, string ts (any string is fine — don't parse as ISO strictly, prototype tolerates junk), level in {log,warn,error}, string tabId, string msg, and if hostId present → number, if sessionKey present → string. Reject entries failing this shape.

    POST "/console-log" handler (mounted under app.use("/debug", ...) so full path is /debug/console-log), auth-gated by authenticateJWT:
    1. Validate `req.body?.entries` is an Array. If not, 400 `{ error: "entries array required" }`.
    2. Filter entries through isValidEntry. If ALL entries invalid (and there was at least one), 400 `{ error: "no valid entries" }`. If some valid + some invalid, silently drop invalid ones (prototype tolerance) and proceed with the valid subset.
    3. Push valid entries into `ring`, trim to MAX_RING via while-shift.
    4. Best-effort file mirror in a try/catch: check `fs.statSync(LOG_PATH).size` (guard for ENOENT — treat missing file as size 0). If > MAX_FILE_BYTES, `fs.writeFileSync(LOG_PATH, '[LOG_ROTATED at ' + new Date().toISOString() + ']\n')` (truncate + marker). Then `fs.appendFileSync(LOG_PATH, validEntries.map(e => JSON.stringify(e)).join('\n') + '\n')`. On any thrown error, `apiLogger.error("console-forward file mirror failed", err, { operation: "console_forward_write" })` and continue — DO NOT rethrow, DO NOT return 500 (per D constraint: file writes are best-effort, never crash on disk failure).
    5. Return 204. No response body.

    Import `fs` from "fs" (sync methods are fine for the prototype per the constraint that JSON parsing overhead ≈ disk write cost). Import `apiLogger` from "../../utils/logger.js" — confirm the export name from another route file that already uses it (see database.ts line 1767 area: `apiLogger.error(...)` is used at the top-level database.ts, so the import path is known good).

    Author debug.test.ts per the <behavior> block above. Use `beforeEach` to set `process.env.SKYNET_CONSOLE_FORWARD_LOG_PATH` to a fresh tmpdir path — BUT NOTE: since the route module reads the env var ONCE at import time, tests must either (a) use vi.resetModules() + dynamic import per test after setting the env, OR (b) test the handler as a function that reads LOG_PATH lazily. Preferred: refactor the LOG_PATH read to a `function getLogPath() { return process.env.SKYNET_CONSOLE_FORWARD_LOG_PATH ?? "/tmp/skynet-console-forward.log"; }` called inside the handler, so tests can flip the env var per test without module-reset gymnastics. Update the file accordingly and keep the grep-gate satisfied (getLogPath body still contains the env var string literal).
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx vitest run src/backend/database/routes/debug.test.ts</automated>
  </verify>
  <done>
    - `src/backend/database/routes/debug.ts` exists, exports default Router, contains "SKYNET_CONSOLE_FORWARD_LOG_PATH" string literal (grep-gate: `grep -c 'SKYNET_CONSOLE_FORWARD_LOG_PATH' src/backend/database/routes/debug.ts | grep -v '^0$'`)
    - `src/backend/database/routes/debug.test.ts` exists, all cases green
    - `npm run type-check` clean for both new files
  </done>
</task>

<task type="auto">
  <name>Task 2: Mount /debug router in database.ts</name>
  <files>src/backend/database/database.ts</files>
  <action>
    Two surgical edits to `src/backend/database/database.ts`:

    1. Add import alongside the other route imports (lines 6-21 area). Insert `import debugRoutes from "./routes/debug.js";` after the last existing routes import (currently line 21: `import userPreferencesRoutes from "./routes/user-preferences.js";`) — append on a new line 22.

    2. Add route registration in the app.use block (lines 1777-1792). Insert `app.use("/debug", debugRoutes);` on a new line immediately after line 1792 (`app.use("/user-preferences", userPreferencesRoutes);`).

    No other edits. Do NOT touch handlers, static-file wiring, or anything else in the file. Do NOT reorder existing imports/routes.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && grep -c 'app.use("/debug", debugRoutes)' src/backend/database/database.ts | grep -v '^0$' && grep -c 'import debugRoutes from "./routes/debug.js"' src/backend/database/database.ts | grep -v '^0$' && npm run type-check</automated>
  </verify>
  <done>
    Both grep gates return >= 1 (line count > 0), type-check clean, both edits present at the expected line ranges (imports near L22, app.use near L1793).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Create frontend console-forwarder + wire into main.tsx</name>
  <files>src/ui/lib/console-forwarder.ts, src/ui/lib/console-forwarder.test.ts, src/main.tsx</files>
  <behavior>
    Frontend test (console-forwarder.test.ts, Vitest) — must prove the console-preservation invariant AND enqueue behavior. Assertions:
    - Test 1: Before calling initConsoleForwarder, capture `const originalError = console.error`. After init, call `console.error('probe-message')`. Assert (via vi.spyOn on the original — OR by asserting the message reaches the internal buffer AND the spy on `originalError` was called with 'probe-message'). The check that MUST hold: original method fires first, envelope is enqueued after. Achieve this by using vi.spyOn(console, 'error') BEFORE init — the spy captures the ORIGINAL, then initConsoleForwarder patches on top of the spy, so calling console.error hits the patch → the patch calls the (spied) original + enqueues.
    - Test 2: Call `console.log('one')`, `console.warn('two')`, `console.error('three')`. Assert the internal buffer (expose via a test-only `__getBuffer()` export OR via a getter passed as an argument to initConsoleForwarder for testability) contains 3 envelopes with matching level/msg and non-empty ts strings.
    - Do NOT test the fetch/sendBeacon path — that requires DOM+network mocks and is not the load-bearing invariant for this prototype. The endpoint test in Task 1 covers the server side; end-to-end wire behavior is verified by Ashley post-deploy grepping the mirror file.
    - Use fake timers to prevent the 500ms batch flush from firing real fetch during tests: `vi.useFakeTimers()` in beforeEach, `vi.useRealTimers()` in afterEach.
  </behavior>
  <action>
    Create `src/ui/lib/console-forwarder.ts` exporting `initConsoleForwarder(): void` (idempotent — guard with a module-scoped `let initialized = false` so double-init is a no-op).

    Module-scoped state:
    - `const buffer: LogEntry[] = [];` — batch buffer (separate from server ring buffer)
    - `const MAX_BATCH = 20;`
    - `const FLUSH_INTERVAL_MS = 500;`
    - `let flushTimer: ReturnType<typeof setTimeout> | null = null;`
    - `let initialized = false;`

    Type: `type LogEntry = { ts: string; level: 'log' | 'warn' | 'error'; tabId: string; msg: string };` — matches server-side shape (hostId/sessionKey omitted for prototype since no wired tabId source yet; add fields later when the tabId accessor lands).

    Helper `getTabId(): string` — reads from a module-level accessor. For THIS patch, hard-code `return 'no-tab';` as the placeholder per the locked design decision #7. Add a `// TODO: wire from AppShell active tab in follow-up patch` comment above.

    Helper `serializeArg(a: unknown): string` — best-effort. String → as-is; Error → `${a.name}: ${a.message}\n${a.stack ?? ''}`; object → try JSON.stringify with a try/catch fallback to String(a); everything else → String(a). Join multiple console args with a single space.

    `initConsoleForwarder()`:
    1. If initialized, return. Set initialized = true.
    2. Capture originals: `const origLog = console.log.bind(console);` etc. for log/warn/error.
    3. Patch each: `console.log = (...args) => { origLog(...args); enqueue('log', args); };` — origLog FIRST (preserves DevTools console AND preserves Error stack trace on error). Same shape for warn/error. Do NOT patch debug/info.
    4. Register `window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushBeacon(); });` and `window.addEventListener('pagehide', flushBeacon);`

    `enqueue(level, args)`:
    - Push `{ ts: new Date().toISOString(), level, tabId: getTabId(), msg: args.map(serializeArg).join(' ') }` to buffer.
    - If buffer.length >= MAX_BATCH, call flushFetch() synchronously (drains).
    - Else if flushTimer is null, `flushTimer = setTimeout(flushFetch, FLUSH_INTERVAL_MS);`

    `flushFetch()` (normal path):
    - Clear flushTimer (null it out).
    - If buffer empty, return.
    - Drain: `const entries = buffer.splice(0);` — clears buffer in one op.
    - `fetch('/debug/console-log', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries }) }).catch(() => { /* swallow — best-effort, don't re-enqueue on failure or we loop forever on a broken endpoint */ });`

    `flushBeacon()` (pagehide/visibility-hidden path):
    - Clear flushTimer.
    - If buffer empty, return.
    - Drain into entries.
    - `const blob = new Blob([JSON.stringify({ entries })], { type: 'application/json' });`
    - `const ok = navigator.sendBeacon?.('/debug/console-log', blob) ?? false;`
    - If !ok, swallow — entries are already lost to the tab close per the constraint.
    - (sendBeacon rides same-origin auth cookies automatically; no credentials option available.)

    For TESTABILITY: export a `__test_getBuffer(): LogEntry[]` function that returns a shallow copy of `buffer`. Mark it with a `/** @internal — test-only */` JSDoc so it's visible to intent readers. Alternative: accept an optional `{ onEnqueue?: (entry: LogEntry) => void }` options bag to initConsoleForwarder — simpler and doesn't leak internals. Pick ONE approach, stick with it. Prefer the options bag for cleanliness.

    Then edit `src/main.tsx`: add `import { initConsoleForwarder } from "@/lib/console-forwarder";` alongside the other imports (near the existing `import { snapshotPendingTab } from "@/lib/tab-url";` on line 17). Insert `initConsoleForwarder();` as a NEW LINE immediately BEFORE the existing `snapshotPendingTab();` call at line 22. Preserve the existing comment block above snapshotPendingTab. Result: line 22 becomes `initConsoleForwarder();`, line 23 becomes `snapshotPendingTab();`.

    Author console-forwarder.test.ts per the <behavior> block. Reset the module between tests to defeat the `initialized` guard: `vi.resetModules()` in beforeEach then dynamic-import initConsoleForwarder fresh per test.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx vitest run src/ui/lib/console-forwarder.test.ts && grep -c 'initConsoleForwarder()' src/main.tsx | grep -v '^0$' && npm run type-check</automated>
  </verify>
  <done>
    - console-forwarder.ts exports initConsoleForwarder, test passes both cases
    - main.tsx has initConsoleForwarder() call BEFORE snapshotPendingTab() at top of file
    - type-check clean
    - No regressions: `npx vitest run --changed HEAD` (or a scoped run of any test file touched) stays green
  </done>
</task>

<task type="auto">
  <name>Task 4: Add /debug location blocks to BOTH nginx configs (nginx caveat)</name>
  <files>docker/nginx.conf, docker/nginx-https.conf</files>
  <action>
    Copy the exact `/compose-drafts` block pattern into BOTH nginx configs — this is the CLAUDE.md nginx caveat: missing an nginx block for a new backend route causes 200-with-index.html responses that crash the frontend on .map file lookups.

    In `docker/nginx.conf`, insert immediately after the `location ~ ^/compose-drafts(/.*)?$ { ... }` block (currently ends around line 233):

    ```
    location ~ ^/debug(/.*)?$ {
        proxy_pass http://127.0.0.1:30001;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    ```

    (The action prose describes the block; the executor writes it into nginx.conf as literal directives — nginx uses its own DSL, not TypeScript, so directive text in the file is not fenced code in a task-prose sense. Preserve indentation to match neighbors — 8 spaces per the surrounding blocks.)

    In `docker/nginx-https.conf`, insert the identical block immediately after the `location ~ ^/compose-drafts(/.*)?$ { ... }` block (currently ends around line 244 — confirmed via grep, `location ~ ^/compose-drafts` is at L237 in the https variant).

    Do NOT add `client_max_body_size` or `proxy_read_timeout` overrides — this is a low-volume batched-JSON endpoint, defaults are correct. Do NOT touch any other location blocks. Do NOT edit Caddyfile — that's outside skynet's container (edge is Caddy, but the /debug proxying inside the skynet container is handled by nginx per the existing pattern for /compose-drafts, /identities, etc.).
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && grep -c 'location ~ \^/debug' docker/nginx.conf | grep -v '^0$' && grep -c 'location ~ \^/debug' docker/nginx-https.conf | grep -v '^0$'</automated>
  </verify>
  <done>
    Both nginx configs contain exactly one `location ~ ^/debug(/.*)?$` block with the same 6 proxy_* directives as the /compose-drafts peer block. Grep confirms 1 hit per file. (If someone accidentally added two, that's still >= 1 so the gate passes — visual review during commit review catches duplicates.)
  </done>
</task>

<task type="auto">
  <name>Task 5: Full regression sweep + commit</name>
  <files>(no new files — verification + git only)</files>
  <action>
    Run the full check suite before committing:
    1. `npm run type-check` — must be clean.
    2. `npx vitest run src/backend/database/routes/debug.test.ts src/ui/lib/console-forwarder.test.ts` — new tests green.
    3. `npx vitest run` — full suite green (no regressions). If this is too slow, at minimum run `npx vitest run src/backend src/ui/lib` to cover the touched subsystems.
    4. `npm run build` — production build succeeds (this catches Vite path/alias breakage on the new @/lib/console-forwarder import).
    5. `git status` — confirm ONLY the expected files are dirty: src/backend/database/routes/debug.ts, src/backend/database/routes/debug.test.ts, src/backend/database/database.ts, src/ui/lib/console-forwarder.ts, src/ui/lib/console-forwarder.test.ts, src/main.tsx, docker/nginx.conf, docker/nginx-https.conf. Nothing else. If drift is present, investigate BEFORE committing.
    6. `git diff --stat` — sanity check line counts (~200 net new lines expected).
    7. Commit with the exact subject line from the constraints:

       `feat: patch #146 — log-forwarder prototype (frontend console intercept + backend POST endpoint + file mirror for docker-exec grep read path)`

       NO Co-Authored-By trailer (fork convention). Single atomic commit. Use `git add` for each expected file explicitly (never `git add -A` or `git add .` per commit safety rules) then `git commit -m "..."`.

    8. DO NOT push. DO NOT deploy. DO NOT edit `~/.claude/identities/tina/skynet-patches.md` — batched write-up at deploy-recommendation time per the constraints.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npm run type-check && npx vitest run src/backend/database/routes/debug.test.ts src/ui/lib/console-forwarder.test.ts && npm run build && git log -1 --format=%s | grep -F 'patch #146'</automated>
  </verify>
  <done>
    - Type-check clean, both new tests green, full-scope regression run green, build succeeds
    - Single atomic commit on current branch with the exact subject line
    - `git log -1 --format=%B` shows NO `Co-Authored-By:` line
    - `git status` is clean (no uncommitted drift)
    - No push, no deploy, no patches.md edit
  </done>
</task>

</tasks>

<verification>
End-to-end phase check (Tina reviews before flagging for Ashley's next batch greenlight):

1. **Wire disjointness confirmed:** grep both nginx configs for the /debug block; grep the backend for `app.use("/debug"` — the transport is HTTP POST through the edge proxy, disjoint from any /terminal or WebSocket location. When the terminal WS is misbehaving, the log wire is unaffected.

2. **Auth gate confirmed:** manually inspect debug.ts — the `authenticateJWT` middleware is applied to POST /console-log identically to the compose-drafts pattern (compare side-by-side). Anonymous requests get 401.

3. **Console preservation confirmed:** open the frontend test — the assertion that `originalError` was called with the probe message proves DevTools console output is preserved (Ashley + Tina still see logs in their browser DevTools normally, forwarding is additive).

4. **File-mirror best-effort confirmed:** the try/catch around fs.appendFileSync in debug.ts is present and calls apiLogger.error rather than rethrowing. Grep-confirm: `grep -A2 'appendFileSync' src/backend/database/routes/debug.ts` shows a catch handler.

5. **iOS PWA scenario confirmed by construction:** initConsoleForwarder registers pagehide + visibilitychange handlers that call sendBeacon. Test coverage of the beacon path is intentionally omitted (jsdom navigator.sendBeacon is a stub), verification is by-construction — the exact API pattern iOS Safari documents for background-safe delivery.

6. **Nginx caveat honored:** both http and https configs have the /debug block. If either is missing, backend route returns HTML on 404 and frontend chokes on .map. Grep gates in Task 4 prove both blocks exist.
</verification>

<success_criteria>
- Ashley (or Tina via docker-exec) can `sudo docker exec skynet cat /tmp/skynet-console-forward.log | tail` and see JSON lines of frontend console output after visiting term.gigaashley.click and doing anything that logs
- iPhone PWA close/background scenario: last batch of logs before backgrounding shows up in the file (sendBeacon delivery)
- Terminal WS remains unaffected — no shared code path
- All 5 tasks complete, all verify gates green, single atomic commit on current branch, ~200 lines net
- No push, no deploy, no patches.md edit (batched with #145 for Ashley's next greenlight)
</success_criteria>

<output>
Create `.planning/quick/260724-aoq-patch-146-log-forwarder-prototype-fronte/260724-aoq-SUMMARY.md` when done. Follow the standard summary template: what was built, what tests cover, exact commit SHA, any surprises hit during implementation (e.g., if the module-load env var read forced the refactor to a lazy getLogPath() called from within the handler — document it), and the deploy-batch note ("batched with patch #145 for Ashley's next greenlight; patches.md write-up deferred to deploy-recommendation time").
</output>

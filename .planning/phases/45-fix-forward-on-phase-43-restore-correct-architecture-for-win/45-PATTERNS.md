# Phase 45: Fix-forward on Phase 43 — Pattern Map

**Mapped:** 2026-08-18
**Files analyzed:** 15 (backend revert + client rewrite + test file surgery + 1 padding-restore + 1 speculative Bug #3 guard)
**Analogs found:** 15 / 15
**Nature of phase:** Fix-forward revert. Every file being modified has TWO strong analogs:
  1. The CURRENT (Phase-43-shipped) file — for the delete-what-Phase-43-added surgery.
  2. The PRE-Phase-43 file (`git show <commit>~1:<path>`) — for the exact byte-shape the revert restores.
Plus one file (`PrettyView.tsx`) needs a NEW behavior grafted (client-side drop-oldest cap during hydration) and one line added (`paddingBottom: 9`).

**Corrections to CONTEXT.md file list (verified from git + grep, see § Metadata):**
- `session-file-parser.ts` was NOT modified by Phase 43. The `readSessionFileRange` + `resolveEventIdToLine` helpers live in a NEW MODULE `src/backend/claude-session/session-file-range.ts` (with its own test file `session-file-range.test.ts`). The revert deletes that module + its test wholesale; `session-file-parser.ts` is not touched.
- `src/shared/*.ts` referenced in CONTEXT does not exist as a directory. The client-facing wire types (`FetchOlderPayload`, `FetchOlderBatchEvent`, `sendFetchOlder`, `isFetchOlderBatchEvent`) all live in `src/ui/api/claude-session-api.ts`. The `historyWindow?: number` opt-in also lives there on `openClaudeSessionSocket`. There is no separate shared-types directory to prune.
- Backend Phase 43 additions land in TWO files (not four): `session-file-tail.ts` (initialLines param) + `claude-session-server.ts` (import block + `handleFetchOlder` + `parseHistoryWindow` + `historyWindowParsed` threading + `case "fetch_older":` in msg switch). Plus the freestanding `session-file-range.ts` module.

---

## File Classification

| Change | File | Role | Data Flow | Closest Analog | Match Quality |
|--------|------|------|-----------|----------------|---------------|
| **revert** (surgical) | `src/backend/claude-session/session-file-tail.ts` | backend SSH file-tail helper | streaming (SSH exec channel) | `git show f60514b5~1:src/backend/claude-session/session-file-tail.ts` (pre-43-01 state, 142 lines) | exact — this IS the target byte-shape |
| **delete** (whole file) | `src/backend/claude-session/session-file-range.ts` | backend range-read + eventId-lookup helper module | request/response (one-shot SSH exec) | Deletion — the module was born in Phase 43 (commit `1a02ef04`); it did not exist before | n/a — pure deletion |
| **delete** (whole file) | `src/backend/claude-session/session-file-range.test.ts` | backend test | test | Deletion — companion of above (336 lines, sole consumer of `session-file-range.ts` exports outside `claude-session-server.ts`) | n/a — pure deletion |
| **revert** (surgical) | `src/backend/claude-session/claude-session-server.ts` | backend WS server | request/response + streaming | Remove 4 discrete Phase 43 regions (imports L14-17; `handleFetchOlder` + `parseHistoryWindow` L722-954; `historyWindowParsed` binding L1926; two `tailSessionFile` 5th-arg calls at L3097 + L5575; `case "fetch_older"` L4526-4540). Analog for the shape of each removal: the byte-shape at `1a02ef04~1` for the same file (pre-P43 state) | exact — line-locus deletion |
| **delete** (whole file) | `src/backend/claude-session/claude-session-server.fetch-older.test.ts` | backend WS-handler test | test | Deletion — 327 lines locking a handler about to be deleted | n/a — pure deletion |
| **delete** (whole file) | `src/backend/claude-session/claude-session-server.history-window.test.ts` | backend URL-parse test | test | Deletion — 251 lines locking `parseHistoryWindow` about to be deleted | n/a — pure deletion |
| **revert** (surgical) | `src/ui/api/claude-session-api.ts` | frontend WS client (wire types + one-shot helpers) | request/response | Remove Phase 43 additions: the `historyWindow?: number` opts param on `openClaudeSessionSocket` (L14-42); the entire Phase 43 wire-type block L876-1001 (`FetchOlderPayload`, `FetchOlderBatchEvent`, `sendFetchOlder`, `isFetchOlderBatchEvent`). Analog: sibling one-shot helper `countIdentityBounties` at L1017-1059 (the extant pattern the deletions don't touch) | exact — line-locus deletion |
| **delete** (whole file) | `src/ui/api/claude-session-api.test.ts` | frontend WS client test | test | Deletion — 174 lines, 100% Phase 43 `sendFetchOlder` + `isFetchOlderBatchEvent` coverage (see § Metadata for evidence) | n/a — pure deletion |
| **revert-then-graft** | `src/ui/features/pretty-view/PrettyView.tsx` | frontend React component | streaming (WS message append) + drop-oldest cap on hydration | Two-part surgery: (a) DELETE Phase-43 fetch_older client (imports L9-13, constants L102/104-113, refs L783-887, `case "fetch_older_batch"` L1396-1442, loading-hint mount L2449-2466); (b) KEEP client-side drop-oldest cap (`appendDedupWithCap` L221-238 + all 5 live-append cases L1354-1393); (c) ADD `style={{ paddingBottom: 9 }}` to bubble wrapper L2478-2483. Pre-P43 (43-07a) analog for wrapper shape: `git show 5bc24f49~1:src/ui/features/pretty-view/PrettyView.tsx` L2380-2405 (paddingBottom on the virtualized item wrapper) | mixed — surgical delete + surgical keep + one-line add |
| **delete-and-recreate** | `src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx` | frontend integration test | test | Delete-recreate. Current file (888 lines, 11 tests) locks the fetch_older + historyWindow-URL behaviors being removed. New replacement file locks client-side hydration cap (drop-oldest during initial hydration) + auto-scroll regressions. Analog for infrastructure: sibling `PrettyView.plain-dom.test.tsx` (658 lines — identical WS-stub + ResizeObserver polyfill + offsetHeight override; DOES NOT touch Phase 43 constructs; stays intact) | exact — same infra, different assertions |
| **investigate-then-guard** (deferred, one plan) | Bug #3 candidate site — one of 3 (`ComposeBox.tsx:1194`, `AppShell.tsx:1239`, `commandTags.ts:53`) | frontend render/send path | transform | Post-deploy repro drives selection. Once site confirmed, analog for guard style: existing early-return patterns in these files (`if (!s) return "";` shape). See § Bug #3 investigation plan below | pattern-match — deferred until repro |
| **preserve** (no change) | `src/ui/features/pretty-view/PrettyView.plain-dom.test.tsx` | frontend test | test | Untouched — 6 tests covering plain-DOM render + overflow-anchor + aside-arm walk + accessory sibling layout + all 5 wire frames + data-event-id preservation. Does NOT touch fetch_older or historyWindow. Only Phase 43 mention is one comment (L39) that becomes accurate-of-history rather than accurate-of-code post-revert | n/a — no change required |
| **preserve** (no change) | `src/ui/features/pretty-view/use-auto-scroll.ts` | frontend React hook | scroll listener | Untouched — 86-line plain-DOM pinned-follow hook from plan 43-06 is correct + unrelated to the three bugs. Out of Phase 45 scope per CONTEXT `<scope_fence>` | n/a — no change required |
| **preserve** (no change) | `src/backend/claude-session/session-file-parser.ts` | backend line parser | transform | Untouched — has no Phase 43 additions (CONTEXT.md was imprecise; git log confirms) | n/a — no change required |
| **preserve** (no change) | `src/backend/claude-session/session-file-parser.test.ts` | backend test | test | Untouched — has no Phase 43 spec bodies | n/a — no change required |

---

## Pattern Assignments

### 1. `src/backend/claude-session/session-file-tail.ts` — revert to pre-Phase-43 (delete `initialLines` param)

**Analog (byte-shape target):** `git show f60514b5~1:src/backend/claude-session/session-file-tail.ts` — the pre-43-01 file, 142 lines total.

**Nature of change:** Remove the 5th optional `initialLines?: number` parameter, all its validation (`boundedN` computation L89-101), and the ternary branch on the shell command (L103-106). Restore the pre-Phase-43 hardcoded command string.

**Delete block 1** — parameter (current L40-48):
```typescript
  // Phase 43: optional bounded-initial-slice. When set to a positive
  // finite integer within [1, 1_000_000], the tail command switches from
  // `-n +1` (start at file line 1, unbounded backfill) to `-n N` (start
  // at last N lines from EOF, then follow). Missing / invalid values
  // fall through to the current `-n +1` default byte-for-byte —
  // backcompat mandated by .planning/phases/43-.../43-CONTEXT.md
  // § "Backcompat / migration": *legacy callers get the current
  // unbounded initial replay*.
  initialLines?: number,
```

**Delete block 2** — `boundedN` computation (current L89-101):
```typescript
  // Phase 43: validate `initialLines` into `boundedN` — the source of truth
  // for the command branch below. The 1_000_000 upper bound is a defensive
  // cap so a runaway caller can't hand `tail` an absurd arg; anything
  // outside the finite-positive-int-≤-cap window falls back to the legacy
  // `-n +1` default. `Math.floor` normalizes fractional inputs to integer
  // line counts before they hit the shell.
  const boundedN: number | null =
    typeof initialLines === "number" &&
    Number.isFinite(initialLines) &&
    initialLines > 0 &&
    initialLines <= 1_000_000
      ? Math.floor(initialLines)
      : null;
```

**Replace current L103-106 command construction with pre-P43 byte-shape (from `f60514b5~1`):**
```typescript
  const command = "tail -F -n +1 " + shellEscape(absolutePath);
```

**Preserve everything else byte-for-byte:** the header comment (L1-23), `shellEscape` helper (L25-29), `TailHandle` type, `STDERR_ACCUMULATION_LIMIT_BYTES` constant, function signature (minus 5th param), `stopped` / `stream` / `buffer` / `stderrBuf` / `anyStdout` locals, `stop` closure, `conn.exec` callback body with stdout/stderr handlers. All unchanged.

**Header comment note:** the pre-Phase-43 header at L7-22 already documents `-n +1` as "start at line 1"; do NOT need to touch it. The current file's header is identical to pre-P43 (Phase 43 did not modify it — only the signature + command line).

---

### 2. `src/backend/claude-session/session-file-range.ts` — DELETE WHOLE FILE

**Analog:** Deletion — file was born in Phase 43 commit `1a02ef04` (43-02). Pre-P43 state = file does not exist.

**Justification:** Whole-file deletion is safer + more auditable than surgical removal. Two exports (`readSessionFileRange`, `resolveEventIdToLine`) are consumed by exactly ONE file outside the range module + its own test: `claude-session-server.ts` (imports at L14-17 + call sites at L817 + L859). Once the `claude-session-server.ts` revert (§ 4 below) drops those imports and call sites, `session-file-range.ts` has zero consumers and deleting it produces a cleaner `git log` for future revert investigations.

**Pattern for deletion validation:** after deleting, run `git grep 'session-file-range\|readSessionFileRange\|resolveEventIdToLine' src/` — expect ZERO hits. Same discipline Phase 43 Plan 43-08 used for `@tanstack/react-virtual` removal (SUMMARY.md 43-08 § Verification).

---

### 3. `src/backend/claude-session/session-file-range.test.ts` — DELETE WHOLE FILE

**Analog:** Deletion — 336 lines, sole test consumer of `session-file-range.ts`. Deletion is trivially correct once the module it tests is deleted.

---

### 4. `src/backend/claude-session/claude-session-server.ts` — revert 4 discrete Phase 43 regions

**Analog:** Same file at `1a02ef04~1` (pre-43-02, before the range imports and handler were added). Byte-shape target for each deletion region.

**Delete block 1** — imports (current L14-17):
```typescript
import {
  resolveEventIdToLine,
  readSessionFileRange,
} from "./session-file-range.js";
```

**Delete block 2** — `handleFetchOlder` + `__handleFetchOlderForTests` + `parseHistoryWindow` + `__parseHistoryWindowForTests` (current L722-954, ~232 lines). Includes:
- Header comment L722-739 ("─── Phase 43 Plan 43-04: fetch_older WS handler + historyWindow parse ───" through the "vitest drives ... without a WSS + ssh2 bring-up" line).
- `FETCH_OLDER_MAX_COUNT` const L745.
- `handleFetchOlder` function L747-917 (all 6 stages: coerce → validate anchorEventId → validate count → precondition sshConn+currentSessionFile → try block with resolveEventIdToLine + range read + emit + error catch).
- `__handleFetchOlderForTests` seam L921.
- Header comment L923-934.
- `HISTORY_WINDOW_MAX` const L935.
- `parseHistoryWindow` function L937-951.
- `__parseHistoryWindowForTests` seam L954.

**Delete block 3** — `historyWindowParsed` binding at connect (current L1909-1926):
```typescript
  // Phase 43 Plan 43-04: parse historyWindow off the WS handshake URL
  // (mirrors the JWT-URL-fallback pattern at L1618-1622). When set to a
  // positive integer in [1, 5000], threaded into tailSessionFile as the
  // 5th `initialLines` arg — the tail command switches from `-n +1`
  // (unbounded backfill) to `-n N` (bounded initial slice). Missing /
  // invalid → undefined → tailSessionFile falls through to the legacy
  // `-n +1` default byte-for-byte (backcompat for any caller that doesn't
  // opt in, e.g. countIdentityBounties one-shot WS).
  //
  // The observation channel (onLine fan-out below, parseSessionLine
  // emission switch) is UNAFFECTED — historyWindow only shapes the
  // shell command's initial-slice size. Once the tail is running, every
  // line the tail emits still reaches parseSessionLine + all observation
  // derivations (layer1-detect, context-pct, plan-pending, backgrounded
  // agents/shells, id-reset). This is the emission-vs-observation
  // decoupling locked in Phase 43 CONTEXT.md § "Observation channel
  // UNTOUCHED".
  const historyWindowParsed = parseHistoryWindow(req);
```

**Delete block 4a** — first `tailSessionFile` call, session-rotation branch (current L3086-3098):
```typescript
    // Phase 43 Plan 43-04: thread the connection-scoped `historyWindowParsed`
    // as the 5th `initialLines` arg. The bound applies to the newly-
    // rotated session's initial replay too (same emission-window discipline
    // as the fresh-connect path below). undefined → tail defaults to
    // `-n +1` byte-for-byte (backcompat).
    if (sshConn) {
      tailHandle = tailSessionFile(
        sshConn,
        newSessionFile,
        onLine,
        onError,
        historyWindowParsed,
      );
    }
```
**Replace with pre-P43 4-arg form:**
```typescript
    if (sshConn) {
      tailHandle = tailSessionFile(sshConn, newSessionFile, onLine, onError);
    }
```

**Delete block 4b** — second `tailSessionFile` call, fresh-connect branch (current L5567-5576):
```typescript
    // Phase 43 Plan 43-04: 5th arg = connection-scoped historyWindowParsed
    // from the handshake URL. undefined → tail defaults to `-n +1`
    // byte-for-byte (backcompat for callers that don't opt in).
    tailHandle = tailSessionFile(
      sshConn!,
      sessionFile,
      onLine,
      onError,
      historyWindowParsed,
    );
```
**Replace with pre-P43 4-arg form:**
```typescript
    tailHandle = tailSessionFile(sshConn!, sessionFile, onLine, onError);
```

**Delete block 5** — `case "fetch_older":` dispatch in the msg switch (current L4526-4540):
```typescript
    // Phase 43 Plan 43-04: fetch_older — client's request for a historical
    // slice of the JSONL beyond the loaded window. Delegates to the extracted
    // handleFetchOlder handler which resolves anchorEventId → line via
    // resolveEventIdToLine, reads the [max(1, anchorLine-count), anchorLine-1]
    // slice via readSessionFileRange, and emits ONE fetch_older_batch response
    // frame (success OR error path — never silent) so the client's loading
    // indicator always clears.
    //
    // Precondition validation (sshConn + currentSessionFile) happens INSIDE
    // handleFetchOlder so the client always receives a graceful error frame
    // rather than hanging.
    if (msg.type === "fetch_older") {
      await handleFetchOlder({ ws, msg, sshConn, currentSessionFile });
      return;
    }
```

**Preserve everything else byte-for-byte:** the extant `handleIdentityCountBounties` handler + seam L568-720 (extracted-handler pattern that `handleFetchOlder` mirrored — it stays because it's not Phase 43); the observation channel (`onLine` fan-out to layer1-detect, context-pct, plan-pending, backgroundedAgents/Shells, id-reset); every other WS request handler in the msg switch; the JWT-URL fallback pattern at L1618-1622 (which `parseHistoryWindow` mirrored — that pattern stays intact as a sibling because it's pre-Phase-43).

**Verification after edits:** `git grep 'fetch_older\|historyWindow\|readSessionFileRange\|resolveEventIdToLine\|handleFetchOlder\|parseHistoryWindow' src/backend/` — expect ZERO hits. The only remaining `session-file-range` reference across the entire tree should be inside the planning artifacts (`.planning/`), not `src/`.

---

### 5. `src/backend/claude-session/claude-session-server.fetch-older.test.ts` — DELETE WHOLE FILE

**Analog:** Deletion — 327 lines, 100% coverage of `handleFetchOlder` which is being deleted. The test seam `__handleFetchOlderForTests` disappears with the handler.

---

### 6. `src/backend/claude-session/claude-session-server.history-window.test.ts` — DELETE WHOLE FILE

**Analog:** Deletion — 251 lines, 100% coverage of `parseHistoryWindow` which is being deleted. Seam `__parseHistoryWindowForTests` disappears with the parse helper.

---

### 7. `src/ui/api/claude-session-api.ts` — revert Phase 43 additions

**Analog for the deletion targets:** the file itself.

**Analog for what stays (the sibling one-shot helper pattern):** `countIdentityBounties` at current L1017-1059 — same file, unchanged, unrelated to Phase 43. That handler's shape (open own WS, send payload on onopen, resolve on matching-type onmessage, close socket) is the extant one-shot pattern the deleted `sendFetchOlder` mimicked but adapted to an existing socket. `countIdentityBounties` stays untouched.

**Delete block 1** — Phase 43 opt-in on `openClaudeSessionSocket` (current L14-42). Restore pre-P43 shape:
```typescript
export function openClaudeSessionSocket(): WebSocket {
  const scheme =
    typeof window !== "undefined" && window.location.protocol === "https:"
      ? "wss:"
      : "ws:";
  const host =
    typeof window !== "undefined" ? window.location.host : "localhost";
  const url = `${scheme}//${host}/claude-session/websocket/`;
  return new WebSocket(url);
}
```
Removes: `opts?: { historyWindow?: number }` param, the 13-line JSDoc comment L15-26 describing the historyWindow opt-in, the `hw` / `qp` construction L35-39, the query-string interpolation on the URL.

**Delete block 2** — the entire Phase 43 wire-type + helper block (current L876-1001, ~125 lines). Includes:
- Header comment L876-901 ("─── Phase 43: fetch_older WS wire types (scaffolding — no consumers here) ──" through the "This plan (43-03) only adds the types." line).
- `FetchOlderPayload` type L903-921.
- `FetchOlderBatchEvent` type L923-949.
- `sendFetchOlder` function L951-981 (with all 3 JSDoc paragraphs above).
- `isFetchOlderBatchEvent` type-guard L983-1001 (with JSDoc).

**Verification after edits:** `git grep 'fetch_older\|historyWindow\|sendFetchOlder\|isFetchOlderBatchEvent\|FetchOlder' src/ui/` — expect ZERO hits.

---

### 8. `src/ui/api/claude-session-api.test.ts` — DELETE WHOLE FILE

**Analog:** Deletion — 174 lines, ENTIRE FILE is Phase 43 `sendFetchOlder` + `isFetchOlderBatchEvent` coverage. Grep confirms every single spec references one of those two names (see § Metadata for evidence).

---

### 9. `src/ui/features/pretty-view/PrettyView.tsx` — three-part surgery

**Nature of change:** (a) delete Phase 43 CLIENT PATHS for fetch_older + historyWindow (backend no longer supports either); (b) KEEP client-side drop-oldest cap on hydration + live-append (Ashley's UAT decision explicitly moves the windowing to client-side); (c) add `paddingBottom: 9` to the bubble wrapper.

---

**Part (a) — DELETE Phase 43 fetch_older client:**

**Delete block 1** — imports (current L9-13):
```typescript
  sendFetchOlder,
  isFetchOlderBatchEvent,
  type ClaudeSessionServerEvent,
  type ConnectToPanePayload,
  type FetchOlderPayload,
```
**Replace with:**
```typescript
  type ClaudeSessionServerEvent,
  type ConnectToPanePayload,
```
(preserve `ClaudeSessionServerEvent` + `ConnectToPanePayload`, which are unrelated to fetch_older).

**Delete block 2** — planner-locked constants that are no longer used (current L102-113):
- KEEP `INITIAL_WINDOW = 50` and `WORKING_SET_CAP = 150` — these MOVE from "server-cap + client-cap" semantics to "client-cap only" semantics. Rename or repurpose them: Ashley's CONTEXT says "keep the cap Phase 43 shipped as." Planner's discretion which const name survives — recommendation: keep `WORKING_SET_CAP = 150` for the sustained cap and rename `INITIAL_WINDOW` → dropped (or keep as a documented alias if the planner sees value; recommendation: drop it since the concept "how many the server sends" is gone).
- DELETE `REFETCH_BATCH_SIZE = 50` (fetch_older gone).
- DELETE `NEAR_TOP_TRIGGER_PX = 500` (near-top scroll listener gone).
- DELETE `LOAD_OLDER_DEBOUNCE_MS = 250` (debounce for the deleted listener).
- DELETE `LOADING_HINT_THRESHOLD_MS = 150` (loading hint gone).

Also update the multi-line const-block header comment L94-107 to remove references to fetch_older / server-cap semantics and describe the new "client-side cap on all messages" reality. The comment currently says: *"INITIAL_WINDOW ... backend caps tail -F to -n INITIAL_WINDOW"* — that comment is now a lie post-revert. Rewrite to reflect the new architecture (see Ashley's verbatim quote in CONTEXT `<decisions>` § "Client architecture": *"the client keeps only the last N"*).

**Delete block 3** — refs + state for fetch_older (current L783-802):
```typescript
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const reachedBeginningRef = useRef<boolean>(false);
  const fetchInFlightRef = useRef<boolean>(false);
  const [loadingOlder, setLoadingOlder] = useState<boolean>(false);
  const loadingHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Reset reachedBeginningRef on pane change — a fresh pane starts with the
  // possibility of older messages regardless of the prior pane's state.
  useEffect(() => {
    reachedBeginningRef.current = false;
    fetchInFlightRef.current = false;
  }, [hostId, tmuxSession]);

  const composedScrollRef = useCallback(
    (el: HTMLElement | null) => {
      scrollRef(el);
      setScrollEl(el);
    },
    [scrollRef],
  );
```
Also delete the `messagesRef` live-mirror at L808-811 IF it has no other consumer post-deletion — grep first: `grep -n messagesRef src/ui/features/pretty-view/PrettyView.tsx`.

**Delete block 4** — `fireFetchOlder` useCallback + near-top-scroll effect + cleanup effect (current L813-887, ~74 lines).

**Delete block 5** — `case "fetch_older_batch":` dispatch (current L1396-1442, ~47 lines).

**Delete block 6** — loading-hint mount (current L2449-2466, ~18 lines):
```tsx
          {/* Phase 43 (plan 43-07b): loading-hint element. Silent-when-fast ... */}
          {loadingOlder && (
            <div
              data-testid="pv-loading-older"
              role="status"
              className="text-center text-xs text-[color:var(--color-pv-code-fg)] opacity-70 py-2"
            >
              loading older messages…
            </div>
          )}
```

**Delete block 7** — `openClaudeSessionSocket` opt-in (current L1244-1247):
```typescript
    // Phase 43 Plan 43-07b — pass INITIAL_WINDOW so the backend caps its
    // initial `tail -F -n INITIAL_WINDOW` (43-04 wire contract). Missing/
    // legacy calls still yield unbounded backfill via the API default.
    const ws = openClaudeSessionSocket({ historyWindow: INITIAL_WINDOW });
```
**Replace with pre-P43 form:**
```typescript
    const ws = openClaudeSessionSocket();
```

**Change block 8** — outer scroll container ref binding (current L2437). The ref was changed from `scrollRef` (from `useAutoScroll`) to `composedScrollRef` (local) so the fetch_older listener could also grab the element. With fetch_older gone, `composedScrollRef` is deleted (see block 3) — revert the ref binding to the useAutoScroll `scrollRef` directly:
```typescript
          ref={scrollRef}
```
Also update the comment block above (L2430-2436) that explains the composed-ref pattern — it becomes stale post-revert.

---

**Part (b) — KEEP client-side drop-oldest cap:**

**Preserve** `appendDedupWithCap<T>` helper at L221-238 (18 lines including comment block). It correctly implements Ashley's UAT-locked pattern: *"as messages arrive on the WS during initial hydration, `setMessages(prev => prev.length >= CAP ? [...prev.slice(1), next] : [...prev, next])`"* — modulo the dedup-by-eventId gate, which the current implementation adds and is desirable.

**Preserve** all 5 live-append call sites (L1354, L1374, L1380, L1386, L1393) — they already call `appendDedupWithCap(prev, parsed, WORKING_SET_CAP)`. This is EXACTLY the pattern Ashley wants: the cap enforces during hydration (as the server dumps its full-file emission the client drops-oldest as it grows past 150) AND continues to enforce during live-tail. The line quoted in CONTEXT `<specifics>` — *"once initial hydration completes (server signals done, or after N ms of silence), the cap can either stay (bound memory) or lift"* — points at planner's discretion; the recommendation there is "keep the cap enforced always" which matches exactly what the current code does.

**Rationale to keep vs rebuild:** the current implementation ALREADY does what Ashley wants for the client-side cap. The Phase 43 mistake was pairing the client-side cap with a SERVER-side cap that starved observations. Removing the server-side cap (blocks 4/7 above) leaves the client-side cap doing the correct thing, byte-for-byte. No rebuild needed; the drop-oldest logic survives because the surgery targets are `historyWindow` and `fetch_older`, not `appendDedupWithCap`.

**Preserve** the unused `appendDedup` helper at L213-219 alongside `appendDedupWithCap` — it's a 6-line documented pair per plan 43-07b `key-decisions`. Deleting it is scope-creep for Phase 45; the "no `while I'm in here` improvements" fence explicitly disallows.

---

**Part (c) — ADD `paddingBottom: 9` to bubble wrapper (Ashley LOCKED value):**

**Analog for the exact wrapper shape + padding style:** `git show 5bc24f49~1:src/ui/features/pretty-view/PrettyView.tsx` L2380-2405 (pre-plain-DOM conversion). The pre-43-07a virtualized-item wrapper had `paddingBottom: 9` inline (L2402). The plain-DOM conversion in 43-07a dropped it — Ashley's UAT identified this as the second bug.

**Pre-P43 wrapper style (excerpt from `5bc24f49~1` L2381-2405):**
```typescript
                <div
                  key={virtualRow.key}
                  data-pv-bubble
                  data-index={virtualRow.index}
                  data-event-id={m.eventId}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                    // Was the flex column's vertical rhythm; flexbox does
                    // nothing on absolutely-positioned children, so the
                    // rhythm is baked into the item box now.
                    paddingBottom: 9,
                  }}
                >
```
The `paddingBottom: 9` here is the source of truth for the value.

**Current post-43-07a wrapper (L2478-2483) — target for the ADD:**
```tsx
          {messages.map((m) => (
            <div
              key={m.eventId}
              data-pv-bubble
              data-event-id={m.eventId}
            >
```

**Change:** add `style={{ paddingBottom: 9 }}` prop on the `<div>`. Ashley's exact locked value + medium (padding, not margin — she called it out explicitly). Insertion point: line 2481 area. Result shape:
```tsx
          {messages.map((m) => (
            <div
              key={m.eventId}
              data-pv-bubble
              data-event-id={m.eventId}
              style={{ paddingBottom: 9 }}
            >
```

**Do NOT re-derive the number.** Ashley locked 9 with a verbatim quote (CONTEXT.md `<domain>`): *"the margin between the message bubbles before was nine pixels ... so that we didn't have to try to re-derive a good looking version of that."* Ship exactly 9.

---

### 10. `src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx` — delete-and-recreate

**Analog for infrastructure of the replacement:** `src/ui/features/pretty-view/PrettyView.plain-dom.test.tsx` (658 lines, sibling, stays intact). Identical:
- WS stub scaffolding (types + `wsStubs[]` array + `getCurrentWs()` helper — L52-68).
- `openClaudeSessionSocket` `vi.mock` (L70-88, unopt'd — no historyWindow options object, matches post-revert API).
- Other mocks: `compose-drafts-api`, `session-hue`, `IdentityBadge`, `useIsTouchDevice`.
- ResizeObserver polyfill + `HTMLElement.prototype.offsetHeight` override on `[data-pv-bubble]` (verbatim reuse — proven to work for the plain-DOM path).
- `fireMessageBatch(ws, count, makePayload)` helper for driving many frames at once.

**Delete rationale for the current file:** 888 lines locking behaviors that no longer exist post-revert (historyWindow URL query param, fetch_older payload shape, fetch_older_batch prepend, loading-hint fake-timer sequence, reachedBeginning short-circuit, error path). Every one of the 11 tests hits a construct being deleted. Rewriting in place would touch ~90% of the file; delete + recreate reads more cleanly in `git log`.

**Recreate — new file specs (planner refines the exact test set):**
- Test A: initial hydration cap — fire 200 message frames via `fireMessageBatch`; assert exactly `WORKING_SET_CAP` (150) `[data-pv-bubble]` elements in the DOM; assert the SURVIVING first eventId is frame index 50 (200 - 150 = 50 dropped from the front); assert the last eventId is frame index 199.
- Test B: live-append respects cap — after filling to cap, fire ONE more; assert still exactly 150 bubbles; assert oldest bubble's eventId shifted forward by 1.
- Test C: cap applies uniformly across all 5 wire frame types — fire 30 messages + 40 images + 30 relay_outbound + 30 relay_inbound + 30 malformed_line (160 total); assert 150 bubbles remain; assert frame-type distribution matches drop-oldest math.
- Test D: dedup within cap — fire the same eventId twice; assert only one bubble (no duplication, cap not affected by would-be-duplicates).
- Test E: `openClaudeSessionSocket` called with ZERO args — assert `openCalls[0].opts === undefined` (or that the mock was invoked with no argument). Locks the wire contract simplification.
- Test F: auto-scroll pinned-follow still works after drop-oldest (regression carry-over from Phase 43 Test 10 — this is unchanged behavior worth keeping locked).
- Test G: no yank when scrolled up (regression carry-over from Phase 43 Test 11 — LOAD-BEARING, don't lose it).
- Test H (paranoid): no fetch_older sent under any scroll scenario — scroll to top, wait, assert `ws.send` was NEVER called with a `type: "fetch_older"` payload. Locks that the fetch_older client path is truly gone.

**File placement decision (planner discretion, CONTEXT `<decisions>` § "Claude's Discretion"):** rename to `PrettyView.hydration-cap.test.tsx` OR keep the name `PrettyView.windowed-pagination.test.tsx` with rewritten body. Recommendation: RENAME to `PrettyView.hydration-cap.test.tsx` so `git log --follow` on the old name doesn't stitch semantically-different tests together. But if planner prefers filename stability, the delete-then-recreate at the same path works too.

---

### 11. Bug #3 — investigation-then-guard plan (deferred, one dedicated plan post-repro)

**Analog for the investigation workflow:** the pattern the box-maintainer role has used for prior "minified stack in a crash we can't source-map from disk" bugs — reproduce in the current dev container (where the source map DOES match the running JS), read the FRESH minified stack, walk the un-minified frame back to the src line.

**Analog for the guard style once site confirmed:** the existing early-return pattern each candidate file uses.

**Candidate 1 — `src/ui/features/pretty-view/ComposeBox.tsx:1194`:**
```typescript
  function collapseNewlinesForSend(s: string): string {
    return s.replace(/\r?\n/g, " ");
  }
```
**4 call sites** (verified via grep): L1012, L1217, L1257, L1272, L1362, L1465. Any caller passing `undefined` triggers `TypeError: Cannot read properties of undefined (reading 'replace')`.
**Guard style (if confirmed as the crash site):**
```typescript
  function collapseNewlinesForSend(s: string): string {
    if (typeof s !== "string") return "";
    return s.replace(/\r?\n/g, " ");
  }
```
Add source comment: `// Phase 45 Bug #3 defense — see .planning/phases/45-.../ for the crash-stack evidence.`

**Candidate 2 — `src/ui/AppShell.tsx:1239`:**
```typescript
t.type === type && t.label.replace(/ \(\d+\)$/, "") === host.name
```
Fires only during tab-dedup filter (tab-open codepath). Unlikely to fire on send unless the send path indirectly triggers tab re-derivation.
**Guard style (if confirmed):** narrow the read — `typeof t.label === "string" && t.label.replace(...)` early-out.

**Candidate 3 — `src/ui/features/pretty-view/commandTags.ts:53`:**
```typescript
export function preprocessCommandTriplets(text: string): string {
  return text.replace(COMMAND_BLOCK_RE, (block) => {
```
Called during `ChatMessage` render (per CONTEXT). If a message frame arrives with `content === undefined`, `text` here is undefined → boom during render.
**Guard style (if confirmed):**
```typescript
export function preprocessCommandTriplets(text: string): string {
  if (typeof text !== "string") return "";
  return text.replace(COMMAND_BLOCK_RE, (block) => { /* ... */ });
}
```

**Workflow the plan MUST follow (per CONTEXT `<decisions>` § "Bug #3"):**
1. Bugs #1 + #2 land in dev (or on the current dev container) FIRST.
2. Ashley re-triggers a send. Fresh minified stack lands in browser console.
3. Read the fresh stack line; un-minify against the current dev build's source map (source-map-explorer OR direct inspection of the `AppShell-*.js.map` shipped alongside the dev build).
4. Confirm which of the 3 candidate sites is the actual thrower.
5. Add ONE targeted guard on that ONE site — do NOT sweep and guard all 25 `.replace()` sites (violates the no-defensive-code-for-scenarios-that-can't-happen rule, called out in CONTEXT `<deferred>`).
6. Add a source comment linking back to Phase 45 for future archaeology.

**Do NOT (planner-visible negatives):**
- Guess the site by adding all 3 guards speculatively.
- Widen the guard to a type-narrowed panic (e.g. throwing a nicer error) — the goal is to prevent the crash, not to improve error reporting.
- Add defensive `.replace()` guards elsewhere in the codebase as a preventative sweep. CONTEXT `<deferred>` explicitly rejects that.

---

## Shared Patterns

### Pre-Phase-43-byte-shape as the revert-target authority

**Source:** `git show <commit>~1:<path>` for each Phase 43 modification commit.
- `f60514b5~1:src/backend/claude-session/session-file-tail.ts` — pre-43-01 tail helper.
- `1a02ef04~1:src/backend/claude-session/claude-session-server.ts` — pre-43-02 server imports (no range-module import).
- `a479501e~1:src/backend/claude-session/claude-session-server.ts` — pre-43-04 server (no `handleFetchOlder`, `parseHistoryWindow`, or msg-switch case).
- `5bc24f49~1:src/ui/features/pretty-view/PrettyView.tsx` — pre-43-07a wrapper with the `paddingBottom: 9` at L2402.

**Apply to:** every revert region. Instead of describing the target shape narratively, plans should reference the pre-Phase-43 shape and require byte-shape equality where possible. The one exception is `PrettyView.tsx`, where the pre-P43 shape is virtualizer-based (and we're KEEPING plain-DOM per Phase 43 Plan 43-07a which was correct) — so PrettyView reverts + rewrites reference DIFFERENT sources for different regions (drop-oldest + append cap stays from current file; padding shape comes from pre-P43).

### Delete-file over surgical-remove when file is Phase-43-born

**Source:** `session-file-range.ts` (whole file born in 43-02), `session-file-range.test.ts` (whole file born in 43-02), `claude-session-server.fetch-older.test.ts` (whole file born in 43-04), `claude-session-server.history-window.test.ts` (whole file born in 43-04), `claude-session-api.test.ts` (whole file born in 43-05 for fetch_older helpers).

**Apply to:** whole-file deletions in Phase 45. Cleaner `git log` than piecemeal removal; easier for future rollback investigations to see "this whole module was Phase 43, gone in Phase 45." Verification pattern (from Phase 43 Plan 43-08's `@tanstack/react-virtual` removal): `git grep 'moduleName\|exportName' src/` returns ZERO hits after the delete.

### Test-seam co-deletion (when a seam-tested handler is deleted, the seam-user tests go with it)

**Source:** `__handleFetchOlderForTests` + `__parseHistoryWindowForTests` (both defined in `claude-session-server.ts`, both consumed only by `claude-session-server.fetch-older.test.ts` + `claude-session-server.history-window.test.ts`).

**Apply to:** the two backend test files. Deleting the seams in `claude-session-server.ts` (§ 4 above) makes the seam-consumer imports in the test files unresolved; the cleanest response is deleting the test files rather than trying to rewrite them against the removed surface.

### Client-side hydration cap already correct — surgery is DELETION not REBUILD

**Source:** current `PrettyView.tsx` — `appendDedupWithCap<T>` at L221-238 + all 5 live-append call sites using it.

**Apply to:** § 9 Part (b). The instinct with a "fix-forward" phase is to rewrite everything the buggy phase touched. But Ashley's decision moved the CAP AUTHORITY from server to client — and the client already implements the cap correctly. The bug is the SERVER cap starving observations. Delete the SERVER-side pieces; the CLIENT-side pieces already do exactly what Ashley wants.

### One-shot backend-write-then-frontend-consume pattern is the SIBLING of what's deleted

**Source:** `countIdentityBounties` at `claude-session-api.ts:1017-1059` — opens its own WS, sends payload on onopen, resolves on matching-type onmessage.

**Apply to:** verify that the deletions in `claude-session-api.ts` DO NOT touch `countIdentityBounties` — it's the shape Phase 43 mimicked and its untouched-ness is a canary. If planner-implementation notes any diff to `countIdentityBounties`, that's a mistake.

### Do NOT touch the observation channel

**Source:** CONTEXT `<domain>` calls out that the reason for the whole phase is that the OBSERVATION channel was starved by the shared `-n N` tail. Reverting to `-n +1` restores its data flow byte-for-byte.

**Apply to:** § 1 + § 4. Any change beyond removing the `initialLines` param on tail + the `historyWindowParsed` thread on the server + the fetch_older handler risks breaking observation-channel derivations that are known-good. Layer1-detect at `~L2044`, context-pct-from-jsonl, plan-pending-parser, backgroundedAgents/Shells sets at `~L2200/L2380`, id-reset — every one of these reads from the SAME `onLine` handler that the tail feeds. The revert must be zero-touch on this fan-out; only the source pipe's initial-slice size changes back.

### 9px value is PROJECT-CONSTANT, not planner-derived

**Source:** Ashley's verbatim quote in CONTEXT `<domain>` — *"the margin between the message bubbles before was nine pixels ... so that we didn't have to try to re-derive a good looking version of that."* + evidence at `git show 5bc24f49~1:src/ui/features/pretty-view/PrettyView.tsx` L2402.

**Apply to:** § 9 Part (c). Ship `paddingBottom: 9` verbatim. Do not run visual-QA to "confirm" a different value looks fine. Do not use `margin` (Ashley called out padding explicitly). Do not use CSS classes (inline was the pre-existing shape).

### Bug #3 = investigate-first, guard-second, no speculation

**Source:** CONTEXT `<decisions>` § "Bug #3 `.replace()` crash" — *"speculative to guard all 3 candidate sites blindly (which might mask the real bug or introduce dead defensive code — see § Learned preferences in role file re: not-shipping-defensive-code-for-scenarios-that-can't-happen)."*

**Apply to:** § 11. The dedicated Bug #3 plan MUST include a repro step BEFORE any code change; the plan cannot ship a guard without a fresh minified stack line identifying the site. This is a hard sequence dependency, not a preference.

---

## No Analog Found

None. Every file in Phase 45 has a strong analog:
- Revert-heavy files: BOTH the current (source of the deletion regions) AND the pre-P43 (via `git show <commit>~1:<path>`) are exact-shape analogs.
- Whole-file deletions: n/a for analog (nothing to model, just remove).
- PrettyView.tsx three-part surgery: (a) current file for the deletion targets; (b) current file for the keep-as-is regions; (c) pre-P43 (`5bc24f49~1`) for the padding shape.
- Replacement windowed-pagination test: `PrettyView.plain-dom.test.tsx` sibling for infrastructure verbatim.
- Bug #3 guard: candidate-file-local early-return patterns (each of the 3 files already has similar guards elsewhere in its own body).

---

## Metadata

**Analog search scope:**
- `/home/ubuntu/skynet/src/backend/claude-session/` — every backend Phase 43 file + tests.
- `/home/ubuntu/skynet/src/ui/api/claude-session-api.ts` — frontend WS client wire types + helpers.
- `/home/ubuntu/skynet/src/ui/features/pretty-view/` — PrettyView.tsx + all sibling tests + candidate .replace() sites.
- `/home/ubuntu/skynet/src/ui/AppShell.tsx` — Bug #3 candidate site 2.
- Git history — `git log --oneline` on each file + `git show <commit>~1:<path>` for byte-shape targets.
- `.planning/phases/43-*` — the phase being fixed-forward.

**Files scanned:** ~25 direct reads + ~20 grep-then-read targeted excerpts.

**Evidence for corrections to CONTEXT.md file list:**
- `session-file-parser.ts` — `git log --oneline -- src/backend/claude-session/session-file-parser.ts` most-recent = `6031dab5 feat(quick-260818-idu-01)` (pre-Phase-43, unrelated). No 43-* commits. `grep 'readSessionFileRange\|resolveEventIdToLine' src/backend/claude-session/session-file-parser.ts` → ZERO hits.
- `session-file-range.ts` — `git log --oneline -- src/backend/claude-session/session-file-range.ts` returns exactly ONE commit: `1a02ef04 feat(43-02)`. File is Phase-43-born.
- `src/shared/` — `ls src/shared` returns "No such file or directory." All client-side wire types for Phase 43 live in `src/ui/api/claude-session-api.ts`.
- `claude-session-api.test.ts` — every one of the 20+ specs in the file references `sendFetchOlder` OR `isFetchOlderBatchEvent` OR the `fetch_older` / `fetch_older_batch` type literals. `grep 'fetch_older\|sendFetchOlder\|isFetchOlderBatchEvent' src/ui/api/claude-session-api.test.ts | wc -l` → 21 hits in 174 lines. Whole-file deletion is correct.

**Pattern extraction date:** 2026-08-18

**Key patterns identified (planner-summary):**
1. Every backend revert region has a byte-shape target visible via `git show <commit>~1:<path>` — plans can reference the exact pre-P43 shape rather than describe it narratively.
2. Phase-43-born whole files (`session-file-range.ts`, `session-file-range.test.ts`, `claude-session-server.fetch-older.test.ts`, `claude-session-server.history-window.test.ts`, `claude-session-api.test.ts`) get whole-file deletion — cleaner than surgical.
3. Client-side drop-oldest cap in `PrettyView.tsx` is ALREADY correct (`appendDedupWithCap` + 5 live-append sites). Phase 45 surgery there is DELETION of the fetch_older client + historyWindow opt-in + loading hint; the cap stays.
4. `paddingBottom: 9` value is PROJECT-CONSTANT (Ashley verbatim); planner must ship exactly 9 as inline padding, not margin, not a class.
5. Bug #3 is a two-step plan (repro → targeted guard); planner must NOT collapse it into a single "add 3 speculative guards" plan.
6. Observation channel is zero-touch — the tail command reverts to `-n +1` (feeding the observation channel the whole file); every downstream derivation (layer1-detect, context-pct, plan-pending, backgroundedAgents/Shells, id-reset) continues to receive every line unchanged.
7. `PrettyView.plain-dom.test.tsx` is the intact sibling analog for the replacement test infrastructure — proven WS-stub + polyfill patterns for the plain-DOM path.

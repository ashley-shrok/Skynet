---
phase: quick-260910-jqx
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/state/conversation-store.ts
  - src/ui/state/conversation-store.cache.test.ts
autonomous: true
requirements:
  - QUICK-260910-JQX-01
must_haves:
  truths:
    - "A relay-room row written to the fleet cache survives readFleetSessionsCache() with kind/roomId/roomTitle intact"
    - "A mixed cache (harness + relay rows) round-trips both kinds without dropping either"
    - "A legacy harness row without an explicit `kind` field still validates as harness (backward-compat, Phase 90 doctrine)"
    - "A malformed relay row (kind='relay-room' but missing roomId) is rejected by the validator"
    - "On app boot, relay rooms paint from cache immediately instead of after the ~10s /sessions/list round-trip"
  artifacts:
    - path: "src/ui/state/conversation-store.ts"
      provides: "isFleetSession validator with kind-aware branching"
      contains: "kind === \"relay-room\""
    - path: "src/ui/state/conversation-store.cache.test.ts"
      provides: "regression tests for relay-row round-trip + legacy harness compat + malformed-relay rejection"
      contains: "quick-260910-jqx"
  key_links:
    - from: "src/ui/state/conversation-store.ts isFleetSession"
      to: "readFleetSessionsCache filter loop"
      via: "isFleetSession(item) gate at line ~1314"
      pattern: "isFleetSession\\(item\\)"
    - from: "cache round-trip"
      to: "AppShell first-paint of relay rooms"
      via: "writeFleetSessionsCache → localStorage → readFleetSessionsCache"
      pattern: "readFleetSessionsCache|writeFleetSessionsCache"
---

<objective>
Fix `isFleetSession` at src/ui/state/conversation-store.ts:1232 so relay-room
rows survive the cache-read validator. Alice observed ~10s wait for relay
rooms to appear on every app boot despite them being in the cache — traced to
the validator strictly requiring harness-shape fields (hostId:number,
hostName:string, sessionName:string, created:number) which relay rows do not
have. Every relay-row cache entry is currently silently filtered out on read,
forcing a wait for the fresh `/sessions/list` fetch before relay rooms paint.

Purpose: Restore the "paint from cache immediately, refresh in background"
UX for relay-room rows so app boot is instant regardless of network latency.

Output:
- Kind-aware `isFleetSession` validator that branches on `kind === "relay-room"`
  vs. harness-or-legacy, with backward-compat preserved for `kind === undefined`
- Regression tests in conversation-store.cache.test.ts covering relay round-trip,
  mixed cache round-trip, legacy harness compat, and malformed-relay rejection
- Green `npx vitest run src/ui/state/conversation-store.cache.test.ts`
- Green `npx tsc --noEmit`
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/ui/state/conversation-store.ts
@src/ui/state/conversation-store.cache.test.ts
@src/backend/database/routes/sessions.ts

# Relevant existing shape (already in-context via files above):
# - FleetSession type at conversation-store.ts:161 — all relay identity fields
#   (kind, roomId, roomTitle, id, lastActivityAt, createdAt, updatedAt) are
#   already optional. This is purely a validator gap; no type changes needed.
# - Write path at conversation-store.ts:1361 already serializes both kinds
#   correctly (canonical map at 1377-1388). Do NOT change the write path.
# - Backend emits relay row shape at sessions.ts:592-601 —
#   { kind:"relay-room", id, roomId, roomTitle, lastActivityAt, createdAt, updatedAt }
#   NO hostId/hostName/sessionName/created on relay rows.
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Kind-aware branching in isFleetSession</name>
  <files>src/ui/state/conversation-store.ts</files>
  <behavior>
    - Relay-row branch: when `r.kind === "relay-room"`, require
      `typeof r.roomId === "string"` AND `r.roomId.length > 0`. Do NOT require
      hostId / hostName / sessionName / created on this branch.
    - Harness/legacy branch: when `r.kind !== "relay-room"` (i.e. `"harness"` or
      `undefined`), preserve the existing strict harness-shape check exactly
      as-is: `typeof r.hostId === "number"`, `typeof r.hostName === "string"`,
      `typeof r.sessionName === "string"`, `typeof r.created === "number"`,
      `r.role === null || typeof r.role === "string"`.
    - Common checks apply to BOTH branches (run after branch resolves):
        - lastMessageAt: undefined | null | number (existing rule)
        - aiTitle:       undefined | null | string (existing rule)
        - kind:          undefined | "harness" | "relay-room" (existing rule)
        - roomId:        undefined | string (existing rule; relay branch tightens to required-non-empty above)
        - roomTitle:     undefined | null | string (existing rule)
    - Backward-compat: `kind === undefined` MUST still route through the harness
      branch (Phase 90 doctrine, comment at lines 1322-1329). A legacy v3-shape
      row with no `kind` field must continue to validate.
  </behavior>
  <action>
    Edit src/ui/state/conversation-store.ts `isFleetSession` (starts at line
    1232). Restructure the top of the function so the discriminator check runs
    BEFORE the existing harness-shape gate:

    1. Keep the initial `if (!x || typeof x !== "object") return false;` and
       `const r = x as Record<string, unknown>;` prelude unchanged.
    2. Keep the existing `kind` value-check (lines 1266-1275, "accept undefined
       OR the two known kind literals") — but move it ABOVE the harness-shape
       gate so we know which branch to take. This block already rejects
       `kind === "banana"` style corruption; it stays exactly as-is.
    3. Insert branching logic:
         - If `r.kind === "relay-room"`: require
           `typeof r.roomId === "string" && r.roomId.length > 0`. Return false
           if either fails. Do NOT check hostId/hostName/sessionName/created/role.
         - Else (harness or undefined-legacy): run the EXISTING strict harness
           shape check (current lines 1235-1243) verbatim.
    4. After the branch resolves, keep all remaining common checks in place:
       lastMessageAt (1247-1253), aiTitle (1259-1265), roomId type check
       (1276-1281) — the roomId type check is still valuable for the harness
       branch where roomId might be present-but-non-string in a corrupt entry,
       and for the relay branch it's already satisfied — and roomTitle
       (1282-1291). The final `return true;` stays.

    Add an inline comment above the new branch citing the fix: "quick-260910-jqx:
    kind-aware validator — relay-room rows lack hostId/hostName/sessionName/created
    (backend emits {kind:'relay-room', id, roomId, roomTitle, lastActivityAt,
    createdAt, updatedAt}; see sessions.ts:592-601). Require roomId on the
    relay branch; keep the strict harness-shape gate for kind==='harness' and
    kind===undefined (backward-compat: legacy v3-shape rows have no kind field
    and must continue to route as harness — Phase 90 doctrine, see readFleetSessionsCache
    comment at lines 1322-1329)."

    Do NOT change the FleetSession interface, the write path, or the
    readFleetSessionsCache filter loop. This is a single-function edit inside
    isFleetSession only. Do NOT use `git stash`.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet-taylor &amp;&amp; npx tsc --noEmit</automated>
  </verify>
  <done>
    isFleetSession branches on `kind === "relay-room"`. Relay branch requires
    non-empty roomId string and skips the harness-shape gate. Harness/legacy
    branch preserves the existing strict check byte-for-byte. `npx tsc --noEmit`
    is clean. No other files modified.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Regression tests for relay round-trip + legacy compat + malformed-relay rejection</name>
  <files>src/ui/state/conversation-store.cache.test.ts</files>
  <behavior>
    Add four new `it(...)` cases inside the existing
    `describe("FleetSession localStorage cache (quick-260805-tub)", ...)` block.
    All four are pure round-trip tests using the exported
    `readFleetSessionsCache` / `writeFleetSessionsCache` helpers (or direct
    localStorage seeding for the malformed / legacy cases). No mocking beyond
    the existing api-client mock.

    Test 1 — relay-row round-trip:
      - Construct a relay-room-only FleetSession:
          { kind: "relay-room", roomId: "!room:matrix.example",
            roomTitle: "Working session", lastMessageAt: null, aiTitle: null }
        (No hostId/hostName/sessionName/created — this is what the backend
        actually emits per sessions.ts:592-601.)
      - Cast via `as unknown as FleetSession` since the TS type still lists
        harness fields as required — the runtime shape is what matters here
        and the write/read path already tolerates the missing fields.
      - writeFleetSessionsCache([relayRow]); const got = readFleetSessionsCache();
      - expect(got).toHaveLength(1)
      - expect(got[0].kind).toBe("relay-room")
      - expect(got[0].roomId).toBe("!room:matrix.example")
      - expect(got[0].roomTitle).toBe("Working session")

    Test 2 — mixed cache round-trip (harness + relay both survive):
      - Use existing SAMPLE_A (harness, kind:"harness") and a fresh relay row
        (as in Test 1). writeFleetSessionsCache([SAMPLE_A, relayRow]).
      - const got = readFleetSessionsCache();
      - expect(got).toHaveLength(2)
      - expect(got.filter(s =&gt; s.kind === "harness")).toHaveLength(1)
      - expect(got.filter(s =&gt; s.kind === "relay-room")).toHaveLength(1)

    Test 3 — legacy harness row (no `kind` field) still validates:
      - Seed localStorage directly with a v4-key entry that has the four
        canonical harness fields (hostId/hostName/sessionName/created) plus
        role, but NO `kind` property at all — simulating a row that predates
        the Phase 90 wire extension or a rehydrate edge case.
      - localStorage.setItem(CACHE_KEY, JSON.stringify([legacyRow]))
      - const got = readFleetSessionsCache();
      - expect(got).toHaveLength(1)
      - expect(got[0].hostName).toBe(&lt;expected&gt;)
      - expect(got[0].kind).toBeUndefined()

    Test 4 — malformed relay row is rejected:
      - Seed localStorage directly with kind:"relay-room" but no roomId (or
        roomId as a non-string, or roomId as an empty string).
      - Include a valid harness row alongside so we can prove the malformed
        one was filtered out (not that the whole cache was tossed).
      - const got = readFleetSessionsCache();
      - expect(got).toHaveLength(1)  // only the valid harness row survived
      - expect(got[0].kind).not.toBe("relay-room")  // or check hostName matches valid row

    Each test uses `beforeEach(() =&gt; { localStorage.clear(); })` which is
    already set up at line 78. Reuse `CACHE_KEY` constant at line 33.
    Reference the quick ID (quick-260910-jqx) in each test's leading comment.
  </behavior>
  <action>
    Edit src/ui/state/conversation-store.cache.test.ts. Add the four new
    `it(...)` cases per the &lt;behavior&gt; block above at the end of the existing
    `describe(...)` (after the "write is silent on storage failure" test at
    line 164-179, before the closing `});` at line 180).

    Do not modify existing tests, existing samples, or existing imports. Do
    NOT touch conversation-store.ts (Task 1 already covered that). Do NOT
    use `git stash`.

    Note the pre-existing behavior guardrail: the current "element-shape
    fallback" test at line 102-113 passes a malformed harness row
    (`hostId: "not-a-number"`) and asserts it's filtered out — this test
    will continue to pass because the harness branch of the new validator
    is unchanged.

    Note re SAMPLE_B: SAMPLE_B is currently defined at line 59-75 as a
    relay-room row that ALSO carries hostId/hostName/sessionName/created
    (a hybrid shape that satisfies the current strict validator). It's fine
    to leave SAMPLE_B as-is — the existing "roundtrip" test at line 82-86
    depends on that shape. The new Test 1 above uses a fresh relay-only
    row (no harness fields) which is the actual production shape from
    sessions.ts:592-601.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet-taylor &amp;&amp; npx vitest run src/ui/state/conversation-store.cache.test.ts</automated>
  </verify>
  <done>
    All four new tests pass. All pre-existing tests in
    conversation-store.cache.test.ts still pass. `npx tsc --noEmit` remains
    clean (Task 1 already verified). No files besides
    conversation-store.cache.test.ts modified in this task.
  </done>
</task>

</tasks>

<verification>
Combined phase-level check (run after both tasks):

```bash
cd /home/ubuntu/skynet-taylor && \
  npx vitest run src/ui/state/conversation-store.cache.test.ts && \
  npx tsc --noEmit
```

Both must exit 0. All existing tests plus the four new regression tests must
pass. TypeScript must remain clean (no new errors introduced by the validator
edit).

Semantic verification (goal-backward):
- readFleetSessionsCache() no longer silently drops relay-room rows on read
- writeFleetSessionsCache() unchanged (write path was already correct)
- FleetSession interface unchanged (relay fields were already optional)
- Backend contract unchanged (this is a frontend-only cache-layer fix)
</verification>

<success_criteria>
- isFleetSession branches on `kind === "relay-room"` and no longer requires
  harness-shape fields on relay rows
- Legacy rows with `kind === undefined` continue to route through the harness
  branch (backward-compat preserved)
- Malformed relay rows (missing roomId) are still rejected
- All four new regression tests pass; all pre-existing cache tests still pass
- `npx tsc --noEmit` clean
- On next app boot with a warm cache, relay rooms paint immediately (verified
  in the follow-up execute phase or by Alice in-app; not automatable here)
</success_criteria>

<output>
Create `.planning/quick/260910-jqx-fix-cache-read-validator-to-accept-relay/260910-jqx-01-SUMMARY.md` when done.
</output>

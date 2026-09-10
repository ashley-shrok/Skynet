---
phase: 97-room-case-chrome-and-lifecycle-should-match-session-case-exc
plan: 05
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/lib/tab-url.ts
  - src/ui/lib/tab-url.test.ts
  - src/ui/AppShell.tsx
  - src/ui/AppShell.relay-url-restore.test.tsx
autonomous: true
requirements:
  - F-7
  - D-15
  - D-16

must_haves:
  truths:
    - "Opening a relay room in the app writes a `relay:<encodeURIComponent(roomId)>` protocol variant into the URL fragment via the AppShell URL-sync effect (per D-15/D-16)."
    - "Refreshing the browser on a URL containing `relay:<roomId>` restores the relay-room tab by calling `openTab(null, 'terminal', undefined, {sessionKind: 'relay-room', relayRoomId: <decoded>, ...})` matching the onRelayRoomRowClick shape at AppShell.tsx:2169-2176."
    - "A relay-room tab nested inside a splitTree fragment round-trips through URL restore correctly — the splitTree positional resolver's spec-key builder AND the walk-tabs fallback both handle `protocol === \"relay\"` by keying on `roomId` and matching on `sessionKind === \"relay-room\" && relayRoomId === spec.roomId` respectively."
    - "Session-tab URL round-trips (tmux:/terminal:/rdp:/vnc:/telnet:) are unchanged — legacy URLs without `relay:` still parse correctly."
    - "Matrix room IDs containing `!`, `:`, `.`, `@`, `#` round-trip through encodeURIComponent/decodeURIComponent losslessly."
    - "The URL sync fires on tab-set / activeTabId changes only, NOT on chatSurfaceAdapter.roomTitle change (title landing later does not cause a URL rewrite)."
    - "A URL-restored roomId that no longer resolves (backend emits `inactive` frame) surfaces via the existing ChatSurfaceErrorState overlay — no new error path needed."
    - "`npx tsc --noEmit` is clean project-wide — TabSpec's discriminated-union form does not produce cascading errors in AppShell.tsx or any other consumer."
  artifacts:
    - path: "src/ui/lib/tab-url.ts"
      provides: "Discriminated-union TabSpec (harness variant vs relay variant), extended PROTOCOLS + parseTabParam + encodeTabSpec + specForTab"
      contains: "\"relay\""
    - path: "src/ui/AppShell.tsx"
      provides: "URL-sync effect + splitTreeFragment callback pass sessionKind + relayRoomId to specForTab; BOTH tab-restore loops (~L1256 and ~L1344) route protocol==='relay' through openTab(null, 'terminal', ..., {sessionKind: 'relay-room', ...}); splitTree resolver key builder + fallback walk both handle relay via roomId identity"
      contains: "spec.protocol === \"relay\""
    - path: "src/ui/lib/tab-url.test.ts"
      provides: "Round-trip tests for relay: protocol + backward-compat legacy URLs (Tests 1-9)"
      contains: "protocol: \"relay\""
    - path: "src/ui/AppShell.relay-url-restore.test.tsx"
      provides: "AppShell relay-URL-restore integration tests: (a) top-level pending.tabs restore, (b) relay leaf inside splitTree fragment restore, (c) mixed session+relay workspace restore"
      contains: "sessionKind: \"relay-room\""
  key_links:
    - from: "src/ui/AppShell.tsx (URL-sync effect L910-972)"
      to: "src/ui/lib/tab-url.ts specForTab"
      via: "input.sessionKind + input.relayRoomId"
      pattern: "sessionKind.*relayRoomId"
    - from: "URL fragment #tab=relay:<roomId>"
      to: "src/ui/AppShell.tsx tab-restore loop 1 (~L1256)"
      via: "consumePendingWorkspace → TabSpec[] with protocol==='relay' → openTab(null, 'terminal', ..., {sessionKind: 'relay-room', relayRoomId})"
      pattern: "spec.protocol === \"relay\""
    - from: "URL fragment splitTree with relay leaf"
      to: "src/ui/AppShell.tsx tab-restore loop 2 (~L1344, splitTree positional resolver)"
      via: "spec.protocol === 'relay' branch in key builder + resolver walk-fallback matching on t.sessionKind==='relay-room' && t.relayRoomId===spec.roomId"
      pattern: "t\\.sessionKind === \"relay-room\" && t\\.relayRoomId === spec\\.roomId"
---

<objective>
Widen the URL grammar in `src/ui/lib/tab-url.ts` to include a `"relay"` protocol variant carrying an opaque Matrix `roomId`, and thread the sessionKind + relayRoomId inputs through AppShell's URL-sync effect + BOTH tab-restore loops so relay-room tabs round-trip through the URL fragment on refresh — including when a relay tab is nested inside a splitTree fragment.

Purpose: Ship F-7 per D-15/D-16. In the shipped Phase 93 tree, `specForTab` at tab-url.ts:140-157 returns `null` for a relay-room tab because `input.host` is `null` (relay tabs have no fleet host); PROTOCOLS at L73-79 doesn't include `"relay"`; parseTabParam / encodeTabSpec don't handle it. Consequently a browser refresh drops the relay tab. Per D-15 the URL identifier is the opaque Matrix room ID; per D-16 the URL shape mirrors the harness case's pattern (path-segment discriminator + protocol prefix). The extension is additive — legacy URLs continue to parse.

**Iteration 2 revision (2 checker blockers resolved):**

- **BLOCKER-1 (second `pending.tabs` loop unpatched):** AppShell.tsx contains TWO `for (const spec of pending.tabs)` loops. The first (~L1256) is the top-level URL-driven-open pass. The second (~L1344) is inside the splitTree positional resolver's hydration path — it rebuilds a spec-key → tabId map by walking `pending.tabs` a second time. On a relay-tab inside a splitTree fragment, both `spec.host.toLowerCase()` sites (~L1351, ~L1375) throw TypeError, the key builder produces `"relay:undefined:"` which masks bugs, and the fallback host-name/host-id match cannot find the relay tab. **Fix:** relay-branch the key builder to `\`relay:${spec.roomId}\``, and relay-branch the fallback walk to match on `t.sessionKind === "relay-room" && t.relayRoomId === spec.roomId`. Also relay-guard the shared `t.host?.id === spec.host` comparison at ~L1279 so tsc doesn't complain about `string | undefined` vs `string`.

- **BLOCKER-2 (host-widening fallback is too soft):** The v1 plan said "widen host from string to string?, use discriminated-union as fallback if tsc complains." Consumers exist and DO assume non-null (AppShell.tsx:~L1279 comparison + ~L1344 loop). Also T1's verify grep-filtered tsc output to only report `tab-url.ts` errors, silently ignoring AppShell.tsx errors. **Fix:** adopt discriminated-union form UP FRONT (not "if needed"). Every consumer of `spec.host` must be exhaustively narrowed by `spec.protocol === "relay" ? ... : spec.host.<...>` OR by `if (spec.protocol === "relay") continue;` guard-clause. T1's verify runs `npx tsc --noEmit` PROJECT-WIDE (no grep filter) and requires TSC_CLEAN.

Output: two production files touched + two test files (one extended, one new). `TabSpec` becomes a discriminated union with a `relay` variant carrying `roomId`. `PROTOCOLS` list extended. `parseTabParam` + `encodeTabSpec` + `specForTab` extended with relay branches. AppShell's URL-sync + splitTreeFragment callback + BOTH tab-restore loops updated. Round-trip tests cover the relay protocol + backward-compat + splitTree-embedded relay leaf.

Wave 1 in parallel with Plans 01 and 02 — file-disjoint (this touches only tab-url.ts + AppShell.tsx + adjacent test files; neither is touched by 01 or 02).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/shapes/shape-phase-93-uat-polish-arc.md
@.planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-CONTEXT.md
@.planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-RESEARCH.md
@.planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-PATTERNS.md
</context>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| URL bar → parseTabParam → openTab → useRelayAdapter → WS connectToRoom | User-controlled `roomId` string flows from URL fragment into the WS payload. Backend-side WS auth-gate validates access (existing Phase 93 mechanism). Client does not double-validate. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-97-05-01 | Tampering | URL-injected forged roomId | mitigate | Backend WS auth-gate rejects roomIds the caller has no access to; adapter emits `error: "room-not-found"`; ChatSurfaceErrorState renders. Client-side: `decodeURIComponent` on the URL segment normalizes encoding; no injection into DOM (roomId flows into WS payload as a JSON string). No SQL, no template injection, no eval. |
| T-97-05-02 | Denial of Service | Very long roomId in URL fragment | mitigate | Browser URL fragment has ~2000-char practical limit; realistic Matrix roomIds are ~40 chars. Defensive cap `roomId.length <= 512` in parseTabParam per RESEARCH § Security Domain. Not strictly required — backend WS rejects oversized payloads. |
| T-97-05-03 | Information Disclosure | Structured logs at URL restore leaking full roomId | mitigate | Per RESEARCH § Finding 7 landmines: `[url-restore]` logs mask or truncate roomId to localpart. Follows Phase 93 Landmine 6 logging discipline. |
| T-97-05-SC | Tampering | package installs | accept | No package installs. |

Severity: LOW. Additive protocol variant in an existing grammar; existing WS auth-gate handles authorization. Client-side path is pure string manipulation with encode/decode symmetry.
</threat_model>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Widen tab-url.ts grammar via discriminated-union TabSpec + round-trip tests</name>
  <files>
    src/ui/lib/tab-url.ts,
    src/ui/lib/tab-url.test.ts
  </files>
  <read_first>
    - src/ui/lib/tab-url.ts (full 322 lines — the entire module is being extended; specifically L43-47 TabSpec interface, L73-79 PROTOCOLS list, L81-99 parseTabParam, L101-107 encodeTabSpec, L126-134 splitTree fragment integration, L140-157 specForTab, L211-251 consumePendingWorkspace)
    - src/ui/lib/tab-url.test.ts (existing test file — full read; specifically the existing round-trip tests for tmux: / terminal: / rdp: / vnc: / telnet: — these are the pattern to mirror for relay:)
    - src/ui/lib/split-tree-url.ts (targeted read — the module referenced from tab-url.ts:126-134; grep how it consumes/emits TabSpec[] to confirm a relay-kind leaf works positionally without split-tree-url changes)
    - src/types/ui-types.ts (targeted read L200-232 — Tab.sessionKind + Tab.relayRoomId shape; needed to know the exact types coming into specForTab)
    - .planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-RESEARCH.md § "Finding 7" (all subsections — 5 coordinated changes, landmines about URL length, backward compat, defensive cap)
    - .planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-PATTERNS.md § "Finding 7 — src/ui/lib/tab-url.ts" (extension shape verbatim; note this plan REVISION overrides the "widen host to optional" advice with mandatory discriminated-union form)
  </read_first>
  <behavior>
    - Test 1 (RED): `parseTabParam("relay:%21abcdef%3Amatrix.example.com")` returns `{ protocol: "relay", roomId: "!abcdef:matrix.example.com" }`.
    - Test 2 (RED): `parseTabParam("relay:")` returns `null` (empty roomId → invalid).
    - Test 3 (RED): `encodeTabSpec({ protocol: "relay", roomId: "!abcdef:matrix.example.com" })` returns `"relay:%21abcdef%3Amatrix.example.com"`.
    - Test 4 (RED): `specForTab({ type: "terminal", host: undefined, sessionKind: "relay-room", relayRoomId: "!abc:example.com" })` returns `{ protocol: "relay", roomId: "!abc:example.com" }`.
    - Test 5 (RED): `specForTab({ type: "terminal", host: undefined, sessionKind: "relay-room" })` (no relayRoomId) returns `null` (defensive).
    - Test 6 (regression): existing session-tab tests unchanged — `parseTabParam("tmux:foo.host:mysession")` still returns `{ protocol: "tmux", host: "foo.host", session: "mysession" }`.
    - Test 7 (regression): `encodeTabSpec({ protocol: "terminal", host: "foo.host" })` still returns `"terminal:foo.host"`.
    - Test 8 (round-trip): `parseTabParam(encodeTabSpec({protocol: "relay", roomId: "!abc:example.com"}))` returns the same shape.
    - Test 9 (backward compat): legacy URL fragment `#tab=tmux:foo:bar&tab=terminal:baz` parses without error (relay protocol addition does not break existing patterns).
    - Test 10 (over-cap defense): `parseTabParam("relay:" + "a".repeat(600))` returns `null` (roomId > 512 rejected).
  </behavior>
  <action>
    Coordinated changes in `src/ui/lib/tab-url.ts`, plus test file extensions. Execute in TDD order (write tests first RED, then implement GREEN).

    **Change 1 — Convert `TabSpec` at L43-47 to a discriminated union (MANDATORY per BLOCKER-2, not "if needed"):**

    Current:
    ```
    export interface TabSpec {
      protocol: "tmux" | "terminal" | "rdp" | "vnc" | "telnet";
      host: string;
      session?: string;
    }
    ```

    Replace with a discriminated union. `TabSpec` becomes a type alias, not an interface:
    ```
    export type TabSpec =
      | {
          protocol: "tmux" | "terminal" | "rdp" | "vnc" | "telnet";
          host: string;
          session?: string;
          roomId?: never;
        }
      | {
          protocol: "relay";
          roomId: string;
          host?: never;
          session?: never;
        };
    ```

    The `host?: never` / `session?: never` / `roomId?: never` markers make TS narrow exhaustively: after `if (spec.protocol === "relay") { ... }`, TS knows `spec.host` and `spec.session` are `never`. In the else branch, `spec.host` is `string` (unchanged from today). Consumers that already write `spec.host` continue to compile UNCHANGED as long as they check `spec.protocol !== "relay"` first OR live on a code path where the relay branch is guarded upstream.

    Rationale (why this is required, not optional): AppShell.tsx has non-null host consumers at ~L1264 (`spec.host.toLowerCase()`), ~L1267 (`allHosts.find((h) => h.id === spec.host)`), ~L1279 (`t.host?.id === spec.host`), ~L1351 (`spec.host.toLowerCase()`), ~L1354 (`allHosts.find((h) => h.id === spec.host)`), ~L1362 (`\`${spec.protocol}:${spec.host}:${spec.session ?? ""}\``), ~L1369 (same key builder in resolver), ~L1375 (`spec.host.toLowerCase()`), ~L1379 (`t.host?.id === spec.host`). Any softer widening (e.g. `host?: string`) leaves those consumers with `string | undefined` comparisons that tsc rejects under strictNullChecks. The discriminated-union form is the only shape that keeps existing tsc-clean consumers tsc-clean, while forcing the relay branch to be handled explicitly (via `if (spec.protocol === "relay") ...` guard-clause or ternary-narrowing).

    **Change 2 — Extend `PROTOCOLS` at L73-79:**

    Add `"relay"` to the array (order does not matter for parsing; place at the end for minimum diff churn):
    ```
    const PROTOCOLS: TabSpec["protocol"][] = [
      "tmux",
      "terminal",
      "rdp",
      "vnc",
      "telnet",
      "relay",
    ];
    ```

    **Change 3 — Extend `parseTabParam` at L81-99:**

    Add a relay branch after the PROTOCOLS check. Exact shape:

    ```
    export function parseTabParam(raw: string | null): TabSpec | null {
      if (!raw) return null;
      const idx1 = raw.indexOf(":");
      if (idx1 === -1) return null;
      const protocol = raw.slice(0, idx1) as TabSpec["protocol"];
      if (!PROTOCOLS.includes(protocol)) return null;
      const rest = raw.slice(idx1 + 1);
      if (protocol === "relay") {
        const roomId = decodeURIComponent(rest);
        if (!roomId) return null;
        // Defense-in-depth: reject grossly oversized roomIds (browser URL
        // fragment cap is ~2000 chars; realistic Matrix roomIds are ~40).
        if (roomId.length > 512) return null;
        return { protocol: "relay", roomId };
      }
      if (protocol === "tmux") {
        // ... existing tmux branch unchanged ...
      }
      const host = decodeURIComponent(rest);
      if (!host) return null;
      return { protocol, host };
    }
    ```

    Include the `roomId.length > 512` defensive cap per RESEARCH § Security Domain (T-97-05-02 mitigation).

    **Change 4 — Extend `encodeTabSpec` at L101-107:**

    Add a relay branch at the top of the function. Because TabSpec is now a discriminated union, TS narrows `spec.host` to `string` inside the else-branch — no `?? ""` fallback needed:

    ```
    export function encodeTabSpec(spec: TabSpec): string {
      if (spec.protocol === "relay") {
        return `relay:${encodeURIComponent(spec.roomId)}`;
      }
      const parts = [spec.protocol, encodeURIComponent(spec.host)];
      if (spec.protocol === "tmux" && spec.session) {
        parts.push(encodeURIComponent(spec.session));
      }
      return parts.join(":");
    }
    ```

    **Change 5 — Extend `specForTab` at L140-157:**

    Widen the input type + add a relay branch BEFORE the host-required check:

    ```
    export function specForTab(input: {
      type: TabType;
      host?: { name?: string; id?: string };
      targetTmuxSession?: string | null;
      sessionKind?: "harness" | "relay-room";
      relayRoomId?: string;
    }): TabSpec | null {
      // Phase 97 Finding 7: relay-room tabs have no fleet host — the room
      // lives on the Matrix relay. Route via sessionKind BEFORE the host-name
      // required check.
      if (input.sessionKind === "relay-room") {
        if (!input.relayRoomId) return null;
        return { protocol: "relay", roomId: input.relayRoomId };
      }
      if (!input.host?.name) return null;
      const host = input.host.name;
      if (input.type === "terminal") {
        if (input.targetTmuxSession) {
          return { protocol: "tmux", host, session: input.targetTmuxSession };
        }
        return { protocol: "terminal", host };
      }
      if (input.type === "rdp" || input.type === "vnc" || input.type === "telnet") {
        return { protocol: input.type, host };
      }
      return null;
    }
    ```

    **Test file extensions in `src/ui/lib/tab-url.test.ts`:**

    Add tests covering the 10 behaviors above (Tests 1-10). Mirror the existing test file's `describe` / `it` structure — do NOT create a new file unless the existing file's structure genuinely doesn't accommodate. Preserve all existing tests unchanged (regression floor).

    Landmines checklist:
    - decodeURIComponent handles Matrix-legal characters (`!`, `:`, `.`, `@`, `#`) correctly — verified by round-trip test.
    - The 512-char cap is defense-in-depth; comment references RESEARCH § Security Domain.
    - Backward compat: existing tests for tmux/terminal/rdp/vnc/telnet unchanged — no existing test needs modification.
    - The discriminated-union form makes `spec.host` unavailable in the relay branch at the type level — every AppShell consumer of `spec.host` MUST be guarded by `if (spec.protocol === "relay") continue;` OR by a `protocol !== "relay"` early-guard. That's Task 2's responsibility, but T1 verifies tsc-clean project-wide as its gate.
  </action>
  <verify>
    <automated>
      cd /home/ubuntu/skynet-taylor && \
      grep -q '"relay"' src/ui/lib/tab-url.ts && \
      grep -qE 'protocol:.*"relay"' src/ui/lib/tab-url.ts && \
      grep -q 'roomId: string' src/ui/lib/tab-url.ts && \
      grep -q 'roomId\?: never' src/ui/lib/tab-url.ts && \
      grep -q 'host\?: never' src/ui/lib/tab-url.ts && \
      grep -q 'if (protocol === "relay")' src/ui/lib/tab-url.ts && \
      grep -q 'if (spec.protocol === "relay")' src/ui/lib/tab-url.ts && \
      grep -q 'input.sessionKind === "relay-room"' src/ui/lib/tab-url.ts && \
      grep -q 'roomId.length > 512' src/ui/lib/tab-url.ts && \
      (TSC_OUT=$(npx tsc --noEmit 2>&1); echo "$TSC_OUT" | tee /tmp/97-05-task1-tsc.log; [ -z "$TSC_OUT" ] && echo TSC_CLEAN || (echo TSC_DIRTY; exit 1)) && \
      npx vitest run --related src/ui/lib/tab-url.ts 2>&1 | tee /tmp/97-05-task1-vitest.log | grep -qE 'Tests +[0-9]+ passed'
    </automated>
  </verify>
  <acceptance_criteria>
    - `tab-url.ts` `TabSpec` is a discriminated-union `type` (not an `interface`), with two variants — one for the harness protocols (host: string), one for `"relay"` (roomId: string, host?: never, session?: never).
    - `PROTOCOLS` array in `tab-url.ts` contains `"relay"` (grep count = 1 exactly).
    - `parseTabParam` has a `if (protocol === "relay")` branch that calls `decodeURIComponent`, checks `roomId.length > 512`, and returns `{ protocol: "relay", roomId }`.
    - `encodeTabSpec` has a `if (spec.protocol === "relay")` branch that calls `encodeURIComponent(spec.roomId)` and prepends `relay:`.
    - `specForTab` has a `if (input.sessionKind === "relay-room")` branch that returns `{ protocol: "relay", roomId: input.relayRoomId }` (or null if relayRoomId missing).
    - `specForTab` input type includes optional `sessionKind` and `relayRoomId` fields.
    - `npx tsc --noEmit` reports ZERO errors PROJECT-WIDE (not filtered to tab-url.ts). Verify output is literally empty. Any tsc error in AppShell.tsx, src/ui/**, or elsewhere fails this task's gate.
    - Scoped Vitest run against tab-url.ts passes green including all 10 new behavior tests + all existing session-tab tests.
    - Existing session-tab tests (tmux:/terminal:/rdp:/vnc:/telnet:) pass unchanged (regression floor).
  </acceptance_criteria>
  <done>tab-url.ts grammar widened via discriminated-union TabSpec with relay variant; parseTabParam, encodeTabSpec, specForTab all extended with relay branches; 10 new behavior tests pass green; existing session-tab tests pass unchanged; `npx tsc --noEmit` clean PROJECT-WIDE (TSC_CLEAN emitted; TSC_DIRTY exits nonzero).</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Wire AppShell URL-sync + BOTH tab-restore loops for relay protocol</name>
  <files>
    src/ui/AppShell.tsx,
    src/ui/AppShell.relay-url-restore.test.tsx
  </files>
  <read_first>
    - src/ui/AppShell.tsx (targeted reads: L910-972 for URL-sync effect + specForTab call site + splitTreeFragment callback; L1240-1400 for BOTH tab-restore loops — the first at ~L1256 (URL-driven-open pass) AND the second at ~L1344 (splitTree positional resolver's key-builder + fallback walk); L2140-2220 for onRelayRoomRowClick and the openTab call shape at L2169-2176 — the reference open-shape to mirror in tab-restore)
    - src/ui/lib/tab-url.ts (post-Task-1 — TabSpec is now a discriminated union; specForTab accepts sessionKind + relayRoomId; parseTabParam/encodeTabSpec handle relay)
    - src/types/ui-types.ts (Tab.sessionKind and Tab.relayRoomId fields — need to know what to read off `t` in the tabs array)
    - src/ui/features/pretty-view/sources/use-relay-adapter.ts (targeted read L20-40 for the JSDoc explaining what `roomId` means to the adapter; L506-508 for the `inactive` frame handling that surfaces `error: "room-not-found"`)
    - .planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-RESEARCH.md § "Finding 7" fix approach Change 4 + Change 5 (verbatim); landmines
    - .planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-PATTERNS.md § "Finding 7 — src/ui/AppShell.tsx" (URL-sync + tab-restore extension shapes verbatim)
  </read_first>
  <behavior>
    - Test 1 (top-level restore): Rendering AppShell with a `pending` workspace containing `{tabs: [{protocol: "relay", roomId: "!abc:example.com"}]}` triggers a call to `openTab(null, "terminal", undefined, {sessionKind: "relay-room", relayRoomId: "!abc:example.com", ...})`. Mock `openTab`; verify call args.
    - Test 2 (splitTree-embedded relay leaf restore — BLOCKER-1 regression): Rendering AppShell with a `pending` workspace whose `splitTree` fragment references a `{protocol: "relay", roomId: "!abc:example.com"}` leaf triggers the same `openTab(null, "terminal", ..., {sessionKind: "relay-room", ...})` call AND the second loop (splitTree resolver) resolves the leaf to the correct tabId. Verify no TypeError is thrown from `spec.host.toLowerCase()` (i.e. the relay-guard is in place).
    - Test 3 (mixed session + relay workspace restore): Rendering AppShell with a `pending` workspace containing both a `{protocol: "tmux", host: "...", session: "..."}` tab AND a `{protocol: "relay", roomId: "..."}` tab restores BOTH — the session tab through the existing host-lookup path, the relay tab through the new sessionKind-based path. Both loops handle both spec shapes.
    - Test 4 (regression): Legacy pending workspace with only tmux/terminal/rdp specs still restores unchanged — no behavior change on the session path (regression floor).
  </behavior>
  <action>
    Two changes in `src/ui/AppShell.tsx`, PLUS a new test file `src/ui/AppShell.relay-url-restore.test.tsx`.

    **Change 1 — URL-sync: pass sessionKind + relayRoomId to specForTab (~L914-922 + splitTreeFragment callback ~L933-950):**

    Current call site inside the URL-sync effect at L910-972:

    ```
    for (const t of tabs) {
      const spec = specForTab({
        type: t.type,
        host: t.host,
        targetTmuxSession: tmuxSessionNames[t.id] ?? t.targetTmuxSession,
      });
      if (!spec) continue;
      if (t.id === activeTabId) activeIndex = tabSpecs.length;
      tabSpecs.push(spec);
    }
    ```

    Extended:

    ```
    for (const t of tabs) {
      const spec = specForTab({
        type: t.type,
        host: t.host,
        targetTmuxSession: tmuxSessionNames[t.id] ?? t.targetTmuxSession,
        // Phase 97 Finding 7: relay-room tabs surface via sessionKind +
        // relayRoomId; specForTab's relay branch emits `relay:<roomId>`.
        sessionKind: t.sessionKind,
        relayRoomId: t.relayRoomId,
      });
      if (!spec) continue;
      if (t.id === activeTabId) activeIndex = tabSpecs.length;
      tabSpecs.push(spec);
    }
    ```

    ALSO extend the `splitTreeFragment` callback at L933-950 (same pattern — pass the same two fields):

    ```
    const splitTreeFragment = encodeSplitTreeToUrl(splitTree, (tabId) => {
      const t = tabs.find((tab) => tab.id === tabId);
      if (!t) return null;
      return specForTab({
        type: t.type,
        host: t.host,
        targetTmuxSession: t.targetTmuxSession ?? tmuxSessionNames[t.id],
        sessionKind: t.sessionKind,           // NEW
        relayRoomId: t.relayRoomId,           // NEW
      });
    });
    ```

    Do NOT change the effect's dependency array except to include `tabs` and `activeTabId` and `tmuxSessionNames` if not already present. Do NOT add `chatSurfaceAdapter.roomTitle` or similar — per RESEARCH landmine, URL is keyed on roomId alone; title landing later should NOT trigger a URL rewrite.

    **Change 2 — Tab-restore FIRST loop (~L1256) — top-level URL-driven-open pass. Handle protocol === "relay":**

    Locate the tab-restore loop at ~L1256 that consumes `pending.tabs`. Because `TabSpec` is now a discriminated union, tsc will REJECT any code that reads `spec.host` without first narrowing away the relay variant. Add a relay branch at the TOP of the loop body (BEFORE the existing `spec.host.toLowerCase()` at ~L1264):

    ```
    if (pending) {
      for (const spec of pending.tabs) {
        // Phase 97 Finding 7: relay-room tabs restore via openTab(null, "terminal", ...)
        // matching the onRelayRoomRowClick shape at AppShell.tsx:2169-2176.
        // This branch MUST come before any spec.host access — TabSpec is a
        // discriminated union post-Task-1; the relay variant has host?: never.
        if (spec.protocol === "relay") {
          // Idempotency: reuse an already-restored relay-room tab if one
          // with the same roomId exists.
          const match = restoredTabs.find(
            (t) => t.sessionKind === "relay-room" && t.relayRoomId === spec.roomId,
          );
          if (match) {
            openedIds.push(match.id);
          } else {
            // Structured log for URL-restore forensics. Room ID is masked to
            // localpart-before-colon to avoid leaking the full share-sensitive
            // address (defense-in-depth per V8 information-disclosure).
            const localpart = spec.roomId.split(":")[0]?.replace(/^!/, "").slice(0, 12) ?? "unknown";
            // eslint-disable-next-line no-console
            console.info({
              operation: "relay_room_url_restore",
              roomIdLocalpart: localpart,
              hasMatch: false,
            });
            const newId = openTab(null, "terminal", undefined, {
              sessionKind: "relay-room",
              relayRoomId: spec.roomId,
              relayRoomTitle: null,  // useRelayAdapter fills this in via session frame
              label: spec.roomId,    // loading placeholder
              allowCreateTmux: false,
            });
            if (newId) openedIds.push(newId);
          }
          continue;  // skip the host-required logic below
        }
        // Existing session-tab logic UNCHANGED below (spec.host is now
        // narrowed to string by the discriminated-union — no other change
        // needed to the existing body).
        const wantType: TabType = spec.protocol === "tmux" ? "terminal" : (spec.protocol as TabType);
        const wantSession = spec.protocol === "tmux" ? (spec.session ?? null) : null;
        const needle = spec.host.toLowerCase();
        // ... rest of existing body unchanged ...
      }
    }
    ```

    Adapt variable names (`restoredTabs`, `openedIds`, `openTab`, `pending`) to whatever the actual local names are in the shipped AppShell — the SHAPE is: match on `protocol === "relay"`, extract `spec.roomId`, look for a same-roomId tab first (reuse), else call `openTab(null, "terminal", undefined, {sessionKind: "relay-room", relayRoomId, relayRoomTitle: null, label, allowCreateTmux: false})`, log with masked roomId.

    **Change 3 — Tab-restore SECOND loop (~L1344) — splitTree positional resolver's key-builder + fallback walk (BLOCKER-1 fix):**

    Locate the SECOND `for (const spec of pending.tabs)` loop at ~L1344, inside `if (pending?.splitTree) { ... }`. This loop rebuilds a `spec-key → tabId` map. Add THREE relay-aware changes:

    **3a. Relay-branch the loop body to skip the host-lookup path AND provide a relay-flavored spec-key:**

    Current (~L1342-1366):
    ```
    const specToTabId = new Map<string, string>();
    {
      let openedIdx = 0;
      for (const spec of pending.tabs) {
        const wantType: TabType = spec.protocol === "tmux" ? "terminal" : (spec.protocol as TabType);
        const wantSession = spec.protocol === "tmux" ? (spec.session ?? null) : null;
        const needle = spec.host.toLowerCase();   // THROWS on relay (spec.host is never)
        const host = allHosts.find((h) => h.name.toLowerCase() === needle)
                  ?? allHosts.find((h) => h.id === spec.host);
        if (!host) continue;
        // ... enabledForType check ...
        const key = `${spec.protocol}:${spec.host}:${spec.session ?? ""}`;  // "relay:undefined:" for relay
        const id = openedIds[openedIdx];
        if (id) specToTabId.set(key, id);
        openedIdx += 1;
      }
    }
    ```

    Extended:
    ```
    const specToTabId = new Map<string, string>();
    {
      let openedIdx = 0;
      for (const spec of pending.tabs) {
        // Phase 97 Finding 7 BLOCKER-1: relay branch MUST come before any
        // spec.host access — TabSpec's discriminated union types host as
        // never on the relay variant, and the runtime value is undefined.
        if (spec.protocol === "relay") {
          const key = `relay:${spec.roomId}`;
          const id = openedIds[openedIdx];
          if (id) specToTabId.set(key, id);
          openedIdx += 1;
          continue;
        }
        // Existing session-tab body UNCHANGED — spec.host is narrowed to
        // string by the discriminated union.
        const wantType: TabType = spec.protocol === "tmux" ? "terminal" : (spec.protocol as TabType);
        const wantSession = spec.protocol === "tmux" ? (spec.session ?? null) : null;
        const needle = spec.host.toLowerCase();
        // ... rest unchanged ...
        const key = `${spec.protocol}:${spec.host}:${spec.session ?? ""}`;
        const id = openedIds[openedIdx];
        if (id) specToTabId.set(key, id);
        openedIdx += 1;
      }
    }
    ```

    **3b. Relay-branch the resolver closure at ~L1368-1385 — both the key builder AND the fallback walk:**

    Current (~L1368-1385):
    ```
    const resolver = (spec: TabSpec): string | null => {
      const key = `${spec.protocol}:${spec.host}:${spec.session ?? ""}`;  // "relay:undefined:" on relay
      const hit = specToTabId.get(key);
      if (hit) return hit;
      // Fallback: walk restoredTabs + closure tabs.
      const wantSession = spec.protocol === "tmux" ? (spec.session ?? null) : null;
      const wantHostNeedle = spec.host.toLowerCase();   // THROWS on relay
      for (const t of [...restoredTabs, ...tabs]) {
        const hostNameMatch = (t.host?.name ?? "").toLowerCase() === wantHostNeedle;
        const hostIdMatch = t.host?.id === spec.host;    // string | undefined vs string.id: tsc error
        const sessionMatch = (t.targetTmuxSession ?? null) === wantSession;
        if ((hostNameMatch || hostIdMatch) && sessionMatch) return t.id;
      }
      return null;
    };
    ```

    Extended:
    ```
    const resolver = (spec: TabSpec): string | null => {
      // Phase 97 Finding 7 BLOCKER-1: relay branch first — matches on
      // roomId identity (both the map key and the fallback walk).
      if (spec.protocol === "relay") {
        const key = `relay:${spec.roomId}`;
        const hit = specToTabId.get(key);
        if (hit) return hit;
        // Fallback: walk restoredTabs + closure tabs looking for a relay-room
        // tab with the same roomId.
        for (const t of [...restoredTabs, ...tabs]) {
          if (t.sessionKind === "relay-room" && t.relayRoomId === spec.roomId) {
            return t.id;
          }
        }
        return null;
      }
      // Existing session-tab resolution UNCHANGED — spec.host narrowed to string.
      const key = `${spec.protocol}:${spec.host}:${spec.session ?? ""}`;
      const hit = specToTabId.get(key);
      if (hit) return hit;
      const wantSession = spec.protocol === "tmux" ? (spec.session ?? null) : null;
      const wantHostNeedle = spec.host.toLowerCase();
      for (const t of [...restoredTabs, ...tabs]) {
        const hostNameMatch = (t.host?.name ?? "").toLowerCase() === wantHostNeedle;
        const hostIdMatch = t.host?.id === spec.host;
        const sessionMatch = (t.targetTmuxSession ?? null) === wantSession;
        if ((hostNameMatch || hostIdMatch) && sessionMatch) return t.id;
      }
      return null;
    };
    ```

    Note: the `t.host?.id === spec.host` comparison at ~L1379 no longer needs a nullness-guard on `spec.host` — the relay early-return above eliminates the case where `spec.host` is `never`. Similarly for `spec.host.toLowerCase()` at ~L1375.

    Do NOT change the existing session-tab branches. Do NOT add validation of the roomId shape beyond what parseTabParam already does (backend-side WS auth-gate is the authority — Phase 97 does not add client-side authz).

    **Change 4 — Create test file `src/ui/AppShell.relay-url-restore.test.tsx`:**

    Cover Tests 1-4 in the behavior block. Structure:
    - Mock `openTab` (either via jest.spyOn or a test double from an existing AppShell test file's pattern).
    - Render AppShell with different `pending` workspace fixtures via a mock of `consumePendingWorkspace` (grep the existing test file's mock pattern; mirror it).
    - Assert `openTab` call arguments per Test 1-3.
    - Test 4 uses a legacy pending shape (only session tabs); assert the relay branch does NOT fire and session tabs restore unchanged.

    Landmines checklist:
    - `consumePendingWorkspace` is called once per Chrome tab lifetime — verify the restore call sits inside that once-per-lifetime block, not in a general re-render effect.
    - `split-tree-url.ts` module — verify via grep-read that no explicit protocol-check exists in that module that would exclude "relay". Likely-outcome per RESEARCH is that split-tree-url is protocol-agnostic and no change is needed. If a check exists, extend it in a peer task; likely-not-needed based on discriminated-union post-Task-1.
    - Structured log uses `{operation, ...explicit-fields...}` object shape per Phase 93 Landmine 6; masked localpart only. NEVER log the full roomId; NEVER JSON.stringify a raw WS frame.
    - URL-restored room that no longer resolves emits `error: "room-not-found"` from useRelayAdapter (existing Phase 93 Slice 6 mechanism) → ChatSurfaceErrorState overlay renders. No new error path in this plan.
  </action>
  <verify>
    <automated>
      cd /home/ubuntu/skynet-taylor && \
      grep -q 'sessionKind: t.sessionKind' src/ui/AppShell.tsx && \
      grep -q 'relayRoomId: t.relayRoomId' src/ui/AppShell.tsx && \
      grep -q 'operation: "relay_room_url_restore"' src/ui/AppShell.tsx && \
      (RELAY_COUNT=$(grep -c 'spec.protocol === "relay"' src/ui/AppShell.tsx); [ "$RELAY_COUNT" -ge 2 ] || (echo "expected >=2 spec.protocol === \"relay\" guards (both loops), got $RELAY_COUNT"; exit 1)) && \
      (ROOMID_COUNT=$(grep -c 'spec.roomId' src/ui/AppShell.tsx); [ "$ROOMID_COUNT" -ge 4 ] || (echo "expected >=4 spec.roomId references (both loops + resolver key + resolver fallback), got $ROOMID_COUNT"; exit 1)) && \
      grep -q 'sessionKind: "relay-room"' src/ui/AppShell.tsx && \
      grep -q 't\.sessionKind === "relay-room" && t\.relayRoomId === spec\.roomId' src/ui/AppShell.tsx && \
      (SESSKIND_COUNT=$(grep -c 'sessionKind: t.sessionKind' src/ui/AppShell.tsx); [ "$SESSKIND_COUNT" -ge 2 ] || (echo "expected >=2 sessionKind: t.sessionKind sites (URL-sync loop + splitTreeFragment callback), got $SESSKIND_COUNT"; exit 1)) && \
      (grep -c 'JSON\.stringify(e)' src/ui/AppShell.tsx | grep -q '^0$') && \
      (TSC_OUT=$(npx tsc --noEmit 2>&1); echo "$TSC_OUT" | tee /tmp/97-05-task2-tsc.log; [ -z "$TSC_OUT" ] && echo TSC_CLEAN || (echo TSC_DIRTY; exit 1)) && \
      npx vitest run --related src/ui/AppShell.tsx 2>&1 | tee /tmp/97-05-task2-vitest.log | grep -qE 'Tests +[0-9]+ passed'
    </automated>
  </verify>
  <acceptance_criteria>
    - AppShell.tsx URL-sync effect (~L910-972) passes `sessionKind: t.sessionKind` and `relayRoomId: t.relayRoomId` to `specForTab` (grep-verifiable).
    - AppShell.tsx splitTreeFragment callback (~L933-950) also passes those two fields to its `specForTab` call.
    - Grep count of `sessionKind: t.sessionKind` in AppShell.tsx is >= 2 (URL-sync loop + splitTreeFragment callback).
    - AppShell.tsx tab-restore loop 1 (~L1256) contains `if (spec.protocol === "relay")` branch that calls `openTab(null, "terminal", undefined, {sessionKind: "relay-room", relayRoomId: spec.roomId, ...})` before any `spec.host` access.
    - AppShell.tsx splitTree resolver key builder (~L1344 loop AND ~L1368 closure) contains `if (spec.protocol === "relay")` branch that constructs `relay:${spec.roomId}` key AND walks `restoredTabs + tabs` matching on `t.sessionKind === "relay-room" && t.relayRoomId === spec.roomId`.
    - Grep count of `spec.protocol === "relay"` in AppShell.tsx is >= 2 (first-loop guard + splitTree-loop guard, minimum; resolver closure guard is a plus).
    - Grep count of `spec.roomId` in AppShell.tsx is >= 4 (first-loop match-find + first-loop openTab call + splitTree-loop key builder + resolver fallback walk).
    - Grep for the literal `t\.sessionKind === "relay-room" && t\.relayRoomId === spec\.roomId` in AppShell.tsx matches at least once (resolver fallback walk).
    - AppShell.tsx contains a structured log with `operation: "relay_room_url_restore"` and a masked `roomIdLocalpart` field.
    - No `JSON.stringify(e)` on DOM Event in AppShell.tsx (grep = 0) — Phase 93 Landmine 6 preserved.
    - No `JSON.stringify(spec.roomId)` or full-roomId log emit (grep-verify the log emit only contains the localpart-truncated value).
    - `npx tsc --noEmit` reports ZERO errors PROJECT-WIDE (TSC_CLEAN emitted). Any tsc error fails this task's gate.
    - Scoped Vitest run against AppShell.tsx passes green including new tests in `AppShell.relay-url-restore.test.tsx` (Tests 1-4).
    - Existing session-tab URL round-trip tests pass unchanged (regression floor).
  </acceptance_criteria>
  <done>AppShell URL-sync effect + splitTreeFragment callback thread sessionKind + relayRoomId through specForTab. BOTH tab-restore loops (top-level URL-open at ~L1256 AND splitTree resolver at ~L1344) handle protocol==='relay' — relay-branch key builder emits `relay:${spec.roomId}`, resolver fallback walks tabs matching on sessionKind + relayRoomId identity. Structured log emits with masked roomIdLocalpart. `npx tsc --noEmit` clean PROJECT-WIDE. All scoped tests green, including the new AppShell.relay-url-restore.test.tsx (Tests 1-4).</done>
</task>

</tasks>

<verification>
- Task 1 grep gates confirm: TabSpec discriminated union + PROTOCOLS + parseTabParam + encodeTabSpec + specForTab all extended with relay branches; 512-char defensive cap present; tsc clean PROJECT-WIDE.
- Task 2 grep gates confirm: URL-sync + splitTreeFragment + BOTH tab-restore loops (~L1256 AND ~L1344) all thread sessionKind/relayRoomId or handle protocol==='relay'; splitTree resolver's key builder AND fallback walk both handle relay; structured log with masked localpart; no full-roomId leak.
- Scoped Vitest: tab-url.test.ts passes with 10 new behavior tests; AppShell.relay-url-restore.test.tsx passes with Tests 1-4 including the splitTree-embedded relay leaf regression test (BLOCKER-1 regression floor).
- Regression floor: all existing session-tab round-trip tests unchanged (tmux, terminal, rdp, vnc, telnet). Mixed session + relay workspace restores both correctly (Test 3).
- Backward compat: legacy URLs without `relay:` still parse without regression.
- `npx tsc --noEmit` PROJECT-WIDE clean after both tasks — no AppShell.tsx errors, no other consumer errors from the TabSpec discriminated-union tightening.
- Manual browser verification (during execute-plan run): open a relay room, observe the URL fragment updates to include `relay:<encoded>`; refresh the browser; observe the relay tab restores. If the room is in a split, verify the split tree also restores with the relay leaf in place.

**Non-blocking warnings noted but out-of-scope for this plan (from iteration 1 checker report):**
- WARNING-5 (placeholder capitalization): belongs to Plan 03, not Plan 05. Not addressed here.
- Other warnings not specific to Plan 05.
</verification>

<success_criteria>
- src/ui/lib/tab-url.ts: TabSpec is a discriminated union (harness variant `host: string` vs relay variant `roomId: string`, `host?: never`, `session?: never`); PROTOCOLS list includes `"relay"`; parseTabParam + encodeTabSpec + specForTab all handle relay branches with defensive 512-char cap.
- src/ui/AppShell.tsx: URL-sync effect + splitTreeFragment callback thread sessionKind + relayRoomId; BOTH tab-restore loops handle protocol==='relay' (top-level opens via openTab with sessionKind: "relay-room"; splitTree resolver keys by `relay:${roomId}` and falls back to walking tabs matching on sessionKind + relayRoomId identity); structured log with masked localpart.
- `npx tsc --noEmit` PROJECT-WIDE clean — no tsc errors in AppShell.tsx or elsewhere from the discriminated-union tightening.
- 10 new behavior tests in tab-url.test.ts pass.
- 4 new tests in AppShell.relay-url-restore.test.tsx pass (top-level restore, splitTree-embedded relay leaf restore, mixed session+relay restore, legacy session-only regression).
- All existing session-tab round-trip tests pass unchanged.
- Live browser verification: relay room URL round-trips correctly on refresh, including when the relay tab is inside a splitTree fragment.
</success_criteria>

<output>
Create `.planning/phases/97-.../97-05-SUMMARY.md` when done. Include:
- Confirmation that the discriminated-union TabSpec form compiled cleanly project-wide (no tsc errors surfaced elsewhere) — BLOCKER-2 closure evidence.
- Confirmation that BOTH `pending.tabs` loops in AppShell.tsx (~L1256 top-level AND ~L1344 splitTree resolver) got the relay branch — BLOCKER-1 closure evidence with grep counts.
- Whether split-tree-url.ts needed changes (RESEARCH predicts no — verify).
- Live browser URL round-trip evidence: paste the encoded URL fragment format observed (e.g. `#tab=relay:%21abc%3Amatrix.example.com` — with localpart-masked example), for BOTH top-level relay tab AND splitTree-embedded relay leaf.
- Confirmation that the structured log emits only masked localpart, not full roomId.
- Note the non-blocking WARNING-5 (placeholder capitalization) is Plan 03's issue, not Plan 05's — carrying forward as a cross-reference.
</output>

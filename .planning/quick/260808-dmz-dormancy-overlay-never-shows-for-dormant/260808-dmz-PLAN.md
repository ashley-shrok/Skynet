---
phase: quick-260808-dmz
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/backend/claude-session/claude-session-server.ts
  - src/ui/features/pretty-view/PrettyView.tsx
  - src/backend/claude-session/dormant-poll.test.ts
  - /home/ubuntu/.claude/roles/box-maintainer/skynet-patches.md
autonomous: false
requirements:
  - DMZ-01
  - DMZ-02
  - DMZ-03
  - DMZ-04

must_haves:
  truths:
    - "For an identity-shaped tmux pane with ~/.claude/identities/<name>/.dormant present + no claude process, backend emits {type:dormant, dormant:true} INSTEAD of {type:inactive, reason:not_claude} (per bounty ROOT CAUSE / FIX §1-2)."
    - "After emitting dormant:true from the inactive branch, backend keeps sshConn open (no conn.end() / sshConn=null teardown) and enters a lightweight dormant-poll loop that runs every 3s (per bounty FIX §2-3)."
    - "When the .dormant sentinel disappears mid-dormant-poll, backend emits {type:dormant, dormant:false} + re-runs discoverClaudeSession; on active result it transitions to the normal active session flow (emits {type:session, pid, sessionFile} + starts tail + starts context-pct/dormancy timer) via a shared helper — no copy-paste of the active-flow block (per bounty FIX §3 + constraint 'extract into a helper')."
    - "When re-discovery still returns inactive/not_claude (supervisor has not reconciled yet), dormant-poll keeps ticking; no teardown fires (per bounty FIX §3 last bullet)."
    - "Wake handler ({type:wake} client to server, patch #345) remains reachable while backend is in the dormant-poll state — verified by a test that shows __applyWakeMessageForTests succeeds with an identity-shaped cached state (per bounty FIX §4)."
    - "Frontend: PrettyView's inactive fallback at line 1575 does NOT render when dormant === true (belt-and-suspenders per bounty FRONTEND §; also protects against transitional frames where backend races)."
    - "Tag-along diag fix: pretty-view snapshot in diag registry emits isVisible: <boolean> instead of isVisible: null (per bounty TAG-ALONG §)."
    - "Patch #345's dormantInFlight check in the ACTIVE poll cycle is kept AS-IS (belt-and-suspenders); rationale documented in PLAN + patch #346 entry: cheap + defensive + catches supervisor race where sentinel reappears mid-active (dead code in the common path but not removed to preserve invariant coverage)."
    - "Full npm test (npx vitest run) is green: baseline 1580+ pass / 6 skip after patch #345 is preserved; new dormant-poll-inactive-branch tests added and pass."
    - "Skynet ships via docker compose up -d --force-recreate skynet under the 15-min deadman with HTTPS 200 confirmed on term.gigaashley.click AND container health sustained."
    - "Patch #346 entry appended to /home/ubuntu/.claude/roles/box-maintainer/skynet-patches.md in the same numbered format as #345."
  artifacts:
    - path: "src/backend/claude-session/claude-session-server.ts"
      provides: "Inactive-branch dormancy probe + dormant-poll loop + extracted active-flow helper"
      contains:
        - "helper function or inline named block that starts context-pct timer + session tail (currently the ~lines 3503-3841 block after the inactive check), reachable from BOTH the initial discovery active-path AND from the dormant-poll wake path"
        - "in the inactive branch (line ~3484), a guarded probe: if discoverClaudeSession returned {status:inactive} AND identity-shape probe says yes AND .dormant sentinel exists → emit {type:dormant, dormant:true}, keep sshConn open, start dormant-poll timer, return WITHOUT teardown"
        - "dormant-poll timer with dormantPollInFlight guard (mirrors existing contextPctInFlight/dormantInFlight pattern), 3s cadence, closure-scoped, cleared in teardownPane"
    - path: "src/ui/features/pretty-view/PrettyView.tsx"
      provides: "Belt-and-suspenders gate on inactive fallback + diag snapshot isVisible fix"
      contains:
        - "line ~1575: {status === 'inactive' && !dormant && (...)} — inactive fallback does not render when dormant"
        - "line ~1212: isVisible: isVisibleRef.current (or the isVisible prop directly via shorthand) replacing isVisible: null"
    - path: "src/backend/claude-session/dormant-poll.test.ts"
      provides: "New backend tests covering the dormant-poll-inactive-branch behaviors"
      contains:
        - "Test G: inactive-branch dormancy probe — discoverClaudeSession returns inactive/not_claude + identity-shaped + .dormant present → emit dormant:true, NO teardown, sshConn stays alive"
        - "Test H: dormant-poll sentinel-disappearance — starting from cached dormant:true state, next tick's stat returns 'no' → emit dormant:false + trigger re-discovery via injected discoverClaudeSession stub"
        - "Test I: dormant-poll re-discovery yields active → transitions to active flow via the extracted helper (verify helper called with correct newSessionFile/pid)"
        - "Test J: dormant-poll re-discovery still inactive/not_claude → dormant-poll keeps ticking, no teardown, no active-flow transition"
        - "Test K: wake handler stays reachable in dormant-poll state — reuses existing __applyWakeMessageForTests with isIdentityShapedCached:true + valid sshConn stub → returns {wake_result, ok:true}"
    - path: "/home/ubuntu/.claude/roles/box-maintainer/skynet-patches.md"
      provides: "Patch #346 entry appended after #345"
      contains:
        - "### Patch #346 header + same-numbered-format body describing the inactive-branch fix, the extracted helper, the frontend belt-and-suspenders + diag tag-along, the rationale for keeping the patch #345 active-poll dormant check as defensive, and the ship metadata (image sha, container health, HTTPS 200, byte-verified symbols)"
  key_links:
    - from: "src/backend/claude-session/claude-session-server.ts inactive branch (line ~3484)"
      to: "the new dormant-poll timer + extracted startActiveSessionFlow helper"
      via: "await discoverClaudeSession → status:inactive → identity-shape probe → .dormant stat → branch: (a) dormant:true emit + start dormant-poll OR (b) fall through to existing teardown"
      pattern: 'if \\(result\\.status === "inactive"\\)'
    - from: "dormant-poll loop"
      to: "extracted startActiveSessionFlow helper"
      via: "on sentinel-disappearance + re-discovery active → helper invocation that emits session + starts tail + starts context-pct timer (which itself carries the patch #345 dormancy piggyback for active panes — self-consistent, no duplicate poll)"
      pattern: "startActiveSessionFlow|startClaudeSessionTail"
    - from: "PrettyView.tsx inactive fallback (line ~1575)"
      to: "dormant state (line 321 const [dormant, setDormant] = useState(false))"
      via: 'conjunction gate `status === "inactive" && !dormant`'
      pattern: 'status === "inactive" && !dormant'
    - from: "PrettyView.tsx pretty-view snapshot (line ~1212)"
      to: "isVisibleRef.current (line 544) OR the isVisible prop (line 145)"
      via: "one-line snapshot field change"
      pattern: "isVisible: (isVisibleRef\\.current|isVisible)"
---

<objective>
Hotfix patch #345 (dormancy overlay never appeared for actually-dormant panes because
the dormancy poll was a passenger on the ACTIVE poll cycle, which never runs after the
inactive-branch short-circuit tears down SSH). Move the dormancy probe into the INACTIVE
branch, add a lightweight dormant-poll loop, and extract the active-flow start into a
helper so wake transitions reuse it without copy-paste. Add a belt-and-suspenders
frontend gate so the "no active Claude session" fallback cannot render when `dormant`
is true, and pick up the trivial diag-registry `isVisible: null` regression from
patch #344 as a tag-along one-liner.

Purpose:
- Ashley UAT of patch #345 failed: opening Tiffany's dormant pane rendered
  "no active Claude session" instead of the DormancyOverlay because the backend
  short-circuited on {type:inactive, reason:not_claude} before the dormancy
  poll could ever fire. This blocks the whole dormancy affordance she greenlit.
- The fix is what the bounty.json spells out; do NOT redesign. Implement it,
  ship it, patch #346 in skynet-patches.md, then UAT with Ashley on Tiffany.

Output:
- Backend inactive-branch restructured + dormant-poll loop + extracted active-flow helper
- Frontend belt-and-suspenders gate on inactive fallback
- Diag registry isVisible tag-along fix
- New backend tests (5 tests, G-K) for the dormant-poll-inactive-branch behaviors
- Green npm test (1580+ pass / 6 skip baseline preserved)
- Shipped image, container healthy, HTTPS 200
- Patch #346 entry in skynet-patches.md
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@/home/ubuntu/skynet/.planning/STATE.md
@/home/ubuntu/skynet/CLAUDE.md
@/home/ubuntu/.claude/roles/box-maintainer/bounties/dormancy-overlay-inactive-branch-fix/bounty.json
@/home/ubuntu/.claude/roles/box-maintainer/bounties/dormancy-overlay-and-wake-button/bounty.json
@/home/ubuntu/skynet/src/backend/claude-session/claude-session-server.ts
@/home/ubuntu/skynet/src/backend/claude-session/session-file-discovery.ts
@/home/ubuntu/skynet/src/ui/features/pretty-view/PrettyView.tsx
@/home/ubuntu/skynet/src/backend/claude-session/dormant-poll.test.ts

Load-bearing prior art (already in tree — do not re-explain, read directly):
- Test seams at lines 905-1004 of claude-session-server.ts (`__applyDormantPollTickForTests`
  + `__applyWakeMessageForTests` + `__DormantStateForTests`) — REUSE these; extend if needed.
- Active-flow start block currently spans line 3503 through the end of the contextPctTimer
  IIFE at ~line 3841 + the aside subsystem registration at ~line 3853+. The extraction
  target for this hotfix is the SESSION-METADATA-EMIT + TAIL-START + CONTEXT-PCT-TIMER-START
  portion (lines ~3503-3841). Aside subsystem registration is separate — determine at
  implementation time whether wake needs to re-run it (it probably does, since dormant
  panes torn down aside registration too).
- Frontend live-frame auto-dismiss (line 707-722) already handles the wake-completion
  case: the `session` frame we emit on wake will trip it, dropping `dormant=false` +
  clearing `waking` state client-side. Zero additional frontend logic needed for the
  transition-back-to-active leg.
- Patch #345 already-in-tree types: {type:dormant, dormant:boolean} +
  {type:wake_result, ok, error?} in src/ui/api/claude-session-api.ts; DormancyOverlay
  + ComposeBox dormantActive prop; PrettyView state hooks. Nothing here needs new types.
</context>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client → backend WS | dormant client → server messages (existing {type:wake}) — already hardened in patch #345 (T-cd6-01/02/03: connection-scoped currentTmuxSession, single-quote wrap, hard-coded sentinel path) |
| backend → managed host via SSH exec | new dormant-poll `stat` on `~/.claude/identities/<name>/.dormant` (same pattern + escaping as patch #345 active-poll dormant stat) |
| backend closure state | sshConn lifecycle across the inactive→dormant→active transition — must not leak conns on WS-close mid-transition |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-dmz-01 | Tampering | Inactive-branch dormant probe SSH command | mitigate | Reuse the exact escaping from patch #345 lines 946-950/956-961: `test -d ~/.claude/identities/'${escapedName}'` + `stat ~/.claude/identities/'${escapedName}'/.dormant`. Same tmux-safe subset validation applies (frontend enforces alphanumeric+dash+underscore before connectToPane). No new escape surface. |
| T-dmz-02 | Denial of Service | Dormant-poll timer leak on WS-close during inactive→dormant transition | mitigate | Register the dormant-poll timer via a closure-scoped `dormantPollTimer` var alongside `contextPctTimer`; ensure `teardownPane()` (lines 1231-1233 style) clears BOTH. Add an `if (stopped || ws.readyState !== WebSocket.OPEN) return` guard at the top of every dormant-poll IIFE, mirroring the contextPctTimer pattern (line 3579). |
| T-dmz-03 | Denial of Service | discoverClaudeSession re-invocation from dormant-poll piling up on slow SSH | mitigate | `dormantPollInFlight` guard mirroring `contextPctInFlight` (line 1087) + `dormantInFlight` (line 1095). A single flight bit gates both the stat check AND the re-discovery call. |
| T-dmz-04 | Information Disclosure | Backend logging on inactive→dormant transition | accept | Existing sshLogger.info at line 3475 already logs `status: result.status`. Add ONE additional info log at the dormant-branch entry point noting the transition, keyed on hostId+tmuxSession (same PII posture as patch #345 — tmuxSession names are user-chosen, not credentials). |
| T-dmz-05 | Elevation of Privilege | Wake handler reachability during dormant-poll state | mitigate | The wake handler at line 3389 already gates on `isIdentityShapedCached === true` (via __applyWakeMessageForTests). Keeping sshConn alive in the dormant branch means the wake handler's sshConn guard remains satisfied. Test K explicitly verifies this reachability. |
| T-dmz-SC | Tampering | npm/pip/cargo installs | mitigate | **N/A this patch — zero new dependencies.** No `npm install` runs. All work uses code already in tree from patches #344/#345. |
</threat_model>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Backend — extract active-flow helper + move dormancy probe into inactive branch + dormant-poll loop</name>
  <files>src/backend/claude-session/claude-session-server.ts, src/backend/claude-session/dormant-poll.test.ts</files>

  <behavior>
    - Test G (NEW, in dormant-poll.test.ts): Inactive-branch dormancy probe — given a mock discoverClaudeSession returning {status:inactive, reason:not_claude} + identity-shape probe returns "yes" + .dormant stat returns "yes", the seam under test emits ONE {type:dormant, dormant:true} frame and DOES NOT invoke a mock teardown callback (proves sshConn stays alive).
    - Test H (NEW): Sentinel-disappearance — starting from cached-dormant state (dormantLastEmitted:true, isIdentityShapedCached:true), a poll tick where stat returns "no" emits {type:dormant, dormant:false} AND invokes the injected re-discovery callback exactly once.
    - Test I (NEW): Re-discovery yields active — with injected discoverClaudeSession returning {status:active, pid:12345, sessionFile:/home/x/.claude/projects/foo/bar.jsonl}, the seam invokes the injected startActiveSessionFlow callback with {pid:12345, sessionFile:/home/x/.claude/projects/foo/bar.jsonl}.
    - Test J (NEW): Re-discovery still inactive — with injected discoverClaudeSession returning {status:inactive, reason:not_claude}, the seam does NOT invoke startActiveSessionFlow, does NOT invoke teardown, and leaves state ready for the next tick (dormantLastEmitted:false so the state-change guard is satisfied for a future dormant:true re-emit if the sentinel comes back).
    - Test K (NEW): Wake reachability during dormant-poll — reuses __applyWakeMessageForTests with isIdentityShapedCached:true + non-null sshConn stub → returns {type:wake_result, ok:true} (regression guard: dormant-poll must not stomp isIdentityShapedCached or sshConn).
    - Existing dormant-poll tests A-F (patch #345) continue to pass unmodified.
  </behavior>

  <action>
    Implement bounty.json FIX §1-4 in src/backend/claude-session/claude-session-server.ts as four sub-steps.

    STEP 1 — Extract the active-flow start into a closure-scoped helper.
    Introduce a helper (name it startActiveSessionFlow — closure-scoped, NOT a module export) taking {pid:number, sessionFile:string, tmuxSession:string, hostId:number} that runs the block currently spanning lines ~3503-3841: emit {type:session, pid, sessionFile}, sshLogger.info tail-start, seed currentHostId/currentTmuxSession/currentSessionFile/sessionIdFromFile, start contextPctTimer (which carries the patch #345 dormancy piggyback for active panes — leave that untouched; see rationale below). The helper closes over the existing closure state (planPendingContentByPath, dormantInFlight, isIdentityShapedCached, etc.). Do NOT extract the aside subsystem block (lines ~3843+); leave that inline in both the initial-active path AND the dormant-wake-to-active path — at implementation time decide whether to invoke it from wake (probably yes, since aside was torn down; if so, guard against double-registration).

    Call sites: (a) initial-active path (line 3503) becomes startActiveSessionFlow({pid: result.pid, sessionFile: result.sessionFile, tmuxSession, hostId}); (b) dormant-poll re-discovery active branch (STEP 3) calls the same helper.

    STEP 2 — Restructure the inactive branch (lines 3484-3500) to probe dormancy BEFORE teardown.
    Flow:
      if (result.status === "inactive") {
        // Probe identity shape once (cache in closure-scoped isIdentityShapedCached).
        // Reuse the exact command from __applyDormantPollTickForTests line 946-950:
        //   test -d ~/.claude/identities/'${escapedName}'
        // Then if identity-shaped, stat the .dormant sentinel (reuse line 956-961 command):
        //   stat ~/.claude/identities/'${escapedName}'/.dormant 2>/dev/null >/dev/null && echo yes || echo no
        // If BOTH yield yes → this is a DORMANT pane, not a plain-inactive one:
        //   * emit {type:dormant, dormant:true} (seed dormantLastEmitted = true)
        //   * seed currentTmuxSession/currentHostId (dormant-poll needs them; also lets
        //     the wake handler at line 3389 accept the wake message)
        //   * start dormantPollTimer (STEP 3)
        //   * return WITHOUT running conn.end()/sshConn=null
        // Otherwise → fall through to existing emit-inactive + teardown (verbatim).
      }
    The probe MUST be inline+await (not the async-IIFE pattern) since the branch decision must be synchronous to know whether to teardown. If either probe SSH-throws, treat as "not dormant" and fall through to teardown (fail-safe: don't hold an SSH conn open on error). Log the transition via sshLogger.info with operation:"claude_session_dormant_entered" + hostId+tmuxSession.

    STEP 3 — Add the dormant-poll timer.
    Declare closure-scoped dormantPollTimer:NodeJS.Timeout|null=null + dormantPollInFlight=false alongside existing timer/flight vars (near line 1086-1098). In the dormant-branch startup (end of STEP 2), assign dormantPollTimer = setInterval(() => {...}, 3000). The interval IIFE:
    - Early-return if stopped || ws.readyState !== WebSocket.OPEN || !sshConn || dormantPollInFlight.
    - Set dormantPollInFlight = true; in try/finally that resets it:
      - stat the .dormant sentinel (same command as __applyDormantPollTickForTests line 956-961).
      - If still dormant (stat yields "yes") → emit-only-on-change (dormantLastEmitted guard); continue.
      - If NOT dormant (stat yields "no"): emit {type:dormant, dormant:false} (state-change guard); then invoke discoverClaudeSession(sshConn, currentTmuxSession).
        - If active → call startActiveSessionFlow({pid, sessionFile, tmuxSession: currentTmuxSession, hostId: currentHostId}); clear the dormantPollTimer (clearInterval + null) — from here the active flow's contextPctTimer takes over including the patch #345 dormancy piggyback.
        - If still inactive/not_claude → keep polling (dormantLastEmitted stays false; next tick will re-emit dormant:true if sentinel comes back). No teardown; do NOT clear dormant-poll timer.
        - If inactive/exec_error → treat as transient; keep polling.
    Add if (dormantPollTimer) { clearInterval(dormantPollTimer); dormantPollTimer = null; } inside teardownPane() alongside the existing contextPctTimer clear at line 1231-1233.

    STEP 4 — Extend the test seams for the new logic.
    Extend __applyDormantPollTickForTests (or add a sibling seam like __applyDormantPollWithRediscoveryForTests) so tests G-J can exercise the sentinel-disappearance-plus-rediscovery path with injectable discoverClaudeSession + startActiveSessionFlow callbacks. Cleanest shape: inject both as deps on the seam signature. Add tests G-K to dormant-poll.test.ts matching the <behavior> block, following the A-F patterns (vitest, fakeConn stub, wsSend spy, exec dispatcher). Do NOT modify tests A-F.

    RATIONALE — Keep patch #345's active-poll dormantInFlight piggyback AS-IS (do NOT delete it as dead code). Per constraint: "Patch #345 already added a dormantInFlight check in the ACTIVE poll cycle. This hotfix probably makes that active-poll check REDUNDANT... Recommend keeping for now (cheap, defensive, catches supervisor bugs), but note the reasoning in the plan." Reasoning: in normal operation the active-poll never sees .dormant present (supervisor invariant: dormancy-only-when-claude-dead), but if the supervisor ever races and drops .dormant while claude is still visible, the active-poll's stat catches it and emits dormant:true — the frontend's live-frame auto-dismiss will then correct back to dormant:false on the next live frame. Cost: one extra stat per 3s poll cycle per active pane. Value: defense against a supervisor invariant violation. Trade favors keeping.
  </action>

  <verify>
    <automated>bash -lc 'cd /home/ubuntu/skynet && npx vitest run src/backend/claude-session/dormant-poll.test.ts 2>&1 | tail -30'</automated>
  </verify>

  <done>
    - claude-session-server.ts has a closure-scoped startActiveSessionFlow helper (or equivalent named block) invoked from BOTH the initial-active path AND the dormant-poll wake path.
    - The inactive branch (line ~3484) probes identity-shape + .dormant sentinel BEFORE teardown; on dormant → emits {type:dormant, dormant:true} + starts dormant-poll timer + keeps sshConn alive; on non-dormant → falls through to existing teardown.
    - Dormant-poll timer (3s cadence, dormantPollInFlight guard, closure-scoped) polls the sentinel + on disappearance re-runs discovery + transitions to active via the helper.
    - dormantPollTimer is cleared in teardownPane().
    - Tests G-K added to dormant-poll.test.ts; all pass.
    - Tests A-F (patch #345) still pass.
    - npx vitest run src/backend/claude-session/dormant-poll.test.ts shows 11 pass / 0 fail (6 old + 5 new).
    - Patch #345's dormantInFlight active-poll check is unchanged (belt-and-suspenders; rationale in code comment + patch #346 entry).
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Frontend belt-and-suspenders gate + diag-registry isVisible tag-along</name>
  <files>src/ui/features/pretty-view/PrettyView.tsx</files>

  <action>
    Two one-line changes to src/ui/features/pretty-view/PrettyView.tsx.

    CHANGE 1 (belt-and-suspenders gate — bounty FRONTEND §):
    Line 1575: `{status === "inactive" && (` becomes `{status === "inactive" && !dormant && (`.
    Defensive: with the Task 1 backend change, `status` should never flip to "inactive" when a pane is dormant (backend emits {type:dormant} instead of {type:inactive}). But if a race lets both frames arrive (or a future backend regression sends the inactive frame anyway), the fallback text "no active Claude session" will stomp the DormancyOverlay. This gate ensures the DormancyOverlay wins. No new imports; `dormant` is already in scope at line 321 (`const [dormant, setDormant] = useState(false);`).

    CHANGE 2 (tag-along diag fix — bounty TAG-ALONG §):
    Line 1212: `isVisible: null,` becomes `isVisible,` (shorthand for isVisible: isVisible).
    The `isVisible` prop is destructured at line 189 and in scope inside the useEffect closure at line 1202. Patch #344 added the isVisible prop to PrettyView but the diag registry pretty-view snapshot was never updated; DIAG-REPORT logs currently show `isVisible: null` for every pretty-view pane. Diag-numbers-only cosmetic fix — no runtime behavior change, but Ashley's per-pane cost diag now correctly labels each pane as visible/hidden.

    Do NOT touch anything else in PrettyView.tsx. In particular, leave the existing DormancyOverlay mount at line 1561-1568 as-is (its independent mount gate on `dormant` is correct), and leave the live-frame auto-dismiss at line 707-722 as-is (it correctly handles the backend's {type:session} frame emitted by startActiveSessionFlow on wake).

    After the edit, run npx tsc --noEmit in the skynet root to prove TS still compiles.
  </action>

  <verify>
    <automated>bash -lc 'cd /home/ubuntu/skynet && npx tsc --noEmit 2>&1 | tail -20 && echo --- && grep -n "status === \"inactive\" && !dormant" src/ui/features/pretty-view/PrettyView.tsx && grep -nE "^\\s+isVisible,\\s*$" src/ui/features/pretty-view/PrettyView.tsx | head -5'</automated>
  </verify>

  <done>
    - PrettyView.tsx line ~1575 gate reads `status === "inactive" && !dormant`.
    - PrettyView.tsx line ~1212 snapshot field reads `isVisible,` (or explicit `isVisible: isVisibleRef.current`).
    - `npx tsc --noEmit` exits 0.
    - The two grep checks above return exactly one match each.
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Full test-suite + build + ship under 15-min deadman + HTTPS 200</name>
  <files>(no source files — build/ship pipeline)</files>

  <action>
    Ship path — execute in strict order; abort on any failure and report state.

    STEP A — Full test suite green.
    Run `npx vitest run` from /home/ubuntu/skynet root. Expected: baseline 1580+ pass / 6 skip / 0 fail preserved, PLUS the 5 new dormant-poll tests (G-K) from Task 1 land. New expected total: ~1585+ pass / 6 skip / 0 fail. If any test fails, do NOT proceed to ship — fix and re-run.

    STEP B — Backend + frontend build.
    Run `npm run build:backend` then `npm run build` (or the project's single `npm run build` if it covers both — inspect package.json before running). Both must exit 0. TS errors block ship.

    STEP C — Byte-verify the fix landed in the shipped bundle BEFORE recreate.
    Grep the built backend for the new symbols. At minimum: startActiveSessionFlow (or the extracted-helper name chosen in Task 1), dormantPollTimer, "claude_session_dormant_entered". If missing → the build didn't pick up the source; rebuild.

    STEP D — Ship via docker compose recreate under 15-min deadman.
    Follow the project's standard ship protocol per CLAUDE.md §Deploy safety: `docker compose up -d --force-recreate skynet` under the 15-min deadman rollback timer. NO EXCEPTIONS per Ashley 2026-07-03. After the recreate:
    - Confirm container status Up + healthy sustained (poll `docker compose ps skynet` for at least 30s past healthcheck window).
    - Confirm HTTPS 200 on term.gigaashley.click via `curl -sI https://term.gigaashley.click/ | head -5` — expect HTTP/2 200.
    - Byte-verify frontend bundle contains the two frontend changes: grep the built terminal JS for `!dormant` gate + confirm `isVisible: null` is GONE from the pretty-view snapshot (search for the diag emit shape).
    - If any check fails within the 15-min window, roll back per standard deadman procedure.
  </action>

  <verify>
    <automated>bash -lc 'cd /home/ubuntu/skynet && npx vitest run 2>&1 | tail -20 && echo --- && npm run build 2>&1 | tail -20 && echo --- && curl -sI https://term.gigaashley.click/ | head -5 && echo --- && docker compose ps skynet 2>&1 | tail -5'</automated>
  </verify>

  <done>
    - `npx vitest run` shows ≥1585 pass / 6 skip / 0 fail.
    - `npm run build` exits 0.
    - Shipped image byte-verified to contain startActiveSessionFlow + dormant-poll symbols + `!dormant` gate + non-null isVisible in pretty-view diag snapshot.
    - Container status: Up + healthy sustained past the healthcheck grace window.
    - `curl -sI https://term.gigaashley.click/` returns HTTP/2 200.
    - No deadman rollback fired.
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 4: Patch #346 entry in skynet-patches.md</name>
  <files>/home/ubuntu/.claude/roles/box-maintainer/skynet-patches.md</files>

  <action>
    Append a new section titled `### Patch #346 — Dormancy overlay never shows for dormant panes (inactive-branch fix + diag isVisible tag-along)` after the patch #345 entry. Follow the exact structure/tone/depth of the patch #345 entry already in the file (peek `tail -50` for the format template — same headings: SUMMARY / WHY / WHAT CHANGED / VERIFICATION / SHIP / REBASE RISK, same code-fence density, same commit-hash + image-sha + HTTPS-200 evidence pattern).

    Content must cover:
    - **Summary**: one paragraph — patch #345 shipped the overlay but the poll never fired for actually-dormant panes because it was piggybacked on the active-poll cycle which is short-circuited by the inactive-branch teardown. #346 moves the dormancy probe into the inactive branch, adds a dormant-poll loop that transitions to active flow on sentinel-disappearance via an extracted startActiveSessionFlow helper, adds a frontend belt-and-suspenders gate on the inactive fallback, and picks up a diag-registry `isVisible: null` regression from patch #344 as a tag-along.
    - **Why**: Ashley UAT on Tiffany at 2026-08-08T09:44:25Z — DormancyOverlay never appeared; PrettyView rendered "no active Claude session" instead. Root cause: discoverClaudeSession returns inactive/not_claude for a dormant pane, backend emits the inactive frame and tears SSH down, so the piggybacked dormancy stat check never runs.
    - **What changed**: enumerate the four sub-artifacts — (1) extracted startActiveSessionFlow helper in claude-session-server.ts, (2) inactive-branch dormancy probe + dormant-poll loop, (3) PrettyView belt-and-suspenders `!dormant` gate on the inactive fallback, (4) PrettyView diag snapshot `isVisible: null` → `isVisible` shorthand. Include the note about keeping patch #345's active-poll `dormantInFlight` piggyback AS-IS as defensive (rationale: catches supervisor race where .dormant reappears mid-active).
    - **Verification**: test count (baseline 1580+ pass / 6 skip → ~1585+ pass / 6 skip after G-K land); `tsc --noEmit` clean; `npm run build` clean.
    - **Ship**: image sha (paste from Task 3 build output), container health-sustained timestamp, HTTPS 200 confirmation on term.gigaashley.click, byte-verified symbols in shipped bundle (startActiveSessionFlow + dormantPollTimer + `!dormant` + non-null isVisible).
    - **Commits**: list the atomic commit hashes created for the backend restructure + tests + frontend two-liner + patch-doc.
    - **Rebase risk**: NIL — fork severed 2026-07-24, no upstream to rebase against (same disposition as patches #344 and #345).

    Do NOT commit yet — the standard box-maintainer flow commits the patches.md update separately after the code commits land (mirror the patch #345 flow at commit 1e4f5f0).
  </action>

  <verify>
    <automated>bash -lc 'grep -c "^### Patch #346" /home/ubuntu/.claude/roles/box-maintainer/skynet-patches.md && grep -A2 "^### Patch #346" /home/ubuntu/.claude/roles/box-maintainer/skynet-patches.md | head -10'</automated>
  </verify>

  <done>
    - `### Patch #346` heading appears exactly once in skynet-patches.md.
    - Entry follows the patch #345 structural template (SUMMARY / WHY / WHAT CHANGED / VERIFICATION / SHIP / COMMITS / REBASE RISK).
    - Ship metadata includes real image sha + HTTPS 200 evidence + byte-verified symbols from Task 3.
    - Rationale for keeping patch #345 active-poll dormant check is documented.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 5: Ashley UAT on Tiffany</name>
  <what-built>
    Backend inactive-branch dormancy probe + dormant-poll loop + extracted active-flow helper.
    Frontend belt-and-suspenders `!dormant` gate + diag `isVisible` tag-along.
    Shipped to term.gigaashley.click under 15-min deadman + HTTPS 200 confirmed.
    Patch #346 entry in skynet-patches.md.
  </what-built>
  <how-to-verify>
    1. Confirm Tiffany's identity is currently dormant on T1000: `ssh tailnet-of-t1000 'ls ~/.claude/identities/tiffany/.dormant && tmux ls | grep tiffany'` — sentinel present, tmux session alive at bare shell prompt. (If not dormant, either wait for supervisor to reconcile OR force it: `kill <claude-pid> && touch ~/.claude/identities/tiffany/.dormant`.)
    2. Open Ashley's PWA at term.gigaashley.click; navigate to Tiffany's pretty-view pane.
    3. EXPECT: DormancyOverlay appears with "session is asleep" text + Wake button. Static moon glyph (NO spin). ComposeBox disabled (Send/Reset/ThumbsUp/Recap/QueuedRow-Send all disabled; textarea + mic + attach still usable). The old "no active Claude session" text MUST NOT appear.
    4. Tap Wake. EXPECT: overlay transitions to "waking…" state; after ~15s the "this can take up to 60s" hint appears if wake hasn't completed. Within ~60s (30s supervisor CHECK_INTERVAL + 30s claude launch + /id run), overlay auto-dismisses and ComposeBox re-enables.
    5. Confirm normal chat works after wake.
    6. Bonus: check console DIAG-REPORT log — `isVisible` for the pretty-view pane should be `true` (or `false` if hidden), NOT `null`.
  </how-to-verify>
  <resume-signal>Ashley types "approved" or describes what she saw (which behavior differed, screenshots, console logs).</resume-signal>
</task>

</tasks>

<verification>
- Backend: `npx vitest run src/backend/claude-session/dormant-poll.test.ts` → 11 pass / 0 fail (6 old A-F + 5 new G-K).
- Full suite: `npx vitest run` → ≥1585 pass / 6 skip / 0 fail (baseline 1580 preserved + 5 new).
- Types: `npx tsc --noEmit` → exit 0.
- Build: `npm run build` → exit 0.
- Byte-verify (backend bundle): grep for `startActiveSessionFlow` OR the chosen helper name, `dormantPollTimer`, `claude_session_dormant_entered`.
- Byte-verify (frontend bundle): grep the built Terminal JS for `!dormant` gate + confirm `isVisible: null` is GONE from the pretty-view snapshot emit.
- Container health: `docker compose ps skynet` shows Up + healthy sustained past the healthcheck grace window; no deadman rollback fired.
- HTTPS: `curl -sI https://term.gigaashley.click/` returns HTTP/2 200.
- Patches doc: `### Patch #346` heading present exactly once in skynet-patches.md.
- Ashley UAT (blocking human checkpoint): DormancyOverlay appears on Tiffany's pane, Wake round-trips, overlay auto-dismisses on live-frame resume.
</verification>

<success_criteria>
- Dormant panes render the DormancyOverlay instead of "no active Claude session" (root fix of the patch #345 UAT failure).
- Wake round-trip works from Ashley's PWA on Tiffany.
- Auto-dismiss on wake completion works (live-frame auto-dismiss trips on the {type:session} frame emitted by startActiveSessionFlow).
- No test regressions; all 1580+ baseline tests still pass + 5 new tests added.
- Shipped under the 15-min deadman with HTTPS 200 + container health confirmed.
- Patch #346 entry landed in skynet-patches.md following the patch #345 format template.
- Ashley UAT signed off.
</success_criteria>

<output>
Create `.planning/quick/260808-dmz-dormancy-overlay-never-shows-for-dormant/260808-dmz-SUMMARY.md` when done, including:
- Bounty ID + title
- Files touched with commit hashes
- Test count delta (before → after)
- Ship metadata (image sha, container health timestamp, HTTPS 200 confirmation)
- Patch #346 entry link/reference
- Ashley UAT outcome
- Standing-directive follow-up: DMing Stacy question (bundled with #344 + #345 + #346)
</output>

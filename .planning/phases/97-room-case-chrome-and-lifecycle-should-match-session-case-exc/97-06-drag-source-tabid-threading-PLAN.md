---
phase: 97-room-case-chrome-and-lifecycle-should-match-session-case-exc
plan: 06
type: execute
wave: 3
depends_on:
  - 97-01
  - 97-02
  - 97-03
  - 97-04
files_modified:
  - src/ui/features/pretty-view/MultiBadgeAnchor.tsx
  - src/ui/features/pretty-view/AgentBadgeWithMeter.tsx
  - src/ui/features/pretty-view/PrettyView.tsx
autonomous: true
requirements:
  - F-2
  - D-05
  - D-18

must_haves:
  truths:
    - "In relay case: dragging any participant's IdentityBadge in MultiBadgeAnchor initiates a native HTML5 drag with dataTransfer `text/plain` set to the enclosing room tab's tabId AND `application/x-skynet-badge` set to `JSON.stringify({tabId})` — matching the harness single-badge drag-source contract at IdentityBadge.tsx:203-214."
    - "Dragging a room-showing surface's badge onto an empty split slot opens the room in that slot (D-05 drag-source direction)."
    - "D-18 badge-click no-op preserved in the relay case: MultiBadgeAnchor does not supply `onClick` to IdentityBadge; the drag-source contract (gated on `tabId && !isMobile` at IdentityBadge.tsx:82) is orthogonal to the click contract."
    - "Harness single-badge site at PrettyView.tsx:3539-3555 byte-untouched; existing `tabId={tabId}` pattern preserved."
  artifacts:
    - path: "src/ui/features/pretty-view/MultiBadgeAnchor.tsx"
      provides: "MultiBadgeAnchorProps.tabId?: string threaded to every IdentityBadge child (HumanBadgeCell + AgentBadgeCell + AgentBadgeWithMeter)"
      contains: "tabId?: string"
    - path: "src/ui/features/pretty-view/AgentBadgeWithMeter.tsx"
      provides: "AgentBadgeWithMeterProps.tabId?: string passed through to inner IdentityBadge"
      contains: "tabId?: string"
    - path: "src/ui/features/pretty-view/PrettyView.tsx"
      provides: "Relay-case MultiBadgeAnchor mount receives tabId={tabId}"
      contains: "tabId={tabId}"
  key_links:
    - from: "src/ui/features/pretty-view/PrettyView.tsx (relay MultiBadgeAnchor mount)"
      to: "each IdentityBadge inside MultiBadgeAnchor"
      via: "tabId prop threaded through MultiBadgeAnchor → HumanBadgeCell/AgentBadgeCell → IdentityBadge"
      pattern: "tabId=\\{tabId\\}"
---

<objective>
Thread the enclosing relay tab's `tabId` from `PrettyView.tsx` through `MultiBadgeAnchor.tsx` → `HumanBadgeCell` / `AgentBadgeCell` / `AgentBadgeWithMeter` → `IdentityBadge`, turning each per-participant badge in the room case into a drag SOURCE carrying the ROOM tab's tabId. Dragging any participant's badge drags the whole room tab (per D-05 "room-showing surface as drag source").

Purpose: Ship F-2, the second UAT blocker's drag-source half — IF Plan 01's discovery task resolved with Verdict A ("Plan 06 SHIPS — case-branch fill-in only"). In the shipped Phase 93 tree, the relay-case IdentityBadges in MultiBadgeAnchor.tsx:129 (`HumanBadgeCell`) and MultiBadgeAnchor.tsx:164 / AgentBadgeWithMeter.tsx:186 render `<IdentityBadge identityKey={identityKey} />` without `tabId`. IdentityBadge's `isDragSource = !!tabId && !isMobile` gate at L82 therefore evaluates to false; `draggable={false}`; the badge cannot initiate a drag. The harness case at PrettyView.tsx:3539-3555 explicitly passes `tabId={tabId}` — this plan mirrors that contract for the relay case.

CRITICAL: This plan SHIPS only if Plan 01's Task 4 checkpoint returned "approved verdict a" (case-branch fill-in only). If Task 4 returned "approved verdict b" (structural reshape required, F-2 splits out of Phase 97), THIS PLAN DOES NOT SHIP — F-2 gets its own follow-up phase per D-07 split-out gate. The orchestrator gates Plan 06 execution on the Plan 01 discovery verdict.

Output: three files touched — MultiBadgeAnchor.tsx gets a new optional `tabId` prop threaded through its two cell subcomponents; AgentBadgeWithMeter.tsx gets a new optional `tabId` prop passed through to its inner IdentityBadge; PrettyView.tsx's relay-case MultiBadgeAnchor mount at L3567-3576 adds `tabId={tabId}`.

Wave 3 because this plan touches MultiBadgeAnchor.tsx (also touched by Plan 01 F-4 gap change) + AgentBadgeWithMeter.tsx (also touched by Plan 04 drawer chrome) + PrettyView.tsx (also touched by Plan 02 F-1 veil effect + Plan 03 F-6 identityName). Sequential with all prior plans to avoid file-conflict races.
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
@.planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-01-SUMMARY.md
@.planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-01-DISCOVERY-NOTES.md
</context>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Client drag-source → SplitView drop target | dataTransfer payload (`text/plain` + `application/x-skynet-badge` MIME) crosses from IdentityBadge's onDragStart to SplitView's native drop handler; existing Phase 93 contract at IdentityBadge.tsx:203-214. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-97-06-01 | Tampering | Harness single-badge drag-source contract | mitigate | Zero change to PrettyView.tsx:3539-3555 (grep-verify the harness call site unchanged). Regression covered by existing PrettyView.test.tsx harness snapshots. |
| T-97-06-02 | Tampering | IdentityBadge primitive contract | mitigate | Zero change to IdentityBadge.tsx (scope discipline per Phase 93 D-18 + CONTEXT.md). The drag-source gate `isDragSource = !!tabId && !isMobile` at L82 is orthogonal to click-target contract — passing tabId enables drag without enabling click. |
| T-97-06-03 | Elevation of Privilege | Drag source claiming a tabId it does not own | accept | Drag source is client-local; the dropped tabId is looked up in the local tab set and the drop routes through onOpenSessionInTree which validates the tabId exists. No new auth surface; no cross-user reference. |
| T-97-06-SC | Tampering | package installs | accept | No package installs. |

Severity: LOW / none-new. Additive prop threading in an existing component tree; the drag-source primitive (IdentityBadge) is unchanged.
</threat_model>

<precondition>
This plan executes ONLY IF Plan 01 Task 4 returned "approved verdict a" (Plan 06 SHIPS — case-branch fill-in only). Verify by reading `.planning/phases/97-.../97-01-DISCOVERY-NOTES.md` and confirming it contains the string `VERDICT A` and `Plan 06 SHIPS`. If Plan 01 concluded with Verdict B, DO NOT execute this plan — return to the orchestrator with `## SKIPPED — F-2 SPLIT OUT PER D-07`. See Task 1's `<precondition_check>` gate.
</precondition>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Precondition check — Plan 01 discovery verdict A confirmed</name>
  <files>.planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-01-DISCOVERY-NOTES.md</files>
  <read_first>
    - .planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-01-DISCOVERY-NOTES.md (full file — verify verdict path)
    - .planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-01-SUMMARY.md (verdict rationale for cross-check)
  </read_first>
  <action>
    Read `.planning/phases/97-.../97-01-DISCOVERY-NOTES.md`. Verify it contains BOTH strings:
    - `VERDICT A`
    - `Plan 06 SHIPS`

    If both strings are present, this task passes and the plan proceeds to Task 2.

    If EITHER string is absent (Plan 01 concluded Verdict B, or discovery is incomplete), STOP execution of this plan. Return to the orchestrator with the message:

    ```
    ## SKIPPED — F-2 SPLIT OUT PER D-07

    Plan 01 Discovery Notes indicate <Verdict B | discovery incomplete>. Per CONTEXT D-07 split-out gate, F-2 does not ship in Phase 97. Follow-up phase for F-2 should be opened via /open. Plans 02, 03, 04, 05 shipped as planned; Plan 06 skipped.

    Discovery Notes path: .planning/phases/97-.../97-01-DISCOVERY-NOTES.md
    ```

    Do NOT modify any code files in this task. Do NOT proceed to Task 2 if the precondition check fails. Simply commit a no-op summary and stop.
  </action>
  <verify>
    <automated>
      grep -q 'VERDICT A' /home/ubuntu/skynet-taylor/.planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-01-DISCOVERY-NOTES.md && grep -q 'Plan 06 SHIPS' /home/ubuntu/skynet-taylor/.planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-01-DISCOVERY-NOTES.md
    </automated>
  </verify>
  <acceptance_criteria>
    - `.planning/phases/97-.../97-01-DISCOVERY-NOTES.md` contains the string `VERDICT A` (grep-verifiable).
    - Same file contains the string `Plan 06 SHIPS` (grep-verifiable).
    - If both above are satisfied, Task 2 executes.
    - If either is missing, plan halts here and reports SKIPPED to the orchestrator.
  </acceptance_criteria>
  <done>Verdict A confirmed → proceed to Task 2. OR: precondition failed → plan halts with SKIPPED status.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Thread tabId through MultiBadgeAnchor + AgentBadgeWithMeter + PrettyView</name>
  <files>
    src/ui/features/pretty-view/MultiBadgeAnchor.tsx,
    src/ui/features/pretty-view/AgentBadgeWithMeter.tsx,
    src/ui/features/pretty-view/PrettyView.tsx,
    src/ui/features/pretty-view/MultiBadgeAnchor.drag-source.test.tsx
  </files>
  <read_first>
    - src/ui/features/pretty-view/MultiBadgeAnchor.tsx (full 265 lines — specifically L64-94 for MultiBadgeAnchorProps, L115-132 for HumanBadgeCell, L140-185 for AgentBadgeCell — both fallback branch and AgentBadgeWithMeter branch, L195-264 for MultiBadgeAnchor render body; note that Plan 01 Task 2 changed L193's gap-1 token — that change is preserved and unrelated to this plan)
    - src/ui/features/pretty-view/AgentBadgeWithMeter.tsx (targeted read L80-105 for props + signature; L183-192 for the root cell + IdentityBadge mount at L186; note that Plan 04 wrapped L189-192's appendage in a drawer — that change is preserved and unrelated to this plan; the IdentityBadge mount at L186 is still adjacent to the drawer wrapper, not inside it)
    - src/ui/features/pretty-view/PrettyView.tsx (targeted reads: L3539-3555 for the harness single-badge site — the reference `tabId={tabId}` pattern to mirror; L3567-3576 for the relay-case MultiBadgeAnchor mount; L612 for the `tabId` state slot / prop in PrettyView's scope)
    - src/ui/features/terminal/IdentityBadge.tsx (targeted read L70-244: L82 for the `isDragSource = !!tabId && !isMobile` gate; L100-140 for the props interface with `tabId?: string`; L200-244 for the drag-source contract — dataTransfer `text/plain: tabId` + `application/x-skynet-badge: JSON.stringify({tabId})`; L230-233 for the long-press-timer clear inside onDragStart)
    - .planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-RESEARCH.md § "Finding 2" (fix approach; landmines about D-18 preservation, isMobile gate, dataTransfer MIME contract)
    - .planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-PATTERNS.md § "Finding 2 — MultiBadgeAnchor.tsx" + "AgentBadgeWithMeter.tsx" + "PrettyView.tsx" (all three subsections — extension shapes verbatim)
  </read_first>
  <behavior>
    - Test 1 (RED): Mount MultiBadgeAnchor with a `tabId="test-tab-123"` prop; assert that at least one rendered IdentityBadge inside receives `tabId="test-tab-123"` (query via a test-mocked IdentityBadge that records props, OR via the rendered element's draggable attribute being `true`).
    - Test 2 (RED): Mount MultiBadgeAnchor WITHOUT a tabId prop; assert IdentityBadges do NOT receive a tabId (draggable=false). This is the pre-plan behavior — regression check confirming the addition is opt-in.
    - Test 3 (RED): With a tabId prop, both HumanBadgeCell and AgentBadgeCell branches receive it. Mount with a mixed participant list (1 human + 1 agent with meter + 1 agent without meter/fallback branch) and assert every rendered IdentityBadge gets the tabId.
    - Test 4 (D-18 preservation): MultiBadgeAnchor with tabId does NOT pass `onClick` to any IdentityBadge (asserted via mock). Badge remains click-inert in the relay case; only drag-source is enabled.
    - Test 5 (integration): PrettyView mounted with `source.kind === "relay"` and a `tabId` on the tab passes that `tabId` through to MultiBadgeAnchor (assert via mocked MultiBadgeAnchor or by querying resulting `draggable` state on rendered IdentityBadges).
  </behavior>
  <action>
    Four files touched (three production + one test file). Execute in TDD order (tests first).

    **File 1: src/ui/features/pretty-view/MultiBadgeAnchor.tsx**

    1a. **Widen `MultiBadgeAnchorProps` at L64-94** — add optional `tabId`:

    ```
    export interface MultiBadgeAnchorProps {
      participants: { humans: HumanParticipant[]; agents: AgentParticipant[] };
      viewingUserMxid: string;
      fleetIdentityHosts: Record<string, number>;
      isReady: boolean;
      className?: string;
      /**
       * Phase 97 Finding 2: the enclosing relay tab's tabId. Threaded to
       * every per-participant IdentityBadge child so each badge becomes a
       * drag SOURCE carrying the ROOM tab's tabId (dragging any badge drags
       * the whole room tab, per D-05). Undefined → badges are not
       * drag-sourceable (parity with pre-Phase-97 behavior). D-18 preserved:
       * onClick is separately not-supplied by MultiBadgeAnchor, so click
       * remains inert; only drag-source is enabled by tabId presence.
       */
      tabId?: string;
    }
    ```

    1b. **Thread through `HumanBadgeCell` at L115-132**:

    Change the function signature to accept `tabId`:
    ```
    function HumanBadgeCell({ human, tabId }: { human: HumanParticipant; tabId?: string }) {
    ```

    Change the IdentityBadge mount at L129 from:
    ```
    <IdentityBadge identityKey={identityKey} />
    ```
    to:
    ```
    <IdentityBadge identityKey={identityKey} tabId={tabId} />
    ```

    1c. **Thread through `AgentBadgeCell` at L140-185** — both the fallback branch (L164) and the AgentBadgeWithMeter branch (L~178):

    Change the function signature:
    ```
    function AgentBadgeCell({ agent, fleetIdentityHosts, tabId }: { agent: AgentParticipant; fleetIdentityHosts: Record<string, number>; tabId?: string }) {
    ```

    In the fallback branch (when hostId is undefined), change the IdentityBadge mount at L164 from:
    ```
    <IdentityBadge identityKey={identityKey} />
    ```
    to:
    ```
    <IdentityBadge identityKey={identityKey} tabId={tabId} />
    ```

    In the AgentBadgeWithMeter branch, pass tabId to the wrapper:
    ```
    <AgentBadgeWithMeter
      identityKey={identityKey}
      mxid={agent.mxid}
      hostId={hostId}
      tmuxSessionName={identityKey}
      tabId={tabId}
    />
    ```

    1d. **Thread from `MultiBadgeAnchor` render body at L195-264**:

    Change the function signature:
    ```
    export function MultiBadgeAnchor({ participants, viewingUserMxid, fleetIdentityHosts, isReady, className, tabId }: MultiBadgeAnchorProps) {
    ```

    In the render body, pass `tabId` to both cell subcomponents:
    ```
    {agentsSorted.map((a) => (
      <AgentBadgeCell key={a.mxid} agent={a} fleetIdentityHosts={fleetIdentityHosts} tabId={tabId} />
    ))}
    {humansOther.map((h) => (
      <HumanBadgeCell key={h.mxid} human={h} tabId={tabId} />
    ))}
    ```

    Do NOT change: ROOT_ANCHOR_CLASS (Plan 01's gap-1 change preserved), sort discipline, loading placeholder, self-exclusion filter, `flex-row-reverse` layout, className prop merging (`cn(ROOT_ANCHOR_CLASS, className)`).

    **File 2: src/ui/features/pretty-view/AgentBadgeWithMeter.tsx**

    2a. **Widen `AgentBadgeWithMeterProps` at L80-96**:

    Add optional `tabId`:
    ```
    export interface AgentBadgeWithMeterProps {
      identityKey: string;
      mxid: string;
      hostId: number;
      tmuxSessionName: string;
      /** Phase 97 Finding 2: enclosing tab's tabId — drag-source pass-through to inner IdentityBadge. */
      tabId?: string;
    }
    ```

    2b. **Update the function signature at L100-105** to destructure `tabId`:
    ```
    export function AgentBadgeWithMeter({
      identityKey,
      mxid: _mxid,
      hostId,
      tmuxSessionName,
      tabId,
    }: AgentBadgeWithMeterProps) {
    ```

    2c. **Update the IdentityBadge mount at L186** (or its post-Plan-04 line number) from:
    ```
    <IdentityBadge identityKey={identityKey} />
    ```
    to:
    ```
    <IdentityBadge identityKey={identityKey} tabId={tabId} />
    ```

    Do NOT touch: the drawer wrapper (Plan 04's output — `data-drawer="true"`, `-mt-2`, `pt-[10px]`, `zIndex: 1`), the meter-well body (segments, reset button, band computation), the root cell class `relative flex flex-col items-center gap-1` at L183.

    **File 3: src/ui/features/pretty-view/PrettyView.tsx**

    3a. **Add `tabId={tabId}` at the relay-case MultiBadgeAnchor mount at L3567-3576.** Current shape (post-Plan-02, post-Plan-03 — the surrounding effects/props are those plans' territory; this task adds ONE prop to ONE JSX element):

    ```
    {source.kind === "relay" && (
      <MultiBadgeAnchor
        participants={
          chatSurfaceAdapter.participants ?? { humans: [], agents: [] }
        }
        viewingUserMxid={viewingUserMxid ?? ""}
        fleetIdentityHosts={fleetIdentityHosts}
        isReady={chatSurfaceAdapter.isReady}
      />
    )}
    ```

    Extended (add ONE prop after `isReady`):

    ```
    {source.kind === "relay" && (
      <MultiBadgeAnchor
        participants={
          chatSurfaceAdapter.participants ?? { humans: [], agents: [] }
        }
        viewingUserMxid={viewingUserMxid ?? ""}
        fleetIdentityHosts={fleetIdentityHosts}
        isReady={chatSurfaceAdapter.isReady}
        tabId={tabId}
      />
    )}
    ```

    Do NOT touch: the harness single-badge site at L3539-3555 (byte-untouched — its existing `tabId={tabId}` pattern is what this plan is mirroring), the veil-arm effects (Plan 02), the ComposeBox mount identityName case-branch (Plan 03), any other prop or logic in this file.

    **File 4: MultiBadgeAnchor.drag-source.test.tsx (NEW file)**

    Create the test file. Mirror the setup pattern from existing `MultiBadgeAnchor.test.tsx`. Add tests covering the 5 behaviors above (Test 1 through Test 5 in the `<behavior>` block). Use a mocked IdentityBadge that captures its props via a spy (or render the real IdentityBadge and query rendered attributes: `draggable`, `data-testid`).

    D-18 discipline: verify that MultiBadgeAnchor never passes an `onClick` prop to any IdentityBadge, regardless of tabId presence. The badge's click contract stays inert; only drag-source is enabled.

    Structured log discipline: no new logs added by this plan. IdentityBadge already emits a `[badge-drag]` log on drag-start (see IdentityBadge.tsx:240) — that log fires naturally once tabId is threaded, no new emit needed. Do NOT add a `[relay-badge-drag]` log despite RESEARCH § Finding 2 mentioning one — the existing `[badge-drag]` log suffices (RESEARCH's log is optional per its own text; keep this plan minimal).

    Landmines checklist:
    - IdentityBadge.tsx unchanged? Yes / No — `git diff --name-only src/ui/features/pretty-view/IdentityBadge.tsx` should return empty (or `git status` shows untouched).
    - PrettyView.tsx:3539-3555 (harness single-badge) unchanged? Yes / No — grep for the existing harness pattern; count unchanged.
    - `isMobile` gate at IdentityBadge.tsx:82 intact? Yes / No — read L82, confirm `isDragSource = !!tabId && !isMobile` still present.
    - dataTransfer MIME contract untouched? Yes / No — grep IdentityBadge.tsx for `application/x-skynet-badge` count = same as pre-plan.
    - D-18 preserved: MultiBadgeAnchor NEVER passes `onClick` to IdentityBadge? Yes / No — grep MultiBadgeAnchor.tsx for `onClick={` in the IdentityBadge mount lines = 0.
  </action>
  <verify>
    <automated>
      cd /home/ubuntu/skynet-taylor && \
      grep -q 'tabId\?: string' src/ui/features/pretty-view/MultiBadgeAnchor.tsx && \
      grep -q 'tabId\?: string' src/ui/features/pretty-view/AgentBadgeWithMeter.tsx && \
      (grep -c '<IdentityBadge identityKey={identityKey} tabId={tabId} />' src/ui/features/pretty-view/MultiBadgeAnchor.tsx | awk '$1 >= 2 { exit 0 } { exit 1 }') && \
      grep -q '<IdentityBadge identityKey={identityKey} tabId={tabId} />' src/ui/features/pretty-view/AgentBadgeWithMeter.tsx && \
      grep -q 'tabId={tabId}' src/ui/features/pretty-view/PrettyView.tsx && \
      (git diff --name-only src/ui/features/pretty-view/IdentityBadge.tsx | wc -l | grep -q '^0$') && \
      test -f src/ui/features/pretty-view/MultiBadgeAnchor.drag-source.test.tsx && \
      npx vitest run --related src/ui/features/pretty-view/MultiBadgeAnchor.tsx src/ui/features/pretty-view/AgentBadgeWithMeter.tsx src/ui/features/pretty-view/PrettyView.tsx 2>&1 | tee /tmp/97-06-vitest.log | grep -qE 'Tests +[0-9]+ passed'
    </automated>
  </verify>
  <acceptance_criteria>
    - MultiBadgeAnchor.tsx `MultiBadgeAnchorProps` interface contains `tabId?: string` (grep-verifiable).
    - MultiBadgeAnchor.tsx contains `<IdentityBadge identityKey={identityKey} tabId={tabId} />` at count >= 2 (HumanBadgeCell body + AgentBadgeCell fallback branch).
    - MultiBadgeAnchor.tsx passes `tabId={tabId}` to `<AgentBadgeWithMeter>` mount (grep-verifiable within the AgentBadgeCell function body).
    - MultiBadgeAnchor.tsx render body destructures `tabId` from props and passes it to both `AgentBadgeCell` and `HumanBadgeCell` invocations.
    - AgentBadgeWithMeter.tsx `AgentBadgeWithMeterProps` interface contains `tabId?: string`.
    - AgentBadgeWithMeter.tsx function signature destructures `tabId`.
    - AgentBadgeWithMeter.tsx `<IdentityBadge identityKey={identityKey} tabId={tabId} />` (single occurrence — the badge inside the meter-agent cell).
    - PrettyView.tsx relay-case MultiBadgeAnchor mount contains `tabId={tabId}` (grep-verifiable within a code region near the existing `source.kind === "relay"` gate).
    - IdentityBadge.tsx NOT modified — `git diff --name-only src/ui/features/pretty-view/IdentityBadge.tsx` returns empty.
    - MultiBadgeAnchor.tsx does NOT contain `onClick={` inside any IdentityBadge mount line (D-18 preserved — grep-verifiable).
    - MultiBadgeAnchor.drag-source.test.tsx exists and its Vitest run passes with all 5 behavior tests green.
    - Scoped Vitest across all three touched production files passes green.
    - Regression floor: PrettyView.tsx harness single-badge site at L3539-3555 unchanged (grep-verify the harness `<IdentityBadge identityKey={pvIdentityKey} hostId={hostId} onClick={...} onLongPress={...} tabId={tabId} onContextMenu={...} />` pattern present and unchanged).
  </acceptance_criteria>
  <done>MultiBadgeAnchor + AgentBadgeWithMeter + PrettyView all thread tabId through to per-participant IdentityBadges. IdentityBadge primitive untouched. D-18 preserved. All scoped tests green. Live drag-and-drop from a relay-showing surface works: dragging any participant badge initiates a drag with the room tab's tabId in dataTransfer.</done>
</task>

</tasks>

<verification>
- Task 1 precondition gate: DISCOVERY-NOTES.md contains VERDICT A + Plan 06 SHIPS.
- Task 2 grep gates confirm: tabId?: string in both props interfaces; tabId={tabId} threaded to every IdentityBadge site inside MultiBadgeAnchor + AgentBadgeWithMeter; tabId={tabId} at the relay MultiBadgeAnchor mount in PrettyView.
- IdentityBadge.tsx untouched (grep + git diff).
- Harness single-badge site at PrettyView.tsx:3539-3555 unchanged.
- D-18 preserved: no onClick on relay IdentityBadges.
- Live browser verification: open a relay room, drag any participant badge onto an empty split slot — the room opens in that slot. This confirms the drag-source contract functions end-to-end via the existing SplitView native drop-target listener.
</verification>

<success_criteria>
- MultiBadgeAnchor threads tabId through props to every IdentityBadge child.
- AgentBadgeWithMeter passes tabId through to inner IdentityBadge.
- PrettyView relay MultiBadgeAnchor mount passes tabId={tabId}.
- IdentityBadge primitive untouched.
- D-18 badge-click no-op preserved.
- New drag-source test file passes green with 5 behavior assertions.
- Live browser: dragging a relay-showing participant badge opens the room in an empty split slot.
- If precondition fails, plan halts with SKIPPED status; no code changes.
</success_criteria>

<output>
Create `.planning/phases/97-.../97-06-SUMMARY.md` when done. Include:
- Confirmation of precondition (Verdict A citation from Plan 01 notes)
- Live browser verification of drag-source end-to-end (participant badge → split slot → room opens)
- Confirmation that D-18 badge-click remains inert (click a badge, nothing happens)
- Whether the existing `[badge-drag]` log emits with the expected tabId when a relay badge is dragged
</output>

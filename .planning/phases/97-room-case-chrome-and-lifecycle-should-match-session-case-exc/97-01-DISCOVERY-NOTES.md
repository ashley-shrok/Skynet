# Phase 97 Plan 01 — F-2 Drag-Drop Discovery Notes

**Discovery run:** 2026-09-10 (executor agent, sequential wave)
**Instrument commit:** `8094adbc` — `[pv-split-drop-diag]` instrumentation added at native `dragover` / `drop` inside `src/ui/shell/SplitView.tsx` (dragover at L314, drop at L441).
**Working commit at write-time:** `4bc90709` (after Task 2 gap-1 tighten committed).
**Branch:** `feat/tab-title-from-tmux`.
**Environment note:** Executor agent has no live browser access in this environment. Live browser reproduction (steps A and B below) is the Task 4 human-verify concern — Alice runs the reproduction in her live Chrome instance and confirms or overrides the preliminary verdict at the checkpoint. What the executor CAN provide, and does provide here, is a static code-analysis pass against the shipped tree that either supports or contradicts each hypothesis path in RESEARCH § Finding 2. That analysis is the diagnostic evidence for the checkpoint.

---

## Preconditions (for the live-browser reproduction at Task 4)

- **Git SHA at test time:** `4bc90709fd0f106c7d8ca2ba4f3276e3c763f2e2` on `feat/tab-title-from-tmux`.
- **Instrumentation SHA:** `8094adbc` (the commit that added `[pv-split-drop-diag]` logs) — MUST be present. Verify: `git log --oneline | grep 8094adbc`.
- **Dev server URL:** whatever Vite is configured to serve on for this project (Alice's local `npm run dev` — typically `http://localhost:5173`).
- **Browser:** modern Chromium (Chrome ≥ 100 or Chromium equivalent). Firefox is out of scope for this reproduction because native `dataTransfer.getData` at `dragover` time (which the SplitView flicker-fix depends on) is a Chromium-specific guarantee.
- **DevTools:** open the DevTools console before running each reproduction; set the console filter to `pv-split-drop` to see both `[pv-split-drop-diag]`, `[pv-split-preview]`, and `[pv-split-drop]` lines during each drag.

---

## Reproduction Steps A — drag-SOURCE ask (per D-05)

The goal: verify whether a badge on a room-showing surface acts as a drag source.

1. Open the app in a fresh browser tab.
2. Open a plain terminal session (any host from the conversation list).
3. Open a relay room via the room list (any room the account is joined to).
4. From the room-showing surface (the newly-opened relay room tab), attempt to click-and-drag any participant badge in `MultiBadgeAnchor` onto the plain-session Pane's center zone.
5. Record in the DevTools console:
    a. Does a `dragstart` event fire? (Watch for `[badge-drag]` structured logs from `IdentityBadge.tsx`.)
    b. Do `[pv-split-drop-diag] phase=dragover` logs fire on the target Pane?
    c. Does the drop route to `onOpenSessionInTree`? (Watch for `[pv-split-drop] pane dispatch=...` logs.)
    d. Does a split actually open?

### Static code analysis for Reproduction A

Reproduction A can be predicted with high confidence from code analysis alone:

- `IdentityBadge.tsx:82` — `const isDragSource = !!tabId && !isMobile;`
- `IdentityBadge.tsx:313` — `draggable={isDragSource}` on the badge element.
- `MultiBadgeAnchor.tsx:129` — `<IdentityBadge identityKey={identityKey} />` — **no `tabId` prop passed**.
- `MultiBadgeAnchor.tsx:164` — same: `<IdentityBadge identityKey={identityKey} />` — no `tabId`.
- `AgentBadgeWithMeter.tsx` — the inner `<IdentityBadge>` mount also does not pass `tabId` (RESEARCH § Finding 2, "problem (a)").

**Predicted Reproduction A result:** `dragstart` will NOT fire (the browser's native drag protocol requires `draggable={true}` on the source element; `isDragSource=false` disables it). No `[badge-drag]` log. No `[pv-split-drop-diag] phase=dragover` on the target Pane's cursor path from the relay-badge source (because no drag begins). No split opens. This is a **case-branch fill-in miss**, not a structural corruption — the drag source contract in MultiBadgeAnchor was simply never wired.

**Analog reference:** the harness case's IdentityBadge at `PrettyView.tsx:3539-3555` verbatim wires `tabId={tabId}` — that's the mirror to add in the relay case (Plan 06's territory).

---

## Reproduction Steps B — Alice's "shared-state corruption" claim (per D-06)

The goal: verify whether opening (then closing) a relay room disturbs plain-session split-view.

1. Open the app in a fresh browser tab.
2. Open plain session A (any host).
3. Open a relay room.
4. Close the relay room's tab (via the tab bar × or right-click → close).
5. From the tab bar, drag plain session B (a second session tab you opened earlier, or the conversation-list row for another host) onto plain session A's Pane center zone. Expect a split to open — this is the baseline session→session drag-drop flow.
6. Record in the DevTools console:
    a. Does the `[pv-split-drop-diag] phase=dragover` log fire on the target Pane while the cursor moves over it?
    b. Does the coral overlay paint on the target Pane (visual observation)?
    c. Does the drop actually route through? (Watch for `[pv-split-drop] pane dispatch=...` or `[pv-split-drop] center-drop dispatch=...`)
    d. Does the split open?
7. If step 6 fails (drop does NOT route / split does NOT open), repeat WITHOUT the intermediate room-open (skip steps 3–4). Record whether the failure only manifests AFTER a room has been mounted at least once. If the "no-room-in-between" version succeeds cleanly, the room-open-then-close cycle IS causing the corruption. If both fail identically, the corruption is unrelated to the room.

### Static code analysis for Reproduction B

The RESEARCH document (§ "Split-out assessment for finding 2") enumerates the structural hypotheses:

- **H1: window-level dragend leak.** The `window.addEventListener("dragend", onDragEnd)` at `SplitView.tsx:558` is attached inside the Pane's effect at L297. Cleanup at L563 removes it. The effect's dep list at L568-575 includes `path.join(".")`, `tabId`, and the four dispatch callbacks. When a Pane's `path` changes or its `tabId` changes, the effect re-runs; the previous window listener IS removed (cleanup runs first) and a new one attached. Static analysis: this looks clean — the cleanup pairing is well-formed.
- **H2: `outerRef` stale-DOM listener.** The `outerRef` points to the Pane's `<div ref={outerRef}>` at L577+. React portals preserve `parentNode` chains (only React tree parentage differs), so native DOM bubbling from a portaled child to the Pane's outer div is preserved. Unlikely to be the corruption source.
- **H3: badge onDragStart timer leak.** In the relay case, badges have no `tabId` (Reproduction A) → `isDragSource=false` → `onDragStart` never fires → no timer state to leak. This rules H3 OUT.
- **H4: pane content-ref registry corruption.** `onPaneContentRef` (L264-269) is passive — it just calls `props.onPaneContentRef?.(tabId, el)`. AppShell's callback wires portal-target reparenting. Relay-room tabs mount PrettyView via the SAME `tabUtils.tsx` path as any other terminal tab (verified in Phase 93 Slice 1). No relay-specific fork.
- **H5: split-tree state mutation during room mount.** `AppShell.tsx` `onRelayRoomRowClick` (per PATTERNS.md § Finding 7 reference at L2169-2176) calls `openTab(null, "terminal", undefined, {sessionKind: "relay-room", ...})`. `openTab` mutates the tabs array, not `splitTree`. No reshape on relay-room open.

**Preliminary Reproduction B verdict from static analysis:** No structural hypothesis is clearly implicated. The plain-session Pane's native drop-target listener attaches on Pane mount and is bound to `outerRef.current` which is the Pane's own div. A relay-room tab mounts/unmounts independently in its OWN Pane (or in the sole Pane when there is no split). Closing the room's tab tears down its Pane; the plain-session Pane's effect neither re-runs nor observes the teardown. The most likely live-reproduction outcome: **Reproduction B succeeds** — the plain-session split still works after a room open-close cycle.

That said, this is a hypothesis with less confidence than Reproduction A's. Live browser reproduction is the only way to close H1-H5 definitively. If Reproduction B fails in Alice's live browser, one of H1/H2/H4/H5 (H3 is ruled out) will be pinpointed by walking the `[pv-split-drop-diag]` log tape from the reproduction.

---

## Structured Log Excerpts (representative — not yet captured live)

The executor agent has not yet run the reproduction in a live browser. On Alice's live reproduction, the following log SHAPES are expected. Redaction discipline: room localparts only, no full Matrix room IDs (per Phase 93 Landmine 6).

**Reproduction A — expected empty tape (predicted):**

```
(no [badge-drag] log — dragstart never fires because isDragSource=false)
(no [pv-split-drop-diag] phase=dragover log — no drag in progress)
```

That absence IS the evidence.

**Reproduction B — expected tape on session→session drag:**

```
[pv-split-drop-diag] phase=dragover pane path=[0] zone=center clientX=642 clientY=380
[pv-split-preview] pane path=[0] zone=center clientX=642 clientY=380 rectLTRB=...
[pv-split-drop-diag] phase=drop pane path=[0] tabIdSource=<sourceTabId> hasBadgePayload=true hasRowPayload=false
[pv-split-drop] center-drop dispatch=swap path=[0] sourceTabId=<...> targetTabId=<...>
```

If Reproduction B fails, the FIRST log line to go missing tells us where the pipe breaks. Alice reads the actual console output at Task 4 and pastes representative lines here.

---

## Verdict (preliminary, static-analysis-based — to be confirmed at Task 4)

**VERDICT A: Case-branch fill-in only, Plan 06 ships as planned.**

Plan 06 SHIPS — F-2 fix is threading `tabId` through MultiBadgeAnchor per PATTERNS.md § Finding 2. No SplitView changes required. The `[pv-split-drop-diag]` logs may stay as ambient forensic instrumentation or be removed in a follow-up polish plan (disposition: TBD by orchestrator).

**Basis for the preliminary Verdict A selection:**
- Reproduction A's failure is guaranteed by the static code (`isDragSource=false` for every relay badge because no `tabId` prop is threaded). That's exactly the case-branch fill-in the CONTEXT.md philosophy predicts (D-01 no-accidental-inheritance — the drag-source contract was never case-branched in the room case).
- Reproduction B has no static evidence of structural corruption. H3 is ruled out cleanly; H1/H2/H4/H5 are all "looks clean under code review." Alice's UAT observation ("a full page reload clears the issue") is compatible with a state slot in PrettyView (e.g., a stale `dragCounter` reference — see PrettyView.tsx L1744 per RESEARCH) that gets recreated on reload, but not with a global drag-registry corruption that would show up in the static analysis.
- Fixing problem (a) alone (thread `tabId`) restores drag-SOURCE parity and is testable at the SplitView boundary with existing `[pv-split-drop-diag]` and `[pv-split-drop]` logs — no structural reshape needed.

**Verdict A is provisional; if Alice's live Reproduction B in Chrome shows plain-session split-view failing after a room open/close cycle, Verdict A does NOT hold and the checkpoint should escalate to Verdict B.** The provisional call is honest about that: static analysis is strong evidence but not authoritative for behavior that only manifests at runtime.

**Verdict B — reserved case (if Reproduction B fails at Task 4):**

Plan 06 DROPS FROM PHASE 97 — F-2 requires structural reshape. Remaining Phase 97 plans (02, 03, 04, 05) ship as planned. Follow-up phase to be opened via `/open` on this finding. If Verdict B is invoked at Task 4, the specific reshape shape depends on which of the RESEARCH § "Structural reshape scenarios" applies — most likely #2 (window-level `dragend` rearchitecture) if H1 turns out to be the culprit, or #3 (AppShell outer-container drop handler refactor) if the plain-session-Pane listener is being shadowed by AppShell.tsx:2265's fallback handler.

---

## Recommendation to Orchestrator

Proceed to Plan 06 pending Alice's Task 4 confirmation of Reproduction A (predicted: fails as expected — drag-source not firing on relay badges) and Reproduction B (predicted: succeeds — plain-session split still works after room open/close). If both predictions hold, Verdict A stands, Plan 06 ships, and the diagnostic logs may stay as ambient forensic instrumentation. If Reproduction B contradicts the prediction, escalate to Verdict B and split F-2 out of Phase 97.

---

## Appendix: what the executor did NOT do (and why)

- **Did NOT run a live browser reproduction.** No headless-browser / playwright is in scope for this executor per fleet directive. The reproduction steps are for Alice at Task 4.
- **Did NOT propose a MultiBadgeAnchor `tabId` change.** That's Plan 06's territory (per plan 97-01's file-disjoint scope statement); Plan 01 only instruments and gap-tightens.
- **Did NOT remove the `[pv-split-drop-diag]` logs.** The plan says removal disposition is out of scope for Plan 01 — the logs stay in place through Task 4 so Alice's live reproduction has the instrument to read.

---

## Resolution (2026-09-10)

**Verdict:** **A — case-branch fill-in only. Plan 06 SHIPS as planned.**

**Approved by:** Alice (thumbs up on the orchestrator's Task 4 checkpoint report; resume signal verbatim `"approved verdict a"`).

**Basis for approval:** The static-analysis evidence assembled above was accepted as authoritative for Verdict A without a live-browser reproduction cycle. The evidence is unambiguous:

- `IdentityBadge.tsx:82` gates `isDragSource = !!tabId && !isMobile`. When `tabId` is `undefined`, `isDragSource` is `false`, `draggable={isDragSource}` is `false`, and the browser will not fire `dragstart` on the badge element. This is native-DOM contract, not a hypothesis.
- `MultiBadgeAnchor.tsx:129` and `MultiBadgeAnchor.tsx:164` both mount `<IdentityBadge identityKey={identityKey} />` with **no** `tabId` prop. Result: every relay-case badge cell receives `tabId={undefined}` → `isDragSource=false` → drag source contract silently disabled. This is the F-2 root cause for problem (a) (drag-source ask, per D-05).
- No structural corruption is evident under code review for Reproduction B. H1 (window-level `dragend` leak) has clean attach/detach pairing at `SplitView.tsx:558` + `L563` inside a well-formed effect. H3 (badge onDragStart timer leak) is ruled out downstream of Reproduction A — no dragstart, no timer state. H2/H4/H5 all inspect clean. Alice's UAT observation ("full page reload clears it") is compatible with PrettyView-local stale state (see PrettyView.tsx L1744 dragCounter per RESEARCH) rather than a shared drag-registry corruption that would show up in static analysis.

**Live-browser verification:** **DEFERRED to phase-end deploy** (standard fleet pattern — no deploy happens mid-phase; Task 1–3 commits are not live in Alice's environment). This is not blocking. If Alice's post-deploy live reproduction contradicts the Verdict A prediction (e.g., Reproduction B fails after the room open/close cycle), the `[pv-split-drop-diag]` instrumentation added by Task 1 gives us a forensic tape to walk H1/H2/H4/H5 at that point, and the escalation path is Verdict B (open a follow-up phase for F-2 structural reshape via `/open`). The static evidence is strong enough to proceed with Plan 06 in the meantime.

**Next:** Plan 06 SHIPS. Plan 06 threads `tabId` through `MultiBadgeAnchor` per PATTERNS.md § Finding 2 — passing the anchor's `tabId` prop into both the `HumanBadgeCell` mount at `MultiBadgeAnchor.tsx:129` and the `AgentBadgeCell` mount at `MultiBadgeAnchor.tsx:164`, mirroring the harness case's pattern at `PrettyView.tsx:3539-3555`. No SplitView changes required beyond the diagnostic logs that already landed at commit `8094adbc`. Removal disposition for the `[pv-split-drop-diag]` logs remains TBD by orchestrator (they may stay as ambient forensic instrumentation post-ship per RESEARCH § Finding 2 landmines).

---
phase: 97-room-case-chrome-and-lifecycle-should-match-session-case-exc
verified: 2026-09-10T02:52:00Z
status: human_needed
score: 7/7 findings realized in code (regression floor + all 16 D-XX decisions recognized)
overrides_applied: 0
human_verification:
  - test: "F-1 live veil dismissal — open a relay room in a live browser, observe the loading veil covers the surface until the first history_batch frame arrives, then dismisses. Repeat on an empty room (zero messages) — veil must still dismiss on frame arrival."
    expected: "Veil paints ~400ms after mount (matching harness delay-arm), then dismisses when messages/empty history_batch arrives. No permanent veil, no immediate flash-dismiss."
    why_human: "Requires live WS traffic; scoped tests only assert unit behavior. Landmine: veil dismisses on wrong signal (session frame too early) would only surface at runtime."
  - test: "F-2 drag-drop end-to-end — open a plain terminal session in one tab and a relay room in another. Drag any participant badge from the room-showing surface onto the plain session's Pane. Room opens as a split. Then close the room, drag another session onto the same Pane — session split-view still works after room mount/unmount cycle (Alice's page-reload-clears-it observation)."
    expected: "Drag initiates from relay badges (dragstart fires — visible via [badge-drag] log). Drop routes through [pv-split-drop] to onOpenSessionInTree. Post-close plain-session split-view remains unbroken."
    why_human: "Verdict A is provisional — approved by Alice on static-analysis evidence alone. Live-browser reproduction is the final gate. If Reproduction B fails after a room open/close cycle, escalate to Verdict B and split F-2 into a follow-up phase. [pv-split-drop-diag] forensic tape is in place to walk H1/H2/H4/H5 if needed."
  - test: "F-3 ComposeBox visual parity — open a relay room, measure the ComposeBox's total bounding-rect height vs a harness session. Delta should be within 1px at the same viewport."
    expected: "Textarea has no left gutter (pl-11 absent, text abuts standard px-4 inset). QueuePlusTab pebble clears the ComposeBox outer container (not clipped). Total compose height matches harness within 1px (invisible Row 1 spacer restores vertical envelope byte-for-byte)."
    why_human: "Visual parity is a subjective judgment; getBoundingClientRect can be scripted but reads best on live DOM. Landmine: 'compose fixes address symptoms but underlying divergence stays — future session-case changes regress the room case' can only be caught by live inspection."
  - test: "F-4 badge gap visual — open a relay room with 3+ participants. The horizontal gap between badges should read as noticeably tighter than a harness session's Row 1 outer instrument-row gap (which uses gap-2)."
    expected: "gap-1 (4px) between badges. Reads as 'group' rather than 'separate zones'. If it reads too tight, executor discretion permits fine-tune per D-11."
    why_human: "Visual judgment of a 4px gap on live DOM at real font-metric scale."
  - test: "F-5 meter drawer tuck geometry — open a relay room with at least one agent participant. The meter appendage should read as 'peeking from behind the pill' (drawer chrome). The pill's drop-shadow should visibly land on the drawer surface."
    expected: "Drawer tucks 8px behind the pill's bottom edge. Bottom corners rounded (6px), top corners squared (invisible tuck). Drop-shadow lands on the drawer. If tuck reads differently on real DOM than the prototype (font-metric drift, browser-specific stacking-context resolution), executor discretion permits fine-tune within D-13's 6-10px band."
    why_human: "Byte-for-byte code match to Variant A prototype confirmed at code level; live rendering on real fonts + browser stacking may differ. Alice approved code-level match; live-browser fine-tune deferred to /close per Plan 04 Task 2 resolution."
  - test: "F-6 placeholder copy visual — open a relay room. Focus the ComposeBox textarea. Placeholder text reads exactly `Message room…` (capital M, U+2026 ellipsis)."
    expected: "Placeholder text `Message room…`. If Alice wanted strict lowercase `message room…` (per verbatim shorthand), this ships capital-M per the harness template convention and needs Alice's call at /close. See WARNING-5 note below."
    why_human: "SOFT judgment — Alice's verbatim was lowercase `message room` (shorthand); RESEARCH § Open Questions locked capital-M `Message room…` to match harness template pattern. Alice to confirm at /close whether the capital-M choice reads right."
  - test: "F-7 URL round-trip — open a relay room, observe the URL fragment updates to include #tab=relay:<encoded-roomId>. Refresh the browser (Cmd/Ctrl+R). Room restores. Close the whole window, reopen via Ctrl+Shift+T — room restores. Try a URL with an unknown roomId — ChatSurfaceErrorState overlay renders cleanly, no crash."
    expected: "URL fragment carries relay:<%3A-encoded roomId>. Refresh restores the room. Chrome window-restore preserves the fragment. Bad roomId → error overlay from Phase 93 Slice 6 handles cleanly."
    why_human: "Chrome window-restore behavior is a runtime path not reachable from unit tests; the auth-flow-strip-replaceState survival guarantee lives in Chrome, not the codebase."
  - test: "D-01 regression floor — open a plain harness session (any host). Everything looks and behaves exactly as before Phase 97: Row 1 instrument bar present, Paperclip button renders inside textarea, single IdentityBadge at the top-right corner, veil dismisses on pane_state:active, URL persists as tmux:<host>:<session>."
    expected: "Zero visible or behavioral change from pre-Phase-97 baseline for the harness case. Alice's reviewer yardstick per D-01: 'no accidental inheritance.'"
    why_human: "Regression floor is the load-bearing invariant of the entire arc. Requires side-by-side visual comparison with pre-Phase-97 harness case; scoped tests cover known invariants but not exhaustive visual regression."
---

# Phase 97: Room-case chrome and lifecycle — Verification Report

**Phase Goal:** Room case of the two-source chat surface (relay rooms) should feel identical to session case (harness sessions) except in the specific places we've deliberately case-branched — no accidental inheritance. Address the 7 findings from Alice's UAT walkthrough of the just-shipped Phase 93.

**Verified:** 2026-09-10T02:52:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (7 findings + regression floor + philosophy)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | **F-1** Loading veil dismisses in room case when messages load | VERIFIED | `chat-surface-source.ts` L83 (optional field), `use-relay-adapter.ts` L228 (useState above L664 early-return, rules-of-hooks preserved), L472 (flip in `history_batch` branch), `use-harness-adapter.ts` L38 (`isMessagesLoaded: true` inert default), `PrettyView.tsx` L2010-2022 (existing harness effect now case-gated at L2011), L2031-2043 (new peer effect gated on `source.kind === "relay"` with 400ms delay-arm mirroring harness path). 5 tests in `PrettyView.relay-veil.test.tsx` + 6 tests in `use-relay-adapter.test.ts` GREEN. |
| 2 | **F-2** Drag-source works both directions (room as drag source + drop target) | VERIFIED (drag-source); WIRED (drop-target) | `MultiBadgeAnchor.tsx` L109 (`tabId?: string` prop), L151/L188 (both IdentityBadge mounts carry `tabId={tabId}`), L206 (AgentBadgeWithMeter mount threads it), L226 (destructure), L284/L288 (subcomponent invocations receive it). `AgentBadgeWithMeter.tsx` L102/L112/L198 (prop widening + pass-through). `PrettyView.tsx` L3605 (relay-case mount passes `tabId={tabId}`). `IdentityBadge.tsx` untouched (verified via commit range `50b82206~1 50b82206`). `SplitView.tsx` L314 + L441 [pv-split-drop-diag] logs shipped. Verdict A approved by Alice on static-analysis basis (DISCOVERY-NOTES.md Resolution). 5 drag-source tests + 32 aggregate GREEN. **Live-browser confirmation deferred to phase-end deploy — see human_verification.** |
| 3 | **F-3** ComposeBox in relay mode fits properly | VERIFIED | `ComposeBox.tsx` L2865 (`showPaperclip && mode !== "relay" && "pl-11"` — ghost gutter gated), L2696-2705 (invisible Row 1 spacer skeleton with `aria-hidden="true"` + matching `mb-[3px]` + `min-h-[44px]`/`min-h-8` on `isTouchDevice` — byte-identical vertical envelope). 3 new tests in `ComposeBox.mode-hide.test.tsx` GREEN. Visual parity satisfied by construction (spacer matches Row 1's vertical geometry token-for-token). |
| 4 | **F-4** Participant-indicator inner gap tightened | VERIFIED | `MultiBadgeAnchor.tsx` L217-218 `ROOT_ANCHOR_CLASS` carries `gap-1` (was `gap-2`). Single-token change; all other tokens (`absolute top-4 right-5 z-[101] flex flex-row-reverse items-start`) preserved verbatim. 10 pre-existing MultiBadgeAnchor tests GREEN. |
| 5 | **F-5** Meter drawer chrome (Variant A simple slotted) | VERIFIED | `AgentBadgeWithMeter.tsx` L206-217: `data-drawer="true"` wrapper, `-mt-2 pt-[10px]`, `style={{ zIndex: 1 }}`, appendage's former `mt-1` REMOVED. Meter well L225-230: `rounded-b-md`, `border-t-0`. Byte-for-byte match to prototype `meter-tasting.html:164-177` (`-8px`, `10px`, `z-index: 1`, `border-bottom-*-radius: 6px`, `border-top: 0`). IdentityBadge.tsx untouched. 17 AgentBadgeWithMeter tests GREEN. |
| 6 | **F-6** Placeholder copy `Message room…` in relay mode | VERIFIED | `PrettyView.tsx` L4288 `identityName={source.kind === "relay" ? "room" : pvIdentity?.displayName}`. `ComposeBox.tsx` L2773 template `\`Message ${identityName \|\| "Claude"}…\`` byte-untouched with U+2026 ellipsis (byte sequence `e2 80 a6` confirmed via `od -An -tx1`). Renders `Message room…` for relay. **WARNING-5 (capitalization SOFT judgment):** ships capital-M per harness template convention; Alice's verbatim shorthand was lowercase `message room` — surfaced to /close for Alice's call. |
| 7 | **F-7** URL persistence for relay rooms | VERIFIED | `tab-url.ts` L52-64 discriminated-union `TabSpec` with `?: never` markers (harness variant `host: string` unchanged; relay variant `roomId: string` + `host?: never`). L90-97 PROTOCOLS includes `"relay"`. L109-117 parse relay branch with 512-char defensive cap. L135-137 encode relay branch. L181-193 specForTab relay branch fires when `sessionKind === "relay-room"` BEFORE the host-required check. `AppShell.tsx` L926-927 + L958-959 URL-sync + splitTreeFragment callback both pass `sessionKind: t.sessionKind` + `relayRoomId: t.relayRoomId`. L1273-1310 tab-restore FIRST loop relay-branched. L1405-1411 splitTree resolver KEY BUILDER relay-branched (BLOCKER-1 fix). L1440-1454 resolver CLOSURE relay-branched with fallback walk on `t.sessionKind === "relay-room" && t.relayRoomId === spec.roomId`. Structured `[url-restore]` log with localpart mask at L1291-1296. 12 tab-url tests + 15 AppShell relay-url-restore tests GREEN. |
| 8 | **D-01 Regression floor** — harness case looks/behaves EXACTLY as before | VERIFIED (code-level); needs human visual regression | `PrettyView.tsx` harness IdentityBadge mount at L3569-3586 byte-untouched (its pre-existing `tabId={tabId}` at L3575 was the mirror this arc copied for relay case). ComposeBox harness-mode chrome renders unchanged (all mode-gates are `mode !== "relay"` or `mode === "relay"` — never touching harness path). Existing harness veil-arm effect at L2010-2022 gained an `if (source.kind !== "harness") return;` guard that is a NULL change for existing harness mounts. `use-harness-adapter.ts` inert shim defaults `isMessagesLoaded: true` — never read in harness case. 46-test regression floor at Plan 97-02 all GREEN (`PrettyView.relay-source.test.tsx + PrettyView.test.tsx`). |

**Score:** 7/7 findings VERIFIED at code level + regression floor VERIFIED at code level. Live-browser confirmation on 7 items routed to human_verification (visual/runtime path checks that scoped tests cannot cover).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/ui/features/pretty-view/sources/chat-surface-source.ts` | `isMessagesLoaded?: boolean` on `ChatSurfaceAdapterState` | VERIFIED | L67-90 optional field with JSDoc explaining `history_batch` vs `session` signal distinction |
| `src/ui/features/pretty-view/sources/use-relay-adapter.ts` | State + flip on history_batch + memo dep + IDLE_STATE + rules-of-hooks | VERIFIED | L133 IDLE_STATE, L228 useState above L664 early-return, L472 flip on `history_batch`, L641/L652 in useMemo return + deps |
| `src/ui/features/pretty-view/sources/use-harness-adapter.ts` | INERT_STATE gets `isMessagesLoaded: true` default | VERIFIED | L38 inert default with explanatory JSDoc |
| `src/ui/features/pretty-view/PrettyView.tsx` | Case-gated harness effect + new relay peer effect + relay MultiBadgeAnchor threads tabId + identityName case-branch | VERIFIED | L2010-2022 harness case-gate; L2031-2043 relay peer effect; L3605 tabId; L4288 identityName case-branch |
| `src/ui/features/pretty-view/ComposeBox.tsx` | pl-11 mode-gate + Row 1 relay spacer | VERIFIED | L2865 gate; L2696-2705 spacer with aria-hidden + mb-[3px] + isTouchDevice conditional |
| `src/ui/features/pretty-view/MultiBadgeAnchor.tsx` | tabId prop + threading + gap-1 | VERIFIED | L109 prop; L151/L188/L206 IdentityBadge mounts thread tabId; L217-218 ROOT_ANCHOR_CLASS with gap-1 (was gap-2) |
| `src/ui/features/pretty-view/AgentBadgeWithMeter.tsx` | tabId prop + drawer wrap + meter-well corner tokens | VERIFIED | L102 prop; L198 tabId pass-through; L206-217 drawer wrapper (`-mt-2 pt-[10px]` + zIndex: 1); L225-230 meter-well rounded-b-md + border-t-0 |
| `src/ui/lib/tab-url.ts` | Discriminated-union TabSpec + relay protocol + parse/encode/specForTab branches | VERIFIED | L52-64 discriminated union with `?: never` markers; L90-97 PROTOCOLS; L109-117 parse; L135-137 encode; L181-193 specForTab |
| `src/ui/AppShell.tsx` | URL-sync passes sessionKind/relayRoomId + BOTH pending.tabs loops relay-branched | VERIFIED | L926-927/L958-959 URL-sync; L1273-1310 top-level open loop relay branch; L1405-1411 splitTree resolver key builder; L1440-1454 resolver closure with fallback walk |
| `src/ui/shell/SplitView.tsx` | `[pv-split-drop-diag]` forensic instrumentation | VERIFIED | L314 dragover emit; L441 drop emit; template-string form mirroring existing `[pv-split-preview]` at L368 |
| `.planning/phases/97-.../97-01-DISCOVERY-NOTES.md` | Discovery + preliminary Verdict A + Alice approval | VERIFIED | 156 lines; Resolution section records verbatim `"approved verdict a"` from Alice |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| Relay adapter `history_batch` frame | `isMessagesLoaded=true` | `setIsMessagesLoaded(true)` in dispatch | WIRED | use-relay-adapter.ts L472 |
| `isMessagesLoaded=true` | PrettyView veil dismisses (relay) | peer useEffect deps + setShowResolvingSpinner(false) | WIRED | PrettyView.tsx L2031-2043 |
| PrettyView (relay) | MultiBadgeAnchor per-participant IdentityBadge drag source | `tabId={tabId}` prop chain | WIRED | PrettyView L3605 → MultiBadgeAnchor L109/L151/L188 → IdentityBadge.tsx L82 `isDragSource = !!tabId && !isMobile` |
| Relay tab in workspace | URL fragment | `specForTab({sessionKind, relayRoomId})` → `encodeTabSpec` | WIRED | AppShell.tsx L926-927 → tab-url.ts L181-193 → L135-137 |
| URL fragment on refresh | Restored relay tab | `parseTabParam` → tab-restore FIRST loop → `openTab(null, "terminal", ..., {sessionKind, relayRoomId})` | WIRED | tab-url.ts L109-117 → AppShell.tsx L1273-1310 |
| Relay tab inside splitTree | Resolver returns tab.id | `specToTabId.set('relay:<roomId>', id)` + closure fallback walk | WIRED | AppShell.tsx L1405-1411 (key builder) + L1440-1454 (resolver) |

### D-XX Decision Recognition (all 16 CONTEXT decisions)

| Decision | Status | Evidence |
|----------|--------|----------|
| D-01 No accidental inheritance | RECOGNIZED | Harness call site untouched (PrettyView L3569-3586); all case-branches gated on `source.kind === "relay"` or `mode === "relay"` — grep-confirmed |
| D-02 Every case-branch deliberate | RECOGNIZED | Each new case-branch documented inline with JSDoc referring back to Phase 97 finding number |
| D-03 Room case gets a loading veil, signal is what changes | RECOGNIZED | Veil still mounts under same `showResolvingSpinner` gate at L3800; only the arming signal differs |
| D-04 Messages-loaded signal traced (history_batch) | RECOGNIZED | Plan 02 chose `history_batch` over `session` frame; use-relay-adapter L472; JSDoc at chat-surface-source.ts L74-82 |
| D-05 Both directions work | RECOGNIZED (drag-source); PENDING LIVE (drop-target) | Drag-source: tabId threaded through 3 files. Drop-target: SplitView native listener at L297-575 unchanged; [pv-split-drop-diag] logs shipped. Verdict A approved. |
| D-06 Shared-state corruption in scope | RECOGNIZED (Verdict A) | Static analysis concluded no evidence of corruption; H1/H2/H4/H5 all clean under code review; H3 ruled out. Alice approved on static basis; live confirmation deferred to phase-end |
| D-07 Deferred-split candidate | RECOGNIZED | Discovery-first sequencing (Plan 01) ran before Plan 06; Verdict A means F-2 stayed in-phase |
| D-08 source.kind is THE case discriminator | RECOGNIZED | Grep of new case-branches shows all reads on `source.kind` (PrettyView layer) or `mode` (ComposeBox layer, which itself derives from source.kind); no drift |
| D-09 Text-input vertical parity | RECOGNIZED | Invisible Row 1 spacer at ComposeBox L2696-2705 preserves vertical envelope byte-for-byte |
| D-10 Top-edge affordance vertical headroom | RECOGNIZED | Invisible Row 1 spacer restores the exact vertical space Row 1 occupied in harness mode |
| D-11 Halve inner gap (gap-2 → gap-1) | RECOGNIZED | MultiBadgeAnchor.tsx L217-218 |
| D-12 Pull-out drawer, simple slotted | RECOGNIZED | AgentBadgeWithMeter.tsx L206-217 + L225-230 — Variant A implementation |
| D-13 Prototype is visual pattern | RECOGNIZED | Byte-for-byte match to `meter-tasting.html:164-177` confirmed via side-by-side grep |
| D-14 Placeholder reads `message room` | RECOGNIZED (with WARNING-5) | Ships `Message room…` (capital-M per template convention); Alice's verbatim was lowercase. Surfaced for /close |
| D-15 URL identifier is opaque Matrix room ID | RECOGNIZED | tab-url.ts encodes/decodes roomId via encodeURIComponent; no readability compromise |
| D-16 URL shape mirrors harness case pattern | RECOGNIZED | `relay:<encoded roomId>` alongside `tmux:<host>:<session>` — same protocol-prefix pattern |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| PrettyView veil (relay case) | `showResolvingSpinner` | `chatSurfaceAdapter.isMessagesLoaded` (from use-relay-adapter WS `history_batch` frame) | Yes — real WS traffic writes state; empty rooms confirmed via test 19 | FLOWING |
| MultiBadgeAnchor IdentityBadges | `tabId` prop chain | PrettyView.tsx L3605 → tabId of the enclosing relay Tab (destructured at PrettyView L612 per RESEARCH) | Yes — every mount receives the tab's real tabId; drag-source enabled | FLOWING |
| Relay URL fragment | `#tab=relay:<encoded roomId>` | AppShell URL-sync effect → specForTab → encodeTabSpec, reads `t.relayRoomId` from Tab state | Yes — real relay-room tabs carry roomId | FLOWING |
| Restored relay tab (refresh) | `spec.roomId` → openTab call | parseTabParam decodes fragment → tab-restore loop → openTab with `sessionKind: "relay-room"`, `relayRoomId: spec.roomId` | Yes — routes through the same openTab shape as `onRelayRoomRowClick` at AppShell L2169-2176 | FLOWING |
| ComposeBox placeholder (relay) | `identityName` prop | PrettyView L4288 case-branch → literal `"room"` | Yes — interpolates to `Message room…` in template | FLOWING |
| Meter drawer | drawer wrapper is static chrome; no data variable | (chrome-only) | N/A | N/A (chrome fill-in, no dynamic data) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| tsc project-wide clean | `npx tsc --noEmit` | exit 0, zero output | PASS |
| U+2026 ellipsis preserved in placeholder template | `sed -n '2773p' ComposeBox.tsx \| od -An -tx1 \| grep e280a6` | matched `e2 80 a6` | PASS |
| 9 phase-97-touching test files all green | `npx vitest run <9 files>` | Test Files 9 passed (9), Tests 111 passed (111) | PASS |
| No JSON.stringify(e) on DOM Event in AppShell | `grep 'JSON.stringify(e)' src/ui/AppShell.tsx` | no matches in production code | PASS |
| Harness IdentityBadge site untouched | `grep 'tabId={tabId}' PrettyView.tsx` | 2 matches: L3575 (harness, pre-existing) + L3605 (new relay) | PASS |
| Working tree clean | `git status --short` | empty output | PASS |
| All 6 SUMMARY files marked Self-Check PASSED | `grep -l 'Self-Check: PASSED' 97-0*-SUMMARY.md` | 6 files match | PASS |

### Probe Execution

No formal probe scripts in this project's convention for UI-polish phases. Substituted with scoped Vitest run (behavioral spot-check above) — 111/111 green across 9 test files.

### Requirements Coverage

Phase 97 has no formal REQ-IDs (UAT-polish arc, tracked as F-1..F-7 findings + D-01..D-18 decisions). All 7 findings and all 16 D-XX decisions verified above.

### Anti-Patterns Found

None blocking. One SOFT judgment surfaced:

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| PrettyView.tsx | L4288 | Ships `Message room…` (capital M) rather than Alice's verbatim shorthand `message room` (lowercase) | Info (WARNING-5 iter-1 plan-check) | RESEARCH § Open Questions locked capital-M per harness template convention; needs Alice's confirmation at /close whether the choice reads right |

No forbidden patterns:
- `JSON.stringify(event)` on DOM Events: 0 in production code (grep confirmed).
- Debt markers (TBD/FIXME/XXX) in phase-touched files: 0 (grep in modified files).
- Streaming code introduced: 0 (fleet directive preserved).
- Empty implementations / hardcoded empty rendering data: 0 in the 7 finding fixes.
- Console.log-only implementations: 0.

### Reviewer's Checklist ("what would make it wrong" per shape file)

| Would-make-it-wrong invariant | Status | Evidence |
|-------------------------------|--------|----------|
| Room case still looks/feels different from session case where NOT deliberately case-branched | CODE-VERIFIED; needs human visual | All new case-branches gated on `source.kind` or `mode` predicate; harness call sites byte-untouched; regression-floor tests green. Live visual comparison routed to human. |
| Loading veil dismisses on wrong signal (immediately on mount, unrelated network event, or after messages already painted) | CODE-VERIFIED | Signal is `history_batch` frame arrival (D-04 preferred over `session`); 400ms delay-arm mirrors harness path; empty-rooms confirmed dismiss via Test 19 |
| Drag-drop fix leaves general state corruption unaddressed | ADDRESSED (Verdict A) | Static analysis concluded no evidence of corruption. Verdict A approved by Alice. Live-browser reproduction of Alice's page-reload-clears-it observation deferred to phase-end deploy; `[pv-split-drop-diag]` forensic instrumentation shipped for escalation if needed |
| URL persistence identifier ambiguous across rooms or doesn't survive rename | ADDRESSED | Opaque Matrix room ID (D-15) — unambiguous and rename-stable by construction |
| Meter drawer doesn't read as peeking from behind the pill | CODE-VERIFIED (byte-for-byte); needs live visual | AgentBadgeWithMeter chrome matches meter-tasting.html Variant A verbatim; Alice approved code-level match. Live tuck-depth verification deferred to /close with 6-10px executor-discretion fine-tune band available |
| Compose fixes address symptoms but underlying divergence stays | ADDRESSED | Invisible Row 1 spacer preserves vertical envelope byte-for-byte, not with a `pt-N` fine-tune — so future changes to Row 1 in the harness case will parallel the spacer's geometry naturally |

### Human Verification Required

See `human_verification` in frontmatter. Nine items routed for Alice's live-browser confirmation at /close, all deriving from runtime paths or visual judgments that scoped tests cannot cover.

### Gaps Summary

**No blocking gaps.** All 7 findings realized in code; all 16 D-XX decisions recognized; regression floor preserved at code level; test suite green (111/111 across 9 files); tsc clean project-wide; working tree clean.

**One SOFT judgment (WARNING-5) surfaced for /close:** placeholder capitalization ships `Message room…` (capital M per harness template convention) while Alice's verbatim shorthand was lowercase `message room`. RESEARCH § Open Questions and Plan 03 SUMMARY documented this as a SOFT judgment to lock at /close; not a code bug.

**Live-browser confirmation deferred to phase-end deploy** per standard fleet pattern for the following: F-1 veil dismissal on empty and populated rooms, F-2 drag-drop full round-trip (including Alice's page-reload-clears-it observation — the Verdict-A escalation gate to Verdict B if reproduction fails), F-3 vertical parity within 1px, F-4 gap-1 visual reading, F-5 drawer tuck geometry on real DOM, F-6 placeholder read, F-7 Chrome window-restore round-trip, and D-01 harness regression floor visual pass.

---

*Verified: 2026-09-10T02:52:00Z*
*Verifier: Claude (gsd-verifier)*

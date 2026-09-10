# Phase 97: Room-case chrome and lifecycle should match session-case except where deliberately case-branched — Research

**Researched:** 2026-09-10
**Domain:** UAT-polish arc on Phase 93 (relay rooms use the chat surface, two data sources)
**Confidence:** HIGH — every finding traced to specific files and line numbers in the shipped Phase 93 code.

## Summary

Every one of Ashley's seven UAT findings is a case-branch that Phase 93's architecture required but never made. The findings fall into three shapes:

1. **A lifecycle signal that only exists on the harness side** (findings 1 and 7). The loading veil is driven off the harness pane-state WS machine; the URL is driven off `tab-url.ts`'s `specForTab` which only knows the `tmux:` / `terminal:` / `rdp:` / `vnc:` / `telnet:` protocols. Neither is wired for `source.kind === "relay"`.
2. **Chrome that was hidden monolithically but not reflowed** (findings 3 through 6). Phase 93 D-11 hid ComposeBox Row 1 + Paperclip when `mode === "relay"`; the horizontal footprint of the hidden paperclip's `pl-11` padding and the top-anchored `QueuePlusTab` still assumes Row 1 above the textarea. Findings 4, 5, and 6 are simple locked-decision fills (gap-1, drawer wrapper, placeholder copy).
3. **Drag-and-drop state that a room-showing surface may or may not be corrupting** (finding 2). The hypothesis in CONTEXT.md is a shared-registry leak; the evidence I traced points at a *different* root cause: the badge-drag SOURCE contract, not the drop TARGET. Full assessment in the finding-2 section and in "Split-out assessment" at the end of this report.

**Primary recommendation:** Order the plan so finding 2's discovery task runs FIRST (per D-07 split-out contract). The other six findings are all bounded, file-scoped, and can slice in parallel across two waves. Findings 3, 4, 5, 6 touch distinct concerns (compose reflow / badge anchor / agent-badge appendage / placeholder copy) with no shared-file conflicts. Findings 1 and 7 touch adapter and routing plumbing; they can also run in parallel with each other and with 3-6.

Every claim in this document is `[VERIFIED: grep in the shipped Phase 93 tree]` unless tagged otherwise. All file paths are absolute and all line numbers are as of `feat/tab-title-from-tmux` HEAD.

## Architectural Responsibility Map

Phase 93 shipped a two-adapter chat surface. This arc's fixes distribute across three tiers of that architecture.

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Loading-veil signal (finding 1) | Relay adapter (`useRelayAdapter`) | PrettyView veil-mount gate | The veil is data flowing OUT of the adapter — mirrors Phase 93 D-17 data-over-configuration. Adapter exposes a signal; PrettyView reads it case-agnostically. |
| Drag-drop participation (finding 2) | SplitView Pane / IdentityBadge drag source | (potentially) shared drag-registry state | Split view Pane owns drop-target semantics via native listeners on `outerRef` (patch #514). Relay-showing surface's IdentityBadges in MultiBadgeAnchor do NOT wire tabId — no drag source. See finding 2 for full trace. |
| ComposeBox reflow (finding 3) | `ComposeBox.tsx` | — | Row 2 (textarea + QueuePlusTab + Send) needs the padding-left/padding-top budget it was given when Row 1 was present to reflow now that Row 1 is `{mode !== "relay" && (...)}`-gated. |
| Multi-badge inner gap (finding 4) | `MultiBadgeAnchor.tsx` (ROOT_ANCHOR_CLASS constant) | — | Single-token change on a constant. |
| Meter drawer chrome (finding 5) | `AgentBadgeWithMeter.tsx` (data-appendage wrapper) | — | Wrap the existing `data-appendage="true"` div with a drawer container that tucks −8px behind the pill's bottom. |
| Placeholder copy (finding 6) | `PrettyView.tsx` (ComposeBox `identityName` prop wiring) | `ComposeBox.tsx` (placeholder template) | Cleanest: PrettyView passes a different placeholder-shaped string in relay case. Alternative: ComposeBox learns `mode === "relay"` for placeholder. See finding 6 for the recommendation. |
| URL persistence (finding 7) | `tab-url.ts` (`TabSpec` grammar + `specForTab`) | `AppShell.tsx` URL-sync effect + `consumePendingWorkspace` | The wire grammar needs a new protocol (`relay:<roomId>`), the encoder needs to emit it for relay-kind tabs, the decoder needs to restore them, and AppShell's tab-restore path needs to route a decoded relay-spec back through `openTab(null, "terminal", ..., {sessionKind: "relay-room", relayRoomId})`. |

## Standard Stack

Phase 97 does not introduce new libraries — every fix lives entirely within the existing Skynet stack (React 18 + Tailwind v4 + Vite + Vitest + native DOM drag events). No package install is required, so the Package Legitimacy Audit section below is trivially clean.

## Package Legitimacy Audit

No new packages installed in this phase. This section is a no-op.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| — | — | — | — | — | — | No new packages |

## Project Constraints (from CLAUDE.md)

`./CLAUDE.md` does not exist at the repo root. Fleet-wide directives that apply (per CONTEXT.md's canonical_refs, cross-checked against `.planning/config.json`):

- **Test discipline (fleet directive):** Scoped tests during development; full-suite + playwright smoke are ship-gate only, orchestrator-owned. Reflected in `.planning/config.json` `workflow.nyquist_validation: false` — this arc does NOT need the Validation Architecture section (Nyquist is disabled).
- **Structured logging (fleet directive):** Boundaries in this arc that MUST log structurally with `console.info({operation: ...})`: (a) the veil-dismiss signal source (finding 1), (b) split-view surface registration for the relay case (finding 2), (c) URL emit / restore for a relay tab (finding 7). NEVER `JSON.stringify` a DOM Event object.
- **No worktrees (fleet directive):** Confirmed via `.planning/config.json` `workflow.use_worktrees: false`.
- **No streaming, ever (fleet directive):** Confirmed — this arc has no server-response feature that could tempt streaming. Everything is client-side plumbing.
- **Multi-identity `git pull --rebase` before push:** Applies at ship time only.
- **`security_enforcement: true`:** Applies to this repo. The arc is 100% UI polish (no auth surface changes, no crypto, no new endpoint calls, no user input parsing beyond an opaque room-ID string). ASVS Level 1 exposure is minimal — see Security Domain section below.
- **UI safety gate (`workflow.ui_safety_gate: true`):** The one code-color concern is the URL round-trip for a relay room. If the router accepts a URL-encoded `relayRoomId` and passes it to the Matrix backend, the string travels from URL bar → Tab.relayRoomId → useRelayAdapter → WS payload. Sanitization is the URL decoder's job (decodeURIComponent) and the wire-protocol validator on the backend's job. Not a Phase 97 problem, but flag it in Landmines below.

## Runtime State Inventory

Phase 97 is a chrome / lifecycle-signal polish arc — no rename, no refactor, no migration. Category-by-category:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no schema change, no key rename, no data migration. | None. |
| Live service config | None — no dashboard names, no external-service-owned identifiers. | None. |
| OS-registered state | None. | None. |
| Secrets / env vars | None. | None. |
| Build artifacts | None — no package name change, no compiled binary rename. | None. |

**Nothing found in any category:** verified by inspection — this is a pure client-side UI arc. No state that lives outside the repo needs to migrate.

## Environment Availability

Phase 97 has no external tool dependencies beyond the existing Vitest / TypeScript / Tailwind toolchain, which is already installed and in daily use. Skipped per the Step 2.6 rule (purely code changes, no external services / runtimes / CLI utilities beyond the existing dev toolchain).

---

## Finding 1: Loading veil never dismisses in the room case (BLOCKER)

### Current behavior

`/home/ubuntu/skynet-taylor/src/ui/features/pretty-view/PrettyView.tsx:3782` mounts `<PrettyViewLoadingOverlay />` gated on `showResolvingSpinner`, which is set by the effect at L2002-2013:

```
useEffect(() => {
  if (renderedState !== "resolving") {
    setShowResolvingSpinner(false);
    return;
  }
  const t = setTimeout(() => setShowResolvingSpinner(true), 400);
  return () => clearTimeout(t);
}, [renderedState]);
```

`renderedState` is `resolveRenderedState(wsTransportState, paneState)` — a pure reducer at `/home/ubuntu/skynet-taylor/src/ui/features/pretty-view/resolve-phase.ts:151-200`. Both inputs are harness-adapter concepts:

- `paneState` (L1727) is set ONLY inside the harness ingestion effect (L2189-2192, gated at L2023 on `source.kind !== "harness" → return`).
- `wsTransportState` (L1976-1983) derives from `status` + `reconnectAttempts`. `status` is set to `"streaming"` only inside the harness effect (call sites: L2260, L2266, L2768; also `setStatus("error")` at L2824, L2890, L2899 — all in the harness effect).

Consequently, for a relay-kind mount: `paneState` stays `null` forever, `status` stays `"connecting"`, `wsTransportState` derives to `"not-connected"` (because `reconnectAttempts === 0` and `status !== "streaming"`), `renderedState` collapses to `"resolving"` per truth-table row (e) `resolve-phase.ts:199`, and after 400ms `showResolvingSpinner` flips `true` and stays true.

**The message list itself DOES mount underneath** — L3830-3832 gate includes `source.kind === "relay"` which overrides the `status === "streaming"` requirement. So Ashley sees messages painting under a scrim that never dismisses.

### Root cause

Phase 93 architected the veil-dismiss signal into the harness pane-state machine (a single-adapter concept from Phase 30) but never wrote the equivalent branch for the relay case. The relay adapter DOES expose a readiness signal (`isReady`, `sources/use-relay-adapter.ts:207`), but that signal is currently consumed only by `MultiBadgeAnchor` (the participants-loading placeholder). PrettyView's veil-mount gate does not read it.

Two facts to preserve:
- The harness ingestion effect is gated at L2023: `if (source.kind !== "harness") return;`. A veil signal for the relay case CANNOT flow through `setStatus` / `setPaneState` without violating that gate.
- The relay adapter's `isReady` flips on the FIRST `session` frame per `use-relay-adapter.ts:206-207` — before `history_batch` OR `participants` land. The JSDoc at L32-36 explicitly names `session` as the earliest reliable "backend is authoritative" signal. `history_batch` also flips it as belt-and-suspenders (L444-445).

### Fix approach

Two paths, ordered by preference:

**Path A (RECOMMENDED — data over configuration, per Phase 93 D-17):** Extend `ChatSurfaceAdapterState` (`sources/chat-surface-source.ts:67-79`) with an optional field the veil-mount gate can read case-agnostically. Two shapes to choose between:

- Option A1 — reuse the existing `isReady` field. The veil-mount gate becomes: veil shows when `source.kind === "relay" && !adapter.isReady`. Tradeoff: `isReady` currently flips true on `session` frame which is BEFORE `history_batch` — messages might not be present yet when the veil dismisses (Ashley's "veil dismisses on a signal that doesn't correspond to messages have loaded" invariant from shape file).
- Option A2 — add a new discriminated field like `isMessagesLoaded: boolean` (name TBD), flipped `true` on the first `history_batch` frame. The relay adapter at `use-relay-adapter.ts:438-445` receives `history_batch`; add a state slot + the flip on that frame. The `useHarnessAdapter` inert shim leaves it undefined (or defaults to `true` since the harness-veil is separately driven).

**The signal Ashley wants is history_batch**, not `session`, because `session` fires immediately on WS auth-pass and predates any actual message-loading work. Choose Option A2 for correctness. `[VERIFIED: use-relay-adapter.ts:430-446]`

**Path B (case-branched, not data-driven):** Reshape the veil-mount gate in PrettyView itself to case-branch on `source.kind`. Something like: `showLoadingOverlay = source.kind === "harness" ? showResolvingSpinner : (source.kind === "relay" && !relayFirstHistoryReceived)`. Requires a new state slot on PrettyView for "have we received history_batch yet" driven by an effect watching `chatSurfaceAdapter.messages.length` transitioning from 0 to non-zero. Uglier and violates D-17; only pick this if Option A2's adapter reshape turns out to be structurally hairier than expected (unlikely — it's an additive optional field).

**Preferred approach for planner:** Option A2. The adapter contract already has optional fields (`hasOlder`, `loadOlderStatus`, etc.) — adding one more `isMessagesLoaded` is minimally invasive.

### Analog (session case's equivalent to mirror)

The harness case's veil dismisses when `paneState` transitions from `null` to non-null (via a `pane_state` WS frame from the backend claude-session server — `pane-state-emitter.ts`). The moment the backend emits `pane_state:active`, `renderedState` transitions to `"active"`, the effect at L2013 sets `showResolvingSpinner(false)`, and the veil unmounts. That backend emit happens after the WS is attached and the session-transcript tail begins — roughly the same "we're now sending you real content" moment as the relay adapter's `history_batch`.

The relay case's analog is: relay adapter's WS attaches → `session` frame lands (adapter marks itself connected) → `history_batch` frame lands (backend has read the room's history and shipped a batch). `history_batch` is the analog of "the harness backend has started tailing the JSONL" — that's when Ashley genuinely should see the veil come down.

### Landmines

- **Do NOT dismiss on `chatSurfaceAdapter.messages.length > 0`.** An empty room has zero messages and zero history_batch entries — but `history_batch` still fires with an empty `events` array (`use-relay-adapter.ts:439-440` — `parsed.events` may be an empty array and history is set to it). If you gate on `messages.length > 0` the veil stays up in an empty room. Gate on the FRAME arrival, not on the state's cardinality.
- **Do NOT dismiss on `session` frame alone.** That's what `isReady` already tracks; Ashley's finding says the veil should not dismiss until messages have loaded (or an empty-room verdict has landed).
- **Preserve the harness case veil behavior byte-identically.** No changes to `paneState` / `status` / `wsTransportState` / `resolveRenderedState`. The harness veil path continues to run through `showResolvingSpinner`.
- **The 400ms delay-arm in the harness effect (L2007-2013) is deliberately present** to suppress veil flash on warm re-entry. If the relay-veil signal takes the SAME delay-arm treatment (recommended for consistency), duplicate the pattern or route both through the same setState. Do NOT skip the delay-arm — a fast WS reconnect would flash the veil.

---

## Finding 2: Drag-and-drop split placement broken after opening a room (BLOCKER — deferred-split candidate)

### Current behavior

The SplitView Pane owns drop-TARGET semantics via native DOM listeners attached to `outerRef` in a `useEffect` at `/home/ubuntu/skynet-taylor/src/ui/shell/SplitView.tsx:297-575`. Patch #514 (comment at L271-296) explicitly documents that this MUST be native, not React synthetic, because PrettyView content is portaled from AppShell — React synthetic events bubble the React tree past the Pane, but native DOM bubbling still reaches the Pane's outer div.

Drag-SOURCE semantics live on IdentityBadge (`/home/ubuntu/skynet-taylor/src/ui/features/terminal/IdentityBadge.tsx:221-244`) gated on `isDragSource = !!tabId && !isMobile` (L82). The badge sets `text/plain: tabId` + `application/x-skynet-badge: JSON.stringify({tabId})` + `effectAllowed: "move"` on `dragstart`.

**Two problems present in the relay case:**

**(a) No drag SOURCE.** The relay-case IdentityBadge in `MultiBadgeAnchor.tsx:129` (`<IdentityBadge identityKey={identityKey} />` in `HumanBadgeCell`) and L186 (in `AgentBadgeWithMeter.tsx:186` — `<IdentityBadge identityKey={identityKey} />`) do NOT pass `tabId`. `isDragSource` is `false`; `draggable={false}`. Compare the harness case at `PrettyView.tsx:3539-3555` which explicitly passes `tabId={tabId}`. This alone explains "cannot drag a room-showing surface into another slot."

**(b) Portal reparenting on switch.** AppShell renders every tab as a React portal into a `data-tab-id` div (`SplitView.tsx:620-625`). The portal target reparenting is driven by `onPaneContentRef` (SplitView.tsx:264-269 → AppShell). When a room is opened, AppShell places PrettyView (with `source.kind === "relay"`) inside a Pane's tab-id div. The Pane's `useEffect` at L297-575 was already attached to `outerRef` at Pane mount and continues owning drag-drop.

**The dragload-corruption claim from Ashley** ("split-view for even plain sessions is disturbed after a room has been opened") is the harder half of this finding. Diagnostic hypotheses in priority order:

**H1: window-level dragend leak.** SplitView.tsx:558 attaches `window.addEventListener("dragend", onDragEnd)`. The cleanup at L563 removes it. If a Pane is remounted (which happens when the split-tree changes shape), the effect cleanup runs. But if a Pane REMAINS mounted while its `path` changes (parent split reshapes), the deps at L568-575 include `path.join(".")`; effect re-runs; the previous window listener IS removed and a new one attached. This LOOKS clean.

**H2: `outerRef` stale-DOM listener.** If a room-showing surface's PrettyView somehow reparents its DOM in a way that DETACHES the portal target from the Pane's `outerRef` element tree, the `outerRef` still points to the Pane's outer div (correct), but drops on the portaled content no longer bubble via DOM parentage to the outer div. This is unlikely — DOM bubbling follows the actual `parentNode` chain, and React portals do preserve DOM parentage (only React parentage differs). But it's worth confirming during discovery.

**H3: badge onDragStart timer leak.** `IdentityBadge.tsx:230-233` clears the long-press timer inside `onDragStart`. If a relay-case badge is never drag-sourceable (because no `tabId` is passed — see problem (a) above), `onDragStart` never fires; the timer path can't fire either because `onLongPress` isn't wired in MultiBadgeAnchor. This does NOT corrupt shared state — no leak here.

**H4: pane content-ref registry corruption.** `onPaneContentRef` is called at contentRef time (SplitView.tsx:264-269) with `(tabId, el)`. AppShell uses this to reparent the tab's stable node. If a relay-showing tab's `data-tab-id` div wiring differs (it does not — tabUtils.tsx:239-252 mounts PrettyView the same way as any other terminal tab), the registry stays clean.

**H5: split-tree state mutation while a room mount is in flight.** If AppShell's `openTab(null, "terminal", ...)` for a relay-room tab triggers a split-tree reshape (unlikely per the create-relay-room flow at AppShell.tsx:2152-2179 — the row-click handler just adds a tab, doesn't touch splitTree), some intermediate state could leak. Also unlikely.

**The most likely single cause is (a) — the missing drag source.** Ashley's specific complaint is "dragging a room-showing surface into an empty split slot opens the room in that slot" — that's a drag-SOURCE ask, and it's currently impossible because the relay badge has no tabId wired. The "shared-state corruption" claim needs live diagnosis with browser DevTools instrumentation before we can size it.

### Root cause

Two case-branches missing:

1. **Drag source.** `MultiBadgeAnchor.tsx:129`, `MultiBadgeAnchor.tsx:186 (via AgentBadgeCell body)`, and `AgentBadgeWithMeter.tsx:186` need `tabId` threaded through, sourced from a new prop that MultiBadgeAnchor receives from PrettyView (which has `tabId` already, at PrettyView.tsx:612). BUT — a subtlety: Phase 93 D-18 says badge-click is a no-op for relay. Making it a drag-SOURCE is different from making it a click-target (drag-source doesn't fire onClick; the browser's 5px HTML5 drag threshold disambiguates). Verify with the planner that D-18 doesn't intend to preclude drag-source, just click.
2. **Drop-target sanity.** Verify (during discovery — not a fix, a check) that a relay-showing Pane's native drop-target listener attaches, fires on drops, and cleans up cleanly on Pane unmount / path change. Instrument the `[pv-split-drop]` and `[pv-split-preview]` logs (already present) and reproduce Ashley's page-reload-clears-it observation. If clean, split-out DOES NOT apply — findings 1, 3, 4, 5, 6, 7 (and finding 2 as a simple drag-source-add case-branch) can ship as one arc.

### Fix approach

**Discovery phase (sequence FIRST, per D-07 split-out contract):**

- Add a `[pv-split-drop-diag]` structured log at native `dragover` / `drop` on a relay-showing Pane (temporarily; can stay as instrumentation post-ship).
- Manually reproduce Ashley's flow: open plain session → open room → close room → try to drag another session onto the plain session's Pane. Confirm what breaks: does the plain-session Pane's dragover still fire? Does the coral overlay still paint? Does the drop still route to `onOpenSessionInTree`?
- If the plain-session Pane behaves correctly after the room open/close cycle → confirms Ashley's "shared-state corruption" is a red herring; the arc's fix reduces to problem (a) alone (wire tabId through MultiBadgeAnchor). Split-out DOES NOT apply.
- If a plain-session Pane DOES misbehave after a room mount → identify which handler is misbehaving (the outer-listener, the window dragend, or the AppShell handler at AppShell.tsx:2265 mentioned in SplitView comments). Full diagnosis THEN decide split-out.

**If split-out DOES NOT apply, implementation:**

- Thread `tabId` from PrettyView (already in scope at PrettyView.tsx:612) → MultiBadgeAnchor (new prop, e.g. `tabId?: string`) → HumanBadgeCell / AgentBadgeCell → IdentityBadge (`tabId={tabId}`). This turns each per-participant badge into a drag source that carries the ROOM tab's tabId — dragging any participant's badge drags the whole room tab. That matches D-05 conceptually ("room-showing surface as drag source"). Verify with reviewer.
- Preserve D-18 (badge-click no-op): the drag-source wiring in IdentityBadge coexists with `onClick` absence naturally (dragstart threshold is separate from click).
- Structured log `[relay-badge-drag]` on dragstart mirroring the existing `[badge-drag]` at IdentityBadge.tsx:240 — one line per drag with tabId + participant type.

**If split-out DOES apply (structural reshape required):**

- Split finding 2 into its own follow-up phase.
- Ship the other six findings as Phase 97.
- Frame the follow-up phase around whatever the diagnosis surfaced — most likely a redesign of the drag-registry (patch #514's window-level dragend model) or a rearchitecture of how the outer AppShell listener at AppShell.tsx:2265 interacts with the Pane listeners.

### Analog (session case's equivalent to mirror)

The harness case's IdentityBadge at PrettyView.tsx:3539-3555 wires `tabId={tabId}` verbatim from the Tab. Threading tabId through MultiBadgeAnchor is a literal 1:1 mirror.

### Landmines

- **Do NOT modify the IdentityBadge primitive.** MultiBadgeAnchor and AgentBadgeWithMeter both use plain `<IdentityBadge>`. Passing tabId is a prop-thread; no primitive change. Confirmed by CONTEXT.md scope edge "IdentityBadge — Read-only for this arc" (from the additional_context section).
- **Preserve D-18 badge-click no-op.** IdentityBadge only fires onClick when `onClick` prop is supplied; MultiBadgeAnchor deliberately doesn't supply it. Drag-source is separately gated on `tabId` — the two are orthogonal.
- **`isMobile` gate at IdentityBadge.tsx:82 stays intact.** The badge is auto-disabled as a drag source on mobile viewports because SplitView is desktop-only. No relay-specific change needed there.
- **Do NOT plumb window-level state changes.** If the diagnosis surfaces window-listener leakage, the fix is a listener-cleanup discipline change, NOT introducing a global registry. Global registries are the class of solution that CAUSES the "corrupted after room mount" bug in the first place.
- **`dataTransfer` MIME contract is load-bearing.** The `application/x-skynet-badge` payload contract is documented at IdentityBadge.tsx:203-214 and consumed by SplitView.tsx:432 (center-drop swap dispatch). Keep the same MIME + JSON shape for relay drags; downstream code should not need to know which case the drag originated from.

---

## Finding 3: ComposeBox in the room case — ghost gutter + input vertical shortness + clipped top-edge affordance

### Current behavior

Phase 93 D-11 hides Row 1 monolithically at `/home/ubuntu/skynet-taylor/src/ui/features/pretty-view/ComposeBox.tsx:2334`:

```
{mode !== "relay" && (
<div data-testid="compose-row-1" className={cn("flex items-center gap-2 mb-[3px]", isTouchDevice ? "min-h-[44px]" : "min-h-8")}>
  ... entire Row 1 (meter, aux buttons, ThumbsUp, Recap, etc.) ...
</div>
)}
```

Paperclip is separately hidden at L2908 (`{showPaperclip && mode !== "relay" && (...)}`).

**The ghost gutter is on the TEXTAREA, not on Row 1.** Look at L2836:

```
showPaperclip && "pl-11",
```

`showPaperclip` is passed from PrettyView.tsx:4264 as `true`. When `mode === "relay"`, the Paperclip itself doesn't render, but the textarea's `pl-11` (44px left padding) is still applied. That 44px is the left gutter Ashley sees — space reserved for a Paperclip that isn't there.

Similarly, the top-edge affordance is `QueuePlusTab` (a pebble-notch plus-tab rendered before the textarea at L2704-2710 when queueSlots is empty). It's positioned RELATIVE to the primary wrapper (L2695 `<div className="relative flex-1 self-stretch" data-testid="compose-primary-wrapper">`). The QueuePlusTab implementation at L3167-3210 uses absolute positioning to ride on the top edge of the textarea's wrapper. Its clip-path is documented at ComposeBox.tsx:2517-2519 as "rides on the topmost textarea's top edge." In the harness case, Row 1 above the textarea gives the QueuePlusTab pebble room to breathe above the textarea's rounded top corners. In the relay case, Row 1 is gone entirely — the textarea sits at the very top of the compose wrapper, with no vertical headroom above it for the pebble's `-top-N` offset. **Result: the pebble clips against the ComposeBox's outer container edge.**

**Text-input vertical shortness (Ashley's third symptom in finding 3):** The textarea's base is `min-h-8!` (L2792, 32px). Auto-grow to 6 rows works via the useLayoutEffect at L2791 comment reference. The wrapper `flex-1 self-stretch` at L2695 says "take remaining vertical space in Row 2's flex container." Row 2's flex container at L2689 is `flex items-end gap-2`. In the harness case, when Row 1 is present with `mb-[3px]`, Row 2 sits BELOW Row 1 and the textarea occupies whatever vertical the ComposeBox's outer container has minus Row 1's height. In the relay case with Row 1 gone, Row 2 is the only child — the textarea's height should match. So the "input area too short" symptom is probably NOT the flex layout — it's the `min-h-8!` default reflecting that with fewer external chrome constraints, the auto-grow's baseline appears shorter relative to the pane. Hypothesis: the perception of "too short" comes from the removal of Row 1's vertical space above the textarea, making the ComposeBox as a whole shorter and the textarea's `min-h-8` looking more compressed.

Alternative hypothesis: something in the wrapper `flex items-end` or in a padding token isn't case-branching the way it should when Row 1 disappears. **Discovery step:** measure — inspect a live relay-mode ComposeBox and a harness-mode ComposeBox in DevTools; compare bounding rects. The truth will be visible in `getBoundingClientRect()` values, not guessable from code alone.

### Root cause

Reflow that never happened. Phase 93 D-11 hid Row 1 monolithically; nothing else changed. The knock-on effects:
- Textarea `pl-11` gutter reserves space for a Paperclip that will never render.
- QueuePlusTab pebble expects Row 1 above it; without Row 1, the pebble clips the outer wrapper.
- Overall vertical geometry shifts because Row 1's ~32px (min-h-8) or ~44px (touch) is removed with no replacement.

### Fix approach

Three atomic reflow steps, all inside `ComposeBox.tsx`:

**Step 1 — kill the ghost `pl-11` gutter:**

Change L2836 from `showPaperclip && "pl-11",` to `showPaperclip && mode !== "relay" && "pl-11",` (or the equivalent — thread `mode` into the className computation). Same one-liner mode-gate discipline as L2334 and L2908.

**Step 2 — give QueuePlusTab vertical headroom:**

Add a `mode`-aware container padding-top on the primary wrapper (L2695) or on the compose outer container. Concrete recommendation: wrap the current `<div className="relative flex-1 self-stretch">` in a conditional `pt-N` where N accommodates the QueuePlusTab's `-top-N` offset. Find the pebble's exact absolute-positioning offset at ComposeBox.tsx:3180-3210 (QueuePlusTab function body — planner should read this passage to lock the exact padding delta needed).

Alternative: instead of adding padding, take the Row 1 skeleton down to a `mode === "relay"` invisible spacer that carries the same `mb-[3px]` bottom margin as Row 1. Cleaner because it preserves the vertical geometry byte-for-byte. Ashley's ask is parity in feel; a matching invisible spacer is the least-invasive way to get it.

**Step 3 — verify vertical parity:**

After Step 1 and Step 2, measure the ComposeBox's total height in both cases. If they match within 1px, D-09 (input vertical parity) is satisfied by construction. If a residual delta remains, hunt it in the remaining chrome — the Row 2 gap, the outer container's padding-bottom, the flex-item stretch behavior of the textarea wrapper.

### Analog (session case's equivalent to mirror)

The harness case IS the reference. Every measurement in this fix is "make the relay-mode ComposeBox's bounding rect (post-Step 2) equal the harness-mode ComposeBox's bounding rect for the same viewport size." No new design here.

### Landmines

- **Do NOT hide the pebble in relay mode.** Ashley wants the top-edge affordance to work in relay mode (that's the whole point of finding 3's third symptom). The pebble's onClick calls `onAdd` which prepends a new empty queue slot at index 0 — the queue-a-message mechanism is a Row 2 concept, not a Row 1 concept, and it's meant to work in both cases.
- **Do NOT reintroduce Row 1 chrome to "solve" the pebble headroom.** D-11 locked the monolithic Row 1 hide. The fix is a vertical spacer (mode-specific padding-top or an empty-Row-1 skeleton), not a partial Row 1.
- **Do NOT touch the Textarea's `min-h-8!` or `!` specificity.** Those are documented at L2793-2814 as load-bearing against shadcn Textarea's `min-h-[80px]` and `dark:bg-input/30`. Any change there re-opens a stack of past bug-fixes.
- **Do NOT let the reflow spill into the harness case.** All new class tokens must be `mode === "relay" && ...` gated OR must be visually equivalent to the harness case's existing behavior. Regression floor is Ashley's harness-mode compose looks byte-identical.

---

## Finding 4: MultiBadgeAnchor inner gap too wide

### Current behavior

`/home/ubuntu/skynet-taylor/src/ui/features/pretty-view/MultiBadgeAnchor.tsx:192-193`:

```
const ROOT_ANCHOR_CLASS =
  "absolute top-4 right-5 z-[101] flex flex-row-reverse items-start gap-2";
```

`gap-2` is Tailwind's 8px gap. Applied to a `flex-row-reverse` container. Each direct child is a `BadgeCell` (72px height for humans, 92px for agents). Between multiple cells, gap-2 creates an 8px horizontal gap.

### Root cause

`gap-2` matches the harness case's outer gap in ComposeBox Row 1 (search ComposeBox.tsx:2335 — `flex items-center gap-2`). Phase 93's port copied that gap over verbatim when MultiBadgeAnchor was written. It reads as "too wide" because it's the OUTER gap of a row of instruments repeated as an INNER gap between siblings — visually the badges look like separate zones instead of a group.

### Fix approach

Change L193 from `gap-2` to `gap-1` (4px). Single-token change. Executor may fine-tune based on visual result if the review reads 4px as too tight.

### Analog

There is no session-case analog for a multi-badge row — the harness case has exactly one badge. The reference is Ashley's judgment ("halve the gap").

### Landmines

- **This is the ONLY change to MultiBadgeAnchor.** Do NOT reshape the sort order, the loading-placeholder, the self-exclusion filter, or the `flex-row-reverse` layout. All of those are Phase 93 locks. Only the gap token changes.
- **Preserve `flex-row-reverse` semantics.** `gap-N` in a `flex-row-reverse` container works identically to a regular row — flex-gap is direction-agnostic. No layout math shifts.

---

## Finding 5: Meter chrome — simple slotted drawer

### Current behavior

`/home/ubuntu/skynet-taylor/src/ui/features/pretty-view/AgentBadgeWithMeter.tsx:189-192`:

```
<div
  data-appendage="true"
  data-role="agent-appendage"
  className="mt-1 flex flex-row items-stretch gap-0"
>
  ... meter-well (reset button + segments) ...
</div>
```

The meter appendage sits `mt-1` (4px) below the pill. The pill's own bottom edge is a `border-radius: 36` capsule with a large drop-shadow. Nothing about the current appendage suggests it's "attached" to the pill — it reads as a free-floating chip.

### Root cause

The appendage was ported byte-for-byte from Slice D per Phase 93 D-10 (see AgentBadgeWithMeter.tsx:4-8 header). Slice D's design tasting decided the drawer treatment (Variant A "simple slotted") AFTER Phase 93 shipped, so the appendage never got its final chrome.

### Fix approach

Wrap the existing `data-appendage="true"` div in a drawer container that:
- Sits at `margin-top: -8px` (tucks 8px behind the pill's bottom). Prototype exact value in `/home/ubuntu/.claude/roles/box-maintainer/bounties/phase-93-uat-polish-arc/meter-tasting.html:166` = `-8px`.
- Has `padding-top: 10px` on the drawer (meter-tasting.html:168) — keeps the meter body away from the tucked edge. This is where the vertical space the drawer eats gets given back.
- Has `z-index: 1` (meter-tasting.html:167) — behind the pill's `z-index: 2` so the pill visually sits in front.
- The inner meter-well applies (meter-tasting.html:170-177): `border-top-left-radius: 0; border-top-right-radius: 0; border-bottom-left-radius: 6px; border-bottom-right-radius: 6px; border-top: 0;`. Effect: squared top corners (tucked-under), rounded bottom corners, no visible border on top edge (invisible tuck).

The pill's existing drop-shadow (IdentityBadge.tsx:121) is `box-shadow: 0 8px 24px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,220,170,0.18), 0 0 40px hsla(hue, 65%, 55%, 0.28)`. That 24px offset-y shadow lands on the drawer (which sits BELOW the pill in DOM order and has `z-index: 1` below the pill's `z-index: 2`). Cementing the layering.

**Watch-out for the drawer's parent stack.** The IdentityBadge inside AgentBadgeWithMeter is positioned `absolute top-4 right-5` inside its own rootClassName (IdentityBadge.tsx:110). The `AgentBadgeWithMeter` root at L183 is `relative flex flex-col items-center gap-1`. The `IdentityBadge` is `absolute` inside this cell — which means the badge overflows the flex-col flow. **This may already be a Phase 93 bug** — the appendage `<div>` at L189 flows below the top of the AgentBadgeWithMeter root, but the IdentityBadge is absolutely positioned. Concretely: the cell is 92px tall (MultiBadgeAnchor.tsx:173), the IdentityBadge takes `top-4 right-5` of the cell, and the appendage sits `mt-1` below the top of the cell (not below the pill). If the pill is `absolute top-4`, the appendage's `mt-1` might not visually be BELOW the pill at all — it might be tucked BEHIND the pill's absolute box. Discovery step for the planner: verify with DevTools before assuming the drawer's `-8px margin-top` gets the tuck we want.

**Alternative (safer): re-parent the appendage into a wrapper that is a proper sibling of the pill in DOM order and uses `position: absolute; top: <pill-height + pill-top-offset - 8px>; right: 5px` to explicitly position it. This side-steps the "is the flex flow doing what I think" question.**

### Analog

There is no direct session-case analog — the harness case's context meter lives inside the ComposeBox's Row 1 well, not in the badge chrome. The reference is Variant A of the meter-tasting prototype (screenshot equivalent lives at http://100.99.149.8:8899/meter-tasting.html — Variant A section).

### Landmines

- **The pill is `absolute top-4 right-5` inside its own rootClassName.** The tuck geometry depends on how the flex-col parent + absolute child interact. Verify with DevTools before locking `-8px` — it may need to be `-<pill-height + 8>` instead.
- **Do NOT modify IdentityBadge.tsx.** CONTEXT.md scope says read-only for this arc. The drawer treatment lives entirely on the appendage side.
- **Do NOT modify the meter well internals** (segments, reset button, band computation). Those are byte-copied from ComposeBox at AgentBadgeWithMeter.tsx:71-77 header comment and MUST stay byte-identical for visual parity across surfaces (D-03 discipline documented at L44-47).
- **The pill's drop-shadow lands on the drawer via z-order.** Do NOT put the drawer at `z-index: 2` or above — that inverts the layering.
- **`overflow: hidden` on the drawer's parent could clip the drawer's tucked-under portion.** Verify the parent chain doesn't clip. The MultiBadgeAnchor cell at L173 is `flex flex-col items-stretch` — no overflow clip. Should be safe.

---

## Finding 6: ComposeBox placeholder should say "message room" in the room case

### Current behavior

`/home/ubuntu/skynet-taylor/src/ui/features/pretty-view/ComposeBox.tsx:2750`:

```
placeholder={`Message ${identityName || "Claude"}…`}
```

`identityName` is passed from `/home/ubuntu/skynet-taylor/src/ui/features/pretty-view/PrettyView.tsx:4249`:

```
identityName={pvIdentity?.displayName}
```

`pvIdentity` is derived from the harness session's identity (search PrettyView.tsx around L1809-1823). In the relay case, `pvIdentity` is undefined (there's no fleet identity for a room), so `identityName` is `undefined`, and the placeholder falls back to `Message Claude…`. That's Ashley's complaint — a room isn't Claude.

### Root cause

The `identityName` prop was designed for the harness single-identity case; there's no case-branch that changes it when `source.kind === "relay"`.

### Fix approach

Two shapes to choose between:

**Shape A (RECOMMENDED — clean case-branch at the call site):** In PrettyView.tsx:4249, case-branch `identityName`:

```
identityName={source.kind === "relay" ? "room" : pvIdentity?.displayName}
```

The `Message ${identityName || "Claude"}…` template at ComposeBox.tsx:2750 renders `Message room…` for relay. Ashley's verbatim ask is `"message room"` (lower-case `m` in `message` was probably shorthand). The current template is `Message …` with capital M. Verify with Ashley (or lock as "Message room…" and let the reviewer flag if it's wrong).

**Shape B (ComposeBox learns mode for placeholder):** In ComposeBox.tsx:2750, case-branch on `mode`:

```
placeholder={mode === "relay" ? "Message room…" : `Message ${identityName || "Claude"}…`}
```

Slightly leakier — puts the string literal inside ComposeBox instead of at the boundary.

**Preferred: Shape A.** It concentrates case-branch discipline at the ComposeBox call site where all the other Phase 93 D-11 case-branches already live (mode, canSend, onOptimisticSend all case-branch at that boundary — see PrettyView.tsx:4160, 4171, 4195-4208).

### Analog

The harness case's placeholder pattern (`Message <Name>…`) is the reference; the relay case's placeholder is a room-scoped version of it (`Message room…`).

### Landmines

- **Ellipsis is `…` U+2026, not three dots.** Preserve verbatim. Grep the string in the code to confirm.
- **`Message` capital M** matches the harness case; Ashley's shorthand `"message room"` was almost certainly all-lowercase informality, not a design decision. Confirm with the reviewer — locking on `Message room…` (matching the harness template's capitalization convention) is the safer bet.
- **Do NOT change the placeholder for the harness case.** Regression floor.

---

## Finding 7: URL persistence for the currently-open room

### Current behavior

`/home/ubuntu/skynet-taylor/src/ui/lib/tab-url.ts:73-79` declares:

```
const PROTOCOLS: TabSpec["protocol"][] = [
  "tmux",
  "terminal",
  "rdp",
  "vnc",
  "telnet",
];
```

No `relay-room` (or `relay`, or `room`) protocol. Consequently `specForTab` at L140-157:

```
export function specForTab(input: {
  type: TabType;
  host?: { name?: string; id?: string };
  targetTmuxSession?: string | null;
}): TabSpec | null {
  if (!input.host?.name) return null;
  ...
}
```

Returns `null` for a relay-room tab because `input.host` is `null` (relay-room tabs have no host — verified at tabUtils.tsx:186-195 and AppShell.tsx:2169). Result: relay-room tabs are dropped from the URL fragment by the URL-sync effect at AppShell.tsx:910-972.

Round-trip on refresh: the URL fragment doesn't carry any `relay:` param → `consumePendingWorkspace` at tab-url.ts:211-251 has nothing to restore for the relay tab → AppShell's tab-restore path doesn't reopen it → Ashley refreshes and the room is gone.

### Root cause

The URL grammar was closed to harness/RDP/VNC/telnet protocols. Phase 90 Plan 07 introduced `sessionKind: "relay-room"` on the Tab type but didn't widen the URL grammar.

### Fix approach

Four coordinated changes across three files:

**Change 1 — extend `TabSpec` and the protocol list in `tab-url.ts`:**

Widen the discriminated `TabSpec` type at tab-url.ts:43-47 to include a relay variant. Concrete shape:

```
export interface TabSpec {
  protocol: "tmux" | "terminal" | "rdp" | "vnc" | "telnet" | "relay";
  host?: string;    // widened to optional
  session?: string;
  roomId?: string;  // NEW — populated ONLY when protocol === "relay"
}
```

Add `"relay"` to `PROTOCOLS` array at L73-79.

**Change 2 — extend `parseTabParam` and `encodeTabSpec` in `tab-url.ts`:**

- `encodeTabSpec` at L101-107: for protocol `"relay"`, emit `relay:<encodeURIComponent(roomId)>`. Matrix room IDs contain characters like `!`, `:`, `.`, `@`, `#` that need URL-encoding. `encodeURIComponent` handles those.
- `parseTabParam` at L81-99: for `protocol === "relay"`, parse the rest as `roomId = decodeURIComponent(rest)`. Return `{ protocol: "relay", roomId }`.

**Change 3 — extend `specForTab` in `tab-url.ts`:**

L140-157 needs a new branch that handles the relay case:

```
export function specForTab(input: {
  type: TabType;
  host?: ...;
  targetTmuxSession?: string | null;
  sessionKind?: "harness" | "relay-room";
  relayRoomId?: string;
}): TabSpec | null {
  if (input.sessionKind === "relay-room") {
    if (!input.relayRoomId) return null;
    return { protocol: "relay", roomId: input.relayRoomId };
  }
  if (!input.host?.name) return null;
  // ... existing branches unchanged ...
}
```

**Change 4 — pass `sessionKind` and `relayRoomId` to `specForTab` from AppShell:**

`/home/ubuntu/skynet-taylor/src/ui/AppShell.tsx:914-922` currently passes `{ type, host, targetTmuxSession }`. Widen the call site to also pass `sessionKind: t.sessionKind` and `relayRoomId: t.relayRoomId`. Also widen the `splitTreeFragment` callback at L933-950 to pass the same for split-tree encoding.

**Change 5 — AppShell tab-restore path.**

`consumePendingWorkspace` returns a `WorkspaceSpec` with `TabSpec[]`. Each spec is currently routed to `openTab` — grep for where `WorkspaceSpec.tabs` is consumed:

The restore path is inside AppShell's `loadSavedTabs` / URL-driven-open pass. Trace this during planning (grep `consumePendingWorkspace` in AppShell.tsx). For each `TabSpec` with `protocol === "relay"`, the restore must call `openTab(null, "terminal", undefined, { sessionKind: "relay-room", relayRoomId: spec.roomId, allowCreateTmux: false, label: "loading…" })`. `relayRoomTitle` is unknown at restore time — the useRelayAdapter will eventually fill in `roomTitle` via the `session` frame; the tab's label can be the room ID or a loading placeholder until then.

### Analog

The harness case's URL scheme `#tab=tmux:<host>:<session>` is the reference. Structural mirror for relay: `#tab=relay:<roomId>`. Same URL-fragment mechanism (Chrome window-restore preserves fragment), same encoding conventions, same round-trip path.

### Landmines

- **Room IDs contain non-URL-safe characters.** Matrix room IDs look like `!aBcDeF:matrix.example.com`. `encodeURIComponent` handles `!` `:` `.` `@` but the SIZE of the encoded string matters — long room IDs may bloat the URL. Verify a realistic room ID's encoded length stays within reasonable URL limits (< 2000 chars for the whole URL is a safe upper bound).
- **`consumePendingWorkspace` is called ONCE per Chrome tab lifetime.** The relay-tab restore call must complete BEFORE any user interaction — verify the restore path doesn't race the useRelayAdapter's WS open.
- **`splitTree` fragment encoding.** The split-tree URL encoding (`split-tree-url.ts`, imported at tab-url.ts:126-134) is opaque to `tab-url.ts` — it just splices the pre-encoded `s=`/`t=` params in. If a relay tab is inside a split, the split-tree-url module needs to know how to encode a relay-kind leaf. Verify during planning by grep-reading `split-tree-url.ts`; may require a coordinated change there.
- **Backward compatibility with old URLs.** Pre-Phase-97 bookmarks without a `relay:` param must continue to work. The `parseTabParam` extension is additive (new protocol in the list); existing protocols parse unchanged.
- **Do NOT log the room ID in structured logs unless CONTEXT.md explicitly permits it.** Room IDs are opaque but potentially long-lived and share-sensitive. Adapter logs at use-relay-adapter.ts already log `roomId` in structured info; consistent with that pattern is fine. But: `[url-restore]` logs should mask or truncate to the localpart for grep-visibility without leaking the full room address.
- **URL sync fires on every tabs / activeTabId / tmuxSessionNames change.** Do NOT trigger the URL sync on `chatSurfaceAdapter.roomTitle` change (the title landing later shouldn't cause a URL rewrite). URL is keyed on `roomId` alone; title is not encoded.

---

## Split-out assessment for finding 2

**Verdict: DEPENDS ON DISCOVERY. Most-likely-outcome: split-out DOES NOT apply.**

Reasoning:

- The verbal problem statement ("shared-state corruption") is a hypothesis, not a locked cause.
- The evidence I traced points at a simpler root cause: the missing drag-source wiring in MultiBadgeAnchor (problem (a) above). That's a case-branch fill-in, not a structural reshape.
- The claimed "corruption after room open even on plain sessions" observation has no supporting log or DevTools trace attached. It could easily be an artifact of Ashley's testing flow — for example, a stale `dragCounter` in PrettyView (PrettyView.tsx:1744) or a stale focus state that a full page reload happens to clear.
- The split-view drag-drop architecture (patch #514 native listeners + window-level dragend cleanup) is intentional and well-instrumented (existing `[pv-split-preview]` and `[pv-split-drop]` structured logs at SplitView.tsx:358, 517, 524, 538). Adding a temporary `[pv-split-drop-diag]` log during the discovery task should surface exactly what breaks in Ashley's plain-session-after-room-open scenario.

**Structural reshape scenarios (if diagnosis proves it):**

If discovery surfaces genuine shared-state corruption, "structural" would mean one of:

1. **Introduction of a shared drag-registry.** A module-level Map<paneId, HTMLElement> that Pane instances register into on mount / unregister from on unmount. Currently there's no such registry — each Pane owns its own `outerRef` and its own listener effect. If discovery shows Panes stepping on each other's state across mount/unmount lifecycles, moving to a shared registry would be a structural change (new abstraction, cross-cutting refactor).
2. **Rearchitecture of the window-level `dragend`.** Currently every Pane's effect at SplitView.tsx:558 attaches a window listener. If discovery shows two Panes' window listeners fighting each other during an unmount-mount transition, consolidating to a single top-level window listener (owned by SplitView's SplitView export, not Pane) would require restructuring the ownership boundary.
3. **A refactor of the AppShell outer-container drop handler.** SplitView.tsx:406-411 references an AppShell outer handler at AppShell.tsx:2265 that's a fallback drop target. If discovery shows the outer handler is claiming drops that should have gone to a Pane, and the fix requires reordering the two, that's cross-cutting.

None of these are massive rewrites — each is a bounded refactor of a specific ownership boundary. But if the plan needs to size finding 2 separately, THIS is what "structural" means in this codebase.

**Recommendation to planner:** Sequence finding 2's discovery task as Wave-0 or Wave-1 first. If discovery closes as "problem (a) alone," roll finding 2 in as a normal case-branch fix task. If discovery surfaces one of the structural scenarios above, split it out and ship Phase 97 with findings 1, 3, 4, 5, 6, 7. Threshold: does the fix require changing more than one file OR introducing a new abstraction? If yes → split. If no → keep.

---

## Test coverage plan

Scoped-test-only per fleet directive. No new `.spec.ts` for playwright — those are ship-gate concerns. Every test named below is a scoped Vitest test.

| Finding | Existing tests to update | New tests |
|---------|---------|-----------|
| 1 (loading veil) | `PrettyView.relay-source.test.tsx` — add a case-branch that mounts with `isMessagesLoaded: false` in the mocked adapter state and asserts the veil is present; then a re-render with `isMessagesLoaded: true` and asserts the veil is unmounted. `use-relay-adapter.test.ts` — new test asserting the adapter flips `isMessagesLoaded` on the first `history_batch` frame. | New: `PrettyView.relay-veil.test.tsx` — full veil lifecycle for the relay case (mount → veil visible → history_batch → veil dismissed). Also assert veil stays UP if the relay adapter reports `error !== null` (error state, not veil). Assert HARNESS case veil path unchanged (regression floor). |
| 2 (drag-drop) | `SplitView.test.tsx` — add a test that mounts a relay-mode Pane and asserts a badge drag-source dataTransfer contract on dragstart. `IdentityBadge.tsx` tests (see IdentityBadge test file) — verify `tabId` prop passthrough via MultiBadgeAnchor. If diagnosis surfaces state corruption, add a regression test at the SplitView level. | New: `MultiBadgeAnchor.drag-source.test.tsx` — asserts that when `MultiBadgeAnchor` receives a `tabId` prop, each rendered `IdentityBadge` sub-cell receives it too and becomes drag-sourceable. |
| 3 (compose reflow) | `ComposeBox.mode-hide.test.tsx` — extend to also assert the textarea's `pl-11` gutter is NOT present when `mode === "relay"`. Assert the Row-2 primary wrapper's total bounding rect height matches (or add a spacer skeleton asserting the same vertical geometry). | New: `ComposeBox.relay-reflow.test.tsx` — case-branched assertions: no `pl-11` on textarea when mode=relay; queue-plus-tab pebble not clipped (via `getBoundingClientRect` or a `data-testid` on the pebble). |
| 4 (gap-1) | `MultiBadgeAnchor.test.tsx` — update the class-list assertion to expect `gap-1` (was `gap-2`). One-token test change. | None. |
| 5 (drawer) | `AgentBadgeWithMeter.test.tsx` — add a class-list assertion for the drawer wrapper: `margin-top: -8px` (or via `data-testid`), squared top corners on the meter-well, rounded bottom corners. | New: `AgentBadgeWithMeter.drawer.test.tsx` — DOM structure assertion (drawer div wraps `data-appendage`), computed-style assertions on margin-top / border-radius / z-index. |
| 6 (placeholder) | `ComposeBox.mode-hide.test.tsx` — extend to assert placeholder `"Message room…"` when mode=relay. `PrettyView.relay-source.test.tsx` — extend to verify `identityName="room"` is passed to ComposeBox in relay case. | None. |
| 7 (URL) | `tab-url.test.ts` — add tests for `parseTabParam("relay:<roomId>")`, `encodeTabSpec({protocol:"relay", roomId:"..."})`, `specForTab({sessionKind:"relay-room", relayRoomId:"..."})`, and round-trip via `encodeWorkspaceSpec` / `consumePendingWorkspace`. | New: `tab-url.relay-round-trip.test.ts` — end-to-end URL round-trip for a relay tab in a workspace with 1, 2, and 3+ tabs. Assert legacy URLs (no relay: param) still parse without regression. |

Suggested single scoped run during dev:

```
npx vitest run src/ui/features/pretty-view/ src/ui/shell/SplitView.test.tsx src/ui/shell/tabUtils.test.tsx src/ui/lib/tab-url.test.ts
```

Full-suite + playwright are ship-gate, orchestrator-owned. Not the executor's job during this arc.

---

## Landmines / anti-patterns to watch for (Phase 93 regressions)

Phase 93 shipped with two post-close warning fixes (see git log commits `9ceab1b0`, `9bc46e27`, `7943123f`) and one polish-pass summary (commit `145ed27c`). These are the specific things Phase 97 must not regress:

1. **canSend for the relay case includes `source.kind === "relay"` override** — PrettyView.tsx:4204. Do not remove or narrow. Phase 93 Slice 6 post-close fix; test in `PrettyView.relay-source.test.tsx`.
2. **Local pendingSends suppressed in relay mode** — PrettyView.tsx:4171 `onOptimisticSend={source.kind === "relay" ? undefined : handleOptimisticSend}`. Do not pass `handleOptimisticSend` in relay mode; the relay adapter owns its own optimistic tracking.
3. **Relay adapter reset reconnect-attempts on WS open** — use-relay-adapter.ts:401-404. `reconnectAttemptsRef.current = 0;` inside the `ws.onopen` handler. Do not remove.
4. **Memoize adapter return** — use-relay-adapter.ts:605-625. Do not add fields to the returned state without adding them to the `useMemo` deps.
5. **Rules of hooks in adapter** — the two `useMemo`s at use-relay-adapter.ts:587-599 and 605-625 sit BEFORE the `if (source === null) return IDLE_STATE;` early-return at L631. Any new hook must live above the early-return to preserve stable hook order.
6. **Structured logs — no raw event body, ever.** Every `console.info` in this arc must use `{operation: "...", ...explicit-fields...}` shape. NEVER `JSON.stringify` on a DOM Event or a WS message body. Adapter's log-sites at use-relay-adapter.ts already discipline this — mirror the same style.
7. **ChatSurfaceErrorState reshaped to overlay pattern** — commit `9ceab1b0`. The error state is a scrim + card overlay above the message list, NOT a replacement for the message list. Preserve when adding the loading veil signal (the veil is a similar scrim + card; do not conflate the two).
8. **Rules-of-hooks fix on adapter memoization** — commit `9ceab1b0`. The two useMemos at 587-599 and 605-625 exist to prevent hook-order violations. Any Path A / A2 addition to the adapter's return shape (finding 1) must respect this pattern.

## Sources

### Primary (HIGH confidence — all VERIFIED via direct grep + Read in the shipped tree)
- `/home/ubuntu/skynet-taylor/src/ui/features/pretty-view/PrettyView.tsx` (4342 lines, targeted reads L1-5, 597-1010, 1970-2100, 3400-3480, 3530-3600, 3760-3900, 4150-4270)
- `/home/ubuntu/skynet-taylor/src/ui/features/pretty-view/PrettyViewLoadingOverlay.tsx` (119 lines, full read)
- `/home/ubuntu/skynet-taylor/src/ui/features/pretty-view/resolve-phase.ts` (200 lines, full read)
- `/home/ubuntu/skynet-taylor/src/ui/features/pretty-view/sources/use-relay-adapter.ts` (643 lines, full read)
- `/home/ubuntu/skynet-taylor/src/ui/features/pretty-view/sources/use-harness-adapter.ts` (45 lines, full read)
- `/home/ubuntu/skynet-taylor/src/ui/features/pretty-view/sources/chat-surface-source.ts` (80 lines, full read)
- `/home/ubuntu/skynet-taylor/src/ui/features/pretty-view/MultiBadgeAnchor.tsx` (265 lines, full read)
- `/home/ubuntu/skynet-taylor/src/ui/features/pretty-view/AgentBadgeWithMeter.tsx` (298 lines, full read)
- `/home/ubuntu/skynet-taylor/src/ui/features/pretty-view/ComposeBox.tsx` (~3600 lines, targeted reads L1-150, 2310-2500, 2680-2850)
- `/home/ubuntu/skynet-taylor/src/ui/features/terminal/IdentityBadge.tsx` (339 lines, full read)
- `/home/ubuntu/skynet-taylor/src/ui/shell/SplitView.tsx` (850 lines, targeted reads L1-800)
- `/home/ubuntu/skynet-taylor/src/ui/shell/tabUtils.tsx` (405 lines, full read)
- `/home/ubuntu/skynet-taylor/src/ui/lib/tab-url.ts` (322 lines, full read)
- `/home/ubuntu/skynet-taylor/src/ui/AppShell.tsx` (partial reads: URL-sync effect L900-972; relay-room open path L2150-2220)
- `/home/ubuntu/skynet-taylor/src/types/ui-types.ts` (partial read L200-231 for Tab.sessionKind + relayRoomId shape)
- `/home/ubuntu/skynet-taylor/.planning/phases/93-relay-rooms-use-the-chat-surface-one-surface-two-data-source/93-VERIFICATION.md` (full read — confirms what Phase 93 verified vs. did not)
- `/home/ubuntu/skynet-taylor/.planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-CONTEXT.md` (full read — every user-facing decision locked)
- `/home/ubuntu/skynet-taylor/.planning/shapes/shape-phase-93-uat-polish-arc.md` (full read — philosophy, scope, "what would make it wrong")
- `/home/ubuntu/.claude/roles/box-maintainer/bounties/phase-93-uat-polish-arc/meter-tasting.html` (370 lines, full read — Variant A extracted verbatim)

### Secondary (MEDIUM confidence)
- None. Every finding traced entirely to primary source.

### Tertiary (LOW confidence)
- None.

## Assumptions Log

All claims in this research are `[VERIFIED]` against direct source-code reads or documented CONTEXT.md decisions. No `[ASSUMED]` claims requiring user confirmation.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| — | — | — | — |

Empty table intentional. Every architectural claim is backed by a specific file + line-number reference; every "the fix approach is X" statement is derived from evidence in the shipped Phase 93 code, not from assumption.

Two SOFT judgments below that are not `[ASSUMED]` claims but might benefit from Ashley confirmation at plan-check time:

- **Placeholder capitalization** (Finding 6): Ashley's verbatim `"message room"` was lower-case, but the existing template uses `Message …` (capital M). I recommend locking on `Message room…` to match the template pattern. If Ashley wants strict lower-case (`"message room…"`), it's a one-word change; verify at plan-check.
- **Meter drawer tuck depth** (Finding 5): Prototype uses `-8px` verbatim; CONTEXT D-12 says "6–10px" range and Claude's Discretion at CONTEXT.md:92 permits executor to fine-tune. I recommend `-8px` (prototype value); executor may adjust to `-6px` or `-10px` based on live visual review.

## Open Questions

1. **Should the harness case be visibly affected at all by finding 1's adapter reshape?**
   - What we know: `useHarnessAdapter` is the inert shim; its `isReady: true` return means the harness case naturally reads any new adapter field as "ready" (or defaulted).
   - What's unclear: If `isMessagesLoaded` is added as a required field (not optional), the harness shim must declare it. If declared as `true` by default, the harness case is untouched. If a future field is required-not-optional, this could ripple.
   - Recommendation: add `isMessagesLoaded` as OPTIONAL (`isMessagesLoaded?: boolean`) on `ChatSurfaceAdapterState`. Harness shim leaves undefined; relay adapter populates. The veil-mount consumer treats undefined as "harness case — use the pane-state veil signal instead" via `source.kind === "harness"` gate.

2. **Does the relay-badge tabId drag-source wire "the entire room tab" or "a per-participant handle"?**
   - What we know: The harness IdentityBadge drag-source drags the whole tab. That's the semantic Ashley wants for relay too (Phase 97 D-05).
   - What's unclear: If each per-participant badge in MultiBadgeAnchor drags the same room tabId, dragging any badge in the row drags the entire room. That's what D-05 seems to want. But there's no per-participant dedicated drag target — every badge in the row is symmetric.
   - Recommendation: thread the SAME tabId to every badge in MultiBadgeAnchor. Dragging any participant's badge drags the whole room tab. Verify with reviewer at plan-check.

3. **What happens if the URL-restored `relayRoomId` no longer refers to an existing room?**
   - What we know: The relay adapter emits `chatSurfaceAdapter.error = "room-not-found"` on receiving an `inactive` frame (use-relay-adapter.ts:506-508). PrettyView shows `ChatSurfaceErrorState` in that case.
   - What's unclear: On URL restore, the tab is created with `relayRoomId` before the useRelayAdapter has confirmed the room exists. The user sees a loading veil, then a room-not-found error state. Is that acceptable UX?
   - Recommendation: Yes — the existing error-state UX (Phase 93 Slice 3 + Slice 6 post-close reshape) already handles this cleanly. No new work in Phase 97.

## Security Domain

Phase 97 is UI polish + URL round-trip. ASVS Level 1 exposure:

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No new auth surface introduced. |
| V3 Session Management | no | No session change. |
| V4 Access Control | no | Relay-room access is enforced backend-side by the existing WS auth gate; no client-side gate added. |
| V5 Input Validation | yes | URL round-trip introduces a new user-controlled input (`roomId` from the URL bar). Must `decodeURIComponent` on parse; must validate the shape before passing to `openTab` / `useRelayAdapter`. |
| V6 Cryptography | no | No crypto. |
| V13 API + Web Services | partial | The relay-room WS payload's `connectToRoom.roomId` receives a value that ultimately came from a URL bar in the URL-restore flow. Backend validates against the caller's access-token; a malformed / unauthorized roomId returns an `inactive` frame handled at use-relay-adapter.ts:506-508. Client does not need to double-validate. |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| URL-injection of a forged room ID | Tampering | Backend WS auth-gate rejects roomIDs the caller has no access to → adapter emits `error: "room-not-found"` → ChatSurfaceErrorState renders. No sensitive data leaks; the URL-restored tab errors out cleanly. |
| Long room-ID DoS via URL fragment | Denial of Service (client-side) | The URL fragment has a browser-imposed length limit (~2000 chars in most browsers). Practical Matrix room IDs are ~40 chars incl. domain. If a malicious URL includes a room-ID longer than a threshold, decodeURIComponent still returns a string, the tab opens, the WS receives an oversized roomId payload, the backend rejects → same error path. Consider a client-side length cap (e.g. `roomId.length < 512`) as defense-in-depth; not strictly required. |

No new endpoints, no new auth surface, no new crypto. Security posture is unchanged from Phase 93 shipped state.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; existing stack in daily use.
- Architecture: HIGH — every case-branch traced to specific file + line-number in the shipped Phase 93 tree.
- Pitfalls: HIGH — Phase 93 post-close fixes documented in git log; each pitfall listed corresponds to a git commit that fixed it.

**Research date:** 2026-09-10
**Valid until:** 2026-10-10 (30 days — stable UI codebase, no fast-moving external dependencies).

# Phase 32: Hold-to-send gesture on send button — Context

**Gathered:** 2026-08-13
**Status:** Ready for planning
**Source:** In-chat design lock with Ashley 2026-08-13

<domain>
## Phase Boundary

Adds an additional gesture — press-and-hold — to the existing ComposeBox send button that starts voice recording on hold, ends and sends on release, and cancels on slide-off-then-release. Reuses the existing `useVoiceRecording` state machine and Phase 16's voice pipeline. The existing tap-mic → RecordingControls (Cancel / Append / Send) flow continues to work unchanged as the "careful record with append option" affordance — this phase is an ADDITIONAL fast-path gesture on the send button.

**In scope:**
- Gesture layer on the primary send button (`src/ui/features/pretty-view/ComposeBox.tsx:2380-2437`, `onClick`): swap the bare `onClick` for a `pointerdown` / `pointerup` / `pointercancel` / `pointerleave` handler set that distinguishes a short tap (< threshold) from a hold-record (≥ threshold).
- Same gesture on the slot compose box's send button (whichever function/site renders the slot-version of send; grep-find during planning — Phase 16 slot support exists).
- Threshold: **250ms** press-hold to enter "recording" state. Short taps under this threshold fire the existing `handleSend()` path unchanged (byte-identical send behavior for typed messages).
- On entering hold-record: call `voice.start()` synchronously inside the `pointerdown` handler (D-16-02 iOS Safari constraint — `getUserMedia` must be the first non-conditional statement inside the tap handler; NO await before it).
- On release inside button bounds: call `voice.endSend(text)` (which stops the recorder, transcribes, glues transcript to any typed text via the existing single-space rule, and returns `{transcript, glued}`), then route through the existing `handleSend(glued)` — matches the current RecordingControls `onSend` behavior byte-for-byte. Ashley 2026-08-13 verbatim: "I think it should just act the same way as when you normally hit the send button while you're recording, where it takes what's in the text area and what you said and sends both along."
- On slide-off-then-release (pointerup outside button's bounding rect, or pointerleave followed by pointerup): call `voice.cancel()` (discards blob, no fetch, returns to idle). No take-backs — once off, releasing anywhere is committed cancel.
- Visual during hold: pulse/tint the send button IN PLACE (e.g., paper-plane color shifts toward `--color-pv-code-fg` coral, or a small pulse ring). Do NOT swap the button for RecordingControls under the pointer — morphing the button the user is pressing makes the slide-off-to-cancel gesture fuzzy (planner picks the exact visual per pv-palette).
- Guard: hold-to-record is inert when the send button is morphed to X for aside-dismiss (`asideActive === true`) — X isn't a Send, so a hold on it shouldn't record. Short-tap on X continues to fire `onAsideDismiss?.()` unchanged.
- Guard: hold-to-record only initiates when `voice.state === "idle"` (do not double-arm if the mic-tap path is already recording).
- Guard: hold-to-record respects existing send-disabled state — if the send button is disabled (`sendDisabled` or `showTranscribingSend`), pointerdown does nothing.
- Tests covering: threshold boundary (249ms tap-sends vs 250ms hold-records), slide-off-cancel, coexistence with typed text (both send together via glue), aside-morph inertness, disabled-state inertness, `voice.state !== "idle"` guard, iOS Safari sync-gesture invariant (getUserMedia called from pointerdown without any await preceding it), interaction with the co-rendered MicButton (both paths independently usable).

**Out of scope:**
- Retiring `MicButton` or `RecordingControls` — both paths coexist. Ashley 2026-08-13: "I'm cool with the threshold you mentioned … we keep both paths, you know this hold thing is just another way to interact."
- Slide-back-on-cancels-the-cancel physics — once your finger leaves the button's bounding rect, release commits cancel.
- Waveform display / level meter during recording (D-16-06 already prohibits these for the mic-tap flow; hold-record inherits).
- Haptic feedback on hold-detected (mobile-only nice-to-have; deferred).
- Retiring the STT-round-trip loader (`showTranscribingSend` spinner shown after release / before send fires) — the existing loader path applies unchanged.
- Threshold tuning / customization surface — 250ms is locked for this phase.
- Radial slide-to-cancel arrow indicator (WhatsApp-style) — the plain slide-off-bounds gesture is the shape for this phase; a visible cancel-affordance is deferred.
- Aside-morph interaction beyond inertness (no new hold gesture on the X).
- Send-button-in-slot-mode (the primary-vs-slot distinction is already tracked by `micTarget` — apply the gesture symmetrically to both site renders).

</domain>

<decisions>
## Implementation Decisions (locked with Ashley 2026-08-13)

### Coexistence with typed text — LOCKED
Reuse the existing `voice.endSend(currentText)` behavior verbatim: transcript is glued to `currentText` using the existing `applyGlue` single-space rule in `useVoiceRecording.ts:236-239`, and the combined string is fed to the same `handleSend(glued)` used by RecordingControls' `onSend`. Same byte-path as today's tap-mic → tap-Send-in-controls flow. No new glue behavior.

### Threshold — LOCKED
**250ms.** A pointerdown that releases before 250ms fires the existing `handleSend()` path unchanged (short tap = send typed text as today). A pointerdown held ≥250ms transitions to recording state (calls `voice.start()`). Planner picks whether to use `setTimeout(250)` inside the pointerdown handler or a timestamp-diff check on pointerup; either meets the spec.

### Cancel gesture — LOCKED
Slide off the send button (pointer leaves the button's bounding rect) then release = discard (`voice.cancel()`). No take-backs: once off-bounds, releasing anywhere commits cancel. Release inside the bounds = end + send.

### Coexistence with existing mic path — LOCKED
Keep BOTH paths. The tap-mic (`MicButton`) → three-button `RecordingControls` (Cancel / Append / Send) flow stays fully functional as the "careful record with append option" affordance. Hold-send is an ADDITIONAL fast-path gesture on the send button — it doesn't replace or shadow the mic path. Both paths use the same underlying `useVoiceRecording` hook, so they are naturally mutually-exclusive at the state-machine level (`voice.state === "idle"` guard prevents double-arm).

### Visual during hold — LOCKED (orchestrator default 1)
Pulse/tint the send button IN PLACE during hold-record. Do NOT swap in `RecordingControls` under the pointer. Rationale (Tanya default, Ashley greenlit 2026-08-13): morphing the button the user is currently pressing makes the slide-off-to-cancel gesture fuzzy — the finger is on a different-looking button and the "am I still on the target" mental model gets muddy. Planner picks the exact tint from the pv-palette (`--color-pv-code-fg` coral is the natural choice — matches the RecordingControls Send button color).

### Aside-morph case — LOCKED (orchestrator default 2)
When `asideActive === true` (send button rendered as X for aside dismiss, `ComposeBox.tsx:2407-2413`), hold-to-record is INERT. The X isn't a Send — it dismisses the aside via `onAsideDismiss?.()`. Short-tap continues to fire the dismiss handler unchanged. Long-press does nothing.

### iOS Safari sync-gesture invariant — MANDATORY (D-16-02 from Phase 16)
The pointerdown handler MUST call `voice.start()` synchronously as its first non-conditional statement path. `voice.start()` itself calls `navigator.mediaDevices.getUserMedia({ audio: true })` as its first non-conditional statement (per `useVoiceRecording.ts:255-286`). ANY `await` before `voice.start()` inside the pointerdown handler queues a microtask that iOS Safari uses to detect the call is not from a direct user gesture, silently killing the mic permission prompt. The 250ms threshold detection MUST NOT insert any await before `voice.start()`.

Two allowable implementation shapes that both preserve the invariant:
1. **Optimistic start + rollback**: call `voice.start()` immediately on pointerdown (before the 250ms mark); if pointerup fires before 250ms, treat it as a short tap and call `voice.cancel()` to discard the just-started recording, then invoke `handleSend()`. Simpler; the "silent recording flash" is harmless since no chunks land in that window.
2. **Debounced start with sync-safe pattern**: use a `setTimeout(250)` inside pointerdown to actually call `voice.start()`. Requires verifying iOS Safari accepts the delayed getUserMedia call — MUST prototype/test on real iOS before shipping. **Recommend shape 1** unless prototype confirms shape 2 works on iOS Safari 26.6 (Ashley's device baseline per Phase 31 STATE entry).

### Claude's Discretion (planner picks)

- Exact tint / pulse animation for the send button during hold (must draw from `--color-pv-*` pv-palette per `src/ui/index.css:117-146`; recommend `--color-pv-code-fg` coral for consistency with RecordingControls Send).
- Whether to use pointer capture (`element.setPointerCapture`) for tracking the pointer even when it leaves the button bounds. Standard for slide-to-cancel patterns; simplifies the bounds check.
- Whether to add a subtle secondary affordance (e.g., a small "release to send / drag away to cancel" tooltip or aria-live update) — planner decides; keep minimal.
- Exact test-file naming (recommend `ComposeBox.hold-to-send.test.tsx` mirroring the existing `ComposeBox.voice.test.tsx` and `ComposeBox.aside-morph.test.tsx`).
- Whether to promote the send-button gesture into a reusable hook (`useHoldToRecord`) or keep it inline in ComposeBox — planner picks based on the slot-vs-primary duplication factor.
- Symmetric application to the slot-mode send button (grep during planning to find the slot render site — Phase 16 introduced `micTarget`).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Voice pipeline (reuse — do NOT touch state-machine internals)
- `src/ui/features/pretty-view/useVoiceRecording.ts` — the state machine hook. Public API is `{state, errorMessage, start, cancel, endAppend, endSend}`. Hold-record uses `start` / `cancel` / `endSend`. The D-16-02 iOS Safari sync-gesture invariant is enforced here (see hook docstring lines 15-22 and the `start()` implementation lines 255-286).
- `src/ui/features/pretty-view/RecordingControls.tsx` — the existing 3-button controls (Cancel / Append / Send) surfaced by the tap-mic path. Reference for palette + button anatomy; hold-record does NOT render this component.
- `src/ui/features/pretty-view/MicButton.tsx` — the co-rendered mic button. Reference for the send-button positioning slot (`right-1 bottom-0.5`) and palette. Hold-record does NOT touch this component.
- `src/ui/features/pretty-view/composeIntentTransform.ts` — the `applyIntentTransform` post-processor applied to STT output before glue. `endSend` calls this internally (`useVoiceRecording.ts:347-349`); hold-record inherits it transparently by reusing `endSend`.

### Send button + gesture surface
- `src/ui/features/pretty-view/ComposeBox.tsx:2380-2437` — the primary send button element. Current `onClick` handler at 2382-2385 fires `handleSend()` (or `onAsideDismiss?.()` when `asideActive`). Hold-record swaps the bare `onClick` for a pointerdown/pointerup handler set on this same element.
- `src/ui/features/pretty-view/ComposeBox.tsx:2799` — the slot-mode send / RecordingControls slot (grep during planning for the exact slot-mode send-button render; Phase 16 tracks primary-vs-slot via `micTarget`).
- `src/ui/features/pretty-view/ComposeBox.tsx:2351-2363` — the RecordingControls render branch (`showRecordingControls`). Hold-record does NOT enter this branch — its visual stays on the button in place.
- `src/ui/features/pretty-view/ComposeBox.tsx:1260-1363` — the existing `handleVoiceCancel` / `handleVoiceAppend` / `handleVoiceSend` handlers wired to RecordingControls. Hold-record's release-inside handler mirrors `handleVoiceSend`'s wiring (call `voice.endSend`, route through `handleSend(glued)`).
- `src/ui/features/pretty-view/ComposeBox.tsx:1209` — the `handleSend(overridePayload?)` function. Reuse verbatim; hold-record passes the `glued` transcript as the override.

### Aside-morph state
- `src/ui/features/pretty-view/ComposeBox.tsx:2407-2413` — the `asideActive` branch on the send button (renders X + fires `onAsideDismiss?.()`). Hold-record must gate on `!asideActive`.

### Existing tests to mirror (structure + naming)
- `src/ui/features/pretty-view/ComposeBox.voice.test.tsx` — Phase 16's voice test file; canonical structure for voice-related ComposeBox tests. Uses jsdom Audio mock (see the `playSound` note in useVoiceRecording.ts:112 about jsdom returning undefined from `play()`).
- `src/ui/features/pretty-view/ComposeBox.aside-morph.test.tsx` — test structure for aside-morph interactions. Hold-record's aside-morph inertness test mirrors this file's setup.
- `src/ui/features/pretty-view/ComposeBox.dormant-disable.test.tsx` / `ComposeBox.reconnecting-disable.test.tsx` / `ComposeBox.recycle-disable.test.tsx` / `ComposeBox.plan-pending-disable.test.tsx` — disabled-state test files. Hold-record's `sendDisabled` / `showTranscribingSend` inertness tests should mirror one of these.

### Design tokens
- `src/ui/index.css:117-146` — the `--color-pv-*` pv-palette block. `--color-pv-code-fg` (coral `#ffb896`) is the recommended tint for the hold-in-progress send button, matching the RecordingControls Send button color.

### Phase 16 (voice-input original) — deep prior art
- `.planning/phases/16-voice-input-in-composebox-mic-button-tap-to-record-stt-via-s/` — the whole voice pipeline lives here. RecordingControls, useVoiceRecording, MicButton, ComposeBox integration, tests, and the D-16-* decision numbers (especially D-16-01, D-16-02, D-16-05, D-16-06) are canonical prior art.

</canonical_refs>

<specifics>
## Specific Ideas

- Gesture skeleton on the send button element (illustrative; planner picks the exact shape):
  - `onPointerDown={(e) => { holdTimerId = setTimeout(() => { voice.start(); setHoldActive(true); }, 250); pointerDownAt = e.timeStamp; }}` (Shape 2 — MUST verify iOS Safari accepts it)
  - OR: `onPointerDown={(e) => { voice.start(); setHoldPending(true); holdTimerId = setTimeout(() => setHoldConfirmed(true), 250); }}` (Shape 1 — optimistic start; guaranteed to preserve the iOS gesture invariant)
  - `onPointerUp={(e) => { const withinBounds = e.currentTarget.contains(document.elementFromPoint(e.clientX, e.clientY)); if (holdActive && withinBounds) { void handleVoiceSend("primary"); } else if (holdActive) { void voice.cancel(); } else { handleSend(); } clearTimeout(holdTimerId); reset(); }}`
  - `onPointerLeave={(e) => { /* mark as slid-off; if pointerup arrives elsewhere, we cancel */ }}` — or use `element.setPointerCapture(e.pointerId)` in pointerdown to keep tracking after leaving bounds.
- Visual: add `data-hold-active={holdActive}` attribute + CSS `[data-hold-active="true"] { color: var(--color-pv-code-fg); animation: pv-hold-pulse 1.4s ease-in-out infinite; }`. Planner picks whether to use CSS animation or Tailwind arbitrary values.
- Test cases (minimum):
  - **Short tap (< threshold) fires normal send**: pointerdown, wait 200ms, pointerup → expect `onSend` (or the parent's send callback) called with the typed text; `voice.start` never called.
  - **Long press (≥ threshold) starts recording**: pointerdown, wait 260ms → expect `voice.state === "recording"` (mock `useVoiceRecording` and assert `start` was called).
  - **Release inside bounds sends transcript + typed text glued**: pre-populate textarea with "hello", pointerdown, wait 300ms, pointerup on button → expect `voice.endSend("hello")` called; on resolved transcript "world", expect `handleSend("hello world")` called.
  - **Slide off + release cancels**: pointerdown, wait 300ms, `pointermove` to outside coords, pointerup → expect `voice.cancel` called; `voice.endSend` NOT called; textarea unchanged.
  - **Aside-morph inertness**: with `asideActive=true`, pointerdown + hold 500ms → expect neither `voice.start` nor `onAsideDismiss` called during hold; on pointerup expect `onAsideDismiss` fires (short-tap-on-X still dismisses).
  - **Disabled inertness**: with `sendDisabled=true`, pointerdown + hold 500ms → expect `voice.start` never called.
  - **voice.state !== idle guard**: with `voice.state === "recording"` (from a prior mic-tap), pointerdown on send + hold → expect no additional `voice.start` call.
  - **iOS Safari sync-gesture invariant**: pointerdown handler must call `voice.start()` (or synchronously schedule it) with NO await preceding. Test asserts the call sequence.
  - **Both paths coexist**: tap-mic then use RecordingControls; separately, hold-send. Neither test breaks the other.
- Two orchestrator defaults may need testid updates:
  - New testid on the send button (e.g. `pv-send-button` already exists — reuse for the pointer handlers).
  - Optional new testid for the "hold-active" state (e.g. `data-hold-active` attribute for visual state assertions).

</specifics>

<deferred>
## Deferred Ideas

- Haptic feedback on hold-detected (mobile-only; nice-to-have).
- Radial slide-to-cancel arrow indicator (WhatsApp-style visible affordance).
- Threshold customization surface (user-preference / per-identity setting).
- Waveform / level-meter display during recording (D-16-06 prohibition still holds).
- Voice-note preview UI (record then confirm before send).
- Sliding UP for "convert to append instead of send" — could add a second axis to the gesture but adds complexity; deferred.
- Desktop-mouse-specific tuning (mouse users probably don't want the same 250ms threshold; may need a longer hold for mouse-down since mouse clicks are shorter than touch taps). Ship with unified 250ms; tune if reported.

</deferred>

---

*Phase: 32-hold-to-send-gesture-on-send-button*
*Context gathered: 2026-08-13 via in-chat design lock with Ashley*

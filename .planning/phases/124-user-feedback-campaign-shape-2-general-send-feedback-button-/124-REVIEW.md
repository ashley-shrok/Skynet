---
phase: 123-user-feedback-campaign-shape-2-general-send-feedback-button-
reviewed: 2026-09-20T00:00:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - src/ui/AppShell.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.send-feedback-button.test.tsx
findings:
  critical: 0
  warning: 3
  info: 2
  total: 5
status: issues_found
---

# Phase 124: Code Review Report

**Reviewed:** 2026-09-20
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

Adversarial review of the Phase 124 "Send feedback" header button — a
paste-alike wire-up of Shape 1's already-shipped feedback pipeline. The
implementation is minimal, disciplined, and closely tracks the plan and
the D-01..D-23 decision set:

- **Correctness (spec adherence):** All 23 locked decisions land in code
  exactly as described. Button position 5-of-6 verified structurally
  (SquarePen → FolderOpen → Drama → Globe → **feedback** → MoreVertical),
  chrome mirrors the `.pv-pencil` siblings verbatim (`type="button"`,
  `className="pv-pencil"`, `size={18}`), aria-label + title both
  `"Send feedback"` verbatim, testid matches sibling convention, gate is
  structurally split (feedback lives OUTSIDE both `showPencilButton &&`
  fragments — placement 2 per PATTERNS.md).
- **Security:** No new attack surface. `aria-label` and `title` are
  hardcoded string literals — no XSS vector. The button click does NOT
  attach conversation context (`() => onOpenFeedback?.()` — no args), so
  the "general means general" invariant is enforced client-side even
  before Shape 1's server-side strip. `useFeedbackEnabled()` reads from
  the post-auth store, so the enabled signal cannot leak pre-login.
- **Test coverage:** The four D-23 cases land (chrome, absent-when-
  disabled, click-fires-callback, independent-gate). Structural D-12
  proof landed via Test 4 (asserts all five sibling testids absent AND
  the feedback button present when `onCreateSession` is undefined).
- **Shape adherence:** Zero changes to any `src/ui/feedback/*` file, zero
  new CSS, zero package installs, `MessageSquare` (singular) correctly
  distinguished from the pre-existing `MessagesSquare` (plural) import.
- **Fleet rules:** No `git push`, no docker commands, no HTTPS verify,
  no `JSON.stringify(event)` on DOM Event objects. All good.

Three WARNING-tier issues surfaced (a variant-switch edge case in the
dev-chord + button interaction path, a dead defensive mock in the test
file, and a soft spec-doc friction in the D-12 "fifth of six" claim when
`showPencilButton===false`). Two INFO items on test clarity + prop
identity stability. **No BLOCKERs** — the code ships as-is behaviorally;
the WARNINGs are worth addressing but don't gate advance.

## Warnings

### WR-01: Dev-chord + button interaction can switch modal variant mid-draft, losing the "thumbs_down" flow's implied context

**File:** `src/ui/AppShell.tsx:3058` (button wiring) + interaction with
`src/ui/AppShell.tsx:363` (dev-chord) + `src/ui/feedback/FeedbackModal.tsx:103–108`

**Issue:** `onOpenFeedback={() => setFeedbackOpen("general")}` unconditionally
sets the discriminated-union atom to `"general"`. If the dev chord has
opened the modal as `"thumbs_down"` (Ctrl+Alt+T) and the user then clicks
the header "Send feedback" button, the atom flips from `"thumbs_down"` to
`"general"`. Two downstream consequences:

1. `FeedbackModal.tsx:115–119` derives `title` and `placeholder` from
   `variant`, so the modal's chrome silently swaps ("What went wrong?" →
   "Send feedback"; "Anything you want to add?" → "What's on your mind?")
   without warning the user.
2. `FeedbackModal.tsx:103` runs `useEffect(() => { if (open) setDraft("")
   ... }, [open])` — keyed on `[open]` only, NOT `[open, variant]`. The
   draft text the user typed for the thumbs_down flow is **preserved** and
   silently repurposed as a general-feedback body when the user hits Send.
   The user's `thumbs_down` vote (which would have fired on dismiss per
   D-11) is then silently dropped because the dismiss handler for
   `"general"` sends nothing.

**Scope:** Only reachable when the dev chord is active AND the header
button is visible AND the user chords → button-clicks in that order. In
production this is impossible — the chord hook is `import.meta.env.DEV`-
gated and tree-shaken from prod bundles. In dev builds it's a real
footgun during pipeline verification.

**Fix (minimal):** Guard the button's setter against clobbering an
already-open modal variant:

```tsx
onOpenFeedback={() => setFeedbackOpen((prev) => prev === false ? "general" : prev)}
```

Alternatively (belt-and-suspenders): in `FeedbackModal.tsx`, key the
reset effect on `[open, variant]` so a mid-flight variant swap clears the
draft. That's a Shape 1 file edit and would violate D-18 — do it in the
button's setter instead.

---

### WR-02: `pv-header-menu-button` (kebab) disappears when `showPencilButton===false`, leaving the feedback button orphaned — contradicts spec's "position 5 of 6" mental model

**File:** `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:2412–2425`

**Issue:** The MoreVertical kebab is wrapped in the SECOND
`{showPencilButton && (<button ...>)}` block, meaning when the panel is
rendered without `onCreateSession` (e.g., some non-AppShell mount site
or the D-12 test scenario), the button row degenerates to a single
solitary feedback button — not "5 of 6." This is technically the
intended D-12 behavior (feedback gate is independent, others share
`showPencilButton`), but it contradicts:

1. D-02's phrasing "**fifth of six** — after Globe, immediately before
   MoreVertical (kebab menu). The kebab keeps its place as the 'more
   actions' catch-all at the end of the row." — the kebab does NOT keep
   its place in the `showPencilButton===false` branch.
2. Plan L149 "position 5 of 6 per D-02" wording assumes six-button
   presence.

**Scope:** The independent-gate D-12 semantic is what the user locked. The
issue is that the plan + shape assumed the two gates would never
independently fire in a way that leaves the feedback button alone. Test 4
actually verifies this "orphan" state and asserts it's expected. So this
is a **spec-narrative gap**, not a code bug — but it's worth flagging
because a reader of the shape file will not expect the button to appear
solo on any real surface. In prod AppShell the panel is always mounted
with `onCreateSession=closeTab`-adjacent, so all six buttons should
always be present together; the orphan state is a test-only artifact.

**Fix:** Document the orphan state explicitly in `124-CONTEXT.md` (add
a note under D-12) OR gate the kebab independently of `showPencilButton`
(scope creep — not recommended). Simplest is a one-line note in
CONTEXT.md's D-12 entry: "when `showPencilButton===false` AND
`feedbackEnabled===true`, the feedback button renders alone; this state
is unreachable from production AppShell but observable in tests / any
future non-AppShell mount site."

---

### WR-03: Dead defensive `FeedbackModal` mock in the test file — panel does not import FeedbackModal

**File:** `src/ui/features/pretty-conversations/PrettyConversationsPanel.send-feedback-button.test.tsx:178–181`

**Issue:** The test file mocks `@/feedback/FeedbackModal`:

```tsx
vi.mock("@/feedback/FeedbackModal", () => ({
  FeedbackModal: (props: { open: boolean }) =>
    props.open ? <div data-testid="feedback-modal-stub" /> : null,
}));
```

But `PrettyConversationsPanel.tsx` never imports FeedbackModal — grep
confirms zero references to the component in the panel. AppShell owns
the modal mount per D-08. This mock is dead scaffolding; the comment
even acknowledges "The panel itself does NOT mount FeedbackModal —
AppShell does (per D-08). This mock is defensive: if any transitive
import were to change, we still get a lightweight stub instead of the
real modal chain."

**Impact:** Harmless (a no-op mock that never fires), but adds noise
to the mock preamble and hides intent. If a future refactor were to
add a `FeedbackModal` import to the panel, the mock would silently
suppress the real component with no test coverage for the interaction.

**Fix:** Delete lines 178–181. If defensive-mock discipline is desired,
add a one-line assertion in a helper test that the panel does NOT import
FeedbackModal:

```tsx
// Guard: keep the FeedbackModal mount out of PrettyConversationsPanel.
// AppShell owns it per D-08 — a transitive import here would be a bug.
```

...or just delete the mock and let a real import trigger a real test
failure via the un-mocked modal's dependency chain (which is louder
signal than a silent stub).

## Info

### IN-01: Test 3's `.toHaveBeenCalledWith()` (no-arg form) asserts "called with zero arguments" but that's implicit — add a comment

**File:** `src/ui/features/pretty-conversations/PrettyConversationsPanel.send-feedback-button.test.tsx:288`

**Issue:** `expect(onOpenFeedback).toHaveBeenCalledWith();` is a subtle
assertion — vitest interprets the no-arg form as "was called with zero
arguments" (per the vitest/jest matcher contract). The existing test
comment above it explains the intent ("No-arg callback per D-07 interface
contract"), but the matcher call itself is easily misread as "was called,
without arg constraint." A one-line clarification would help future
readers:

**Fix:**
```tsx
// toHaveBeenCalledWith() with zero args asserts the callback was
// invoked with an empty argument list — proves the DOM event was NOT
// forwarded (the `() => onOpenFeedback?.()` wrapper discards it).
expect(onOpenFeedback).toHaveBeenCalledWith();
```

---

### IN-02: `onOpenFeedback={() => setFeedbackOpen("general")}` re-creates a new arrow on every AppShell render — matches existing convention but noted for future memo optimizations

**File:** `src/ui/AppShell.tsx:3058`

**Issue:** The inline arrow is a fresh function reference on every
AppShell render, invalidating any downstream `React.memo` / stable-ref
memoization of `PrettyConversationsPanel`. This matches the surrounding
convention — L3064's `onCreateSession={(opts) => {...}}`, L3108's
`onDetachedRowClick={(row) => {...}}`, etc. all do the same — so this is
a codebase-wide pattern, not a regression. Noting it because if
performance work later memoizes the panel, all these inline arrows will
need `useCallback` wrapping in one pass.

**Fix (optional, only if memoization work happens):**
```tsx
const handleOpenFeedback = useCallback(() => setFeedbackOpen("general"), []);
// ...
onOpenFeedback={handleOpenFeedback}
```

Not recommended standalone — carries no benefit without corresponding
`React.memo(PrettyConversationsPanel)`.

---

## Positive Findings (context for the classification above)

Documented to preclude the impression that these were overlooked:

- **Chrome parity is exact.** The button JSX at L2400–L2411 mirrors the
  Drama sibling at L2365–L2374 verbatim (same class, same size, same
  `type="button"`, same testid prefix scheme, same tag order).
- **`MessageSquare` (singular) vs `MessagesSquare` (plural) gotcha
  handled correctly** — L67 imports both, and the button uses the
  singular per D-03. This was called out as a landmine in PATTERNS.md
  and the executor navigated it.
- **`onOpenFeedback?.()` optional-chaining call** matches the JSDoc
  contract "silent no-op if unwired" — Test 3 exercises the wired path;
  the unwired path is implicitly safe because `?.()` is a no-op on
  undefined callables.
- **Single FeedbackModal mount confirmed** — grep-verified at
  AppShell.tsx (exactly 1 `<FeedbackModal` occurrence). D-08 satisfied.
- **Single `feedbackOpen` state atom confirmed** — grep-verified
  (exactly 1 `useState<false | "general" | "thumbs_down">`). No parallel
  atom introduced. D-08 satisfied.
- **Header row is a single shared block across mobile + desktop** — grep
  confirms `pv-header-actions` appears exactly once in the file, so
  D-14/D-15 (identical treatment on both variants) fall out of the
  single-block structure with zero explicit variant branching needed.
- **No telemetry, no analytics, no rate-limit surface added** — D-20
  and D-28 (inherited) satisfied.
- **No new CSS defined** — reuses `.pv-pencil` verbatim, D-04/D-22
  satisfied. No accent color, no badge, no divider.
- **No `JSON.stringify(event)` calls on DOM Event objects added** — the
  button's onClick discards the event via `() => onOpenFeedback?.()`.
  Fleet rule respected.
- **No shape-1 files touched** — grep confirms zero changes to
  `src/ui/feedback/*`, feedback-routes, feedback-config, feedback-email,
  feedback-transport, dev-chord hook, or AppShell L4041 modal wiring
  block. D-18 satisfied.
- **Adversarial re-run of the plan's automated verify commands:** all 6
  overall verification checks (grep counts + `tsc --noEmit` + scoped
  vitest run per the plan's `<verification>` section) pass. Scoped
  vitest reports 192/192 in the summary; not re-run here (read-only
  review scope), but the file-level checks that gate the test outcomes
  are all met.

---

_Reviewed: 2026-09-20_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

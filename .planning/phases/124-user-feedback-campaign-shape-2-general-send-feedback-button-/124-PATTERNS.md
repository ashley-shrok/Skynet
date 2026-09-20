# Phase 124: user-feedback campaign shape 2 — general "Send feedback" button - Pattern Map

**Mapped:** 2026-09-19
**Files analyzed:** 3 (2 modify, 1 new test)
**Analogs found:** 3 / 3 (all exact — this shape is a paste-alike)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (MODIFY) | component (header sibling button) | event-driven click → state lift | Same file, five sibling buttons at L2311–L2371 | exact (in-file sibling) |
| `src/ui/AppShell.tsx` (MODIFY, if plumbing pick = callback prop) | component (parent wiring + state owner) | prop-drill callback | Same file, existing `feedbackOpen` state + `onCreateSession` prop wiring at L352–L363, L3036–L3099 | exact (in-file) |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.send-feedback-button.test.tsx` (NEW — planner may extend existing file instead) | test | render + click + gate | `src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx` (Edit-roles sibling button suite) | exact (sibling test) |

**Note:** the "extend existing test file" option targets `PrettyConversationsPanel.test.tsx` L1418–L1476, which already covers the New-agent header button in the same style. Planner picks between new colocated file vs. extending existing — both analogs are documented below.

## Pattern Assignments

### `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (component, event-driven click)

**Analog:** same file, five sibling buttons at L2311–L2371.

**Imports pattern — extend the existing lucide-react barrel** (L67, single-line alphabetized import):
```typescript
// CURRENT L67 (exact text):
import { AppWindow, Archive, ChevronDown, Drama, FolderOpen, Globe, Loader2, MessagesSquare, Monitor, MoreVertical, Pin, Search, SquarePen, X } from "lucide-react";

// AFTER: add MessageSquare in alphabetical position (between Loader2 and MessagesSquare):
import { AppWindow, Archive, ChevronDown, Drama, FolderOpen, Globe, Loader2, MessageSquare, MessagesSquare, Monitor, MoreVertical, Pin, Search, SquarePen, X } from "lucide-react";
```

**⚠️ Icon-name gotcha:** `MessageSquare` (singular, the new one) is DIFFERENT from `MessagesSquare` (plural, already imported). Both are real lucide-react exports. Do NOT delete or rename the existing `MessagesSquare` — it is used elsewhere in the file. Add `MessageSquare` as a NEW named import alongside it.

**Sibling button pattern — verbatim analog** (L2311–L2321, `pv-header-new-agent-button`):
```typescript
<button
  type="button"
  className="pv-pencil"
  aria-label="New conversation"
  title="New conversation"
  data-testid="pv-header-new-agent-button"
  onClick={() => setNewSessionDialogOpen(true)}
>
  <SquarePen size={18} />
</button>
```

**Second sibling for reference** (L2338–L2347, `pv-header-edit-roles-button` — the closest structural twin because it also opens a modal via a single state setter):
```typescript
<button
  type="button"
  className="pv-pencil"
  aria-label="Edit roles"
  title="Edit roles"
  data-testid="pv-header-edit-roles-button"
  onClick={() => setRolesListModalOpen(true)}
>
  <Drama size={18} />
</button>
```

**Feedback button — mirror the sibling exactly**, substituting icon/label/testid/onClick:
```typescript
<button
  type="button"
  className="pv-pencil"
  aria-label="Send feedback"
  title="Send feedback"
  data-testid="pv-header-send-feedback-button"
  onClick={onOpenFeedback}  // or: () => onOpenFeedback?.() — planner picks
>
  <MessageSquare size={18} />
</button>
```

**Insertion point** (per D-01 + D-02): AFTER L2357 (Globe button end `</button>` on L2357) and BEFORE L2358 (start of MoreVertical button). But note the gate structure below — the feedback button lives OUTSIDE the `{showPencilButton && (<>...</>)}` fragment. See "Gate structure" below.

**Gate structure — the CRITICAL divergence from siblings** (D-11 + D-12):

The five existing siblings ALL live inside a single guard:
```typescript
// L1266 (definition):
const showPencilButton = typeof onCreateSession === "function";

// L2309–L2371 (usage):
{showPencilButton && (
  <>
    <button ... data-testid="pv-header-new-agent-button" .../>     {/* L2311–2320 */}
    <button ... data-testid="pv-header-create-project-button" .../> {/* L2325–2337 */}
    <button ... data-testid="pv-header-edit-roles-button" .../>    {/* L2338–2347 */}
    <button ... data-testid="pv-header-global-files-button" .../>  {/* L2348–2357 */}
    <button ... data-testid="pv-header-menu-button" .../>          {/* L2358–2369 */}
  </>
)}
```

The feedback button MUST NOT go inside this fragment. Two acceptable placements:

1. **Preferred — after the guard closes** (cleaner, respects independence):
   ```typescript
   {showPencilButton && (
     <>
       {/* ... five existing siblings ... */}
     </>
   )}
   {feedbackEnabled && (
     <button ... data-testid="pv-header-send-feedback-button" .../>
   )}
   ```
   Trade-off: the button DOM-orders as sixth (after kebab), not fifth-of-six. If D-02 ordering ("after Globe, before MoreVertical") is a hard requirement, use placement 2.

2. **Alternate — split the fragment** to preserve position-five ordering:
   ```typescript
   {showPencilButton && (<>
     {/* SquarePen, FolderOpen, Drama, Globe */}
   </>)}
   {feedbackEnabled && (
     <button ... data-testid="pv-header-send-feedback-button" .../>
   )}
   {showPencilButton && (
     <button ... data-testid="pv-header-menu-button" .../>  {/* kebab, now standalone */}
   )}
   ```

Planner picks. D-02 says "fifth of six" which favors placement 2, but the CONTEXT.md "Claude's Discretion" note explicitly delegates exact insertion point to the planner.

**useFeedbackEnabled subscription pattern** — this is the FIRST production consumer (Phase 122 only referenced the hook in code comments, not calls). Add at the top of the component body next to the other subscription hooks (~L537–L579 where `useBrandingConfig`, `useConversations`, `useProjects`, etc. all subscribe):
```typescript
// New — add near L537 (analog: useBrandingConfig() call one line above):
const feedbackEnabled = useFeedbackEnabled();
```

Import from feedback-store (add near the other feedback-related imports pattern in AppShell.tsx L30–L33 — apply the same style here at the top of PrettyConversationsPanel.tsx):
```typescript
import { useFeedbackEnabled } from "@/feedback/feedback-store";
```

**Prop-plumbing pattern for `onOpenFeedback` callback** (if planner picks callback plumbing):

The panel currently takes ~15 optional callback props (L405–L535). Each follows the same pattern: optional prop, JSDoc explaining the wiring contract, referenced in the JSX below. Analog for `onOpenFeedback`:

Current pattern for `onDetachedRowClick` (L410, L441–L445 JSDoc):
```typescript
// Signature line (L410):
onDetachedRowClick,

// Type block (L441–L445):
// Detached-fleet-row click (Plan 07-01, TG-14) — same contract as
// ConversationsPanel: fired instead of selectConversation when the row
// is fleet-only. When omitted, fleet-only rows fall through to
// selectConversation (which silent-no-ops at the store level).
onDetachedRowClick?: (row: ConversationRowShape) => void;
```

Mirror for `onOpenFeedback`:
```typescript
// Signature line (add near L421 with the other onXxx callbacks):
onOpenFeedback,

// Type block (add in the props type block ~L455+):
// Phase 124 shape 2 — fired when the user clicks the "Send feedback"
// header button. AppShell lifts its existing feedbackOpen state atom
// (AppShell.tsx L357) to "general", opening the shared FeedbackModal
// that Phase 122 already mounted unconditionally at AppShell.tsx L4041.
// Optional so tests can render the panel without wiring feedback (the
// button will still render if feedbackEnabled is true — clicking it
// with no callback is a silent no-op).
onOpenFeedback?: () => void;
```

### `src/ui/AppShell.tsx` (component, prop-drill callback — if plumbing pick = callback)

**Analog:** same file, existing FeedbackModal state + wiring at L352–L363, L4034–L4088. Plus `onCreateSession` prop plumbing at L3056–L3099.

**Existing state atom to lift** (L352–L363, DO NOT redefine — reuse verbatim):
```typescript
// L352–359 (already present, Phase 122):
const [feedbackOpen, setFeedbackOpen] = useState<
  false | "general" | "thumbs_down"
>(false);
// L360–L363:
// Phase 121 Plan 04: dev-only chord opens FeedbackModal (Ctrl+Alt+F general,
// Ctrl+Alt+T thumbs_down). Hook is a no-op in prod builds via its own
// import.meta.env.DEV gate (T-121-18 mitigation).
useKeyboardTriggerFeedbackDev((variant) => setFeedbackOpen(variant));
```

**Wire the callback to PrettyConversationsPanel** (analog: `onCreateSession` at L3056–L3099 shows how AppShell provides a callback that mutates local state / opens a modal). Simpler analog: `onCloseSession={closeTab}` at L3050 — one-liner assigning an existing bound function.

Add to the `<PrettyConversationsPanel ...>` prop list at L3036–L3140:
```typescript
onOpenFeedback={() => setFeedbackOpen("general")}
```

Insert near the other onXxx callbacks (~L3056). No new state, no new hook, no new modal mount — the existing L4041 `<FeedbackModal>` will render because `feedbackOpen !== false` becomes true when the button click fires. Every downstream behavior (submit, dismiss, toast) is already wired at L4041–L4088 and needs zero changes.

**Existing FeedbackModal wiring** (L4041–L4088, reference only — NO changes here per D-18):
```typescript
<FeedbackModal
  open={feedbackOpen !== false}
  variant={feedbackOpen === false ? "general" : feedbackOpen}
  onOpenChange={(next) => {
    if (!next) setFeedbackOpen(false);
  }}
  onSubmit={(userNote) => {
    // ... existing L4048–L4074 body — no changes needed for shape 2
    // because the discriminated-union already handles "general" branch.
  }}
  onDismissWithoutSubmit={() => {
    // ... existing L4076–L4087 body — NOT called for general variant
    // per FeedbackModal contract (Cancel/backdrop just calls onOpenChange).
  }}
/>
```

**⚠️ Payload gotcha for general variant** (D-09 lock): the existing `onSubmit` at L4057–L4066 branches on `variant`:
```typescript
const payload =
  variant === "thumbs_down"
    ? { kind: "thumbs_down" as const, userNote, messageRef: "dev-fake-msg", exchangeText: "..." }
    : { kind: "general" as const, userNote };  // ← this is what shape 2 hits
```

The `general` branch already sends `{ kind: "general", userNote }` only — NO messageRef, NO exchangeText. This matches D-09 exactly. Zero changes required. The dev-trigger and the shape-2 button both flow through this same `onSubmit` and both produce the correct payload.

### `src/ui/features/pretty-conversations/PrettyConversationsPanel.send-feedback-button.test.tsx` (test)

**Analog A (preferred — colocated sibling file):** `src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx` (277 lines, entire file is the analog).

**Analog B (alternative — extend main suite):** `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` L1418–L1476 (Tests 5 and 6, the new-agent-button coverage).

**Mock preamble pattern** (from `new-role-button.test.tsx` L17–L158) — copy verbatim. All vi.mock calls MUST land before the component import (Vitest hoists vi.mock but not import statements). New mock required for shape 2:
```typescript
// Add to the mock preamble — after the other vi.mock blocks:
vi.mock("@/feedback/feedback-store", () => ({
  useFeedbackEnabled: vi.fn(() => false),  // default false; individual tests override
}));

// Also mock FeedbackModal so the test doesn't pull the full modal dep tree
// (matches the GlobalFilesModal / SkillsEditorModal stub pattern at L120–L138):
vi.mock("@/feedback/FeedbackModal", () => ({
  FeedbackModal: (props: { open: boolean }) =>
    props.open ? <div data-testid="feedback-modal-stub" /> : null,
}));
```

**Component import pattern** (L162 of analog, verbatim):
```typescript
import { PrettyConversationsPanel } from "./PrettyConversationsPanel";
```

**Test-body pattern — render + query + assert chrome** (analog: `new-role-button.test.tsx` L205–L232, verbatim template):
```typescript
it("Test [N]: pv-header-send-feedback-button exists with correct chrome when feedback is enabled", () => {
  vi.mocked(useFeedbackEnabled).mockReturnValue(true);
  render(
    <PrettyConversationsPanel
      variant="desktop"
      hostTree={ONE_HOST_TREE}
      onCreateSession={vi.fn()}
      onDeactivateRow={() => {}}
      onOpenFeedback={vi.fn()}
    />,
  );

  const btn = screen.getByTestId("pv-header-send-feedback-button");
  expect(btn).toBeTruthy();
  expect(btn.className).toContain("pv-pencil");
  expect(btn.getAttribute("aria-label")).toBe("Send feedback");
  expect(btn.getAttribute("title")).toBe("Send feedback");
});
```

**Test-body pattern — button absent when gate false** (analog: `new-role-button.test.tsx` L234–L250):
```typescript
it("Test [N]: pv-header-send-feedback-button absent when useFeedbackEnabled() returns false", () => {
  vi.mocked(useFeedbackEnabled).mockReturnValue(false);
  render(
    <PrettyConversationsPanel
      variant="desktop"
      hostTree={ONE_HOST_TREE}
      onCreateSession={vi.fn()}
      onDeactivateRow={() => {}}
      onOpenFeedback={vi.fn()}
    />,
  );
  expect(screen.queryByTestId("pv-header-send-feedback-button")).toBeNull();
});
```

**Test-body pattern — click fires callback** (analog: `new-role-button.test.tsx` L252–L275, click → modal opens):
```typescript
it("Test [N]: clicking pv-header-send-feedback-button fires onOpenFeedback", () => {
  vi.mocked(useFeedbackEnabled).mockReturnValue(true);
  const onOpenFeedback = vi.fn();
  render(
    <PrettyConversationsPanel
      variant="desktop"
      hostTree={ONE_HOST_TREE}
      onCreateSession={vi.fn()}
      onDeactivateRow={() => {}}
      onOpenFeedback={onOpenFeedback}
    />,
  );
  fireEvent.click(screen.getByTestId("pv-header-send-feedback-button"));
  expect(onOpenFeedback).toHaveBeenCalledTimes(1);
});
```

**Test-body pattern — independent gate (D-12, the important one)** (no direct analog; construct from the "button absent when onCreateSession undefined" pattern at L234–L250, flipped):
```typescript
it("Test [N]: pv-header-send-feedback-button renders even when onCreateSession is undefined (D-12: gate independent of showPencilButton)", () => {
  vi.mocked(useFeedbackEnabled).mockReturnValue(true);
  render(
    <PrettyConversationsPanel
      variant="desktop"
      // onCreateSession INTENTIONALLY OMITTED — five siblings all hidden.
      onDeactivateRow={() => {}}
      onOpenFeedback={vi.fn()}
    />,
  );
  // Five siblings are all absent (showPencilButton = false)…
  expect(screen.queryByTestId("pv-header-new-agent-button")).toBeNull();
  expect(screen.queryByTestId("pv-header-edit-roles-button")).toBeNull();
  expect(screen.queryByTestId("pv-header-global-files-button")).toBeNull();
  expect(screen.queryByTestId("pv-header-menu-button")).toBeNull();
  // …but the feedback button IS present because its gate is independent.
  expect(screen.getByTestId("pv-header-send-feedback-button")).toBeTruthy();
});
```

**Host factory helper** (analog: `new-role-button.test.tsx` L164–L198, verbatim `makeHost` + `ONE_HOST_TREE`) — copy verbatim if creating a new test file. If extending an existing file, reuse whatever host factory is already in scope.

## Shared Patterns

### useSyncExternalStore consumer pattern
**Source:** `src/ui/feedback/feedback-store.ts` L94–L97 (definition), consumed via bare hook call (no props, no context provider).
**Apply to:** `PrettyConversationsPanel.tsx` — add `const feedbackEnabled = useFeedbackEnabled();` at the top of the component body, alongside other subscription hooks like `useBrandingConfig()` (L542), `useConversations()` (L555), `useProjects()` (L569). No wrapper, no provider, no prop-drill — the hook is a module-scoped singleton designed for leaf-level subscription.

```typescript
// Definition (feedback-store.ts L94–L97 — reference only, do not modify):
export function useFeedbackEnabled(): boolean {
  const getSnapshot = (): boolean => state.enabled;
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
```

### Header sibling button chrome
**Source:** `PrettyConversationsPanel.tsx` L2311–L2371 (five instances, all identical shape).
**Apply to:** the new feedback button — mirror the sibling shape exactly:
- `type="button"` (native button, no shadcn wrapper)
- `className="pv-pencil"` (defined in `pretty-conversations.css` L105–L131; provides 32×32 chrome, 18×18 svg slot, hover treatment)
- `aria-label` + `title` matching each other, human-readable ("Send feedback")
- `data-testid` following `pv-header-*-button` naming (`pv-header-send-feedback-button`)
- Icon child at `size={18}` (matches svg width/height in the CSS rule at L127–L131)
- `onClick` is a bare arrow function or direct callback (no debounce, no keyboard-shortcut binding)

### FeedbackModal open-state discriminated union
**Source:** `AppShell.tsx` L352–L358 (state atom) + L4041–L4046 (open/variant/onOpenChange consumption).
**Apply to:** shape 2 lifts this state via `setFeedbackOpen("general")` on button click. Do NOT create a parallel `useState` for the shape-2 button. Do NOT mount a second `<FeedbackModal>`. The existing atom already handles both dev-chord opens AND button opens — the state `"general" | "thumbs_down" | false` is deliberately shared per D-08.

### Test mock preamble for PrettyConversationsPanel tests
**Source:** `PrettyConversationsPanel.new-role-button.test.tsx` L17–L158 (mock-heavy preamble covering react-i18next, session-hue, identities-store, trapped-work-store, is-touch-device, conversation-store, use-collapsed-project-slugs, session-project-api, user-preferences-api, session-working-store, GlobalFilesModal, SkillsEditorModal, RoleModal, RunbookEditorModal, identities-api, global-files-api).
**Apply to:** any new PrettyConversationsPanel test file. All 14+ vi.mock blocks MUST land before the component import per Vitest hoisting rules. Two additional mocks required for shape 2: `@/feedback/feedback-store` (mock `useFeedbackEnabled`) and `@/feedback/FeedbackModal` (stub the modal component).

## No Analog Found

None. Every file in scope has an exact in-codebase analog. This is by design — shape 2 is a paste-alike per the shape file's own words ("Nothing new invented — just wire the pipeline shape 1 built to a visible trigger").

## Metadata

**Analog search scope:**
- `src/ui/features/pretty-conversations/` (18 .tsx files + 1 .css file scanned for sibling patterns)
- `src/ui/feedback/` (7 files — Phase 122 pipeline)
- `src/ui/AppShell.tsx` (single mount site for FeedbackModal + owner of PrettyConversationsPanel props)
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` + `.new-role-button.test.tsx` + `.projects.test.tsx` + `.relay-room.test.tsx` + `.role-management-flow.test.tsx` (5 existing test files covering the panel)

**Files scanned:** ~35 unique files
**Reads issued:** 9 (one per unique file, all with narrow offset/limit ranges — no re-reads)
**Pattern extraction date:** 2026-09-19

**Cross-reference to CONTEXT.md decisions:**
- D-01, D-02 (placement) → "Insertion point" note in PrettyConversationsPanel.tsx section
- D-03 (icon) → "Imports pattern" note (MessageSquare vs MessagesSquare gotcha)
- D-04 (chrome reuse) → "Header sibling button chrome" shared pattern
- D-05, D-06 (a11y + testid) → sibling analog pattern
- D-07, D-08 (click → lift existing state) → AppShell.tsx section
- D-09 (payload) → payload gotcha note under AppShell wiring
- D-11 (gate) → "useFeedbackEnabled subscription pattern" + gate structure divergence
- D-12 (independent gate) → "Gate structure" note (button OUTSIDE showPencilButton fragment) + test 4
- D-23 (test scope) → all four test-body patterns match the four required test cases

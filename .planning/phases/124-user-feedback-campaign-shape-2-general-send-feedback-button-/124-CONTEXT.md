# Phase 124: user-feedback campaign shape 2 — general "Send feedback" button - Context

**Gathered:** 2026-09-19
**Status:** Ready for planning
**Source:** Generated from `.planning/shapes/shape-feedback-general-button.md` (opened + greenlit 2026-09-19 via /build → /open, 6 grill exchanges, no tasting needed per the user's early placement pick). Per build-skill rule, discuss-phase does not re-elicit ground the shape file already covers.

<domain>
## Phase Boundary

Shape 2 of the `user-feedback` campaign (`.planning/campaign-user-feedback.md`). Delivers the production trigger for the pipeline shape 1 built (Phase 122): a single durable icon button placed as a new peer in the conversation-list header row, opening shape 1's shared composition modal in general variant. This shape is a placement + wiring exercise — it invents nothing new. Every downstream behavior (modal chrome, placeholder text, Cancel/Send buttons, dismiss-sends-nothing, post-send toast, fire-and-forget submit) is inherited unchanged from shape 1. The dev-only Ctrl+Alt+F chord stays; this shape adds the production-visible trigger alongside it.

Shape 3 (message thumbs on assistant messages) is a separate downstream shape and is out of scope here.

</domain>

<decisions>
## Implementation Decisions

### Placement + presentation

- **D-01:** Button lives in the conversation-list header row at `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` around L2306–L2371, immediately adjacent to the existing five sibling icon buttons (SquarePen new-conversation, FolderOpen create-project, Drama edit-roles, Globe edit-global-files, MoreVertical kebab menu).
- **D-02:** Position in the row: **fifth of six** — after Globe (edit-global-files), immediately before MoreVertical (kebab menu). The kebab keeps its place as the "more actions" catch-all at the end of the row.
- **D-03:** Icon: `MessageSquare` from `lucide-react` at `size={18}` — matches the sibling icon size exactly. No text label next to the icon; icon-only presentation.
- **D-04:** Button chrome: reuse the existing `.pv-pencil` CSS class that all five siblings use. Same hover behavior, same padding, same shape. Zero new CSS.
- **D-05:** Accessibility + tooltip: `aria-label="Send feedback"` and `title="Send feedback"` — same conventions as siblings (see `pv-header-new-agent-button` at L2313 for pattern).
- **D-06:** `data-testid`: `pv-header-send-feedback-button` — extends the `pv-header-*-button` sibling naming convention.

### Click behavior

- **D-07:** Click opens shape 1's `FeedbackModal` from `src/ui/feedback/FeedbackModal.tsx` in the `general` variant (i.e., `variant="general"` prop, per shape 1 D-10). Wiring reuses whatever open-state pattern the AppShell already uses for the dev-chord path — this shape does NOT introduce a parallel modal mount.
- **D-08:** The button is a trigger only — it does NOT own the modal mount or the modal's submit/dismiss handlers. Those already exist in `src/ui/AppShell.tsx` (L4034–L4095, added by shape 1 Phase 122 Plan 04). The button's onClick lifts the existing open-state flag; the modal renders + submits via the existing shape-1 wiring.
- **D-09:** Submit payload from the modal follows shape 1 D-24 + D-25 exactly: `{ kind: "general", userNote }` only — NO `messageRef`, NO `exchangeText`. Server-side gate in shape 1's `feedback-routes.ts` already strips exchangeText for `kind === "general"` regardless, but the client MUST NOT send it in the first place. General means general.
- **D-10:** Toast on submit: `toast.success("Thanks — feedback sent.", { duration: 2000 })` — inherited from shape 1 D-14. Dismiss (Cancel or backdrop click) sends nothing, no toast (shape 1 D-10 general-variant behavior).

### Visibility gate

- **D-11:** Button renders if and only if `useFeedbackEnabled()` from `src/ui/feedback/feedback-store.ts` returns `true`. On unconfigured deployments the button is ABSENT from the DOM — not disabled, not hidden-via-css. Same discipline as shape 1's hide-when-unconfigured lock.
- **D-12:** The feedback gate is INDEPENDENT of the header row's `showPencilButton` gate (which hides all five siblings together when `onCreateSession` is undefined). The feedback button renders on any header where feedback is configured, regardless of whether the create-buttons are showing. Rationale: there's no reason to couple "can create a conversation here" with "can send feedback from here."
- **D-13:** Accept the load-time pop-in. `useFeedbackEnabled()` starts as `false` and resolves after the backend answers via `feedback-fetch`. On configured deployments the button pops in a moment after page load — a small, honest flash. NO layout-space reservation, NO fade-in trick, NO always-render-with-disabled-state. Matches shape 1's hide-when-unconfigured spirit.

### Cross-surface + platform

- **D-14:** Mobile: identical treatment to desktop. The conversation-list header row is structurally the same on both (`variant: "mobile" | "desktop"` is a layout branch, not a content branch). No mobile-specific chrome, no size adjustment, no responsive collapse into a menu. Adding a sixth button will make the row mildly tighter on the narrowest phone widths — accepted trade-off; the header is due for a broader redesign soon.
- **D-15:** The button appears on every surface where the conversation-list panel renders (both `variant="desktop"` and `variant="mobile"` branches of the `PrettyConversationsPanel`). No surface-scoped exceptions.

### Not gated on

- **D-16:** No role gating in v1. Every logged-in user on a configured deployment sees the button. Skynet's auth has no operator-vs-regular-user distinction at the frontend for this purpose; adding a gate now would either invent a distinction or add an env-flag layer solving a problem nobody has yet. Explicit decision, not oversight.
- **D-17:** No production keyboard shortcut. The dev-only Ctrl+Alt+F chord in `src/ui/AppShell.tsx` stays exactly as it is (dev-only, `import.meta.env.DEV`-fenced, tree-shaken from production bundles). This shape does NOT add a production keyboard chord sibling.

### Non-goals

- **D-18:** No changes to shape 1's modal, backend, gate signal, or toast. If shape 2 finds itself needing new modal props / new backend fields / new gate signals, something is wrong — shape 1 was supposed to be complete plumbing. Any mismatch is a shape 1 bug, not a shape 2 feature.
- **D-19:** No interstitial UI on the button. No spinner while modal is open. No disabled state during submit. No badge / dot / accent. The click opens the modal; the modal submits fire-and-forget; the button never reflects submit state.
- **D-20:** No telemetry, no click analytics, no measurement of dismiss rates. Shape 1 was analytics-free by design; shape 2 inherits.
- **D-21:** No header redesign as part of shape 2. The button placement is deliberately minimum-invasive because the header is getting redesigned soon (the user's steer 2026-09-19). Match the row, don't rework it. Any header-wide restyling belongs in the redesign work, not here.
- **D-22:** No differentiator styling — no accent color, no "!" badge, no larger icon size, no divider before the button. The button reads as another action in the row, indistinguishable in weight from its five siblings. This is deliberate per the user's "it's just another button being added up there."

### Test scope

- **D-23:** Tests cover (at minimum): (a) button renders when `useFeedbackEnabled()` returns true, (b) button is absent from the DOM when `useFeedbackEnabled()` returns false, (c) clicking the button opens the FeedbackModal in `general` variant, (d) button visibility is independent of `showPencilButton` gate (button renders on a header where `onCreateSession` is undefined but feedback is enabled). Test file colocated with the sibling patterns in `src/ui/features/pretty-conversations/` (planner picks exact filename — either extend an existing PrettyConversationsPanel test file or add a new one).

### Deferred (explicitly not in v1)

- Role-based visibility (admin-only, env-flag toggle) — see D-16.
- Production keyboard shortcut — see D-17.
- Header redesign — see D-21.
- Any changes to shape 1 pipeline — see D-18.
- Rate limiting / abuse throttling on the general button — inherits shape 1's D-28 accepted-risk stance.
- Draft preservation across modal open/close — inherits shape 1's D-30 (transient state).
- Telemetry / click tracking — see D-20.

### Claude's Discretion (planner picks)

- **Exact source location for the button block within the header row.** After L2361 (Globe button end) and before L2362 (MoreVertical button start). Straightforward paste-alike, but planner picks the exact insertion point and formatting.
- **Test file location.** Either extend `PrettyConversationsPanel.test.tsx` (if it exists) with new test cases, or add a new small test file colocated with the panel. Planner picks based on file size + existing test organization.
- **How to plumb `useFeedbackEnabled()` into the header component.** Two options: (a) `PrettyConversationsPanel` reads the hook directly; (b) parent (AppShell) reads the hook and passes a prop down. Planner picks — probably (a) since the hook is designed to be a leaf-level subscription per shape 1 D-08 (useSyncExternalStore singleton).
- **How to lift the modal open-state from the button click.** Two options: (a) callback prop from parent; (b) direct store access if a feedback-open-state store exists. Planner picks based on shape 1's existing AppShell wiring pattern.

</decisions>

<code_context>
## Existing Code — Reusable Assets

### Shape 1 pipeline (Phase 122, all committed, not yet deployed)

- **Modal component**: `src/ui/feedback/FeedbackModal.tsx` — reusable, two entry variants (`general` + `thumbs_down`) driven by a `variant` prop. Shape 2 opens it with `variant="general"`.
- **Enabled hook**: `useFeedbackEnabled()` from `src/ui/feedback/feedback-store.ts` — returns `boolean`. useSyncExternalStore singleton; safe to call from any component. Starts as `false`, resolves after backend answer via `feedback-fetch`.
- **POST helper**: `postFeedback(payload)` from `src/ui/feedback/feedback-api.ts` — `authApi.post` wrapper. Fire-and-forget contract. Shape 2 payload: `{ kind: "general", userNote }` only.
- **Toast**: globally-mounted `sonner` Toaster at `src/ui/main.tsx:243` (bottom-right). Fire `toast.success("Thanks — feedback sent.", { duration: 2000 })`.
- **AppShell modal wiring**: `src/ui/AppShell.tsx` around L4034–L4095 — FeedbackModal mount + open-state + submit/dismiss handlers already present. Shape 2's button hooks into the SAME open-state flag; does NOT introduce a parallel mount.

### Header row pattern (integration point)

- **Host file**: `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` L2306–L2371.
- **Structure**: `.pv-header-actions` div containing five `<button type="button" className="pv-pencil">` icon buttons in order:
  1. `SquarePen` L2312–L2321 — `data-testid="pv-header-new-agent-button"` `aria-label="New conversation"`
  2. `FolderOpen` L2325–L2338 — `data-testid="pv-header-create-project-button"` `aria-label="Create project"`
  3. `Drama` L2339–L2348 — `data-testid="pv-header-edit-roles-button"` `aria-label="Edit roles"`
  4. `Globe` L2349–L2358 — `data-testid="pv-header-global-files-button"` `aria-label="Edit global files"`
  5. `MoreVertical` L2361–L2371 — `data-testid="pv-header-menu-button"` `aria-label="More actions"` (kebab menu)
- **All five gated together** behind `{showPencilButton && (<>...</>)}` where `showPencilButton = typeof onCreateSession === "function"`. Feedback button's gate is INDEPENDENT — it lives OUTSIDE this `showPencilButton &&` wrapper so it renders regardless.
- **CSS class**: `.pv-pencil` — defined elsewhere in the stylesheet; provides button chrome, hover, padding. Shape 2 reuses without modification.
- **Icon library**: `lucide-react` — imported at the top of PrettyConversationsPanel.tsx. Add `MessageSquare` to the existing import list.

### Dev chord (unchanged)

- **Chord definition**: `src/ui/AppShell.tsx` around L360, `use-keyboard-trigger-feedback-dev.ts` — Ctrl+Alt+F opens general variant, Ctrl+Alt+T opens thumbs-down variant. Both gated by `import.meta.env.DEV` — tree-shaken from production bundles.
- **Modal mount is UNCONDITIONAL** in AppShell (see comment at L4034–L4041) — the dev chord must work even when `useFeedbackEnabled()` is false. Shape 2's real button is what gates visibility for real users; the dev-chord mount stays unconditional to preserve dev-verification.

</code_context>

<canonical_refs>
## Canonical References (MUST read before planning)

- `.planning/shapes/shape-feedback-general-button.md` — Shape file governing this phase. Every decision above traces to a section in the shape file.
- `.planning/campaign-user-feedback.md` — Parent campaign artifact. Shape 2 is one of three shapes in the arc.
- `.planning/shapes/shape-feedback-pipeline.closed.md` — Shape 1's closed shape file. Shape 2 plugs into the pipeline this file describes; its Shape Features + Close-Out sections document what already exists to reuse.
- `.planning/phases/123-user-feedback-campaign-shape-1-feedback-pipeline-backend-int/122-CONTEXT.md` — Shape 1's locked decisions (D-01 through D-31). Shape 2 inherits: D-08 (frontend enabled signal), D-09 (single modal component), D-10 (general variant behavior), D-14 (toast), D-24 (payload contract), D-25 (general button context-free lock).
- `src/ui/feedback/FeedbackModal.tsx` — Reusable modal component with `variant` prop.
- `src/ui/feedback/feedback-store.ts` — `useFeedbackEnabled()` hook.
- `src/ui/feedback/feedback-api.ts` — `postFeedback()` helper.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` L2306–L2371 — Integration point (header row with five existing siblings).
- `src/ui/AppShell.tsx` L4034–L4095 — Existing modal mount + open-state + submit/dismiss handlers (shape 2's button lifts THIS open-state flag).

</canonical_refs>

<deferred>
## Deferred Ideas (out of shape 2 scope)

- **Role-based visibility gating** — admin-only, env-flag toggle. Deferred per D-16; add in future phase if a deployment gets a broader user pool where this matters.
- **Production keyboard shortcut** sibling to the dev chord — deferred per D-17.
- **Header redesign** — deferred per D-21; the user plans a broader redesign of the conversation-list header. Shape 2 stays minimum-invasive so it doesn't front-run that work.
- **Rate limiting on feedback submissions** — deferred per shape 1 D-28.
- **Telemetry on button clicks / modal opens / dismiss rates** — deferred per D-20.
- **Alternative placements** (top-bar corner, floating action button, settings modal entry) — considered during /open discussion, rejected per D-01.

</deferred>

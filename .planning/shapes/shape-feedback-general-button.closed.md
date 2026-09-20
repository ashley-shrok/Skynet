# Shape: general "Send feedback" button — new peer in the conversation-list header row

**Opened:** 2026-09-19
**Vehicle:** GSD phase
**Part of campaign:** `campaign-user-feedback.md` — shape 2 of 3

## What this is

The production trigger for the feedback pipeline shape 1 built. A single durable button that lives at the top of the conversation list, alongside the existing "new conversation" / "create project" / "edit roles" / "edit global files" / kebab-menu action buttons. Clicking it opens the shared composition modal in its general variant (the freeform-note flavor, not the thumbs-down flavor). Submitting sends whatever the user typed; dismissing sends nothing. No conversation context ever attaches — general means general.

The button is app-level, not conversation-level. It attaches to the app-shell chrome that's already present on every surface (chat with agent, terminal, filestash, settings modals). Its neighborhood — sitting next to the create-conversation and create-project buttons — is coincidental to what it does; the button is not tied to whatever conversation is currently open.

## Shape

**A single icon button in the conversation-list header row.** Same visual grammar as its five siblings in that row: identical button chrome, same-sized icon (matching the row's established 18-pixel size), the same hover behavior, an accessible label reading "Send feedback." Icon-only, tooltip on hover — no text label sitting next to the icon.

**Ordering:** it sits at position five in a row of six — after the four existing create/edit action buttons, before the kebab menu at the end. The kebab keeps its place as the "more actions" catch-all.

**Click behavior:** opens the shared composition modal from shape 1 in general variant. Every downstream behavior — the modal chrome, the placeholder text, the Cancel and Send buttons, the dismiss-sends-nothing rule, the post-send toast, the fire-and-forget submit — is inherited unchanged from shape 1. This shape adds no new UI behavior beyond the button itself.

**Visibility gate:** the button appears if and only if the frontend feedback-enabled signal is true. On deployments where the feedback mechanism isn't configured, the button simply isn't in the DOM. The gate is independent of the other siblings' visibility gate (which hides all five if the "create conversation" callback isn't wired) — feedback shows up on any surface where the header renders, regardless of whether the create-buttons are showing there.

**Load-time behavior:** the frontend enabled signal starts as false and resolves after the app mounts and the backend answers. On configured deployments this means the button pops in a moment after page load — a small, honest flash. That's the same behavior shape 1 locked ("hidden when unconfigured"); we accept the flash rather than reserving layout space for a button that might never appear.

**Submit payload:** the caller supplies only the feedback kind (general) and the user's typed note. No message reference, no exchange text, no conversation ID, no active-tab metadata — nothing about what the user was looking at when they clicked. The backend fills in the submitter, instance name, and timestamp as it always does. Even if the client accidentally sent conversation context, shape 1's backend already strips it server-side for the general variant.

**Role visibility:** everyone with a login sees the button (on configured deployments). Skynet's auth today has no operator-vs-regular-user distinction, and all-user feedback is the intended signal. No role gating in v1.

**Mobile:** identical treatment to desktop. The conversation-list header row is structurally the same on both, and the button is just one more icon in that row. Mobile may feel mildly tighter at six buttons in the row, but the header is due for a redesign soon regardless.

**Ambient dev chord stays:** the existing dev-only keyboard chord that opens the modal in dev builds continues to work. It's a developer affordance; this shape adds the production-visible trigger alongside it. The dev-chord's modal mount and gating are unaffected.

## Philosophy

**Nothing new invented — just wire the pipeline shape 1 built to a visible trigger.** No new modal, no new backend path, no new toast, no new gate signal. This shape is the smallest possible thing that lets a real user send general feedback.

**App-level, not conversation-level.** The button lives in the app chrome and represents "tell us anything." It does not attach conversation context because "general" means the feedback stands on its own — the operator doesn't need to know what the user was mid-conversation about to understand a general message.

**Match the peers, don't stand out.** The button uses the same chrome and icon size as its five row-siblings. No accent color, no highlight, no "!" badge. It's another action in that row, not a special one. This is a deliberate design choice — the header is getting redesigned soon anyway, and any bespoke styling now would just get thrown out.

**Fire-and-forget from click to click.** The button click opens the modal. The modal submit fires and returns. The toast appears. There is no interstitial state — no spinner on the button, no disabled state while modal is open, no confirmation banner. Shape 1's send behavior is inherited whole.

**Hidden means gone, not disabled.** On unconfigured deployments the button is absent from the DOM entirely — not disabled-and-tooltipped, not visible-but-inert. Same discipline shape 1 chose: no half-broken affordances.

**No role gating in v1 is a deliberate choice, not an oversight.** Skynet's user model is per-user auth with no admin/user split visible at the frontend for this purpose. Adding a gate now would mean either (a) inventing a distinction the app doesn't otherwise have, or (b) an env-flag layer solving a problem nobody has yet. If in future a deployment gets a broader user pool where this matters, a gate can be layered on then.

## Prior context

Shape 1 shipped the full pipeline for this feedback mechanism: the backend intake path (auth-gated), the shared composition modal with two entry variants (general and thumbs-down), the post-send toast, the environment-driven configuration (with graceful hide when unset), the frontend feedback-enabled signal (read once at boot, cached), the plain-text email format, fire-and-forget send behavior, and a dev-only keyboard chord for verifying the pipeline end-to-end before real triggers landed. All of that is already present in the codebase, committed but not yet deployed.

The conversation-list header row currently holds five icon buttons: new conversation (pencil), create project (folder), edit roles (drama masks), edit global files (globe), and a kebab "more actions" menu. All five share identical chrome and sit in the same row. On mobile the header structure is the same. Adding a sixth icon button is a paste-alike of the existing pattern.

The general variant of the shape-1 modal renders with title "Send feedback" and placeholder "What's on your mind?" — those texts are inherited unchanged; this shape does not customize the modal.

The dev-only chord for triggering the modal in dev builds is Ctrl+Alt+F for the general variant; it's fenced by a build-time environment check and tree-shaken from production bundles. Shape 2 does not touch it.

Shape 3 (thumbs on assistant messages) will land later and does not interact with this button at all — thumbs open the same shape-1 modal but in the thumbs-down variant, with different behavior around dismiss (dismiss still fires an email for thumbs-down). This shape is a self-contained addition.

## What would make it wrong

- **If the button ever sends conversation context.** General means general. Even if the caller accidentally attached the currently-open conversation's ID or message text, that should not appear in the email. (Shape 1's backend already strips this server-side; this shape must not attempt to send it in the first place.)
- **If the button appears on a deployment where feedback isn't configured.** No half-broken affordances. If someone clicks a "Send feedback" button and gets no feedback sent, we've failed the hide-when-unconfigured contract.
- **If the button disables itself, spins, or shows any interstitial state.** The modal open and the modal submit are both fire-and-forget from the user's perspective. Any interstitial UI breaks that model.
- **If clicking the button does anything OTHER than open the shape-1 general-variant modal.** No new modal, no side channel, no separate composition surface. If shape 1's modal isn't the right composition surface for general feedback, the fix belongs in shape 1, not here.
- **If the button styling drifts from its five siblings.** Different chrome, different icon size, an accent color, a badge — any of that puts it in a different visual category than the row it lives in, which sends the wrong signal about what the button is.
- **If any keyboard shortcut ships in production alongside the button.** The dev chord stays dev-only. Shape 2 does not add a production keyboard shortcut. That's a shape-1 lock we're not revisiting.
- **If the button gate isn't independent of the create-buttons gate.** The five siblings share a "can create a conversation here" visibility gate. The feedback button must render on any header where feedback is configured, regardless of that other gate — otherwise on surfaces where you can't create a conversation you also can't send feedback, and there's no reason those two things should be coupled.
- **If shape 1's modal or backend contract has to change to make this button work.** Shape 1 already ships a general-variant modal that takes the exact payload this button will send. If shape 2 finds itself needing new modal props, new backend fields, or new gate signals, something is wrong — shape 1 was supposed to be complete plumbing.
- **If the button ships with any telemetry.** No analytics on clicks, no tracking on modal opens, no measurement of dismiss rates. Shape 1 was analytics-free by design; this shape inherits that.

## Scope edges

**IN this shape:**
- One new icon button in the conversation-list header row, at position five of six.
- Wiring the button's click to open shape 1's shared composition modal in general variant.
- Visibility gating on shape 1's frontend feedback-enabled signal.
- Icon-only presentation with accessible label and tooltip both reading "Send feedback."
- Same button chrome, icon size, and hover behavior as the existing five row siblings.
- Tests covering: button renders when feedback is enabled, button is absent when feedback is disabled, click opens the modal, gate is independent of the create-buttons gate.

**OUT of this shape (belongs elsewhere or nowhere):**
- Thumbs on assistant messages (shape 3).
- Any change to shape 1's modal, backend, gate signal, or toast.
- Any redesign of the conversation-list header itself — button placement is being made minimum-invasive because the header is due for a broader redesign soon; this shape does not front-run that.
- Role-based visibility gating (no admin-only, no env-flag toggle).
- A production keyboard shortcut sibling to the dev chord.
- Analytics or click tracking.
- Any mobile-specific chrome, sizing, or behavior beyond what falls out naturally from the shared header.
- Any change to the dev chord itself — it stays exactly as it is, dev-only, unchanged.
- A tooltip beyond the standard title attribute.
- A different composition surface for general feedback (an inline compose box, a full-page form, etc).
- Interstitial UI on the button during modal open/submit (spinners, disabled states, badges).

**Tempting but no:**
- Adding a "!" badge or highlight to draw attention. Feedback is opt-in and passive; loudness is a promise the mechanism doesn't deliver on.
- Making the button visible even when unconfigured (with a "not available" tooltip). Shape 1's hide-when-unconfigured lock is a spirit thing, not a technicality — a visible-but-dead button is worse than an absent one.
- Placing the button somewhere else "just in case" (a floating action button, a top-bar corner, a settings-modal entry). One trigger is enough for v1; the placement is chosen; adding others is scope drift.
- Attaching current-tab metadata "since we have it." We chose not to. The general variant is deliberately context-free.
- Making the button larger or accented "so users notice it." The header row is a peer environment; standing out breaks the row.

## Vehicle notes

**Vehicle:** GSD phase, added via `/gsd:phase` then planned via `/gsd:plan-phase` (auto-proceeds to execute per standing rule).

**Seed CONTEXT.md from this shape file** — the "why + what + constraints + scope edges" are captured here, so `/gsd:discuss-phase` should read this rather than re-elicit.

**Related files (for the implementing agent):**
- Parent campaign artifact: `.planning/campaign-user-feedback.md`
- Shape 1's closed shape (the pipeline this button plugs into): `.planning/shapes/shape-feedback-pipeline.closed.md`
- Shape 1's reusable pieces (all shipped, committed, not yet deployed): the shared modal component with its `general` variant, the frontend `useFeedbackEnabled` hook returning a boolean, the `postFeedback` client helper accepting the general-variant payload, the globally-mounted toast (fire `toast.success("Thanks — feedback sent.", { duration: 2000 })` on submit).
- Header host file with the existing five-button row pattern to mirror: `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` around L2306–L2371, using the `.pv-pencil` button class with `size={18}` icons and matching `data-testid`, `aria-label`, `title` conventions.
- Recommended icon: `MessageSquare` from `lucide-react` at `size={18}`.
- Recommended `data-testid`: `pv-header-send-feedback-button` (matches sibling convention).

**Ashley's steer on styling (2026-09-19):** the header is getting redesigned soon, so don't gold-plate. Use the exact same class + icon size + button pattern as the five existing siblings. Any polish beyond "matches the row" is out of scope.

**Identity doing the work:** lark (via this session's `/build`).

**Deploy:** After code lands and code review passes, deploy is deferred to the end of the campaign arc per Ashley's direction ("follow the campaign — deploy the whole user-feedback arc when all 3 shapes are ready"). Shape 2's code stays local, does not push, does not build, does not deploy.

**On completion of the built work:** run `/close shape-feedback-general-button` to verify conformance against this file, then mark shape 2 complete in the campaign artifact's Shapes section.

---

## Close-Out

**Closed:** 2026-09-20
**Vehicle used:** GSD phase (Phase 124 Plan 01) — code committed on branch `feat/tab-title-from-tmux`, not pushed / not built / not deployed per campaign deferral
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is — one durable button at top of conversation list, opens shared modal in general variant** — present · Sixth icon button added to conversation-list header row, wired to shape 1's FeedbackModal via AppShell's existing feedbackOpen atom set to 'general'
- **Shape — single icon button, same chrome as five siblings, icon-only tooltip, position 5 of 6, opens shape-1 general-variant modal** — present · PrettyConversationsPanel L2400–L2411: .pv-pencil class, MessageSquare size 18, aria-label + title 'Send feedback', positioned between Globe (L2384) and MoreVertical (L2423)
- **Visibility gate — feedbackEnabled ONLY, independent of showPencilButton** — present · Button lives outside both showPencilButton fragments; test 4 asserts it renders when all five siblings are hidden
- **Load-time behavior — pops in after backend answers, no reserved layout space** — present · Same conditional-render pattern as shape 1's other gated pieces; button simply not in DOM until feedbackEnabled resolves true
- **Submit payload — only kind:general + userNote, no conversation context** — present · AppShell L4074: general branch sends `{ kind: 'general', userNote }` — no messageRef, no exchangeText, no conversation ID even attempted client-side
- **Role visibility — everyone with a login sees the button** — present · No role gating logic added; gate is purely feedbackEnabled
- **Mobile — identical treatment to desktop** — present · pretty-conversations.css untouched in this phase; button inherits row's existing mobile treatment
- **Ambient dev chord stays untouched** — present · AppShell L363 useKeyboardTriggerFeedbackDev call is unchanged in the shape-2 diff; only 8 lines added (the onOpenFeedback prop wiring)
- **Philosophy — nothing new invented, just wire pipeline to visible trigger** — present · No new modal, no new backend path, no new toast, no new gate signal; shape 1 files untouched between shape-1 close and shape-2 complete
- **Philosophy — app-level not conversation-level** — present · Callback is no-arg, no context threading; payload is context-free
- **Philosophy — match peers, don't stand out** — present · Exact .pv-pencil class + size 18 icon; no accent, no badge, no bespoke styling
- **Philosophy — fire-and-forget from click to click** — present · onClick is a single setter call; no interstitial UI, no disabled/spinner state on the button
- **Philosophy — hidden means gone, not disabled** — present · Conditional render `{feedbackEnabled && (...)}`; test 2 asserts DOM absence, not disabled attribute or CSS hiding
- **What would make it wrong: button ever sends conversation context** — present · Payload construction at AppShell L4074 for the general branch is literally `{ kind: 'general', userNote }` — no context field even considered
- **What would make it wrong: button appears on unconfigured deployment** — present · Gated on feedbackEnabled = useFeedbackEnabled(); no fallback render path
- **What would make it wrong: button disables itself, spins, or shows interstitial state** — present · No disabled attribute, no isSubmitting-tied class, no Loader2 icon on this button; onClick is a bare setter call
- **What would make it wrong: click does anything OTHER than open shape-1 general-variant modal** — present · onClick handler is exactly onOpenFeedback?.() → setFeedbackOpen('general') → shape-1's FeedbackModal at AppShell L4049
- **What would make it wrong: button styling drifts from siblings** — present · Same .pv-pencil class, same size={18}, same aria-label/title/type/data-testid conventions; no additional style props
- **What would make it wrong: keyboard shortcut ships in production alongside button** — present · No new keyboard handler added in shape-2 diff; only the pre-existing dev-chord (env-gated) remains
- **What would make it wrong: gate not independent of create-buttons gate** — present · Button rendered outside both showPencilButton fragments; test 4 structurally proves independence
- **What would make it wrong: shape 1's modal or backend contract changes** — present · git diff between shape-1 close and shape-2 complete shows zero changes under src/ui/feedback/
- **What would make it wrong: button ships with telemetry** — present · No analytics, tracking, or measurement calls added; grep for analytics/telemetry/track in the diff turns up nothing
- **Scope edges IN — one button + wiring + gate + chrome + tests** — present · All four IN items delivered; test file covers all four required cases
- **Scope edges OUT — no thumbs, no shape-1 changes, no header redesign, no role gating, no production shortcut, no analytics, no mobile-specific chrome, no dev-chord changes, no extra tooltip, no alternate composition surface, no interstitial UI** — present · Verified by diff inspection: only 3 code files touched (AppShell.tsx +8 lines prop wiring, PrettyConversationsPanel.tsx +80 lines button + prop + import + hook, and the new colocated test file)

### Additions (in the result, not in the shape)

None.

### Follow-ups

None.

### Notes

Very tight execution. The paste-alike sibling pattern was followed exactly, the fifth-of-six placement is correct, and the independent-gate discipline is both structurally implemented (button rendered outside both showPencilButton fragments) and covered by a dedicated test. Shape 1 files were literally untouched between shape-1 close and shape-2 complete, honoring the "no shape-1 changes" lock. Payload construction at the AppShell setter closes off the accidental-context failure mode at the source rather than relying on server-side stripping. Dev chord fully preserved. Test file uses defensive default (useFeedbackEnabled → false) so absent-when-disabled is the safe default for any future test that forgets to override — good hygiene. Ready for shape 2 completion mark on the campaign artifact.

# Shape: the shared groundwork every redesigned modal builds on — look A, the kit, every modal moved onto it

**Opened:** 2026-10-16

## What this is

Skynet's modals get one shared set of building blocks in a new look ("look A"), and every modal is moved onto them. Today the shared frame exists but the insides of almost every modal are hand-made — five kinds of button, six kinds of field label, six search boxes, three copies of the host picker, and around forty of the browser's own grey pop-ups for "are you sure?" and "type a name". After this shape, every button, field, list, chip, toggle, menu, state and dialog in a modal comes from one place, looks like look A, and works on a phone. Each modal's own layout is left for its own shape; this shape gives them the parts.

## Shape

**Look A.** One flat, near-black surface with a hairline edge and calm, warm-white type. A bigger, plain title with no rule under it; no rules above the buttons at the bottom. Colour appears only where something is chosen, is the main action, or has focus — the agent's or role's colour tints those accents, never the background. The agent's identity shows through its avatar and name in the header.

**The kit — the parts every modal is built from:**
- Buttons: main, ordinary, plain-text, destructive (loud and quiet), small, unavailable, busy ("Saving…"), icon-only.
- Fields: single-line, dropdown, multi-line, search box — one filled shape, label above, help or error below, outline only on focus.
- Settings rows: grouped rows with what it is on the left and its control on the right, with an optional group heading and footnote.
- Choices: switch, checkbox, one-of-a-few round choice, slider.
- Segmented control: one control for a modal's tabs and for in-form choices (schedule type, formatted/plain).
- Chips: status labels, and pick-chips you tap to toggle (hosts, weekdays).
- List row: one row for roles, scheduled tasks, search results, archived things, users — avatar, title, subtitle, optional chip or switch, three-dot menu on hover (always on touch).
- Host picker: search plus pickable rows with a status dot — one picker wherever a host is chosen.
- Side list, three-dot menu, file toolbar (where-you-are on the left, actions on the right).
- Empty, loading and problem states: one of each.
- Confirm, "name it" and notice dialogs, replacing the browser's pop-ups.

**On a phone.** Big modals stay full-screen. Small modals (and every confirm, "name it" and notice dialog) become sheets that slide up from the bottom, only as tall as their content, with a grab bar, the app visible and dimmed above. A sheet with nothing typed in it closes on a swipe down; once something is typed, a swipe down springs it back. The close button and Cancel always close. Buttons on a sheet stack full-width, main action on top.

**Every modal moved onto the kit.** Every modal and every tab or pane inside one — including the agent, role and project modals' own headers, the Preferences side list and panes, the Admin panes, the scheduled-task form, the wake-up forms, the Files, Git and Desktop tabs — draws its parts from the kit, and every browser pop-up becomes the kit's dialog. Things may be repositioned where that fits the kit better (e.g. a dropdown that lives in a header can move); broad strokes now, nitpicks later.

## Philosophy

- Apple's interfaces are the reference for how things behave and are arranged; the look is Skynet's own. No Apple principles are written down; judgment is formed fresh.
- Calm over busy: readability was what chose look A.
- One part, one place: when a button changes, every button changes.
- Large passes, cohesive first. Get the broad strokes consistent across everything; Ashley nitpicks afterwards. Don't stall to scrutinise every placement.
- Nothing a modal can do today is lost, including read-only states.

## Prior context

- The shared modal frame already exists from an earlier look-unification pass, but most modal insides are hand-made; the inventory of what's where is at `.planning/campaigns/apple-ux/modal-element-inventory.md`.
- Two earlier tastings (cards — "too busy"; the first Apple-referenced attempt) are past attempts, not a spec.
- This session's tasting: three looks on the live app (A ink, B slate cards, C hue glass); Ashley chose A for readability and liked the larger dropdowns. The kit panel and the phone sheets were then tasted live and approved. The snippet that renders the kit and look A on the live app is kept at `.planning/campaigns/apple-ux/tasting-ux-foundation.js` and is the visual reference for the build.
- Fleet-distributed skills are shown read-only to admins in the skills modal; shared skills and roles are view-only for non-admins all the way into the editor.

## What would make it wrong

- Any modal still has its own one-off button, field, label, search box or list row after this ships — the parts aren't really shared.
- Any "are you sure?" or "type a name" still opens the browser's grey pop-up.
- A modal loses something it could do, or a view-only state becomes editable (or vice versa).
- The agent's or role's colour floods a modal's background again.
- The result reads as an Apple look-alike rather than Skynet.
- A small modal on a phone still fills the whole screen, or a swipe throws away something the user typed.
- Half the modals look new and half look old in the live app at any point — it ships all at once.

## Scope edges

- **In:** look A on the shared frame; every kit part as a real shared part; every modal and its tabs and panes moved onto them; the agent/role/project headers rebuilt on the shared header (content kept, repositioning allowed); the colour and voice pop-overs restyled; all browser confirm / prompt / alert pop-ups inside the app replaced with the kit's dialogs; phone sheets with swipe-to-close; the version-mismatch lock modal restyled (campaign "other work").
- **Out:** each modal's own layout redesign (its own shape later); the sidebar and conversation view; the admin host-targeting feature.
- **Deferred:** the file viewers' own small controls (around twenty viewers) — the file-modal shape picks those up.
- **Tempting but no:** rethinking what the agent/role/project headers contain; new features in any modal.

## Handoff notes

- Worked by copper-box-maintainer-2 in this session, campaign `apple-ux`.
- Build locally, committing as it goes; one deploy at the end. Push and deploy each still need Ashley's explicit go-ahead.
- Keep the tasting snippet in step with the build so Ashley can check progress on the live app.
- Existing guard tests that read the source (modal tab rows must use the shared tabs; no non-blocking modals; file viewers) and tests that look modals up by their test ids and title hook must keep passing — keep those hooks when restructuring.
- Any change a non-admin can see needs a matching id-skill update in the same piece of work (e.g. browser pop-ups becoming in-app dialogs, sheets and swipe on phone). Admin-only changes stay out of it.

---

## Close-Out

**Closed:** 2026-10-17
**Overall verdict:** closed-hit (reviewer returned closed-partial; both gaps fixed after Ashley's ruling, the third item ruled out of scope)

### Shape features (conformance)

- **Look A** — present · flat near-black surface, hairline edge, plain larger title, no rules; hue only on chosen / main / focus; avatar and name in agent, role and project headers.
- **The kit — buttons** — present · main, ordinary, plain, loud and quiet destructive, small, unavailable, busy, icon-only.
- **The kit — fields** — present · one filled shape for single-line, dropdown, multi-line, search; label above, help or error below, outline on focus.
- **The kit — settings rows** — present · grouped rows with optional heading and footnote.
- **The kit — choices** — present · switch, checkbox, round choice, slider (colour picker uses the slider).
- **The kit — segmented control** — present · modal tabs and in-form choices (schedule type, file view mode).
- **The kit — chips** — present · status chips with tones; pick-chips for weekdays, hosts and new-session roles.
- **The kit — list row** — present · avatar, title, subtitle, optional chip or switch, menu on hover and always on touch.
- **The kit — host picker** — present · one picker for new project, new role, new session; search always shown (after the fix below).
- **The kit — side list, three-dot menu, file toolbar** — present · grouped and pinned side list with phone drill-in; menus take the kit look and hue inside modals; breadcrumb toolbar.
- **The kit — empty, loading, problem states** — present · one of each.
- **The kit — confirm, name-it, notice dialogs** — present · in-app; name-it shows its error under the field.
- **On a phone** — present · was partial (only the dialogs stacked their buttons); fixed so every phone sheet stacks its buttons full-width with the main action on top.
- **Every modal moved onto the kit** — present · the session finder was not moved; Ashley ruled it dead (no longer reachable) and out of scope, and its removal was handed to a separate agent.
- **Philosophy — nothing a modal can do today is lost** — present · view-only and admin handling unchanged in spot checks; hooks preserved.
- **Scope edges** — present · conversation view, sidebar panel and file viewers untouched as scoped; every browser pop-up replaced; agent guide updated.
- **Handoff notes** — drifted · the tasting snippet was retired rather than kept in step; real builds are previewed in a browser against live data instead.
- **What would make it wrong: one-off parts remain** — present · only the dead session finder kept its own look, and it is being removed.
- **What would make it wrong: browser pop-ups remain** — present · 115 calls before, none after.
- **What would make it wrong: a modal loses something / view-only flips** — present · none found by reading.
- **What would make it wrong: hue floods the background** — present · fixed near-black background.
- **What would make it wrong: reads as an Apple look-alike** — cannot-verify · a visual judgement for Ashley once it's live.
- **What would make it wrong: phone small modal full-screen / swipe loses typing** — present · content-height sheets; swipe skipped once typed.
- **What would make it wrong: half new, half old** — present · all on one branch, nothing deployed, ships at once.

### Additions (in the result, not in the shape)

- The host picker hid its search box at four or fewer hosts — unsanctioned; removed (search always shows).

### Follow-ups

- Remove the dead session finder — issue; handed to a separate agent (sparrow-box-maintainer-2) at Ashley's request.
- Kit candidates raised during migration (a pop-over panel for the colour and voice pickers, a link-styled button, a usage meter, a sortable column header) — deferred; pick up where the per-modal shapes need them.
- Unused sidebar-era row styles left in place for the conversation list's own styles — deferred to the sidebar shape.

### Notes

Look A and the kit landed in one pass across every modal. Calls the reviewer didn't raise as additions: new-session roles became tap-to-pick chips (repositioning, documented in the guide), and search boxes clear with Esc or a ✕.

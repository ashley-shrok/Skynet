---
name: interactive-messages
description: |
  Send an interactive widget inline in a message so users can respond by
  clicking, ticking, dragging, or filling instead of typing. Seven templates
  across three submit modes (terminal-on-click, terminal-on-submit,
  non-terminal). Non-terminal mode lets the widget contribute to a text
  reply that hasn't happened yet — state persists on every interaction and
  the user's own text reply is what wakes you. Multi-widget per message is
  supported.
---

# interactive-messages

Send an interactive widget inline in a message so users can respond by clicking,
ticking, dragging, or filling instead of typing.

---

## Overview

An interactive widget is a small self-hosted app on your box that renders inside
a chat bubble. The user interacts with it directly; when the interaction is
terminal, a `<task-notification>` envelope is injected into your session as a
wake ping and you read the result from `~/fleet/interactive-messages/<slug>/state.json`.

Seven templates are available across three submit modes: `poll`, `checklist`,
`form`, `ranking`, `list-actions`, `color-picker`, `draft`. Each template has a
curated set of modes it supports; you choose the mode per widget instance via
`--mode`.

**The rule: every widget must earn its interactivity over a plain text reply.**
If the user could more easily type an answer, the widget is wrong. Apply this
test before scaffolding any widget. A widget that makes the user do more work
than typing fails regardless of how polished it looks.

---

## Template menu

| Template | Modes | Reach for it when… | Terminal act |
|----------|-------|---------------------|--------------|
| `poll` | terminal-on-click *(default)*, non-terminal | Pick one from 2–5 discrete options; the click IS the choice (terminal) OR the click updates a persistent selection (non-terminal) | terminal-on-click: clicking an option button; non-terminal: none — user's own text reply wakes you |
| `checklist` | terminal-on-submit *(default)*, non-terminal | Pick many from a list; batch-select before committing (terminal) OR toggle freely across turns (non-terminal) | terminal-on-submit: clicking Submit; non-terminal: none |
| `form` | terminal-on-submit *(default)*, non-terminal | Collect several distinct values as a small structured input | terminal-on-submit: clicking Submit; non-terminal: none |
| `ranking` | terminal-on-submit *(default)*, non-terminal | Elicit a preferred order among items | terminal-on-submit: clicking Submit order; non-terminal: none |
| `list-actions` | terminal-on-submit *(default)*, non-terminal | Per-item review workflow — assign one of N actions to each item | terminal-on-submit: clicking Done; non-terminal: none |
| `color-picker` | terminal-on-click *(default)*, non-terminal | Pick one color from a palette | terminal-on-click: clicking a swatch; non-terminal: none |
| `draft` | terminal-on-submit *(default)* | Present an editable draft (email, message, doc snippet) the user can tweak inline before sending | terminal-on-submit: clicking Send |

*(default)* denotes the mode used when `--mode` is omitted.

---

## CLI dispatch

Two invocation forms are supported.

**Form B — flag-based (canonical):**

```bash
bash ~/.claude/skills/interactive-messages/create-widget.sh \
  --slug <slug> \
  --template <name> \
  --mode <mode> \
  --message-id <mid> \
  --conversation-id <cid> \
  [template-specific args...]
```

**Form A — positional (Phase 137 back-compat, still works):**

```bash
bash ~/.claude/skills/interactive-messages/create-widget.sh \
  <slug> <template> \
  --message-id <mid> \
  --conversation-id <cid> \
  [template-specific args...]
```

**Global flags (all templates):**

| Flag | Required | Description |
|------|----------|-------------|
| `--slug` | yes | Kebab-case identifier. Max 40 chars. Used in the URL and systemd unit name. |
| `--template` | yes | One of: `poll`, `checklist`, `form`, `ranking`, `list-actions`, `color-picker`, `draft` |
| `--message-id` | yes | The eventId of the ChatMessage this widget is embedded in. |
| `--conversation-id` | yes | The identity's tmux session id or equivalent. |
| `--mode` | no | One of `terminal-on-click`, `terminal-on-submit`, `non-terminal`. If omitted, each template uses its default mode from the menu above. |

### Choosing a mode

- **terminal-on-click**: The user's click IS the answer — no separate confirm. Use for single-choice answers where the widget itself ends the interaction.
- **terminal-on-submit**: The user assembles or reviews, then hits one deliberate button to commit. Use when the user needs to change their mind before submitting.
- **non-terminal**: The widget captures supplementary data alongside a text reply that hasn't happened yet. State persists on every interaction; the user's OWN NEXT TEXT REPLY wakes you and you read the widget's state.json alongside it. Use when: (a) the widget augments a text reply rather than replaces it; (b) you're embedding multiple widgets in one message (see below); (c) the user might edit their choice several times before committing.

Requesting an unsupported (template, mode) combination — e.g. `form` with `terminal-on-click` — errors out with a message naming what the template does support. The full supported-combo map is enforced by the dispatcher.

**Stdout output** (machine-readable — read these two lines):

```
SLUG=<slug>
URL=https://<skynet-domain>/interactive/<hostId>/<slug>/pane/
```

The URL is absolute HTTPS — `create-widget.sh` reads `~/fleet/host/parent`
at scaffold time and prepends it. The frontend's in-bubble widget detector
requires an absolute `https://` URL; a bare `/interactive/...` path will
render as a plain link instead of an inline widget bubble.

**Embed in your message:**

```
Here is the widget:

[Label text](https://term.example.com/interactive/42/<slug>/pane/)
```

Paste the URL exactly as `create-widget.sh` emitted it — do NOT strip the
scheme or domain. The anchor text does not matter. The frontend replaces the
entire `<a>` tag with the inline widget frame. Keep the message brief — the
widget IS the interaction.

---

## Per-template reference

---

### `poll` — terminal-on-click

**Reach for it when:**
- The user needs to choose exactly one option from a small set (2–5).
- The choice IS the action — there is nothing to assemble or confirm first.
- Seeing labeled buttons is clearer than typing the option name.
- Example: "Which region should we deploy to?" with options us-east, eu-west, ap-south.

**CLI shape:**

```bash
bash ~/.claude/skills/interactive-messages/create-widget.sh \
  --slug poll-color \
  --template poll \
  --message-id evt_abc123 \
  --conversation-id session_xyz \
  --prompt "Which color for the sign?" \
  --options "red,blue,green"
```

| Flag | Required | Description |
|------|----------|-------------|
| `--prompt` | yes | Question shown as a heading. |
| `--options` | yes | Comma-separated option labels. Must be at least 2. |

**Worked example stdout:**

```
SLUG=poll-color
URL=https://term.example.com/interactive/42/poll-color/pane/
```

**State on submit** (`~/fleet/interactive-messages/poll-color/state.json`):

```json
{
  "template": "poll",
  "choice": "blue",
  "submitted_at": "2026-09-27T14:00:00.000Z"
}
```

`choice` is the option label the user clicked.

**Affordance rule:** Renders each option as a full-width button. Clicking a
button IS the submit — buttons signal active action, not passive preference.

**Mobile:** Option buttons render at 44px min-height and full bubble width; on ~320px viewports (mobile bubble minimum) each option stacks vertically as a full-width button. Keyboard: Tab moves focus button-to-button; Space or Enter activates.

**Do NOT use it when:**
- The user needs to pick multiple options (use `checklist`).
- The user needs to enter free-form text or numbers (use `form`).
- The user only has two options where typing "yes" or "no" would be faster.

---

### `checklist` — terminal-on-submit

**Reach for it when:**
- The user needs to select any number of items from a list before committing.
- The selection is a batch action — the user wants to review all options before
  clicking Submit.
- Example: "Which packages need updating?" with a list of package names.

**CLI shape:**

```bash
bash ~/.claude/skills/interactive-messages/create-widget.sh \
  --slug check-pkgs \
  --template checklist \
  --message-id evt_abc123 \
  --conversation-id session_xyz \
  --prompt "Which packages need updating?" \
  --options "lodash,express,react,typescript" \
  [--submit-label "Submit {N} selected"]
```

| Flag | Required | Description |
|------|----------|-------------|
| `--prompt` | yes | Question shown as a heading. |
| `--options` | yes | Comma-separated option labels. Must be at least 2. |
| `--submit-label` | no | Button label template. Must contain `{N}` (replaced with checked count). Default: `Submit {N} selected`. |

**Worked example stdout:**

```
SLUG=check-pkgs
URL=https://term.example.com/interactive/42/check-pkgs/pane/
```

**State on submit** (`~/fleet/interactive-messages/check-pkgs/state.json`):

```json
{
  "template": "checklist",
  "checked": ["lodash", "react"],
  "submitted_at": "2026-09-27T14:00:00.000Z"
}
```

`checked` is the array of option labels the user ticked. May be empty if the
user submitted with nothing checked.

**Affordance rule:** Renders each option as a checkbox (passive selector — does
not fire on click). A separate Submit button confirms the batch. Checkboxes
signal "I am assembling a selection", not "I am taking an action immediately".

**Mobile:** Each checkbox row is 44px min-height with the entire row acting as the touch target (row is a `<label>` wrapping the checkbox and text). On narrow viewports the row wraps text if the option label is long, keeping the checkbox left-aligned. Keyboard: Tab focuses each checkbox; Space toggles.

**Do NOT use it when:**
- The user can only pick one (use `poll`).
- The items are ordered and sequence matters (use `ranking`).
- The user also needs to assign an action to each item (use `list-actions`).

---

### `form` — terminal-on-submit

**Reach for it when:**
- You need to collect several distinct values (names, numbers, enumerations) in
  one interaction.
- The values are heterogeneous — different fields have different types.
- Example: "Configure the deployment — name, port, environment."

**CLI shape:**

```bash
bash ~/.claude/skills/interactive-messages/create-widget.sh \
  --slug form-deploy \
  --template form \
  --message-id evt_abc123 \
  --conversation-id session_xyz \
  --prompt "Configure the deployment" \
  --field "app_name:text" \
  --field "port:number" \
  --field "env:select:staging,production,dev" \
  [--submit-label "Submit"]
```

| Flag | Required | Description |
|------|----------|-------------|
| `--prompt` | yes | Heading shown above the form. |
| `--field` | yes (≥1) | Field spec: `name:type` or `name:type:options`. Repeat once per field. |
| `--submit-label` | no | Submit button label. Default: `Submit`. |

Field spec formats:
- `name:text` — single-line text input
- `name:number` — numeric input
- `name:select:opt1,opt2,opt3` — dropdown; must have at least 2 options

Field names must be lowercase snake_case, max 40 chars.

**Worked example stdout:**

```
SLUG=form-deploy
URL=https://term.example.com/interactive/42/form-deploy/pane/
```

**State on submit** (`~/fleet/interactive-messages/form-deploy/state.json`):

```json
{
  "template": "form",
  "fields": {
    "app_name": "my-api",
    "port": "8080",
    "env": "staging"
  },
  "submitted_at": "2026-09-27T14:00:00.000Z"
}
```

`fields` is a flat object mapping field name to string value. Number fields
are also returned as strings — parse with `int()` / `float()` as needed.

**Affordance rule:** Renders each field as a standard HTML input appropriate to
its type (text input, number input, select dropdown). A Submit button confirms
the form. Inputs are passive — they do not fire on change.

**Mobile:** Each field renders at 44px min-height and full bubble width; fields stack vertically at all viewport widths (single-column form). Select fields use the native platform picker on iOS/Android. Keyboard: Tab moves field-to-field; Enter submits when focus is on the submit button.

**Do NOT use it when:**
- You only need one value (ask in your message text instead).
- All fields are the same type and represent a selection from a set (use
  `checklist`).
- You need the user to rank items (use `ranking`).

---

### `ranking` — terminal-on-submit

**Reach for it when:**
- You need to know the user's preferred order among a set of items.
- The order itself is the meaningful output — not just which items were picked.
- Example: "Rank these features by priority."

**CLI shape:**

```bash
bash ~/.claude/skills/interactive-messages/create-widget.sh \
  --slug rank-features \
  --template ranking \
  --message-id evt_abc123 \
  --conversation-id session_xyz \
  --prompt "Rank these features by priority" \
  --items "Dark mode,Mobile app,API access,Webhooks" \
  [--submit-label "Submit order"]
```

| Flag | Required | Description |
|------|----------|-------------|
| `--prompt` | yes | Heading shown above the ranking list. |
| `--items` | yes | Comma-separated item labels. Must be at least 2. |
| `--submit-label` | no | Submit button label. Default: `Submit order`. |

**Worked example stdout:**

```
SLUG=rank-features
URL=https://term.example.com/interactive/42/rank-features/pane/
```

**State on submit** (`~/fleet/interactive-messages/rank-features/state.json`):

```json
{
  "template": "ranking",
  "order": ["Mobile app", "API access", "Dark mode", "Webhooks"],
  "submitted_at": "2026-09-27T14:00:00.000Z"
}
```

`order` is the item labels in the order the user placed them (index 0 = highest
priority / first).

**Affordance rule:** Renders items as a draggable list with both drag handles
(mouse/desktop) and up/down arrow buttons (touch/keyboard) — mobile is
first-class. A Submit order button confirms. The list is reorderable, not
clickable-to-select.

**Mobile:** Rows are 44px min-height. Up/down arrow buttons are 44×44 CSS pixels so touch reorder works alongside drag-and-drop. On touch devices drag may be less reliable than desktop mouse; the arrow buttons are the intended primary interaction on mobile. Keyboard: Tab moves through arrows; Space/Enter activates.

**Do NOT use it when:**
- Order does not matter — you just want to know which items were picked (use
  `checklist`).
- You need per-item actions, not a total ordering (use `list-actions`).
- There are more than ~10 items — ranking becomes tedious above that count.

---

### `list-actions` — terminal-on-submit

**Reach for it when:**
- You have a list of items and need the user to assign one discrete action to
  each item before committing.
- The batch-confirm matters — the user wants to see all assignments before
  clicking Done.
- Example: "Review these PRs — merge, skip, or close each one."

**CLI shape:**

```bash
bash ~/.claude/skills/interactive-messages/create-widget.sh \
  --slug la-prs \
  --template list-actions \
  --message-id evt_abc123 \
  --conversation-id session_xyz \
  --prompt "Review these PRs" \
  --items '["PR #101: Add dark mode","PR #102: Fix login bug","PR #103: Update docs"]' \
  --actions "Merge,Skip,Close" \
  [--done-label "Done"]
```

| Flag | Required | Description |
|------|----------|-------------|
| `--prompt` | yes | Heading shown above the list. |
| `--items` | yes | JSON array of item strings. Each must be a non-empty string. |
| `--actions` | yes | Comma-separated action names. At least 1. |
| `--done-label` | no | Done button label. Default: `Done`. |

Items are passed as a JSON array (`'["item1","item2"]'`), not comma-separated,
because item text may itself contain commas.

**Worked example stdout:**

```
SLUG=la-prs
URL=https://term.example.com/interactive/42/la-prs/pane/
```

**State on submit** (`~/fleet/interactive-messages/la-prs/state.json`):

```json
{
  "template": "list-actions",
  "rows": [
    {"item": "PR #101: Add dark mode", "action": "Merge"},
    {"item": "PR #102: Fix login bug", "action": "Skip"},
    {"item": "PR #103: Update docs", "action": "Close"}
  ],
  "submitted_at": "2026-09-27T14:00:00.000Z"
}
```

`rows` is an array of `{item, action}` objects preserving the original item
order. Every item will have an assigned action — the widget requires all items
to be assigned before Done is enabled.

**Affordance rule:** Each row renders its action choices as small buttons in a
button group (one per action). Clicking a button selects that action for that
row but does NOT submit — it is a passive row-level selection within a larger
batch. A single Done button at the bottom confirms all rows. The Done button
is disabled until all rows have an assigned action.

**Mobile:** Each row is 44px min-height; action buttons within a row use flex-wrap so they wrap to a second line below the item label on narrow (~320px) viewports instead of overflowing horizontally. Long item labels wrap via word-break. Keyboard: Tab moves through per-row action buttons then to Done.

**Do NOT use it when:**
- You only need one action per item and the action is always the same (use
  `checklist` instead — simpler).
- You need a total ordering rather than per-item tags (use `ranking`).
- There are more than ~15 items — the list becomes unwieldy.

---

### `color-picker` — terminal-on-click

**Reach for it when:**
- The user needs to choose a specific color and the visual representation
  of the color is the point.
- A hex code or color name as typed text would be ambiguous or error-prone.
- Example: "Pick a brand accent color from the palette."

**CLI shape:**

```bash
bash ~/.claude/skills/interactive-messages/create-widget.sh \
  --slug cp-brand \
  --template color-picker \
  --message-id evt_abc123 \
  --conversation-id session_xyz \
  --prompt "Pick a brand accent color" \
  [--palette "#ef4444,#f97316,#f59e0b,#22c55e,#0ea5e9,#6366f1"]
```

| Flag | Required | Description |
|------|----------|-------------|
| `--prompt` | no | Optional heading shown above the palette. |
| `--palette` | no | Comma-separated 6-digit hex colors (`#rrggbb`). Must be at least 2. Default: 12-color curated palette. |

When `--palette` is omitted, a curated 12-color palette is used spanning the
full hue wheel (red, orange, amber, yellow, lime, green, teal, sky-blue, indigo,
purple, pink, slate).

**Worked example stdout:**

```
SLUG=cp-brand
URL=https://term.example.com/interactive/42/cp-brand/pane/
```

**State on submit** (`~/fleet/interactive-messages/cp-brand/state.json`):

```json
{
  "template": "color-picker",
  "color": "#0ea5e9",
  "submitted_at": "2026-09-27T14:00:00.000Z"
}
```

`color` is the 6-digit lowercase hex string the user clicked (e.g. `"#0ea5e9"`).

**Affordance rule:** Renders each color as a circular swatch button. Clicking a
swatch IS the submit — swatches are active buttons, not passive selectors. No
separate confirm step. This matches the terminal-on-click pattern: the visual
act IS the terminal act.

**Mobile:** Swatches render on an auto-fill grid at 48px min-column-width and 44×44 minimum size. On the smallest viewports (~320px) the grid becomes ~5-6 swatches per row for the default 12-color palette. Keyboard: Tab focuses each swatch; Space/Enter selects (which is also the submit).

**Do NOT use it when:**
- The user needs to specify an arbitrary hex code not on the palette — use
  `form` with a `text` field instead.
- The user is choosing between named options (e.g., "dark theme" vs "light
  theme") — use `poll`; the color connotation would be misleading.
- Accessibility requires named labels — color alone is not an accessible
  discriminator without supplementary labels.

---

### `draft` — terminal-on-submit

**Reach for it when:**
- You have written a draft (email, chat message, doc snippet, patch, note)
  the user is likely to want to tweak before it goes out.
- The user's natural response would otherwise be either "describe what to
  change" (slow round-trip) or "copy the block into the compose box and edit
  it there" (breaks their flow).
- The draft is short-to-medium (a few sentences to ~30 lines). For a full
  document, use the app-development skill instead.
- Example: agent drafts an email reply to a colleague; user wants to soften
  the tone in one sentence and send.

**CLI shape:**

```bash
bash ~/.claude/skills/interactive-messages/create-widget.sh \
  --slug draft-email-bob \
  --template draft \
  --message-id evt_abc123 \
  --conversation-id session_xyz \
  --prompt "Email to Bob about Thursday's meeting" \
  --draft "Hi Bob,

Quick heads up that Thursday's sync will run long — vendor review + roadmap check-in stacked back to back. If you can only make one, come to the roadmap piece (2:30-3:00).

Thanks,
Ashley"
```

| Flag | Required | Description |
|------|----------|-------------|
| `--prompt` | no | Optional heading shown above the textarea (e.g., "Email to Bob"). Omit for no header. |
| `--draft` | yes | The initial draft text loaded into the textarea. Multi-line strings work — pass the whole draft in one `--draft` argument. |
| `--submit-label` | no | Button label. Defaults to `Send`. |

**Worked example stdout:**

```
SLUG=draft-email-bob
URL=https://term.example.com/interactive/42/draft-email-bob/pane/
```

**State on submit** (`~/fleet/interactive-messages/draft-email-bob/state.json`):

```json
{
  "template": "draft",
  "text": "Hey Bob — heads up, Thursday's sync will run long ...",
  "submitted_at": "2026-09-27T14:00:00.000Z"
}
```

`text` is the FINAL textarea contents at the moment the user clicked Send —
what they actually want to go out. Treat this as the authoritative version
and discard your original draft.

**Affordance rule:** Renders a resizable textarea prefilled with the draft,
above a single Send button. The textarea auto-grows with content up to the
bubble's height cap; past that, the bubble's own scroll takes over. No
"Cancel" affordance — if the user doesn't want to send, they close the
widget by responding with text.

**Mobile:** Textarea and Send button render at ≥44px tap targets. The
textarea's vertical resize handle works on desktop; on mobile the auto-grow
handles it.

**Do NOT use it when:**
- The draft is more than a screen or two — the widget is meant to feel
  in-line, not modal. For a long document, put the draft in a proper
  editable surface (see the app-development skill).
- The user needs to see multiple drafts side-by-side — send them as
  separate messages with text between, not as one widget.
- You want the user to describe changes rather than edit — just paste the
  draft in a code block and let them reply with text. The widget's whole
  point is the tweak-and-send lane.

---

## Non-terminal mode

Every template supports non-terminal mode via `--mode non-terminal`. In this mode:

- The widget renders passive selectors — radios (poll), checkboxes (checklist), text/number/select inputs (form), draggable rows with arrows (ranking), per-row action buttons (list-actions), or swatch grid (color-picker) — **with no submit button**.
- Every user interaction POSTs the current full state to a `/update` endpoint on the widget server (NOT `/submit`).
- The server overwrites `state.json` on each POST. There is **no `submitted_at` field**; the state.json instead carries an **`updated_at`** ISO8601 timestamp.
- **No submit signal fires from the widget.** The widget never wakes you. Your session is woken only by the user's own next text reply.
- **You (the agent) decide when to READ `state.json`.** The widget won't tell you. Read it whenever the user's text reply arrives (and re-read on subsequent turns if you need fresher state).

### State.json shapes (non-terminal per template)

| Template | Non-terminal state.json |
|----------|-------------------------|
| poll | `{"template":"poll", "choice":"<label>", "updated_at":"..."}` |
| checklist | `{"template":"checklist", "checked":["a","b"], "updated_at":"..."}` |
| form | `{"template":"form", "fields":{"name":"v",...}, "updated_at":"..."}` |
| ranking | `{"template":"ranking", "order":["a","b","c"], "updated_at":"..."}` |
| list-actions | `{"template":"list-actions", "rows":[{"item":"i","action":"a"}], "updated_at":"..."}` (action may be null for unassigned rows) |
| color-picker | `{"template":"color-picker", "color":"#hex", "updated_at":"..."}` |

### When to reach for non-terminal

- The widget adds structured detail to a message the user is about to type — you want their text reply AND the widget state at the same wake.
- The user should be able to change their mind several times before their reply commits (a non-terminal poll lets them audition three choices; a terminal poll ends on the first click).
- You embed multiple widgets in one message — see below.

### Caveats

- **No wake signal.** If you never see a text reply from the user, you never know they interacted with the widget. This is by design — the mode is for supplementary data, not standalone submits.
- **State reads racing with user edits.** `updated_at` tells you how fresh the state is. If you read state.json mid-typing on the user's part, you may see partial input. Read again if their text reply arrives before you've formulated your response.
- **Widgets never enter a submit-inert state.** Users can keep editing indefinitely. Combined with the seven-day backstop (Phase 140), this means non-terminal widgets are the mode most likely to accumulate — reach for teardown (Phase 140) when done.

---

## Multi-widget per message

You can embed multiple widget URLs in a single agent message. Each widget renders as its own inline frame; each has its own scaffold, state, mode, and lifecycle. Nothing is shared across widgets in one message except the message they're embedded in.

### RECOMMENDED: use non-terminal for all widgets in a multi-widget message

If two or more widgets in one message are terminal, the user's single interaction can fire two or more submit-wake events — each terminal widget's postMessage triggers a separate wake. That's wake spam.

The rule: **when embedding multiple widgets in one message, use `--mode non-terminal` for all of them.** Non-terminal widgets never fire wake events, so N widgets contribute N pieces of state that you read together when the user's own text reply wakes you.

### Worked example

The user is triaging three PRs and needs to pick an action for each plus write a summary comment. You send one message containing:

- Three `list-actions --mode non-terminal` widgets (one per PR, each with items = [PR title] and actions = ["approve", "request-changes", "comment"]) — OR one `list-actions --mode non-terminal` with all three PRs as items.
- Optionally one `form --mode non-terminal` for the summary comment (single text field).

The user picks actions on each and types their summary in the reply box. When their text reply arrives, you wake once, read all N state.json files, and respond with a synthesis.

### What you must NOT do

- Do not mix a terminal widget with any other widget in one message. If you need one widget to be terminal, put it in its own message.
- Do not read state.json before the user's text reply has arrived. The state might be mid-edit. `updated_at` is your freshness signal.
- Do not scaffold a fresh widget on every turn when you already have live non-terminal widgets from prior turns — read the existing state.json instead. (Widgets don't automatically tear down until Phase 140's seven-day sweep.)

---

## Lifecycle

Widgets accumulate on the agent's box until they are torn down. You have
three mechanisms: an agent-driven teardown command (primary), an iterate
helper for revising a widget mid-conversation, and a seven-day backstop
sweep (safety net).

### Iterating on a widget — DO NOT edit files in place

The frontend keys each widget iframe on its URL. The URL only changes when
the slug changes. Consequences:

- **If you edit `widget.html` (or any file) in place under the SAME slug,
  the user's existing widget bubble does NOT reflect your change.** The
  iframe already loaded the old HTML. It has no way to notice the file
  changed on disk. Telling the user to "refresh the widget" is not a
  workflow — they have no visible affordance for it.
- **The right pattern: rekey the widget to a new slug at a new URL, and
  send that new URL in your next message.** The user sees the previous
  bubble transition to expired on its own (Post-load liveness polling in
  `WidgetBubble.tsx` detects the torn-down server within ~1.5s) and the
  fresh widget appear at the bottom of the chat — no scroll-back required.

Use the `iterate-widget.sh` helper — it does this in one command,
preserving whatever edits you made to the widget's files:

```bash
bash ~/.claude/skills/interactive-messages/iterate-widget.sh \
  <old-slug> \
  --message-id <new-msg-id>
```

Or, flag form:

```bash
bash ~/.claude/skills/interactive-messages/iterate-widget.sh \
  --slug <old-slug> \
  --message-id <new-msg-id> \
  [--new-slug <s>]
```

What it does (atomically):
- Snapshots the old widget's `widget.html` + `server.py` (preserving your edits)
- Runs teardown on the old slug — old URL 404s; old bubble expires within ~1.5s
- Generates a new slug (`--new-slug` if provided; otherwise auto-suffix:
  `<base>-i2`, `<base>-i3`, incrementing on subsequent iterations)
- Claims a new port from the 9601-9699 range under the same lock create-widget uses
- Writes the new widget dir from the snapshot, refreshes `metadata.json`
  (new `widget_id`, new `message_id`, preserved `template` + `config` +
  `conversation_id`, plus `iterated_from` naming the predecessor slug)
- Installs and starts the new systemd unit

**Stdout output** (machine-readable):

```
OLD_SLUG=<old-slug>
NEW_SLUG=<new-slug>
URL=https://.../interactive/<host>/<new-slug>/pane/
```

**When to invoke:**
- You found a bug in the widget's `widget.html` or `server.py` and want
  the user to see the fixed version.
- You want to update the widget's initial state (e.g., different prompt
  text) after the user has already seen v1.
- Any case where you would otherwise say "I fixed it, refresh the widget."

**When NOT to invoke:**
- The widget is fine and you just want to send the SAME content again —
  that's a no-op. If you need a fresh widget from scratch, run
  `create-widget.sh` normally.
- The user is mid-interaction with a non-terminal widget and their state
  matters. Iterating discards `state.json` because it's tied to the old
  widget instance.

**What the user sees:** the old widget's bubble transitions to the
"expired" placeholder card automatically once the liveness poll detects
the torn-down server (~1.5s). The new URL you paste in your next message
renders as a fresh widget bubble at the bottom of the chat. No manual
refresh, no scroll-back.

### Agent-driven teardown (primary)

When you are done reading a widget's state.json, tear the widget down. Do
not leave it around "in case" — every dangling widget consumes a systemd
unit slot and a port from the 9601-9699 range.

```bash
bash ~/.claude/skills/interactive-messages/teardown-widget.sh <slug>
```

Or, flag form:

```bash
bash ~/.claude/skills/interactive-messages/teardown-widget.sh --slug <slug>
```

What it does (atomically):
- `systemctl --user stop im-<slug>.service` (fail-soft)
- `systemctl --user disable im-<slug>.service` (fail-soft)
- removes `~/.config/systemd/user/im-<slug>.service`
- removes `~/fleet/interactive-messages/<slug>/` recursively
- `systemctl --user daemon-reload` (so the port is released for reuse)

**Stdout output** (machine-readable):

```
TORN_DOWN=<slug>
```

**When to invoke:**

- Terminal-mode widgets: as soon as you have finished responding to the
  user's terminal submit. You have already read state.json — the widget has
  no further purpose.
- Non-terminal widgets: when you decide the collaboration cycle around this
  widget is complete (usually when you have delivered the outcome and are
  moving to a different subject). The user's next text reply will not need
  the widget's state anymore, so it is safe to remove.

**When NOT to invoke:**

- Between turns of an active non-terminal collaboration — the user may
  interact with the widget again before your next wake.
- Immediately after `create-widget.sh` if you have not yet read state.json.

**`--force` flag:** Pass `--force` if you want to tear down a slug without
first verifying it exists on disk. Useful for defensive cleanup when you
are not sure whether a widget was created in a prior aborted attempt. In
normal use, do NOT pass `--force` — a missing slug should surface as an
error so you notice the typo.

### Seven-day backstop (safety net)

Every managed box runs a daily systemd user timer
(`interactive-messages-gc.timer`) that fires the seven-day GC sweep. The
sweep enumerates `~/fleet/interactive-messages/*/`, reads each widget's
`metadata.json.created_at`, and tears down any widget older than 7 days
using the same teardown-widget.sh command above.

**Consequence:** A widget you scaffolded a week ago and forgot about will
be gone. Its systemd unit, its port, and its state.json are all removed.
Any chat bubble in Skynet that still holds the widget's URL will fail to
load and (per the expired-placeholder UI, also Phase 140) will render an
inline "This interactive message expired" card instead of a broken iframe.

**When a user reports "the widget is broken":**

If a user tells you a widget in a prior message is now broken or shows
"expired", the most likely explanation is the seven-day backstop tore it
down. Do not troubleshoot the widget itself — recognize the situation and
**reconstruct the widget on your next reply** using `create-widget.sh`
with the same configuration. The user's original interaction with the old
widget is lost; if you need their input, ask them to interact with the new
widget you just sent.

The backstop is deliberately not configurable per widget. If you need a
widget to live longer than 7 days, that is a signal the interaction should
have been a persistent app (see the app-development skill) rather than an
interactive message. Widgets are ephemeral by design.

---

## Shared reading pattern

When you wake from a widget submit, the wake carries a `<task-notification>`
envelope (same shape ambient-monitor uses) that names the widget slug and
points at the state file — but not the value itself. Always read the state
file directly:

```bash
cat ~/fleet/interactive-messages/<slug>/state.json
```

The envelope that wakes you looks like:

```
<task-notification>
<summary>Widget submit — delivered by Skynet</summary>
<event>[widget <slug>] submitted — read state at ~/fleet/interactive-messages/<slug>/state.json</event>
</task-notification>
```

The state file is always present and fully written before the postMessage
fires that wakes you. Do NOT rely on the envelope content for the value —
the envelope is a wake ping with a slug hint; the state file is the truth.

Use the `"template"` field as a discriminator if you scaffolded multiple widgets
and need to identify which one was submitted:

```bash
python3 -c "
import json, pathlib
s = json.loads(pathlib.Path('$HOME/fleet/interactive-messages/<slug>/state.json').read_text())
print(s['template'], s.get('choice') or s.get('checked') or s.get('fields') or s.get('order') or s.get('rows') or s.get('color'))
"
```

---

## Buttons vs passive selectors

The seven templates split cleanly on the affordance axis:

**terminal-on-click templates (poll, color-picker):**
Both render entirely as active clickable elements — option buttons and color
swatch buttons respectively. There is no separate Submit. The click IS the
submit. If a user sees a button, they must be able to assume the button takes
an irreversible action on click; these templates guarantee that.

**terminal-on-submit templates (checklist, form, ranking, list-actions, draft):**
All render passive selectors — checkboxes, form inputs, draggable rows,
per-row action buttons within a row, or an editable textarea — plus a single
primary Submit or Send button. The passive selectors do NOT fire the widget
on interaction. Only the primary button does. This lets the user review or
change their selections before committing.

**The arc-wide invariant:** affordance must match behavior. Passive-looking
elements that submit on interaction, or button-looking elements that do not act
on click, are broken by construction. The templates enforce this correctly; do
not modify installed widget copies. Edit only the substrate template source.

---

## Custom widget authoring

The six presets (poll, checklist, form, ranking, list-actions, color-picker) are
the fast path. Reach for custom only when the interaction genuinely does not map
to any preset.

### When to reach for custom

Try the six presets first. Custom is the escape hatch for interactions no preset
can handle.

**Custom makes sense for:**

- A signature-capture widget — the user draws in a canvas area; the widget
  records stroke coordinates. No preset supports canvas drawing.
- A 1-10 rating slider — the user drags a continuous slider; you receive the
  numeric value. The poll preset only supports discrete labeled options.
- A step-through wizard with per-step branching — each step's options determine
  what the next step shows. No preset supports dynamic branching.
- A two-panel A/B comparison — the user sees two options side by side and clicks
  the one they prefer, but the visual affordance requires a split-pane layout
  no preset provides.
- A live scoreboard the user adjusts — the widget receives a live data feed and
  lets the user nudge scores or weights; the complexity exceeds what form or
  ranking handles.

**Apply the "earns its interactivity" test BEFORE authoring.** If a plain text
reply would be easier for the user — "just type a number from 1 to 10" — do not
author the widget. The test applies regardless of how custom or clever the widget
concept is.

---

### Minimal widget contract

Every widget directory, whether from a preset or authored from scratch, contains
five files:

```
~/fleet/interactive-messages/<slug>/
├── widget.html           ← the UI
├── server.py             ← the Python stdlib HTTP server
├── args.sh               ← scaffold-time hook (custom widgets often omit this)
├── im-SLUG.service.template  ← systemd unit template
└── metadata.json.template    ← shape reference for metadata.json
```

After scaffolding, the live layout in `~/fleet/interactive-messages/<slug>/` will
also contain `metadata.json` (written at scaffold time) and `state.json` (created
on the first POST to `/submit` or `/update`). The systemd unit lives at
`~/.config/systemd/user/im-<slug>.service`.

**File roles:**

- **`widget.html`** — The UI. Served at `GET /` and `GET /index.html`. Must
  set `<meta name="viewport" content="width=device-width, initial-scale=1">`.
  If you want `create-widget.sh`'s dispatcher to handle substitution, use
  `__PROMPT_JSON__`-style markers that `args.sh` replaces. Custom widgets
  typically hard-code content directly and skip substitution entirely.

- **`server.py`** — The Python stdlib HTTP server. Binds `127.0.0.1:$PORT`
  where `PORT` is set by the systemd unit's `Environment=PORT=` line. `GET /`
  and `GET /index.html` serve `widget.html`. POST endpoint(s) (`/submit` for
  terminal widgets, `/update` for non-terminal widgets) write `state.json`
  atomically under a `threading.Lock()`. Zero external dependencies — stdlib
  only. See `substrate/skills/interactive-messages/templates/poll-terminal-on-click/server.py`
  and `substrate/skills/interactive-messages/templates/poll-non-terminal/server.py`
  for the canonical pattern.

- **`args.sh`** — The scaffold-time hook. Only needed if you want
  `create-widget.sh`'s dispatcher to perform template substitution into
  `widget.html` (which also requires editing the dispatcher's template
  allowlist). Custom widgets typically SKIP this file and hard-code
  `widget.html` content instead — there is no obligation to use the dispatcher.

- **`im-SLUG.service.template`** — The systemd user unit template. Substitution
  markers: `__SLUG__`, `__WIDGET_DIR__`, `__PORT__`. After substitution, the
  rendered unit is written to `~/.config/systemd/user/im-<slug>.service`.
  See `substrate/skills/interactive-messages/templates/poll-terminal-on-click/im-SLUG.service.template`
  for the canonical unit shape.

- **`metadata.json.template`** — Shape reference for `metadata.json` in the
  widget directory. Must contain the fields `template`, `widget_id`,
  `message_id`, `conversation_id`, `config`, and `created_at`. The
  `created_at` ISO8601 timestamp is what the seven-day GC sweep reads when
  deciding whether to tear down the widget. See
  `substrate/skills/interactive-messages/templates/poll-terminal-on-click/metadata.json.template`
  for the canonical shape.

---

### Recipe A: terminal-mode custom widget

A hypothetical `rating` widget: the user picks a rating from 1 to 10 by
clicking a numbered button. The click IS the submit; no separate confirm step.
One wake fires after the fetch resolves OK.

**Precedent to read first:**
`substrate/skills/interactive-messages/templates/poll-terminal-on-click/widget.html`
and `substrate/skills/interactive-messages/templates/poll-terminal-on-click/server.py`
are the source-of-truth for the terminal-on-click pattern. The `rating` widget
is a delta on those files, not a replacement.

**widget.html skeleton — key deltas from the poll precedent:**

```html
<meta name="viewport" content="width=device-width, initial-scale=1">
```

Set in `<head>` — identical to the poll precedent, required on every widget.

Style block — rating buttons must meet the mobile touch target floor:

```css
.rating-btn {
  min-height: 44px;   /* Apple HIG touch target minimum */
  min-width: 44px;
  /* ... rest of button styling */
}
```

Script section — hard-code `PANE_BASE` and `WIDGET_ID` directly since this
widget won't go through `create-widget.sh`'s substitution pass:

```js
var WIDGET_ID = "rating-q3-sentiment";  // your actual slug
var PANE_BASE = "/interactive/42/rating-q3-sentiment/pane";
```

The `handleChoice(rating)` function follows the fetch-then-postMessage sequence
exactly as in the poll precedent:

1. Disable all buttons immediately (idempotency — prevents double-fire).
2. POST `{ rating: rating, submitted_at: new Date().toISOString() }` to
   `PANE_BASE + "/submit"`.
3. On fetch success only, fire:
   ```js
   window.parent.postMessage(
     { type: "widget-submit", widgetId: WIDGET_ID, value: rating },
     window.location.origin   // NEVER "*"
   );
   ```
4. On fetch failure: re-enable all buttons and do NOT fire `postMessage`. The
   agent must not wake to a submit that didn't persist.

**server.py skeleton — key deltas from the poll precedent:**

The only changes from `poll-terminal-on-click/server.py`:

- `do_POST` handles `self.path == "/submit"` (same path, same pattern).
- Force the template discriminator: `data["template"] = "rating"` before
  writing `state.json`. This is the one field you must change from the poll
  precedent — it must match your widget's slug/template name.
- Log prefix: update the `SyslogIdentifier`-style prefix from `poll` to
  `rating`.

**Target `state.json` shape:**

```json
{
  "template": "rating",
  "rating": 7,
  "submitted_at": "2026-09-27T14:00:00Z"
}
```

You read this with `cat ~/fleet/interactive-messages/<slug>/state.json` after
the widget wakes you, same as with any preset widget.

---

### Recipe B: non-terminal custom widget

A hypothetical `sketch` widget: the user draws strokes on a canvas. Every
stroke persists to the server. No submit inside the widget; no wake fires.
You read the accumulated strokes alongside the user's next text reply.

**Precedent to read first:**
`substrate/skills/interactive-messages/templates/poll-non-terminal/widget.html`
and `substrate/skills/interactive-messages/templates/poll-non-terminal/server.py`
are the source-of-truth for the non-terminal pattern. The `sketch` widget is
a delta on those files.

**widget.html skeleton — key deltas from the poll-non-terminal precedent:**

```html
<meta name="viewport" content="width=device-width, initial-scale=1">
```

Required in `<head>` on every widget.

The interaction element is a canvas (or any pointer-event target); handlers
fire on `pointerup` (or `input`/`change` for form-like elements):

```js
canvas.addEventListener("pointerup", function(e) {
  // collect current strokes from your in-memory stroke list
  persistState({ strokes: strokeList });
});
```

The `persistState(data)` function:

1. POST `{ ...data, updated_at: new Date().toISOString() }` to
   `PANE_BASE + "/update"` (NOT `/submit` — non-terminal widgets use `/update`).
2. **Never** call `window.parent.postMessage`. Non-terminal widgets do not wake
   the agent.
3. On fetch success: update a status line to "Saved."
4. On fetch failure: prompt retry ("Save failed — interact again to retry.");
   keep the canvas enabled.

```js
function persistState(data) {
  var payload = Object.assign({}, data, { updated_at: new Date().toISOString() });
  fetch(PANE_BASE + "/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  })
  .then(function(res) {
    if (!res.ok && res.status !== 204) throw new Error("update returned " + res.status);
    setStatus("Saved.");
    // No postMessage — non-terminal widgets never wake the agent.
  })
  .catch(function(err) {
    console.error("[widget] update fetch failed:", err);
    setStatus("Save failed — interact again to retry.");
  });
}
```

**server.py skeleton — key deltas from the poll-non-terminal precedent:**

- `do_POST` handles `self.path == "/update"` (same path as poll-non-terminal).
- Force the template discriminator: `data["template"] = "sketch"` before
  writing `state.json`.
- Log prefix: update from `poll` to `sketch`.

**Target `state.json` shape:**

```json
{
  "template": "sketch",
  "strokes": [
    {"x": [10, 20, 30], "y": [15, 25, 35]},
    {"x": [50, 60], "y": [55, 65]}
  ],
  "updated_at": "2026-09-27T14:00:00Z"
}
```

You read this with `cat ~/fleet/interactive-messages/<slug>/state.json`
alongside the user's text reply, same as with any non-terminal preset widget.

---

### Mandatory disciplines

Every custom widget must pass all of these. Each is grep-checkable against the
shipped widget files.

- **Affordance matches behavior**: button-shaped elements act on click and fire
  terminal actions. Passive selectors (radios, checkboxes, sliders, canvas) do
  NOT fire terminal actions on interaction. Terminal-mode widgets use buttons as
  the primary interactive element. Non-terminal widgets use passive selectors or
  free-form input. A widget whose visual affordance lies to the user is broken
  by construction.

- **Earns its interactivity**: apply the "would typing be easier for the user?"
  test BEFORE authoring. If a plain text reply would be easier, do not author
  the widget. This test applies to custom widgets exactly as it does to preset
  widgets — being custom does not exempt a widget from having to earn its
  existence.

- **Mobile-first-class**: touch targets must be ≥44px in both height and width
  (Apple HIG minimum). No horizontal scroll at 320px viewport width. All
  interactive elements must be keyboard-accessible — Tab-focusable,
  Space/Enter to activate where the browser does not provide this by default
  (native `<button>` and `<input>` elements handle this automatically).

- **postMessage discipline**: terminal widgets fire
  `window.parent.postMessage(payload, window.location.origin)`. The origin
  argument must be `window.location.origin`. Never pass `"*"` as the origin —
  `"*"` would allow any frame on any origin to receive the submit signal.
  Non-terminal widgets never call `postMessage` at all.

- **Fetch-before-postMessage**: terminal widgets fire `postMessage` ONLY after
  the POST to `/submit` resolves with a success status. If the fetch fails or
  the server returns an error, do NOT fire `postMessage` — the agent must not
  wake to a submit that did not persist to `state.json`.

- **No streaming**: widgets render atomically. Never stream partial state to the
  client via SSE, WebSocket, or long-polling. Never have the widget poll
  `state.json` directly. The widget writes state; the agent reads it. Data
  flows one direction per interaction.

- **Filesystem is the source of truth**: `state.json` lives in
  `~/fleet/interactive-messages/<slug>/` on your box. You read it directly
  after waking. The invisible submit message that wakes you carries only a
  ping — not the widget's value. Always read the file.

- **Port range**: bind the systemd unit's `Environment=PORT=` to a port in the
  9601-9699 range that no other `im-*` service is currently using. Custom
  widgets draw from the same 99-port pool as preset widgets. To see which ports
  are taken, run:
  ```bash
  grep -h 'Environment=PORT=' ~/.config/systemd/user/im-*.service 2>/dev/null
  ```

---

### Scaffolding a custom widget

`create-widget.sh` has a hardcoded allowlist of seven template names. Do NOT
run it against a custom widget slug — it will error. Instead, scaffold the
widget manually with the following sequence.

Assume you have written your five source files in `~/my-widget-src/`:

**1. Copy the widget directory into place:**

```bash
cp -r ~/my-widget-src ~/fleet/interactive-messages/<slug>
```

**2. Write `metadata.json`:**

Write this JSON to `~/fleet/interactive-messages/<slug>/metadata.json`:

```json
{
  "template": "<slug>",
  "widget_id": "<slug>",
  "message_id": "<message-event-id>",
  "conversation_id": "<tmux-session-id>",
  "config": {},
  "created_at": "<UTC ISO8601 timestamp>"
}
```

The `created_at` field is what the seven-day GC sweep reads. Use
`date -u +"%Y-%m-%dT%H:%M:%SZ"` to generate a fresh timestamp — do not copy
one from a prior widget.

**3. Choose a free port in the 9601-9699 range:**

```bash
grep -h 'Environment=PORT=' ~/.config/systemd/user/im-*.service 2>/dev/null | sort
```

Pick any port in 9601-9699 not in the output. If no `im-*.service` files exist
yet, any port in the range is free.

**4. Render the systemd unit from `im-SLUG.service.template`:**

```bash
SLUG="<slug>"
WIDGET_DIR="$HOME/fleet/interactive-messages/$SLUG"
PORT=96XX   # your chosen port

sed \
  -e "s|__SLUG__|$SLUG|g" \
  -e "s|__WIDGET_DIR__|$WIDGET_DIR|g" \
  -e "s|__PORT__|$PORT|g" \
  "$WIDGET_DIR/im-SLUG.service.template" \
  > "$HOME/.config/systemd/user/im-$SLUG.service"
```

**5. Reload and enable the unit:**

```bash
systemctl --user daemon-reload
systemctl --user enable --now im-<slug>.service
```

**6. Verify it is running:**

```bash
systemctl --user status im-<slug>.service
# Must be: active (running). On failure check: journalctl --user -u im-<slug>.service -n 30
```

**7. Wait for discovery and embed the widget:**

Wait ~5-10 seconds for the discovery sweep, then embed the anchor URL:

```
[Label text](https://<skynet-domain>/interactive/<hostid>/<slug>/pane/)
```

**Teardown:** `teardown-widget.sh` works on custom widgets — it operates on
slug and filesystem paths with no template awareness. Run it when done reading
`state.json`, same as with preset widgets:

```bash
bash ~/.claude/skills/interactive-messages/teardown-widget.sh <slug>
```

---

## Live constraints

**Port range.** Widget services bind to ports 9601-9699 on your box. A box
supports at most 99 simultaneous widgets across ALL modes (terminal +
non-terminal draw from the same pool). The seven-day backstop (above) plus
your own teardown discipline are what keep this range usable. If the range is
exhausted, either invoke teardown-widget.sh on older widgets or, if truly
stuck, wait for the daily backstop to clear old widgets automatically.

**Widgets live on the agent's host.** A widget's HTML, server process, and
state.json all run on the same box as the agent that scaffolded it. There is
no cross-host widget embedding — you cannot scaffold a widget on one box and
have it served from another. This is intentional: it is what gives widgets
access to your local filesystem, credentials, and running processes.

**Arc complete.** The interactive-messages arc (Phases 137–141) has now
shipped in full. Phase 137 built the plumbing and the first template (poll,
terminal-on-click); Phase 138 added the remaining five templates and full
mode flexibility; Phase 139 delivered lifecycle — agent teardown, the
seven-day backstop, and the expired-placeholder UI; Phase 140 added
multi-widget per message and non-terminal mode documentation; Phase 141
completed custom-widget authoring guidance and a comprehensive mobile audit
with per-template caveats. The result covers six preset templates × three
submit modes; custom-widget authoring for anything outside the presets;
multi-widget per message; per-widget lifecycle with agent teardown and the
seven-day backstop; mobile-first-class rendering across every template; and
expired-placeholder UI. No further phases in this arc are planned. Future
work in this space would open a new shape. The arc-level design contract
lives in `.planning/shapes/shape-interactive-messages.md`; the ongoing
operational contract is this SKILL.md and the six preset template directories
under `substrate/skills/interactive-messages/templates/`.

---

## What would make this wrong

Five invariants you must not violate:

1. **Widgets on Skynet's backend instead of your box.** Widget HTML and
   state.json live on your box. The whole capability ceiling — widgets that
   pull from live sources you have access to — depends on this. Never serve
   widget content from Skynet's own backend.

2. **User has to say "OK I filled it out" after interacting.** The terminal act
   is inside the widget. If you write a message that says "click a button and
   then tell me what you picked", the widget is failing at its own purpose.

3. **Widget appears as a sidebar tile.** Widgets are not apps. They live only
   inside chat bubbles, never on the sidebar. The frontend enforces this, but
   do not write anything that assumes tile-level visibility.

4. **Visual affordance lies to the user.** Passive-looking selectors that
   submit on click, or button-looking elements that do not act on click — either
   breaks user trust. The templates handle this correctly; do not modify
   installed widget copies.

5. **The visual affordance lies about which mode the widget is in.** In Phase 139,
   terminal-mode widgets render clickable-buttons-that-submit; non-terminal widgets
   render passive selectors that persist state on every interaction without firing
   any submit signal. If a widget in non-terminal mode still fires a wake, or a
   widget in terminal-on-click mode fails to end the interaction on click, the
   affordance-matches-behavior invariant is broken by construction. The templates
   enforce this correctly; do not modify installed widget copies.

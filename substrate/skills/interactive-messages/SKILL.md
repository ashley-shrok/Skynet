---
name: interactive-messages
description: |
  Ask the user a question they can answer with a tap instead of typing — pick
  one, pick several, put in order, decide each, or fill in — by writing an
  `ask` block in your reply. The app shows it in a tray above the compose box
  and the answer comes back as an ordinary message. Use it only for real
  questions with a likely set of answers.
distributed: true
---

# interactive-messages — asking with the tray

Write a fenced `ask` block in your normal reply. The app doesn't draw it inside
your bubble: it shows a small "Asked you: …" line there, and puts the question
in a **tray above the user's compose box**. The user answers with a tap (or a
few, then Send), and the answer arrives as an ordinary user message that
restates the question. The tray works the same on desktop and phone.

The user is never forced to use it. Typing a reply always works; that reply
tells you they answered in words instead.

## When to use it

- **Use it** for a real decision with a likely set of answers: "ship now or
  tonight?", "which of these go in the release?", "order these by priority",
  "keep / drop / later for each of these", "how many?", "which day?"
- **Don't use it** for chatter, suggestions, "anything else?", "should I
  continue?" after every step, or a question whose answer is open-ended prose
  (just ask in words). Most questions should still be plain words.
- **Only in your own conversation with the user.** Relay messages and relay
  rooms have no tray; a block sent there just shows as plain text.
- **One ask per reply.** If you need several answers, put up to four
  questions in one block; they share one Send.
- Put the context in your prose above the block (what you found, what each
  choice means). Keep the question itself short.

## The block

```ask
id: ship-relay
question: How should I ship the relay fix?
options:
  - Ship now (recommended) | Takes about 4 minutes; open tabs get the reload prompt
  - Tonight after 10pm | Nobody's usually on then
  - Hold it | Leave it committed, not pushed
```

- The body is YAML.
- `id`: a short slug of your own. It comes back with the answer. Optional; if
  you leave it out the app makes one up from the question text.
- `question`: the full question. Required.
- `options`: two to four is best for text choices (up to 24 are allowed, for
  colours, pictures or time slots). Each option is either:
  - shorthand `Label | description`, where ` (recommended)` at the end of the
    label marks your pick; or
  - a mapping with `label`, and optionally `value` (what you get back if it
    should differ from the label), `description`, `recommended: true`, and one
    face: `color: "#hex"`, `image: /abs/path/or/skynet-file-url`, or
    `file: /abs/path`.
- Put the recommended option first.
- `kind`: defaults to `pick-one` when there are options, `text` otherwise.

### Kinds

| kind | what the user does | extra keys |
|---|---|---|
| `pick-one` | taps one option; a lone pick-one question sends on that tap | `layout: list \| grid \| week` |
| `pick-several` | ticks any number, then Send | `layout` |
| `order` | puts the `items` in order with arrows | `items` (instead of options) |
| `decide` | gives each item one label | `items`, `choices: [Keep, Drop, Later]` (2–4) |
| `text` | one line of text | `placeholder`, `default` |
| `long-text` | a paragraph or a draft to edit | `placeholder`, `default` |
| `number` | a number | `min`, `max`, `unit`, `default` |
| `money` | an amount | `currency` (default USD), `min`, `max`, `default` |
| `slider` | slides between two ends | `min`, `max`, `step`, `unit`, `default` |
| `date` | picks a day | `default` (YYYY-MM-DD) |
| `dropdown` | chooses from a long list | `options` |
| `split` | splits a total across `items`; Send waits until it adds up | `items`, `total`, `unit` |

Yes/no is a pick-one with two options. Shorthand:

```ask
question: Delete those three?
yes: Delete them
no: Not now
```

You get back `answer: Delete them` with `value: yes` (or `no`).

**Layouts.**
- `grid` lays options out as tiles. It's good for colours and pictures.
- `week` lays out time slots, days across and times down. Give each option a
  `time: YYYY-MM-DDTHH:MM` (local time); the label is optional. When every
  option has a `time`, the week layout is used automatically.

### Several questions at once

```ask
id: newbox
questions:
  - question: What size should the new box be?
    header: Size
    options: [4 GB (recommended), 8 GB]
  - question: Which agents move there?
    header: Agents
    kind: pick-several
    options: [Jarvis, Sparrow, Willa]
  - question: What should it be called?
    header: Name
    kind: text
```

- Each question shows as a tab named by its `header` (a word or two). One
  Send at the end waits until every question is answered.
- Each question also gets a **Something else…** choice, where the user types
  their own answer for just that question. You'll see `other: true` on it.

## The answer you get back

A user message whose body is an `answer` block, sometimes followed by a note
(whatever they had typed in the compose box):

```answer
ask: ship-relay
question: How should I ship the relay fix?
answer: Ship now
```

after lunch is fine

- `answer` is what the user saw: a label, a list of labels (pick-several, or
  order top to bottom, marked `ranked: true`), or a mapping (decide: item →
  choice; split: item → amount).
- `value` appears only when it differs from what was shown: your option
  values, the plain number behind `$1,200.00`, or the `YYYY-MM-DD` behind a
  date.
- Several questions come back as `answers:`, a list of `question` / `answer`
  entries in order.
- The question is always restated, so the answer is clear even if you've said
  other things since you asked.

## Notes that can come with the user's next message

Lines starting `[tray]` at the top of a user message are from the app:

- `[tray] I replied in words instead of using the tray for your question "…" (ask …).`
  The user typed a reply instead. Their words are the answer. Read them as
  such; it isn't a refusal.
- `[tray] Your earlier question "…" (ask …) was replaced by a newer one before I answered it.`
  You asked again before they answered. Don't wait for the earlier one; ask
  again if you still need it.

## How long a question stays up

- The tray holds your **latest** ask until the user answers it or sends any
  message. Your own later replies, wake-ups and other agents' messages don't
  close it.
- A new ask replaces the open one.
- You can't withdraw a question. If it stops mattering, just handle the
  answer when it comes.

## If the block can't be read

If the YAML is broken, a required piece is missing, or a kind is unknown, no
tray appears. The block shows in your bubble as plain text, so the user can
still answer in words. You won't be told, so check the block before sending:
- a question with options has at least two;
- `decide` has 2–4 `choices`;
- `split` has a `total`;
- every `week` option has a `time`.

Quote option text that contains `: ` or starts with a special character.

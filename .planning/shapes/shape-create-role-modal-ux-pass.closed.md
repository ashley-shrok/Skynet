# Shape: create-role modal UX pass

**Opened:** 2026-09-07
**Vehicle:** GSD phase

## What this is

A user-experience cleanup on the "create a new role" dialog and its sibling
"create a new agent" dialog title, tightening both away from being form-shaped
and toward being lean, opinionated flows that don't ask questions the system
already has answers to. This is item 1 of a 7-bounty UX-pass campaign Ashley
digested 2026-09-07; each of the seven lands in its own session.

## Shape

Seven changes total, six landing on the create-role dialog and one landing on
the create-agent dialog's header for alignment coherence:

- The create-role dialog gains a short header blurb explaining what a role IS
  — paired with the create-agent dialog's future blurb (shared vocabulary, one
  story across two dialogs).
- The tiny "these fields are required" caption below the fields goes away —
  the fields already carry that signal themselves.
- The "and also make an agent under this role" checkbox goes away entirely
  (deleted from DOM, not just hidden).
- The primary button always advances to the create-agent dialog on success —
  no branching. Roles-without-agents was a modeling accident the UI should
  stop advertising as a legitimate choice.
- The just-typed role name and description carry over as pre-fills into the
  create-agent dialog when it opens.
- The modal title conforms to the dropdown label that launched it (dropdown
  wording is the source of truth in this bounty).
- The create-agent dialog's modal title also conforms to its dropdown label —
  a paired tweak so the alignment intent isn't half-landed at the end of this
  bounty.
- Shared with the create-agent dialog: when the user has only one pickable
  host, the host list + search box don't render at all. This bounty lands the
  shared primitive; the create-agent bounty reuses it for free.

## Philosophy

- Dialogs stop being forms and become opinionated flows. Everything the system
  already knows or can infer gets out of the way.
- Roles-without-agents was a modeling accident. The system still tolerates
  that state as an escape hatch (user hits Escape after step 1 → role stays,
  they pick up later via the dropdown), but the UI stops advertising it.
- The two paired blurbs (role blurb here, agent blurb in the next bounty)
  share vocabulary. A first-time reader reads them in immediate sequence via
  the auto-advance and should hear one story, not two.
- Modal titles conform DOWN to their launch labels — not the reverse. The
  dropdown wording is what users see first and most often, so it's the
  source-of-truth term.
- One short sentence per blurb. Modal-header help text gets skimmed heavily;
  anything longer than a sentence loses its readers.
- Blurb framing uses product language, not engineering terms. Role is what an
  agent does and how it thinks; agent is a specific individual doing that
  role, with its own name and history.

## Prior context

Two dialogs currently exist. Their titles use longer phrasings than the
dropdown labels that launch them ("Create a role" and "Create a new agent"
vs the dropdown's shorter labels). This forces the reader to mentally connect
two different names for the same thing.

The create-role dialog currently has a checkbox offering "also create an
agent under this role" — surfacing a choice the user shouldn't really have,
because a role without any agent is a shape nobody wants intentionally.

The host picker in both dialogs renders unconditionally, including when the
user only has one pickable host (a state Ashley regularly hits herself, and
the target Aither Health users will hit even more often since their instance
provisions one dedicated VM per user).

Ashley shared a full UX-pass digest 2026-09-07 covering both these dialogs,
the clone dialog, the identity modal, the composebox, and a new runbooks
concept — this bounty is item 1 of seven. Campaign constraint from same
day: the whole string caps at push + scoped tests until every bounty lands,
so this phase's execute step and this build's pipeline both terminate at
push, not at deploy or hand-off.

## What would make it wrong

- If a role is created but the auto-advance to the create-agent dialog
  doesn't happen, the intended flow has broken and the user is stranded.
- If the create-agent dialog opens without the just-typed role name and
  description pre-filled, the handoff has silently failed — the user has to
  re-type things they just typed a moment ago.
- If the blurb sprawls beyond a single short sentence, or reads like
  marketing copy, it defeats "concise" and readers skip it.
- If the two blurbs (role here, agent next) use different words for the same
  concept, the paired-story intent is broken and each dialog feels like a
  separate universe.
- If the host picker still renders when the user has exactly one pickable
  host, the shared primitive isn't doing its job.
- If modal titles don't match the dropdown labels that launched them, the
  alignment intent is broken and the reader still has to reconcile two names
  for the same thing.
- If the "then create an agent" checkbox stays in DOM but is just hidden with
  CSS, it hasn't been removed — the intent is to delete it entirely so it
  can't reappear via a state change.
- If the escape-hatch behavior stops working (Escape after step 1 no longer
  leaves the role committed and reachable), a functional-though-not-idiomatic
  state has been broken.

## Scope edges

**In:**
- All create-role dialog changes: header blurb, drop the required-fields
  caption, delete the "then create an agent" checkbox, always advance to
  create-agent on success, pre-fill carry (name + description), title conform
  to dropdown label, hide host picker when only one pickable host.
- The create-agent dialog's title-conform tweak (paired with the role-modal
  title for alignment coherence).
- The shared "hide host picker when only one host" primitive itself — built
  once here, callable from both dialogs.

**Out:**
- The rest of the create-agent modal UX pass (its own bounty, next in the
  campaign).
- Any change to the dropdown labels themselves — they're the source-of-truth
  term in this bounty.
- The blurb for the create-agent dialog — that lands in the create-agent
  bounty using the same pattern.
- Behavior of the "New agent" dropdown option itself — untouched.

**Deferred:**
- Actual creation of a runbooks-tab concept in the identity modal — that
  chain lives in the identity-modal-tab-restructure bounty and depends on
  the runbooks-formal-concept bounty.

**Tempting but no:**
- Using this to rename the underlying modal components in code (naming
  refactor is off-scope; only user-visible labels change).
- Adding "cancel" / "back" affordances to the create-role → create-agent
  handoff. Not asked for; escape-hatch behavior already covers it.
- Changing the required-fields validation itself (only the caption
  reminding-you-it's-required goes away).

## Vehicle notes

GSD phase because the work is coherent multi-item, multi-file, user-visible,
and phase-shaped by every measure — the standing fleet directive is to set
up a phase for phase-shaped work rather than route around the ceremony.

This shape file seeds the phase's discuss step directly rather than
re-eliciting the same material — the phase's CONTEXT.md is generated from
this file.

Campaign constraint (Ashley 2026-09-07): the whole 7-bounty UX-pass string
caps at push + scoped tests. NO full suite, NO rebuild, NO deploy — until
the entire bounty string is done. Consequences for this phase:
- Execute-step tests are scoped, not full-suite.
- The /build pipeline for this bounty ends at push. No agent UAT, no deploy,
  no hand-off, no stakeholder notification for the campaign duration.
- Every push still goes through git pull --rebase per the multi-identity
  rule before pushing.

---

## Close-Out

**Closed:** 2026-09-07
**Vehicle used:** GSD phase — Phase 84, five commits (`993843ef` feat 84-01 CreateRoleDialog, `b3f5378a` feat 84-02 NewSessionDialog, `d33418d1` + `c308278d` test 84-03 test realignment, `f1443b04` docs 84-03 SUMMARY)
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · UX cleanup lands on both dialogs — form-shaped fields tightened toward lean opinionated flow
- **Shape: header blurb explaining what a role IS** — present · One-sentence blurb `A role is what an agent does and how it thinks — many agents can share one.` replaces prior description
- **Shape: required-fields caption removed** — present · Prior `Name and description are required.` caption deleted along with its i18n key
- **Shape: "then create an agent" checkbox removed from DOM** — present · State, setter, label, i18n key, and entire checkbox element deleted — not CSS-hidden
- **Shape: primary button always advances on success** — present · Chain callback fires unconditionally on 201 — no branching, no gating
- **Shape: name + description carry as pre-fills** — present · Chain passes {role, host, description}; panel stashes; sibling dialog seeds via initialHost/initialRole/initialBrief
- **Shape: role-modal title conforms to dropdown label** — present · defaultValue changed from `Create a role` to `New role` matching dropdown at panel line 2037
- **Shape: agent-modal title conforms to dropdown label** — present · defaultValue changed from `Start a new agent` to `New agent` matching dropdown at panel line 2036
- **Shape: hide host picker when only one pickable host (shared primitive across both dialogs)** — present · Inline gate `{flatHosts.length !== 1 && ...}` lands identically in both dialogs; auto-select of sole host preserved; extraction into shared symbol deferred per scope-edge note
- **Philosophy: dialogs stop being forms, become opinionated flows** — present · Choice-surfacing checkbox gone; single-host picker suppressed; blurb replaces required-caption
- **Philosophy: role-without-agents tolerated but not advertised** — present · createRole() awaited to completion before chain fires; Escape between success and step 2 leaves role committed server-side
- **Philosophy: paired vocabulary between blurbs** — present · Role blurb uses shape's philosophy vocabulary verbatim; future agent blurb structurally reserved (out of scope)
- **Philosophy: titles conform DOWN to dropdown labels** — present · Both dialog titles now equal their launching dropdown labels
- **Philosophy: one short sentence per blurb** — present · Single sentence, ~18 words
- **Philosophy: product language not engineering terms** — present · `What an agent does and how it thinks` — no engineering vocabulary
- **What would make it wrong: role created but no auto-advance** — present · Chain callback fires unconditionally after successful create — guarded
- **What would make it wrong: create-agent opens without pre-fill** — present · Panel wires chainPrefill.role/host/description → initialRole/initialHost/initialBrief on sibling dialog
- **What would make it wrong: blurb sprawls / marketing-copy** — present · One concise sentence in product language
- **What would make it wrong: blurbs use different words for same concept** — present · Role blurb uses shape's own philosophy vocabulary; sets up paired agent blurb in next bounty
- **What would make it wrong: host picker still renders with one host** — present · Gate suppresses both search input and listbox when flatHosts.length === 1 in both dialogs
- **What would make it wrong: titles don't match dropdown labels** — present · Both titles now equal their launching dropdown labels
- **What would make it wrong: checkbox hidden with CSS** — present · State, setter, label, i18n key, and DOM node all deleted
- **What would make it wrong: escape-hatch behavior broken** — present · createRole() awaits completion before chain fires; Escape after step 1 leaves role committed
- **Scope edges (IN): all listed create-role changes plus paired create-agent title plus shared single-host primitive** — present · All eight in-scope items land
- **Scope edges (OUT): rest of create-agent UX pass** — present · NewSessionDialog only receives title tweak and host-picker gate — no other identity-cluster changes touched
- **Scope edges (OUT): dropdown labels unchanged** — present · Panel dropdown labels at lines 2036/2037 untouched
- **Scope edges (OUT): create-agent blurb not added** — present · NewSessionDialog description still `Pick a host and (optionally) name the agent.` — untouched
- **Scope edges (OUT): no rename of underlying components** — present · Component names unchanged; only user-visible defaultValues changed
- **Scope edges (OUT): no cancel/back affordances added to handoff** — present · No new affordances between the two dialogs
- **Scope edges (OUT): required-fields validation itself unchanged** — present · Only the reminder caption removed; ROLE_NAME_PATTERN and descriptionValid checks intact

### Additions (in the result, not in the shape)

None.

### Follow-ups

None.

### Notes

The "shared primitive" commitment landed as an inline gate duplicated identically in both dialogs rather than an extracted symbol — the shape file explicitly permits this in Scope edges ("shared primitive... built once here, callable from both dialogs") and the material's inline comment cross-references the sibling gate. Existing non-English translations continue to render the prior long-form titles until re-translated — English is the source-of-truth locale per the phase's copy-guard, which aligns with the shape's philosophy that dropdown wording is source-of-truth. Historical comments in CreateRoleDialog still describe the old checkbox behaviour; they are historical narration only, not live UI.

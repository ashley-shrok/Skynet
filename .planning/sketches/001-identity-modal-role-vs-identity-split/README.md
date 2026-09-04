---
sketch: 001
name: identity-modal-role-vs-identity-split
question: "How should the identity modal separate role-scope content from identity-scope content, and where should role-level wakeups live?"
winner: "D"
tags: [identity-modal, layout, pretty-view, coordinator-support, wakeups]
---

# Sketch 001: Identity Modal — Role vs Identity Split

## Design Question

The identity modal currently has 6 flat tabs (Role · Identity · Bounties · History · Wakeups · Handoff) that mix role-scope content (role file, bounties, history — all under `~/.claude/roles/<role>/`) with identity-scope content (identity file, handoff — under `~/.claude/identities/<name>/`). The Wakeups tab surfaces only identity-level specs, which leaves coordinator identities — who by definition ONLY own role-scope wakeups — looking at "no scheduled wakeups" with no interface to manage them.

How should the modal be reorganized so:
1. The role/identity scope split is visually legible,
2. Both wakeup scopes are addressable, and
3. Coordinator identities render meaningfully (they don't load the role file, don't touch bounties normally, and have no handoff — role wakeups is their ONE meaningful thing)?

## How to View

Local: `open .planning/sketches/001-identity-modal-role-vs-identity-split/index.html`
Tailnet-served (mobile Safari): `http://100.99.149.8:8899/` while the sketch server is running on t1000.

## Variants

- **A · Grouped Tab Strip** — Keep the bottom icon-bar; visually cluster Role tabs on the left, Identity tabs on the right, with a subtle divider and tiny scope labels above. Wakeups appears twice (once per scope). Smallest change; may look damaged for coordinators.

- **B · Stacked Sections** — Modal body splits horizontally: Role section on top with its own mini icon-bar, Identity section below with its own. Both always visible. Coordinator case naturally collapses the Identity section down. Scope split is unmissable, but each section gets half the vertical space.

- **C · Left Rail Nav** — Bottom icon-bar replaced with a left-side navigation rail. Two clusters ("ROLE" / "IDENTITY") with labels, dividers, and named buttons. Structurally cleanest; sacrifices ~⅓ of a 390px iPhone viewport, doesn't match Skynet's chosen mobile-first bottom-bar language (patch #191).

- **D · Top Scope Switch** — Segmented control ("Role" / "Identity") at top, bottom icon-bar re-shuffles per scope. Two focused views; each scope's tabs get full space. Coordinator defaults to Role view. Two-step nav to reach anything; no simultaneous co-visibility.

- **E · Dashboard, No Tabs** — Abandon tabs; two columns of stacked cards (Role left, Identity right). Each card is a scannable summary; tap opens a full editor. Coordinator case is the strongest here — the one meaningful card visibly dominates while empty cards fade with explanatory captions. Biggest departure from current modal.

## What to Look For

Compare each variant across three dimensions:

1. **Actor legibility** — When you open the modal on a normal actor identity (Tina), does the scope split feel obvious, obtrusive, or fine? Does anything read as damaged or confusing?

2. **Coordinator legibility** — When you open the modal on a coordinator identity, does the layout tell you meaningfully what a coordinator IS (a router, not a state-holder)? Do the empty spots read as intentional or broken?

3. **Wakeup manageability** — Which layout makes it clearest that you're editing a role-scope vs. identity-scope wakeup? Which makes it easiest to add a new one?

Secondary: fidelity to the current modal's visual language (Skynet PrettyView palette, patch #191 bottom icon-bar, hue-tinted glassy selected pill). All variants inherit `themes/default.css` which reproduces the actual `--color-pv-*` tokens.

## Notes

- Coordinator identity is stubbed here with a blue-gray hue (colorHue ~200) instead of Tina's pink 324 — real coordinators will inherit whatever hue is set on their identity, but this makes the actor-vs-coordinator visual difference easier to see in comparison.
- Sample content is realistic: real bounty slugs from Tina's current pool, real wake-up spec shapes, real history line format.
- No spikes exist yet for this design question — sketches inform the design; the winner would proceed to `/gsd:plan-phase` or `/gsd:quick` depending on scope.

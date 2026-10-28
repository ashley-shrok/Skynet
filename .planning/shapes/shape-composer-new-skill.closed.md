# Shape: add a new skill option to the bottom of the quick skills menu in the compose box

**Opened:** 2026-10-28

## What this is

The composer's Skills menu lists the skills you can run with one tap. Sometimes you scroll it and realize what you need isn't there. This adds a last row, **New skill…**, that takes you straight into making one for this conversation's machine, without detouring through the Skills window in the sidebar footer.

## Shape

- **The row.** The very last row of the menu, after every skill: a plus tile in place of the lettered tile, labelled "New skill…", with a short line under it ("Make a skill that isn't here"). It is set slightly apart from the skills above it so it doesn't read as a skill. It stays at the bottom while you search, so when a search finds nothing it sits right under "No skills match".
- **Choosing it.** The menu closes and the usual two questions appear: the skill's name, then its description. They are the same questions the Skills window asks, with the same rules for names and the same refusal of an empty description.
- **Search text carries over.** If anything was typed in the menu's search box, it starts as the name. You can change it before going on.
- **Finishing.** The skill is made on this conversation's machine. The Skills window opens on that machine with the new skill open in its editor, the same place you'd land making it from the Skills window yourself.
- **Backing out.** Cancelling either question leaves you in the conversation. No Skills window opens.
- **Enter in the search box** still only runs the top matching skill. It never starts New skill.
- **When it shows.** Only when the menu itself shows. The ⚡ button is still hidden on a machine with no skills.

## Philosophy

A shortcut into skill creation that already exists, not a second way to make skills. Whatever the Skills window's New skill does (naming rules, the description requirement, where the skill lands, its default switches), this does the same. The only differences are where you start, the name you start with, and that backing out puts you back where you were.

## Prior context

Today you make a skill only from the Skills window, reached from the lightning bolt in the sidebar footer, where you also have to pick the machine. The composer's menu only runs skills. It is hidden on a machine with no skills where you could run them yourself.

## What would make it wrong

- The new row looks like a skill, or tapping it sends something to the agent.
- A skill made from here behaves differently from one made in the Skills window.
- The skill lands on some machine other than the one this conversation's agent is on.
- Backing out leaves a stray window open, or loses what you'd typed in the compose box.
- The row disappears when you search, which is exactly when you'd want it.

## Scope edges

- In: the row, the two questions, the search text as the starting name, landing in the editor, backing out to the conversation, the id skill's description of the menu.
- Out: showing the ⚡ button on a machine with no skills. Making role skills. Running the new skill right after making it.
- Tempting but no: a different, smaller form for making a skill inline in the menu.

## Handoff notes

cedar-box-maintainer-6 implements. The composer menu and the Skills window live in different parts of the app (the window belongs to the sidebar), so the menu has to ask the sidebar to open the window on a given machine with a given skill selected. This needs an id skill edit (§ Composer → Skills menu). A What's-new note needs the user's approval of the exact text.

---

## Close-Out

**Closed:** 2026-10-28
**Overall verdict:** closed-hit

### Shape features (conformance)

- **The row**: present. It's the last row after every skill, with a plus tile, "New skill…" and "Make a skill that isn't here". A divider sets it apart, and it still shows under "No skills match".
- **Choosing it**: present. The menu closes and the name question runs, then the description question. Both come from the one flow the Skills window's New skill uses too.
- **Search text carries over**: present. The trimmed search text starts as the name and can be edited. With no search, the name starts blank.
- **Finishing**: present. The skill is made on the conversation's machine, and the Skills window opens on that machine with the new skill selected.
- **Backing out**: present. Cancelling either question opens no window, and the compose box is untouched.
- **Enter in the search box**: present. It runs only the top match and never starts New skill.
- **When it shows**: present. The button is still hidden on a machine with no skills.
- **Philosophy (shortcut, not a second way)**: present. Both places use one shared flow.
- **Scope edges: id skill description**: present.
- **Scope edges: out-of-scope items absent**: present.
- **Handoff: sidebar asked to open window on machine + skill**: present.
- **What would make it wrong: row looks like a skill / sends something**: not violated.
- **What would make it wrong: behaves differently from the Skills window**: not violated.
- **What would make it wrong: lands on another machine**: not violated.
- **What would make it wrong: stray window / lost draft on back-out**: not violated.
- **What would make it wrong: row disappears when you search**: not violated.

### Additions (in the result, not in the shape)

None.

### Follow-ups

- What's-new note: no note, per the user's decision of 2026-10-28 (accepted-as-drift).

### Notes

Clean pass. One error-path side effect of sharing the flow: if a skill is created in the Skills window but reloading the list afterwards fails, the window now logs the error and still selects the new skill, where it used to show a "couldn't create" alert.

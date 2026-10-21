# Shape: the Preferences window and the feedback dialogs

**Opened:** 2026-10-21
**Campaign:** apple-ux (shape 7 of 14)

## What this is

The Preferences window (gear icon in the sidebar footer) keeps its side list but opens on the user themselves: their picture and name lead the list, each section opens with a short header saying what it's for, and settings sit in grouped rows that save as you change them. The two feedback dialogs ("Send feedback" and the thumbs-down "What went wrong?") become small, clear dialogs that confirm when they've sent.

## Shape

**Window**
- Side list: "Preferences" small at the top; then an **account card** (picture, name, "Picture, log out" under it); then About you, Voice, Notifications, Phone, Services (Notifications, Phone and Services still only show when they do today); **About** pinned at the bottom. "General" and the separate Log out item are gone.
- Opens on the account card each time.
- Each section (except the account and About) opens with a header: an icon tile, the section's name, one line saying what it's for.
- No Close button at the bottom — the X closes; settings save as they change. The only foot is About you's Edit / Cancel / Save.
- Phone: full screen, a list first — "Preferences" as a large title, the account card in its own group, the sections in a group with icon tiles and arrows, About in its own group. Tapping one opens it with "‹ Preferences" back.

**Account**
- Large picture in the middle (click it to choose a new one), the user's name, "Administrator" or "Member" and the instance's address under it.
- **Picture** group: "Your picture" (where it shows) with **Choose…** and **Remove** (Remove only when there is one).
- **Log out** as a red row in its own group, "You'll need to sign in again to get back to your agents." under it; asks first, as today.

**About you**
- **Machine** row (only machines that can run agents; only when there's more than one): already set to a machine — the one the window was opened for if there is one, otherwise the first — never an empty "pick a host" screen.
- Several files on a machine: a switcher between them, as today.
- The file shown formatted. Foot: **Edit**; while editing, **Cancel** and **Save**. A machine with nothing written yet: "Nothing written yet" with **Write it**.
- Leaving with unsaved edits asks "Discard your changes?" (switching section, machine or file, Esc, X). A file changed on disk while editing still asks to reload, as today.

**Voice**
- **Voice** row: the picker and a play button to hear it. When the saved voice isn't one the current voice service has, the row says so in words ("Matthew isn't one of OpenAI's voices, so replies use Marin") and the picker shows it as unavailable. Under the group: "Each agent can have its own voice; this is the one they use when they don't."
- **Speed** group: "How fast replies are read", the value, Reset (greyed at 1×), the slider from 0.25× to 4×. Under it: "Pitch rises with speed."
- **Voice mode sends what you said** group: "After a pause" and "When I say a phrase" as two choices with their descriptions; the **Phrase** box appears only when the phrase is chosen, with "The phrase is left out of what's sent." under it.

**Notifications**
- Connected: "Connected to <Telegram name>" with "From your bot @<bot>"; the **Only show who messaged** switch ("Leave the message text out of notifications."); **Send a test notification** as its own row; **Disconnect** as a red row ("Removes the bot from your settings. You can set it up again any time."), asking first.
- Not set up: "Set up your bot — about a minute" with three numbered steps — open @BotFather and send /newbot (with an **Open BotFather** button); give it a name and a username ending in "bot"; paste the token (box + **Connect**). Under it: the token is checked with Telegram before saving.
- Bot saved but not started yet: the same look — a row saying the bot is ready, with **Open my bot**, and "then tap Start in Telegram".

**Phone**
- **Number** row with the number editable in place; **Save** appears only once it's changed. Under it: "Include the country code (+1 for the US and Canada)."
- **Remove phone number** as a red row, asking first; removing it drops Phone from the list, as today.

**Services**
- The same header, then a group per service with its keys, as today (set, replace, remove; never shown back).

**About**
- Middle: the instance's logo and name from its branding (never a hard-coded "Skynet"), and the version.
- One group: **Source code** (the link, opens in a new tab), **Licence** (a short summary on the right, arrow), **Included components** (count, arrow).
- Licence and Included components each open one level deeper in the same window, with back to About.
- The licence page names Skynet once, as the software the licence covers ("This app is built on Skynet, …"), and adds a copyright line and a short no-warranty statement, with the existing "in practice" note under it.

**Feedback dialogs** (small; open as today)
- **Send feedback**: title, "What's working, what's not, or what you'd change — every note shapes the beta.", a text box, **Cancel** and **Send** (Send greyed until something is typed).
- **What went wrong?** (thumbs-down): "Your thumbs-down is sent either way. Add a note if it helps.", a text box, **Send without a note** and **Send** (greyed until something is typed). X / Esc / clicking outside still send the vote without a note.
- After sending, either dialog shows "Thanks — sent." with a check for a moment, then closes (instead of a pop-up notice).

## Philosophy

- The window starts with the person whose preferences these are.
- Every section says what it's for before asking anything.
- Changes save as they're made; nothing to confirm on the way out except unsaved writing.
- The thumbs-down dialog tells the truth about what closing it does.
- An instance's own branding wins everywhere except where the licence needs the software's real name.
- Apple's interfaces are the reference for behaviour; the look stays Skynet's (look A, kit parts only).
- Nothing the window or the dialogs do today is lost.

## Prior context

- Today: side list General (picture only), About you, Voice, Notifications, Phone, Services, About, Log out; About you opens on "Pick a host to load its configured files"; Voice mixes group titles and loose text; a Close button at the bottom of every section. The feedback dialogs are a plain text box in a large dialog; thumbs-down has only Send and silently sends the vote on close.
- Tasting with Ashley 2026-10-21 (`workspace/tastings/prefs/` in the identity workspace, her real picture, voice, speed, Telegram, phone and About-you file): "the preferences modal overall looks great … I don't think I have any notes", except the side-list item reads "About", not "About Skynet" — instances brand differently.
- Branding: the About header uses the instance's branded name and logo; the licence page keeps Skynet's name once because the licence covers that software, and gains the copyright and no-warranty lines the licence asks the interface to show (Ashley thumbs-up 2026-10-21).
- Window sizes are not settled here — shape-modal-sizing walks every modal at the end.
- id skill: the Preferences description (gear icon) changes with this — non-admin visible. A what's-new note goes to Ashley for approval before it's committed.

## What would make it wrong

- "General" or a separate Log out item still in the side list, or the window opening anywhere but the account.
- "Skynet" shown in the About header or the side list.
- About you opening on an empty "pick a machine" screen, or listing machines that can't run agents.
- A Close button at the bottom of sections that save as they change.
- The phrase box shown when voice mode sends after a pause.
- A saved voice the service doesn't have, shown as if it were in use.
- The thumbs-down dialog closing without saying the vote is sent anyway.
- Unsaved About-you writing vanishing without asking.

## Scope edges

- In: the Preferences window and its sections, the two feedback dialogs, the id skill's Preferences description.
- Out: the admin panel (next shape), window sizes (shape-modal-sizing), the sidebar footer itself (shape-sidebar).

# Shape: clicking an archived conversation in search opens it like a normal conversation tab — read-only, marked archived, with Un-archive

**Opened:** 2026-10-26

## What this is

Today an archived conversation found in search can only be un-archived;
clicking it does nothing. After this, clicking it opens the conversation in a
tab that looks like any conversation — the agent's picture, name and colour on
the pill, its whole history back to the start — but view-only, clearly marked
archived, with Un-archive on it. Clicking the pill opens the agent's window,
view-only, showing what is in its archived folder. Un-archiving turns the tab
and the window into the live ones in place.

## Shape

- **The archived conversation tab.** Opened by clicking an archived result in
  search (search closes, as it does for a live result; an already-open copy is
  brought forward instead of opening a second). Looks like a live
  conversation: the pill with picture, name, colour and task line; every
  message, with Load older messages back to the beginning. No compose box —
  in its place a quiet strip saying "Archived" with an Un-archive button. No
  memory pie, working indicator, permission bubble or unread marking. It
  splits, drags, moves to another window or tab, and comes back after a
  reload, like any tab. Works the same on a phone (full screen, back to the
  list).
- **The pill's menu** for an archived conversation: Move to new tab, Close,
  Un-archive. Rename, Move to and Archive are not there.
- **The agent's window, view-only.** Clicking the pill opens the same window
  as for a live agent, reading from the agent's archived folder:
  - Agent file — shown in full, no Edit.
  - Wake-ups — listed (none fire while archived), no switches, no new, no
    delete.
  - Files — the whole workspace, browse, search and download; no upload,
    create, rename or delete.
  - Git — when a repo is still there (archiving removes re-clonable ones).
  - Apps — the agent's conversation apps listed with picture, name and
    description; rows don't open, no Move to sidebar; one line at the top
    saying they run again after Un-archive.
  - Desktop — never shown.
  - Task line and voice can't be changed. Role names link to the role when it
    still exists, plain text when the role itself is archived.
- **Un-archive** from the strip or the pill menu: the strip shows it working;
  when the agent is back, the tab turns into the live conversation in place
  (compose box and all), and an open agent window turns live and editable on
  the same tab. If refused, the tab stays archived and says why, in the same
  words search uses. If it's still going after two minutes, the strip says so
  and the tab keeps waiting, switching to live whenever the agent comes back,
  without a reload.
- **Archiving closes every open copy** of that conversation — splits, other
  windows, other devices — whoever archived it and wherever from. An archived
  conversation is only ever in a tab because someone opened it from search.
- **Reload and other edge states.** A reloaded archived tab whose agent has
  since been un-archived opens as the live conversation. An archived agent
  with no history left opens with its name and colour and says no history was
  kept.
- **Where the server looks.** The server works out on its own that an agent is
  archived and reads its archived folder; the history comes from the agent's
  own history folder via the lookup from shape 1. Nothing the browser sends
  says where to look.

## Philosophy

An archived agent is still the same agent, so its conversation and its window
should look like it — just unable to change anything. View-only everywhere:
reading and downloading are fine, every change waits for Un-archive. One
server-side rule ("this agent's folder is in the archive") rather than a
parallel set of archive screens.

## Prior context

- Shape 1 made the history lookup work the same for running, sleeping and
  archived agents, from the agent's name alone.
- Search already lists archived conversations, with their name, colour, task
  line and roles, and has Un-archive in each row's menu; it waits up to two
  minutes for the outcome and names refusals.
- Today a conversation tab only opens as a chat view for agents the sidebar
  knows; anything else falls back to a terminal and closes. Archiving from a
  pane already closes that pane; other copies just stop working.
- Archiving moves the agent's whole folder — file, wake-ups, workspace,
  conversation apps — into the archive, and leaves its history where it was.

## What would make it wrong

- Anything in an archived tab or window that can change the agent, its files,
  or send it a message.
- An archived tab that looks like a broken live conversation (spinner forever,
  reconnecting, an error) instead of plainly archived.
- The server reading a folder or file location chosen by the browser.
- Access to an archived conversation decided by anything other than access to
  its machine.
- Un-archive leaving the user to close and re-find the conversation to talk
  to it.
- A tab for an agent that was just archived lingering somewhere.

## Scope edges

- In: everything above, plus the id skill's description of search, the
  conversation view and the agent's window, and a What's-new note (the user
  approves the text).
- Out: editing anything in an archived agent; running its apps; an archived
  section in the sidebar; changing search itself beyond the click.
- Deferred: nothing named.

## Handoff notes

- Repo `workspace/skynet` on `feat/tab-title-from-tmux`; piano-box-maintainer-5
  does the work. Campaign rule: committed, not pushed, not deployed.
- The history lookup is shape 1's single lookup; reuse it.
- Tabs restore from the page address, so the new kind needs its own entry
  there; cross-window drag rebuilds tabs from a description of the pane, so it
  needs one too.

---

## Close-Out

**Closed:** 2026-10-26
**Overall verdict:** closed-hit (reviewer's provisional closed-partial; both open divergences settled with the user — one fixed, one dropped by her)

### Shape features (conformance)

- **What this is** — present · Clicking an archived result opens a view-only conversation tab with the agent's look and full history, marked Archived with Un-archive; the pill opens the agent window view-only; Un-archive turns it live in place.
- **Shape: the archived conversation tab** — present · Search closes; an open copy is brought forward; look from search then the server; history with Load older messages; Archived strip in the composer's place; never unread; no memory pie, working indicator or permission bubble; own page-address and drag entries (reload, split, other windows, Move to new tab); full screen on a phone.
- **Shape: the pill's menu** — present · Move to new tab, Close, Un-archive only (the first two desktop-only, as for live conversations).
- **Shape: the agent's window, view-only** — present · Agent file without Edit; wake-ups listed, none fire, no switches/new/delete; Files read-only, server refuses every write; Git when a repo exists; Apps listed, not openable, with the "run again after Un-archive" line; no Desktop; task and voice fixed; archived roles plain text.
- **Shape: Un-archive** — present · Strip and pill menu; working → coming back; past two minutes it keeps waiting and turns live without a reload; an open agent window carries over live on the same tab; refusals in search's words.
- **Shape: archiving closes every open copy** — present · This window at once; other windows and devices when the server tells a live pane its agent is archived.
- **Shape: reload and other edge states** — present · A reloaded tab whose agent is live again waits, then turns live; no-history notice.
- **Shape: where the server looks** — present (after fix) · Reviewer found the agent window's reads let the browser pick the archive folder. the user: "Yes, fix it." Fixed in f7f00f28: the host decides (live folder wins, else the archive) for every window read.
- **Philosophy** — present · Same views with view-only switches; one server rule.
- **Prior context** — present · Shape 1's lookup; search's Un-archive outcomes and wording (now shared).
- **What would make it wrong: anything that can change the agent, its files, or send it a message** — present · No composer; server drops input for the view; workspace writes refused.
- **What would make it wrong: looks like a broken live conversation** — present · Settles like a sleeping pane; explicit notices.
- **What would make it wrong: server reading a location chosen by the browser** — present (after fix) · See "where the server looks".
- **What would make it wrong: access decided by anything other than machine access** — present · Existing per-machine checks only.
- **What would make it wrong: Un-archive leaving the user to re-find the conversation** — present · Turns live in place, window carried over.
- **What would make it wrong: a tab for a just-archived agent lingering** — present · Same-window close plus the server's signal.
- **Scope edges: IN — id skill description** — present · Search click, the tab, pill menu, view-only window, Un-archive flow, no-history notice; Archive closes every copy.
- **Scope edges: IN — What's-new note** — dropped · the user: "No note."
- **Scope edges: OUT items** — present · No editing, apps never run, no sidebar row or filing, search changed only in the click.

### Additions (in the result, not in the shape)

- A "Not in the archive" notice (no Un-archive offered) when the agent is in neither the live list nor the archive — endorsed-as-drift (the user: "Keep it.")
- Archived wake-up rows can't be opened for detail — endorsed-as-drift (reviewer: within the view-only spirit)

### Follow-ups

- None.

### Notes

Material reviewed: the change from 3b33a436 to HEAD (4 commits, 38 files) before the window-reads fix. Behaviour not tested by the reviewer, per the brief; end-to-end walk is at campaign close, after deploy.

Code review (after close-out) found and fixed, in f0d27188: copies of a sleeping or running agent open elsewhere now close when it's archived (the server tells them); gone / live-again tabs no longer sit under the loading spinner; a tab turns live only once it's coming back; "live" means the live folder holds the agent's file, and creating a wake-up never makes a folder for an agent that isn't live; copies close only after the archive succeeds; symlinks never read for archived apps. All within the shape. Agent UAT (pre-deploy): the server pieces run against real archived agents on t1000 (folder state, history, workspace root, apps) and the container sees the archive through its mount. The in-app walk is at campaign close, after deploy. One behaviour to know: like file and desktop panes, an archived tab that is neither on screen nor in a split is closed (it has no sidebar row to come back to).

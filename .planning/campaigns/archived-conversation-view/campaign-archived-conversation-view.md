# Campaign: open an archived conversation from search like a normal conversation — by finding every conversation's history from the agent's own folder, not through its terminal

**Opened:** 2026-10-25
**Status:** in_progress
**Workspace:** `.planning/campaigns/archived-conversation-view/` (in the Skynet repo)

## Concept

Every place Skynet finds an agent's conversation history finds it the same
way: go to that agent's own history folder (Claude names it after the agent's
workspace folder, so it is known from the agent's name alone) and take the
newest history file whose first real message is the agent's `/id` load. That
works the same whether the agent is running, asleep, or archived, because
archiving moves the agent's folder but leaves its history where it was. The
conversation view stops finding history by going through the agent's terminal
session, and the separate loader for sleeping agents goes away. Search and
the memory pie use the same lookup instead of reading the start of every
history file on the machine. Built on that, clicking an archived
conversation in search opens it as a normal conversation tab — same look,
the agent's name and colour, full scroll-back — read-only, clearly marked
archived, with Un-archive on it.

## Success criteria

1. Clicking an archived search result opens a conversation tab that looks
   like a live conversation: the agent's name and colour, full scroll-back,
   and it can be split, dragged, and survives a reload like any tab.
2. That tab is read-only — no way to send, nothing waiting on a running
   agent — clearly marked archived, and offers Un-archive.
3. Live and sleeping conversations behave exactly as today (sending, Stop,
   permission prompts, the working indicator, new messages arriving) and
   open at least as fast; faster on busy machines.
4. Nothing finds conversation history through the terminal anymore; the
   separate sleeping-agent loader is gone; search and the memory pie use the
   same per-agent lookup instead of the machine-wide scan.
5. An archived conversation opens only for someone with access to its
   machine — the same boundary as every other conversation — and the server
   finds the history file itself, never trusting a file location sent by the
   browser. (Who an agent is listed for is organization, not access; it adds
   no gate.)

## Shapes

- **[declared] shape-history-from-agent-folder** — one lookup (agent's own
  history folder, newest file starting with its `/id`) used by the
  conversation view, search, and the memory pie; drop the terminal route and
  the sleeping-agent loader; no visible change for live/sleeping conversations — closed
  (2026-10-26, closed-hit; review fixes in 1136dc15). Agent UAT so far is
  real-data checks of every lookup: the shell inside the live container,
  and both sweeps on t1000, workstation, thenasty and zoey. The end-to-end
  walk of live, sleeping and waking conversations in the app happens at
  campaign close, after deploy
- **[declared] shape-archived-conversation-tab** — archived search result
  opens as a normal read-only conversation tab (new tab kind that needs no
  terminal session, survives reload/split/drag), archived marking,
  Un-archive, search click wired to it; depends on shape 1 — closed
  (2026-10-26, closed-hit; window reads fixed to host-decided at the user's
  "Yes, fix it"; What's-new note dropped — the user: "No note"; "Not in the
  archive" notice kept; review fixes in f0d27188)

## Other work

- Role file learned-preference: start work with `/build`, not `/open` —
  done (2026-10-25, the user approved)
- Legacy agents outside their own history folder — domino-box-maintainer-2
  (spawned 2026-10-25 at the user's ask). Archived ones DONE (25: t1000 tina;
  workstation 22; thenasty george, nelly — re-verified: all resolve from their
  own folder). The 5 LIVE ones (workstation aqua, willa, becky, whitney;
  zoeybattlestation commander-zoey) move right after this campaign's deploy
  (the user: "Carry on, deploy at the end", 2026-10-26). AT CAMPAIGN CLOSE: once
  the deploy is live, DM Domino to start; those 5 conversations are blank for
  the minutes in between — open
- Slash-command audit — which Claude Code commands (e.g. `/clear`) break
  Skynet's assumptions and should be blocked; rigel-box-maintainer-4
  (the user: "Spawn it", 2026-10-26), report delivered to the user in its
  conversation (full table there). Summary: 17 of ~110 built-ins break
  Skynet's assumptions — session-switching (/clear, /resume, /branch, /fork,
  /rewind, /cd), taking the process from the supervisor (/background, /stop,
  /teleport, /desktop, /remote-control, /restart, /install, /exit), bypassing
  Condense (/compact, /autocompact), and /plan (plan mode is denied). Hooks
  can't block built-ins; the real block is Skynet's send path refusing them
  server-side (the supervisor itself types /exit and /compact into panes).
  Acting on it is the user's call, outside this campaign — done

## Lingerers (explicitly approved)

## Open questions

- Blaze (2026-10-25, Claude Code 2.1.310): after Condense, an agent keeps one
  history file for life; compaction and wake-from-sleep append; only a fresh
  launch with nothing to resume makes a new file. Harness records (queue
  operation, file-history snapshot, mode) can precede the `/id` turn — match
  the first real user turn; the supervisor's session-owner check is the
  precedent. Condense has since shipped — confirm the reset/recycle detection
  removal is on the branch before starting shape 1.
- the Beelink box and the laptop box were offline at the other-machines
  check (2026-10-25); Domino checks them too. Zoey's machine has a symlinked
  home (/home → /var/home) — the lookup now names folders from the real path.
- Agents sometimes start a bare Claude in their own workspace while testing
  (4 of 441 folders on t1000, e.g. diamond-box-maintainer-2 has 8 tiny
  permission-test sessions) — the `/id` check inside the folder is what
  excludes them; newest-file-only would be wrong.
- Search was just reworked (commit c5d9f8e4, "find only what the
  conversation shows") — read it before folding search onto the new lookup.
- The shelved dormant-without-tmux campaign noted a planned move from the
  interactive harness to the agent SDK. Check that SDK-run agents still write
  history under the workspace-named folder with `/id` first, so this lookup
  survives that move.
- Older Claude Code versions on other machines: confirm the history-folder
  naming and first-turn shape match before relying on them fleet-wide.

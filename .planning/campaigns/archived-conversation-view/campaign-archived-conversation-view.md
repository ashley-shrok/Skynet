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
  the sleeping-agent loader; no visible change for live/sleeping conversations — in_progress
- **[declared] shape-archived-conversation-tab** — archived search result
  opens as a normal read-only conversation tab (new tab kind that needs no
  terminal session, survives reload/split/drag), archived marking,
  Un-archive, search click wired to it; depends on shape 1 — in_progress

## Other work

- Role file learned-preference: start work with `/build`, not `/open` —
  done (2026-10-25, Ashley approved)
- Legacy agents outside their own history folder (5 live: workstation aqua,
  becky, whitney, willa; zoeybattlestation commander-zoey; ~25 archived on
  workstation/thenasty plus t1000 "tina") — handed to domino-box-maintainer-2
  (spawned 2026-10-25 at Ashley's ask) to move into their own folders without
  losing context. GATE: shape 1 resumes (/close, review, UAT) only once
  Domino reports done — Ashley: "consider it finishing the gate to continue
  with this" — open
- Slash-command audit — which Claude Code commands (e.g. `/clear`) break
  Skynet's assumptions and should be blocked; separate research agent,
  awaiting Ashley's yes to spawn — open

## Lingerers (explicitly approved)

## Open questions

- Blaze (2026-10-25, Claude Code 2.1.310): after Condense, an agent keeps one
  history file for life; compaction and wake-from-sleep append; only a fresh
  launch with nothing to resume makes a new file. Harness records (queue
  operation, file-history snapshot, mode) can precede the `/id` turn — match
  the first real user turn; the supervisor's session-owner check is the
  precedent. Condense has since shipped — confirm the reset/recycle detection
  removal is on the branch before starting shape 1.
- ashley-beelink and ashley-laptop were offline at the other-machines
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

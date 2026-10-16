# Campaign: an identity is its folder on disk, not a terminal session — dormant agents cost nothing

**Opened:** 2026-10-09
**Status:** closed (2026-10-16) — full plan shelved; lightweight stopgap shipped instead
**Workspace:** `.planning/campaigns/dormant-without-tmux/` (in the Skynet repo)

## Concept

An identity exists because its folder exists on disk, not because a terminal
session happens to be open for it. The conversation list is built from the
identity folders. A terminal session exists only while an agent is actually
running: when an agent goes dormant its session closes, and when something wakes
it (a message, a schedule, the user opening and messaging it) the session is
created fresh. Memory on a box then scales with how many agents are awake, not
with how many have ever been made. Driven by the fleet's target minimum host — a
4 GB Graviton EC2 — where a user who never archives would otherwise slowly run
out of memory to empty shells (~3.4 MB each, unbounded with identity count).

## Success criteria

1. A dormant identity uses no memory beyond a few small files on disk.
2. Every identity on disk appears in the sidebar steadily — no flicker, no
   vanishing, keeping its last-message time and ordering, awake or dormant.
3. Opening a dormant conversation shows its history and dormant state, and
   sending a message wakes it, as today.
4. Waking from a message, a schedule, the inbox, or reset all work with no
   session present.
5. Terminal sessions that are not identities no longer appear in the sidebar.
6. Existing boxes shed their already-accumulated empty dormant shells on their
   own (only truly empty ones — never a shell someone attached to and used).
7. The id skill describes the new behaviour.

## Shapes

- **[declared] shape-dormant-without-tmux** — disk-backed list + supervisor
  stops keeping/creating dormant shells + chat/terminal/reset handle a missing
  session + cleanup of existing shells + id skill — dropped (2026-10-16): the
  planned move from the interactive harness to the agent SDK, expected within
  about a month, removes per-identity terminal sessions anyway. The user asked
  for a lightweight stopgap that keeps low-spec hosts healthy until then.

## Other work

- Stopgap: dormant sessions keep existing but run the minimal shell (dash)
  instead of a full interactive bash, with their scrollback cleared. Measured
  ~0.1 MB private memory per dormant shell vs ~1.9 MB for bash — about 19x
  less. Supervisor-only; the app, wake path and id skill are unchanged. The
  supervisor swaps a dormant session's shell when the agent goes dormant,
  creates post-reboot dormant sessions on the minimal shell, and swaps
  leftover full-shell dormant sessions once they are provably idle (plain
  shell in front, no child processes, nobody attached). — done
- Leaked processes outliving their Claude sessions (stray web servers, file
  watchers, desktop helpers, orphaned helper scripts) — about as much memory as
  all the dormant shells combined. Separate later build, per the user. —
  noted-only

## Lingerers (explicitly approved)

## Open questions

- (Moot with the full plan shelved.)

- Prior art: Phase 111 (conversation list arrives complete and stays live)
  shipped a pulse that can create/remove rows and a re-ask of the session list
  on tab focus; the opening list request still asks tmux on each host. The
  shape should decide whether the opening request reads folders over SSH or
  answers from the server's already-held fleet picture.

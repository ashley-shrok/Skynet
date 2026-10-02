# Campaign: composebox messages travel through the agent-supervisor delivery path

**Opened:** 2026-10-02
**Status:** in_progress
**Workspace:** /home/ubuntu/fleet/identities/hyperion-box-maintainer/workspace/skynet/.planning/

## Concept

Today, messages typed into the pretty-view composebox reach the target agent
by the app's browser-facing side writing them directly into the agent's
terminal pane over an SSH connection. At the same time, four ambient
watchers (relay receiver, wake-up scheduler, context-pressure watch, role
and identity-file watch) write watcher events into that same pane through
a completely different path — bracketed-paste inside a single process that
holds one shared lock. The two writers do not share a lock. When they land
close together, their bytes interleave in the terminal and corrupt a turn.
This has been an open hole for a long time, named explicitly in the
ambient watcher's own code as "two writers, one pane, no shared lock."

This campaign closes the hole by moving the composebox onto the same
delivery discipline the watchers already use. Composebox messages become
small request files dropped into a per-identity inbox on the target box.
The ambient watcher gains a fifth child subprocess that picks them up and
hands them through the same parent-side paste path as the other four,
grabbing the same shared lock. Every inbound writer to the pane then goes
through one lock, and the collision becomes impossible by construction.

The work ships in two steps so the delivery substrate can be exercised in
isolation before user traffic lands on it: Shape 1 adds the substrate
without changing the composebox path; Shape 2 cuts the composebox path
onto the new substrate once Shape 1 is proven in production.

## Success criteria

- Every inbound writer to any live agent's terminal pane goes through the
  ambient watcher's single lock. No pane-writer bypasses it.
- Composebox messages compose correctly in the terminal under worst-case
  interleaving with watcher events. The pre-existing collision class is
  closed.
- Delivery substrate is exercised in production under manual drive during
  the Shape 1 → Shape 2 dwell window, and refused-delivery logging makes
  failures visible in the ambient watcher's own log stream.
- From a user's perspective, nothing visible changes about the pretty-view
  composebox experience when Shape 2 lands. The sending-bubble, the
  success-echo timing, the failure timeout all behave as they do today.
  The transport under the round-trip changed; the round-trip did not.
- Old browser-facing send-path (dormancy-wait block, split-send body-
  then-Enter dance, retry-Enter escalation, full-resend escalation) is
  retired. No dead-code drift behind a flag.
- Delivery mechanism survives dormancy transparently: a message dropped
  into a dormant identity's inbox is picked up after the next wake,
  processed in arrival order along with any other pending messages,
  without any special-case code on the composebox side beyond the
  existing wake-sentinel drop.

## Shapes

- **[declared] shape-agent-supervisor-inbox** — Agent-supervisor side only:
  ambient watcher gains a fifth child that watches a per-identity inbox,
  surfaces request files up to the parent paste path, and the parent
  pastes under the existing lock. Browser-facing side unchanged.
  Composebox still uses old path. Testable via manual file drops. —
  in_progress

- **[declared] shape-composebox-cutover** — Browser-facing compose-send
  handler switches from direct terminal writes onto the inbox-drop path.
  Wake-sentinel drop stays. Watchdog arming logic stays (active vs
  dormant window selection stays). Old send-path code is removed. —
  in_progress

## Other work

- (none yet)

## Lingerers (explicitly approved)

- (empty until close-time)

## Open questions

- What's the right manual-drive exercise path during the Shape 1 → Shape
  2 dwell window — a dedicated small helper command, or just raw shell
  file-drop plus `ls` on the inbox? Not blocking Shape 1 start; resolve
  during Shape 1 planning.
- Whether the ambient watcher gains any new structured logging/metrics
  specifically for the inbox-child subprocess (beyond the existing
  loud-stderr pattern) to make the dwell-window exercise diagnostically
  useful. Resolve during Shape 1 planning.
- Should the dormant-case watchdog window be re-examined now that
  wake-latency happens before the drop-time clock starts (fire-and-forget
  on the browser side) rather than after it (block-until-marker). The
  existing 90s + 20s + 10s window has slack but the shape of the slack
  changes. Resolve during Shape 2 planning.

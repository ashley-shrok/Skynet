# inbox-watcher — manual-drive playbook

Operator-facing playbook for the Shape-1 dwell-window exercise of the
agent-supervisor inbox-delivery substrate (shape:
`.planning/shape-agent-supervisor-inbox.md`; campaign:
`.planning/campaign-composebox-via-agent-supervisor.md`).

Shape 1 ships the substrate without routing any user traffic through it.
This document is how you verify the substrate is actually working, by hand,
during the time between Shape 1 and Shape 2.

## What the substrate looks like on-box

```
~/fleet/identities/<name>/inbox/
```

Any process on the box can drop a message file into this folder for the
identity `<name>`. The ambient-monitor's fifth child (`inbox-watcher`)
picks it up and the parent pastes it into the identity's terminal pane as
if the user had typed it there directly.

If the identity is dormant when the file is dropped, the agent-supervisor's
reconcile tick (default 30s) notices the file and triggers the wake. No
sentinel drop needed. The dropper's responsibility ends at the file.

## Drop a message by hand

For an identity named `stacy`:

```sh
ts=$(date -u +%Y%m%dT%H%M%S%3N)              # 20261002T143022123
hex=$(openssl rand -hex 4)                   # e.g. a7f3b2c1
name="${ts}-${hex}.msg"                      # 20261002T143022123-a7f3b2c1.msg
mkdir -p ~/fleet/identities/stacy/inbox
printf 'ping from manual drive' > ~/fleet/identities/stacy/inbox/${name}.tmp
mv ~/fleet/identities/stacy/inbox/${name}.tmp ~/fleet/identities/stacy/inbox/${name}
```

That is the full contract. Six steps; `mkdir` + `openssl rand -hex 4` +
timestamp + write to `.tmp` + atomic `mv` + done.

### Why write-and-rename

The watcher's name-shape filter ignores files whose names do not match
`^20[0-9]{6}T[0-9]{9}-[0-9a-f]{8}\.msg$`. A direct write (no `.tmp`
suffix) would briefly expose a partially-flushed file to the watcher's
inotify. The `.tmp` → rename gives the watcher an atomic transition from
"invisible" to "complete" — no half-written files ever picked up.

### Why `openssl rand -hex 4`

The 8-hex-char suffix MUST be sourced from a real random source. An LLM
dropper generating "random" hex characters by eyeball produces biased
output and will collide. On every Linux box in the fleet, `openssl rand
-hex 4` is available and reads from the kernel CSPRNG.

Programmatic droppers use their runtime's native CSPRNG (Python's
`secrets.token_hex(4)`, Node's `crypto.randomBytes(4).toString('hex')`,
etc.). Fallback if openssl is absent: `head -c 4 /dev/urandom | xxd -p`.

### For a human operator

A human does not need the precise timestamp+hex ceremony — any name
matching the final shape works. The one-liner above is the canonical
form so droppers across the fleet (shells, Python, Node, future
composebox code) agree on the same filename shape.

## Verify delivery

### If the identity is active

Open the identity's terminal (via tmux attach or the Skynet terminal
view). After dropping, you should see the message text appear as if the
identity had typed it. There is a brief startup delay in the ambient
monitor (default 5s on its own startup, not per-message), but subsequent
messages during the identity's uptime arrive within sub-second of the
drop.

Tail the ambient-monitor's stderr for diagnostic lines:

```sh
# This box's substrate installs the ambient-monitor's stderr under the
# identity's own working directory tree. Exact log location depends on
# how the harness is launched; agent-supervisor logs it alongside the
# supervisor's own stderr.
sudo journalctl --user -u agent-supervisor.service -f \
  | grep -E 'inbox-watcher|RAW-PASTE-FILE'
```

Expected lines:
- `inbox-watcher: started on <path> (harness_pid=<pid>)` — child started.
- `inbox-watcher: catch-up: no pending files` — nothing waiting at startup.
- `inbox-watcher: catch-up: N pending file(s) found at startup` — files
  were waiting, surfacing now.
- Nothing per-message in normal operation; refusals are loud.

### If the identity is dormant

Expect up to ~35-40s before the message arrives:
- Up to 30s until the next supervisor reconcile tick.
- A few seconds for the harness to come up.
- 5s ambient-monitor startup delay.
- Sub-second paste.

Watch the agent-supervisor log for a line like:

```
'<name>' dormancy WAKE (inbox) ...
```

Then the harness boots, the ambient-monitor starts, and the fifth child's
catch-up sweep processes the waiting file(s).

## Expected refusal behaviors

### Zero-byte file

```sh
touch ~/fleet/identities/stacy/inbox/20261002T143022123-ffffffff.msg
```

The watcher surfaces the path, the parent reads zero bytes, logs loudly:

```
ambient-monitor: RAW-PASTE-FILE from inbox-watcher: zero-byte file <path>
  — refused + discarded
```

File is removed. No paste happens.

### Oversized file (over 1 MiB)

The parent caps message bodies at 1 MiB. Anything larger is refused and
discarded without pasting:

```
ambient-monitor: RAW-PASTE-FILE from inbox-watcher: file <path> exceeds
  1048576-byte cap — refused + discarded
```

Chat-style messages are typically a few KB; the cap exists to prevent a
malformed or malicious dropper from OOMing the ambient-monitor process
and killing the harness.

### Symlink

A symlink in the inbox with a valid-shape name is refused outright
(ELOOP from the parent's `O_NOFOLLOW` open):

```
ambient-monitor: RAW-PASTE-FILE from inbox-watcher: cannot open <path>
  (OSError(40, 'Too many levels of symbolic links')) — refused + discarded
```

This guard means a dropper cannot trick the ambient-monitor into
pasting the contents of arbitrary filesystem paths (`/etc/passwd`,
`~/.ssh/id_rsa`, etc.) by dropping a crafted symlink. The dropper
contract requires regular files, not symlinks.

### Wrong-shape filename

```sh
echo "ping" > ~/fleet/identities/stacy/inbox/README.md
echo "ping" > ~/fleet/identities/stacy/inbox/20261002T143022123-UPPERCASE.msg
```

The watcher's name filter ignores these entirely. No log line, no paste,
no deletion — the files just sit there until an operator removes them.
This is deliberate: operators can keep notes in the inbox folder without
them being delivered, and mid-write `.tmp` files are safe to pre-exist.

### Pane at a shell prompt

If the harness has exited (via `/exit` or `exit`) and the tmux pane is
sitting at a bash prompt, the parent's existing guard refuses to paste
into a shell (because pasting arbitrary text at a shell is a shell
execution hazard). Logged, discarded:

```
ambient-monitor: pane <sess> is at a shell (bash) — event NOT injected,
  logged instead: ...
```

### Harness gone mid-flight

If the harness dies between the watcher surfacing the path and the parent
reading the file, the parent's `_harness_alive()` check fails and the
paste is refused:

```
ambient-monitor: harness (pid=<pid>) gone — event NOT injected, logged
  instead: ...
```

File is removed. The dropper has no way to know this happened; refusal
visibility lives entirely in this stderr stream.

## Known Shape-1 postures (not bugs)

- **Discard on refuse.** Refused deliveries are not retried, not moved
  to a dead-letter folder, and not surfaced to the dropper. For a human
  operator during the dwell-window exercise this is fine — they can see
  the stderr line and retry if needed. For Shape 2 (real user composebox
  traffic), this posture will be revisited.
- **The 5-second startup delay applies to catch-up too.** A file dropped
  into a dormant agent's inbox has to wait for the supervisor's reconcile
  tick, THEN the harness boot, THEN the 5-second delay, THEN the paste.
  Shape 2 may revisit the delay — once no second writer to the pane
  exists, the delay's rationale evaporates.
- **No response channel.** The dropper gets no acknowledgement. If
  correlation is needed (Shape 2 will arm a round-trip watchdog on the
  dropper side using the already-existing transcript-echo mechanism),
  the dropper uses the filename it generated as its own correlation
  handle — the filename is unique by construction.

## Troubleshooting

### No log lines when dropping a file

- Confirm the filename matches the final shape:
  `^20[0-9]{6}T[0-9]{9}-[0-9a-f]{8}\.msg$`. Case-sensitive on the hex
  (must be lowercase).
- Confirm the file was moved into the inbox atomically — a direct write
  without the `.tmp` rename may be processed as a complete file but
  depending on write-vs-read race, may yield a short read.
- Confirm the identity's ambient-monitor is actually running:
  `pgrep -af ambient-monitor | grep <name>`.
- Confirm inotifywait is installed on the box:
  `command -v inotifywait`. inotifywait is a hard requirement — if
  absent, the fifth child dies at startup with a FATAL stderr line and
  the launcher surfaces its death wake. Install `inotify-tools` and
  recycle the harness to recover (`agent-supervisor.sh`'s
  `ensure_inotifywait` on supervisor startup should normally handle
  this automatically; manual install needed only if the supervisor
  itself hasn't run on this box yet).

### File sits forever

- Fifth child may have died. Check the ambient-monitor's stderr for a
  `[inbox-watcher] exited` line, then restart the identity's harness.
- `inotifywait` process may have died inside the fifth child. The child
  has an exponential-backoff respawn loop; if that's wedged (e.g.
  `fs.inotify.max_user_instances` saturated), you'll see repeated
  "inotifywait failed to start" lines on stderr.

### Multiple messages pile up

Order is preserved by the sortable timestamp-prefixed filename. If files
land in strict timestamp order, they paste in strict timestamp order.
Same-millisecond ties fall back to lexical order of the hex suffix.

## Tests

Tests covering the Shape 1 behavior live at:

- `substrate/scripts/tests/inbox-watcher.test.sh` — inbox-watcher.py
  behavior (inotify pickup, order preservation, catch-up on startup,
  name-shape filter).
- `substrate/scripts/tests/agent-supervisor-inbox-wake.test.sh` —
  supervisor's `inbox_has_files` fourth dormant-wake kind.

Both are bash drivers; run from the repo root:

```sh
bash substrate/scripts/tests/inbox-watcher.test.sh
bash substrate/scripts/tests/agent-supervisor-inbox-wake.test.sh
```

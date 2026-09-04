---
name: claude-code-harness-auth
description: >-
  refreshes authentication of the Claude Code harness via long-lived subscription
  OAuth token (`claude setup-token`), written into `~/.claude/settings.json` env
  block for immediate live-session pickup
---

## Load-bearing philosophy

- **Silence is success.** A day where the installed token is younger than 11 months = zero
  DMs, zero log lines, zero state on disk. The skill exists visually only when it has
  something to say.
- **Notice and resolve are one loop, not two.** The DM that says "click this URL" is the
  same conversation Ashley pastes the code back into; the token that setup-token then
  prints is captured by the agent without any further ask.
- **Agent-driven, not user-driven.** The agent runs `claude setup-token` in a sidecar tmux
  on the target box, captures the URL, DMs it out, receives the code, pastes it in, scrapes
  the printed token, and installs it. Ashley's only manual step is clicking the URL and
  DMing back the code from her browser. She never runs a command herself.
- **Ephemeral and self-cleaning.** The sidecar tmux exists only for the duration of the
  flow. Complete, cancel, or time out — either way, nothing lingers.

## Why this shape

`claude setup-token` is a distinct Claude Code subcommand that opens the same browser OAuth
flow as `/login` but prints a **1-year subscription OAuth token** (`sk-ant-oat01-...`) to
the terminal instead of writing `.credentials.json`. Docs:

> "For CI pipelines, scripts, or other environments where interactive browser login isn't
> available, generate a one-year OAuth token with `claude setup-token`... The command opens
> the same browser authorization flow as `/login`, and the token prints to the terminal
> after you approve access in the browser."
> — https://code.claude.com/docs/en/authentication

Placing the token in the `env` block of `~/.claude/settings.json` (as
`CLAUDE_CODE_OAUTH_TOKEN`) makes it available to every claude launch on the box regardless
of invocation path (interactive, systemd, tmux). The settings.json env block takes
**precedence over shell exports**, and Claude Code re-reads it aggressively — a fresh token
took effect on an already-running session immediately in the 2026-09-03 verification, no
recycle needed. That property is what makes the "rescue a 401'd session" flow work without
disturbing the identity's current work.

The old skill drove `/login` inside a sidecar tmux, DMed the URL, and pasted a returned code
back — producing a short-lived `.credentials.json` OAuth session that expired in
days-to-weeks (anthropics/claude-code issues #33811, #36911). Setup-token gives a 1-year
token with an ~11-month renewal cadence — an order-of-magnitude improvement in
false-positive DM frequency, same agent-driven UX for Ashley.

Empirically verified 2026-09-02: `claude setup-token` at Claude Code 2.1.150+ does NOT pop
the 3-option auth-method menu that `/login` does — it's a bare subcommand that goes straight
to URL emission. No pre-URL prompt handling needed.

## State model

**Install marker (permanent, one per identity):**

    ~/.claude/identities/<name>/.oauth-token-install-marker

Contents: single line, ISO-8601 UTC timestamp of when the currently-installed token was
last written. Read on every daily wake to check age. Written by Phase B on successful
install. Absent = no token has ever been installed by this skill on this box (bootstrap case).

**Pending-flow state (transient, exists only while awaiting Ashley's paste):**

    ~/.claude/identities/<name>/harness-auth-pending.json

Contents:

    {
      "started_at":     "2026-09-04T03:45:00Z",
      "attempt":        1,
      "tmux_session":   "fleet-auth-setup-172344",
      "step":           "awaiting-code",         // or "awaiting-token-capture"
      "box_hostname":   "aither-mgmt",
      "user_room_id":   "!xxxxx:thenasty.taild9b663.ts.net",
      "url_sent_at":    "2026-09-04T03:45:05Z"
    }

Written atomically (`.tmp` then `mv`). Cleared on successful install or on timeout.

`step` transitions: `awaiting-code` (Ashley clicks URL, DMs code back) →
`awaiting-token-capture` (agent pastes code, watches pane for `sk-ant-oat01-...`).

## Phase A — check-and-maybe-start (daily silent check)

Runs from a scheduled wake-up spec. One clean check per day.

### A.0 — check for stale pending state first

    ST=~/.claude/identities/<name>/harness-auth-pending.json
    if [ -f "$ST" ]; then
      URL_AT=$(jq -r '.url_sent_at' "$ST")
      AGE_H=$(( ($(date +%s) - $(date -d "$URL_AT" +%s)) / 3600 ))
      if [ "$AGE_H" -ge 4 ]; then
        SESSION=$(jq -r '.tmux_session' "$ST")
        tmux kill-session -t "$SESSION" 2>/dev/null
        rm -f "$ST"
        # DM: "✗ [box: <HOSTNAME>] setup-token flow timed out waiting for code — will retry next daily wake"
        # Fall through into A.1 for fresh evaluation.
      else
        # Still legitimately in-flight. Silent exit; don't stack a second DM.
        exit 0
      fi
    fi

### A.1 — evaluate token age

    MARKER=~/.claude/identities/<name>/.oauth-token-install-marker
    if [ ! -f "$MARKER" ]; then
      NEEDS_PROMPT=1
      REASON="no token installed — bootstrap"
    else
      INSTALLED_AT=$(cat "$MARKER")
      AGE_DAYS=$(( ($(date +%s) - $(date -d "$INSTALLED_AT" +%s)) / 86400 ))
      if [ "$AGE_DAYS" -ge 330 ]; then
        NEEDS_PROMPT=1
        REASON="installed $AGE_DAYS days ago, approaching 1-year expiry"
      else
        exit 0
      fi
    fi

### A.2 — spawn sidecar tmux and drive `claude setup-token`

    HOSTNAME=$(hostname -s)
    SESSION="fleet-auth-setup-$$"
    tmux new-session -d -s "$SESSION" -x 400 -y 60
    # Widen the pane's stty view so the URL emits on a single line without box-wrap.
    tmux send-keys -t "$SESSION" "stty cols 400 rows 60 && cd /tmp && claude setup-token" Enter

### A.3 — capture URL from pane

⚠️ **Even with a wide tmux pane, the URL may be drawn inside a bordered box** at whatever
column width Claude Code decides; the stitcher below is defense-in-depth. Poll for a
full-length `https://claude.…` URL; timeout coarse.

    URL=""
    for _ in $(seq 1 60); do
      PANE=$(tmux capture-pane -t "$SESSION" -p 2>/dev/null || true)
      URL=$(printf '%s\n' "$PANE" | awk '
        /^https:\/\/claude\.(com|ai)/ { collecting=1; url=""; }
        collecting && NF > 0 && !/^╭|^╰|^│|^─|^ *Paste|^ *Esc|^ *Browser/ {
          line=$0; gsub(/^[[:space:]]+|[[:space:]]+$/, "", line);
          url = url line;
        }
        collecting && (NF == 0 || /^ *Paste code/) { print url; exit }
      ')
      [ -n "$URL" ] && [ ${#URL} -gt 100 ] && break     # >100 chars guards against partial capture
      sleep 1
    done
    if [ -z "$URL" ] || [ ${#URL} -lt 100 ]; then
      tmux kill-session -t "$SESSION" 2>/dev/null
      # DM: "✗ [box: <HOSTNAME>] setup-token didn't produce a URL — will retry next daily wake"
      exit 0
    fi

The URL matcher is loose on purpose — Claude Code has changed URL formats between versions.
If a future version breaks the matcher, the URL-capture timeout fires and Ashley gets a
plain-error DM instead of a partial success. Coarse-grained failure by design.

### A.4 — DM Ashley the URL and persist state

Via the `agent-relay` skill's building blocks (log in with
`~/.claude/identities/<name>/relay.json`, find or create the DM room, send). Body:

    🔐 [box: <HOSTNAME>, maintainer: <name>] Claude Code harness needs a fresh subscription OAuth token.
    Click and complete the browser OAuth flow:
    <URL>
    Then DM me the code (bare — just the code, nothing else). Reason: <REASON>

Persist state:

    cat > ~/.claude/identities/<name>/harness-auth-pending.json.tmp <<EOF
    {
      "started_at":     "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
      "attempt":        1,
      "tmux_session":   "$SESSION",
      "step":           "awaiting-code",
      "box_hostname":   "$HOSTNAME",
      "user_room_id":   "<the DM room id>",
      "url_sent_at":    "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    }
    EOF
    mv ~/.claude/identities/<name>/harness-auth-pending.json.tmp \
       ~/.claude/identities/<name>/harness-auth-pending.json

Return control. Sidecar sits idle waiting for the code. The relay receiver wakes the
maintainer when Ashley DMs back; Phase B runs then.

## Phase B — continue with code, capture token, install

Runs from the maintainer's reflex when Ashley's DM lands and pending state exists.

### B.1 — sanity-check state and sidecar

    ST=~/.claude/identities/<name>/harness-auth-pending.json
    [ -f "$ST" ] || exit 0
    SESSION=$(jq -r '.tmux_session' "$ST")
    STEP=$(jq -r '.step' "$ST")
    [ "$STEP" = "awaiting-code" ] || exit 0
    tmux has-session -t "$SESSION" 2>/dev/null || {
      rm -f "$ST"
      # DM: "✗ sidecar tmux is gone — will retry next daily wake"
      exit 0
    }

### B.2 — extract the code from the DM body

If Ashley DMed anything other than a plausible OAuth code, it's chat, not the code — leave
state alone, respond conversationally.

    CODE=$(printf '%s' "$MSG_BODY" | tr -d '[:space:]')
    if [ -z "$CODE" ] || [ ${#CODE} -gt 200 ]; then
      exit 0
    fi

### B.3 — feed the code into the sidecar via bracketed paste

⚠️ `tmux send-keys "$CODE" Enter` looks right but the trailing Enter gets absorbed by the
TUI's bracketed-paste handling — the code deposits into the input buffer but stays
unsubmitted, and B.4 loops to timeout even though the code was fine. Same failure family
as delivering messages to a Claude Code REPL. **Fix: atomic bracketed paste, THEN a
separate discrete Enter after the paste settles.**

    tmp=$(mktemp)
    printf '%s' "$CODE" > "$tmp"
    tmux load-buffer -t "$SESSION" "$tmp"
    tmux paste-buffer -p -t "$SESSION"
    rm -f "$tmp"
    sleep 0.5
    tmux send-keys -t "$SESSION" Enter
    # Update state: awaiting-code → awaiting-token-capture
    jq '.step="awaiting-token-capture"' "$ST" > "$ST.tmp" && mv "$ST.tmp" "$ST"

### B.4 — scrape the `sk-ant-oat01-...` token from the pane

After the code lands, setup-token validates it against Anthropic and prints the token.
Poll the pane for a `sk-ant-oat01-` line; timeout coarse (~60s).

    TOKEN=""
    for _ in $(seq 1 60); do
      PANE=$(tmux capture-pane -t "$SESSION" -p 2>/dev/null || true)
      # Match a full token: sk-ant-oat01-<base64ish, ~100+ chars>
      TOKEN=$(printf '%s\n' "$PANE" | grep -oE 'sk-ant-oat01-[A-Za-z0-9_-]{80,}' | head -1)
      [ -n "$TOKEN" ] && break
      # Detect explicit failure signals; break early rather than wait the full timeout.
      if printf '%s\n' "$PANE" | grep -qiE 'invalid|failed|error|expired'; then
        break
      fi
      sleep 1
    done
    if [ -z "$TOKEN" ]; then
      tmux kill-session -t "$SESSION" 2>/dev/null
      rm -f "$ST"
      # DM: "✗ [box: <HOSTNAME>] token capture failed (code likely rejected or expired) — will retry next daily wake"
      exit 0
    fi

### B.5 — jq-merge the token into settings.json env block

    SETTINGS=~/.claude/settings.json
    [ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"

    # Surgical merge — preserve every existing key, set only env.CLAUDE_CODE_OAUTH_TOKEN.
    jq --arg t "$TOKEN" '.env.CLAUDE_CODE_OAUTH_TOKEN = $t' "$SETTINGS" > "$SETTINGS.tmp"

    # Validate merged output before atomic swap.
    if ! jq -e . "$SETTINGS.tmp" >/dev/null 2>&1; then
      rm -f "$SETTINGS.tmp"
      tmux kill-session -t "$SESSION" 2>/dev/null
      rm -f "$ST"
      # DM: "✗ merge produced invalid JSON — token NOT installed, please retry"
      exit 1
    fi

    # Backup existing settings for rollback, atomic swap, tighten perms.
    cp "$SETTINGS" "$SETTINGS.pre-token-backup"
    mv "$SETTINGS.tmp" "$SETTINGS"
    chmod 600 "$SETTINGS"

### B.6 — record install date, verify, clean up, DM success

    # Install marker for the daily-check age calculation
    date -u +%Y-%m-%dT%H:%M:%SZ > ~/.claude/identities/<name>/.oauth-token-install-marker

    # Light verification — grep the token back out to confirm the merge landed
    INSTALLED=$(jq -r '.env.CLAUDE_CODE_OAUTH_TOKEN // ""' "$SETTINGS")
    [ "$INSTALLED" = "$TOKEN" ] || {
      # DM: "✗ post-install verify failed — token in settings.json != captured token"
      exit 1
    }

    # Clean up sidecar + pending state
    tmux kill-session -t "$SESSION" 2>/dev/null
    rm -f ~/.claude/identities/<name>/harness-auth-pending.json

    # DM: "✓ [box: <HOSTNAME>] token installed. Applies to all claude launches on this box AND
    # takes effect on already-running sessions immediately (verified live-propagation 2026-09-03).
    # Next renewal reminder in ~11 months."

## Phase C — timeouts and stale-state cleanup

**Code-paste timeout (4 hours from `url_sent_at`)** — handled in A.0. Setup-token's OAuth
code from Anthropic is short-lived (~10-15 min from browser step), so 4h is really "if
Ashley didn't come back within 4h assume she's not going to" — anything past that will fail
Anthropic's own validation anyway. On stale detection, kill sidecar, clear state, and fall
through to a fresh Phase A evaluation.

**Token-capture timeout (60 seconds after code paste)** — handled in B.4. If the pane
doesn't produce `sk-ant-oat01-...` within a minute, the code was rejected or setup-token
hit a failure mode we don't recognize. Kill sidecar, clear state, DM Ashley, retry next
daily wake.

**Sidecar died mid-flow.** Handled in B.1 — if `tmux has-session` fails, clean up state
and DM Ashley the failure without feeding the code into nothing.

## Rescuing an already-401'd session

If a running claude session is currently returning 401 because its prior credentials
expired, installing a fresh setup-token via this flow **does not require a session
recycle**. The settings.json env block is re-read by Claude Code aggressively — the
2026-09-03 verification showed a live session picking up the new token within seconds of
the settings.json write without any `/logout` or restart.

This means the skill CAN be triggered ad-hoc (not just from the daily wake) as a
mid-session rescue. Same Phase A → B flow; the pending state file just gets seeded
manually or from a different trigger. No changes needed.

## Storage / security notes

- **File permissions**: `~/.claude/settings.json` written 0600 by B.5. The token is a
  year-long subscription credential; treat as a long-lived secret.
- **Backup file**: `.pre-token-backup` sibling preserves the pre-install state for
  rollback. Consider cleanup after N days if it accumulates (rare — only one per install).
- **Same token across multiple boxes**: technically works (one subscription can back N
  boxes) but blast-radius on token compromise scales with box count. **Prefer per-box
  tokens** — each box's flow runs setup-token independently and produces a distinct
  token. Rotation is per-box independent.
- **Bare mode caveat**: `claude --bare` does NOT read settings.json env, per docs. If any
  fleet usage relies on bare mode, this skill won't cover it — fall back to
  `ANTHROPIC_API_KEY` export for those specific invocations. Not fleet-relevant today.

## What would make this go wrong

- **Ashley gets DMed when nothing is actually wrong.** False-positive DMs — asking for a
  fresh token when the current one is still valid — erode trust. The 11-month threshold
  is generous exactly to avoid this. Never DM inside 11 months.
- **jq-merge clobbers existing settings.json keys.** B.5's merge is
  `.env.CLAUDE_CODE_OAUTH_TOKEN = $t` — surgical, only touches the one key. If the merge
  logic is ever loosened (e.g. `.env = {...}` overwrite), it silently deletes other env
  vars. Same-shape gotcha for the top-level: never `settings.json` overwrite; always
  key-merge.
- **The install marker gets lost or corrupted.** Daily check re-triggers on missing marker
  (bootstrap case). If a working token IS installed but marker is gone, Ashley gets an
  unnecessary DM. Consider deriving install date from settings.json mtime as fallback OR
  keeping the marker under version control alongside the settings.
- **Sidecar dies mid-flow.** Handled explicitly in B.1 and Phase C's paste-timeout cleanup;
  if either check is ever loosened, a zombie tmux hoards a session slot forever.
- **Token-capture regex misses a future format change.** Anthropic could rename the token
  prefix or change the character set. B.4's regex `sk-ant-oat01-[A-Za-z0-9_-]{80,}` is
  loose but not future-proof. A miss triggers the coarse-fail path (DM Ashley, retry next
  daily) — she'll notice within a day and fix the regex.
- **Subscription lapses.** If Claude Max expires or org membership changes, setup-token
  stops working. Skill has no visibility — Ashley sees 401, fixes subscription first.
- **The flow becomes a place things get stuck.** A sidecar tmux that survives failure and
  blocks a session slot. A state file that never clears. Ashley DMs the code and nothing
  happens. Cleanup (in B.4, B.5, B.6, and Phase C's stale check) is load-bearing — if a
  change loosens ANY of them, the trust goes.

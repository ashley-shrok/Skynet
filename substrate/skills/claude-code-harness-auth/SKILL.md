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
  same conversation Alice pastes the code back into; the token that setup-token then
  prints is captured by the agent without any further ask.
- **Agent-driven, not user-driven.** The agent runs `claude setup-token` in a sidecar tmux
  on the target box, captures the URL, DMs it out, receives the code, pastes it in, scrapes
  the printed token, and installs it. Alice's only manual step is clicking the URL and
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
false-positive DM frequency, same agent-driven UX for Alice.

Empirically verified 2026-09-02: `claude setup-token` at Claude Code 2.1.150+ does NOT pop
the 3-option auth-method menu that `/login` does — it's a bare subcommand that goes straight
to URL emission. No pre-URL prompt handling needed.

## State model

**Install marker (permanent, one per identity):**

    ~/fleet/identities/<name>/.oauth-token-install-marker

Contents: single line, ISO-8601 UTC timestamp of when the currently-installed token was
last written. Read on every daily wake to check age. Written by Phase B on successful
install. Absent = no token has ever been installed by this skill on this box (bootstrap case).

**Pending-flow state (transient, exists only while awaiting Alice's paste):**

    ~/fleet/identities/<name>/harness-auth-pending.json

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

`step` transitions: `awaiting-code` (Alice clicks URL, DMs code back) →
`awaiting-token-capture` (agent pastes code, watches pane for `sk-ant-oat01-...`).

## Phase A — check-and-maybe-start (daily silent check)

Runs from a scheduled wake-up spec. One clean check per day.

### A.0 — check for stale pending state first

    ST=~/fleet/identities/<name>/harness-auth-pending.json
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

### A.0.5 — trim old harness-auth-logs

Keeps `~/.claude/harness-auth-logs/` bounded without a separate cron. Deletes only
session directories that are BOTH beyond the 20 newest AND older than 30 days
(whichever threshold keeps MORE, keeps). Runs once per daily wake, right before A.1.

    LOGROOT=~/.claude/harness-auth-logs
    if [ -d "$LOGROOT" ]; then
      SAFE_BY_COUNT=$(ls -1t "$LOGROOT" 2>/dev/null | head -20)
      find "$LOGROOT" -maxdepth 1 -mindepth 1 -type d -mtime +30 2>/dev/null | while read d; do
        BN=$(basename "$d")
        printf '%s\n' "$SAFE_BY_COUNT" | grep -qxF "$BN" && continue
        rm -rf "$d"
      done
    fi

### A.1 — evaluate token age

    MARKER=~/fleet/identities/<name>/.oauth-token-install-marker
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
    LOGDIR=~/.claude/harness-auth-logs/$SESSION
    mkdir -p "$LOGDIR"
    tmux new-session -d -s "$SESSION" -x 500 -y 60
    # ⚠️ Enable pipe-pane BEFORE launching claude — captures 100% of pane output to a
    # durable file. Poll-based `tmux capture-pane` snapshots race the render and can miss
    # transitional state (2026-09-08 incident: post-code-paste response was written and
    # the pane closed before the next 1s poll caught it — no way to diagnose without the
    # continuous stream). Load-bearing safety.
    tmux pipe-pane -t "$SESSION" -o "cat >> $LOGDIR/live.log"
    # ⚠️ Do NOT `exec claude setup-token` — when claude exits the shell dies with it and
    # the tmux session collapses, taking any post-claude pane state (including the token
    # line and any error) with it. Plain `claude setup-token` leaves the shell alive after
    # claude exits so pipe-pane keeps recording and post-mortem is possible.
    # stty cols widened to 500 (was 400) for headroom on progressive-render truncation.
    tmux send-keys -t "$SESSION" "stty cols 500 rows 60 && cd /tmp && claude setup-token" Enter

### A.3 — capture URL from the pipe-pane log

⚠️ **Even with a wide tmux pane, the URL may be drawn inside a bordered box** at whatever
column width Claude Code decides; the stitcher below is defense-in-depth. Read from the
DURABLE pipe-pane log (not per-poll `capture-pane` snapshots which race the render),
strip ANSI escape codes (color/format sequences + OSC 8 hyperlinks that pipe-pane records
verbatim from the raw pane), and require STABILITY across two consecutive 1s samples
before accepting the URL — the URL is only "ready" when the log stops accumulating
pieces of it.

    # ANSI stripper: removes CSI (`\e[...m` etc) and OSC 8 hyperlink sequences.
    strip_ansi() { sed -E $'s/\x1b\\[[0-9;]*[a-zA-Z]//g; s/\x1b\\][0-9]+;[^\a\x1b]*(\a|\x1b\\\\)//g'; }
    # Grep-based extraction. The URL contains only URL-safe chars, so a character-class
    # match is more reliable than awk-based line-stitching that has to reason about pane
    # boundaries, box borders, and "Paste code here" exit sentinels. If the log contains
    # multiple URL fragments (progressive render, terminal wrap noise), pick the longest —
    # which is either the full URL or, if wrap really did happen, still the closest to it.
    # Empirical origin: 2026-09-08 on zoeybattlestation, strip_ansi normalized whitespace
    # runs so `Paste code here if prompted` came through as `Pastecodehereifprompted` and
    # the old awk exit condition `/Paste code/` never fired, causing the stitcher to
    # append post-URL content into the URL. Grep sidesteps that.
    extract_url() {
      strip_ansi < "$LOGDIR/live.log" \
        | grep -oE 'https://claude\.[a-z]+/cai/oauth/authorize\?[A-Za-z0-9%&=_/.:-]+' \
        | awk '{ if (length > max) { max=length; s=$0 } } END { print s }'
    }
    URL=""
    for _ in $(seq 1 60); do
      URL=$(extract_url)
      if [ -n "$URL" ] && [ ${#URL} -gt 100 ]; then
        sleep 1
        URL2=$(extract_url)
        [ "$URL" = "$URL2" ] && break
        URL=""
      fi
      sleep 1
    done
    if [ -z "$URL" ] || [ ${#URL} -lt 100 ]; then
      tmux kill-session -t "$SESSION" 2>/dev/null
      # DM: "✗ [box: <HOSTNAME>] setup-token didn't produce a URL — logs at $LOGDIR/live.log — will retry next daily wake"
      exit 0
    fi

    # URL post-condition: assert the OAuth query params setup-token is supposed to emit
    # are all present. If Claude Code ever changes the URL format and drops one, we want
    # to fail LOUD here rather than silently ship an incomplete URL to Alice whose
    # browser OAuth flow would then fail with an obscure error. Belt to the length
    # check's suspenders — length alone can't distinguish "full URL" from "full URL
    # of a format that no longer produces a valid session."
    for req in "client_id=" "response_type=" "code_challenge=" "state="; do
      case "$URL" in
        *"$req"*) ;;
        *)
          tmux kill-session -t "$SESSION" 2>/dev/null
          # DM: "✗ [box: <HOSTNAME>] URL capture missing required param '$req' — Claude Code URL format may have changed. Logs at $LOGDIR/live.log. Skill needs an update before this can retry."
          exit 0
          ;;
      esac
    done

The URL matcher is loose on purpose — Claude Code has changed URL formats between versions.
If a future version breaks the matcher, the URL-capture timeout fires and Alice gets a
plain-error DM instead of a partial success. Coarse-grained failure by design.

⚠️ **Do NOT skip the ANSI strip on any DM sent to Alice.** pipe-pane captures include
trailing OSC 8 hyperlink markers (`\e]8;;`) that render as `[39m]8;;` junk in a chat
message and break the URL click. The strip_ansi step must run before the URL text is
shown to a human.

### A.4 — DM Alice the URL and persist state

Via the `agent-relay` skill's building blocks (log in with
`~/fleet/identities/<name>/relay.json`, find or create the DM room, send). Body:

    🔐 [box: <HOSTNAME>, maintainer: <name>] Claude Code harness needs a fresh subscription OAuth token.
    Click and complete the browser OAuth flow:
    <URL>
    Then DM me the code (bare — just the code, nothing else). Reason: <REASON>

Persist state:

    cat > ~/fleet/identities/<name>/harness-auth-pending.json.tmp <<EOF
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
    mv ~/fleet/identities/<name>/harness-auth-pending.json.tmp \
       ~/fleet/identities/<name>/harness-auth-pending.json

Return control. Sidecar sits idle waiting for the code. The relay receiver wakes the
maintainer when Alice DMs back; Phase B runs then.

## Phase B — continue with code, capture token, install

Runs from the maintainer's reflex when Alice's DM lands and pending state exists.

### B.1 — sanity-check state and sidecar

    ST=~/fleet/identities/<name>/harness-auth-pending.json
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

If Alice DMed anything other than a plausible OAuth code, it's chat, not the code — leave
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

⚠️ **Use `tmux set-buffer` with inline data — do NOT `tmux load-buffer` from a tmp file.**
`mktemp` as one user + `tmux load-buffer` running as another user (via `runuser` / `sudo`
/ `su`) returns Permission denied on the tmp file, silently pasting an empty buffer and
producing "Invalid code" downstream. Named-buffer + inline data has no cross-uid perm
surface. Marker log entry `=== PASTE-BEGIN ===` gives downstream token extraction a way
to skip pre-paste noise (URL characters etc) if needed. (2026-09-08 incident.)

    # Marker into pipe-pane log so B.4 can split pre-paste noise from post-paste output.
    echo '=== PASTE-BEGIN ===' >> "$LOGDIR/live.log"

    # Named-buffer paste — inline data, no tmp file, no cross-uid perm trap.
    tmux set-buffer -b harness-auth-code -- "$CODE"
    tmux paste-buffer -p -b harness-auth-code -t "$SESSION"
    tmux delete-buffer -b harness-auth-code
    sleep 1.5    # let bracketed paste settle before the discrete Enter (0.5s was too tight for longer codes)
    tmux send-keys -t "$SESSION" Enter
    # Update state: awaiting-code → awaiting-token-capture
    jq '.step="awaiting-token-capture"' "$ST" > "$ST.tmp" && mv "$ST.tmp" "$ST"

### B.4 — scrape the `sk-ant-oat01-...` token from the pipe-pane log

After the code lands, setup-token validates it against Anthropic and prints the token.
Read from the durable pipe-pane log (not `capture-pane` snapshots — those race the
render and can miss transitional state or the token entirely if claude exits before
the next poll fires). Strip ANSI escapes, and require the match to be STABLE across
two consecutive 1s samples: on 2026-09-07, `capture-pane` snapshotted mid-render and
delivered a 99-char partial token that regex-matched the `{80,}` floor but was
missing the final ~30 chars — Anthropic returned "OAuth access token is invalid" the
next time the token was used. A stability check would have caught this, since the
next sample would have shown the full-length token and the two samples would have
mismatched. **Do not remove the stability check.**

    extract_token() {
      # Read only the post-paste section (after the PASTE-BEGIN marker from B.3) so
      # the URL from A.3 can't be confused for a token.
      awk '/=== PASTE-BEGIN ===/{flag=1; next} flag' "$LOGDIR/live.log" \
        | strip_ansi \
        | grep -oE 'sk-ant-oat01-[A-Za-z0-9_-]+' | tail -1
    }
    TOKEN=""
    for _ in $(seq 1 60); do
      CAND=$(extract_token)
      if [ -n "$CAND" ] && [ ${#CAND} -ge 80 ]; then
        sleep 1
        CAND2=$(extract_token)
        if [ "$CAND" = "$CAND2" ]; then TOKEN="$CAND"; break; fi
      fi
      # Explicit setup-token error visible AND no token candidate → break early rather
      # than wait full 60s.
      if grep -qiE 'OAuth error|invalid code|failed|expired' "$LOGDIR/live.log" && [ -z "$CAND" ]; then
        break
      fi
      sleep 1
    done
    if [ -z "$TOKEN" ]; then
      tmux kill-session -t "$SESSION" 2>/dev/null
      rm -f "$ST"
      # DM: "✗ [box: <HOSTNAME>] token capture failed (code likely rejected or expired) — logs at $LOGDIR/live.log — will retry next daily wake"
      exit 0
    fi

⚠️ **Length is a weak signal — legit tokens can be as short as 108 chars, so a min-length
floor higher than 80 would produce false rejections.** The load-bearing safeties are the
stability check here AND the live Anthropic verify in B.6. Do not lean on length alone.

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

### B.6 — API-verify against Anthropic, record install date, clean up, DM success

⚠️ **Load-bearing check: hit Anthropic `/v1/messages` with the captured token BEFORE
writing the install marker.** A merge that lands invalid bytes (silent truncation,
stale-buffer bleed, prefix mismatch, mid-render capture) produces a settings.json that
LOOKS installed but returns 401 as soon as it's actually used. Merge-equality
(`INSTALLED == TOKEN`) only proves the write landed — NOT that Anthropic will honor
the bytes. 2026-09-07: a 99-char partial token was captured and installed silently,
`.credentials.json` from an earlier `/login` masked the 401 for ~11 hours until it
expired, and the failure only surfaced the next day. **Live verify is the only check
that catches silent-invalid-token cases.**

    HTTP=$(curl -sS -o /tmp/harness-auth-verify-$$.json -w "%{http_code}" \
      https://api.anthropic.com/v1/messages \
      -H "Content-Type: application/json" \
      -H "anthropic-version: 2023-06-01" \
      -H "Authorization: Bearer $TOKEN" \
      -d '{"model":"claude-haiku-4-5-20251001","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}')
    if [ "$HTTP" != "200" ]; then
      # Roll back from the pre-install backup — the token in settings.json is bad.
      cp "$SETTINGS.pre-token-backup" "$SETTINGS"
      chmod 600 "$SETTINGS"
      rm -f /tmp/harness-auth-verify-$$.json
      tmux kill-session -t "$SESSION" 2>/dev/null
      rm -f "$ST"
      # DM: "✗ [box: <HOSTNAME>] token captured but Anthropic returned $HTTP on verify —
      #      rolled back to prior settings.json — logs at $LOGDIR/live.log — will retry next daily wake"
      exit 1
    fi
    rm -f /tmp/harness-auth-verify-$$.json

    # Belt-and-suspenders: confirm the merge itself landed the exact captured bytes.
    INSTALLED=$(jq -r '.env.CLAUDE_CODE_OAUTH_TOKEN // ""' "$SETTINGS")
    [ "$INSTALLED" = "$TOKEN" ] || {
      # DM: "✗ post-install merge-verify failed — token in settings.json != captured token"
      exit 1
    }

    # Second Anthropic verify — against the token READ BACK FROM settings.json, not from
    # memory. The first verify (above) confirmed the CAPTURED bytes are honored; this one
    # confirms the INSTALLED bytes are honored. Closes the narrow race window between
    # capture and merge (Anthropic-side revocation, subscription flap, TOCTOU on the
    # settings.json write). 100-200ms cost, one class of bug closed.
    HTTP2=$(curl -sS -o /tmp/harness-auth-verify2-$$.json -w "%{http_code}" \
      https://api.anthropic.com/v1/messages \
      -H "Content-Type: application/json" \
      -H "anthropic-version: 2023-06-01" \
      -H "Authorization: Bearer $INSTALLED" \
      -d '{"model":"claude-haiku-4-5-20251001","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}')
    if [ "$HTTP2" != "200" ]; then
      cp "$SETTINGS.pre-token-backup" "$SETTINGS"
      chmod 600 "$SETTINGS"
      rm -f /tmp/harness-auth-verify2-$$.json
      tmux kill-session -t "$SESSION" 2>/dev/null
      rm -f "$ST"
      # DM: "✗ [box: <HOSTNAME>] token was 200-verified pre-merge but $HTTP2 post-merge — race between capture and settings.json swap. Rolled back. Logs at $LOGDIR/live.log."
      exit 1
    fi
    rm -f /tmp/harness-auth-verify2-$$.json

    # Install marker for the daily-check age calculation — written ONLY after BOTH
    # Anthropic verifies pass. A bad token that got rolled back must not get its age
    # reset, or the daily check would wait another ~11 months before re-prompting.
    date -u +%Y-%m-%dT%H:%M:%SZ > ~/fleet/identities/<name>/.oauth-token-install-marker

    # Also stash the expired `.credentials.json` (if any) aside so it can't confuse Claude
    # Code's precedence logic on next launch — an expired short-lived credentials file
    # can mask a fresh env-block token for hours before finally erroring (see 2026-09-07).
    [ -f ~/.claude/.credentials.json ] && \
      mv ~/.claude/.credentials.json ~/.claude/.credentials.json.stale-$(date +%Y%m%d)

    # Clean up sidecar + pending state
    tmux kill-session -t "$SESSION" 2>/dev/null
    rm -f ~/fleet/identities/<name>/harness-auth-pending.json

    # DM: "✓ [box: <HOSTNAME>] token installed and Anthropic-verified (HTTP 200).
    # Applies to all claude launches on this box AND takes effect on already-running sessions
    # immediately (verified live-propagation 2026-09-03). Next renewal reminder in ~11 months."

## Phase C — timeouts and stale-state cleanup

**Code-paste timeout (4 hours from `url_sent_at`)** — handled in A.0. Setup-token's OAuth
code from Anthropic is short-lived (~10-15 min from browser step), so 4h is really "if
Alice didn't come back within 4h assume she's not going to" — anything past that will fail
Anthropic's own validation anyway. On stale detection, kill sidecar, clear state, and fall
through to a fresh Phase A evaluation.

**Token-capture timeout (60 seconds after code paste)** — handled in B.4. If the pane
doesn't produce `sk-ant-oat01-...` within a minute, the code was rejected or setup-token
hit a failure mode we don't recognize. Kill sidecar, clear state, DM Alice, retry next
daily wake.

**Sidecar died mid-flow.** Handled in B.1 — if `tmux has-session` fails, clean up state
and DM Alice the failure without feeding the code into nothing.

## Rescuing an already-401'd session

If a running claude session is currently returning 401 because its prior credentials
expired, installing a fresh setup-token via this flow **does not require a session
recycle**. The settings.json env block is re-read by Claude Code aggressively — the
2026-09-03 verification showed a live session picking up the new token within seconds of
the settings.json write without any `/logout` or restart.

This means the skill CAN be triggered ad-hoc (not just from the daily wake) as a
mid-session rescue. Same Phase A → B flow; the pending state file just gets seeded
manually or from a different trigger. No changes needed.

⚠️ **`.credentials.json` from an earlier `/login` masks env-block tokens.** If a box has
an unexpired `~/.claude/.credentials.json` (produced by an interactive `/login` at any
prior point), Claude Code prefers it over the env-block token until it expires. B.6
now stashes any present `.credentials.json` aside as `.credentials.json.stale-<date>`
at install time so the fresh env-block token takes effect immediately rather than
sitting behind an expiring shadow. Do NOT skip this step — the 2026-09-07 incident had
a fresh (but invalid) env-block token installed at noon and the pre-existing
`.credentials.json` masked the 401 for ~11 hours until it expired at midnight, at
which point the underlying broken token surfaced.

## Storage / security notes

- **File permissions**: `~/.claude/settings.json` written 0600 by B.5. The token is a
  year-long subscription credential; treat as a long-lived secret.
- **Backup file**: `.pre-token-backup` sibling preserves the pre-install state for
  rollback and is USED by B.6 when Anthropic-verify returns non-200. Keep at least the
  most recent; consider cleanup of older ones after N days (rare — only one per install).
- **Forensic logs**: `~/.claude/harness-auth-logs/<session>/live.log` (pipe-pane raw
  stream) persists after the sidecar tmux is killed. Kept for post-mortem — every
  failure the skill has hit was undebugable without them. Tiny disk cost, huge
  post-mortem value. Consider periodic cleanup of `harness-auth-logs/` older than N
  days if it grows unbounded; a successful install produces one directory of ~5-50KB.
- **Same token across multiple boxes**: technically works (one subscription can back N
  boxes) but blast-radius on token compromise scales with box count. **Prefer per-box
  tokens** — each box's flow runs setup-token independently and produces a distinct
  token. Rotation is per-box independent.
- **Bare mode caveat**: `claude --bare` does NOT read settings.json env, per docs. If any
  fleet usage relies on bare mode, this skill won't cover it — fall back to
  `ANTHROPIC_API_KEY` export for those specific invocations. Not fleet-relevant today.

## What would make this go wrong

- **Alice gets DMed when nothing is actually wrong.** False-positive DMs — asking for a
  fresh token when the current one is still valid — erode trust. The 11-month threshold
  is generous exactly to avoid this. Never DM inside 11 months.
- **jq-merge clobbers existing settings.json keys.** B.5's merge is
  `.env.CLAUDE_CODE_OAUTH_TOKEN = $t` — surgical, only touches the one key. If the merge
  logic is ever loosened (e.g. `.env = {...}` overwrite), it silently deletes other env
  vars. Same-shape gotcha for the top-level: never `settings.json` overwrite; always
  key-merge.
- **The install marker gets lost or corrupted.** Daily check re-triggers on missing marker
  (bootstrap case). If a working token IS installed but marker is gone, Alice gets an
  unnecessary DM. Consider deriving install date from settings.json mtime as fallback OR
  keeping the marker under version control alongside the settings.
- **Sidecar dies mid-flow.** Handled explicitly in B.1 and Phase C's paste-timeout cleanup;
  if either check is ever loosened, a zombie tmux hoards a session slot forever.
- **Token-capture regex misses a future format change.** Anthropic could rename the token
  prefix or change the character set. B.4's regex `sk-ant-oat01-[A-Za-z0-9_-]{80,}` is
  loose but not future-proof. A miss triggers the coarse-fail path (DM Alice, retry next
  daily) — she'll notice within a day and fix the regex.
- **Silent-invalid-token: partial capture passes the regex but fails Anthropic.** A
  progressive-render truncation, a stale buffer bleed, or any other capture-side bug can
  produce a byte-shaped-like-a-token string that the regex accepts as valid. Without the
  live Anthropic verify in B.6, this installs a broken token that returns 401 as soon as
  it's actually used. The load-bearing defense is the API verify — NOT the regex or a
  min-length heuristic (legit tokens can be as short as 108 chars, so tightening the
  floor introduces false rejections without buying safety). If the verify is ever
  loosened or removed, this failure mode resurfaces. Empirical origin: 2026-09-07 on
  thenasty — 99-char partial token installed silently, hid behind an expiring
  `.credentials.json` from an earlier `/login` for ~11 hours, then 401 surfaced when
  `.credentials.json` expired and no longer masked the bad env-block token.
- **Cross-uid tmp-file paste fails silently.** If `mktemp` runs as one user (e.g. root
  invoking via SSH) but `tmux load-buffer` runs as another (via `runuser`), the tmp file
  is unreadable by tmux, `load-buffer` silently fails, and `paste-buffer` inserts an
  empty or stale buffer — setup-token then says "Invalid code" and B.4 loops to timeout
  on a code that was never actually delivered. B.3's `tmux set-buffer -b <name> -- "$CODE"`
  form has no file surface at all and dodges this.
- **`exec claude setup-token` collapses the sidecar on claude exit.** With `exec`, when
  claude exits (success OR failure) the shell dies, the tmux window closes, and the
  session dies with it — taking any post-claude pane state (token line, error line,
  everything) with it. Plain `claude setup-token` keeps the shell alive after claude
  exits, and pipe-pane keeps recording. A.2 must not use `exec`.
- **Subscription lapses.** If Claude Max expires or org membership changes, setup-token
  stops working. Skill has no visibility — Alice sees 401, fixes subscription first.
- **The flow becomes a place things get stuck.** A sidecar tmux that survives failure and
  blocks a session slot. A state file that never clears. Alice DMs the code and nothing
  happens. Cleanup (in B.4, B.5, B.6, and Phase C's stale check) is load-bearing — if a
  change loosens ANY of them, the trust goes.

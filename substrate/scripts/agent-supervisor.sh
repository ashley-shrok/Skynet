#!/bin/bash
# agent-supervisor.sh — keep this box's /id-running Claude Code sessions alive + relay-reachable.
#
# One lean, idempotent supervisor. Each targeted identity gets a tmux session (named after the
# identity, spaces slugified to hyphens) running `claude` + `/id <name>`. Covers boot + crash +
# sleep recovery: a session that vanished (reboot/crash) or whose claude died is (re)launched;
# a live one is left alone. On bring-up, launches are STAGGERED (one at a time) so a box with many
# identities never forks N sessions at once.
#
# Canonical copy lives in the home app (~/vms-apps/apps/home/agent-supervisor.sh), served +
# self-updating like the skills. Installed per-box (e.g. ~/.local/bin/agent-supervisor) and run as
# a systemd --user service. Config: ~/.claude/agent-supervisor.conf (a sourced bash file).
#
# Usage:
#   agent-supervisor.sh            # loop forever, reconcile every CHECK_INTERVAL sec (systemd ExecStart)
#   agent-supervisor.sh --once     # one reconcile pass, then exit
#   DRY_RUN=1 agent-supervisor.sh --once   # report what it WOULD do, touch nothing
#
# Config file (~/.claude/agent-supervisor.conf), sourced as bash:
#   MODE=A                         # A = supervise exactly the IDENTITIES array; B = all active identities
#   IDENTITIES=("commander zoey")  # (MODE=A only) bash array; quotes handle spaces in names
#   # optional knobs (defaults shown):
#   # CHECK_INTERVAL=30            # seconds between reconcile passes in loop mode
#   # STAGGER_SECONDS=8            # extra gap between launches during a bring-up
#   # SETTLE_SECONDS=6             # time budget to blind-drive past the trust prompt before sending /id
set -uo pipefail

CONF="${AGENT_SUPERVISOR_CONF:-$HOME/.claude/agent-supervisor.conf}"
IDENTITIES_DIR="${AGENT_IDENTITIES_DIR:-$HOME/.claude/identities}"
SELF_PATH="$(readlink -f "$0" 2>/dev/null || echo "$0")"
log() { printf '%s %s\n' "$(date '+%H:%M:%S')" "$*"; }

# Per-identity "last recycle at" — LOG-ONLY. Populated when recycle() finishes; read to enrich
# the DEAD-recovering + RESUME log lines so a fresh-claude death within the recycle window (which
# causes the recovery path to resume the pre-recycle session and silently UNDO the recycle) is
# obvious in the log. Behavior is untouched — Ashley chose visibility over defense (2026-07-23).
declare -A LAST_RECYCLE_AT=()

# ---- config ----
MODE=""
IDENTITIES=()
CHECK_INTERVAL=15
STAGGER_SECONDS=8
SETTLE_SECONDS=6
MEMORY_CAP="disabled"    # 2026-08-08 fleet policy (Ashley + Stacy catch): cap mechanism was unsafe
                         # at scale (below WSS = thrash; cgroup child-inheritance broke Stacy's t800
                         # builds). Session-dormancy replaces it for idle reclamation (bounty
                         # session-dormancy-pilot-beelink). "auto" is still a VALID value below for
                         # anyone who wants the historic zram-detect behavior; it's just no longer
                         # the DEFAULT — a stale conf without an explicit MEMORY_CAP now inherits
                         # "disabled", not the old 80M trap. Per-box overrides: MEMORY_CAP="auto"
                         # (historic zram-detect), MEMORY_CAP="150M" (explicit), etc.
[ -f "$CONF" ] && . "$CONF"
if [ -z "${MODE:-}" ]; then log "no MODE in $CONF (set MODE=A or MODE=B) — nothing to do"; exit 1; fi

# ---- dormancy (2026-08-07) defaults — OFF fleet-wide, enabled per-box via $CONF: DORMANCY="on"
# See bounty session-dormancy-pilot-beelink for the design + measurement plan.
DORMANCY="${DORMANCY:-off}"
IDLE_THRESHOLD_MINUTES="${IDLE_THRESHOLD_MINUTES:-30}"     # pilot 10; prod default 30 (Ashley 2026-08-08: idle-check triple-guard is conservative enough that 30 is safe)
FALSE_KILL_MINUTES="${FALSE_KILL_MINUTES:-5}"              # wake within this many min of kill = flagged
DORMANCY_STATE_DIR="${DORMANCY_STATE_DIR:-$HOME/.claude/agent-supervisor-state}"
METRICS_LOG="${METRICS_LOG:-$HOME/.claude/agent-supervisor-metrics.jsonl}"
MEM_SAMPLES_LOG="${MEM_SAMPLES_LOG:-$HOME/.claude/agent-supervisor-mem-samples.jsonl}"

# ---- resolve the claude binary (a --user service may lack ~/.local/bin on PATH) ----
CLAUDE="${AGENT_SUPERVISOR_CLAUDE:-}"   # explicit override (non-standard install paths; also testable)
if [ -z "$CLAUDE" ]; then
  for c in "$HOME/.local/bin/claude" /usr/local/bin/claude /usr/bin/claude; do
    [ -x "$c" ] && { CLAUDE="$c"; break; }
  done
  [ -z "$CLAUDE" ] && CLAUDE="$(command -v claude 2>/dev/null || true)"
fi
if [ -z "$CLAUDE" ]; then log "claude binary not found — cannot supervise"; exit 1; fi

# ---- tmux is mandatory: sessions ARE tmux sessions. Fail LOUD if it's missing (otherwise the
#      launch silently no-ops — `tmux: command not found` — and nothing ever comes up). ----
if ! command -v tmux >/dev/null 2>&1; then
  log "tmux not found on PATH — cannot supervise. Install it (Debian/Ubuntu: sudo apt install -y tmux; Fedora/atomic: rpm-ostree install tmux or a distrobox)."
  exit 1
fi
# ⚠️ Every tmux call below is wrapped in `timeout -k 5 10 tmux …`. The reconcile loop is
# sequential per identity; a single stuck tmux child (server unresponsive to a specific pane,
# copy-mode, wedged buffer) would hang the entire loop indefinitely. Caught 2026-08-10: stacy's
# supervisor stuck 20h on a hanging `tmux send-keys deco cd`, blocking every identity's
# matrix_peek/schedule_peek so no dormant agent could wake. 10s bounded, SIGKILL 5s after.

# ---- fleet baseline: ensure Agent Teams (resumable sub-agents) is on for every future session ----
# CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 must be set user-wide so sub-agents are resumable everywhere.
# We assert it in ~/.claude/settings.json (read at each claude launch). Idempotent + best-effort:
# a safe merge that preserves every existing key, and never fails the supervisor. Runs once at start;
# a session already running won't pick it up until relaunched, but every new session will.
ensure_agent_teams_env() {
  command -v node >/dev/null 2>&1 || return 0
  node -e '
    const fs=require("fs"),os=require("os"),p=require("path");
    const f=p.join(os.homedir(),".claude","settings.json");
    try{ fs.mkdirSync(p.dirname(f),{recursive:true}); }catch(e){ process.exit(0); }
    let d={}; try{ d=JSON.parse(fs.readFileSync(f,"utf8")); }catch(e){}
    if(typeof d!=="object"||!d||Array.isArray(d)) d={};
    d.env=(d.env&&typeof d.env==="object")?d.env:{};
    if(d.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS==="1"){ console.log("noop"); process.exit(0); }
    d.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS="1";
    try{ fs.writeFileSync(f,JSON.stringify(d,null,2)+"\n"); console.log("set"); }catch(e){ console.log("skip"); }
  ' 2>/dev/null | grep -q '^set$' && log "ensured CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 in settings.json (new sessions will pick it up)"
  return 0
}

# ---- source-of-truth prompt + auto-compact skipping ----
# Modern Claude Code fires two blocking prompts on the resume path that the scrape loop in drive()
# has to answer by hand, PLUS runs an auto-compact operation that eats restored context:
#   (1) folder-trust ("Is this a project you created or one you trust?") — regression vs a fresh
#       launch, where --dangerously-skip-permissions covers it. Answered at source via the
#       per-workdir .projects[<cwd>].hasTrustDialogAccepted flag in ~/.claude.json.
#   (2) resume-summary ("Resuming the full session will consume …") — fires when session age >
#       CLAUDE_CODE_RESUME_THRESHOLD_MINUTES (default 70) or token-count > CLAUDE_CODE_RESUME_TOKEN_THRESHOLD
#       (default 100000). Answered at source via the two env vars below.
#   (3) auto-compact on resume — a KNOWN regression on 1M-context models (GH #56271 closed
#       "not planned", #64923 dupe): compact fires at ~50-76k tokens with 900k+ headroom due
#       to a server-side/UI token-count mismatch. WAS previously fought post-hoc with a
#       ~6s Ctrl-C train in drive(); now killed at source by CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=99
#       (verified in the 2.1.150 binary via `strings`), which pins the threshold high enough
#       that the buggy trigger never fires. Auto-compact was never desired for supervised
#       /id sessions anyway — context-watch recycles the session fresh at 80% displayed,
#       which is lossless vs a lossy in-place summary.
# Scrape kept as defense-in-depth for (1) and (2): if a future release changes env-var names or
# the config key, the scrape still catches the prompt.
CLAUDE_LAUNCH_ENV="CLAUDE_CODE_RESUME_THRESHOLD_MINUTES=99999999 CLAUDE_CODE_RESUME_TOKEN_THRESHOLD=99999999 CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=99"

# Flags passed to every `claude` launch. Consolidated so all 4 launch sites (redrive+drive × resume+fresh)
# stay in sync — an inline-per-site spelling means a flag can silently fall off some but not others
# (2026-09-04, Ashley: fleet came back on Sonnet by default after supervisor recycles because --model opus
# was never wired in). Adding a flag = one edit here, applies everywhere.
CLAUDE_LAUNCH_FLAGS="--model opus --dangerously-skip-permissions"

# ---- memory cap (2026-08-06) — wrap claude launches in a systemd scope with MemoryHigh ----
# Rationale: claude's baseline is ~500 MB RSS per session (Ink React TUI + Node/V8, architectural).
# On boxes with zram-primary swap, reclaim under a soft MemoryHigh ceiling is cheap enough (LZO
# decompress on fault-in ≈ ms) to sit comfortably below the natural working set. Bella's beelink
# sweep (bounty cgroup-memory-high-idle-paging-prototype): idle pressure knee at 80M/60M, chose 80M
# → ~85% RAM cut per agent with imperceptible cost. On boxes WITHOUT zram, the same ceiling would
# push cold pages to NVMe on every reclaim, making DM response times perceptibly slow — so we
# auto-skip in that case and run naked.
#
# The wrapper is inserted BEFORE the CLAUDE_LAUNCH_ENV in the send-keys lines below, with `env`
# in between so the shell command-scoped env assignment still applies to claude (not to
# systemd-run). Empty MEMORY_WRAPPER = no change vs pre-2026-08-06 behavior.
#
# Per-box override in $CONF: MEMORY_CAP="disabled" (never wrap) or MEMORY_CAP="150M" (explicit).
MEMORY_WRAPPER=""
resolve_memory_wrapper() {
  local target
  case "$MEMORY_CAP" in
    disabled|off|0|"")
      log "memory-cap: disabled (MEMORY_CAP='$MEMORY_CAP') — claude runs unconstrained"
      return ;;
    auto)
      # read /proc/swaps directly — kernel-provided, no PATH dependency (swapon isn't always on
      # the --user service's PATH; /proc/swaps always is). Format: header line + one line per swap
      # device with Filename in column 1; we just need "/dev/zram" to appear as a device.
      if awk 'NR>1 && $1 ~ /^\/dev\/zram/ {found=1; exit} END {exit !found}' /proc/swaps 2>/dev/null; then
        target="80M"
      else
        log "memory-cap: no zram in /proc/swaps — claude runs unconstrained (add zram to enable the 80M ceiling)"
        return
      fi ;;
    *)
      target="$MEMORY_CAP" ;;   # explicit override like "150M" or "400M"
  esac
  if ! command -v systemd-run >/dev/null 2>&1; then
    log "memory-cap: systemd-run missing — cannot apply MemoryHigh=$target, claude runs unconstrained"
    return
  fi
  MEMORY_WRAPPER="systemd-run --scope --user --quiet -p MemoryHigh=$target -p MemorySwapMax=infinity"
  log "memory-cap: MemoryHigh=$target will wrap future claude launches"
}

# Idempotent per-workdir trust flag. Matches ensure_agent_teams_env in shape (node, safe fallback).
# Called before every claude launch so a brand-new resolved workdir (e.g. a new identity's first
# resume, or ViewModelShell that was never trusted) is set before drive() types the launch.
accept_trust_for_workdir() {
  local wd="$1"
  [ -n "$wd" ] || return 0
  command -v node >/dev/null 2>&1 || return 0
  node -e '
    const fs=require("fs"),os=require("os"),p=require("path");
    const f=p.join(os.homedir(),".claude.json");
    const wd=process.argv[1];
    let d={}; try{ d=JSON.parse(fs.readFileSync(f,"utf8")); }catch(e){}
    if(typeof d!=="object"||!d||Array.isArray(d)) d={};
    d.projects=(d.projects&&typeof d.projects==="object")?d.projects:{};
    d.projects[wd]=(d.projects[wd]&&typeof d.projects[wd]==="object")?d.projects[wd]:{};
    if(d.projects[wd].hasTrustDialogAccepted===true){ console.log("noop"); process.exit(0); }
    d.projects[wd].hasTrustDialogAccepted=true;
    try{ fs.writeFileSync(f,JSON.stringify(d,null,2)+"\n"); console.log("set"); }catch(e){ console.log("skip"); }
  ' "$wd" 2>/dev/null | grep -q '^set$' && log "accepted trust for workdir '$wd' in ~/.claude.json (dialog will not render)"
  return 0
}

# ---- identity list for this pass ----
resolve_identities() {
  if [ "$MODE" = "B" ]; then
    IDENTITIES=()
    local d name
    for d in "$IDENTITIES_DIR"/*/; do
      [ -d "$d" ] || continue
      name="$(basename "$d")"
      [ "$name" = archive ] && continue          # defensive; identity-archive is a SIBLING dir, not here
      # require a real identity file (skip empty stubs like a bare `/id` scaffold)
      [ -f "$d/$name.md" ] || continue
      IDENTITIES+=("$name")
    done
  fi
  # MODE=A: IDENTITIES comes straight from the conf array.
}

slug() { printf '%s' "$1" | tr ' ' '-'; }   # canonical session name: spaces -> hyphens, case preserved

# Find the ACTUAL existing tmux session name matching $1 CASE-INSENSITIVELY (tmux names are
# case-sensitive, but a human may name a session 'hilda' for identity 'Hilda' — a case difference
# must NOT cause a duplicate). Prints the real session name if found, else nothing.
match_session() {
  local want s; want="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  while IFS= read -r s; do
    [ -n "$s" ] || continue
    [ "$(printf '%s' "$s" | tr '[:upper:]' '[:lower:]')" = "$want" ] && { printf '%s' "$s"; return 0; }
  done < <(timeout -k 5 10 tmux ls -F '#{session_name}' 2>/dev/null)
  return 1
}

# SAFETY: the supervisor NEVER kills a session. Sessions are SHELL sessions (claude runs inside,
# so a crashed claude drops back to a shell prompt and the session persists — the normal case).
# Liveness is "is a live claude process on the session's tty", NOT "does the session exist".
# Recovery re-drives claude INTO the existing session (no kill). A double-probe before any action
# means a transient misread can never spuriously drive a live agent.
#
# is a claude/node process on the session's pane tty? (ps over the tty lists claude even when a
# child bash is momentarily foreground, so this doesn't false-negative during tool calls.)
claude_running() {
  local tty; tty="$(timeout -k 5 10 tmux list-panes -t "=$1" -F '#{pane_tty}' 2>/dev/null | head -1)"
  [ -n "$tty" ] && ps -t "${tty#/dev/}" -o comm= 2>/dev/null | grep -qiE 'claude|node'
}

# wait_for_claude: poll claude_running() up to N seconds with short backoff. Returns 0 the moment
# it sees claude/node on the pane's tty, 1 if the whole budget elapses with no sighting. Used by
# drive() to confirm the launch command actually spawned claude (as opposed to being eaten by
# typeahead garbage — a terminal Device Attributes response echoing at the prompt has been seen
# to collapse `env ... claude ...` into `;`-separated garbage, so `0c` becomes the command name
# and claude never launches). Cheap: single ps per iteration.
wait_for_claude() {
  local sess="$1" budget="${2:-8}" spent=0
  while [ "$spent" -lt "$budget" ]; do
    claude_running "$sess" && return 0
    sleep 1; spent=$((spent+1))
  done
  return 1
}

# _check_id_first_turn <jsonl-path> <identity-name>
# Predicate: does the first user-role line of the jsonl match "/id NAME" as a real slash-command
# user turn? Three byte-string checks (per Tina 2026-08-29 consult on the Skynet approach —
# zero JSON.parse, ~40× cheaper and tolerant to Claude Code byte-shape drift):
#   1. Line is a real user turn: contains "type":"user" AND NOT tool_result / "content":[ /
#      <local-command-caveat> / <local-command-stdout> (harness-synthesized turns fool a naive check).
#   2. Slash-command wrapper: contains <command-name>/id</command-name>.
#   3. Strict-delimiter args match: <command-args>NAME followed by <, whitespace, or line end —
#      refuses <command-args>storyteller< to match identity "story" (prefix-collision guard).
_check_id_first_turn() {
  local path="$1" name="$2"
  local line
  # First user-role line (up to 8KB — /id is always the first user turn on a fresh session)
  line=$(head -c 8192 "$path" 2>/dev/null | grep -m1 '"type":"user"')
  [ -z "$line" ] && return 1
  case "$line" in
    *'"tool_result"'*|*'"content":['*|*'<local-command-caveat>'*|*'<local-command-stdout>'*) return 1 ;;
  esac
  case "$line" in
    *'<command-name>/id</command-name>'*) ;;
    *) return 1 ;;
  esac
  # grep -E for the strict delimiter — ${name} followed by <, whitespace, or end-of-line
  printf '%s' "$line" | grep -qE "<command-args>${name}(<|[[:space:]]|$)"
}

# _check_resume_nudge_landed <jsonl-path>
# Predicate: did the resume-nudge text land as a real user turn in the resumed jsonl? Substring
# match on tail of file — the nudge phrase is distinctive enough (fixed 152-byte string) that
# co-occurrence with "type":"user" on the same line is definitive. Byte-string check (no
# JSON.parse) matches the _check_id_first_turn shape.
_check_resume_nudge_landed() {
  local path="$1"
  tail -c 32768 "$path" 2>/dev/null | grep -q '"type":"user".*Your session was just resumed by the agent-supervisor'
}

# submit_id: paste `/id NAME` into the pane and verify it actually landed as a user turn in
# Claude Code's per-session jsonl file. See `_check_id_first_turn` above for the predicate,
# and Tina's 2026-08-29 consult (event $xA63ie79SXO17I5x7_k5dq_vUNya5Z5hmLQNK_gYBLg) for the
# full design rationale.
#
# Approach:
#   1. Snapshot pre-existing jsonls under ~/.claude/projects/<sanitized-cwd>/
#      (Claude Code mangles the cwd: replace every "/" with "-".)
#   2. C-c + load-buffer + paste-buffer + Enter — same paste sequence as before.
#   3. Poll for a NEW jsonl appearing (not in the snapshot) whose first user-role line matches
#      the /id NAME predicate. A new file cannot contain scrollback → this is a genuine
#      YES/NO signal, not a pane-scrape heuristic.
#   4. Two attempts × 15s each = 30s worst-case budget. Second failure → LOUD log + return 1
#      so drive() bails (same shape as wait_for_claude).
#
# REPLACES the prior pane-scrape state-machine (7c54898), which false-positived on tmux
# scrollback: when a pane is reused across recycles it retains the prior session's /id NAME
# text, and the scrape check called it SUBMITTED without ever pasting. Three workstation
# agents landed at empty compose that way on 2026-08-29. A new file can't have scrollback.
submit_id() {
  local name="$1" sess="$2" cwd="$3"
  [ -n "$cwd" ] || { log "ERROR: '$name' submit_id: cwd argument missing — cannot resolve project dir"; return 1; }
  local sanitized project_dir
  sanitized=$(printf '%s' "$cwd" | sed 's|/|-|g')
  project_dir="$PROJECTS_DIR/$sanitized"
  mkdir -p "$project_dir" 2>/dev/null  # Claude Code creates it; ensure it exists so our ls doesn't error
  local before_snapshot
  before_snapshot=$(ls -1 "$project_dir"/*.jsonl 2>/dev/null | sort -u)
  local before_count
  before_count=$(printf '%s\n' "$before_snapshot" | grep -c '\.jsonl$' || true)
  log "'$name' submit_id: watching $project_dir (${before_count} existing jsonls before submit)"

  local attempt max=2
  for attempt in $(seq 1 $max); do
    log "'$name' submit_id attempt $attempt: C-c + load-buffer /id $name + paste-buffer + Enter"
    timeout -k 5 10 tmux send-keys -t "$sess" C-c 2>/dev/null
    sleep 0.5
    # 2026-09-02 Ink-mount race guard: if our C-c hit Ink mid-mount, claude exited. Self-correcting
    # fix — relaunch with an 8s extended settle, then retry this attempt. Bounded by the outer $max
    # attempts budget so we can't loop forever.
    if ! claude_running "$sess"; then
      log "'$name' submit_id attempt $attempt: claude DIED after our C-c (Ink was mid-mount) — relaunching with 8s extended settle"
      redrive_claude "$name" "$sess" ""
      if ! wait_for_claude "$sess" 8; then
        log "ERROR: '$name' submit_id: post-C-c-death relaunch failed — bailing"
        return 1
      fi
      sleep 8
      continue
    fi
    local _tmp
    _tmp=$(mktemp)
    printf '%s' "/id $name" > "$_tmp"
    timeout -k 5 10 tmux load-buffer -t "$sess" "$_tmp" 2>/dev/null
    timeout -k 5 10 tmux paste-buffer -p -t "$sess" 2>/dev/null
    rm -f "$_tmp"
    sleep 0.5
    timeout -k 5 10 tmux send-keys -t "$sess" Enter 2>/dev/null

    # Poll for a NEW jsonl appearing whose first user-turn matches /id NAME
    local deadline=$(($(date +%s) + 15))
    while [ $(date +%s) -lt "$deadline" ]; do
      sleep 0.5
      local now_snapshot new_files path
      now_snapshot=$(ls -1 "$project_dir"/*.jsonl 2>/dev/null | sort -u)
      new_files=$(comm -23 <(printf '%s\n' "$now_snapshot") <(printf '%s\n' "$before_snapshot") 2>/dev/null | grep -v '^$')
      for path in $new_files; do
        if _check_id_first_turn "$path" "$name"; then
          log "'$name' submit_id: /id landed in $(basename "$path") (attempt $attempt)"
          return 0
        fi
      done
    done
    log "'$name' submit_id attempt $attempt: 15s elapsed, no new jsonl with matching /id — will retry"
  done

  log "ERROR: '$name' submit_id: no new jsonl with /id $name after $max attempts × 15s — bailing, alive-check will retry next tick"
  log "  project dir: $project_dir"
  log "  pane tail: $(timeout -k 5 10 tmux capture-pane -pt "$sess" -S -10 2>/dev/null | tr '\n' '|' | tail -c 400)"
  return 1
}

# submit_resume_nudge: paste the re-arm-monitors nudge into a just-resumed pane and verify it
# actually landed as a user turn in the resumed session's jsonl. Mirrors submit_id's
# observable-outcome shape.
#
# The failure this closes (2026-09-02, Ashley on harper + fleet-wide): paste + Enter both return
# 0, but Claude Code's Ink UI is still mounting the compose input when the paste fires. Ink
# either drops the bytes (compose stays empty) or catches the text but not the Enter (compose
# has text sitting unsubmitted). The old code logged "sent nudge" regardless — a lie by
# omission that presented as either (a) empty compose after resume or (b) unsubmitted nudge.
# wait_for_claude only proves the claude process is on the pane's tty, not that Ink has mounted;
# there can be a multi-second gap. Retry-until-observable-outcome closes the gap without
# guessing at a settle time.
#
# Approach:
#   1. Resolve the resumed jsonl by <cwd>/<resume_id>.jsonl (same sanitizer as submit_id).
#   2. C-c + load-buffer + paste-buffer + Enter — same paste sequence as before.
#   3. Poll the jsonl for a user turn matching the nudge signature.
#   4. Three attempts × 10s each = 30s worst-case budget. Between attempts a C-c clears any
#      partial paste sitting unsubmitted in compose (otherwise the retry appends a second copy).
#   5. Final failure → LOUD log + return 1 so drive() knows not to mark the resume complete.
submit_resume_nudge() {
  local name="$1" sess="$2" cwd="$3" resume_id="$4"
  [ -n "$cwd" ] || { log "ERROR: '$name' submit_resume_nudge: cwd argument missing"; return 1; }
  [ -n "$resume_id" ] || { log "ERROR: '$name' submit_resume_nudge: resume_id argument missing"; return 1; }
  local sanitized project_dir jsonl
  sanitized=$(printf '%s' "$cwd" | sed 's|/|-|g')
  project_dir="$PROJECTS_DIR/$sanitized"
  jsonl="$project_dir/${resume_id}.jsonl"
  [ -f "$jsonl" ] || { log "ERROR: '$name' submit_resume_nudge: resumed jsonl not found at $jsonl"; return 1; }

  local nudge='Your session was just resumed by the agent-supervisor. Your background Monitors stopped with the previous session — start them again per the id skill.'

  local attempt max=3
  for attempt in $(seq 1 $max); do
    log "'$name' submit_resume_nudge attempt $attempt: C-c + load-buffer + paste-buffer + Enter"
    timeout -k 5 10 tmux send-keys -t "$sess" C-c 2>/dev/null
    sleep 0.5
    # 2026-09-02 Ink-mount race guard: same as submit_id — if C-c killed a still-mounting Ink,
    # relaunch with the resume_id and an 8s extended settle, then retry. Bounded by outer $max.
    if ! claude_running "$sess"; then
      log "'$name' submit_resume_nudge attempt $attempt: claude DIED after our C-c (Ink was mid-mount) — relaunching with 8s extended settle"
      redrive_claude "$name" "$sess" "$resume_id"
      if ! wait_for_claude "$sess" 8; then
        log "ERROR: '$name' submit_resume_nudge: post-C-c-death relaunch failed — bailing"
        return 1
      fi
      sleep 8
      continue
    fi
    local _tmp
    _tmp=$(mktemp)
    printf '%s' "$nudge" > "$_tmp"
    timeout -k 5 10 tmux load-buffer -t "$sess" "$_tmp" 2>/dev/null
    timeout -k 5 10 tmux paste-buffer -p -t "$sess" 2>/dev/null
    rm -f "$_tmp"
    sleep 0.5
    timeout -k 5 10 tmux send-keys -t "$sess" Enter 2>/dev/null

    local deadline=$(($(date +%s) + 10))
    while [ $(date +%s) -lt "$deadline" ]; do
      sleep 0.5
      if _check_resume_nudge_landed "$jsonl"; then
        log "'$name' submit_resume_nudge: nudge landed as user turn in $(basename "$jsonl") (attempt $attempt)"
        return 0
      fi
    done
    log "'$name' submit_resume_nudge attempt $attempt: 10s elapsed, no user turn with nudge signature — will retry"
  done

  log "ERROR: '$name' submit_resume_nudge: no user turn with nudge signature after $max attempts × 10s — bailing, resumed agent will be relay-deaf until manually revived"
  log "  jsonl: $jsonl"
  log "  pane tail: $(timeout -k 5 10 tmux capture-pane -pt "$sess" -S -10 2>/dev/null | tr '\n' '|' | tail -c 400)"
  return 1
}

# redrive_claude: clear whatever's in the pane's input buffer / at the shell prompt (C-c to abort
# any partial line, Enter to advance to a fresh prompt), then re-fire the launch command. Used
# once after wait_for_claude times out — deals with the typeahead-garbage failure mode by giving
# bash a fresh prompt to type the command into. The `resume` arg is optional; empty = fresh path.
redrive_claude() {
  local name="$1" sess="$2" resume="${3:-}"
  log "'$name' redrive: clearing pane (C-c + Enter) then re-firing claude launch"
  timeout -k 5 10 tmux send-keys -t "$sess" C-c 2>/dev/null
  sleep 0.3
  timeout -k 5 10 tmux send-keys -t "$sess" Enter 2>/dev/null
  sleep 0.5
  if [ -n "$resume" ]; then
    timeout -k 5 10 tmux send-keys -t "$sess" -l "$MEMORY_WRAPPER env $CLAUDE_LAUNCH_ENV $CLAUDE --resume $resume $CLAUDE_LAUNCH_FLAGS" 2>/dev/null
  else
    timeout -k 5 10 tmux send-keys -t "$sess" -l "$MEMORY_WRAPPER env $CLAUDE_LAUNCH_ENV $CLAUDE $CLAUDE_LAUNCH_FLAGS" 2>/dev/null
  fi
  timeout -k 5 10 tmux send-keys -t "$sess" Enter 2>/dev/null
}

# ---- session discovery: find an identity's most-recent OWN Claude Code session --------------
# A crash/reboot should bring an agent back WHERE IT WAS, mid-work — not fresh in $HOME. Claude
# Code stores each session at $HOME/.claude/projects/<mangled-cwd>/<sessionId>.jsonl and records
# the `/id <name>` LOAD command that started it. A session BELONGS to identity X if its first real
# `/id` load names X — prose mentions of a name do NOT carry the <command-name> tag, so they can't
# misattribute (this distinction is the whole trick: a naive grep-for-name picks the wrong, newer
# file). We take the newest session X owns and resume it in the cwd that session recorded. Match on
# the identity name case-insensitively (mirrors match_session), so 'Hilda'/'hilda' never diverge.
PROJECTS_DIR="${AGENT_PROJECTS_DIR:-$HOME/.claude/projects}"
_lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
# identity a session belongs to = args of its first real /id load (ignore save/reset/blank).
# grep -m5 early-exits near the top of the file, so this stays fast even on huge session logs.
session_owner() {
  grep -F -m5 '<command-name>/id</command-name>' "$1" 2>/dev/null \
    | grep -oE '<command-args>[^<]*</command-args>' \
    | sed -E 's/<command-args>([^<]*)<\/command-args>/\1/' \
    | grep -vixE 'save|reset' | grep -v '^[[:space:]]*$' | head -1
}
session_cwd() { grep -m1 -o '"cwd":"[^"]*"' "$1" 2>/dev/null | sed 's/"cwd":"//;s/"$//'; }
# prints "<cwd>\t<sessionId>" for the newest session OWNED by $1; returns 1 if the identity has none.
resolve_session() {
  local name="$1" want best="" bestt=0 f o t
  want="$(_lower "$name")"
  for f in "$PROJECTS_DIR"/*/*.jsonl; do
    [ -f "$f" ] || continue
    o="$(session_owner "$f")"; [ -n "$o" ] || continue
    [ "$(_lower "$o")" = "$want" ] || continue
    t="$(stat -c %Y "$f" 2>/dev/null)" || continue
    [ "$t" -gt "$bestt" ] && { bestt="$t"; best="$f"; }
  done
  [ -n "$best" ] || return 1
  printf '%s\t%s\n' "$(session_cwd "$best")" "$(basename "$best" .jsonl)"
}

# drive claude into an EXISTING session ($2), for identity $1. If $3 (a sessionId) is given, RESUME
# that conversation — it restores the agent's working context AND it's already the right identity,
# so NO /id is sent. Otherwise start fresh and send `/id <name>`. The caller launches the session in
# the correct working directory, which is what lets --resume find the session (Claude scopes
# sessions per directory). Blind-drive past the trust dialog either way (harmless at an idle prompt).
drive() {
  local name="$1" sess="$2" resume="${3:-}" cwd="${4:-}"
  # Fallback: if cwd wasn't passed (older call sites), query it from the pane. submit_id needs it
  # to compute PROJECTS_DIR/<sanitized-cwd>/ for jsonl detection; empty cwd = jsonl watch fails safe.
  if [ -z "$cwd" ]; then
    cwd=$(timeout -k 5 5 tmux display-message -p -t "$sess" '#{pane_current_path}' 2>/dev/null)
    [ -z "$cwd" ] && cwd="$HOME"
  fi
  # supervisor is about to touch this pane — clear the "hands off" marker for any consumer polling
  # it (e.g. Skynet's DormancyOverlay). Refresh happens at each terminal branch below.
  rm -f "$IDENTITIES_DIR/$name/.resume-complete" 2>/dev/null
  if [ -n "$resume" ]; then
    # RESUME path. The working dir is already trusted (this identity ran here before), so there's no
    # folder-trust dialog to clear — hence NO Enter blind-drive and NO /id (the identity is already
    # in the restored context). CLAUDE_LAUNCH_ENV pins CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=99 which stops
    # the known resume-auto-compact bug (GH #56271 / #64923) at source, so the historical Ctrl-C
    # train that fought it post-hoc is gone — ~9s wall-time savings per wake.
    # bash command-scoped assignment — vars apply to this claude only, not the shell.
    timeout -k 5 10 tmux send-keys -t "$sess" -l "$MEMORY_WRAPPER env $CLAUDE_LAUNCH_ENV $CLAUDE --resume $resume $CLAUDE_LAUNCH_FLAGS" 2>/dev/null
    timeout -k 5 10 tmux send-keys -t "$sess" Enter 2>/dev/null
    # ⚠️ VERIFY CLAUDE ACTUALLY LAUNCHED (2026-08-29, Ashley witnessed a live failure on workstation).
    # send-keys drops bytes into the pane and returns 0 whether or not they became a viable command.
    # A terminal Device Attributes response echoing at the shell prompt as literal `1;2c0;276;0c`
    # got prefixed onto the env-claude line; bash parsed with `;` as command separators, `0c` became
    # the command name, claude never launched, then the compaction-cancel + prompt scrape below all
    # ran against a bare bash prompt, and the re-arm-monitors nudge was dropped into bash. Fix:
    # check the pane's tty for the claude/node process (reuses claude_running()) — if it's not there
    # within ~8s, ONCE clear the pane and re-drive, then re-verify. Second failure = log LOUD and
    # SKIP everything below (no compaction cancel, no prompt scrape, no nudge — leave the pane alone
    # for a human to see the mess). Alive-check on the next supervisor tick will flag the identity
    # dead and try again.
    if ! wait_for_claude "$sess" 8; then
      log "WARNING: '$name' claude did NOT launch after resume drive — attempting one retry with typeahead clear"
      log "  pane tail: $(timeout -k 5 10 tmux capture-pane -pt "$sess" -S -10 2>/dev/null | tr '\n' '|' | tail -c 400)"
      redrive_claude "$name" "$sess" "$resume"
      if ! wait_for_claude "$sess" 8; then
        log "ERROR: '$name' claude STILL did not launch after retry — bailing out of drive() to avoid dropping nudge into a broken pane. Session '$sess' left as-is for inspection. Alive-check will re-attempt on next tick."
        log "  pane tail: $(timeout -k 5 10 tmux capture-pane -pt "$sess" -S -10 2>/dev/null | tr '\n' '|' | tail -c 400)"
        return 1
      fi
      log "'$name' claude launched on retry"
    fi
    # PROMPT-SCRAPE removed 2026-09-01 (was ~15s wait+scrape+answer for two prompts).
    # Both prompts are killed at source and have been reliably suppressed since:
    #   - trust-folder: hasTrustDialogAccepted=true in ~/.claude.json (accept_trust_for_workdir()
    #     is called before every launch) + --dangerously-skip-permissions
    #   - resume-summary: CLAUDE_CODE_RESUME_THRESHOLD_MINUTES + CLAUDE_CODE_RESUME_TOKEN_THRESHOLD
    #     both pinned to 99999999 in CLAUDE_LAUNCH_ENV
    # The 15s scrape loop was pure "in case a future release renames those keys" paranoia and ran
    # empty on every wake. Ctrl-C train (which came after) was already dropped by the same commit
    # for the same reason: CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=99 kills the auto-compact bug at source.
    # SAFETY NET: the post-drive scrape below still fires as an observable-outcome check — if a
    # regression puts one of those prompts back on screen, we WARN in the log so a stuck agent is
    # findable rather than silently relay-deaf. (Agent will hang until we notice + re-enable the
    # answer path — accepted tradeoff for ~15s of wake wall-time savings.)
    sleep 1                                      # brief settle so claude's Ink renders past the initial paint before the observable-outcome scrape
    pane="$(timeout -k 5 10 tmux capture-pane -pt "$sess" -S -40 2>/dev/null)"
    case "$pane" in
      *"Resume from summary"*|*"Resume full session"*|*"Yes, I trust this folder"*|*"Enter to confirm"*)
        log "WARNING: '$name' still sitting at an interactive prompt after resume — NOT at a REPL, will be relay-deaf until cleared. Prompt source-suppression (env vars + hasTrustDialogAccepted) may have regressed; restore the scrape+answer loop if this fires more than once (session '$sess')";;
      *)
        # RE-ARM THE ON-WAKE MONITORS (2026-07-22, Ashley's call). A resume restores the
        # conversation but NOT the previous session's background Monitors — they died with the old
        # session, so a resumed agent comes back alive-but-DEAF. There's nothing to restore
        # mechanically; the agent just has to relaunch them. So once we're past the prompt and at a
        # REPL, tell it that in one line and let it do its own /id-documented startup.
        #
        # ⚠️ Delivery goes through submit_resume_nudge() (not a bare load-buffer+paste-buffer+Enter)
        # because the fire-and-forget paste is not enough — wait_for_claude only proves the claude
        # process is on the tty, but Ink can still be mid-render when the paste fires and drops
        # bytes (empty compose) or catches the text without the Enter (unsubmitted). See the
        # submit_resume_nudge header for the full failure story (2026-09-02, Ashley). The nudge
        # text lives inside submit_resume_nudge alongside its verify predicate — keep them together.
        if submit_resume_nudge "$name" "$sess" "$cwd" "$resume"; then
          # supervisor's hands are OFF this pane — drop the marker with a UTC timestamp inside so
          # consumers (Skynet DormancyOverlay) can distinguish this-wake from a stale prior-wake
          # marker via freshness check (marker_ts > wake_trigger_ts).
          date -u +%Y-%m-%dT%H:%M:%SZ > "$IDENTITIES_DIR/$name/.resume-complete"
        fi
        # else: submit_resume_nudge already logged ERROR + pane tail. Leave .resume-complete
        # absent so the alive-check on the next tick sees a resumed-but-not-completed session
        # and knows this identity is still stuck. Same shape as submit_id's failure path.
        ;;
    esac
    return 0
  fi
  # FRESH path: blind-drive past the folder-trust dialog with Enter (overshoot is harmless at an empty
  # prompt) — the claude-spawn-job pattern, version/timing-agnostic — then load the identity.
  # Env-var prefix is harmless on a fresh launch (there's no session to summarize) but cheap insurance
  # if a fresh claude ever picks up an older recorded session unexpectedly.
  log "'$name' drive fresh: typing claude launch command into pane '$sess'"
  timeout -k 5 10 tmux send-keys -t "$sess" -l "$MEMORY_WRAPPER env $CLAUDE_LAUNCH_ENV $CLAUDE $CLAUDE_LAUNCH_FLAGS" 2>/dev/null
  timeout -k 5 10 tmux send-keys -t "$sess" Enter 2>/dev/null
  # ⚠️ VERIFY CLAUDE ACTUALLY LAUNCHED — same failure mode as the resume path above (see the block
  # in the `if [ -n "$resume" ]` branch for the full story). On second failure, bail without pasting
  # /id into what's likely a bare bash prompt.
  if ! wait_for_claude "$sess" 8; then
    log "WARNING: '$name' claude did NOT launch after fresh drive — attempting one retry with typeahead clear"
    log "  pane tail: $(timeout -k 5 10 tmux capture-pane -pt "$sess" -S -10 2>/dev/null | tr '\n' '|' | tail -c 400)"
    redrive_claude "$name" "$sess" ""
    if ! wait_for_claude "$sess" 8; then
      log "ERROR: '$name' claude STILL did not launch after fresh retry — bailing out of drive() to avoid pasting /id into a broken pane. Session '$sess' left as-is for inspection. Alive-check will re-attempt on next tick."
      log "  pane tail: $(timeout -k 5 10 tmux capture-pane -pt "$sess" -S -10 2>/dev/null | tr '\n' '|' | tail -c 400)"
      return 1
    fi
    log "'$name' claude launched on retry"
  fi
  sleep 2
  local budget="${SETTLE_SECONDS:-6}" spent=0
  while [ "$spent" -lt "$budget" ]; do
    timeout -k 5 10 tmux send-keys -t "$sess" Enter 2>/dev/null
    sleep 3; spent=$((spent+3))
  done
  # ⚠️ VERIFY CLAUDE SURVIVED THE SETTLE LOOP before pasting /id — root cause TBD but this class
  # of failure has been observed live (2026-09-02, tanya on t1000): wait_for_claude passed cleanly
  # above, then between the settle loop's blind Enters and submit_id firing, the fresh claude
  # ended up dead — pane back at bash prompt. Old behavior: submit_id's leading C-c + paste of
  # `/id name` landed IN BASH, producing `-bash: /id: No such file or directory` visible in the
  # pane, no jsonl written, submit_id looped its full 2× 15s budget with no signal. Silent from
  # the log's POV (submit_id error is generic; the actual "claude died between settle and submit"
  # is invisible without this check). Fix: a second wait_for_claude here catches that gap and
  # bails LOUD, so alive-check can retry cleanly on the next tick + we have logs to root-cause
  # next occurrence.
  if ! claude_running "$sess"; then
    log "ERROR: '$name' drive fresh: claude DIED between wait_for_claude and submit_id (during settle loop / blind Enters) — bailing before pasting /id into bash. Alive-check will re-attempt on next tick."
    log "  pane tail: $(timeout -k 5 10 tmux capture-pane -pt "$sess" -S -20 2>/dev/null | tr '\n' '|' | tail -c 600)"
    return 1
  fi
  # SUBMIT /id via submit_id() helper — handles the leading-newline race (2026-08-21 taylor bug +
  # 2026-08-29 Ashley report) + never-landed-paste + submission verification with a state-machine
  # recovery loop (up to 3 attempts). See submit_id() near the top of this file for the full state
  # machine. On final failure, submit_id returns 1 and we bail from drive() (same shape as
  # wait_for_claude) rather than leaving a broken /id-in-compose pane pretending to be alive.
  if ! submit_id "$name" "$sess" "$cwd"; then
    log "ERROR: '$name' drive fresh: submit_id failed — bailing from drive(). Alive-check will re-attempt on next tick."
    return 1
  fi
  # supervisor's hands are OFF this pane — same marker as the resume path above.
  date -u +%Y-%m-%dT%H:%M:%SZ > "$IDENTITIES_DIR/$name/.resume-complete"
}

# RECYCLE: an EXPLICIT, agent-requested clean restart (distinct from the never-kill rule, which
# guards against a transient MISREAD spuriously nuking a live agent). The agent itself dropped
# `<identity>/.recycle-requested` after `/id save` because its context window is filling — a
# deliberate "please reload me fresh." So here we DO terminate the running claude (graceful /exit,
# then hard-kill any survivor on the pane tty) and re-drive a fresh `claude + /id`, giving a clean
# identity+memos reload with zero compaction drift. The relay cursor (SINCE_FILE) means the fresh
# session catches any messages from the restart gap.
recycle() {
  local name="$1" sess="$2"
  log "recycling '$name' (session '$sess') — clean fresh /id load"
  # graceful: ask the claude REPL to exit (it's idle at the prompt post-save)
  # ⚠️ Bracketed paste + separate Enter after settle (see the resume-nudge site for why).
  _ex_tmp=$(mktemp)
  printf '%s' "/exit" > "$_ex_tmp"
  timeout -k 5 10 tmux load-buffer -t "$sess" "$_ex_tmp" 2>/dev/null
  timeout -k 5 10 tmux paste-buffer -p -t "$sess" 2>/dev/null
  rm -f "$_ex_tmp"
  sleep 0.5
  timeout -k 5 10 tmux send-keys -t "$sess" Enter 2>/dev/null
  log "'$name' recycle: /exit paste + Enter sent to pane"
  sleep 3
  # hard fallback: kill any claude/node still on the pane tty so we're back at a shell
  local tty pid killed=0; tty="$(timeout -k 5 10 tmux list-panes -t "=$sess" -F '#{pane_tty}' 2>/dev/null | head -1)"
  if [ -n "$tty" ]; then
    for pid in $(ps -t "${tty#/dev/}" -o pid=,comm= 2>/dev/null | grep -iE 'claude|node' | awk '{print $1}'); do
      kill "$pid" 2>/dev/null
      killed=$((killed+1))
    done
  fi
  if [ "$killed" -gt 0 ]; then
    log "'$name' recycle: hard-kill SIGTERM'd $killed survivor(s) on tty ${tty:-?} — a wedged claude may not respond to SIGTERM"
  else
    log "'$name' recycle: no survivors after /exit — pane at shell"
  fi
  sleep 2
  # Observe pane state BEFORE drive() — if claude/node is still there, drive() will type its
  # launch command into a non-empty REPL and fresh /id will fail (text absorbed as input, not
  # spawned as a shell command). This is Taylor's 2026-08-21 failure signature.
  local _pane_state="shell"
  if [ -n "$tty" ] && ps -t "${tty#/dev/}" -o comm= 2>/dev/null | grep -qiE 'claude|node'; then
    _pane_state="claude-still-present"
    log "WARNING: '$name' recycle: pane STILL has claude/node after /exit + SIGTERM — drive() about to race a still-alive predecessor (session '$sess')"
  fi
  # source-of-truth trust for the recycled session's workdir (already trusted by earlier launch()
  # in practice, but cheap idempotent belt-and-suspenders for a workdir that was manually cd'd)
  local _rc_wd; _rc_wd="$(timeout -k 5 10 tmux display -pt "$sess" -F '#{pane_current_path}' 2>/dev/null)"
  accept_trust_for_workdir "$_rc_wd"
  log "'$name' recycle: calling drive() (pane_state=$_pane_state, cwd=$_rc_wd)"
  drive "$name" "$sess" "" "$_rc_wd"        # fresh claude + /id into the same (now shell) session; cwd → jsonl watch
  log "'$name' recycle: drive() returned"
  LAST_RECYCLE_AT["$name"]="$(date +%s)"    # log-only: enrich later DEAD/RESUME lines to catch undone recycles
  # Schedule cleanup of .recycled-at ~8s from now — counted from AFTER drive() returned,
  # so Skynet has a visible "recycling" window post-launch (its polling picks up the
  # sentinel; the delay guarantees at least a few polling cycles observe it). Fire-and-forget
  # backgrounded subshell + disown so the reconcile loop doesn't block on the sleep.
  ( sleep 8; rm -f "$IDENTITIES_DIR/$name/.recycled-at" 2>/dev/null && log "'$name' sentinel: .recycled-at cleaned up (+8s post-drive)" ) & disown
  log "'$name' recycle sequence complete — drive() returned; fresh /id landing verifies on next reconcile"
}

# bring identity $1 up in session $3 (mode $2 = fresh|recover). Fresh: $3 is the slug and the
# session is created; recover: $3 is the existing (matched) session name.
launch() {
  local name="$1" mode="$2" sess="$3" created=0
  if [ "${DRY_RUN:-0}" = 1 ]; then log "DRY_RUN would $mode '$name' (tmux session '$sess')"; return 0; fi
  # Discover this identity's real working dir + latest session, so we resume in the RIGHT place
  # rather than fresh in $HOME. For a truly-first-ever launch (no prior session), use $HOME/<name>
  # by convention if the coord (or a human) has created it — otherwise fall to $HOME.
  # Convention-not-string: both coord and supervisor derive the path from $name; nothing is parsed
  # from a config file. If ~/<name> doesn't exist, the supervisor silently falls back — the coord
  # is supposed to catch the mkdir failure BEFORE dispatch (see coordinator-instructions § step 6),
  # so a $HOME fallback here indicates something went wrong at spawn time.
  local cwd="$HOME" resume="" disc
  if disc="$(resolve_session "$name")"; then
    cwd="${disc%%$'\t'*}"; resume="${disc#*$'\t'}"
    log "'$name' launch: resolve_session picked token=${resume:0:8} cwd='$cwd'"
    if [ ! -d "$cwd" ]; then log "'$name' recorded workdir '$cwd' missing — fresh /id in \$HOME"; cwd="$HOME"; resume=""; fi
  elif [ -d "$HOME/$name" ]; then
    cwd="$HOME/$name"
    log "'$name' launch: resolve_session found no prior session — using convention workdir '$cwd'"
  else
    log "'$name' launch: resolve_session found no prior session AND \$HOME/$name absent — fresh /id in \$HOME"
  fi
  # An explicit recycle request means "reload me CLEAN" — keep the workdir, drop the resume. (Set by
  # the sentinel branch when the session was already gone; consumed here so it can't leak.)
  if [ "${FORCE_FRESH:-0}" = 1 ]; then resume=""; FORCE_FRESH=0; log "'$name' forced fresh /id (recycle requested)"; fi
  # GATE: if the resume target's mtime PRE-DATES a recent recycle for this identity, resuming
  # would silently undo that recycle. Failure this closes (2026-09-01, tanya on t1000): recycle
  # sequence "completes" but the fresh post-recycle claude never actually landed (drive() returned
  # with error, recycle() didn't check the return status), so LAST_RECYCLE_AT is set with no new
  # post-recycle session written. Two minutes later alive-check finds claude-dead, recovery runs
  # resolve_session, which picks the only session available (the pre-recycle one) → resume undoes
  # the recycle. This class of failure was previously log-only ("PRE-DATES recycle at …"); Tanya
  # flagged it and proposed the promotion. Now: refuse resume, force fresh — same downstream path
  # as FORCE_FRESH above.
  if [ -n "$resume" ] && [ -n "${LAST_RECYCLE_AT[$name]:-}" ]; then
    local _rec="${LAST_RECYCLE_AT[$name]}"
    local _f
    for _f in "$PROJECTS_DIR"/*/"$resume".jsonl; do
      [ -f "$_f" ] || continue
      local _mtime; _mtime="$(stat -c %Y "$_f" 2>/dev/null)"
      if [ -n "$_mtime" ] && [ "$_mtime" -lt "$_rec" ]; then
        log "GATE: '$name' resume target ${resume:0:8} mtime $(date -d "@$_mtime" '+%H:%M:%S') PRE-DATES recycle at $(date -d "@$_rec" '+%H:%M:%S') — refusing resume, forcing fresh /id"
        resume=""
      fi
      break
    done
  fi
  if ! timeout -k 5 10 tmux has-session -t "=$sess" 2>/dev/null; then
    timeout -k 5 10 tmux new-session -d -s "$sess" -c "$cwd"     # empty SHELL session in the identity's workdir
    created=1
  elif [ -n "$resume" ]; then
    # recover-in-place (claude died, shell survived): put the existing shell in the right dir first
    timeout -k 5 10 tmux send-keys -t "$sess" -l "cd \"$cwd\"" 2>/dev/null; timeout -k 5 10 tmux send-keys -t "$sess" Enter 2>/dev/null
  fi
  # A freshly-created login shell needs a moment to source its profile and be ready for input, or
  # the typed launch command is lost to a race. (A recover targets an already-idle shell — no wait.)
  [ "$created" = 1 ] && sleep 3
  if [ -n "$resume" ]; then
    log "${mode}ing '$name' (session '$sess') — RESUME ${resume:0:8} in $cwd"
  else log "${mode}ing '$name' (session '$sess') — fresh /id in $cwd"; fi
  accept_trust_for_workdir "$cwd"                 # source-of-truth: kill the folder-trust prompt
  drive "$name" "$sess" "$resume" "$cwd"
  # Path B recycle-cleanup: if this launch was triggered by a recycle-request whose session was
  # already gone (FORCE_FRESH path), the .recycled-at sentinel is still there. Same delayed
  # cleanup as recycle() Path A. Guarded so normal fresh/recover launches (no recycle involved)
  # don't touch the sentinel — those wouldn't have one anyway.
  if [ -f "$IDENTITIES_DIR/$name/.recycled-at" ]; then
    ( sleep 8; rm -f "$IDENTITIES_DIR/$name/.recycled-at" 2>/dev/null && log "'$name' sentinel: .recycled-at cleaned up (+8s post-launch, FORCE_FRESH path)" ) & disown
  fi
  log "'$name' ${mode} done"
}

# =============================================================================================
# DORMANCY (2026-08-07) — kill idle claude, wake on Matrix DM / scheduled fire / sentinel-delete
# =============================================================================================
# Gated by $DORMANCY (default "off"). OFF = no behavior change vs. pre-2026-08-07 supervisor.
# Design: bounty session-dormancy-pilot-beelink. Pilot target: beelink (bella + alpha + beta),
# IDLE_THRESHOLD_MINUTES=10 for iteration speed; prod default 120.
#
# Wake paths (all in-supervisor):
#   1. matrix_peek — supervisor does its OWN /sync per dormant identity, distinct device from the
#      identity's receiver (which is dead-with-session). New event → wake.
#   2. schedule_peek — supervisor reads $HOME/.claude/identities/<name>/wakeups/*.json, computes
#      next fire, wakes when due. Identity's own scheduler picks up on resume.
#   3. sentinel-delete — external actor (Skynet, hand) rm's .dormant → sentinel-check below fails
#      → falls through to existing alive-check → claude is dead → recover path relaunches.
#      FREE — no code, natural fallout of the sentinel check.

# sample_memory (2026-08-08) — append one JSON line to $MEM_SAMPLES_LOG per reconcile cycle
# so the dormancy dashboard can plot memory over time alongside kill/wake events. Same schema
# as `free -k` MemTotal/Used/Free/Available. Called at the TOP of reconcile so we get a
# sample once per CHECK_INTERVAL (30s default).
sample_memory() {
  local ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local line
  line=$(free -k | awk -v ts="$ts" '/^Mem:/ {
    printf "{\"ts\":\"%s\",\"mem_total_kb\":%d,\"mem_used_kb\":%d,\"mem_free_kb\":%d,\"mem_available_kb\":%d}\n", ts, $2, $3, $4, $7
  }')
  [ -n "$line" ] && printf '%s\n' "$line" >> "$MEM_SAMPLES_LOG"
}

metric() {
  # metric event=<kind> k=v k=v ...  → append one JSON line to $METRICS_LOG
  local ts kv v k
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  kv="\"ts\":\"$ts\""
  while [ $# -gt 0 ]; do
    k="${1%%=*}"; v="${1#*=}"
    case "$v" in
      ''|*[!0-9-]*) kv="$kv,\"$k\":$(printf '%s' "$v" | jq -Rs .)" ;;
      *)            kv="$kv,\"$k\":$v" ;;
    esac
    shift
  done
  printf '{%s}\n' "$kv" >> "$METRICS_LOG"
}

# find the most-recent .jsonl transcript owned by this identity (uses existing session_owner helper).
# Returns full path via stdout, empty if none.
_newest_jsonl_for() {
  local name="$1" f owner m best="" best_m=0 sub_dir sf
  for f in "$PROJECTS_DIR"/*/*.jsonl; do
    [ -f "$f" ] || continue
    owner="$(session_owner "$f")"
    [ "$(_lower "$owner")" = "$(_lower "$name")" ] || continue
    m=$(stat -c %Y "$f" 2>/dev/null || echo 0)
    [ "$m" -gt "$best_m" ] && { best_m=$m; best=$f; }
    # Also consider subagent transcripts under <parent-uuid>/subagents/ — a foregrounded
    # Agent tool call writes there, and without this the parent's mtime looks stale while
    # a subagent is actively working, so idle_check whiffs and the supervisor kills mid-run.
    # (2026-08-10 fix, Tanya-reported: Tiffany killed 0.4s after subagent's last write during
    # a valid gsd-executor run.)
    sub_dir="${f%.jsonl}/subagents"
    if [ -d "$sub_dir" ]; then
      for sf in "$sub_dir"/*.jsonl; do
        [ -f "$sf" ] || continue
        m=$(stat -c %Y "$sf" 2>/dev/null || echo 0)
        [ "$m" -gt "$best_m" ] && { best_m=$m; best=$sf; }
      done
    fi
  done
  printf '%s' "$best"
}

# idle_check: two conditions REQUIRED, either alone insufficient.
#  (a) claude code footer shows zero shells AND zero background agents (NOT Monitor count; those
#      are distinct counters). If a non-zero shell/background count appears in the last 10 lines,
#      not idle. Unparseable pane → not idle (safe default).
#  (b) transcript .jsonl mtime > IDLE_THRESHOLD_MINUTES.
# Returns 0 = idle, non-zero = not idle.
idle_check() {
  local name="$1" sess="$2"
  local pane; pane="$(timeout -k 5 10 tmux capture-pane -pt "$sess" -S -20 2>/dev/null | tail -10)" || return 1
  # match ANY non-zero "N shells" or "N background" phrase → not idle
  printf '%s' "$pane" | grep -qE '([1-9][0-9]* shell|[1-9][0-9]* background)' && return 1
  local newest; newest="$(_newest_jsonl_for "$name")"
  [ -n "$newest" ] || return 1
  local now m idle_s threshold_s
  now=$(date +%s)
  m=$(stat -c %Y "$newest" 2>/dev/null || echo 0)
  idle_s=$((now - m))
  threshold_s=$((IDLE_THRESHOLD_MINUTES * 60))
  [ "$idle_s" -ge "$threshold_s" ]
}

# pending_check: right before killing, is anything imminent that would wake immediately?
# Returns 0 = clear to kill, non-zero = something pending.
pending_check() {
  local name="$1"
  matrix_peek "$name" && return 1
  schedule_peek "$name" && return 1
  return 0
}

# matrix_peek: returns 0 if THIS identity has new events since it went dormant.
# REUSES the identity's own recv.sh token + since cursor (from ~/.claude/identities/<name>/
# relay-state/{token,since}). Why: the receiver's cursor was captured at time-of-dormancy, so
# /sync?since=<that> returns EXACTLY the events that arrived while dormant — no need for a
# separate supervisor-owned device, no fresh-login/first-seed issues (which caused the earlier
# design to be blind to invites arriving before its own first sync). Since the receiver died
# with the CC session, there's no concurrent user of the token. Supervisor does NOT write back
# to since — receiver picks up from the same cursor on wake and backfills naturally.
#
# On 401 (token expired/revoked), fall back to fresh login using relay.json password + save the
# NEW token back to relay-state/token (matches recv.sh's own 401 behavior — that path is proven).
matrix_peek() {
  local name="$1"
  local rj="$HOME/.claude/identities/$name/relay.json"
  local rs="$HOME/.claude/identities/$name/relay-state"
  [ -f "$rj" ] || return 1
  [ -d "$rs" ] || return 1
  local base mxid self tok since
  base=$(jq -r '.base' "$rj")
  mxid=$(jq -r '.user_id' "$rj")
  self="$mxid"                              # for sender != self comparison, keep full mxid
  tok=$(cat "$rs/token" 2>/dev/null)
  since=$(cat "$rs/since" 2>/dev/null)
  # Missing state is only expected on a brand-new identity whose receiver never ran; safe default
  # is "no wake" (receiver will seed on first wake anyway).
  [ -n "$tok" ] && [ -n "$since" ] || { metric event=matrix-peek identity="$name" result=no-state; return 1; }
  local resp; resp=$(curl -sS --max-time 15 -H "Authorization: Bearer $tok" \
    "$base/sync?timeout=0&since=$since" 2>/dev/null)
  # 401 → re-login with password, save new token back to receiver's location so the receiver
  # inherits the fresh token on wake (mirrors recv.sh's own re-login pattern).
  if echo "$resp" | jq -e '.errcode == "M_UNKNOWN_TOKEN"' >/dev/null 2>&1; then
    local pass user lr new_tok
    pass=$(jq -r '.password' "$rj")
    user="${mxid#@}"; user="${user%%:*}"
    lr=$(curl -sS --max-time 10 -X POST -H 'Content-Type: application/json' \
      -d "$(jq -nc --arg u "$user" --arg p "$pass" \
        '{type:"m.login.password",identifier:{type:"m.id.user",user:$u},password:$p}')" \
      "$base/login" 2>/dev/null)
    new_tok=$(echo "$lr" | jq -r '.access_token // empty')
    if [ -n "$new_tok" ]; then
      printf '%s' "$new_tok" > "$rs/token"
      metric event=matrix-peek identity="$name" result=token-refreshed
    else
      metric event=matrix-peek identity="$name" result=relogin-fail
    fi
    return 1                                # skip this cycle; next cycle uses fresh token
  fi
  # Count wake signals:
  # (a) new timeline events in JOINED rooms from senders != self (peer messaging me)
  # (b) pending INVITES (someone created a fresh DM room to reach me while dormant)
  # Either counts. On resume, my own receiver auto-joins invites + backfills the message.
  local ec ic
  ec=$(echo "$resp" | jq --arg self "$self" \
    '[.rooms.join // {} | to_entries[] | .value.timeline.events[]? | select(.sender != $self)] | length' 2>/dev/null)
  ic=$(echo "$resp" | jq '[.rooms.invite // {} | keys[]] | length' 2>/dev/null)
  if [ "${ec:-0}" -gt 0 ] || [ "${ic:-0}" -gt 0 ]; then
    metric event=matrix-peek identity="$name" result=wake events="${ec:-0}" invites="${ic:-0}"
    return 0
  fi
  metric event=matrix-peek identity="$name" result=quiet
  return 1
}

# schedule_peek: returns 0 if any of the identity's wakeup specs fire within FALSE_KILL_MINUTES.
# Uses python to mirror wakeup-scheduler.py's next-fire computation. Handles all four schedule
# types (interval, daily, weekly, one_shot) — 2026-08-11 extension after poppy missed a one_shot
# because the earlier pilot only wired interval and stubbed the others to "never pending."
schedule_peek() {
  local name="$1"
  local wd="$HOME/.claude/identities/$name/wakeups"
  [ -d "$wd" ] || return 1
  # NOTE: wakeup-scheduler.py writes time.time() (a FLOAT) into .state/<slug>.last, not an int.
  # int(open(..).read()) fails on '1786106092.3482552' → silent-fail-swallowed = no wake ever
  # (bug: 2026-08-07 pilot, 4 hours of missed schedule wakes). Use float(...) to be robust.
  # Any exception is LOGGED (via metric) not silently swallowed — exceptions here are real bugs.
  local py_out
  py_out=$(python3 - "$wd" "$FALSE_KILL_MINUTES" <<'PY' 2>&1
import json, os, sys, time, glob
from datetime import datetime, timedelta
try:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
except ImportError:
    ZoneInfo = None
    ZoneInfoNotFoundError = Exception

wakedir, window_min = sys.argv[1], int(sys.argv[2])
now = time.time()
soon = now + window_min * 60
state_dir = os.path.join(wakedir, '.state')

_DOW = {"mon":0,"tue":1,"wed":2,"thu":3,"fri":4,"sat":5,"sun":6}

def _zone(spec):
    tz = spec.get('schedule', {}).get('timezone')
    if not tz or ZoneInfo is None:
        return None, None
    try:
        return ZoneInfo(str(tz)), None
    except (ZoneInfoNotFoundError, ValueError) as e:
        return None, f"tz-bad: {e}"

def _dur_secs(s):
    s = str(s).strip().lower()
    unit = s[-1]
    mult = {"s":1,"m":60,"h":3600,"d":86400}.get(unit)
    if mult is None: return int(s) * 60      # bare number = minutes
    return int(s[:-1]) * mult

def _days_ok(days, dt):
    if not days: return True
    day3 = ["mon","tue","wed","thu","fri","sat","sun"][dt.weekday()]
    return day3 in [str(d).lower()[:3] for d in days]

def _slot_at(ref, hhmm):
    h, m = (int(x) for x in hhmm.split(":"))
    return ref.replace(hour=h, minute=m, second=0, microsecond=0)

def _parse_at_ts(at_str, zi):
    if not isinstance(at_str, str) or not at_str: return None, "at-empty"
    s = at_str.strip()
    norm = s[:-1] + "+00:00" if s.endswith("Z") else s
    try: dt = datetime.fromisoformat(norm)
    except ValueError as e: return None, f"at-parse: {e}"
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=zi) if zi else dt.astimezone()
    return dt.timestamp(), None

def _next_slot_wall(sch, now_dt, days, span_days):
    """Next daily/weekly slot at or after now_dt that passes the days filter.
    span_days=8 for daily (covers a full week + wrap), span_days=15 for weekly."""
    at = sch['at']
    target = _DOW[str(sch['day']).lower()[:3]] if 'day' in sch else None
    for off in range(span_days):
        cand = now_dt + timedelta(days=off)
        if target is not None and cand.weekday() != target: continue
        cand = _slot_at(cand, at)
        if not _days_ok(days, cand): continue
        if cand.timestamp() > now: return cand.timestamp()
    return None

def _read_last(spec_path):
    p = os.path.join(state_dir, os.path.basename(spec_path).replace('.json','.last'))
    if not os.path.exists(p): return None
    try: return float(open(p).read().strip())
    except Exception: return None

for spec_path in glob.glob(os.path.join(wakedir, '*.json')):
    try:
        with open(spec_path) as f: spec = json.load(f)
        if not spec.get('enabled', True): continue
        sch = spec.get('schedule', {})
        t = sch.get('type')
        if t not in ('interval','daily','weekly','one_shot'): continue
        zi, tz_err = _zone(spec)
        if tz_err: continue  # scheduler will LOUD-alert; we just don't wake for it
        if t == 'interval': zi = None    # tz-on-interval is a no-op per scheduler
        now_dt = datetime.fromtimestamp(now, tz=zi) if zi else datetime.fromtimestamp(now)
        days = sch.get('days')

        next_fire = None
        if t == 'interval':
            last = _read_last(spec_path)
            if last is None or last == 0: continue   # first-sight: scheduler anchors, no wake
            next_fire = last + _dur_secs(sch.get('every','30m'))
            # If days filter excludes next_fire's day, skip (scheduler won't fire then either).
            if days and not _days_ok(days, datetime.fromtimestamp(next_fire)):
                continue
        elif t == 'daily':
            last = _read_last(spec_path)
            if last is None or last == 0: continue
            slot_today = _slot_at(now_dt, sch['at']).timestamp()
            if _days_ok(days, now_dt) and last < slot_today:
                next_fire = slot_today                # today's slot pending (past-due or upcoming)
            else:
                next_fire = _next_slot_wall(sch, now_dt, days, 8)
        elif t == 'weekly':
            last = _read_last(spec_path)
            if last is None or last == 0: continue
            target = _DOW[str(sch['day']).lower()[:3]]
            back = (now_dt.weekday() - target) % 7
            this_slot = (_slot_at(now_dt, sch['at']) - timedelta(days=back)).timestamp()
            this_slot_dt = datetime.fromtimestamp(this_slot, tz=zi) if zi else datetime.fromtimestamp(this_slot)
            if _days_ok(days, this_slot_dt) and last < this_slot:
                next_fire = this_slot                 # this week's slot pending
            else:
                next_fire = _next_slot_wall(sch, now_dt, days, 15)
        elif t == 'one_shot':
            # .fired sentinel governs one_shot; skip if already fired.
            fired_path = os.path.join(state_dir, os.path.basename(spec_path).replace('.json','.fired'))
            if os.path.exists(fired_path): continue
            at_ts, at_err = _parse_at_ts(sch.get('at'), zi)
            if at_err: continue                       # scheduler will LOUD-alert
            if days:
                at_dt = datetime.fromtimestamp(at_ts, tz=zi) if zi else datetime.fromtimestamp(at_ts)
                if not _days_ok(days, at_dt): continue
            next_fire = at_ts                         # past-due → next_fire <= now → trips soon check

        if next_fire is not None and next_fire <= soon:
            print(f"DUE spec={os.path.basename(spec_path)} type={t} next_fire={int(next_fire)} overdue_s={int(now-next_fire)}")
            sys.exit(0)
    except Exception as e:
        print(f"ERROR spec={spec_path} {type(e).__name__}: {e}", file=sys.stderr)
        continue
sys.exit(1)
PY
)
  local rc=$?
  if [ $rc -eq 0 ]; then
    # DUE — log which spec + how overdue for pilot diagnostics
    metric event=schedule-peek identity="$name" result=due detail="$(echo "$py_out" | head -1)"
    return 0
  fi
  # Non-DUE — if there was an error message on stderr (mixed into py_out), that's a real bug
  if echo "$py_out" | grep -q '^ERROR'; then
    metric event=schedule-peek identity="$name" result=error detail="$(echo "$py_out" | grep '^ERROR' | head -1)"
  fi
  return 1
}

# do_kill_dormant: send /exit at REPL, blind-Enter through any confirms, poll for bare shell prompt,
# drop the .dormant sentinel. Called only after idle_check + pending_check both pass.
do_kill_dormant() {
  local name="$1" sess="$2"
  # supervisor is about to touch this pane — drop the "hands off" marker; it'll be re-dropped by
  # drive() at the end of the next wake.
  rm -f "$IDENTITIES_DIR/$name/.resume-complete" 2>/dev/null
  local rss_before
  rss_before=$(ps -o rss= -C claude 2>/dev/null | awk '{s+=$1}END{print s+0}')
  metric event=kill-start identity="$name" session="$sess" rss_kb_before="$rss_before"
  local sentinel="$IDENTITIES_DIR/$name/.dormant"
  # Write .dormant BEFORE the /exit paste — otherwise there is a window where claude has exited
  # but the sentinel is not yet on disk, and an external observer (Skynet pane attaching mid-kill)
  # sees "no claude AND no sentinel" and paints the inactive fallback banner. Rolled back in the
  # poll-fail branch below. Reconcile itself is safe: do_kill_dormant runs synchronously inside
  # the iteration, so no re-entry for this identity during the kill window.
  date -u +%Y-%m-%dT%H:%M:%SZ > "$sentinel"
  # Use bracketed paste for the /exit text (avoids Ink's race with plain send-keys), then Enter
  local _t; _t=$(mktemp); printf '/exit' > "$_t"
  timeout -k 5 10 tmux load-buffer -t "$sess" "$_t" 2>/dev/null
  timeout -k 5 10 tmux paste-buffer -p -t "$sess" 2>/dev/null
  rm -f "$_t"
  sleep 0.5
  timeout -k 5 10 tmux send-keys -t "$sess" Enter 2>/dev/null
  # Blind Enter x3 spaced 2s for any monitor-kill confirmation prompts
  local i=0; while [ "$i" -lt 3 ]; do sleep 2; timeout -k 5 10 tmux send-keys -t "$sess" Enter 2>/dev/null; i=$((i+1)); done
  # Poll: is claude still a child of this pane's shell? — up to 30s.
  # (2026-08-19 rewrite, Sandy diagnosis after yolanda/vicky/sandy kill-fail cluster.) The prior
  # design polled the pane TEXT for a bare-shell-prompt regex (`[$#]$` on the last visible line).
  # That's a fragile proxy: it misses when the exit-hint line ("claude --resume <id>") or a
  # blank line lands as tail-1, so kill-fail fired even though /exit had already completed in
  # ~5-15s. Metrics from the prior week: every successful kill on this box completed in 5-14s
  # (median 10s, max 14s, N=50) — so bumping the poll ceiling from 30s→90s on 2026-08-12
  # didn't help, because the ceiling was never the actual problem. The real question is
  # "did claude exit," and the direct answer is "does the pane's shell still have a claude
  # child?" — a boolean process fact, not a pane-text guess. 30s is generously enough (3× the
  # observed p90). Poll every 1s so success is snappy.
  local pane_pid; pane_pid=$(timeout -k 5 10 tmux display-message -p -t "$sess" '#{pane_pid}' 2>/dev/null)
  if [ -z "$pane_pid" ]; then
    rm -f "$sentinel"
    log "'$name' dormancy KILL: could not resolve pane_pid for session '$sess' — aborting kill (sentinel rolled back)"
    metric event=kill-fail identity="$name" reason=no-pane-pid
    return 1
  fi
  local waited=0 ok=0
  while [ "$waited" -lt 30 ]; do
    sleep 1; waited=$((waited+1))
    # No claude among the pane shell's direct children → claude exited.
    if ! pgrep -P "$pane_pid" -x claude >/dev/null 2>&1; then ok=1; break; fi
  done
  if [ "$ok" != 1 ]; then
    # Roll back the pre-written sentinel — claude genuinely survived 30s of /exit. Reconcile's
    # alive-check handles it as usual next tick.
    rm -f "$sentinel"
    log "'$name' dormancy KILL: claude still a child of pane $pane_pid after 30s — aborting kill (sentinel rolled back)"
    metric event=kill-fail identity="$name" reason=claude-still-running
    return 1
  fi
  local rss_after; rss_after=$(ps -o rss= -C claude 2>/dev/null | awk '{s+=$1}END{print s+0}')
  local reclaimed=$((rss_before - rss_after))
  log "'$name' dormant (kill ok, reclaimed ~${reclaimed}KB total-claude-rss, sentinel dropped)"
  metric event=kill-done identity="$name" session="$sess" rss_kb_after="$rss_after" reclaimed_kb="$reclaimed"
}

# do_wake: remove .dormant, call drive() with --resume. Reuses the existing --resume path verbatim
# (trust dialog, resume-summary Down+Enter, ctrl-C anti-compact spam, re-arm-monitors nudge).
# drive() ALREADY scrapes for the ❯ prompt as part of its dialog-handling; if drive() returns 0
# and its final log line "resumed — sent re-arm-your-monitors nudge" appears, we're at REPL. So
# no need for a redundant 60s verify poll here — we just check pane state at the end and LOUD-log
# any mismatch. If the wake FAILS (drive() couldn't resume), the sentinel is already removed and
# next reconcile cycle sees dead claude + no sentinel → existing recover path relaunches. That's
# the built-in graceful-failure of the mechanism.
do_wake() {
  local name="$1" sess="$2" trigger="$3"
  local sentinel="$IDENTITIES_DIR/$name/.dormant"
  local t0 t1 latency
  t0=$(date +%s)
  metric event=wake-start identity="$name" trigger="$trigger"
  rm -f "$sentinel"
  # resolve_session prints "<cwd>\t<sessionId>" (tab-separated) — need the SECOND field
  local rs sid="" wcwd=""
  rs=$(resolve_session "$name") && { sid=$(printf '%s' "$rs" | cut -f2); wcwd=$(printf '%s' "$rs" | cut -f1); }
  # If resolve_session gave us a cwd, use it; otherwise fall back to the pane's current path (drive() will re-query)
  if [ -z "$sid" ]; then
    log "'$name' dormancy WAKE ($trigger): no session to --resume — fresh /id"
    drive "$name" "$sess" "" "$wcwd"
  else
    drive "$name" "$sess" "$sid" "$wcwd"
  fi
  # Brief settle before verify — drive() just sent the re-arm nudge; Ink needs a beat to render
  # the ❯ input line. Without this settle, verify sometimes runs before the prompt paints.
  sleep 2
  t1=$(date +%s)
  latency=$((t1 - t0))
  # Final pane check: did we reach ❯ REPL? Search a WIDE window — the ❯ input line sits ABOVE
  # the 3-line Claude Code footer, so a naive `tail -3` misses it. Grep the full capture.
  local pane; pane="$(timeout -k 5 10 tmux capture-pane -pt "$sess" -S -15 2>/dev/null)"
  if printf '%s' "$pane" | grep -q '❯'; then
    log "'$name' woken in ${latency}s (trigger=$trigger)"
    metric event=wake-done identity="$name" trigger="$trigger" latency_s="$latency"
  else
    log "WARNING: '$name' dormancy WAKE post-drive() shows no ❯ prompt (trigger=$trigger, latency=${latency}s). Sentinel already removed; next cycle will alive-check-relaunch."
    metric event=wake-verify-fail identity="$name" trigger="$trigger" latency_s="$latency"
    return 1
  fi
}

reconcile() {
  sample_memory                                    # dashboard sampler — one line per cycle
  resolve_identities
  if [ "${#IDENTITIES[@]}" -eq 0 ]; then log "no identities to supervise (MODE=$MODE)"; return 0; fi
  local name slugname actual sentinel launched=0
  for name in "${IDENTITIES[@]}"; do
    slugname="$(slug "$name")"
    actual="$(match_session "$slugname")"      # existing session (any case) or empty
    # EXPLICIT recycle request: the agent dropped this after `/id save` to escape a filling
    # context window. It overrides the normal alive-check (this is a deliberate request, not a
    # misread), so a healthy running session IS recycled here.
    sentinel="$IDENTITIES_DIR/$name/.recycle-requested"
    if [ -f "$sentinel" ]; then
      if [ "${DRY_RUN:-0}" = 1 ]; then log "DRY_RUN would recycle '$name' (recycle sentinel present)"; continue; fi
      # Rename → .recycled-at instead of rm, so Skynet has a visible "recycling"
      # signal for the ~seconds while the fresh claude boots (cleaned up below by
      # the delayed rm scheduled at end of recycle() / launch()). The rename is
      # what closes the loop guard — the sentinel MUST no longer match the
      # `.recycle-requested` name before reconcile completes this iteration, or
      # the next tick would re-recycle the freshly-started claude. `|| rm` is a
      # paranoid fallback in case the mv can't happen (permissions, race).
      if mv "$sentinel" "$IDENTITIES_DIR/$name/.recycled-at" 2>/dev/null; then
        log "'$name' sentinel: .recycle-requested → .recycled-at (loop guard active for this recycle)"
      else
        rm -f "$sentinel"
        log "'$name' sentinel: mv to .recycled-at failed — force-removed .recycle-requested (loop guard active via absence)"
      fi
      if [ -n "$actual" ]; then
        recycle "$name" "$actual"
        launched=$((launched+1)); sleep "${STAGGER_SECONDS:-8}"; continue
      fi
      log "'$name' recycle requested but no live session — forcing a FRESH /id load below"
      # ⚠️ Fall through to the ABSENT branch — but that branch calls launch(), which DISCOVERS the
      # newest session and RESUMES it (added 2026-07-15, resume-in-workdir). So the old comment here
      # ("launches fresh") stopped being true: a recycle request whose session was already gone got
      # silently answered with a RESUME of the very context the agent asked to escape. Force fresh.
      FORCE_FRESH=1
    fi

    # ---- DORMANCY exemption sentinel (2026-08-09) ----------------------
    # `<identity>/.no-dormancy` opts a specific identity out of dormancy entirely — the
    # supervisor treats this identity as if DORMANCY=off for this pass, regardless of the
    # box-wide setting. Whoever wrote the file wants this one always-on; no auth check.
    # Edge: if the identity is currently .dormant (flag added while already asleep), clear
    # the .dormant sentinel so the normal alive-check below relaunches it this tick.
    local exempt=0
    if [ -f "$IDENTITIES_DIR/$name/.no-dormancy" ]; then
      exempt=1
      if [ -f "$IDENTITIES_DIR/$name/.dormant" ]; then
        if [ "${DRY_RUN:-0}" = 1 ]; then
          log "DRY_RUN would clear '$name' .dormant (exempt via .no-dormancy)"
        else
          log "'$name' .no-dormancy present but .dormant sentinel found — clearing so alive-check relaunches"
          rm -f "$IDENTITIES_DIR/$name/.dormant"
        fi
      fi
    fi

    # ---- DORMANCY (2026-08-07) — only when DORMANCY=on -----------------
    # Dormant path: identity has .dormant sentinel + claude intentionally dead. Check wake triggers;
    # if triggered → do_wake. Otherwise skip (do NOT fall through to the alive-check below, which
    # would auto-relaunch and defeat dormancy). Sentinel-delete wake is handled by falling out of
    # this if-block entirely: no sentinel = normal branch = alive-check sees dead claude = relaunch.
    if [ "$DORMANCY" = "on" ] && [ "$exempt" = 0 ]; then
      local dormant_sentinel="$IDENTITIES_DIR/$name/.dormant"
      if [ -f "$dormant_sentinel" ]; then
        local _trig=""
        if matrix_peek "$name";   then _trig="matrix"
        elif schedule_peek "$name"; then _trig="schedule"
        fi
        if [ -n "$_trig" ]; then
          if [ -n "$actual" ]; then
            do_wake "$name" "$actual" "$_trig"
            launched=$((launched+1)); sleep "${STAGGER_SECONDS:-8}"
          else
            log "'$name' dormancy WAKE ($_trig) but no tmux session — ABSENT branch will handle next cycle"
            rm -f "$dormant_sentinel"
          fi
          continue
        fi
        # Dormant + no wake trigger + no tmux session (the post-reboot case): create a bare-shell
        # tmux session so Skynet can still see + wake this identity. Restores the invariant that
        # every supervised identity has a tmux session — dormant or not — so a reboot-since-sleep
        # and dormant-on-current-uptime look identical from any external observer. No claude is
        # launched; the session is just an empty shell in the identity's workdir, ready for a
        # later wake trigger's do_wake (which types the launch command into the existing shell).
        if [ -z "$actual" ]; then
          local _wd="$HOME" _disc
          if _disc="$(resolve_session "$name")"; then
            _wd="${_disc%%$'\t'*}"
            [ -d "$_wd" ] || _wd="$HOME"
          fi
          if [ "${DRY_RUN:-0}" = 1 ]; then
            log "DRY_RUN would create bare-shell tmux '$slugname' for dormant '$name' (cwd=$_wd)"
          elif timeout -k 5 10 tmux new-session -d -s "$slugname" -c "$_wd" 2>/dev/null; then
            log "'$name' dormant: created bare tmux session '$slugname' for Skynet visibility (cwd=$_wd)"
          fi
        fi
        [ "${VERBOSE:-0}" = 1 ] && log "'$name' dormant, no wake trigger"
        continue
      fi
    fi

    if [ -n "$actual" ]; then
      # a session already exists (possibly different case) -> check claude on THAT session.
      if claude_running "$actual"; then
        # DORMANCY idle-check: active session that meets both idleness signals + nothing pending
        # → kill + mark dormant. Only when DORMANCY=on; otherwise this whole block is skipped and
        # behavior is identical to pre-dormancy supervisor.
        if [ "$DORMANCY" = "on" ] && [ "$exempt" = 0 ] && idle_check "$name" "$actual" && pending_check "$name"; then
          if [ "${DRY_RUN:-0}" = 1 ]; then
            log "DRY_RUN would kill+dormant '$name' (idle >${IDLE_THRESHOLD_MINUTES}min, nothing pending)"
          else
            log "'$name' idle >${IDLE_THRESHOLD_MINUTES}min + nothing pending — going dormant"
            do_kill_dormant "$name" "$actual"
            launched=$((launched+1)); sleep "${STAGGER_SECONDS:-8}"
          fi
          continue
        fi
        [ "${VERBOSE:-0}" = 1 ] && log "'$name' (session '$actual') alive — skip"
        continue
      fi
      # Not detected live. Double-probe to rule out a transient misread before taking ANY action.
      sleep 2
      if claude_running "$actual"; then
        [ "${VERBOSE:-0}" = 1 ] && log "'$name' alive on re-probe — skip"
        continue
      fi
      # Log-only enrichment: if we just recycled this identity, flag how soon after — a death within
      # a few minutes of a recycle is the smoking-gun signature of the "fresh claude died -> recovery
      # resumes the OLD session, undoing the recycle" failure mode. Behavior is unchanged.
      local _rec="${LAST_RECYCLE_AT[$name]:-}" _tag=""
      if [ -n "$_rec" ]; then
        local _delta=$(( $(date +%s) - _rec ))
        if [ "$_delta" -le 300 ]; then _tag=" (${_delta}s AFTER recent recycle — recovery may UNDO the recycle)"
        else _tag=" (${_delta}s after last recycle)"; fi
      fi
      # Also flag orthogonal sentinel state — a DEAD claude while .recycle-requested or .recycled-at
      # is present tells us the death is in the recycle chain, not a spontaneous crash.
      local _sen_tag=""
      [ -f "$IDENTITIES_DIR/$name/.recycle-requested" ] && _sen_tag="$_sen_tag [.recycle-requested present]"
      [ -f "$IDENTITIES_DIR/$name/.recycled-at" ] && _sen_tag="$_sen_tag [.recycled-at present]"
      log "'$name' (session '$actual') present but claude DEAD — recovering in place${_tag}${_sen_tag}"
      launch "$name" recover "$actual"
    else
      log "'$name' (session '$slugname') ABSENT — launching"
      launch "$name" fresh "$slugname"
    fi
    launched=$((launched+1))
    # stagger: the blind-drive already spaces launches ~SETTLE apart; add a small extra gap so a
    # many-identity box never forks them all at once.
    [ "${DRY_RUN:-0}" = 1 ] || sleep "${STAGGER_SECONDS:-8}"
  done
  [ "$launched" -eq 0 ] && [ "${VERBOSE:-0}" = 1 ] && log "all supervised identities alive"
  return 0
}

# ---- main ----
ensure_agent_teams_env
resolve_memory_wrapper
case "${1:-}" in
  --once) VERBOSE=1 reconcile ;;
  *)
    log "agent-supervisor up: MODE=$MODE, interval=${CHECK_INTERVAL}s, claude=$CLAUDE"
    # sweep any stale .resume-complete markers left in identity folders across a crash/reboot.
    # markers are only meaningful between drive()'s end-touch and the next drive-start / kill-start
    # rm — a fresh supervisor process starts with a clean slate. belt-and-suspenders alongside the
    # freshness-timestamp check consumers use to distinguish this-wake from prior-wake.
    for d in "$IDENTITIES_DIR"/*/; do rm -f "$d/.resume-complete" 2>/dev/null; done
    while :; do reconcile; sleep "${CHECK_INTERVAL:-30}"; done
    ;;
esac

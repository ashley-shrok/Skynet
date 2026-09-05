#!/bin/bash
# agent-relay receiver — THE canonical receiver, distributed to every host running
# agent substrate by the Skynet distributor (see feature 02). Launch it ONCE via the
# Monitor tool with
# STATE_DIR (and optionally SINCE_FILE) set in the environment — do NOT hand-roll
# your own receiver; a divergent copy silently reintroduces bugs this one already
# fixes (self-message filter, single-instance dedup, encrypted-room wake, post-join
# backfill, read receipts). STATE_DIR holds token/uid/base/since (see the skill).
: "${STATE_DIR:?agent-relay recv.sh: set STATE_DIR in the environment before launching}"
SINCE_FILE="${SINCE_FILE:-$STATE_DIR/since}"
# --- Credential resolution + SELF-HEAL (added 2026-07-21) ------------------------------------
# STATE_DIR is supposed to hold token/uid/base (seeded by the on-wake setup). But if those files
# are absent (setup didn't complete) or the token has DIED, the old code read an empty/stale token
# and the sync loop below spun forever with no auth and no recovery — a silent, permanent deafness
# the supervisor can't see (the process stays alive). So: resolve base/uid/token, falling back to
# the identity's creds file (relay.json), VALIDATE the token, and mint a fresh one from the stored
# password if it's missing or dead. All diagnostics go to STDERR (the Monitor output file), NOT
# stdout — stdout lines are wakes, and heal chatter must not wake the agent.
CREDS="${RELAY_CREDS:-}"
if [ -z "$CREDS" ]; then
  for c in relay.json relay-credentials.json relay-creds.json; do
    [ -f "$(dirname "$STATE_DIR")/$c" ] && { CREDS="$(dirname "$STATE_DIR")/$c"; break; }
  done
fi
cred(){ [ -f "$CREDS" ] && jq -r --arg k "$1" '.[$k] // empty' "$CREDS" 2>/dev/null; }
# BASE + ME (uid): prefer relay.json (the canonical config source), fall back to the STATE_DIR
# cache only if creds are missing. Priority WAS the other way around; that let a stale cached
# BASE mask a hand-edit to relay.json, so any base change (homeserver migration, port change,
# http→https, Docker IP shuffle) required rm-ing $STATE_DIR/base before it would propagate.
# (2026-08-06, Stacy diagnosis after her ceo-skynet Docker-IP shuffle rotted her cached BASE.)
BASE=$(cred base); [ -z "$BASE" ] && BASE=$(cat "$STATE_DIR/base" 2>/dev/null)
ME=$(cred user_id); [ -z "$ME" ] && ME=$(cat "$STATE_DIR/uid" 2>/dev/null)
[ -n "$BASE" ] && printf '%s' "$BASE" > "$STATE_DIR/base"
# ⚠️ HARD-FAIL PREAMBLE (added 2026-07-29 after Nelly ate a Tina DM for ~90 min):
# if BASE is empty here, the sync loop below spins forever on a malformed URL that curl exits 3
# from silently, and the CURSOR GUARD (further down) treats the empty response as "server
# restarting, keep cursor, sleep 3, retry" — indistinguishable from healthy long-polling to the
# supervisor. Silent-deafness the self-heal was designed to prevent, just via a different upstream
# cause: STATE_DIR pointed at a dir with no relay.json (commonly /tmp/whatever/). Emit ONE line
# to STDOUT (so it wakes the agent as an actual event, not just buried stderr) and exit; the
# Monitor ends and the agent gets a wake with the diagnostic instead of a live-looking zombie.
if [ -z "$BASE" ]; then
  echo "recv.sh FATAL: BASE could not be resolved. STATE_DIR=$STATE_DIR — recv.sh derives creds from \$(dirname \$STATE_DIR)/relay.json (looked at '$(dirname "$STATE_DIR")/relay.json'). For a DURABLE identity, STATE_DIR must point at ~/.claude/identities/<name>/relay-state so dirname lands on the identity dir where relay.json lives. Exiting so this failure is visible instead of silent."
  exit 2
fi
# relogin(): mint a fresh token from the stored password, persist it, rebuild H. Returns 1 if it
# can't (no parseable password) — caller decides whether to back off. Mirrors the tg-bridge's
# self-heal so a token death recovers instead of wedging.
relogin(){
  local pw lp r t
  pw=$(cred password)
  [ -z "$pw" ] && { echo "recv.sh: no password in '${CREDS:-<none>}' — cannot re-login; stuck until creds are fixed" >&2; return 1; }
  lp=${ME#@}; lp=${lp%%:*}
  r=$(curl -s -X POST "$BASE/login" -H 'Content-Type: application/json' \
      -d "$(jq -n --arg u "$lp" --arg p "$pw" '{type:"m.login.password",identifier:{type:"m.id.user",user:$u},password:$p}')")
  t=$(jq -r '.access_token // empty' <<<"$r")
  [ -z "$t" ] && { echo "recv.sh: re-login FAILED: $(jq -c '{errcode,error}' <<<"$r" 2>/dev/null)" >&2; return 1; }
  printf '%s' "$t" > "$STATE_DIR/token"; H="Authorization: Bearer $t"
  echo "recv.sh: re-logged in as ${ME:-?}, token refreshed" >&2; return 0
}
# LOUD AUTH ALERT (added 2026-08-01, class-fix for commander-zoey silent-deafness 3-day incident):
# stderr goes to the Monitor's output file but does NOT wake the agent — only STDOUT lines become
# wake events. So a receiver whose token is dead AND whose password re-login also fails (i.e.
# account itself is dead on the server, not just a stale token) just spins in the AUTH GUARD's
# `relogin || sleep 5; continue` invisibly. Fix: on any hard-auth failure, emit ONE stdout line
# that WAKES the agent — but rate-limit so we don't spam wakes every 5s during the failing loop.
# Interval is override-able via env for tests; default 15min balances "loud enough to notice
# within a shift" against "quiet enough not to burn the wake budget on a stuck box."
AUTH_ALERT_INTERVAL="${AUTH_ALERT_INTERVAL:-900}"
_last_auth_alert=0
auth_alert(){
  local now msg="$1"
  now=$(date +%s)
  if [ "$(( now - _last_auth_alert ))" -ge "$AUTH_ALERT_INTERVAL" ]; then
    _last_auth_alert=$now
    # STDOUT emission → becomes a Monitor wake event → agent sees "⚠️" and acts
    printf '⚠️ [recv.sh AUTH DEAD, %s] %s\n' "${ME:-?}" "$msg"
  fi
  printf 'recv.sh AUTH DEAD: %s\n' "$msg" >&2   # always log to stderr for debug
}
# Token: STATE_DIR file, else the creds file's token; VALIDATE via whoami; if dead/missing, relogin.
TOK=$(cat "$STATE_DIR/token" 2>/dev/null); [ -z "$TOK" ] && TOK=$(cred token)
H="Authorization: Bearer $TOK"
if [ -z "$TOK" ] || ! curl -s -H "$H" "$BASE/account/whoami" | jq -e '.user_id' >/dev/null 2>&1; then
  relogin || auth_alert "startup relogin failed — will keep retrying but sync will 401 until password/account is fixed"
else
  printf '%s' "$TOK" > "$STATE_DIR/token"    # persist the resolved-good token into STATE_DIR
fi
# Backfill ME from whoami if the creds/state didn't carry it (needed for the self-message filter).
[ -z "$ME" ] && ME=$(curl -s -H "$H" "$BASE/account/whoami" | jq -r '.user_id // empty')
[ -n "$ME" ] && printf '%s' "$ME" > "$STATE_DIR/uid"        # full @user:server id — no hardcoded suffix
# --------------------------------------------------------------------------------------------
# Where downloaded media (images/files/audio/video) lands so the agent can actually OPEN it. A
# message-stream receiver can't inline an image the way a chat UI does, so it saves the bytes and
# hands over a local path. Defaults beside the cursor (durable identity => relay-state/media;
# throwaway => STATE_DIR/media). Override with MEDIA_DIR in the env.
MEDIA_DIR="${MEDIA_DIR:-$(dirname "$SINCE_FILE")/media}"; mkdir -p "$MEDIA_DIR" 2>/dev/null
# Media endpoints hang off the SERVER ROOT, not the client-v3 base. BASE is
# http://host:8008/_matrix/client/v3, so strip from /_matrix onward to get the root — appending
# the media path to the full client base yields a doubled path and a guaranteed 404.
MROOT="${BASE%/_matrix/*}"
SINCE=$(cat "$SINCE_FILE" 2>/dev/null)   # pre-seeded at REGISTER time; SINCE_FILE may be a STABLE path (durable identity) so this RESUMES across restarts
# If SINCE is empty on entry (fresh identity's first wake, or a corrupted/blank cursor file),
# the main-loop's first iteration below detects that and hits the INITIAL-SYNC path — a /sync
# with no `since` param — whose response includes `.rooms.invite` (all pending invites, however
# old) AND a fresh `.next_batch`. The existing auto-join loop then joins those invites and
# their backfill wakes surface as normal. Cursor gets seeded from the initial-sync's next_batch
# on that same iteration (line ~193 below).
#
# ⚠️ Removed the old baseline-snapshot fallback here (was a one-liner that grabbed only
# `.next_batch` from an initial sync and threw the rest away). That fallback silently swallowed
# any pending invites already on the account — invisible to every subsequent incremental sync
# because the cursor was seeded AFTER the invites existed. Bit us the moment we needed it: on
# 2026-08-31, coordinator (@nelly) spawned + invited + sent a message to a fresh actor (@nadia)
# BEFORE nadia's receiver ever arms. Nadia's first-wake receiver ran the fallback, seeded past
# the pending invite, then polled forever with an empty invite section — receiver "healthy",
# nadia permanently uninvited-and-deaf to nelly's dispatch. Handling initial-sync in the main
# loop below reuses the same auto-join+backfill code and closes the whole class.
# Single-instance guard: exactly ONE poller per CURSOR. Two receivers sharing a `since` cursor
# race — the second advances it past messages the first hasn't surfaced, silently eating them.
# ⚠️ The pidfile is keyed on the CURSOR's dir (dirname SINCE_FILE), NOT STATE_DIR. This is the
# fix for the cross-session dup bug (diagnosed 2026-07-17): a durable identity's SINCE_FILE is a
# STABLE path (~/.claude/identities/<name>/relay-state/since), so its pidfile is stable too and a
# NEW session's receiver sees + kills the PRIOR session's receiver even though that one lives in a
# DIFFERENT ephemeral STATE_DIR. Keying on STATE_DIR (the old bug) made each session's guard blind
# to the others, so a stale receiver from an earlier session kept polling and ate messages into a
# dead session. For a throwaway (SINCE_FILE=$STATE_DIR/since) this resolves right back to STATE_DIR
# — same per-session behavior as before. Kill only a live recv.sh (so a recycled PID can't hit an
# unrelated process), then claim. Guarantees one poller per identity across recycles/relaunches.
RPIDF="$(dirname "$SINCE_FILE")/recv.pid"; OLD=$(cat "$RPIDF" 2>/dev/null)
if [ -n "$OLD" ] && [ "$OLD" != "$$" ] && ps -p "$OLD" -o args= 2>/dev/null | grep -qF "recv.sh"; then kill "$OLD" 2>/dev/null; fi
printf '%s' "$$" > "$RPIDF"   # no EXIT-trap cleanup on purpose: the file just holds the last
# receiver's PID. A relaunch overwrites it; if the PID it names is dead (normal after a
# wake-exit) the check above simply skips the kill. Trapping rm here would race a freshly
# superseded instance's trap against the new instance's write and blank the file.
# --- Long-message spill (added 2026-07-21) -------------------------------------------------
# The harness truncates any single wake event at ~500 chars (prefix INCLUDED), so a long message
# surfaced inline is silently cut mid-word. Instead: a message whose formatted line would exceed
# the inline budget is written to a per-message file and surfaced as a short preview + that file's
# PATH (the agent Reads it for the whole thing) — the same treatment media already gets. Short
# messages stay fully inline (no file, no Read). Truncation stops being possible: the inline text
# is just a preview, the file is the whole message, and the PATH is placed BEFORE the preview so it
# can never itself be truncated. Files live beside the cursor (durable => relay-state/messages).
MSG_DIR="${MSG_DIR:-$(dirname "$SINCE_FILE")/messages}"; mkdir -p "$MSG_DIR" 2>/dev/null
# Small rolling cache of message previews so a later m.room.redaction can be surfaced with
# the ORIGINAL body preview (matrix strips .content on redaction, so if you don't cache the
# body when the message first arrives, you can never recover it — you'd only be able to say
# "$abc was redacted" with no way for the receiver to eyeball whether it mattered). Keyed by
# event_id → single-line preview; trimmed to the last CACHE_MAX lines each sync.
MSG_CACHE="${MSG_CACHE:-$STATE_DIR/msg-cache.jsonl}"; touch "$MSG_CACHE" 2>/dev/null
CACHE_MAX=1000
INLINE_MAX=460   # keep the whole event line comfortably under the ~500-char harness cap
emit_body(){  # room sender event_id body -> echo the line to surface (spilling to a file if long)
  local room="$1" sender="$2" ev="$3" body="$4"
  local prefix="[room $room] [$sender] (event $ev): "
  if [ "$(( ${#prefix} + ${#body} ))" -le "$INLINE_MAX" ]; then
    printf '%s' "${prefix}${body}"; return   # fits inline — surface it whole, no file
  fi
  local safeev path
  safeev=$(printf '%s' "$ev" | tr -c 'A-Za-z0-9._-' '_')
  path="$MSG_DIR/${safeev}.txt"
  printf '%s' "$body" > "$path"
  # PATH first (survives any truncation), a bounded preview LAST (harmless if it gets cut)
  printf '%s' "${prefix}[long message, ${#body} chars — full text at ${path} — Read it] «${body:0:160}…»"
}
# --- Orphan-monitor guard (added 2026-09-05 after Noelle ate a Nelly dispatch) ---
# Capture the harness (Claude Code) PID at startup. Our direct parent is the bash-c wrapper
# the Monitor tool spawns; the wrapper stays alive as a waiter even after Claude dies, so
# checking $PPID would always succeed. The GRANDPARENT is the Claude process — that's what
# we need to track. Read it from /proc/$PPID/status which is stable across the child fork.
# In the main loop below, kill -0 the grandparent each iteration; if it's gone, exit(0)
# BEFORE any sync/state changes. This closes the orphan bug where recv.sh kept polling for
# days after Claude was killed, silently advancing SINCE past messages nobody ever saw
# (the SIGPIPE never fired because a socket stdout only EPIPEs on actual write failure, and
# the poll loop rarely writes). If we can't resolve the grandparent (unusual launch shape),
# fall back to skipping the check — better to keep polling than to accidentally self-exit.
HARNESS_PID=$(awk '/^PPid:/{print $2}' "/proc/$PPID/status" 2>/dev/null)
if [ -z "$HARNESS_PID" ] || [ "$HARNESS_PID" = "0" ] || [ "$HARNESS_PID" = "1" ]; then
  echo "recv.sh: orphan-check disabled (couldn't resolve grandparent from /proc/$PPID/status)" >&2
  HARNESS_PID=""
fi
# -------------------------------------------------------------------------------------------
while :; do
  # Orphan-monitor guard: if Claude Code died, self-exit before touching Matrix state.
  # kill -0 sends no signal; it just tests process existence. Cheap check per iteration.
  if [ -n "$HARNESS_PID" ] && ! kill -0 "$HARNESS_PID" 2>/dev/null; then
    exit 0
  fi
  # If SINCE is empty (fresh identity's first wake, or corrupted cursor), do an INITIAL SYNC
  # by omitting the `since` param — Matrix returns the full current account state including
  # any pending invites in `.rooms.invite`. Initial sync returns immediately (timeout is
  # ignored on it) so no long-poll delay on the seed path. Otherwise it's the normal
  # long-poll incremental sync.
  if [ -z "$SINCE" ]; then
    R=$(curl -s -H "$H" "$BASE/sync?timeout=0")
  else
    R=$(curl -s -H "$H" "$BASE/sync?since=$SINCE&timeout=30000")   # long-poll: returns on a new event, else after 30s
  fi
  # AUTH GUARD (added 2026-07-21): if the token died mid-run the server returns M_UNKNOWN_TOKEN.
  # Re-login from the stored password and retry the SAME cursor rather than spinning silently
  # forever (the old failure mode: a dead token => permanent deafness the supervisor can't see).
  if jq -e '.errcode=="M_UNKNOWN_TOKEN"' <<<"$R" >/dev/null 2>&1; then
    if ! relogin; then
      auth_alert "M_UNKNOWN_TOKEN from sync, relogin failed (check password/account on $BASE)"
      sleep 30
    fi
    continue
  fi
  # STREAM-TOKEN GUARD (added 2026-07-30 post-Synapse-cutover): Synapse rejects a Continuwuity-
  # format numeric since cursor (e.g. `1865474`) with `{"errcode":"M_UNKNOWN","error":"Invalid
  # stream token"}`. Without a specific guard, the CURSOR GUARD below reads the empty next_batch
  # as "server restarting, keep cursor, sleep 3, retry" — so every receiver holding a stale
  # pre-cutover cursor silently spins forever on the same rejected request (fleet-wide deafness
  # the supervisor can't see). Tight match on both errcode AND the exact error string so an
  # unrelated M_UNKNOWN (e.g. a join failure) doesn't accidentally reset the cursor. Fix: do an
  # initial sync (empty `since`) which returns a fresh Synapse-format next_batch, persist it,
  # continue. NO messages lost — SINCE was already broken; the fresh cursor lands at NOW, which
  # is exactly where a spinning receiver was stuck anyway.
  if jq -e '.errcode=="M_UNKNOWN" and .error=="Invalid stream token"' <<<"$R" >/dev/null 2>&1; then
    echo "recv.sh: stale stream token ($SINCE) — resetting cursor via initial sync" >&2
    FRESH=$(curl -s -H "$H" "$BASE/sync?timeout=0" | jq -r '.next_batch // empty')
    if [ -n "$FRESH" ]; then SINCE="$FRESH"; printf '%s' "$SINCE" > "$SINCE_FILE"
    else sleep 5; fi
    continue
  fi
  # CURSOR GUARD (critical): only advance the cursor when this sync actually returned a
  # next_batch. A homeserver restart (reboot / upgrade / config change) cuts EVERY receiver's
  # long-poll at once, so $R comes back empty. The old code blindly wrote that empty value to
  # the cursor file; the NEXT sync then sent an empty `since`, which the server treats as an
  # INITIAL sync and replays the last ~100 messages as if new — waking the whole fleet with
  # OLD messages (a real incident + a token burn). So: on an empty/invalid response, KEEP the
  # existing cursor and retry after a short pause (the server is just coming back up).
  NB=$(jq -r '.next_batch // empty' <<<"$R" 2>/dev/null)
  if [ -z "$NB" ]; then sleep 3; continue; fi
  SINCE="$NB"; printf '%s' "$SINCE" > "$SINCE_FILE"
  # Auto-join any room you've been INVITED to — SILENTLY. Joining is exactly what you'd do
  # anyway, so a BARE invite must NOT wake you (waking an agent only for it to say "it's just an
  # invite, I'll wait for a message" is a pointless wake). The wake comes from an actual MESSAGE.
  # Invites ride in on the SAME sync under .rooms.invite (separate from .rooms.join where
  # messages live); joining is idempotent so it never re-fires, and a failed join just retries
  # next sync.
  # ⚠️ BUT there's a race the since-cursor can't cover: the very common "create room, invite you,
  # and immediately post a hi/context opener" intro pattern puts the opener in the timeline
  # BEFORE your join commits. On the invite-surfacing sync the room isn't in .rooms.join yet, and
  # every later sync's since-cursor returns only events STRICTLY AFTER the cursor — the opener is
  # older, so it's lost forever and never wakes you. Fix: right after joining, do ONE backfill
  # read of the room's recent timeline and surface any non-self message (or encrypted marker) as
  # a wake line, plus a seen-by receipt for the newest. Net: invite with no message => silent
  # join, no wake; invite + opener => you wake on the opener, exactly when there's something to
  # respond to. (Diagnosed by @molly; reproduced + fixed 2026-07-09.)
  JOINED=""
  for r in $(jq -r '.rooms.invite // {} | keys[]' <<<"$R"); do
    curl -s -X POST "$BASE/join/$r" -H "$H" -H 'Content-Type: application/json' -d '{}' >/dev/null
    BFJSON=$(curl -s -H "$H" "$BASE/rooms/$r/messages?dir=b&limit=10")   # newest-first; chunk items carry NO room_id, so pass $r via --arg
    while IFS= read -r bj; do
      [ -z "$bj" ] && continue
      br=$(jq -r '.r' <<<"$bj"); bs=$(jq -r '.s' <<<"$bj"); bev=$(jq -r '.ev' <<<"$bj"); bk=$(jq -r '.k' <<<"$bj")
      if [ "$bk" = "enc" ]; then
        bln="[room $br] [$bs] (event $bev): [ENCRYPTED message — cannot read it; this room is E2E-encrypted and curl agents are locked out. Reply in plaintext that you cannot read it and move to an unencrypted, agent-created room.]"
      else
        bln=$(emit_body "$br" "$bs" "$bev" "$(jq -r '.b' <<<"$bj")")
      fi
      JOINED="${JOINED}${bln}"$'\n'
    done < <(jq -c --arg me "$ME" --arg r "$r" '.chunk[]?
      | select(.sender!=$me and (.type=="m.room.message" or .type=="m.room.encrypted"))
      | {r:$r, s:.sender, ev:.event_id,
         k:(if .type=="m.room.encrypted" then "enc" else "msg" end),
         b:(.content.body // "")}' <<<"$BFJSON")
    # seen-by for the newest backfilled foreign message (dir=b => chunk[0] is newest), so the
    # inviter's "seen by you" lights up even though this opener never re-enters the sync stream
    BEV=$(jq -r --arg me "$ME" '[.chunk[]? | select(.sender!=$me and (.type=="m.room.message" or .type=="m.room.encrypted"))][0].event_id // empty' <<<"$BFJSON")
    [ -n "$BEV" ] && BEVE=$(jq -rn --arg s "$BEV" '$s|@uri') && curl -s -X POST "$BASE/rooms/$r/receipt/m.read/$BEVE" -H "$H" -H 'Content-Type: application/json' -d '{}' >/dev/null
  done
  # Surface new messages from EVERY room this account is in — no allowlist, no per-room
  # management. You are simply aware of anything happening on your relay account. Membership
  # IS the scope: if you shouldn't hear a room, you shouldn't be in it (the user controls who
  # is in what room). Your own messages are filtered (sender!=me); each line is room-tagged.
  # ⚠️ ENCRYPTED rooms: a curl-only agent CANNOT decrypt E2E messages — they arrive as
  # m.room.encrypted with no readable body. We must NOT silently skip them (that looks exactly
  # like "nothing happened" while a human waits for a reply — a real bug that bit us). Instead
  # we WAKE on them too, with a loud can-not-read marker, so you know someone is trying to
  # reach you in a room you can't read and can act (reply in PLAINTEXT that you can't read it,
  # and move to / create an UNENCRYPTED room — humans can't make unencrypted rooms in Element,
  # so an agent has to create it). See "Encryption" under Creating / finding a room.
  # Text/notice messages + encrypted markers. MEDIA msgtypes (image/file/audio/video) are
  # EXCLUDED here and handled by the media block below (download + local path), so a picture
  # isn't surfaced as a bare useless filename. A plain text message has no msgtype "m.image"
  # etc., so the default "m.text" keeps it in this stream.
  # Structured per-message so a long body can be spilled to a file (emit_body) instead of
  # truncated inline. Encrypted rooms keep the fixed can't-read marker (no body to spill).
  OUT=""
  while IFS= read -r mj; do
    [ -z "$mj" ] && continue
    mr=$(jq -r '.r' <<<"$mj"); ms=$(jq -r '.s' <<<"$mj"); mev=$(jq -r '.ev' <<<"$mj"); mk=$(jq -r '.k' <<<"$mj")
    if [ "$mk" = "enc" ]; then
      ln="[room $mr] [$ms] (event $mev): [ENCRYPTED message — cannot read it; this room is E2E-encrypted and curl agents are locked out. Reply in plaintext that you cannot read it and move to an unencrypted, agent-created room.]"
    else
      ln=$(emit_body "$mr" "$ms" "$mev" "$(jq -r '.b' <<<"$mj")")
    fi
    OUT="${OUT}${ln}"$'\n'
  done < <(jq -c --arg me "$ME" '
    .rooms.join // {} | to_entries[]
    | .key as $r | .value.timeline.events[]?
    | select(.sender!=$me and (
        (.type=="m.room.message" and ((.content.msgtype // "m.text") | test("^m\\.(image|file|audio|video)$") | not))
        or .type=="m.room.encrypted"))
    | {r:$r, s:.sender, ev:.event_id,
       k:(if .type=="m.room.encrypted" then "enc" else "msg" end),
       b:(.content.body // "")}' <<<"$R")
  OUT="${OUT%$'\n'}"   # drop the trailing newline so it matches the old single-string form
  # --- CACHE: append every text message in this sync (all senders, incl. me) to the rolling
  # preview cache keyed by event_id. Redactions later look up the ORIGINAL body here so the
  # receiver can eyeball whether the redacted message mattered. Matrix strips .content on
  # m.room.redaction, so this cache is the ONLY way to recover the body after a redaction.
  jq -c --arg me "$ME" '
      .rooms.join // {} | to_entries[] | .key as $r | .value.timeline.events[]?
      | select(.type=="m.room.message"
               and ((.content.msgtype // "m.text") | test("^m\\.(image|file|audio|video)$") | not))
      | {ev:.event_id, room:$r, sender:.sender,
         preview:((.content.body // "") | gsub("\\s+"; " ") | .[0:120])}' <<<"$R" \
    >> "$MSG_CACHE" 2>/dev/null
  # trim (only when it grows past cap, to avoid a rewrite every sync)
  cl=$(wc -l < "$MSG_CACHE" 2>/dev/null || echo 0)
  if [ "$cl" -gt "$(( CACHE_MAX + 200 ))" ] 2>/dev/null; then
    tail -n "$CACHE_MAX" "$MSG_CACHE" > "$MSG_CACHE.tmp" && mv "$MSG_CACHE.tmp" "$MSG_CACHE"
  fi
  # --- REDACTIONS: surface m.room.redaction events (not from me) so an agent knows when a
  # message has been yanked. Matrix strips .content, so we look up the original body preview
  # from MSG_CACHE. Missing from cache (e.g. redaction of a message from before this receiver
  # was running) is expected — say so explicitly rather than fake a body.
  while IFS= read -r rj; do
    [ -z "$rj" ] && continue
    rr=$(jq -r '.r' <<<"$rj"); rs=$(jq -r '.s' <<<"$rj")
    rev=$(jq -r '.ev' <<<"$rj"); rtgt=$(jq -r '.tgt' <<<"$rj"); rreason=$(jq -r '.reason' <<<"$rj")
    prev=$(grep -F "\"ev\":\"$rtgt\"" "$MSG_CACHE" 2>/dev/null | tail -1 | jq -r '.preview // empty' 2>/dev/null)
    if [ -n "$prev" ]; then
      rln="[room $rr] [$rs] (event $rev): 🗑 REDACTED event $rtgt — was: «$prev»"
    else
      rln="[room $rr] [$rs] (event $rev): 🗑 REDACTED event $rtgt — original body not in cache (predates this receiver or already trimmed)"
    fi
    [ -n "$rreason" ] && [ "$rreason" != "null" ] && rln="$rln (reason: $rreason)"
    OUT="${OUT}${OUT:+$'\n'}${rln}"
  done < <(jq -c --arg me "$ME" '
    .rooms.join // {} | to_entries[] | .key as $r | .value.timeline.events[]?
    | select(.sender!=$me and .type=="m.room.redaction")
    | {r:$r, s:.sender, ev:.event_id,
       tgt:(.redacts // .content.redacts // ""),
       reason:(.content.reason // "")}' <<<"$R")
  # --- MEDIA: download image/file/audio/video attachments to a local path so the agent can
  # actually open/view them (Element-parity — works for anything in a joined room, whether it
  # arrived from Element or the Telegram bridge). NEVER silently drop: on a download failure we
  # still surface a line naming the media, so a picture can't vanish.
  # ⚠️ A just-uploaded media is NOT instantly downloadable by another user — Continuwuity has a
  # post-upload availability lag that is real but VARIABLE (measured 0s / 3s / >8s across
  # consecutive uploads, server-load dependent). So each media download is done in a BACKGROUND
  # worker with a generous retry: the main sync loop never blocks (other messages surface
  # immediately), and a slow-to-land image simply wakes the agent a little later when its bytes
  # arrive. Each worker prints its own wake line to our stdout (the Monitor stream) on completion.
  while IFS= read -r mj; do
    [ -z "$mj" ] && continue
    mroom=$(jq -r '.room' <<<"$mj");   msend=$(jq -r '.sender' <<<"$mj")
    mev=$(jq -r '.event_id' <<<"$mj"); mtype=$(jq -r '.msgtype' <<<"$mj")
    mbody=$(jq -r '.body' <<<"$mj");   murl=$(jq -r '.url' <<<"$mj"); mmime=$(jq -r '.mimetype' <<<"$mj")
    mfn=$(jq -r '.filename' <<<"$mj")
    [ -z "$murl" ] && continue
    srv=${murl#mxc://}; mid=${srv#*/}; srv=${srv%%/*}
    case "$mtype" in
      m.image) klabel="image 🖼️";; m.video) klabel="video 🎬";;
      m.audio) klabel="audio 🎤";;   *) klabel="file 📎";; esac
    # Preserve the ORIGINAL filename (name + extension) when we have one — from the spec `filename`
    # field (our bridge + newer Element set it) or from the body when the body itself is a filename.
    # A caption in the body is NOT a filename, so only accept a body that ends in a real extension.
    rawname=""
    if [ -n "$mfn" ] && [ "$mfn" != "null" ]; then rawname="$mfn"
    else case "$mbody" in *.[A-Za-z0-9][A-Za-z0-9]|*.[A-Za-z0-9][A-Za-z0-9][A-Za-z0-9]|*.[A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9]) rawname="$mbody";; esac; fi
    safeev=$(printf '%s' "$mev" | tr -c 'A-Za-z0-9._-' '_')
    if [ -n "$rawname" ]; then
      # event-id prefix keeps it unique; the real name+extension is preserved after it
      safename=$(printf '%s' "$rawname" | tr -c 'A-Za-z0-9._-' '_' | sed 's/^[._]*//')
      [ -z "$safename" ] && safename="file"
      dest="$MEDIA_DIR/${safeev}_${safename}"
    else
      ext=""; case "$mmime" in
        image/png) ext=.png;; image/jpeg) ext=.jpg;; image/gif) ext=.gif;; image/webp) ext=.webp;;
        audio/ogg) ext=.ogg;; audio/mpeg|audio/mp3) ext=.mp3;; audio/wav|audio/x-wav) ext=.wav;;
        video/mp4) ext=.mp4;; application/pdf) ext=.pdf;; text/plain) ext=.txt;; esac
      dest="$MEDIA_DIR/${safeev}${ext}"
    fi
    # background worker — captures the loop vars by value at fork time; prints when done.
    {
      dc=000
      for att in $(seq 1 15); do   # ~15 tries x 3s = up to ~45s of patience, breaks the instant it lands
        dc=$(curl -s -o "$dest" -w '%{http_code}' -H "$H" "$MROOT/_matrix/client/v1/media/download/$srv/$mid")
        { [ "$dc" = "200" ] && [ -s "$dest" ]; } && break
        dc=$(curl -s -o "$dest" -w '%{http_code}' -H "$H" "$MROOT/_matrix/media/v3/download/$srv/$mid")
        { [ "$dc" = "200" ] && [ -s "$dest" ]; } && break
        sleep 3
      done
      if [ "$dc" = "200" ] && [ -s "$dest" ]; then
        printf '%s\n' "[room ${mroom}] [${msend}] (event ${mev}): [${klabel}] ${mbody} — saved to ${dest} — open/Read this path to view it"
      else
        rm -f "$dest"   # don't leave a 404-body file masquerading as the media
        printf '%s\n' "[room ${mroom}] [${msend}] (event ${mev}): [${klabel}] ${mbody} — DOWNLOAD FAILED (http ${dc}) from ${murl}"
      fi
    } &
  done < <(jq -c --arg me "$ME" '
      .rooms.join // {} | to_entries[] | .key as $r | .value.timeline.events[]?
      | select(.sender!=$me and .type=="m.room.message"
               and ((.content.msgtype // "") | test("^m\\.(image|file|audio|video)$")))
      | {room:$r, sender:.sender, event_id:.event_id, msgtype:.content.msgtype,
         body:(.content.body // ""), filename:(.content.filename // ""),
         url:(.content.url // .content.file.url // ""),
         mimetype:(.content.info.mimetype // "")}' <<<"$R")
  # Read receipts → the human's client shows "seen by <you>" the INSTANT your receiver picks a
  # message up. Reading via /sync sends NO receipt, so without this the indicator never updates
  # and the sender can't tell "received it, working on it" from "session crashed / never got
  # it" until you actually reply. For each room with a foreign message (incl. encrypted — you
  # still received it even if you can't read it), POST a PUBLIC m.read for its latest message
  # event (not m.read.private — others must see it). Best-effort, fire-and-forget.
  for r in $(jq -r --arg me "$ME" '.rooms.join // {} | to_entries[] | select(any(.value.timeline.events[]?; .sender!=$me and (.type=="m.room.message" or .type=="m.room.encrypted"))) | .key' <<<"$R"); do
    EV=$(jq -r --arg r "$r" '[.rooms.join[$r].timeline.events[] | select(.type=="m.room.message" or .type=="m.room.encrypted")][-1].event_id // empty' <<<"$R")
    # URL-encode the event id in the path: v11/v12 ids are URL-safe, but v1/v2 ids are
    # `$opaque:server` (the colon is not path-safe), so encode to keep receipts working there too.
    [ -n "$EV" ] && EVE=$(jq -rn --arg s "$EV" '$s|@uri') && curl -s -X POST "$BASE/rooms/$r/receipt/m.read/$EVE" -H "$H" -H 'Content-Type: application/json' -d '{}' >/dev/null
  done
  OUT="${JOINED}${OUT}"    # JOINED = backfill from a room you JUST auto-joined; OUT = text messages from rooms already joined. (Media attachments surface separately from their own background workers as they finish downloading.)

  # --- Room-size-aware wake jitter (Ashley 2026-07-31) -----------------------------------------
  # Fanout on a room-with-many-agents (an announcement post → N receivers all wake in the same
  # second, all fire against Anthropic's shared org bucket → 429 cluster). Spread the wakes: if
  # any room in this sync batch has member_count>3, sleep uniform-random 0..(members × 30s)
  # before emitting the wake line. DMs and small work-rooms (member_count ≤ 3) fire immediately.
  # The scaling matters — it's not just the initial wake, each wake triggers tool calls that
  # continue burning API tokens; larger rooms need more spread. Anchors: 4 members = 2min max;
  # 12 members = 6min max; 20 members = 10min max. No cache — one /joined_members call per
  # room per sync batch that actually has surfacing events; frequency is low.
  if [ -n "$OUT" ]; then
    JIT_MAX_MEMBERS=0
    for jr in $(jq -r --arg me "$ME" '
        .rooms.join // {} | to_entries[]
        | select(any(.value.timeline.events[]?;
            .sender!=$me and (.type=="m.room.message" or .type=="m.room.encrypted")))
        | .key' <<<"$R"); do
      jre=$(jq -rn --arg s "$jr" '$s|@uri')
      jn=$(curl -s -H "$H" "$BASE/rooms/$jre/joined_members" 2>/dev/null \
           | jq -r '.joined // {} | length' 2>/dev/null)
      [ -z "$jn" ] && jn=0
      [ "$jn" -gt "$JIT_MAX_MEMBERS" ] 2>/dev/null && JIT_MAX_MEMBERS=$jn
    done
    if [ "$JIT_MAX_MEMBERS" -gt 3 ] 2>/dev/null; then
      JIT_CAP=$(( JIT_MAX_MEMBERS * 30 ))     # scales linearly with room size
      JIT_S=$(( RANDOM % (JIT_CAP + 1) ))     # uniform 0..cap inclusive
      echo "recv.sh jitter: max room size $JIT_MAX_MEMBERS > 3 → sleeping ${JIT_S}s (cap ${JIT_CAP}s) before wake" >&2
      sleep "$JIT_S"
    fi
    printf '%s\n' "$OUT"    # print = a Monitor event that wakes you; do NOT exit — keep polling
  fi
done

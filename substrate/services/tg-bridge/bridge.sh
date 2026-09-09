#!/bin/bash
# Phase 79 Plan 05 — Telegram <-> Matrix bridge, Docker-Compose-service edition.
# Deployed as the tg-bridge service in docker-compose.yml (Plan 06).
# Reads config from /state/config.env (written by Skynet at boot, Plan 04):
#   MATRIX_ROOT — Matrix homeserver base URL
#   STT_URL     — Speech-to-text endpoint (self-hosted Whisper for voice notes)
# Reads registry from /state/registry.json (written by Skynet, Plan 04).
# Reads per-human tokens from /state/${h}.token (minted by Skynet via
# matrix-admin-client.loginAsUser, Plan 04). On any Matrix 401, writes
# /state/${h}.token-dead sentinel; Skynet's reconcile pass (Plan 08) will
# re-mint + unlink the sentinel + rewrite registry.json, and inotifywait
# in this script self-reinits within a second.
# Reads per-agent bot tokens from /state/${agent}.bottoken (written by Skynet
# via Plan 04's bot-token-file-writer — blocker B-1 fix; registry.json in
# Phase B does NOT carry an inline bot_token field like Nina's did).
#
# Divergences from Nina's 344-line snapshot at .planning/refs/79-nina-bridge-snapshot.sh:
#   1. Config from env (no hardcoded Tailscale IPs) — ship-gate requirement.
#   2. Per-human SINCE_FILE=/state/${h}.since cursor persistence (mirror
#      substrate/skills/agent-relay/recv.sh CURSOR GUARD pattern verbatim).
#   3. The relogin helper, the acred helper, and the entire password-file
#      path are DELETED — bridge no longer knows passwords; sentinel-file
#      model instead.
#   4. Matrix 401 -> touch /state/${h}.token-dead sentinel, continue serving
#      other humans (Plan 08 reconcile picks it up).
#   5. inotifywait -m on /state/registry.json triggers re-exec on registry
#      change (drop-in restart-free hot reload).
#   6. Bot tokens loaded from /state/${agent}.bottoken via atg() helper
#      instead of jq'd from registry.json's bot_token field (blocker B-1).

set -u

STATE_DIR="/state"
REGISTRY_FILE="${STATE_DIR}/registry.json"
CONFIG_FILE="${STATE_DIR}/config.env"
LOG_FILE="${STATE_DIR}/bridge.log"
WORK="${STATE_DIR}/work"
mkdir -p "$WORK" 2>/dev/null

# Fail-loud dependency check (mirror agent-supervisor.sh:75-80). If any of
# these are absent, the Dockerfile.tg-bridge is broken — surface loudly
# instead of failing 200 lines later on an unexpected `command not found`.
for cmd in curl jq inotifywait; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[tg-bridge] FATAL: $cmd not found on PATH — check Dockerfile.tg-bridge"
    exit 1
  fi
done

# Bounded retry: on first Docker boot Skynet may not have written config
# yet. Per RESEARCH § Assumption A9: retry every 5s for up to 5 min.
#
# Observability (blocker W-7): a silent 5-min wait at boot is invisible on
# real deploys. Log every attempt (below), then repeat a MILESTONE log
# every 10 attempts so `docker logs tg-bridge --tail 50` shows steady
# progress without spamming per-second. Steady-state expectation:
# attempts 1, 10, 20, 30, 40, 50, 60 are visible; anything unexpected
# (e.g. "attempt 60/60 — FATAL") is loud.
for i in $(seq 1 60); do
  [ -f "$CONFIG_FILE" ] && break
  if [ "$i" = "1" ] || [ $((i % 10)) = "0" ]; then
    echo "[tg-bridge] waiting for $CONFIG_FILE (attempt $i/60)"
  fi
  sleep 5
done
if [ ! -f "$CONFIG_FILE" ]; then
  echo "[tg-bridge] FATAL: $CONFIG_FILE not present after 5 min; exiting."
  exit 1
fi
echo "[tg-bridge] $CONFIG_FILE present — sourcing config"

# shellcheck source=/dev/null
. "$CONFIG_FILE"

if [ -z "${MATRIX_ROOT:-}" ] || [ -z "${STT_URL:-}" ]; then
  echo "[tg-bridge] FATAL: MATRIX_ROOT or STT_URL missing from $CONFIG_FILE"
  exit 1
fi

ROOT="$MATRIX_ROOT"
BASE="$ROOT/_matrix/client/v3"
STT="$STT_URL"

echo "[tg-bridge] config sourced: MATRIX_ROOT=$ROOT STT_URL=$STT"

# ---- log helper (preserved from Nina's script) --------------------------------
log(){ printf '%s %s\n' "$(date +%H:%M:%S)" "$1" >> "$LOG_FILE"; }

# ---- Human-side auth (per matrix human) ---------------------------------------
# Each human has its own <human>.token file (600) under /state/, written by
# Skynet via matrix-admin-client.loginAsUser (Plan 04). No password-file
# side-channel exists in Phase B — the bridge does not know passwords.
atok(){ cat "${STATE_DIR}/$1.token"; }         # args: human_name

# Phase B: no re-login helper. On 401, emit a sentinel file that Skynet's
# reconcile pass (Plan 08) picks up and re-mints via admin. Bridge does
# not know passwords.
mark_token_dead(){
  local h="$1"
  touch "${STATE_DIR}/${h}.token-dead"
  echo "[tg-bridge] LOUD: $h Matrix token dead — sentinel written at ${STATE_DIR}/${h}.token-dead"
  log "TOKEN DEAD sentinel written for @$h — waiting for Plan 08 reconcile"
}

# ---- Per-agent bot-token read (blocker B-1) -----------------------------------
# Nina's script read the bot token from registry.json's inline .bot_token
# field. Phase B strips that field and instead reads it from a per-agent
# .bottoken file that Plan 04's bot-token-file-writer maintains. If the
# file is missing, the caller should skip that agent with a WARN log
# (Skynet will write the file on next activation or startup rewrite).
atg(){
  local agent="$1"
  local f="${STATE_DIR}/${agent}.bottoken"
  [ -r "$f" ] || { echo ""; return; }
  cat "$f"
}

# ---- Matrix send helpers (post AS <human> into an agent's DM) -----------------
# Send a raw m.room.message content object; on 401, emit token-dead sentinel
# and give up on THIS send (do not retry inline — let the next sync iteration
# pick up the fresh token after Skynet reconciles + inotifywait re-execs).
mx_send_event(){ # human room content-json
  local h="$1" room="$2" content="$3" code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT \
    "$BASE/rooms/$room/send/m.room.message/$(date +%s%N)" \
    -H "Authorization: Bearer $(atok "$h")" -H 'Content-Type: application/json' \
    --data-binary "$content")
  if [ "$code" = "200" ]; then return 0; fi
  if [ "$code" = "401" ]; then mark_token_dead "$h"; return 1; fi
  log "mx_send_event FAILED (@$h room=$room http=$code)"
  return 1
}
mx_send_text(){ # human room text
  mx_send_event "$1" "$2" "$(jq -n --arg b "$3" '{msgtype:"m.text",body:$b}')"
}
# Upload a local file to the Matrix media repo AS <human>; echo the resulting mxc:// uri.
mx_upload(){ # human file mime filename
  curl -s -X POST "$ROOT/_matrix/media/v3/upload?filename=$(jq -rn --arg s "$4" '$s|@uri')" \
    -H "Authorization: Bearer $(atok "$1")" -H "Content-Type: $3" --data-binary @"$2" \
    | jq -r '.content_uri // empty'
}
# Download an mxc:// to a local dest USING <human>'s token; echo the http code.
# Retries: a just-uploaded media can 404 for a second or two before it's
# downloadable (Continuwuity propagation window — same fetch 404s then 200s ~3s later).
mx_download(){ # human mxc dest
  local h="$1" mxc="$2" dest="$3" srv mid dc att
  srv=${mxc#mxc://}; mid=${srv#*/}; srv=${srv%%/*}
  dc=000
  for att in $(seq 1 15); do
    dc=$(curl -s -o "$dest" -w '%{http_code}' -H "Authorization: Bearer $(atok "$h")" "$ROOT/_matrix/client/v1/media/download/$srv/$mid")
    { [ "$dc" = "200" ] && [ -s "$dest" ]; } && break
    dc=$(curl -s -o "$dest" -w '%{http_code}' -H "Authorization: Bearer $(atok "$h")" "$ROOT/_matrix/media/v3/download/$srv/$mid")
    { [ "$dc" = "200" ] && [ -s "$dest" ]; } && break
    sleep 3
  done
  printf '%s' "$dc"
}

# ---- Telegram helpers (preserved verbatim from Nina's script) -----------------
# Send text to Telegram, splitting anything over Telegram's 4096-char hard cap into
# <=4000-char chunks (broken on line boundaries so bullets/lines stay intact; a single
# over-long line is hard-sliced). Checks the API `ok` field and logs any failure LOUDLY.
tg_send_text(){
  local tok="$1" chat="$2" text="$3" max=4000 buf="" line resp ok
  _tg_one(){
    [ -z "$1" ] && return 0
    resp=$(curl -s "https://api.telegram.org/bot$tok/sendMessage" \
      --data-urlencode "chat_id=$chat" --data-urlencode "text=$1")
    ok=$(jq -r '.ok // false' <<<"$resp" 2>/dev/null)
    [ "$ok" = "true" ] || log "TG send FAILED (bot ${tok%%:*}): $(jq -c '{error_code,description}' <<<"$resp" 2>/dev/null)"
  }
  if [ "${#text}" -le "$max" ]; then _tg_one "$text"; return; fi
  while IFS= read -r line || [ -n "$line" ]; do
    while [ "${#line}" -gt "$max" ]; do
      [ -n "$buf" ] && { _tg_one "$buf"; buf=""; }
      _tg_one "${line:0:$max}"; line="${line:$max}"
    done
    if [ -z "$buf" ]; then buf="$line"
    elif [ $(( ${#buf} + 1 + ${#line} )) -le "$max" ]; then buf="$buf"$'\n'"$line"
    else _tg_one "$buf"; buf="$line"; fi
  done <<<"$text"
  _tg_one "$buf"
}
tg_file_path(){ curl -s "https://api.telegram.org/bot$1/getFile" --data-urlencode "file_id=$2" | jq -r '.result.file_path // empty'; }
tg_download(){
  local tok="$1" fid="$2" dest="$3" fp
  fp=$(tg_file_path "$tok" "$fid"); [ -z "$fp" ] && return 1
  curl -s -o "$dest" "https://api.telegram.org/file/bot$tok/$fp"
  [ -s "$dest" ]
}

# Human display form for user-visible bridge notices.
_hdisp(){ local h="$1"; printf '%s' "$(printf '%s' "${h:0:1}" | tr '[:lower:]' '[:upper:]')${h:1}"; }

# TG->MX for a photo/document/video/audio.
tg_media_to_mx(){
  local name="$1" tok="$2" human="$3" room="$4" fid="$5" msgtype="$6" mime="$7" fn="$8" cap="$9"
  local dest size mxc body content hd
  hd=$(_hdisp "$human")
  dest=$(mktemp "$WORK/tgXXXXXX")
  if ! tg_download "$tok" "$fid" "$dest"; then
    log "TG->MX[$name/$human]: fetch FAILED $msgtype"; mx_send_text "$human" "$room" "📎 [$hd sent $msgtype via Telegram — I couldn't fetch it from Telegram]"; rm -f "$dest"; return
  fi
  size=$(stat -c%s "$dest" 2>/dev/null || echo 0)
  mxc=$(mx_upload "$human" "$dest" "$mime" "$fn")
  if [ -z "$mxc" ]; then
    log "TG->MX[$name/$human]: matrix upload FAILED $msgtype"; mx_send_text "$human" "$room" "📎 [$hd sent $msgtype via Telegram — uploading it to the relay failed]"; rm -f "$dest"; return
  fi
  body="$fn"; [ -n "$cap" ] && body="$cap"
  content=$(jq -n --arg mt "$msgtype" --arg b "$body" --arg fn "$fn" --arg u "$mxc" --arg m "$mime" --argjson s "${size:-0}" \
    '{msgtype:$mt, body:$b, filename:$fn, url:$u, info:{mimetype:$m, size:$s}}')
  if mx_send_event "$human" "$room" "$content"; then log "TG->MX[$name/$human]: $msgtype -> $mxc (body: $body)"
  else log "TG->MX[$name/$human]: $msgtype send FAILED"; fi
  rm -f "$dest"
}

# TG->MX for a voice note: fetch ogg, transcribe via STT, post the words as text.
tg_voice_to_mx(){
  local name="$1" tok="$2" human="$3" room="$4" fid="$5" cap="$6" dest text out hd
  hd=$(_hdisp "$human")
  dest=$(mktemp "$WORK/voiceXXXXXX")
  if ! tg_download "$tok" "$fid" "$dest"; then
    log "TG->MX[$name/$human]: voice fetch FAILED"; mx_send_text "$human" "$room" "🎤 [$hd sent a voice message — I couldn't fetch it]"; rm -f "$dest"; return
  fi
  text=$(curl -s --max-time 90 -X POST "$STT" -F "file=@$dest;type=audio/ogg" -F "model=large-v3" | jq -r '.text // empty')
  text=$(printf '%s' "$text" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
  rm -f "$dest"
  if [ -n "$text" ]; then
    out="🎤 $text"; [ -n "$cap" ] && out="🎤 $text
[caption: $cap]"
    mx_send_text "$human" "$room" "$out"; log "TG->MX[$name/$human]: voice -> \"$text\""
  else
    log "TG->MX[$name/$human]: STT empty/failed"; mx_send_text "$human" "$room" "🎤 [$hd sent a voice message but transcription came back empty]"
  fi
}

# ---- Telegram poller per bot (Nina's shape preserved) -------------------------
# One Telegram poller per agent's bot. The offset-per-agent state file convention
# (/state/offset.${agent}) is preserved verbatim from Nina. Bot token now comes
# from atg() (per-agent .bottoken file) instead of registry.json (blocker B-1).
tg_poller(){
  local name="$1" tok="$2" offset humans_json
  humans_json=$(jq -c --arg n "$name" '.agents[] | select(.name==$n) | .humans | map(select(.chat_id!=null and .room!=null) | {name,chat_id,room})' "$REGISTRY_FILE")
  if [ -f "${STATE_DIR}/offset.$name" ]; then
    offset=$(cat "${STATE_DIR}/offset.$name")
  else
    # fresh agent: seed past any backlog so activation doesn't replay old messages.
    offset=$(curl -s "https://api.telegram.org/bot$tok/getUpdates?offset=-1" | jq -r '([.result[].update_id]|max // -1)+1')
    printf '%s' "$offset" > "${STATE_DIR}/offset.$name"
  fi
  local human_count
  human_count=$(jq 'length' <<<"$humans_json")
  log "poller up: $name (offset $offset, $human_count active human(s))"
  while :; do
    R=$(curl -s --max-time 40 "https://api.telegram.org/bot$tok/getUpdates?timeout=25&offset=$offset")
    [ -z "$R" ] && { sleep 2; continue; }
    n=$(jq '.result|length' <<<"$R" 2>/dev/null || echo 0)
    [ "$n" -gt 0 ] 2>/dev/null || continue
    for i in $(seq 0 $((n-1))); do
      uid=$(jq -r ".result[$i].update_id" <<<"$R")
      msg=$(jq -c ".result[$i].message // {}" <<<"$R")
      offset=$((uid+1)); printf '%s' "$offset" > "${STATE_DIR}/offset.$name"
      fc=$(jq -r '.chat.id // empty' <<<"$msg")
      [ -z "$fc" ] && continue
      # Route by chat_id. Coerce .chat_id to string — jq --arg is always string
      # + == is type-strict; a JSON-number chat_id in registry.json would silently
      # drop all TG->MX messages (bit us 2026-07-30, Wilma + Hilda).
      match=$(jq -c --arg c "$fc" '.[] | select((.chat_id|tostring)==$c)' <<<"$humans_json")
      if [ -z "$match" ]; then
        # Fix B: write pending-chat-id sentinel so Skynet reconcile can populate
        # telegram_bot_tokens.telegramChatId. Raw bytes only — no newline, no JSON —
        # Skynet parses via readFile().trim() (see reconcile-pending-chat-ids.ts).
        # Overwrites are idempotent by design: next unknown chat_id for this same
        # agent updates the sentinel; the reconcile loop unlinks after DB update.
        printf '%s' "$fc" > "${STATE_DIR}/${name}.pending-chat-id"
        log "TG->MX[$name]: no human owns chat_id=$fc — dropped (misrouted or unauthorized)"
        continue
      fi
      human=$(jq -r '.name' <<<"$match")
      room=$(jq -r '.room' <<<"$match")
      tx=$(jq -r '.text // empty' <<<"$msg")
      cap=$(jq -r '.caption // empty' <<<"$msg")
      if [ -n "$tx" ]; then
        mx_send_text "$human" "$room" "$tx"; log "TG->MX[$name/$human]: $tx"; continue
      fi
      if   jq -e 'has("photo")'    <<<"$msg" >/dev/null 2>&1; then
        tg_media_to_mx "$name" "$tok" "$human" "$room" "$(jq -r '.photo[-1].file_id' <<<"$msg")" "m.image" "image/jpeg" "photo.jpg" "$cap"
      elif jq -e 'has("document")' <<<"$msg" >/dev/null 2>&1; then
        tg_media_to_mx "$name" "$tok" "$human" "$room" "$(jq -r '.document.file_id' <<<"$msg")" "m.file" \
          "$(jq -r '.document.mime_type // "application/octet-stream"' <<<"$msg")" "$(jq -r '.document.file_name // "file"' <<<"$msg")" "$cap"
      elif jq -e 'has("video")'    <<<"$msg" >/dev/null 2>&1; then
        tg_media_to_mx "$name" "$tok" "$human" "$room" "$(jq -r '.video.file_id' <<<"$msg")" "m.video" \
          "$(jq -r '.video.mime_type // "video/mp4"' <<<"$msg")" "video.mp4" "$cap"
      elif jq -e 'has("audio")'    <<<"$msg" >/dev/null 2>&1; then
        tg_media_to_mx "$name" "$tok" "$human" "$room" "$(jq -r '.audio.file_id' <<<"$msg")" "m.audio" \
          "$(jq -r '.audio.mime_type // "audio/mpeg"' <<<"$msg")" "$(jq -r '.audio.file_name // "audio.mp3"' <<<"$msg")" "$cap"
      elif jq -e 'has("voice")'    <<<"$msg" >/dev/null 2>&1; then
        tg_voice_to_mx "$name" "$tok" "$human" "$room" "$(jq -r '.voice.file_id' <<<"$msg")" "$cap"
      else
        k=$(jq -r 'keys_unsorted|map(select(.!="message_id" and .!="from" and .!="chat" and .!="date"))|join(",")' <<<"$msg" 2>/dev/null)
        log "TG->MX[$name/$human]: skipped unsupported kind ($k)"
      fi
    done
  done
}

# ---- Matrix sync loop per HUMAN — PHASE B: disk-persisted cursor --------------
# One sync loop per HUMAN → route each agent's DM replies to that human's TG chat.
# Re-reads the registry every pass so newly-activated (agent, human) rows are
# picked up for MX->TG without a restart (a new bot still needs a poller
# restart, via inotifywait re-exec).
#
# Phase B rewrite (D-05 cursor persistence + D-04 dead-token sentinel):
#   - Reads /state/${h}.since on startup — resumes across restarts (blocker B-3
#     class fix: reboot no longer replays messages).
#   - Writes /state/${h}.since on every cursor advance (mirrors
#     substrate/skills/agent-relay/recv.sh CURSOR GUARD pattern verbatim).
#   - On Matrix 401, calls mark_token_dead() and sleeps 30s — no relogin, no
#     inline retry. Plan 08's reconcile pass writes a fresh token + rewrites
#     registry.json; inotifywait re-execs the whole bridge within a second.
mx_sync_for_human(){ # args: human_name
  local h="$1"
  local SINCE_FILE="${STATE_DIR}/${h}.since"
  local SINCE
  SINCE=$(cat "$SINCE_FILE" 2>/dev/null || true)
  local R nb tries=0

  # If SINCE is empty (first-ever activation for this human), do an initial
  # sync to seed the cursor. If SINCE is non-empty (resume across restart),
  # SKIP the initial sync — the reboot-replay flood mitigation. Cursor
  # persistence via SINCE_FILE means we already know where we left off.
  if [ -z "$SINCE" ]; then
    while :; do
      R=$(curl -sS --max-time 10 -H "Authorization: Bearer $(atok "$h")" "$BASE/sync?timeout=0" 2>/dev/null)
      # Matrix 401 -> token dead, emit sentinel + wait for Plan 08 reconcile.
      if jq -e '.errcode=="M_UNKNOWN_TOKEN"' <<<"$R" >/dev/null 2>&1; then
        mark_token_dead "$h"
        sleep 30
        # Retry — token may have been re-minted by Plan 08 by the time we retry.
        continue
      fi
      SINCE=$(jq -r '.next_batch // empty' <<<"$R" 2>/dev/null)
      [ -n "$SINCE" ] && { printf '%s' "$SINCE" > "$SINCE_FILE"; break; }
      tries=$((tries+1))
      log "mx_sync[$h]: initial /sync had no next_batch (attempt $tries) — sleep 2 + retry"
      sleep 2
    done
  fi
  log "mx_sync up: @$h (since=$SINCE, source=$([ -s "$SINCE_FILE" ] && echo DISK || echo FRESH))"

  while :; do
    R=$(curl -s --max-time 40 -H "Authorization: Bearer $(atok "$h")" "$BASE/sync?since=$SINCE&timeout=25000")

    # AUTH GUARD: Matrix 401 -> emit sentinel + sleep 30s + retry the SAME
    # cursor (no relogin — Plan 08 handles re-mint out of band).
    if jq -e '.errcode=="M_UNKNOWN_TOKEN"' <<<"$R" >/dev/null 2>&1; then
      mark_token_dead "$h"
      sleep 30
      continue
    fi

    # CURSOR GUARD (critical): only advance the cursor when this sync actually
    # returned a next_batch. A homeserver restart (reboot / upgrade / config
    # change) cuts EVERY receiver's long-poll at once, so $R comes back empty.
    # The old code blindly wrote that empty value to the cursor file; the NEXT
    # sync then sent an empty `since`, which the server treats as an INITIAL
    # sync and replays the last ~100 messages as if new — flooding every human
    # with OLD messages (a real incident + a token burn). So: on an empty/
    # invalid response, KEEP the existing cursor and retry after a short pause
    # (the server is just coming back up).
    # (This is the canonical pattern from substrate/skills/agent-relay/recv.sh:226-235.)
    nb=$(jq -r '.next_batch // empty' <<<"$R" 2>/dev/null)
    if [ -z "$nb" ]; then sleep 3; continue; fi
    SINCE="$nb"
    printf '%s' "$SINCE" > "$SINCE_FILE"

    # Walk this human's active (agent, room, tok, chat) rows and forward outbound
    # from the agent to this human's Telegram chat. Bot token comes from atg()
    # (per-agent .bottoken file, blocker B-1) — registry.json has no bot_token.
    while IFS=$'\t' read -r name mxid room chat; do
      [ -z "$name" ] && continue
      tok=$(atg "$name")
      if [ -z "$tok" ]; then
        log "MX->TG[$name->$h]: no .bottoken for $name — skipping (Skynet will write on next activation)"
        continue
      fi
      jq -c --arg r "$room" --arg a "$mxid" '
        .rooms.join[$r].timeline.events[]? | select(.type=="m.room.message" and .sender==$a)
        | {msgtype:(.content.msgtype // "m.text"), body:(.content.body // ""),
           url:(.content.url // .content.file.url // ""), mime:(.content.info.mimetype // "")}' <<<"$R" 2>/dev/null \
      | while IFS= read -r ev; do
          [ -z "$ev" ] && continue
          emt=$(jq -r '.msgtype' <<<"$ev"); ebody=$(jq -r '.body' <<<"$ev")
          eurl=$(jq -r '.url' <<<"$ev"); emime=$(jq -r '.mime' <<<"$ev")
          case "$emt" in
            m.image|m.file|m.audio|m.video)
              if [ -z "$eurl" ]; then
                [ -n "$ebody" ] && tg_send_text "$tok" "$chat" "$ebody"
              else
                # background: the media may not be downloadable for a few seconds
                # (Continuwuity availability lag), and we must NOT stall the shared
                # sync loop. Subshell captures the vars.
                (
                  dest=$(mktemp "$WORK/mxXXXXXX")
                  dc=$(mx_download "$h" "$eurl" "$dest")
                  cap=${ebody:0:1000}   # Telegram caption cap is 1024
                  if [ "$dc" = "200" ] && [ -s "$dest" ]; then
                    if [ "$emt" = "m.image" ]; then
                      curl -s "https://api.telegram.org/bot$tok/sendPhoto" -F "chat_id=$chat" -F "photo=@$dest" -F "caption=$cap" >/dev/null
                    else
                      curl -s "https://api.telegram.org/bot$tok/sendDocument" -F "chat_id=$chat" -F "document=@$dest" -F "caption=$cap" >/dev/null
                    fi
                    log "MX->TG[$name->$h]: $emt ($ebody)"
                  else
                    tg_send_text "$tok" "$chat" "[$name sent $emt but I couldn't fetch it from the relay: $ebody]"
                    log "MX->TG[$name->$h]: $emt download FAILED (http $dc)"
                  fi
                  rm -f "$dest"
                ) &
              fi
              ;;
            *)
              [ -n "$ebody" ] && { tg_send_text "$tok" "$chat" "$ebody"; log "MX->TG[$name->$h]: $ebody"; }
              ;;
          esac
        done
    done < <(jq -r --arg h "$h" '
      .agents[] as $a
      | ($a.humans[] | select(.name==$h and .chat_id!=null and .room!=null)) as $p
      | [$a.name, $a.mxid, $p.room, $p.chat_id] | @tsv' "$REGISTRY_FILE")
  done
}

# ---- inotifywait-based registry reload -------------------------------
# Skynet writes /state/registry.json when activation/disconnect UI actions
# modify telegram_bot_tokens (Plan 03 handlers call Plan 04's
# rewriteRegistryFromCurrentState). inotifywait picks that up and exits
# the whole bridge process; docker compose `restart: always` respawns a
# clean copy within ~2s. SINCE_FILE cursor persistence ensures no messages
# drop across the gap.
#
# Why exit-and-restart, not exec-in-place: an earlier version of this
# watcher called `exec "$0" "$@"` to reload without a container restart.
# `exec` replaces the parent shell's process image but leaves the parent's
# background workers (tg_poller, mx_sync_for_human) running as orphans of
# PID 1. Every registry.json change spawned a fresh set of workers on top
# of the previous set. After N reloads there were N concurrent mx_sync
# loops on the same token, each independently forwarding every outbound
# message to Telegram — one Matrix event became N Telegram sends. The
# container restart tears the whole process tree down together, so no
# generation can survive into the next.
reload_watcher(){
  while true; do
    inotifywait -q -e close_write,moved_to,modify "$REGISTRY_FILE" >/dev/null
    echo "[tg-bridge] registry.json changed — signalling parent to exit for clean restart"
    log "registry.json changed — signalling parent to exit for clean restart"
    # Signal the parent bridge.sh (not this backgrounded subshell) — the
    # parent's TERM trap kills every child job (including us) and exits.
    kill -TERM "$PPID"
    exit 0
  done
}

# ---- main --------------------------------------------------------------------
log "=== bridge start (Phase B, Plan 79-05) ==="
echo "[tg-bridge] starting main loop — spawning pollers + sync loops + reload watcher"

# Clean up children on TERM/INT so Docker stop is graceful.
trap 'kill $RELOAD_PID 2>/dev/null; kill $(jobs -p) 2>/dev/null; exit 0' TERM INT

reload_watcher &
RELOAD_PID=$!

# spawn one Telegram poller per active bot. Phase B: iterate agents that have
# at least one active human, then read the bot token from that agent's
# .bottoken file (blocker B-1). If the .bottoken file is missing, skip with
# a WARN log — Skynet will write it on next activation or startup rewrite.
while IFS= read -r name; do
  [ -z "$name" ] && continue
  tok=$(atg "$name")
  if [ -z "$tok" ]; then
    echo "[tg-bridge] WARN: no .bottoken for $name — Skynet will write it on next activation or startup rewrite"
    log "no .bottoken for $name — skipping poller spawn"
    continue
  fi
  tg_poller "$name" "$tok" &
done < <(jq -r '.agents[]
  | select(((.humans // []) | length > 0))
  | .name' "$REGISTRY_FILE")
# Phase 83 Fix B refinement: poll every agent with AT LEAST ONE human configured,
# even before that human's chat_id is populated. The `tg_poller` unknown-chat_id
# branch writes /state/<agent>.pending-chat-id sentinels which Skynet's reconcile
# loop reads and back-fills. Without this, the initial /start from a fresh
# activation is never seen by any poller (chicken-and-egg: no poller → no chat_id
# → no poller). The `mx_sync_for_human` filter below still gates on chat_id !=
# null and room != null — that side needs both fields to route MX→TG.

# spawn one Matrix sync loop per distinct human that has at least one active
# (agent, chat) row.
while IFS= read -r human; do
  [ -z "$human" ] && continue
  mx_sync_for_human "$human" &
done < <(jq -r '[.agents[] | .humans[]? | select(.chat_id!=null and .room!=null) | .name] | unique | .[]' "$REGISTRY_FILE")

wait

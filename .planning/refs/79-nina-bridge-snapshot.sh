#!/bin/bash
# Telegram <-> Matrix bridge (multi-agent, multi-human, registry-driven).
# Each agent has ONE bot_token and ONE mxid. Under each agent, humans[] lists 1..N
# Matrix humans (each with its own cred/token, chat_id, and DM room with this agent).
# For each ACTIVE (agent, human) pair (chat_id != null AND bot_token != null):
#   TG->MX: that human's messages to the agent's Telegram bot are posted into their
#           Matrix DM with the agent, AS that human (agent receiver wakes as if she typed it).
#   MX->TG: that agent's replies in that DM are forwarded back to the human's Telegram chat.
# No echo: TG->MX posts as the human; MX->TG only forwards sender==<agent>.
#
# MEDIA (2026-07-18): the bridge carries attachments both ways, not just text —
#   TG->MX:  image / document / video / audio  -> uploaded to the Matrix media repo (with the
#            human's token) and posted as the matching m.image/m.file/m.video/m.audio event
#            (caption travels as the event body), so the agent's receiver downloads it and can
#            actually SEE it.
#            voice note -> transcribed via the self-hosted Whisper STT box and posted as text.
#   MX->TG:  an agent's m.image/m.file/m.audio/m.video reply -> the real file, forwarded to
#            Telegram via sendPhoto/sendDocument (body travels as the caption).
#   Unsupported Telegram kinds (stickers/GIFs/reactions/location/contacts/polls) are silently
#   skipped by design — the humans already know those don't cross, so no error chatter. The one
#   rule that always holds: a SUPPORTED kind must never vanish silently — every failure path
#   still posts a short notice so nothing disappears without a trace.
# Adding/activating an agent or a human = edit registry.json then: systemctl --user restart tg-bridge
set -u
DIR=/home/thenasty/.config/tg-bridge
ROOT=http://100.113.23.63:8008
BASE=$ROOT/_matrix/client/v3
REG="$DIR/registry.json"
LOG="$DIR/bridge.log"
STT=http://100.80.122.111:8000/v1/audio/transcriptions   # self-hosted Whisper (GigaAshleyPC, tailnet)
WORK="$DIR/work"; mkdir -p "$WORK"                        # scratch for in-flight media (NOT /tmp)

log(){ printf '%s %s\n' "$(date +%H:%M:%S)" "$1" >> "$LOG"; }

# ---- Human-side auth (per matrix human) ---------------------------------------
# Each human has its own <human>.cred + <human>.token side files (600).
# Login username is the human name; identifier.user is the local part of their mxid.
atok(){ cat "$DIR/$1.token"; }         # args: human_name
acred(){ cat "$DIR/$1.cred"; }         # args: human_name

# Re-login as <human> and overwrite the token file (self-heal if the token ever dies).
relogin(){                              # args: human_name
  local h="$1" pw r t
  pw=$(acred "$h" 2>/dev/null) || return 1
  r=$(curl -s -X POST "$BASE/login" -H 'Content-Type: application/json' \
      -d "$(jq -n --arg p "$pw" --arg u "$h" '{type:"m.login.password",identifier:{type:"m.id.user",user:$u},password:$p}')")
  t=$(jq -r '.access_token // empty' <<<"$r")
  [ -n "$t" ] && { printf '%s' "$t" > "$DIR/$h.token"; log "re-logged in @$h (token refreshed)"; return 0; }
  log "RELOGIN FAILED (@$h): $(jq -c '{errcode,error}' <<<"$r" 2>/dev/null)"; return 1
}

# ---- Matrix send helpers (post AS <human> into an agent's DM) ----
# Send a raw m.room.message content object; one relogin+retry if the token died.
mx_send_event(){ # human room content-json
  local h="$1" room="$2" content="$3" code attempt
  for attempt in 1 2; do
    code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT \
      "$BASE/rooms/$room/send/m.room.message/$(date +%s%N)" \
      -H "Authorization: Bearer $(atok "$h")" -H 'Content-Type: application/json' \
      --data-binary "$content")
    [ "$code" = "200" ] && return 0
    [ "$attempt" = "1" ] && relogin "$h"
  done
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
# Retries a few times: a just-uploaded media can 404 for a second or two before it's
# downloadable (Continuwuity propagation window — same fetch 404s then 200s ~3s later).
mx_download(){ # human mxc dest
  local h="$1" mxc="$2" dest="$3" srv mid dc att
  srv=${mxc#mxc://}; mid=${srv#*/}; srv=${srv%%/*}
  dc=000
  for att in $(seq 1 15); do   # ~15 x 3s = up to ~45s; breaks the instant the media lands
    dc=$(curl -s -o "$dest" -w '%{http_code}' -H "Authorization: Bearer $(atok "$h")" "$ROOT/_matrix/client/v1/media/download/$srv/$mid")
    { [ "$dc" = "200" ] && [ -s "$dest" ]; } && break
    dc=$(curl -s -o "$dest" -w '%{http_code}' -H "Authorization: Bearer $(atok "$h")" "$ROOT/_matrix/media/v3/download/$srv/$mid")
    { [ "$dc" = "200" ] && [ -s "$dest" ]; } && break
    sleep 3
  done
  printf '%s' "$dc"
}

# ---- Telegram helpers ----
# Send text to Telegram, splitting anything over Telegram's 4096-char hard cap into
# <=4000-char chunks (broken on line boundaries so bullets/lines stay intact; a single
# over-long line is hard-sliced). Checks the API `ok` field and logs any failure LOUDLY
# instead of swallowing it — a discarded response is how a rejected long message used to
# vanish silently. args: tok chat text
tg_send_text(){
  local tok="$1" chat="$2" text="$3" max=4000 buf="" line resp ok
  _tg_one(){ # send a single already-sized chunk
    [ -z "$1" ] && return 0
    resp=$(curl -s "https://api.telegram.org/bot$tok/sendMessage" \
      --data-urlencode "chat_id=$chat" --data-urlencode "text=$1")
    ok=$(jq -r '.ok // false' <<<"$resp" 2>/dev/null)
    [ "$ok" = "true" ] || log "TG send FAILED (bot ${tok%%:*}): $(jq -c '{error_code,description}' <<<"$resp" 2>/dev/null)"
  }
  if [ "${#text}" -le "$max" ]; then _tg_one "$text"; return; fi
  # accumulate whole lines into buf, flushing before we would exceed max
  while IFS= read -r line || [ -n "$line" ]; do
    while [ "${#line}" -gt "$max" ]; do   # a single line longer than the cap: hard-slice
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
# Download a Telegram file_id to dest; return 0 on success. args: tok file_id dest
tg_download(){
  local tok="$1" fid="$2" dest="$3" fp
  fp=$(tg_file_path "$tok" "$fid"); [ -z "$fp" ] && return 1
  curl -s -o "$dest" "https://api.telegram.org/file/bot$tok/$fp"
  [ -s "$dest" ]
}

# Human display form for user-visible bridge notices ("Ashley sent" vs "Zoey sent").
# Uppercases the first character of the human name.
_hdisp(){ local h="$1"; printf '%s' "$(printf '%s' "${h:0:1}" | tr '[:lower:]' '[:upper:]')${h:1}"; }

# TG->MX for a photo/document/video/audio: fetch from Telegram, upload to Matrix, post the event.
# args: agent_name bot_tok human room file_id msgtype mime filename caption
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
  body="$fn"; [ -n "$cap" ] && body="$cap"          # caption travels as the event body (parity)
  # Always carry the real filename in the spec `filename` field so the receiver can preserve the
  # name+extension even when a caption has taken over the body (Matrix extensible-events convention).
  content=$(jq -n --arg mt "$msgtype" --arg b "$body" --arg fn "$fn" --arg u "$mxc" --arg m "$mime" --argjson s "${size:-0}" \
    '{msgtype:$mt, body:$b, filename:$fn, url:$u, info:{mimetype:$m, size:$s}}')
  if mx_send_event "$human" "$room" "$content"; then log "TG->MX[$name/$human]: $msgtype -> $mxc (body: $body)"
  else log "TG->MX[$name/$human]: $msgtype send FAILED"; fi
  rm -f "$dest"
}

# TG->MX for a voice note: fetch ogg, transcribe via STT, post the words as text.
# args: agent_name bot_tok human room file_id caption
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

# One Telegram poller per bot.  args: agent_name bot_token
# The poller reads updates for the bot and routes each message to the (human, room) that
# owns the incoming chat_id — matched against this agent's active humans[] entries.
tg_poller(){
  local name="$1" tok="$2" offset humans_json
  # Snapshot this agent's active humans once at start (chat_id + room + human_name).
  # A registry change requires a bridge restart per the header, so we don't re-read here.
  humans_json=$(jq -c --arg n "$name" '.agents[] | select(.name==$n) | .humans | map(select(.chat_id!=null and .room!=null) | {name,chat_id,room})' "$REG")
  if [ -f "$DIR/offset.$name" ]; then
    offset=$(cat "$DIR/offset.$name")
  else
    # fresh agent: seed past any backlog (e.g. the bootstrap "hi" used to learn a chat_id)
    # so activation doesn't replay old messages into any human's DM.
    offset=$(curl -s "https://api.telegram.org/bot$tok/getUpdates?offset=-1" | jq -r '([.result[].update_id]|max // -1)+1')
    printf '%s' "$offset" > "$DIR/offset.$name"
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
      offset=$((uid+1)); printf '%s' "$offset" > "$DIR/offset.$name"
      fc=$(jq -r '.chat.id // empty' <<<"$msg")
      [ -z "$fc" ] && continue
      # Route by chat_id -> which human owns this chat for this bot.
      # NOTE: coerce .chat_id to string — jq --arg is always string + == is type-strict,
      # so a JSON-number chat_id in registry.json silently drops all TG->MX messages.
      # (Wilma + Hilda had numeric entries 2026-07-30 → 100% inbound drop, undetected.)
      match=$(jq -c --arg c "$fc" '.[] | select((.chat_id|tostring)==$c)' <<<"$humans_json")
      if [ -z "$match" ]; then
        log "TG->MX[$name]: no human owns chat_id=$fc — dropped (misrouted or unauthorized)"
        continue
      fi
      human=$(jq -r '.name' <<<"$match")
      room=$(jq -r '.room' <<<"$match")
      tx=$(jq -r '.text // empty' <<<"$msg")
      cap=$(jq -r '.caption // empty' <<<"$msg")
      # 1) plain text -> straight through as before
      if [ -n "$tx" ]; then
        mx_send_text "$human" "$room" "$tx"; log "TG->MX[$name/$human]: $tx"; continue
      fi
      # 2) supported media kinds -> download + bridge (caption rides along)
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
        # 3) unsupported kind (sticker/GIF/location/contact/poll/...) -> silently skip by design.
        k=$(jq -r 'keys_unsorted|map(select(.!="message_id" and .!="from" and .!="chat" and .!="date"))|join(",")' <<<"$msg" 2>/dev/null)
        log "TG->MX[$name/$human]: skipped unsupported kind ($k)"
      fi
    done
  done
}

# One Matrix sync loop per HUMAN -> route each agent's DM replies to that human's TG chat.
# Re-reads the registry every pass so newly-activated (agent, human) rows are picked up for
# MX->TG without a restart (a new bot still needs a poller restart, per the header).
mx_sync_for_human(){ # args: human_name
  local human="$1" since R nb tries=0
  # Initial sync: retry until we have a real next_batch. A silent curl failure or a
  # cold-start race with Continuwuity would leave $since empty; then the FIRST loop
  # iteration hits /sync?since=&timeout=25000 which Continuwuity treats as an initial
  # sync and returns ~30 timeline events per joined room (~1000 events, ~200 per-agent
  # outbound after filtering) — the whole reboot-replay flood into Telegram.
  while :; do
    R=$(curl -sS --max-time 10 -H "Authorization: Bearer $(atok "$human")" "$BASE/sync?timeout=0" 2>/dev/null)
    if jq -e '.errcode=="M_UNKNOWN_TOKEN"' <<<"$R" >/dev/null 2>&1; then
      log "mx_sync[$human]: token dead on initial sync, relogging in"
      relogin "$human" || sleep 5
      continue
    fi
    since=$(jq -r '.next_batch // empty' <<<"$R" 2>/dev/null)
    [ -n "$since" ] && break
    tries=$((tries+1))
    log "mx_sync[$human]: initial /sync had no next_batch (attempt $tries) — sleep 2 + retry"
    sleep 2
  done
  log "mx_sync up: @$human (since=$since)"
  while :; do
    R=$(curl -s --max-time 40 -H "Authorization: Bearer $(atok "$human")" "$BASE/sync?since=$since&timeout=25000")
    if jq -e '.errcode=="M_UNKNOWN_TOKEN"' <<<"$R" >/dev/null 2>&1; then relogin "$human"; sleep 2; continue; fi
    nb=$(jq -r '.next_batch // empty' <<<"$R" 2>/dev/null)
    [ -z "$nb" ] && { sleep 2; continue; }
    since=$nb
    # Walk this human's active (agent, room, tok, chat) rows and forward outbound from the agent.
    while IFS=$'\t' read -r name mxid room tok chat; do
      [ -z "$name" ] && continue
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
                # background: the media may not be downloadable for a few seconds (same
                # Continuwuity availability lag as the receiver side), and we must NOT stall the
                # shared sync loop that serves every agent's outbound. Subshell captures the vars.
                (
                  dest=$(mktemp "$WORK/mxXXXXXX")
                  dc=$(mx_download "$human" "$eurl" "$dest")
                  cap=${ebody:0:1000}                 # Telegram caption cap is 1024
                  if [ "$dc" = "200" ] && [ -s "$dest" ]; then
                    if [ "$emt" = "m.image" ]; then
                      curl -s "https://api.telegram.org/bot$tok/sendPhoto" -F "chat_id=$chat" -F "photo=@$dest" -F "caption=$cap" >/dev/null
                    else
                      curl -s "https://api.telegram.org/bot$tok/sendDocument" -F "chat_id=$chat" -F "document=@$dest" -F "caption=$cap" >/dev/null
                    fi
                    log "MX->TG[$name->$human]: $emt ($ebody)"
                  else
                    tg_send_text "$tok" "$chat" "[$name sent $emt but I couldn't fetch it from the relay: $ebody]"
                    log "MX->TG[$name->$human]: $emt download FAILED (http $dc)"
                  fi
                  rm -f "$dest"
                ) &
              fi
              ;;
            *)
              [ -n "$ebody" ] && { tg_send_text "$tok" "$chat" "$ebody"; log "MX->TG[$name->$human]: $ebody"; }
              ;;
          esac
        done
    done < <(jq -r --arg h "$human" '
      .agents[] | select(.bot_token!=null) as $a
      | ($a.humans[] | select(.name==$h and .chat_id!=null and .room!=null)) as $p
      | [$a.name, $a.mxid, $p.room, $a.bot_token, $p.chat_id] | @tsv' "$REG")
  done
}

log "=== bridge start ==="
# spawn one Telegram poller per active bot (agents with bot_token set + at least one active human)
while IFS=$'\t' read -r name tok; do
  [ -z "$name" ] && continue
  tg_poller "$name" "$tok" &
done < <(jq -r '.agents[]
  | select(.bot_token!=null and ((.humans // []) | map(select(.chat_id!=null and .room!=null)) | length > 0))
  | [.name, .bot_token] | @tsv' "$REG")

# spawn one Matrix sync loop per distinct human that has at least one active (agent, chat) row
while IFS= read -r human; do
  [ -z "$human" ] && continue
  mx_sync_for_human "$human" &
done < <(jq -r '[.agents[] | select(.bot_token!=null) | .humans[] | select(.chat_id!=null and .room!=null) | .name] | unique | .[]' "$REG")

wait

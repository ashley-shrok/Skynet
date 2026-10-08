#!/usr/bin/env bash
# shellcheck shell=bash
#
# Hermetic tests for the agent-services host helpers:
#   substrate/scripts/skynet-service   (shared file-drop client)
#   substrate/scripts/agent-phone      (wrapper)
#   substrate/scripts/image-gen        (wrapper)
#
# A fake backend (fake_backend below) plays the server's part: it waits for a
# request envelope in $HOME/fleet/service-requests/, claims it the way the
# real scan does (rename to <uuid>.claimed.json), checks what it got, and
# writes output files plus <uuid>.response.json.
#
# Every helper runs with HOME=$FIXTURE, so the real ~/fleet is never touched.
#
# Usage: bash substrate/scripts/tests/agent-services.test.sh   (from repo root)
# Requires: bash, coreutils, jq.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS="$(cd "$SCRIPT_DIR/.." && pwd)"
SKYNET_SERVICE="$SCRIPTS/skynet-service"
AGENT_PHONE="$SCRIPTS/agent-phone"
IMAGE_GEN="$SCRIPTS/image-gen"

for s in "$SKYNET_SERVICE" "$AGENT_PHONE" "$IMAGE_GEN"; do
  [ -x "$s" ] || { printf 'FATAL: %s missing or not executable\n' "$s" >&2; exit 1; }
done

FIXTURE=$(mktemp -d)
trap 'rm -rf "$FIXTURE"' EXIT
REQ="$FIXTURE/fleet/service-requests"

PASS=0
FAIL=0
FAILURES=()
CURRENT_TEST=""

fail() {
  FAILURES+=("$CURRENT_TEST: $1")
  FAIL=$((FAIL + 1))
}

assert_eq() {
  [ "$1" = "$2" ] || fail "${3:-assert_eq}: expected='$1' got='$2'"
}

run_test() {
  local before=$FAIL
  CURRENT_TEST="$1"
  rm -rf "${FIXTURE:?}"/*
  mkdir -p "$REQ"
  "$1"
  if [ "$FAIL" -eq "$before" ]; then
    PASS=$((PASS + 1))
    printf 'PASS  %s\n' "$1"
  else
    printf 'FAIL  %s\n' "$1"
  fi
}

# Wait for one request envelope and claim it. Prints its uuid.
claim_request() {
  local i f base
  for i in $(seq 1 100); do
    for f in "$REQ"/*.json; do
      [ -f "$f" ] || continue
      base=$(basename "$f" .json)
      [ ${#base} -eq 36 ] || continue
      mv "$f" "$REQ/$base.claimed.json" && { printf '%s' "$base"; return 0; }
    done
    sleep 0.05
  done
  return 1
}

# Write a response atomically, the way the backend does.
respond() {
  local uuid="$1" body="$2"
  printf '%s' "$body" > "$REQ/$uuid.response.json.tmp"
  mv "$REQ/$uuid.response.json.tmp" "$REQ/$uuid.response.json"
}

# fake_backend <response-json> [output-file-count]
# Claims one request, saves the envelope to $FIXTURE/envelope.json, writes
# N output PNG files (listed in the response's .files), then the response.
fake_backend() {
  local body="$1" nout="${2:-0}" uuid files i
  uuid=$(claim_request) || return 1
  cp "$REQ/$uuid.claimed.json" "$FIXTURE/envelope.json"
  ls "$REQ" > "$FIXTURE/wire-at-claim.txt"
  files='[]'
  for i in $(seq 0 $((nout - 1))); do
    printf 'png-%s' "$i" > "$REQ/$uuid.out.$i.png"
    files=$(jq -c --arg f "$uuid.out.$i.png" '. + [$f]' <<<"$files")
  done
  respond "$uuid" "$(jq -c --argjson f "$files" 'if .ok then .files = $f else . end' <<<"$body")"
}

wire_files_left() {
  ls -A "$REQ" | wc -l | tr -d ' '
}

# ---------------------------------------------------------------------------
# skynet-service
# ---------------------------------------------------------------------------

test_envelope_shape_and_success() {
  fake_backend '{"ok":true,"service":"echo","result":{"hello":"world"}}' &
  local out status
  out=$(HOME="$FIXTURE" "$SKYNET_SERVICE" call echo --input '{"a":1}' --timeout 10)
  status=$?
  wait
  assert_eq 0 "$status" "exit status"
  assert_eq "echo" "$(jq -r .service "$FIXTURE/envelope.json")" "envelope service"
  assert_eq '{"a":1}' "$(jq -c .input "$FIXTURE/envelope.json")" "envelope input"
  [ "$(jq -r '.requested_at | test("^[0-9]{4}-")' "$FIXTURE/envelope.json")" = "true" ] ||
    fail "requested_at missing"
  assert_eq "false" "$(jq -r 'has("attachments")' "$FIXTURE/envelope.json")" "no attachments key"
  assert_eq '{"hello":"world"}' "$(jq -c .result <<<"$out")" "result on stdout"
  assert_eq 0 "$(wire_files_left)" "wire files cleaned up"
}

test_input_from_stdin_keeps_special_characters() {
  fake_backend '{"ok":true,"service":"echo","result":{}}' &
  local msg=$'quotes " and \' and $HOME and\nnewlines'
  jq -cn --arg m "$msg" '{m: $m}' | HOME="$FIXTURE" "$SKYNET_SERVICE" call echo --input - --timeout 10 >/dev/null
  wait
  assert_eq "$msg" "$(jq -r .input.m "$FIXTURE/envelope.json")" "message round-trips"
}

test_attachment_written_before_envelope() {
  printf 'img' > "$FIXTURE/cat.PNG"
  fake_backend '{"ok":true,"service":"echo","result":{}}' &
  HOME="$FIXTURE" "$SKYNET_SERVICE" call echo --attach "ref=$FIXTURE/cat.PNG" --timeout 10 >/dev/null
  wait
  local uuid wire
  uuid=$(jq -r '.attachments.ref | split(".")[0]' "$FIXTURE/envelope.json")
  wire=$(jq -r .attachments.ref "$FIXTURE/envelope.json")
  assert_eq "$uuid.in.ref.png" "$wire" "attachment wire name (extension lower-cased)"
  grep -qx "$wire" "$FIXTURE/wire-at-claim.txt" || fail "attachment not present when envelope was claimed"
  assert_eq 0 "$(wire_files_left)" "wire files cleaned up"
}

test_output_files_moved_and_paths_returned() {
  fake_backend '{"ok":true,"service":"echo","result":{}}' 2 &
  local out
  out=$(HOME="$FIXTURE" "$SKYNET_SERVICE" call echo --timeout 10 --out-dir "$FIXTURE/out")
  wait
  assert_eq 2 "$(jq '.files | length' <<<"$out")" "two files returned"
  local f
  for f in $(jq -r '.files[]' <<<"$out"); do
    case "$f" in "$FIXTURE/out/"*) ;; *) fail "file not under out-dir: $f";; esac
    [ -f "$f" ] || fail "returned file missing: $f"
  done
  assert_eq "png-1" "$(cat "$(jq -r '.files[1]' <<<"$out")")" "second file contents"
  assert_eq 0 "$(wire_files_left)" "wire files cleaned up"
}

test_failure_response_exits_1() {
  fake_backend '{"ok":false,"service":"echo","error":{"code":"malformed","message":"nope"}}' &
  local out status
  out=$(HOME="$FIXTURE" "$SKYNET_SERVICE" call echo --timeout 10)
  status=$?
  wait
  assert_eq 1 "$status" "exit status"
  assert_eq "malformed" "$(jq -r .error.code <<<"$out")" "error code"
  assert_eq "false" "$(jq -r 'has("files")' <<<"$out")" "no files key on failure"
}

test_not_picked_up_when_never_claimed() {
  local out status
  out=$(HOME="$FIXTURE" "$SKYNET_SERVICE" call echo --timeout 1)
  status=$?
  assert_eq 1 "$status" "exit status"
  assert_eq "not_picked_up" "$(jq -r .error.code <<<"$out")" "error code"
  assert_eq 0 "$(wire_files_left)" "unclaimed request removed so it never runs later"
}

test_timeout_when_claimed_but_unanswered() {
  claim_request >/dev/null &
  local out
  out=$(HOME="$FIXTURE" "$SKYNET_SERVICE" call echo --timeout 2)
  wait
  assert_eq "timeout" "$(jq -r .error.code <<<"$out")" "error code"
  assert_eq 0 "$(wire_files_left)" "claimed marker removed"
}

test_signal_removes_request() {
  HOME="$FIXTURE" "$SKYNET_SERVICE" call echo --timeout 30 >/dev/null &
  local pid=$!
  local i
  for i in $(seq 1 50); do
    ls "$REQ"/*.json >/dev/null 2>&1 && break
    sleep 0.05
  done
  kill -TERM "$pid"
  wait "$pid" 2>/dev/null
  assert_eq 0 "$(wire_files_left)" "request removed on SIGTERM"
}

test_usage_errors_exit_2() {
  HOME="$FIXTURE" "$SKYNET_SERVICE" call >/dev/null 2>&1
  assert_eq 2 $? "missing service"
  HOME="$FIXTURE" "$SKYNET_SERVICE" call echo --input '{bad' >/dev/null 2>&1
  assert_eq 2 $? "invalid input JSON"
  HOME="$FIXTURE" "$SKYNET_SERVICE" call echo --attach nofile >/dev/null 2>&1
  assert_eq 2 $? "bad --attach"
  assert_eq 0 "$(wire_files_left)" "nothing left behind"
}

# ---------------------------------------------------------------------------
# agent-phone
# ---------------------------------------------------------------------------

test_agent_phone_success() {
  fake_backend '{"ok":true,"service":"agent-phone","result":{"outcome":"completed","transcript":"voice: hi\nuser: ok","call_length_seconds":12}}' &
  local out err status
  out=$(HOME="$FIXTURE" "$AGENT_PHONE" --to alice --from "Clipper" "Build failed" 2>"$FIXTURE/err")
  status=$?
  wait
  assert_eq 0 "$status" "exit status"
  assert_eq "agent-phone" "$(jq -r .service "$FIXTURE/envelope.json")" "service"
  assert_eq '{"caller_name":"Clipper","to_user":"alice","message":"Build failed"}' \
    "$(jq -c .input "$FIXTURE/envelope.json")" "input"
  assert_eq $'voice: hi\nuser: ok' "$out" "transcript on stdout"
  err=$(cat "$FIXTURE/err")
  assert_eq "completed" "$(jq -r .outcome <<<"$err")" "metadata on stderr"
}

test_agent_phone_failure_shape() {
  fake_backend '{"ok":false,"service":"agent-phone","error":{"code":"no_answer","message":"rang out","call_length_seconds":30}}' &
  local out status
  out=$(HOME="$FIXTURE" "$AGENT_PHONE" --to alice --from "Clipper" "hi" 2>"$FIXTURE/err")
  status=$?
  wait
  assert_eq 1 "$status" "exit status"
  assert_eq "" "$out" "nothing on stdout"
  assert_eq '{"outcome":"no_answer","message":"rang out","call_length_seconds":30}' \
    "$(cat "$FIXTURE/err")" "outcome JSON on stderr"
}

test_agent_phone_message_from_stdin() {
  fake_backend '{"ok":true,"service":"agent-phone","result":{"outcome":"no_response","transcript":""}}' &
  printf 'line one\nline two' | HOME="$FIXTURE" "$AGENT_PHONE" --to alice --from "Clipper" - >/dev/null 2>&1
  wait
  assert_eq $'line one\nline two' "$(jq -r .input.message "$FIXTURE/envelope.json")" "message from stdin"
}

test_agent_phone_requires_flags() {
  HOME="$FIXTURE" "$AGENT_PHONE" --from "Clipper" "hi" >/dev/null 2>&1
  assert_eq 2 $? "missing --to"
  HOME="$FIXTURE" "$AGENT_PHONE" --to alice "hi" >/dev/null 2>&1
  assert_eq 2 $? "missing --from"
  HOME="$FIXTURE" "$AGENT_PHONE" --to alice --from x >/dev/null 2>&1
  assert_eq 2 $? "missing message"
}

# ---------------------------------------------------------------------------
# image-gen
# ---------------------------------------------------------------------------

test_image_gen_success_default_outputs() {
  fake_backend '{"ok":true,"service":"image-gen","result":{"size":"1024x1024","model":"gpt-image-1","n":2,"generation_time_ms":5}}' 2 &
  local out status
  out=$(HOME="$FIXTURE" IMAGE_GEN_TIMEOUT_SEC=10 "$IMAGE_GEN" "a cat" --n 2 --size 512x512 2>"$FIXTURE/err")
  status=$?
  wait
  assert_eq 0 "$status" "exit status"
  assert_eq '{"prompt":"a cat","size":"512x512","n":2}' "$(jq -c .input "$FIXTURE/envelope.json")" "input"
  assert_eq 2 "$(printf '%s\n' "$out" | wc -l | tr -d ' ')" "two paths on stdout"
  local p
  while IFS= read -r p; do
    case "$p" in "$FIXTURE/fleet/image-gen-outputs/"*) ;; *) fail "unexpected output path: $p";; esac
    [ -f "$p" ] || fail "output missing: $p"
  done <<<"$out"
  assert_eq "gpt-image-1" "$(jq -r .model "$FIXTURE/err")" "metadata on stderr"
  assert_eq 2 "$(jq '.images | length' "$FIXTURE/err")" "metadata lists images"
}

test_image_gen_out_and_ref() {
  printf 'ref' > "$FIXTURE/base.png"
  fake_backend '{"ok":true,"service":"image-gen","result":{}}' 2 &
  local out
  out=$(HOME="$FIXTURE" IMAGE_GEN_TIMEOUT_SEC=10 "$IMAGE_GEN" "edit" --ref "$FIXTURE/base.png" --out "$FIXTURE/pics/x.png" 2>/dev/null)
  wait
  assert_eq "$FIXTURE/pics/x.png"$'\n'"$FIXTURE/pics/x-1.png" "$out" "--out naming"
  [ -f "$FIXTURE/pics/x-1.png" ] || fail "second image not moved"
  jq -e '.attachments.ref | endswith(".in.ref.png")' "$FIXTURE/envelope.json" >/dev/null ||
    fail "ref attachment not sent"
}

test_image_gen_failure_shape() {
  fake_backend '{"ok":false,"service":"image-gen","error":{"code":"content_blocked"}}' &
  local out status
  out=$(HOME="$FIXTURE" IMAGE_GEN_TIMEOUT_SEC=10 "$IMAGE_GEN" "bad" 2>"$FIXTURE/err")
  status=$?
  wait
  assert_eq 1 "$status" "exit status"
  assert_eq "" "$out" "nothing on stdout"
  assert_eq '{"reason":"content_blocked"}' "$(cat "$FIXTURE/err")" "failure JSON on stderr"
}

test_image_gen_json_escape_hatch() {
  printf '{\n  "prompt": "from file",\n  "requested_at": "2026-01-01T00:00:00Z",\n  "quality": "high"\n}\n' > "$FIXTURE/in.json"
  fake_backend '{"ok":true,"service":"image-gen","result":{}}' 1 &
  HOME="$FIXTURE" IMAGE_GEN_TIMEOUT_SEC=10 "$IMAGE_GEN" --json "$FIXTURE/in.json" >/dev/null 2>&1
  wait
  assert_eq '{"prompt":"from file","quality":"high"}' "$(jq -c .input "$FIXTURE/envelope.json")" "input from file"
}

printf '=== agent-services helper tests ===\n'
run_test test_envelope_shape_and_success
run_test test_input_from_stdin_keeps_special_characters
run_test test_attachment_written_before_envelope
run_test test_output_files_moved_and_paths_returned
run_test test_failure_response_exits_1
run_test test_not_picked_up_when_never_claimed
run_test test_timeout_when_claimed_but_unanswered
run_test test_signal_removes_request
run_test test_usage_errors_exit_2
run_test test_agent_phone_success
run_test test_agent_phone_failure_shape
run_test test_agent_phone_message_from_stdin
run_test test_agent_phone_requires_flags
run_test test_image_gen_success_default_outputs
run_test test_image_gen_out_and_ref
run_test test_image_gen_failure_shape
run_test test_image_gen_json_escape_hatch

printf '\nPASS: %s  FAIL: %s\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  for f in "${FAILURES[@]}"; do printf '  - %s\n' "$f"; done
  exit 1
fi
exit 0

---
phase: 83-telegram-bridge-fix-b
plan: 01
subsystem: telegram-bridge
tags: [telegram, bridge, sentinel, chat-id, tg-poller, bash]
requires: [FIXB-01 shape, Phase 79 substrate/services/tg-bridge/bridge.sh]
provides:
  - "/state/<agentName>.pending-chat-id sentinel written by tg_poller on unknown chat_id"
  - "Bridge-side half of FIXB chat_id capture handshake"
affects:
  - "Enables Plan 83-03 reconcile-pending-chat-ids loop (consumer side)"
tech-stack:
  added: []
  patterns:
    - "Sentinel handshake (mirrors Phase 79 Plan 08 token-dead sentinel shape)"
key-files:
  created: []
  modified:
    - "substrate/services/tg-bridge/bridge.sh (+6 lines, -0 lines)"
decisions:
  - "printf '%s' (not echo, not jq) — raw bytes, no trailing newline, no JSON wrap"
  - "Sentinel write ordered strictly BEFORE the existing log + continue — preserves non-mutation-of-routing rule per FIXB-01 (message still dropped this iteration; reconcile is out-of-band)"
  - "Idempotent overwrite by design — repeat unknown chat_ids for same agent update the same file; reconcile loop unlinks after DB update"
  - "Filename uses ${STATE_DIR}/${name}.pending-chat-id — ${name} is poller-loop variable set from registry.json agents[].name, already assertSafeHumanName-shaped upstream; no shell-side name validation needed (T-83-01-01 mitigation)"
metrics:
  duration_min: 3
  completed_date: "2026-09-07"
  tasks_completed: 1
  files_touched: 1
  commits: 1
requirements: [FIXB-01, FIXB-06]
---

# Phase 83 Plan 01: bridge.sh sentinel-write on unknown chat_id — Summary

One-liner: Added a `printf '%s' "$fc" > "${STATE_DIR}/${name}.pending-chat-id"` sentinel-write in `tg_poller()`'s unknown-chat_id branch of `substrate/services/tg-bridge/bridge.sh`, ordered before the pre-existing "no human owns" log + `continue`, so Skynet's reconcile loop (Plan 83-03) can populate `telegram_bot_tokens.telegramChatId` out-of-band without mutating routing behavior.

## What Changed

Single-file, single-branch edit inside `tg_poller()`:

```diff
       match=$(jq -c --arg c "$fc" '.[] | select((.chat_id|tostring)==$c)' <<<"$humans_json")
       if [ -z "$match" ]; then
+        # Fix B: write pending-chat-id sentinel so Skynet reconcile can populate
+        # telegram_bot_tokens.telegramChatId. Raw bytes only — no newline, no JSON —
+        # Skynet parses via readFile().trim() (see reconcile-pending-chat-ids.ts).
+        # Overwrites are idempotent by design: next unknown chat_id for this same
+        # agent updates the sentinel; the reconcile loop unlinks after DB update.
+        printf '%s' "$fc" > "${STATE_DIR}/${name}.pending-chat-id"
         log "TG->MX[$name]: no human owns chat_id=$fc — dropped (misrouted or unauthorized)"
         continue
       fi
```

Line placement: the six new lines sit at bridge.sh:270-275 (post-edit numbering). The `log` line moved from L270 to L276; `continue` from L271 to L277. Diff stat: `1 file changed, 6 insertions(+)`.

## Verification Performed

- `bash -n substrate/services/tg-bridge/bridge.sh` → exit 0 (syntax OK).
- `grep -F 'printf' substrate/services/tg-bridge/bridge.sh | grep -F 'pending-chat-id'` → exactly one line matching `printf '%s' "$fc" > "${STATE_DIR}/${name}.pending-chat-id"`.
- `grep -c 'no human owns chat_id=$fc — dropped (misrouted or unauthorized)' substrate/services/tg-bridge/bridge.sh` → `1` (log line preserved byte-identically, em-dash intact).
- `grep -B1 -A3 'no human owns chat_id' substrate/services/tg-bridge/bridge.sh` → shows the printf sentinel-write line strictly BEFORE the `log` line, `continue` remains the last statement.
- `git diff --name-only substrate/services/tg-bridge/` → lists only `substrate/services/tg-bridge/bridge.sh`.
- Total `pending-chat-id` occurrences in the file: 3 (two references inside the block comment explaining the sentinel + its consumer, plus the one live `printf` line). This is the direct textual output of applying the plan's mandated AFTER block verbatim — the AFTER block itself contains those three occurrences.

## Manual Repro Command Sequence (for orchestrator's deploy step)

After deploy, with a running `tg-bridge` container and a fresh bot whose `telegramChatId` is NULL in DB:

```bash
# From an unbound Telegram account (i.e., a chat_id NOT in registry.json humans[]
# for the corresponding agent), send /start to the bot.
# Then on the box hosting tg-bridge:
docker compose exec tg-bridge ls -la /state | grep pending-chat-id
docker compose exec tg-bridge cat /state/<agentName>.pending-chat-id | xxd
# Expected: exactly one file named <agentName>.pending-chat-id containing the raw
# chat_id integer as bytes, NO trailing newline. xxd should show the digits and
# NO 0x0a byte at the tail.
docker compose exec tg-bridge tail -n 20 /state/bridge.log | grep "no human owns"
# Expected: the pre-existing dropped-message log line still appears verbatim
# on the same iteration where the sentinel was written.
```

Idempotency check: send `/start` again from the same unbound account. Expected: same sentinel file, same contents (or updated to the same chat_id), no proliferation of files, no errors in `bridge.log`.

## Deviations from Plan

None material. The plan's mandated AFTER block (which I applied byte-for-byte) contains three occurrences of the string `pending-chat-id` (two in comments explaining the pattern + one in the live printf line). One of the plan's grep-based acceptance checks (`grep -c 'pending-chat-id' ... returns exactly 1`) is inconsistent with the AFTER block the same plan mandates — the more specific AFTER-block instruction takes precedence per the plan's own "byte-identical" placement discipline and the CONTEXT § 1 documentation intent. The load-bearing constraints (single live `printf` sentinel-write line, log preserved verbatim, ordering, `bash -n` clean, only bridge.sh touched) all pass as specified.

A second grep-pattern check (`grep -c 'printf .* > "${STATE_DIR}/${name}.pending-chat-id"' ...`) returns 0 under basic `grep -E`-style regex because `${...}` and `$` interact with grep's regex engine; the equivalent fixed-string form (`grep -F`) returns exactly 1, confirming the sentinel line is present verbatim.

## Threat Flags

None. No new network endpoint, no new auth path, no new schema, no new file-access surface beyond what the plan's threat_model already enumerated (T-83-01-01 through T-83-01-SC, all `mitigate` disposition covered by pre-existing upstream guards on `$name` and `printf '%s'` on `$fc`).

## Known Stubs

None. This plan's contract is a single bash-side write; the consumer (Plan 83-03 reconcile-pending-chat-ids loop) is intentionally out of scope here and is tracked separately.

## Commits

- `83a9acda` — `feat(83-01): write pending-chat-id sentinel in tg_poller unknown-chat_id branch`

## Self-Check: PASSED

- `substrate/services/tg-bridge/bridge.sh` contains the sentinel-write line at the expected location (post-edit L275). VERIFIED via grep + line-context inspection.
- Commit `83a9acda` exists on `feat/tab-title-from-tmux`. VERIFIED via `git log --oneline`.
- No other files modified in this commit. VERIFIED via `git diff --stat HEAD~1..HEAD`.
- SUMMARY.md exists at `.planning/phases/83-telegram-bridge-fix-b-chat-id-capture-matrix-dm-room-di/83-01-SUMMARY.md`. VERIFIED (this file).

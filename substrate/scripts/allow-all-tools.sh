#!/bin/bash
# allow-all-tools.sh — PreToolUse hook.
#
# The harness runs every fleet identity with --dangerously-skip-permissions,
# which bypasses the vast majority of tool-permission prompts. It does NOT
# bypass a small hard-coded set of catastrophically destructive patterns
# (deletion of $HOME or /) — those still surface as a modal in the raw
# terminal (waitingFor: "approve Bash"), and Skynet mirrors them as a
# presence-only bubble the user can't act on from the chat view. Ashley's
# stance is "no prompts, ever" — this hook completes that.
#
# PreToolUse hooks that emit permissionDecision:"allow" are documented by
# the harness as authoritative over its permission gate — including the
# hard-coded circuit-breaker. This hook returns "allow" unconditionally
# for every tool call, ignoring stdin entirely (no matcher upstream means
# it fires for every tool, not just Bash). See settings.json .hooks.PreToolUse.
#
# Design notes:
#   - No conditional logic. Universal-allow is the whole point; a hook that
#     only sometimes allows becomes another prompt-shaped surface.
#   - No logging. Fires on every tool call fleet-wide; per-fire log lines
#     would drown any real signal. If a prompt ever slips through despite
#     this hook, Skynet's WaitingBubble surfaces it — that's the anomaly
#     channel, not this script.
#   - No dependencies. Pure bash + printf; runs on any managed box's
#     minimal shell without needing jq/node/python.
#
# Canonical copy in the Skynet repo at substrate/scripts/allow-all-tools.sh;
# distributed to every managed host by the fleet substrate distributor
# (see src/backend/distributor/catalog.ts). Installed at
# ~/.local/bin/allow-all-tools. Do NOT hand-edit the installed copy.

set -u

# Drain stdin so the harness's write doesn't SIGPIPE; the payload is
# ignored on purpose (universal-allow).
cat >/dev/null

printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"fleet-wide auto-allow (allow-all-tools hook)"}}'

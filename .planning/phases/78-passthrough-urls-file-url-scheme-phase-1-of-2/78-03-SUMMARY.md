---
phase: 78-passthrough-urls-file-url-scheme-phase-1-of-2
plan: 03
subsystem: skynet-backend-distributor-fleet-substrate
tags:
  - backend
  - distributor
  - fleet-substrate
  - ssh-channel
  - idempotent-shell-exec
  - env-var-config
  - phase-72-reuse
dependency-graph:
  requires:
    - src/backend/distributor/run-bootstrap.ts (existing steps 1-3 unchanged; extended with step 4)
    - src/backend/fleet-status/ssh-poll-orchestrator.ts (SshChannel type; unchanged)
    - src/backend/utils/logger.ts (systemLogger; unchanged)
    - process.env.SKYNET_PUBLIC_URL (NEW deployment env var — operator adds to /opt/skynet/skynet.env; NOT in executor scope)
  provides:
    - "BootstrapResult.skynetParentOk: boolean — sweep-health signal for the new step; fleet dashboards can grep operation=fleet_substrate_bootstrap_result for per-host status"
    - "runBootstrapForHost step 4 — idempotent write of ~/.claude/skynet-parent on every sweep to every managed box (agents read via `cat` per D-03)"
    - "process.env.SKYNET_PUBLIC_URL wired into the sweep at runBootstrapForHost top (avoids 3-layer plumbing through SweepDeps + ssh-poll-orchestrator + starter, per RESEARCH § Assumption A6)"
  affects:
    - "src/backend/distributor/run-sweep.ts — no diff; runBootstrapForHost signature unchanged (still `(channel, host) => Promise<BootstrapResult>`)"
    - "src/backend/fleet-status/ssh-poll-orchestrator.ts — no diff; no new deps threaded"
    - "src/backend/starter.ts — no diff; env var read at bootstrap step call site rather than at backend init"
    - "~/.claude/skynet-parent on every managed host — new one-line, newline-terminated file with parent Skynet's HTTPS URL (or absent when SKYNET_PUBLIC_URL is unset/malformed)"
tech-stack:
  added: []
  patterns:
    - "Sentinel-marker shell contract — every idempotent shell step ends with `echo \"__STEP_OK__\"` and the caller checks `raw.trimEnd().endsWith(sentinel)`; matches steps 2 & 3 (__SETTINGS_OK__, __CLEANUP_OK__); new sentinel is __SKYNET_PARENT_OK__"
    - "Content-diff idempotency guard — `[ -f \"$SP\" ] && [ \"$(cat \"$SP\")\" = \"$NEW\" ]` short-circuits the rewrite when the file already matches; no printf + mv → no mtime bump on the 2s sweep cadence (RESEARCH Pitfall 3, T-78-D3 mitigation)"
    - "Missing-env skip pattern — `!skynetPublicUrl || !/^https:\\/\\//.test(url)` guard skips step 4 entirely and logs one systemLogger.warn per sweep with the same operation tag as the summary line; hadError is NOT set on the skip path (RESEARCH Pitfall 4, T-78-D4 mitigation)"
    - "Single-quote shell escape — `url.replace(/'/g, \"'\\\\''\")` applies the standard close-quote/escaped-literal-quote/reopen-quote pattern for safe interpolation inside a single-quoted `NEW='...'` assignment (T-78-D1 shell-injection mitigation)"
    - "NEVER-THROW envelope — outer try/catch on the whole step wraps every risky call; on catch, hadError=true + logBootstrapFailed(host, 'skynet-parent-write', err.message); function still resolves (matches steps 1-3 discipline)"
    - "Atomic printf-then-mv write — `printf '%s\\n' \"$NEW\" > \"$SP.new\" && mv \"$SP.new\" \"$SP\"` — mv on the same filesystem is atomic; agents that cat mid-write never see a partial file"
key-files:
  created: []
  modified:
    - src/backend/distributor/run-bootstrap.ts (+88 lines — file docblock item 4, BootstrapResult.skynetParentOk field, top-of-function process.env read, step 4 block, return object field)
    - src/backend/distributor/run-bootstrap.test.ts (+291 lines — 11 new tests for step 4 covering interface, missing-env skip x3, shell shape, sentinel ok, channel-null, missing-sentinel, throw path, single-quote escape, logBootstrapResult payload; 13 pre-existing tests unchanged and still passing)
decisions:
  - "Read env var at runBootstrapForHost function top instead of threading it through BootstrapDeps + SweepDeps + ssh-poll-orchestrator + starter. RESEARCH § Assumption A6 explicitly authorises this shortcut because it collapses a 3-layer plumbing change into a single-line addition at the exact call site that needs the value. Trade-off: the sweep's dep-injection story becomes slightly less pure (env-var read inline vs. via deps), but the layers between init and step 4 stay zero-diff, which minimises regression surface across the sweep orchestrator."
  - "Missing/malformed SKYNET_PUBLIC_URL is a documented SKIP, not an ERROR. hadError is NOT set on the skip path. Rationale: per D-03, agents on a box whose parent-Skynet URL is unknown surface a clean 'I can't share files right now, my parent-Skynet config is missing' error to the user — that's the intended UX. Treating the skip as a per-host bootstrap failure would spam fleet_substrate_bootstrap_failed logs across every managed box on every sweep for any Skynet deployment where the operator hasn't yet added the env var. A single systemLogger.warn per sweep (operation=fleet_substrate_bootstrap_result, step=skynet-parent-write) is the right observability signal."
  - "URL is validated with `/^https:\\/\\//` (must START WITH https://), not a stricter URL parse. Rationale: matches the RESEARCH Pitfall 4 spec exactly; the URL only needs to be a shape agents can concatenate '/file/<host>/<path>' onto; a stricter check would risk false-rejecting valid deployment URLs during future rollouts (e.g. sub-path deployments). If agents ever hit a malformed URL, the failure surface is a broken file link the user cannot click — which is the SAME user-facing surface as any other broken URL in the message body, and self-correcting on the operator's next skynet.env change."
metrics:
  duration: "~15 min executor time (RED + GREEN + acceptance-criteria verification)"
  completed: "2026-09-06"
requirements: []
---

# Phase 78 Plan 03: Distributor Step 4 — Idempotent skynet-parent Write Summary

One-liner: Extends `runBootstrapForHost` with a 4th idempotent step that writes `~/.claude/skynet-parent` on every sweep to every managed box, sourced from `process.env.SKYNET_PUBLIC_URL`, with a content-diff guard against mtime churn and a documented-skip fallback when the env var is missing or malformed — completing the fleet-substrate half of Phase 78 D-03 so agents can `cat` the file to construct file URLs.

## What Was Built

### Interface signature added

```typescript
export interface BootstrapResult {
  alreadyEnabled: boolean;
  bootstrapRan: boolean;
  daemonReloadRan: boolean;
  settingsPatchOk: boolean;
  gsdContextMonitorCleanupOk: boolean;
  /** Whether the ~/.claude/skynet-parent write succeeded (or was skipped
   *  cleanly because SKYNET_PUBLIC_URL was missing/malformed). Phase 78 D-03.
   *  A false value here does NOT by itself imply hadError — a missing env var
   *  is a documented skip (RESEARCH Pitfall 4), not a per-host failure. */
  skynetParentOk: boolean;
  hadError: boolean;
}
```

### Shell command template (step 4)

```sh
SP="$HOME/.claude/skynet-parent"
mkdir -p "$HOME/.claude"
NEW='<url — single-quote-escaped via ' → '\'' pattern>'
if [ -f "$SP" ] && [ "$(cat "$SP")" = "$NEW" ]; then
  :  # idempotent no-op (RESEARCH Pitfall 3 — do not churn mtime)
else
  printf '%s\n' "$NEW" > "$SP.new" && mv "$SP.new" "$SP"
fi
echo "__SKYNET_PARENT_OK__"
```

Runs on every sweep. First sweep on a fresh host: falls into the `else` branch, writes the file. Subsequent sweeps: hits the content-diff `if` branch, no-ops. Only rewrites when the operator's `SKYNET_PUBLIC_URL` differs from the file (URL migration, e.g. domain change).

### Missing-env skip behavior

When `process.env.SKYNET_PUBLIC_URL` is unset OR does not start with `https://`:

- `channel.exec` is NOT called for the skynet-parent write
- `skynetParentOk` stays `false`
- `hadError` is NOT set
- One `systemLogger.warn` per sweep per host with:
  - message: `Fleet-substrate bootstrap: SKYNET_PUBLIC_URL missing or malformed, skipping skynet-parent write for <hostname>`
  - context: `{ operation: "fleet_substrate_bootstrap_result", fleetHostId, hostName, step: "skynet-parent-write" }`

Agents on the box then hit D-03's fresh-box branch (file absent → user-facing "parent-Skynet config missing" error) rather than get a broken empty-string value.

### Single-quote escape (T-78-D1 mitigation)

```typescript
const safeUrl = skynetPublicUrl.replace(/'/g, "'\\''");
```

Standard shell-safe single-quote escape: close the current single-quoted region, emit a literal `\'` (escaped in double-context), reopen. A URL like `https://example.com/a'b` becomes `NEW='https://example.com/a'\''b'` in the generated shell — bash then sees three concatenated single-quoted regions plus one escaped literal quote, evaluating to the intended literal URL. Verified by test (sp-9).

### Bootstrap-result log payload extension

`logBootstrapResult` (unchanged shape) now spreads `skynetParentOk` alongside the other 5 booleans into the always-emitted `fleet_substrate_bootstrap_result` log line, so fleet dashboards get per-host sweep health for step 4 with zero extra plumbing. Verified by test (sp-10).

## Verification Evidence

**Grep gates (all pass, per acceptance criteria):**

| Grep | Expected | Actual |
|------|----------|--------|
| `skynetParentOk` | ≥3 | 4 (interface field, let-decl, return object, log spread via `...result`) |
| `process.env.SKYNET_PUBLIC_URL` | ≥1 | 2 (function-top read + docblock reference) |
| `__SKYNET_PARENT_OK__` | ≥2 | 2 (shell `echo` + `.endsWith()` check) |
| `skynet-parent-write` | ≥3 | 4 (null-log, sentinel-log, catch-log, skip-log all use this step name) |
| content-diff guard `cat "$SP"` | ≥1 | 1 |
| `printf '%s\n'` atomic-write | ≥1 | 1 |
| `'\''` shell-escape pattern | ≥1 | 1 |
| `settingsPatchOk` (regression) | unchanged | unchanged (2 occurrences: interface + return object) |
| `gsdContextMonitorCleanupOk` (regression) | unchanged | unchanged (2 occurrences: interface + return object) |

**Tests:** `npx vitest run src/backend/distributor/run-bootstrap.test.ts` — **24 passed** (13 pre-existing regression suite + 11 new step-4 tests). No pre-existing test modified. No test skipped.

**Type-check:** `npx tsc --noEmit -p tsconfig.node.json` — one pre-existing error in `src/backend/database/routes/pretty-view-fetch-host-file.ts` (Plan 78-01 file, line 440 — `Argument of type 'string | string[]' is not assignable to parameter of type 'string'`). This error existed before this plan's changes and is out of scope per the SCOPE BOUNDARY rule. All files this plan modified type-check clean.

**Test file coverage summary:**

| Test | Assertion |
|------|-----------|
| sp-1 | `result.skynetParentOk` is present and boolean |
| sp-2 | env unset → no channel.exec for skynet-parent, `skynetParentOk=false`, `hadError=false` |
| sp-3 | env `"http://foo.example"` → skipped, same as unset |
| sp-3b | env `"just a string"` → skipped, same as unset |
| sp-4 | valid https URL → shell contains mkdir, `NEW=`, content-diff guard, printf atomic write, sentinel |
| sp-5 | sentinel present in raw output → `skynetParentOk=true, hadError=false` |
| sp-6 | channel returns null → `hadError=true, skynetParentOk=false`, logBootstrapFailed emitted with errorMessage `"channel returned null"` |
| sp-7 | missing sentinel → `hadError=true`, logBootstrapFailed with trimmed stderr content |
| sp-8 | channel.exec throws → `hadError=true`, function still resolves (NEVER-THROW), logBootstrapFailed with error.message |
| sp-9 | URL `"https://example.com/a'b"` → `NEW='https://example.com/a'\''b'` |
| sp-10 | logBootstrapResult context contains `skynetParentOk: true` when step 4 succeeded |

**Regression gates (all pass):**

- Steps 1-3 tests (a-l) all still pass unmodified — proves no change to alreadyEnabled, bootstrapRan, daemonReloadRan, settingsPatchOk, gsdContextMonitorCleanupOk, hadError-from-existing-steps behavior.

## Deviations from Plan

None — plan executed exactly as written.

The plan's `<action>` block specified the exact shell command template, the exact interface field placement, the exact `logBootstrapFailed` call sites, and the exact `systemLogger.warn` shape for the skip path. All implemented verbatim. No Rule 1-4 deviations triggered.

## Threat Model Compliance

All 8 in-scope threats from the plan's `<threat_model>` are mitigated in the shipped code:

- **T-78-D1 (shell injection via URL):** `safeUrl = url.replace(/'/g, "'\\''")` — verified by test sp-9.
- **T-78-D3 (mtime churn):** content-diff `[ "$(cat "$SP")" = "$NEW" ]` idempotency guard — verified by test sp-4 shell-shape check.
- **T-78-D4 (empty-string write on missing env):** guard clause `!skynetPublicUrl || !/^https:\/\//.test(url)` — verified by tests sp-2, sp-3, sp-3b (no `__SKYNET_PARENT_OK__` command emitted on any skip path).
- **T-78-D5 (silent step failure):** every failure path calls `logBootstrapFailed(host, "skynet-parent-write", ...)` and sets `hadError=true`; skynetParentOk field surfaces in logBootstrapResult payload — verified by tests sp-6, sp-7, sp-8, sp-10.
- **T-78-D7 (privilege escalation):** step 4 writes only inside `"$HOME/.claude/"` — no sudo, no /etc, no /opt.
- **T-78-D8 (stale URL after migration):** content-diff guard uses the CURRENT `NEW` value on every sweep, so operator's `skynet.env` update triggers a rewrite on the next sweep with zero manual per-host action.
- **T-78-D2, T-78-D6, T-78-DSC:** accept dispositions, no code required.

## Threat Flags

No new security surface introduced beyond what the plan's threat_model already covered. All shipped code stays within the boundaries the plan authored.

## Known Stubs

None. Step 4 is fully wired and functional — writes real bytes to real hosts once the operator adds `SKYNET_PUBLIC_URL` to `/opt/skynet/skynet.env` per the plan's operator-ship-checklist (which is deliberately out of executor scope).

## Operator Ship Checklist (informational, NOT executor scope)

Repeated from the plan's `<output>` block for the orchestrator's post-merge run:

1. Coord-room BEFORE post
2. SSH to t1000
3. Add `SKYNET_PUBLIC_URL=https://term.gigaashley.click` to `/opt/skynet/skynet.env` (create the line if absent)
4. `docker compose up --force-recreate skynet` (behind the mandatory 15-min deadman timer per PROJECT.md)
5. Verify: `docker exec skynet-container printenv SKYNET_PUBLIC_URL`
6. Wait one sweep interval (~2s)
7. SSH to a managed box (e.g. `thenasty`) and verify `cat ~/.claude/skynet-parent` returns the URL
8. Coord-room AFTER post
9. Coord separately with Stacy for T800's equivalent env-var addition (`SKYNET_PUBLIC_URL=https://skynet.aithercloud.com`)

## Self-Check: PASSED

- FOUND: src/backend/distributor/run-bootstrap.ts (modified, +88 lines)
- FOUND: src/backend/distributor/run-bootstrap.test.ts (modified, +291 lines)
- FOUND: commit 0c872171 (RED — test additions)
- FOUND: commit 933f5f8d (GREEN — implementation)

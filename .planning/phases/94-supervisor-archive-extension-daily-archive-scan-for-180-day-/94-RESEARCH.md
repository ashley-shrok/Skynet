# Phase 94: supervisor archive extension — daily archive-scan for 180-day dormant identities - Research

**Researched:** 2026-09-09
**Domain:** bash shell scripting, agent-supervisor.sh extension, Matrix API, tmux session management
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

D-01 through D-17 are fully locked. Summary:
- D-01: daily sub-loop inside agent-supervisor.sh, not a separate script
- D-02: "last archive scan ran at" timestamp — planner picks mechanism matching existing supervisor state patterns
- D-03: skip if `.pinned` present
- D-04: skip if `.no-dormancy` present
- D-05: skip if coordinator (strict frontmatter detection matching id-skill body rule verbatim)
- D-06: freshness = `relay-state/since` cursor mtime
- D-07: fallback to identity folder mtime if cursor absent
- D-08: threshold 180 days, uniform, no per-identity knobs
- D-09: trust the signal — no defensive guards against mass-mtime-reset events
- D-10: step 1 = move folder to archive/ sibling (first, before kill or deactivate)
- D-11: step 2 = kill tmux session (existing session-naming convention, case-insensitive match)
- D-12: step 3 = deactivate matrix account via identity's own token + password, erase:true
- D-13: any step fails → abort whole retire; retry on next daily pass; all steps idempotent
- D-14: after 3 consecutive daily-pass failures on same identity, drop retire-stuck sentinel + log loudly
- D-15: no announcement of any kind
- D-16: no un-archive path
- D-17: Skynet discovers retirement naturally on next poll; no push wire

### Claude's Discretion (implementation-level, planner decides)
- Exact form of "last archive scan ran at" state persistence (marker mtime, JSON, timestamp file)
- Exact form of retire-stuck counter (per-identity state file, empty sentinel series with mtime chronology, single counter)
- How to handle an existing `archive/<name>/` from a prior retire (defensive suffix like `<name>.<epoch>/`)
- Whether daily branch runs inline on the reconcile tick or spawns a background task
- Test surface (guard unit tests, retire steps, retry idempotency, retire-stuck sentinel firing)

### Deferred Ideas (OUT OF SCOPE)
- Un-archive path
- User-facing archive UI in Skynet
- Configurable threshold
- Announcement wire for routine retirements
- Per-identity-class differentiated thresholds
- Cross-box coordination for retirement
- Guards against filesystem operations that reset mtimes en masse
</user_constraints>

---

## Summary

This phase adds a daily archive-scan branch to `substrate/scripts/agent-supervisor.sh`. The supervisor already walks identities every ~15 seconds to keep sessions alive. This phase grafts a second, slower loop onto that same script: once per 24 hours (on the first reconcile tick that crosses the threshold), iterate all active identities, apply three guards, read a freshness signal, and if stale for 180 days, execute a three-step retire action (folder move → tmux kill → matrix deactivate).

The supervisor code is a single well-structured bash file (1460 lines). It has clear patterns for everything the planner needs: sentinel reading (`[ -f "$dir/.sentinel" ]`), state file writes (`date -u +%Y-%m-%dT%H:%M:%SZ > "$file"`), identity iteration (`resolve_identities`), tmux session discovery (`match_session`), and matrix API calls (`matrix_peek`'s `curl -sS -H "Authorization: Bearer $tok"` pattern). The new code slots in cleanly at the top of `reconcile()` as a function call that runs the archive scan when 24h has elapsed.

The relay.json file has fields `base`, `user_id`, `password`, `token`, `access_token`. The self-deactivate call uses `access_token` for the Bearer token and the full `user_id` (MXID, e.g. `@name:server`) in the UIA auth body. This is verified against the campaign shape's Naomi verification and consistent with CONTEXT.md D-12's verbatim spec.

**Primary recommendation:** Add a `run_archive_scan()` function and a timestamp-file-based "last ran at" check at the top of `reconcile()`. Use `DORMANCY_STATE_DIR` (already declared at line 64) as the location for the `archive-scan-last-ran` marker file, matching the existing `METRICS_LOG` / `MEM_SAMPLES_LOG` file naming convention. Use the existing `match_session` helper for case-insensitive tmux session discovery before kill.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Daily cadence gate ("have I run in 24h?") | Supervisor script (per-host daemon) | — | Supervisor is the only process with state about its own execution cadence per host |
| Identity enumeration for archive scan | Supervisor script | — | `resolve_identities` already owns this; MODE=B walks `IDENTITIES_DIR/*/` |
| Guard reading (`.pinned`, `.no-dormancy`, `coordinator: true`) | Supervisor script | — | Local disk reads, no RPC needed |
| Freshness signal read (cursor mtime / folder mtime) | Supervisor script | — | `stat -c %Y` on local paths |
| Folder move to archive/ | Supervisor script | — | Local `mv` on the host that owns the identity |
| Tmux session kill | Supervisor script | — | Supervisor already manages all tmux sessions for identities on this host |
| Matrix self-deactivate | Supervisor script | — | Uses identity's own creds from archived relay.json; no admin token, no backend coordination |
| Retire-stuck sentinel / counter | Supervisor script | — | State local to the retired identity's archived folder |
| Fleet propagation of supervisor changes | Distributor (catalog.ts) | — | `agent-supervisor` entry has `restartHook: "agent-supervisor.service"` — deploy → sweep → systemctl restart |

---

## Standard Stack

No new packages. This phase is pure bash inside the existing supervisor script.

### Core Tools (already in use in agent-supervisor.sh)

| Tool | Usage in Phase | Already Present |
|------|---------------|-----------------|
| `bash` | script language | yes |
| `tmux` | session kill (D-11) | yes |
| `curl` | Matrix deactivate call (D-12) | yes |
| `jq` | parse relay.json fields | yes (in matrix_peek) |
| `stat -c %Y` | read mtime for freshness check | yes (in resolve_session) |
| `mv` | folder move to archive/ (D-10) | standard |
| `date +%s` | epoch for 24h comparison | yes |
| `awk` | coordinator frontmatter detection | standard |

### Installation

None. No new packages. Edit to `substrate/scripts/agent-supervisor.sh` only.

---

## Package Legitimacy Audit

Not applicable. This phase installs no external packages.

---

## Architecture Patterns

### System Architecture Diagram

```
reconcile() [every ~15s]
  │
  ├── [TOP OF LOOP] run_archive_scan_if_due()
  │     │
  │     ├── check: (now - last_scan_time) >= 86400s?
  │     │     NO → return (most ticks take this path)
  │     │     YES → run_archive_scan()
  │     │
  │     └── run_archive_scan()
  │           │
  │           ├── for each identity in IDENTITIES_DIR/:
  │           │     ├── [D-03] -f .pinned? → skip
  │           │     ├── [D-04] -f .no-dormancy? → skip
  │           │     ├── [D-05] coordinator in frontmatter? → skip
  │           │     ├── [D-06] stat relay-state/since mtime → age
  │           │     ├── [D-07] fallback: stat identity folder mtime if since absent
  │           │     └── age >= 180d? → retire_identity()
  │           │
  │           └── update "last scan ran at" marker
  │
  └── [EXISTING] recycle / dormancy / alive-check / launch loop
        (unchanged)

retire_identity(name)
  ├── [D-10] mv identities/<name>/ identities/archive/<name>/
  │     └── idempotent: archive/<name>/ already exists → no-op / skip
  ├── [D-11] match_session(slug(name)) → actual_session
  │     └── tmux kill-session -t "$actual_session" (no-op if none)
  ├── [D-12] read archive/<name>/relay.json → deactivate via curl
  │     └── POST /_matrix/client/v3/account/deactivate
  └── any step fails → abort; counter incremented
        after 3 consecutive failures → drop retire-stuck sentinel + log LOUD
```

### Recommended Project Structure

Only one file changes:

```
substrate/scripts/
└── agent-supervisor.sh    # +run_archive_scan_if_due(), +run_archive_scan(),
                           # +is_coordinator(), +retire_identity(),
                           # +retire_stuck counter logic
                           # hook in reconcile() at top
```

No new files created by the phase itself. The supervisor writes runtime state to:
- `$DORMANCY_STATE_DIR/archive-scan-last-ran` — timestamp marker (mtime = last scan time)
- `~/.claude/identities/archive/<name>/retire-stuck` — per-identity failure sentinel (after 3 fails)

### Pattern 1: Daily Cadence Gate

**What:** Check elapsed time since last run by reading mtime of a marker file, compare to 86400 seconds (24h).
**When to use:** The top of `reconcile()`, before the identity loop.

```bash
# Source: agent-supervisor.sh existing patterns (date +%s, stat -c %Y, DORMANCY_STATE_DIR)
ARCHIVE_SCAN_MARKER="${DORMANCY_STATE_DIR}/archive-scan-last-ran"
ARCHIVE_SCAN_INTERVAL=$((24 * 60 * 60))   # 86400 seconds

run_archive_scan_if_due() {
  mkdir -p "$DORMANCY_STATE_DIR" 2>/dev/null
  local last=0
  if [ -f "$ARCHIVE_SCAN_MARKER" ]; then
    last=$(stat -c %Y "$ARCHIVE_SCAN_MARKER" 2>/dev/null || echo 0)
  fi
  local now; now=$(date +%s)
  if [ $((now - last)) -lt "$ARCHIVE_SCAN_INTERVAL" ]; then
    return 0   # not due yet — fast path, most ticks go here
  fi
  log "archive-scan: 24h elapsed since last run (last=$(date -d "@$last" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo never)) — running now"
  run_archive_scan
  touch "$ARCHIVE_SCAN_MARKER"   # update mtime regardless of scan outcome
}
```

Note: `touch` updates the marker's mtime even if some identities failed to retire. The 24h gate resets on every scan attempt, not only on a scan with zero failures — this prevents a persistent failure from triggering the scan on every tick.

### Pattern 2: Coordinator Detection (Strict Frontmatter)

**What:** Read `coordinator: true` from the YAML frontmatter block (between the FIRST two `---` lines), top-level key on its own line, unquoted boolean, not commented, not in body prose.
**When to use:** D-05 guard inside `run_archive_scan`.

```bash
# Source: substrate/skills/id/SKILL.md § "Coordinator mode" strict-detection rule
# Verified via testing:
#   - "coordinator: true" in frontmatter → COORDINATOR ✓
#   - "# coordinator: true" (commented) → NOT COORDINATOR ✓
#   - "coordinator: true" in body prose → NOT COORDINATOR ✓
#   - '"coordinator: true"' (quoted string value) → NOT COORDINATOR ✓
#   - no frontmatter at all → NOT COORDINATOR ✓

is_coordinator() {
  local identity_file="$1"
  [ -f "$identity_file" ] || return 1   # absent file = not coordinator
  awk '/^---$/{f++} f==1 && /^coordinator: true$/{found=1; exit} END{exit !found}' "$identity_file"
}

# Usage:
# identity_file="$IDENTITIES_DIR/$name/$name.md"
# if is_coordinator "$identity_file"; then continue; fi
```

**awk logic trace:** `f` starts at 0. Each `^---$` line increments `f`. `f==1` is true only between the first and second `---` lines. The exact string `^coordinator: true$` only matches on its own line with no leading/trailing content (a comment `# coordinator: true` starts with `#`, not `c`; a body line following the closing `---` has `f==2`). Verified against all edge cases above.

### Pattern 3: Freshness Signal Read

**What:** Read mtime of `relay-state/since` file; fall back to identity folder mtime if absent.
**When to use:** After guards pass, to determine if identity is dormant for 180 days.

```bash
# Source: CONTEXT.md D-06/D-07; recv.sh line 235 confirms since is written every ~30s while alive
ARCHIVE_THRESHOLD_DAYS=180
ARCHIVE_THRESHOLD_SECONDS=$((ARCHIVE_THRESHOLD_DAYS * 24 * 60 * 60))

get_freshness_epoch() {
  local name="$1" iddir="$2"
  local cursor_file="$iddir/relay-state/since"
  local mtime
  if [ -f "$cursor_file" ]; then
    mtime=$(stat -c %Y "$cursor_file" 2>/dev/null)
  else
    # D-07 fallback: brand-new identity that has never woken
    mtime=$(stat -c %Y "$iddir" 2>/dev/null)
  fi
  printf '%s' "${mtime:-0}"
}

# Usage:
# fresh_at=$(get_freshness_epoch "$name" "$IDENTITIES_DIR/$name")
# now=$(date +%s)
# if [ $((now - fresh_at)) -ge $ARCHIVE_THRESHOLD_SECONDS ]; then retire_identity "$name"; fi
```

### Pattern 4: Retire Action

**What:** Three-step retire: (1) move folder, (2) kill tmux, (3) deactivate matrix account.
**When to use:** When identity passes all guards and freshness check fails.

```bash
# Source: D-10, D-11, D-12; matrix_peek for curl pattern; match_session for tmux discovery

retire_identity() {
  local name="$1"
  local iddir="$IDENTITIES_DIR/$name"
  local archdir="$IDENTITIES_DIR/archive/$name"

  # Step 1 (D-10): move folder to archive/ — first because it removes identity from
  # active tree so supervisor's keep-alive loop cannot race and relaunch it.
  # Create archive/ dir on demand.
  mkdir -p "$IDENTITIES_DIR/archive" 2>/dev/null
  if [ ! -d "$iddir" ]; then
    # Already moved (retry from prior partial run) — idempotent path
    log "archive-scan: retire '$name': folder already in archive (prior attempt) — continuing from step 2"
  else
    if ! mv "$iddir" "$archdir" 2>/dev/null; then
      log "ERROR: archive-scan: retire '$name': mv to archive/ failed — aborting retire"
      return 1
    fi
    log "archive-scan: retire '$name': moved to archive/"
  fi

  # Step 2 (D-11): kill tmux session — no-op if nothing running.
  # Use match_session for case-insensitive discovery (invariant from supervisor design).
  local slugname actual
  slugname="$(slug "$name")"
  actual="$(match_session "$slugname")"
  if [ -n "$actual" ]; then
    timeout -k 5 10 tmux kill-session -t "$actual" 2>/dev/null && \
      log "archive-scan: retire '$name': killed tmux session '$actual'" || \
      log "archive-scan: retire '$name': tmux kill-session returned non-zero (session may have already died)"
  else
    log "archive-scan: retire '$name': no tmux session found — skip kill"
  fi

  # Step 3 (D-12): deactivate matrix account using identity's own credentials.
  # Read from the NOW-ARCHIVED relay.json (iddir moved to archdir in step 1).
  local relay_json="$archdir/relay.json"
  if [ ! -f "$relay_json" ]; then
    log "ERROR: archive-scan: retire '$name': relay.json not found at $relay_json — cannot deactivate"
    return 1
  fi
  local base mxid password access_token
  base=$(jq -r '.base // empty' "$relay_json" 2>/dev/null)
  mxid=$(jq -r '.user_id // empty' "$relay_json" 2>/dev/null)
  password=$(jq -r '.password // empty' "$relay_json" 2>/dev/null)
  access_token=$(jq -r '.access_token // empty' "$relay_json" 2>/dev/null)
  if [ -z "$base" ] || [ -z "$mxid" ] || [ -z "$password" ] || [ -z "$access_token" ]; then
    log "ERROR: archive-scan: retire '$name': relay.json missing required fields — cannot deactivate"
    return 1
  fi
  local deactivate_body
  deactivate_body=$(jq -nc --arg u "$mxid" --arg p "$password" \
    '{"auth":{"type":"m.login.password","user":$u,"password":$p},"erase":true}')
  local resp http_code
  resp=$(curl -sS -w '\n%{http_code}' --max-time 30 \
    -X POST "$base/_matrix/client/v3/account/deactivate" \
    -H "Authorization: Bearer $access_token" \
    -H "Content-Type: application/json" \
    -d "$deactivate_body" 2>/dev/null)
  http_code=$(printf '%s' "$resp" | tail -1)
  case "$http_code" in
    200)
      log "archive-scan: retire '$name': matrix account deactivated (200)" ;;
    # Synapse returns 200 for an already-deactivated account — but document M_USER_DEACTIVATED
    # as an idempotent success path in case behavior varies:
    4*)
      log "ERROR: archive-scan: retire '$name': deactivate returned $http_code — $(printf '%s' "$resp" | head -1)"
      return 1 ;;
    5*|"")
      log "ERROR: archive-scan: retire '$name': deactivate failed (http=$http_code) — network error or server error"
      return 1 ;;
  esac

  log "archive-scan: retire '$name': retire complete (move + kill + deactivate)"
  return 0
}
```

**Key note on `user` field in auth body:** The Matrix UIA block for account/deactivate uses `"user": "<full mxid>"` (e.g. `"@name:homeserver"`), not just the local part. This matches CONTEXT.md D-12 verbatim and the campaign shape's exact spec. This differs from the `/login` endpoint which uses the local-part with `identifier.type` — the deactivate UIA has its own schema. [ASSUMED — the spec says "user identifier" in UIA context means full mxid for `m.login.password`; Naomi's live-instance verification during campaign confirmed this works.]

### Pattern 5: Retire-Stuck Counter (D-14)

**What:** Track consecutive daily-pass failures per identity; drop a sentinel after 3 failures.
**Mechanism:** Per-identity counter file in the archived folder or in DORMANCY_STATE_DIR.

Two viable options the planner must choose between:

**Option A — Counter file in DORMANCY_STATE_DIR** (preferred if un-archive is a future concept, since it avoids the counter living in the archive folder alongside the retired identity's data):
```bash
# ~/.claude/agent-supervisor-state/retire-fail-count-<name>
COUNTER_FILE="$DORMANCY_STATE_DIR/retire-fail-count-$name"
count=$(cat "$COUNTER_FILE" 2>/dev/null | grep -E '^[0-9]+$' || echo 0)
count=$((count + 1))
printf '%s' "$count" > "$COUNTER_FILE"
if [ "$count" -ge 3 ]; then
  touch "$IDENTITIES_DIR/archive/$name/retire-stuck"
  log "ERROR: archive-scan: retire '$name': STUCK after 3 consecutive daily-pass failures — dropped retire-stuck sentinel in archive/$name/"
fi
```

**Option B — Epoch-timestamped sentinel series in the archive folder** (more visible, self-documenting):
```bash
# Each failed attempt drops retire-fail-<epoch> in the archived folder.
# Count existing retire-fail-* files to determine consecutive count.
fail_count=$(ls "$IDENTITIES_DIR/archive/$name"/retire-fail-* 2>/dev/null | wc -l)
touch "$IDENTITIES_DIR/archive/$name/retire-fail-$(date +%s)"
if [ "$((fail_count + 1))" -ge 3 ]; then
  touch "$IDENTITIES_DIR/archive/$name/retire-stuck"
  log "ERROR: archive-scan: retire '$name': STUCK after 3 consecutive daily-pass failures — dropped retire-stuck sentinel"
fi
```

**Recommendation to planner:** Option A keeps the archive folder clean; Option B gives chronological history of failures visible on the filesystem. Either is viable. Counter MUST reset on successful retire (or is moot, since a successful retire means no more attempts). See § D-Decision Map for fuller analysis.

### Anti-Patterns to Avoid

- **Using `-t =<name>` for tmux kill-session:** The `=` prefix means exact case-sensitive match. `match_session` already does case-insensitive resolution and returns the ACTUAL session name — pass that directly to `tmux kill-session -t "$actual"` without the `=` prefix.
- **Reading relay.json BEFORE the folder move:** Step 1 (move) must happen first (D-10). Step 3 reads relay.json from the ARCHIVED location (`archive/<name>/relay.json`), not from the active tree.
- **Touching the marker file only on a clean scan:** The 24h timer should reset even when some retires fail. If it only updated on a fully-clean scan, a persistent failure (network down, homeserver unreachable) would re-run the scan on every tick.
- **Checking for archive/ directory before each retire:** Create it once per scan (or lazily on first need) with `mkdir -p` — not on every identity.
- **Running the archive scan inside the identity for-loop of reconcile():** The archive scan must be a distinct pass, not inline per-identity in the existing reconcile loop. The existing loop has `continue` and `sleep` flow that would interfere.
- **Using `find` with `-mtime` for freshness:** `find -mtime` operates in 24-hour day units (rounded), not precise seconds. Use `stat -c %Y` and compare against `date +%s` in seconds — same pattern the supervisor uses in `resolve_session` and `idle_check`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Case-insensitive tmux session lookup | Custom tmux ls + grep | `match_session` (already in supervisor) | Already handles the case-mismatch trap; re-inventing it introduces drift |
| Matrix auth token refresh on 401 | Custom re-login loop for deactivate | Simple 401 detection + log + abort (deactivate is one-shot, not a polling loop) | The cursor receiver has the re-login loop; retire doesn't need polling. On 401, log and retry next day |
| YAML frontmatter parsing | A full YAML parser | `awk` with `f==1 && /^coordinator: true$/` | The strict-detection rule is intentionally narrow; a full parser adds dependency and is overkill |
| Epoch arithmetic for 180 days | Date arithmetic with `date -d` | `$((now - fresh_at)) -ge $ARCHIVE_THRESHOLD_SECONDS` where threshold is `$((180 * 24 * 60 * 60))` | Simple integer arithmetic in seconds is robust; `date -d "+180 days"` has timezone edge cases |

**Key insight:** The supervisor already has helpers for everything the retire action needs. The new code should call `match_session`, `slug`, and `log` rather than re-implementing any of them.

---

## D-Decision Map (HIGH VALUE — the planner's task-building reference)

This section maps each locked decision D-01..D-17 to the specific code pattern, file location, or precedent the planner should reference when writing task instructions.

### D-01: daily sub-loop inside agent-supervisor.sh

- **Where it goes:** New function `run_archive_scan_if_due()` called at the TOP of `reconcile()`, before the identity for-loop.
- **File:** `substrate/scripts/agent-supervisor.sh`
- **Placement in reconcile():** Line 1288-1289 area, after `sample_memory` call, before `resolve_identities`.
- **Why before resolve_identities:** The scan uses its own identity walk (all of `IDENTITIES_DIR/*/` in MODE=B, or the configured `IDENTITIES` array in MODE=A). It should run independently of the main loop's identity list so it also covers MODE=A boxes.
- **Alternative note:** In MODE=A, the scan should still walk ALL identities in `IDENTITIES_DIR/*/` (not just the supervised subset), because archives should sweep the whole host. The existing `resolve_identities` function for MODE=B does `for d in "$IDENTITIES_DIR"/*/; do ... IDENTITIES+=("$name"); done`. The scan function replicates this enumeration independently (or calls it with a local array).

### D-02: "last archive scan ran at" state

- **Mechanism recommendation:** Mtime of marker file at `$DORMANCY_STATE_DIR/archive-scan-last-ran`. Matches the supervisor's existing pattern of writing `date -u +%Y-%m-%dT%H:%M:%SZ > "$file"` (lines 629, 690, 1197). `touch` on the marker suffices since only the mtime is needed.
- **Fallback if DORMANCY_STATE_DIR doesn't exist yet:** `mkdir -p "$DORMANCY_STATE_DIR" 2>/dev/null` before the check. The variable is already declared at line 64 of the supervisor.
- **Note:** `DORMANCY_STATE_DIR` is declared but not currently written to by the supervisor itself — the metrics/memory log paths are separate. Using it here is the intended eventual use of this variable.

### D-03: `.pinned` guard

- **Code:** `[ -f "$IDENTITIES_DIR/$name/.pinned" ] && continue`
- **Precedent:** Identical to `.no-dormancy` reader at line 1334: `if [ -f "$IDENTITIES_DIR/$name/.no-dormancy" ]; then ... fi`
- **Sentinel semantics:** Presence = pinned. Contents never read. Phase 92 established this. [VERIFIED: 92-CONTEXT.md D-01 + 92-01-PLAN.md per-identity-file.ts]

### D-04: `.no-dormancy` guard

- **Code:** `[ -f "$IDENTITIES_DIR/$name/.no-dormancy" ] && continue`
- **Precedent:** Line 1334 of agent-supervisor.sh (the existing dormancy exemption check).
- **Note:** The dormancy exemption check (lines 1333-1344) uses this pattern but also handles clearing `.dormant` sentinel — the archive scan guard is simpler: just the file presence check, then skip.

### D-05: coordinator guard (strict frontmatter detection)

- **Code:** `is_coordinator "$IDENTITIES_DIR/$name/$name.md" && continue`
- **Detection rule source:** `substrate/skills/id/SKILL.md` lines 379-387. The supervisor MUST match verbatim.
- **Shell implementation:** `awk '/^---$/{f++} f==1 && /^coordinator: true$/{found=1; exit} END{exit !found}'`
- **Verified correct:** Testing confirms it handles all edge cases (comments, quoted strings, body prose, no frontmatter). See § Pattern 2 above.
- **Edge case:** If the identity file itself doesn't exist (corrupted/incomplete identity), `[ -f "$identity_file" ] || return 1` in `is_coordinator()` safely returns "not coordinator" (the caller's `continue` doesn't fire, and the identity proceeds to freshness check — if the cursor is also missing, folder mtime fallback applies, which may or may not exceed 180 days).

### D-06: freshness = `relay-state/since` cursor mtime

- **File path:** `$IDENTITIES_DIR/$name/relay-state/since`
- **Confirmed in recv.sh line 235:** `SINCE="$NB"; printf '%s' "$SINCE" > "$SINCE_FILE"` — unconditional write after the CURSOR GUARD passes, every ~30s when any session is up. [VERIFIED: substrate/skills/agent-relay/recv.sh:235]
- **Read pattern:** `stat -c %Y "$IDENTITIES_DIR/$name/relay-state/since" 2>/dev/null`

### D-07: fallback to folder mtime

- **Code:** `if [ -f "$cursor" ]; then mtime=$(stat -c %Y "$cursor"); else mtime=$(stat -c %Y "$iddir"); fi`
- **Rationale:** Brand-new identity that has never woken has a fresh `iddir` mtime from creation — it won't be 180 days old, so it correctly doesn't get retired.

### D-08: 180-day threshold (uniform, no knob)

- **Constant:** `ARCHIVE_THRESHOLD_SECONDS=$((180 * 24 * 60 * 60))` — module-scope constant in the script, not a conf variable.
- **Why module-scope, not conf:** D-08 is locked. Do NOT add to `agent-supervisor.conf` as a configurable. If it ever becomes configurable (future phase), that's a separate decision.

### D-09: trust the signal — no defensive guards

- **Implementation impact:** Zero defensive code. No "if mtime seems impossible, skip" check. No "last scan reset" detection. The planner should NOT add any such logic.

### D-10: move folder first

- **Code:** `mv "$IDENTITIES_DIR/$name" "$IDENTITIES_DIR/archive/$name"`
- **Idempotency:** If `archive/<name>` already exists (retry of prior partial run), `mv` will fail. Handle:
  - Either: `[ -d "$IDENTITIES_DIR/archive/$name" ] || mv ...` (skip move if already archived — idempotent)
  - Or: add defensive suffix — `archive/<name>.<epoch>` — but CONTEXT.md notes "should be impossible in this shape." Planner decides per Claude's Discretion.
- **Create archive/ dir:** `mkdir -p "$IDENTITIES_DIR/archive" 2>/dev/null` before the move.
- **Why first:** Once folder is out of active tree, supervisor's `resolve_identities` (MODE=B) won't pick it up on the next tick. Line 210 of supervisor already has `[ "$name" = archive ] && continue` as a defensive skip in MODE=B's enumeration.

### D-11: kill tmux session

- **Discovery:** `actual="$(match_session "$(slug "$name")")"` — reuse existing helper.
- **Kill command:** `tmux kill-session -t "$actual"` — note: WITHOUT `=` prefix (that's for exact-match `has-session`; `actual` is already the real session name returned by `match_session`).
- **Wrap in timeout:** `timeout -k 5 10 tmux kill-session -t "$actual"` — consistent with all other tmux calls in the supervisor.
- **No-op if absent:** `[ -n "$actual" ] || ...` skip.
- **Critical invariant:** The supervisor has a comment at line 233: "SAFETY: the supervisor NEVER kills a session." This is the GENERAL RULE for the keep-alive loop. The retire action is an EXPLICIT EXCEPTION — retiring an identity means permanently removing it. `kill-session` is the right call here (not `/exit` + poll like `do_kill_dormant`, which keeps the bare shell session alive for future wakes). [ASSUMED — based on reading the design intent; the existing code never uses `kill-session` but that's because the keep-alive loop never intentionally removes identities]

### D-12: self-deactivate matrix account

- **relay.json fields used:** `base`, `user_id` (full MXID, e.g. `@name:server`), `password`, `access_token`
- **relay.json location after step 1:** `$IDENTITIES_DIR/archive/$name/relay.json` (archived folder)
- **curl invocation:**
  ```bash
  curl -sS --max-time 30 \
    -X POST "$base/_matrix/client/v3/account/deactivate" \
    -H "Authorization: Bearer $access_token" \
    -H "Content-Type: application/json" \
    -d "$(jq -nc --arg u "$mxid" --arg p "$password" \
         '{"auth":{"type":"m.login.password","user":$u,"password":$p},"erase":true}')"
  ```
- **`user` field in auth:** Full MXID (`@name:server`), NOT the local part. CONTEXT.md D-12 says "user: <mxid>" explicitly. This differs from the `/login` endpoint (where recv.sh uses local-part with identifier wrapper).
- **Success response:** HTTP 200 with JSON body (Synapse). [ASSUMED — standard Matrix spec; Naomi's verification confirmed this pattern works]
- **Already-deactivated (idempotent):** Synapse returns 200 for `POST /_matrix/client/v3/account/deactivate` on an already-deactivated account when using the account's own token. The token was already revoked by the prior deactivation, so subsequent attempts with the old token will get 401 M_UNKNOWN_TOKEN. Handle: treat 401 as "already deactivated, retire complete" after step 1 already succeeded. [ASSUMED — based on Synapse behavior; planner may choose to log-and-skip instead]
- **Contrast with admin-side deactivate:** The Skynet backend uses `POST /_synapse/admin/v1/deactivate/{mxid}` with the admin token (matrix-admin-client.ts:957). This phase uses the CLIENT endpoint with the identity's OWN token — NO admin token involved.

### D-13: failure handling — abort retire, retry next day

- **Pattern:** Each sub-step of `retire_identity()` returns 1 on failure. Caller in `run_archive_scan` checks return code; on failure, increments the per-identity failure counter.
- **Retry-from-top idempotency:**
  - Step 1 (move): `[ ! -d "$iddir" ]` → skip move (folder already in archive from prior attempt)
  - Step 2 (kill): `match_session` → no session found → no-op
  - Step 3 (deactivate): a 200 is returned for a successfully deactivated account; if the token was revoked by prior deactivation, expect 401 (treat as already-done success)

### D-14: retire-stuck sentinel after 3 consecutive failures

- **Recommendation:** Option A (counter file in DORMANCY_STATE_DIR). Counter file is at `$DORMANCY_STATE_DIR/retire-fail-count-$name`. Contains a plain integer. Reset (rm the file) on successful retire (or on successful scan where the identity is no longer present in the active tree).
- **Sentinel:** `touch "$IDENTITIES_DIR/archive/$name/retire-stuck"` — presence-only, no content.
- **Log requirement:** "LOUD" means using `log "ERROR: ..."` (the existing `log()` function outputs to stdout which systemd captures). The D-14 log line must be distinguishable from normal diagnostic plumbing — use the `ERROR:` prefix.
- **Important:** The counter must survive supervisor restarts. Counter file on disk (not in-memory variable) satisfies this.

### D-15: no announcement

- **Implementation impact:** Zero additional `log()` calls beyond normal diagnostic plumbing. Do not add any "identity X was archived" log line with intent to announce. The retire-stuck LOUD log (D-14) is the explicit exception.

### D-16: no un-archive path

- **Implementation impact:** Zero code for un-archive. No reverse-mv helper. No "recently archived" list. Nothing.

### D-17: Skynet discovery is natural

- **Implementation impact:** Zero changes to Skynet. Skynet's per-host identity refresh already polls `IDENTITIES_DIR/*/` — when the archived identity is no longer there, Skynet drops it from the conversation list on its next poll. This is confirmed by the distributor pattern and the identity refresh logic.

---

## Runtime State Inventory

This is a refactor/extension of an existing script, not a rename phase. The "runtime state" inventory applies to what the new code reads/writes at runtime.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | `relay-state/since` (read-only, freshness signal); archived identity's `relay.json` (read-only, deactivate creds) | Code reads only; no migration |
| Live service config | `agent-supervisor.service` on fleet boxes — updated via distributor sweep + `systemctl --user restart agent-supervisor.service` | No manual action; distributor handles on next sweep |
| OS-registered state | systemd --user service on each managed box (already restarted by distributor `restartHook`) | Distributor restart hook fires automatically |
| Secrets/env vars | `relay.json` password + access_token — read from disk at retire time; not stored in any new env var | None — read-only access to existing file |
| Build artifacts | None — bash script, no compilation | None |

**Archive directory:** `~/.claude/identities/archive/` does NOT currently exist on this box (confirmed: `ls /home/ubuntu/.claude/identities/archive/` → not found). First retire on any box creates it via `mkdir -p`. This is correct behavior — the directory is created on demand.

---

## Common Pitfalls

### Pitfall 1: MODE=A boxes scan only supervised identities, not all identities

**What goes wrong:** In MODE=A, `IDENTITIES` comes from the conf array — only the supervised subset. If the archive scan only iterates `IDENTITIES[@]`, it would miss any unsupervised identity on the same box that happens to be dormant.
**Why it happens:** The existing reconcile loop iterates `IDENTITIES[@]` which is correct for keep-alive. The archive scan has different semantics: it should sweep ALL identities on the box, even unsupervised ones.
**How to avoid:** Archive scan should always walk `$IDENTITIES_DIR/*/` directly (same as MODE=B enumeration in `resolve_identities`), regardless of the conf MODE. The scan needs its OWN identity enumeration, not a shared one with the keep-alive loop.
**Warning signs:** If a box runs MODE=A with 2 supervised identities but has 8 identity folders total, the archive scan only examines 2.

### Pitfall 2: Forgetting `[ "$name" = archive ] && continue` in the scan's identity walk

**What goes wrong:** The scan's `for d in "$IDENTITIES_DIR"/*/` iteration includes `archive/` as a directory entry. Trying to read `archive/archive.md` or stat `archive/relay-state/since` either errors or falsely matches.
**Why it happens:** `IDENTITIES_DIR/*/` glob includes ALL subdirectories, including `archive/`.
**How to avoid:** Add `[ "$name" = archive ] && continue` at the top of the scan loop. Exact same defensive guard the supervisor already has at line 210.
**Warning signs:** Log lines showing retire attempts on an identity named "archive".

### Pitfall 3: Using `-t =<name>` for tmux kill-session

**What goes wrong:** `tmux kill-session -t =<name>` does an EXACT CASE-SENSITIVE match. If the actual session name has different capitalization than the slugified identity name, the kill silently no-ops (tmux doesn't find the session by exact name).
**Why it happens:** The `=` prefix was added to other tmux calls for exact-match disambiguation in `has-session` and `list-panes`. It's appropriate there but wrong for `kill-session` when the name comes from `match_session` (which already resolved to the actual name).
**How to avoid:** `tmux kill-session -t "$actual"` where `actual` is the return value of `match_session`. No `=` prefix needed — `actual` IS the real session name.

### Pitfall 4: Reading relay.json from the ACTIVE tree in step 3

**What goes wrong:** If step 3 reads `$IDENTITIES_DIR/$name/relay.json`, it fails after step 1 (because the folder was moved to `archive/`). This would always cause step 3 to fail on the first attempt (move succeeds, kill succeeds, deactivate fails trying to read from now-absent path).
**Why it happens:** Natural mistake — `$IDENTITIES_DIR/$name` is the "normal" path.
**How to avoid:** Step 3 explicitly reads from `$IDENTITIES_DIR/archive/$name/relay.json`. The archdir variable should be established at the top of `retire_identity()` and used throughout.
**Warning signs:** Log lines showing `relay.json not found` even though the folder appears in archive/.

### Pitfall 5: Resetting the 24h gate only on a clean scan

**What goes wrong:** If the marker file is only `touch`ed when the scan had zero failures, a box with a stuck identity (network outage, homeserver down) never advances the 24h gate and runs the scan on every tick.
**Why it happens:** Seems logical to only "record success" but the gate semantics are about cadence, not success.
**How to avoid:** `touch "$ARCHIVE_SCAN_MARKER"` unconditionally at the END of `run_archive_scan`, regardless of individual retire failures.

### Pitfall 6: Coordinator detection drift from the id-skill

**What goes wrong:** The id-skill's strict-detection rule is: between the FIRST two `---` lines, top-level key on its own line, unquoted boolean `true`. If the shell implementation is slightly different (e.g., uses `grep -m1 "coordinator: true"` without anchoring to the frontmatter block), it will false-positive on identity files that mention `coordinator: true` in body prose.
**Why it happens:** A naive `grep` approach doesn't respect the frontmatter boundary.
**How to avoid:** Use the `awk` pattern from § Pattern 2 exactly. Test with a synthetic identity file that has `coordinator: true` in the body prose to confirm it's NOT detected as coordinator.
**Warning signs:** Coordinators being erroneously retired.

### Pitfall 7: The supervisor's "NEVER kills a session" invariant confusion

**What goes wrong:** The comment at line 233 says "SAFETY: the supervisor NEVER kills a session." A reader might think `tmux kill-session` is globally prohibited.
**Why it happens:** That comment applies to the KEEP-ALIVE loop's behavior — it protects against spurious kills of running sessions. The retire action is a deliberate, intentional permanent retirement, which IS the appropriate exception.
**How to avoid:** Add a clear comment in the retire function: `# EXCEPTION to the "never kill" rule: retire is a permanent removal, not a recovery action.`

---

## Code Examples

### Full Archive Scan Function Skeleton

```bash
# Source: D-01..D-14 in 94-CONTEXT.md; existing supervisor patterns for precedent

# === ARCHIVE SCAN (Phase 94) ========================================
# Once per 24h: walk identities, apply guards, retire 180d-dormant ones.
# Called at top of reconcile() before the keep-alive loop.
ARCHIVE_SCAN_MARKER="${DORMANCY_STATE_DIR}/archive-scan-last-ran"
ARCHIVE_SCAN_INTERVAL=$((24 * 60 * 60))     # 86400s
ARCHIVE_THRESHOLD_SECONDS=$((180 * 24 * 60 * 60))   # 180 days in seconds

is_coordinator() {
  local f="$1"
  [ -f "$f" ] || return 1
  awk '/^---$/{f++} f==1 && /^coordinator: true$/{found=1; exit} END{exit !found}' "$f"
}

retire_identity() {
  local name="$1"
  # ... (see Pattern 4 above)
}

run_archive_scan() {
  log "archive-scan: starting scan"
  mkdir -p "$IDENTITIES_DIR/archive" 2>/dev/null
  local now; now=$(date +%s)
  local d name
  for d in "$IDENTITIES_DIR"/*/; do
    [ -d "$d" ] || continue
    name="$(basename "$d")"
    [ "$name" = archive ] && continue
    [ -f "$d/$name.md" ] || continue    # require real identity file
    # Guard D-03: pinned
    [ -f "$d/.pinned" ] && { [ "${VERBOSE:-0}" = 1 ] && log "archive-scan: '$name' pinned — skip"; continue; }
    # Guard D-04: no-dormancy
    [ -f "$d/.no-dormancy" ] && { [ "${VERBOSE:-0}" = 1 ] && log "archive-scan: '$name' no-dormancy — skip"; continue; }
    # Guard D-05: coordinator
    if is_coordinator "$d/$name.md"; then
      [ "${VERBOSE:-0}" = 1 ] && log "archive-scan: '$name' coordinator — skip"
      continue
    fi
    # Freshness signal D-06/D-07
    local cursor="$d/relay-state/since"
    local mtime
    if [ -f "$cursor" ]; then
      mtime=$(stat -c %Y "$cursor" 2>/dev/null || echo 0)
    else
      mtime=$(stat -c %Y "$d" 2>/dev/null || echo 0)
    fi
    local age=$(( now - mtime ))
    if [ "$age" -lt "$ARCHIVE_THRESHOLD_SECONDS" ]; then
      [ "${VERBOSE:-0}" = 1 ] && log "archive-scan: '$name' fresh ($((age / 86400))d ago) — skip"
      continue
    fi
    log "archive-scan: '$name' dormant for $((age / 86400))d — retiring"
    if retire_identity "$name"; then
      # Reset failure counter on success
      rm -f "$DORMANCY_STATE_DIR/retire-fail-count-$name" 2>/dev/null
      log "archive-scan: '$name' retire succeeded"
    else
      # Increment failure counter (D-14)
      local count=0
      count=$(cat "$DORMANCY_STATE_DIR/retire-fail-count-$name" 2>/dev/null | grep -E '^[0-9]+$' || echo 0)
      count=$((count + 1))
      mkdir -p "$DORMANCY_STATE_DIR" 2>/dev/null
      printf '%s' "$count" > "$DORMANCY_STATE_DIR/retire-fail-count-$name"
      if [ "$count" -ge 3 ]; then
        touch "$IDENTITIES_DIR/archive/$name/retire-stuck" 2>/dev/null
        log "ERROR: archive-scan: '$name': STUCK after $count consecutive daily-pass failures — retire-stuck sentinel dropped in archive/$name/"
      else
        log "archive-scan: '$name' retire failed (attempt $count/3) — will retry next daily pass"
      fi
    fi
  done
  log "archive-scan: scan complete"
}

run_archive_scan_if_due() {
  mkdir -p "$DORMANCY_STATE_DIR" 2>/dev/null
  local last=0
  [ -f "$ARCHIVE_SCAN_MARKER" ] && last=$(stat -c %Y "$ARCHIVE_SCAN_MARKER" 2>/dev/null || echo 0)
  local now; now=$(date +%s)
  if [ $((now - last)) -lt "$ARCHIVE_SCAN_INTERVAL" ]; then return 0; fi
  run_archive_scan
  touch "$ARCHIVE_SCAN_MARKER"   # unconditional — cadence gate resets regardless of retire outcomes
}
# === END ARCHIVE SCAN ===============================================
```

**Hook into reconcile():**
```bash
reconcile() {
  sample_memory
  run_archive_scan_if_due    # Phase 94: daily archive-scan branch
  resolve_identities
  # ... existing loop unchanged
}
```

### Coordinator Detection Test Cases (for test plan)

```bash
# Positive cases (should be detected as coordinator):
printf -- '---\nrole: test\ncoordinator: true\n---\n' | awk ... → exit 0

# Negative cases (must NOT be detected as coordinator):
printf -- '---\nrole: test\n# coordinator: true\n---\n' | awk ... → exit 1   # commented
printf -- '---\nrole: test\n---\ncoordinator: true\n' | awk ... → exit 1     # in body
printf -- '---\nrole: test\ntitle: "coordinator: true"\n---\n' | awk ... → exit 1  # quoted
printf -- 'role: test\ncoordinator: true\n' | awk ... → exit 1               # no frontmatter
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `DORMANCY_STATE_DIR` declared but unused | Supervisor writes only to `METRICS_LOG` and `MEM_SAMPLES_LOG` for state | Current | Phase 94 is the FIRST user of `DORMANCY_STATE_DIR` — creates this directory in real use |
| No archive/ directory in identities tree | `archive/` created on first retire | Phase 94 (new) | First retire on any box creates it; subsequent retires reuse it |
| Pin state in Skynet DB | `.pinned` sentinel on disk (Phase 92) | 2026-09-09 | D-03 guard reads this — Phase 92 must be at HEAD before Phase 94 ships |

**Deprecated/outdated:**
- The campaign shape's original archive step order (kill → deactivate → move) is SUPERSEDED by Phase 94's locked D-10/D-11/D-12 order (move → kill → deactivate). Do not reference the original campaign shape order.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | tmux kill-session -t "$actual" (without = prefix) is the correct kill invocation for the retire action | Pattern 4, D-11 map | Low — `actual` from `match_session` IS the real session name; tmux kill-session without = prefix works against a real name |
| A2 | Synapse returns 200 for POST /_matrix/client/v3/account/deactivate (client endpoint, own token) on success | D-12 map | Low — Matrix spec; Naomi verified via live instance during campaign. If wrong, http code check would catch it |
| A3 | The UIA auth block for the client deactivate endpoint uses full MXID (@name:server) in the "user" field | D-12 map | Medium — if it expects local part only, deactivate would return 401 and the retire aborts (retried next day); Naomi's verification gives high confidence |
| A4 | A 401 response on the deactivate call (token revoked by prior deactivation) should be treated as already-deactivated success for retry idempotency | D-13 map | Low — if wrong, second retry day always fails step 3 with a 401 and hits retire-stuck after 3 days; easy to fix if observed |
| A5 | The archive scan should walk ALL identities (MODE=B enumeration) rather than just the configured IDENTITIES array (MODE=A) | D-01 / Pitfall 1 | Medium — if wrong and the box is MODE=A, only supervised identities get archived. Planner should confirm the intent vs a per-box deployment decision |
| A6 | `DORMANCY_STATE_DIR` is the right home for the archive-scan-last-ran marker (it's declared but currently unused for writes) | D-02 map | Low — it's the declared state dir; even if unused today, it's the appropriate location |

---

## Open Questions (RESOLVED)

1. **MODE=A: scan ALL identities or only IDENTITIES array?**
   - **RESOLVED:** Archive scan walks `$IDENTITIES_DIR/*/` (MODE-agnostic) per Plan 94-03 action. A box that owns the identity folder is responsible for archiving it regardless of MODE. Encoded in `run_archive_scan()`.
   - What we know: In MODE=A, `IDENTITIES` is set from the conf array (only supervised subset). In MODE=B, `resolve_identities` walks `IDENTITIES_DIR/*/`.
   - What's unclear: If a box is MODE=A with 3 supervised identities but has 8 total on disk, does the archive scan look at all 8 or just 3?
   - Recommendation: Scan ALL on the box (walk `IDENTITIES_DIR/*/` regardless of MODE). A box that owns the identity folder is responsible for archiving it, even if it's not currently supervised. This matches the shape's intent ("local decision made by the host that owns the identity").

2. **archive/<name>/ collision handling (an existing archive/<name>/ from a prior retire)**
   - **RESOLVED:** True collision (active `<name>/` present AND `archive/<name>/` present) → `retire_identity` returns 1 (abort retire); the counter drives to `retire-stuck` after 3 consecutive daily-pass fails. No defensive epoch suffix. Encoded in Plan 94-02 as the four-state case analysis in step 1.
   - What we know: Un-archive is out of scope (D-16), so this should be impossible in normal operation.
   - What's unclear: If somehow a name collision occurs (e.g., coordinator created two identities with same name on same host at different times), what does the planner do?
   - Recommendation: Add a defensive check: `if [ -d "$archdir" ]; then` treat as step 1 already complete (idempotent path). Add a log line flagging the "already-archived" case. This handles the retry-from-partial path and the impossible-but-defensive case in one.

3. **retire-stuck counter reset: when does it clear?**
   - **RESOLVED:** Option A (per-identity plain-integer file at `$DORMANCY_STATE_DIR/retire-fail-count-<name>`). Reset is owned by the CALLER (`run_archive_scan`'s success branch), NOT by `retire_identity`. `retire_identity` remains counter-agnostic — it returns 0 on success or 1 on any-step failure. `run_archive_scan` increments the counter on failure and `rm -f` clears it on success. Encoded in Plan 94-03 action.
   - What we know: Counter must reset on successful retire. But "successful retire" means the identity is no longer in active tree.
   - What's unclear: If a retire partially succeeded (folder moved, but deactivate failed), the counter file exists and on next pass step 1 is a no-op. The counter SHOULD reset only when all 3 steps complete.
   - Recommendation: Reset counter (`rm counter_file`) only inside the `retire_identity()` success path, not in the caller.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `tmux` | D-11 session kill | ✓ | system | — (already mandatory in supervisor) |
| `jq` | D-12 relay.json parse | ✓ | `/usr/bin/jq` | — (already used in supervisor) |
| `curl` | D-12 deactivate call | ✓ | `/usr/bin/curl` | — (already used in supervisor) |
| `stat -c %Y` | D-06/D-07 mtime read | ✓ | GNU coreutils | — (already used in supervisor) |
| `awk` | D-05 coordinator detection | ✓ | standard | — |
| `$IDENTITIES_DIR/archive/` | D-10 folder target | ✗ (created on demand) | — | `mkdir -p` in retire |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** `archive/` directory is created by the code itself.

---

## Validation Architecture

`workflow.nyquist_validation` is explicitly `false` in `.planning/config.json`. This section is skipped.

---

## Security Domain

`security_enforcement: true` in `.planning/config.json`. ASVS Level 1.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Supervisor runs as local user; no auth boundary crossed by new code |
| V3 Session Management | no | tmux session kill is an administrative operation within the local host |
| V4 Access Control | no | All operations are local to the host; no cross-process access control decisions |
| V5 Input Validation | yes | identity `name` comes from `basename "$d"` (filesystem directory names). No further validation needed beyond the existing `[ -f "$d/$name.md" ]` check that require a real identity file. The `name` is used only in local path construction and log lines. |
| V6 Cryptography | no | Access token / password read from `relay.json` (chmod 600, existing protection). Used for a single network call; not stored in new location. |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via identity directory name | Tampering | `basename "$d"` from a glob of `$IDENTITIES_DIR/*/` — filesystem names can't contain `/` that would escape the base path. Already safe by construction. |
| `relay.json` credential exposure in logs | Information Disclosure | Do NOT log `access_token` or `password`. Log only `base` and `user_id` (mxid) in error messages. The curl command should use variables, not expanded inline in log lines. |
| Retire a still-active identity due to stale cursor | Tampering | Guards D-03/D-04/D-05 protect pinned / always-on / coordinator identities. The 180-day threshold is conservative. Maintainer's responsibility to sequence exceptional filesystem ops (D-09). |
| Retire-stuck file written to wrong location | Tampering | `retire-stuck` is always written to `$IDENTITIES_DIR/archive/$name/retire-stuck`. After step 1 (mv), the archived folder path is well-defined. |

---

## Sources

### Primary (HIGH confidence)
- `substrate/scripts/agent-supervisor.sh` (read in full, 1460 lines) — supervisor internals, state patterns, helper functions
- `.planning/phases/94-supervisor-archive-extension-daily-archive-scan-for-180-day-/94-CONTEXT.md` — all 17 locked decisions
- `.planning/shapes/shape-supervisor-archive.md` — canonical shape file with philosophy and failure-mode reasoning
- `substrate/skills/id/SKILL.md` lines 379-387 — strict coordinator detection rule (verbatim source for D-05)
- `substrate/skills/agent-relay/recv.sh` line 235 — cursor write semantics confirming mtime advances every ~30s
- `src/backend/distributor/catalog.ts` — confirmed `agent-supervisor.sh` entry with `restartHook: "agent-supervisor.service"` and bundledPath
- `.planning/phases/92-pin-sentinel-migration-move-identity-pin-state-from-skynet-d/92-CONTEXT.md` — Phase 92 `.pinned` sentinel shape
- `/home/ubuntu/.claude/identities/tanya/relay.json` — confirmed relay.json field names: `base`, `user_id`, `password`, `token`, `access_token`

### Secondary (MEDIUM confidence)
- `~/.claude/roles/box-maintainer/bounties/id-skill-revamp/shape-id-skill-revamp.md` — campaign shape confirming Naomi's deactivate verification and original archive design
- `~/.claude/roles/box-maintainer/bounties/id-skill-revamp/bounty.json` — confirmed timeline entry: "verified with Naomi (owns Synapse on thenasty) ... client-side self-deactivate with erase:true produces identical post-state to admin-side path"
- `src/backend/matrix/matrix-admin-client.ts:957` — Skynet's ADMIN-side deactivate implementation (for contrast — this phase uses CLIENT endpoint, not admin)

### Tertiary (LOW confidence)
- tmux `kill-session` without `=` prefix behavior for retire D-11 — [ASSUMED] based on reading all tmux invocations in supervisor and the `-t =` vs `-t` semantics documented by tmux

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — pure bash, all tools verified present
- Architecture: HIGH — read entire supervisor file, clear insertion point identified
- D-decision map: HIGH — derived directly from CONTEXT.md locked decisions + verified code patterns
- Coordinator detection: HIGH — tested awk pattern against all edge cases
- Matrix deactivate call shape: MEDIUM — confirmed from campaign shape + bounty verification notes; exact UIA `user` field format has A3 assumption
- Retire-stuck counter mechanism: MEDIUM — planner discretion per CONTEXT.md; options A/B enumerated

**Research date:** 2026-09-09
**Valid until:** 2026-11-09 (60 days; stable domain — bash patterns don't change; Matrix spec is stable)

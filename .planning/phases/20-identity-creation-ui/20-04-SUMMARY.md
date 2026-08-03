---
phase: 20-identity-creation-ui
plan: "04"
subsystem: backend
tags: [identity, birth, sse, orchestrator, ssh, tmux, nelly, tdd]
dependency_graph:
  requires:
    - 20-01 (getCandidateForBirth helpers from identity-avatar-batch.ts)
    - 20-02 (isLocalHostId + connectOneShot patterns established)
  provides:
    - POST /identities/birth (SSE compound birth endpoint)
    - birthIdentity() pure orchestrator function
    - getCandidateForBirth() + consumeCandidateForBirth() helpers on identity-avatar-batch.ts
  affects:
    - src/backend/database/database.ts
    - docker/nginx.conf
    - docker/nginx-https.conf
tech_stack:
  added: []
  patterns:
    - Pure function orchestrator with dependency injection (BirthDeps)
    - SSE transport (Content-Type text/event-stream + flushHeaders + res.write frames)
    - BirthAborted sentinel error for step-sequence early termination
    - DB-direct createIdentityRecord/getIdentityRecord (avoids double-JWT-auth)
    - node one-liner for hasTrustDialogAccepted via process.argv[1] path injection
    - promisify(exec) for local branch (self-birth)
key_files:
  created:
    - src/backend/database/routes/identity-birth-orchestrator.ts
    - src/backend/database/routes/identity-birth-orchestrator.test.ts
    - src/backend/database/routes/identity-birth.ts
    - src/backend/database/routes/identity-birth.test.ts
  modified:
    - src/backend/database/routes/identity-avatar-batch.ts
    - src/backend/database/database.ts
    - docker/nginx.conf
    - docker/nginx-https.conf
decisions:
  - "DB-direct createIdentityRecord/getIdentityRecord instead of internal HTTP: avoids double-JWT-auth and internal round-trip complexity; maintenance cost is low since identities schema is stable"
  - "BirthAborted sentinel: runStep() catches all step errors, emits failed events, then throws BirthAborted so the outer catch knows to suppress re-emission"
  - "node one-liner uses process.argv[1] for path injection to avoid shell-in-JS-string escaping complexity for the trust-flag write"
  - "execLocal uses promisify(exec) for self-birth local branch (child_process.exec)"
  - "consumeCandidateForBirth called in route finally{} block after orchestrator returns, not inside orchestrator (orchestrator is pure, cleanup is route concern)"
  - "nginx birth block uses exact-match location = /identities/birth (not regex) to take precedence without modifying surrounding regex blocks"
metrics:
  duration: "~35 minutes"
  completed: "2026-08-03"
  tasks_completed: 3
  files_changed: 8
---

# Phase 20 Plan 04: Identity Birth Orchestrator + SSE Route Summary

Nelly-cribbed 5-step birth orchestrator with SSE progress streaming — creates Skynet
identity record + opens tmux session + launches claude CLI with trust pre-set + blind Enter
train × 7 + sends /id <name>.

## What Was Built

### identity-birth-orchestrator.ts — pure orchestration module

Exported constants (Nelly-verbatim, audited):

```typescript
export const ENTER_TRAIN_COUNT = 7;               // Nelly §1(g)
export const ENTER_TRAIN_SPACING_MS = 3000;        // Nelly §1(g)
export const SETTLE_SECONDS = 22;                  // Nelly §1(g) doc constant
export const STEP_2_SLEEP_MS = 3000;               // Nelly §1(b)
export const STEP_3_SLEEP_MS = 2000;               // Nelly §1(f)
export const SSH_CONNECT_TIMEOUT_MS = 30000;
export const CLAUDE_LAUNCH_CMD_PREFIX =
  "CLAUDE_CODE_RESUME_THRESHOLD_MINUTES=99999999 CLAUDE_CODE_RESUME_TOKEN_THRESHOLD=99999999";
export const TMUX_NEW_SESSION_FLAGS = "-x 220 -y 50"; // Nelly §3
```

`birthIdentity(opts, emit, deps)` runs the 5-step sequence:

**Step 1 (always local to backend):**
- Looks up avatar bytes via `deps.getCandidateForBirth(userId, avatarCandidateId)`
- Calls `deps.createIdentityRecord(userId, meta, avatarBytes)` — DB-direct (no internal HTTP)
- GET-verifies via `deps.getIdentityRecord(userId, created.id)` — checks colorHue, voice, avatarEtag
- Throws `"silent-no-op: colorHue not persisted ..."` if any field mismatches

**Step 2 (SSH or local-exec):**
```
mkdir -p '<path>' && tmux new-session -d -s '<name>' -c '<path>' -x 220 -y 50
```
Then `await sleep(3000)` for login shell profile sourcing.

**Step 3 (trust-flag pre-write + claude launch):**

node one-liner for trust-flag (cribbed from agent-supervisor.sh:125 `accept_trust_for_workdir()`):
```bash
node -e 'const fs=require("fs"),os=require("os"),p=require("path");const f=p.join(os.homedir(),".claude.json");const wd=process.argv[1];let d={};try{d=JSON.parse(fs.readFileSync(f,"utf8"));}catch(e){}if(typeof d!=="object"||!d||Array.isArray(d))d={};d.projects=(d.projects&&typeof d.projects==="object")?d.projects:{};d.projects[wd]=(d.projects[wd]&&typeof d.projects[wd]==="object")?d.projects[wd]:{};d.projects[wd].hasTrustDialogAccepted=true;try{fs.writeFileSync(f,JSON.stringify(d,null,2)+"\n");console.log("set");}catch(e){console.log("skip");}' '<expanded-path>'
```
Path is injected as `process.argv[1]` (not embedded in JS string) to avoid shell-in-JS-string escaping.

Claude launch (two separate send-keys calls per Nelly §1(d-e)):
```bash
tmux send-keys -t testkey -l 'CLAUDE_CODE_RESUME_THRESHOLD_MINUTES=99999999 CLAUDE_CODE_RESUME_TOKEN_THRESHOLD=99999999 claude --dangerously-skip-permissions'
tmux send-keys -t testkey Enter
```
Then `await sleep(2000)`.

**Step 4 (blind Enter train — deliberately dumb):**
- Loop 7 times: `tmux send-keys -t <name> Enter`, then `sleep(3000)` except after last
- NO capture-pane, NO REPL-scrape detection (timing-based only, Nelly §1(g))

**Step 5 (/id command):**
```bash
tmux send-keys -t <name> -l '/id <name>'
tmux send-keys -t <name> Enter
```

### Failure policy (Ashley-locked)

Any step failure: `emit({type:"step",n,phase:"failed",reason})` + `emit({type:"ended",ok:false,failedStep:n})` + stop. NO rollback. NO retry. NO cancel.

### SSE event schema (locked for plan 06 consumption)

Event name: `birth`

Payload shapes:
```typescript
// Step progress (10 per successful run: 5×started + 5×completed)
{ type: "step", n: 1|2|3|4|5, phase: "started"|"completed"|"failed", reason?: string }

// Terminal event (always last)
{ type: "ended", ok: boolean, failedStep?: number, identityId?: string, sessionName?: string }
```

Wire format (per frame):
```
event: birth
data: {"type":"step","n":1,"phase":"started"}

```

### identity-birth.ts — SSE route

- `POST /identities/birth` with JWT auth and body validation (400 before SSE opens)
- Validates: `hostId` (positive int), `name` (non-empty string), `title` (non-empty string), `avatarCandidateId` (non-empty string)
- Opens SSE: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`
- Injects real deps object with all 8 required keys
- Calls `consumeCandidateForBirth()` in `finally{}` to prevent re-use

### getCandidateForBirth + consumeCandidateForBirth (added to identity-avatar-batch.ts)

Non-breaking additions to plan 01's file:
- `getCandidateForBirth(userId, id)` — reads from `candidateCache`, enforces userId scope and TTL, returns `{bytes, mime} | null`
- `consumeCandidateForBirth(userId, id)` — deletes the cache entry after successful pickup

### Nginx (both configs)

Both `docker/nginx.conf` and `docker/nginx-https.conf` have:
```nginx
location = /identities/birth {
    proxy_buffering off;
    chunked_transfer_encoding on;
    proxy_request_buffering off;
    proxy_read_timeout 600s;
    proxy_pass http://127.0.0.1:30001;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    ...
}
```
Declared BEFORE the general `/identities` regex block (exact-match takes precedence).

### database.ts mount

```typescript
import identityBirthRoutes from "./routes/identity-birth.js";
// ...
app.use("/identities/birth", identityBirthRoutes); // BEFORE /identities
```

## Tests

All 52 tests pass across 4 test files:

- `identity-birth-orchestrator.test.ts`: 26 tests (18 spec + 8 constant assertions)
  - Happy path: remote host, self-birth (isLocalHostId=true)
  - Step 1: multipart meta + GET-verify silent-no-op guard + 409 collision
  - Step 2: mkdir + tmux new-session verbatim + terminal sizing
  - Step 3: hasTrustDialogAccepted pre-write BEFORE claude launch + env-vars verbatim + -l flag
  - Step 4: exactly 7 Enters at 3s spacing, NO capture-pane
  - Step 5: /id <name> literal mode then Enter
  - Step 3 failure stops sequence: steps 4-5 never dispatched
  - Avatar cache miss, SSH timeout, name validation, path normalization

- `identity-birth.test.ts`: 5 tests
  - SSE headers (Content-Type, Cache-Control, Connection)
  - SSE event framing (event: birth\ndata: {...}\n\n)
  - 400 on invalid body (before SSE opens)
  - 401 without JWT
  - All 8 dep keys injected

- `identity-avatar-batch.test.ts`: 11 tests (plan 01, unmodified — all pass)
- `identity-exists-on-host.test.ts`: 10 tests (plan 02, unmodified — all pass)

## Critical Non-Negotiables Verification

- [x] ENTER_TRAIN_COUNT = 7 (exported constant, audited)
- [x] ENTER_TRAIN_SPACING_MS = 3000 (exported constant, audited)
- [x] CLAUDE_LAUNCH_CMD_PREFIX with BOTH env-vars verbatim
- [x] hasTrustDialogAccepted pre-set BEFORE claude launch (test 8 asserts order)
- [x] Plain `-t <name>` syntax only (NO `-t "=<name>"` anywhere in orchestrator)
- [x] NO capture-pane / REPL-scrape detection (grep returns 0 in orchestrator)
- [x] NO cancel/retry/rollback affordances anywhere in new files
- [x] Silent-no-op GET-verify at step 1 (colorHue, voice, avatarEtag checked)
- [x] `npm run build:backend` exits 0
- [x] Both nginx configs updated with exact-match location = /identities/birth
- [x] SSE directives: proxy_buffering off + chunked_transfer_encoding on in both configs
- [x] No push/build/docker compose invoked

## createIdentityRecord Choice

Used **DB-direct** approach (reads/writes identities table directly via drizzle-orm) rather than internal HTTP call to the existing identities router. Rationale:
- Avoids double JWT authentication
- No internal HTTP infrastructure needed
- Mirrors pattern used in other route-level operations
- identities schema is stable (no expected churn)

The trade-off: if the identities router's POST handler gains new business logic (e.g., a new validation rule), the birth orchestrator's createIdentityRecord won't automatically pick it up. This is acceptable for Skynet's single-operator scope.

## Deviations from Plan

None — plan executed exactly as written.

## Threat Flags

No new threat surface beyond what the plan's threat model covers:
- T-20-04-01: name regex gate (IDENTITY_KEY_RE) enforced at orchestrator entry
- T-20-04-02: getCandidateForBirth(userId, id) enforces userId scoping
- T-20-04-03: sanitizeError() maps SSH errors to "Host unreachable", truncates to 200 chars
- T-20-04-04: SSH connect times out at 30s; orchestrator has bounded ~60s total work
- T-20-04-05: No rollback by design (explicit Ashley decision)

## No Push / Build / Deploy

No `git push`, `docker build`, or `docker compose` was invoked. Container stays at `sha256:07547f6c4185` per held-queue posture.

## Self-Check: PASSED

Files exist:
- `src/backend/database/routes/identity-birth-orchestrator.ts` — FOUND
- `src/backend/database/routes/identity-birth-orchestrator.test.ts` — FOUND
- `src/backend/database/routes/identity-birth.ts` — FOUND
- `src/backend/database/routes/identity-birth.test.ts` — FOUND
- `docker/nginx.conf` location = /identities/birth — FOUND
- `docker/nginx-https.conf` location = /identities/birth — FOUND
- `src/backend/database/database.ts` import + mount — FOUND

Commits:
- 81b6d7c: test(20-04): add failing tests for identity-birth-orchestrator (18 tests RED) — FOUND
- 715c8ee: feat(20-04): implement identity-birth-orchestrator (18+8 tests GREEN) — FOUND
- 53d0f0d: feat(20-04): wire SSE route, mount in database.ts, update both nginx configs — FOUND

Build:
- `npm run build:backend` exits 0 — VERIFIED
- All 52 tests pass (4 test files) — VERIFIED

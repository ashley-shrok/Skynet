---
phase: 17-pretty-view-relay-bubbles-skynet-integration
plan: "02"
subsystem: backend-relay
tags:
  - pretty-view
  - relay
  - matrix
  - backend
  - nginx
  - proxy
dependency_graph:
  requires: []
  provides:
    - /relay-pointer HTTP endpoint (GET) on port 30001
    - WHITELIST_REGEX (^/tmp/relay-msg-[A-Za-z0-9._-]+\.txt$)
    - readRelayPointerFile SSH adapter (bounded head-c read)
    - nginx location blocks in both docker/nginx.conf and docker/nginx-https.conf
  affects:
    - plan 17-03 (RelayInboundBubble frontend fetches from this endpoint)
    - plan 17-04 (deploy checkpoint runs curl smoke to verify routing)
tech_stack:
  added: []
  patterns:
    - Express Router + authenticateJWT + resolveHostById + connectOneShot + execCommand (sessions.ts idiom)
    - head -c bounded remote read (SSH exec channel truncation for fleet-availability)
    - Sentinel-line exit-status capture: echo "__RELAY_EXIT_$?"
key_files:
  created:
    - src/backend/database/routes/relay-pointer.ts
    - src/backend/database/routes/relay-pointer.test.ts
  modified:
    - src/backend/database/database.ts
    - docker/nginx.conf
    - docker/nginx-https.conf
decisions:
  - "head -c NOT bare cat for bounded remote read (T-17-02-03 — CLAUDE.md fleet-availability)"
  - "Sentinel checks use endsWith without \\n because execCommand calls resolve(stdout.trim()) at tmux-helper.ts:45 (T-17-02-08)"
  - "regex ~ form for nginx location blocks matching all neighbours (NOT exact-match = form, checker iter-2 warning #5)"
  - "Route mounted on port 30001 main Express app, not port 30011 WSS-only"
  - "End-to-end curl smoke deferred to 17-04 (nginx configs not yet deployed on live instance — Wave 1 pre-deploy)"
metrics:
  duration: "~20 minutes"
  completed: "2026-07-28"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 3
---

# Phase 17 Plan 02: /relay-pointer SSRF-safe SSH proxy route Summary

**One-liner:** SSRF-gated /relay-pointer Express route with head-c bounded SSH read, per-user host ownership via resolveHostById, and matching nginx location blocks in both configs.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | relay-pointer.ts router + readRelayPointerFile adapter + 11 unit tests + database.ts mount | 7e31e69 |
| 2 | nginx location blocks in docker/nginx.conf + docker/nginx-https.conf + awk drift gate | 1649446 |

## Files Touched

| File | Action | Description |
|------|--------|-------------|
| src/backend/database/routes/relay-pointer.ts | created | Express router with GET / handler, WHITELIST_REGEX, readRelayPointerFile adapter |
| src/backend/database/routes/relay-pointer.test.ts | created | 11 unit tests covering all paths |
| src/backend/database/database.ts | modified | import + app.use("/relay-pointer", relayPointerRoutes) with RELAYBUB-04 comment |
| docker/nginx.conf | modified | location ~ ^/relay-pointer(/.*)?$ block after user-preferences |
| docker/nginx-https.conf | modified | byte-identical location block (CLAUDE.md nginx caveat) |

## Acceptance Gate Results

### WHITELIST-REGEX-VERBATIM-OK
```
grep -Fq 'export const WHITELIST_REGEX = /^\/tmp\/relay-msg-[A-Za-z0-9._-]+\.txt$/' src/backend/database/routes/relay-pointer.ts
→ WHITELIST-REGEX-VERBATIM-OK
```

### BOUNDED-READ-OK (T-17-02-03 fleet-availability gate)
```
grep -Fq 'head -c' src/backend/database/routes/relay-pointer.ts
→ BOUNDED-READ-OK
```

### SENTINEL-TRIMMED-OK (T-17-02-08 trim-alignment gate)
```
grep -Fq 'endsWith("__RELAY_EXIT_1")' src/backend/database/routes/relay-pointer.ts
→ SENTINEL-TRIMMED-OK
```

### SENTINEL-STRIP-TOLERANT-OK (T-17-02-08 defense-in-depth gate)
```
grep -Eq '\.replace\(/\\n\?__RELAY_EXIT_0\$/' src/backend/database/routes/relay-pointer.ts
→ SENTINEL-STRIP-TOLERANT-OK
```

### Bare-cat forbidden (T-17-02-03 regression gate)
```
grep -c 'execCommand.*"cat ' src/backend/database/routes/relay-pointer.ts
→ 0  (correct — no bare cat)
```

### Route mount
```
grep -c 'app.use("/relay-pointer"' src/backend/database/database.ts
→ 1
```

### RELAYBUB-04 comment at mount site
```
grep -c 'RELAYBUB-04\|CLAUDE.md nginx caveat' src/backend/database/database.ts
→ 2
```

### All three SSH primitives present
```
grep -c 'resolveHostById\|connectOneShot\|execCommand' src/backend/database/routes/relay-pointer.ts
→ 14 (≥ 3)
```

### authenticateJWT middleware wired
```
grep -c 'authenticateJWT' src/backend/database/routes/relay-pointer.ts
→ 3 (≥ 1)
```

### Unit tests: 11/11 pass
```
npx vitest run src/backend/database/routes/relay-pointer.test.ts --reporter=verbose
→ Tests  11 passed (11)

Test 1:  whitelist accept — /tmp/relay-msg-abc123.txt matches WHITELIST_REGEX ✓
Test 2:  whitelist reject dot-dot — /tmp/relay-msg-../../etc/passwd rejected ✓
Test 3:  whitelist reject non-tmp — /etc/passwd rejected ✓
Test 4:  whitelist reject wrong suffix — /tmp/relay-msg-abc.sh rejected ✓
Test 5:  unauthorized host — resolveHostById returns null → throws UNAUTHORIZED_HOST ✓
Test 6:  file not found — execCommand returns '__RELAY_EXIT_1' → throws FILE_NOT_FOUND ✓
Test 7:  happy path — returns 200 with stripped body ✓
Test 8:  size cap — body length === MAX_POINTER_SIZE_BYTES + 1 → throws FILE_TOO_LARGE ✓
Test 9:  missing hostId → 400 invalid_params ✓
Test 10: non-integer hostId ('abc') → 400 invalid_params ✓
Test 11: sentinel-trim tolerance — both trimmed and untrimmed \n?__RELAY_EXIT_0 forms yield same body ✓
```

### TypeScript: 0 errors
```
npx tsc --noEmit
→ (no output — 0 errors)
```

### Full src/backend/database/ regression suite
```
npx vitest run src/backend/database/
→ Test Files  6 passed (6)  |  Tests  62 passed (62)
```

### Nginx location block form: regex ~ form (NOT exact-match =)
```
grep -c 'location ~ \^/relay-pointer' docker/nginx.conf
→ 1

grep -c 'location ~ \^/relay-pointer' docker/nginx-https.conf
→ 1

grep -c 'location = /relay-pointer' docker/nginx.conf docker/nginx-https.conf
→ 0  (correct — exact-match form NOT present)
```

### Awk block-matcher drift gate WITH non-empty preflight
```
awk '/^[[:space:]]*location ~ \^\/relay-pointer/{...}' docker/nginx.conf > /tmp/http.txt
awk '/^[[:space:]]*location ~ \^\/relay-pointer/{...}' docker/nginx-https.conf > /tmp/https.txt
[ -s /tmp/http.txt ] && [ -s /tmp/https.txt ] && diff /tmp/http.txt /tmp/https.txt && echo NGINX-DRIFT-GATE-OK
→ NGINX-DRIFT-GATE-OK  (zero diff, both extractions non-empty)
```

Extracted block (identical in both files):
```nginx
        location ~ ^/relay-pointer(/.*)?$ {
            proxy_pass http://127.0.0.1:30001;
            proxy_http_version 1.1;
            proxy_set_header Host $http_host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_read_timeout 30s;
        }
```

### Nginx -t syntax check
Docker unavailable in executor environment. Deferred to 17-04 build-verify.

**17-04 must run:**
```bash
docker run --rm -v "$(pwd)/docker/nginx.conf":/etc/nginx/nginx.conf:ro nginx:alpine nginx -t
docker run --rm -v "$(pwd)/docker/nginx-https.conf":/etc/nginx/nginx.conf:ro nginx:alpine nginx -t
```
Both must print `syntax is ok` and `test is successful`.

### End-to-end curl smoke
Deferred to 17-04 deploy checkpoint. The live instance (term.gigaashley.click) is reachable but
the new nginx configs are NOT yet deployed (this is Wave 1 — deploy happens in 17-04). Pre-deploy
curl currently returns HTTP 200 with index.html (SPA fallback — expected before deploy).

**17-04 must run AFTER `docker compose up -d --force-recreate skynet`:**

Primary smoke:
```bash
curl -sS -o /tmp/relay-smoke-body.txt -w '%{http_code}\n' \
  'https://term.gigaashley.click/relay-pointer?hostId=1&path=/etc/passwd'
head -c 40 /tmp/relay-smoke-body.txt
```
MUST print code in `{400, 401}` AND body NOT `<!DOCTYPE html>`.
- 401 = authenticateJWT short-circuits unauthenticated request (Express middleware ordering)
- 400 = whitelist_reject (if auth ordering ever shifts)
- 200 + `<!DOCTYPE html>` = BLOCKING FAILURE — nginx SPA fallback means route not wired

Secondary smoke:
```bash
curl -sS -o /dev/null -w '%{http_code}\n' 'https://term.gigaashley.click/relay-pointer'
```
MUST print `{400, 401}`, NOT `200`.

## Route Mount Snippet (database.ts)

```typescript
import relayPointerRoutes from "./routes/relay-pointer.js";
// ...
app.use("/sessions", sessionsRoutes);
app.use("/user-preferences", userPreferencesRoutes);
// RELAYBUB-04 (Phase 17): /relay-pointer needs matching location blocks in BOTH docker/nginx.conf
// AND docker/nginx-https.conf — see CLAUDE.md nginx caveat. Handler uses head -c bounded remote
// read for CLAUDE.md fleet-availability protection ("Ashley never loses access to her fleet").
app.use("/relay-pointer", relayPointerRoutes);
app.use("/debug", debugRoutes);
```

## Deviations from Plan

None — plan executed exactly as written.

## Threat Surface Scan

No new threat surface beyond what the plan's `<threat_model>` already covers (T-17-02-01 through T-17-02-10 + T-17-02-SC). The new `/relay-pointer` endpoint is the only new public HTTP path added; it is documented in the threat register and mitigated by WHITELIST_REGEX + resolveHostById + head-c bounded read.

## Self-Check: PASSED

- [x] src/backend/database/routes/relay-pointer.ts exists
- [x] src/backend/database/routes/relay-pointer.test.ts exists
- [x] database.ts contains app.use("/relay-pointer", relayPointerRoutes)
- [x] docker/nginx.conf contains location ~ ^/relay-pointer
- [x] docker/nginx-https.conf contains location ~ ^/relay-pointer
- [x] Commits 7e31e69 and 1649446 exist in git log
- [x] 11 unit tests pass
- [x] 62 total database suite tests pass
- [x] TypeScript: 0 errors
- [x] NGINX-DRIFT-GATE-OK (zero diff, both extractions non-empty)

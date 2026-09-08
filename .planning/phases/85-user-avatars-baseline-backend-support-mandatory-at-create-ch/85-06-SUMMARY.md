---
phase: 85-user-avatars-baseline-backend-support
plan: "06"
subsystem: nginx-edge-config
tags: [phase-85, user-avatars, nginx, edge-config, D-20, D-21]
completed: 2026-09-08

dependency_graph:
  requires: []
  provides:
    - nginx /users block allows up to 6M request bodies (D-20)
    - both nginx configs updated lockstep (D-21)
  affects:
    - POST /users/create — multipart avatar body now passes nginx edge
    - PUT /users/:id/avatar — replacement avatar body now passes nginx edge

tech_stack:
  added: []
  patterns:
    - nginx client_max_body_size in regex location block (mirrors /identities/avatar 8M precedent at nginx.conf:286-296)

key_files:
  modified:
    - docker/nginx.conf (line 180: client_max_body_size 6M added to /users block)
    - docker/nginx-https.conf (line 191: same addition to sister file)

decisions:
  - "6M chosen: 5 MB payload cap (D-15) + ~1 MB multipart-framing headroom, proportionally tighter than /identities/avatar 8M-for-2MB precedent but industry-standard"
  - "Directive placed as last line inside the existing /users regex block (CONTEXT.md D-20 preference (a) — no new more-specific location block)"
  - "Both files edited in a single commit to enforce the lockstep invariant (D-21)"

metrics:
  duration: "< 5 minutes"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 2
---

# Phase 85 Plan 06: Nginx /users body-size cap Summary

**One-liner:** Added `client_max_body_size 6M;` to the `/users` regex location block in both `docker/nginx.conf` and `docker/nginx-https.conf`, unblocking 5 MB avatar uploads from reaching Express without a 413 at the nginx edge.

## What Was Built

Two nginx config edits — one directive plus a 5-line comment anchor added to the `/users` regex location block in each of the two Skynet nginx configs. The additions are byte-identical across both files per D-21's lockstep requirement.

### Exact lines added to each file

**docker/nginx.conf** (landed at lines 174-180, immediately before the closing `}`):

```nginx
            # Phase 85 (D-20/D-21) — POST /users/create + PUT /users/:id/avatar
            # carry up to 5 MB avatar payloads (D-15). 6M leaves ~1 MB headroom
            # for multipart framing. See docker/nginx-https.conf for the sister
            # edit (D-21). Without this directive, nginx inherits its 1 MB
            # default and 413s at the edge before Express sees the request.
            client_max_body_size 6M;
```

**docker/nginx-https.conf** (landed at lines 185-191, same position relative to the `/users` block):

```nginx
            # Phase 85 (D-20/D-21) — POST /users/create + PUT /users/:id/avatar
            # carry up to 5 MB avatar payloads (D-15). 6M leaves ~1 MB headroom
            # for multipart framing. See docker/nginx-https.conf for the sister
            # edit (D-21). Without this directive, nginx inherits its 1 MB
            # default and 413s at the edge before Express sees the request.
            client_max_body_size 6M;
```

### Line numbers where additions landed

| File | `client_max_body_size 6M;` line |
|------|---------------------------------|
| `docker/nginx.conf` | 180 |
| `docker/nginx-https.conf` | 191 |

### Directive value derivation

- **Payload cap:** 5 MB (D-15, mirrors `identity-avatar-batch.ts:414`)
- **Headroom:** ~1 MB for multipart framing overhead (boundary, MIME part headers)
- **Total:** 6M
- **Sizing precedent:** `/identities/avatar` block at `docker/nginx.conf:286-296` uses `client_max_body_size 8M` for a 2 MB payload cap (4x headroom). Phase 85's 6M for 5MB cap (~20% headroom) is proportionally tighter but standard for upload endpoints.

### Diff-empty check (T-85-SISTER-FILE-MISS mitigated)

```
diff <(awk '/location ~ \^\/users/,/^        }/' docker/nginx.conf \
     | grep -E "client_max_body_size|Phase 85") \
     <(awk '/location ~ \^\/users/,/^        }/' docker/nginx-https.conf \
     | grep -E "client_max_body_size|Phase 85")
```

**Result: EMPTY output, exit 0** — both files carry byte-identical additions. T-85-SISTER-FILE-MISS threat is mitigated.

### No other directives touched

`git diff` shows exactly one `@@` hunk per file, each containing only the 6-line addition. The `/identities/avatar` block at `docker/nginx.conf:286-296` (the sizing precedent) is UNCHANGED. `grep -c 'client_max_body_size 6M' docker/nginx.conf docker/nginx-https.conf` returns 1 per file (2 total).

## Deviations from Plan

None — plan executed exactly as written. Both tasks completed, all verification assertions passed.

## Commits

| Task | Commit | Files |
|------|--------|-------|
| Task 1 + Task 2 (combined per plan "same commit" instruction) | `29011798` | `docker/nginx.conf`, `docker/nginx-https.conf` |

## Self-Check: PASSED

- [x] `client_max_body_size 6M` at nginx.conf:180 — verified
- [x] `client_max_body_size 6M` at nginx-https.conf:191 — verified
- [x] Phase 85 (D-20/D-21) comment present once in each file — `grep -c` returns 1 per file
- [x] Diff-empty assertion exits 0 — byte-identical additions confirmed
- [x] Only 1 new `client_max_body_size` directive per file (`git diff | grep -c '^+.*client_max_body_size'` returns 1 per file)
- [x] No other location blocks modified — one `@@` hunk per file
- [x] Commit 29011798 exists — verified

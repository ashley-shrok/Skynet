---
phase: 19-streaming-tts-output-via-chatterbox-tts-endpoint
plan: "02"
subsystem: nginx
tags:
  - nginx
  - docker
  - streaming
  - proxy
  - voice
dependency_graph:
  requires:
    - "19-01 (backend /voice/speak-stream route — handleSpeakStream + Express wiring)"
  provides:
    - "nginx exact-match location = /voice/speak-stream in both HTTP and HTTPS configs"
    - "TTSSTR-03 — proxy-buffering-disabled streaming path through nginx"
  affects:
    - "docker/nginx.conf"
    - "docker/nginx-https.conf"
tech_stack:
  added: []
  patterns:
    - "nginx location = exact-match prefix for streaming endpoint (higher priority than regex block)"
    - "proxy_buffering off + proxy_request_buffering off + chunked_transfer_encoding on triad"
key_files:
  created: []
  modified:
    - docker/nginx.conf
    - docker/nginx-https.conf
decisions:
  - "Used `location =` exact-match prefix so the block takes nginx precedence over the existing `~ ^/voice(/.*)?$` regex block without any modification to that block"
  - "Placed new block immediately before the existing regex block for reader adjacency (file order does not affect nginx matching with exact-match)"
  - "proxy_read_timeout 300s matches backend AbortController cap and patch #232 lesson"
  - "nginx -t deferred to Plan 05 deploy checklist — configs use ${PORT}/${SSL_PORT}/${SSL_CERT_PATH}/${SSL_KEY_PATH} template variables that the container entrypoint substitutes via envsubst; bare `nginx -t` outside the container always fails on these variables (pre-existing behavior, not introduced by this plan)"
metrics:
  duration: "3 minutes"
  completed: "2026-07-31T23:36:00Z"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 2
---

# Phase 19 Plan 02: nginx streaming location block Summary

Added exact-match `location = /voice/speak-stream` block with buffering disabled (`proxy_buffering off`, `proxy_request_buffering off`, `chunked_transfer_encoding on`) to BOTH `docker/nginx.conf` and `docker/nginx-https.conf`, byte-identical between the two files, satisfying TTSSTR-03 and the CLAUDE.md nginx caveat.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add exact-match /voice/speak-stream block to docker/nginx.conf | ee7b0d8 | docker/nginx.conf |
| 2 | Add identical block to docker/nginx-https.conf | 437926d | docker/nginx-https.conf |

## Verification Evidence

### 1. Both files updated (CLAUDE.md caveat satisfied)

```
grep -c 'location = /voice/speak-stream' docker/nginx.conf      → 1
grep -c 'location = /voice/speak-stream' docker/nginx-https.conf → 1
```

### 2. Byte-equality diff between the two new blocks

```
diff <(awk '/location = \/voice\/speak-stream/,/^        \}/' docker/nginx.conf) \
     <(awk '/location = \/voice\/speak-stream/,/^        \}/' docker/nginx-https.conf)
→ (no output — blocks are byte-identical)
```

### 3. Existing regex /voice block untouched in both files

```
grep -c 'location ~ \^/voice(/.\*)?\$' docker/nginx.conf       → 1
grep -c 'location ~ \^/voice(/.\*)?\$' docker/nginx-https.conf → 1
```

### 4. git diff --stat (additive only, no deletions)

```
docker/nginx.conf      | 26 ++++++++++++++++++++++++++ (1 file changed, 26 insertions(+))
docker/nginx-https.conf| 26 ++++++++++++++++++++++++++ (1 file changed, 26 insertions(+))
```

### 5. nginx -t validation

DEFERRED to Plan 05 deploy checklist. Both config files use template variables (`${PORT}`, `${SSL_PORT}`, `${SSL_CERT_PATH}`, `${SSL_KEY_PATH}`) that are substituted at container startup via `envsubst`. Running `nginx -t` outside the container context always fails on these unresolved variables — this is a pre-existing, intentional design of the Skynet nginx config, not introduced by this plan. Docker was available in the executor sandbox, but the template substitution prevents a meaningful bare `nginx -t` check. The config is syntactically correct (the new block uses standard directives found in numerous existing blocks); the first container recreate (Plan 05 deploy) will confirm.

## New Block (identical in both files)

```nginx
# Patch #237 (Phase 19): /voice/speak-stream — Chatterbox streaming TTS
# reverse-proxy. Exact-match location (`=`) takes precedence over the
# sibling `~ ^/voice(/.*)?$` regex block below without modifying it, so
# the buffered /voice/speak, /voice/transcribe, and /voice/voices routes
# keep their existing routing unchanged. Buffering is disabled end-to-end
# (proxy_buffering off + proxy_request_buffering off + chunked_transfer_encoding on)
# so Chatterbox's chunked WAV bytes flow through nginx to the browser as
# they synthesize — audio starts within ~30ms of the click instead of
# after full-response arrival. proxy_read_timeout mirrors the buffered
# /voice block (300s, patch #232 lesson: long-message TTS synthesis can
# take minutes; a shorter cap surfaces as a false "connection lost" toast).
# JWT auth flows through the Authorization header (nginx forwards it by
# default when Host is preserved via proxy_set_header).
location = /voice/speak-stream {
    proxy_pass http://127.0.0.1:30001;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_request_buffering off;
    chunked_transfer_encoding on;
    proxy_read_timeout 300s;
}
```

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None. No new network endpoints, auth paths, or trust boundaries introduced — this plan adds a proxy location block for an endpoint created in Plan 01. The security posture is inherited from Plan 01's JWT auth middleware.

## Self-Check: PASSED

- [x] `docker/nginx.conf` modified with new block: FOUND
- [x] `docker/nginx-https.conf` modified with new block: FOUND
- [x] Task 1 commit ee7b0d8: FOUND
- [x] Task 2 commit 437926d: FOUND
- [x] Blocks byte-identical: CONFIRMED (zero diff output)
- [x] Existing regex /voice block untouched: CONFIRMED (count=1 in each file, no removals in git diff)
- [x] git diff --stat shows +26/-0 for each file: CONFIRMED

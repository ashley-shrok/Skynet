---
phase: 19-streaming-tts-output-via-chatterbox-tts-endpoint
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - docker/nginx.conf
  - docker/nginx-https.conf
autonomous: true
requirements:
  - TTSSTR-03
tags:
  - nginx
  - docker
  - streaming
  - proxy
  - voice

must_haves:
  truths:
    - "A new nginx `location = /voice/speak-stream` exact-match block exists in BOTH docker/nginx.conf AND docker/nginx-https.conf"
    - "The new block sets `proxy_buffering off;`, `proxy_request_buffering off;`, `chunked_transfer_encoding on;`, and `proxy_read_timeout 300s;`"
    - "The new block uses exact-match prefix `location =` so it takes priority over the pre-existing `location ~ ^/voice(/.*)?$` regex block without modifying the regex block"
    - "The existing `location ~ ^/voice(/.*)?$` block in both files is UNTOUCHED (grep + diff-verifiable)"
    - "Both new blocks proxy_pass to `http://127.0.0.1:30001` (matching the container's Express port used by every existing /voice route)"
    - "Both new blocks preserve the same `proxy_set_header Host $http_host; proxy_set_header X-Real-IP $remote_addr; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme;` header quartet used by the existing /voice block (JWT auth token rides in the Authorization header, which nginx forwards by default when Host is preserved)"
    - "`nginx -t` (or equivalent config validation) passes on both files"
  artifacts:
    - path: docker/nginx.conf
      provides: "new `location = /voice/speak-stream` block placed adjacent to the existing `location ~ ^/voice(/.*)?$` block"
      contains: "location = /voice/speak-stream"
    - path: docker/nginx-https.conf
      provides: "new `location = /voice/speak-stream` block placed adjacent to the existing `location ~ ^/voice(/.*)?$` block"
      contains: "location = /voice/speak-stream"
  key_links:
    - from: "docker/nginx.conf:location = /voice/speak-stream"
      to: "http://127.0.0.1:30001 (Express backend /voice/speak-stream route)"
      via: "proxy_pass with buffering disabled"
      pattern: "location = /voice/speak-stream[\\s\\S]*?proxy_buffering off"
    - from: "docker/nginx-https.conf:location = /voice/speak-stream"
      to: "http://127.0.0.1:30001 (Express backend /voice/speak-stream route)"
      via: "proxy_pass with buffering disabled"
      pattern: "location = /voice/speak-stream[\\s\\S]*?proxy_buffering off"
---

<objective>
Add a new nginx `location = /voice/speak-stream` exact-match block to BOTH `docker/nginx.conf` AND `docker/nginx-https.conf` that disables proxy buffering (`proxy_buffering off`, `proxy_request_buffering off`, `chunked_transfer_encoding on`) so Chatterbox's chunked-transfer WAV bytes flow through nginx to the browser as they arrive — implementing TTSSTR-03. The existing `location ~ ^/voice(/.*)?$` regex block (used by `/voice/speak`, `/voice/transcribe`, `/voice/voices`) is left untouched — nginx's location-matching priority (`=` exact > `~` regex) routes the new endpoint to the exact-match block automatically.

Purpose: Without this block, nginx's default `proxy_buffering on` would collect the entire WAV response before flushing it to the browser, defeating the entire streaming architecture (audio would still only start after full-response arrival — same latency as the buffered `/voice/speak` route). The CLAUDE.md caveat is load-bearing here: BOTH configs must be updated or the route 200s with `index.html` on the config that omits it.

Output:
- New `location = /voice/speak-stream` block in `docker/nginx.conf` (placed adjacent to the existing `location ~ ^/voice(/.*)?$` block at ~line 201).
- Identical `location = /voice/speak-stream` block in `docker/nginx-https.conf` (adjacent to the existing block at ~line 209).
- Both files pass `nginx -t` syntax check (via the container image or a local nginx install).

Non-negotiables (from 19-CONTEXT.md § Nginx configuration + CLAUDE.md caveat + patch #232 lesson):
- BOTH nginx files updated — this is the load-bearing rule; a single-file update causes the frontend to crash on `.map` requests.
- The existing regex `/voice` block is UNTOUCHED (patch #232 already tuned it correctly at `proxy_read_timeout 300s`).
- The new block uses exact-match `location =` prefix (higher priority than regex per nginx location precedence rules) so the two blocks coexist without ambiguity — the alternate approach of inserting a new regex block before the existing one would work but risks silently swapping match order on future edits; exact-match is the resilient design.
- No modification to the existing block's contents, header lines, or comments.
- No change to the `client_max_body_size` from the existing block — the streaming route only accepts a tiny JSON body (`{text, voice?}` capped at 64kb in Express), so nginx's default `1m` limit is fine and we do not need to override.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-CONTEXT.md
@CLAUDE.md
@docker/nginx.conf
@docker/nginx-https.conf
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add exact-match /voice/speak-stream location block to docker/nginx.conf</name>
  <files>docker/nginx.conf</files>

  <read_first>
    - `docker/nginx.conf` in full (or at minimum lines 190-230 covering the existing `/voice` block context) — you MUST see the exact block starting at L201 (`location ~ ^/voice(/.*)?$ { ... }`) so you can (a) confirm its shape stays untouched and (b) place the new exact-match block IMMEDIATELY BEFORE it in file order. Nginx precedence rules mean file order does not affect matching when using `location =` exact-match (exact always wins over regex), but adjacency aids future readers.
    - `.planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-CONTEXT.md` § Nginx configuration — the exact block body is specified there.
    - `CLAUDE.md` (root) — "Every new backend route needs matching `location` blocks in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf`" — this task handles the HTTP config; Task 2 handles HTTPS.
    - Nginx location precedence primer (if unfamiliar): `location = /exact-path { }` matches URI `/exact-path` LITERALLY and takes priority over `location ~ regex { }` blocks. The existing `~ ^/voice(/.*)?$` block will continue to match `/voice/speak`, `/voice/transcribe`, `/voice/voices`, and `/voice/anything-else`; the new exact-match block ONLY handles `/voice/speak-stream`.
  </read_first>

  <action>
    Insert the following block into `docker/nginx.conf` IMMEDIATELY BEFORE the existing `location ~ ^/voice(/.*)?$ {` line (currently at L201 within the `server { ... }` block). Preserve indentation exactly (8 spaces, matching sibling location blocks):

    ```
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
    (Trailing blank line included to separate from the following regex block, matching existing file style.)

    Do NOT modify the existing `location ~ ^/voice(/.*)?$ { ... }` block below the insertion point. Do NOT modify any other location block. Do NOT reorder or rewrite the server block header.

    Notes on directive choices (all locked in 19-CONTEXT.md):
    - `proxy_buffering off` — the primary switch; without it nginx collects the response body before flushing.
    - `proxy_request_buffering off` — defense-in-depth for the request side (the request body is tiny JSON, so this is belt-and-suspenders, not strictly required, but included to match CONTEXT.md spec).
    - `chunked_transfer_encoding on` — nginx default is `on` for HTTP/1.1 responses when Content-Length is absent, but explicitly declared here to guard against future default changes and to communicate intent to human readers.
    - `proxy_read_timeout 300s` — matches the backend AbortController cap (Plan 01) and the pre-existing /voice block's timeout.
    - NO `client_max_body_size` override — the request body is small (`{text, voice?}` capped at 64kb by `express.json` in Plan 01); nginx default 1m is plenty.
  </action>

  <verify>
    <automated>cd /home/ubuntu/skynet && grep -c 'location = /voice/speak-stream' docker/nginx.conf</automated>
    <automated>cd /home/ubuntu/skynet && awk '/location = \/voice\/speak-stream/,/^        }/' docker/nginx.conf | grep -cE '(proxy_buffering off|proxy_request_buffering off|chunked_transfer_encoding on|proxy_read_timeout 300s|proxy_pass http://127\.0\.0\.1:30001)'</automated>
    <automated>cd /home/ubuntu/skynet && grep -c 'location ~ \^/voice(/.\*)?\$' docker/nginx.conf</automated>
    <automated>cd /home/ubuntu/skynet && git diff docker/nginx.conf | grep -E '^-\s+' | grep -vE '^---' | head</automated>
    <automated>cd /home/ubuntu/skynet && docker run --rm -v "$PWD/docker/nginx.conf:/etc/nginx/nginx.conf:ro" nginx:1.27-alpine nginx -t 2>&1 | tail -5</automated>
  </verify>

  <acceptance_criteria>
    - `grep -c 'location = /voice/speak-stream' docker/nginx.conf` = 1 (new block present).
    - `awk`-scoped grep inside the new block finds 5 directives: `proxy_buffering off`, `proxy_request_buffering off`, `chunked_transfer_encoding on`, `proxy_read_timeout 300s`, `proxy_pass http://127.0.0.1:30001` — count >= 5.
    - `grep -c 'location ~ \^/voice(/.*)?\$' docker/nginx.conf` = 1 (existing regex block still present).
    - `git diff docker/nginx.conf | grep -E '^-\s+' | grep -vE '^---'` returns empty (or shows ONLY whitespace changes) — no lines removed from existing blocks.
    - `docker run --rm -v "$PWD/docker/nginx.conf:/etc/nginx/nginx.conf:ro" nginx:1.27-alpine nginx -t` prints `syntax is ok` and `test is successful` (or equivalent for the Skynet container's nginx version — planner didn't lock the tag; use whatever base image `docker compose config` reports for the nginx service, fall back to `nginx:1.27-alpine` if the container is not obvious).
    - If Docker is not available in the executor's sandbox, fall back to a local `nginx -t -c $PWD/docker/nginx.conf` if `nginx` is on PATH; if neither is available, this validation is DEFERRED to Plan 05's deploy checklist and the executor MUST note the deferral in the summary.
  </acceptance_criteria>

  <done>
    New `location = /voice/speak-stream` block exists in `docker/nginx.conf` immediately before the existing `location ~ ^/voice(/.*)?$` block, contains all five load-bearing directives from CONTEXT.md, and passes nginx `-t` syntax validation. Existing blocks are byte-for-byte unchanged.
  </done>
</task>

<task type="auto">
  <name>Task 2: Add identical exact-match /voice/speak-stream location block to docker/nginx-https.conf</name>
  <files>docker/nginx-https.conf</files>

  <read_first>
    - `docker/nginx-https.conf` in full (or at minimum lines 200-230 covering the existing `/voice` block context) — the existing block is at L209 with the same shape as its counterpart in `nginx.conf`.
    - `docker/nginx.conf` after Task 1 has completed — you MUST use the SAME block body (comment + directives + indentation) so the two configs stay in lock-step. Byte-equality of the location block between the two files (except for surrounding context) is a hard acceptance criterion.
    - `.planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-CONTEXT.md` § Nginx configuration.
    - `CLAUDE.md` (root) — nginx caveat.
  </read_first>

  <action>
    Insert the EXACT same block body added by Task 1 into `docker/nginx-https.conf`, positioned IMMEDIATELY BEFORE the existing `location ~ ^/voice(/.*)?$ {` line (currently at L209 within the `server { ... }` block). Indentation, comment text, blank-line placement, and directive ordering MUST match Task 1's insertion byte-for-byte inside the block braces — nginx-https.conf and nginx.conf are maintained as parallel siblings; a diff between the two files (limited to added region) should show ZERO differences within the `location = /voice/speak-stream { ... }` block itself.

    Do NOT modify the existing `location ~ ^/voice(/.*)?$ { ... }` block or any other location block in the HTTPS config.
  </action>

  <verify>
    <automated>cd /home/ubuntu/skynet && grep -c 'location = /voice/speak-stream' docker/nginx-https.conf</automated>
    <automated>cd /home/ubuntu/skynet && awk '/location = \/voice\/speak-stream/,/^        }/' docker/nginx-https.conf | grep -cE '(proxy_buffering off|proxy_request_buffering off|chunked_transfer_encoding on|proxy_read_timeout 300s|proxy_pass http://127\.0\.0\.1:30001)'</automated>
    <automated>cd /home/ubuntu/skynet && grep -c 'location ~ \^/voice(/.\*)?\$' docker/nginx-https.conf</automated>
    <automated>cd /home/ubuntu/skynet && diff <(awk '/location = \/voice\/speak-stream/,/^        }/' docker/nginx.conf) <(awk '/location = \/voice\/speak-stream/,/^        }/' docker/nginx-https.conf) && echo "OK: blocks match byte-for-byte" || echo "FAIL: blocks diverge — must be identical"</automated>
    <automated>cd /home/ubuntu/skynet && git diff docker/nginx-https.conf | grep -E '^-\s+' | grep -vE '^---' | head</automated>
    <automated>cd /home/ubuntu/skynet && docker run --rm -v "$PWD/docker/nginx-https.conf:/etc/nginx/nginx.conf:ro" nginx:1.27-alpine nginx -t 2>&1 | tail -5 || echo "nginx -t deferred to Plan 05"</automated>
  </verify>

  <acceptance_criteria>
    - `grep -c 'location = /voice/speak-stream' docker/nginx-https.conf` = 1.
    - `awk`-scoped grep inside the new block in nginx-https.conf finds 5 directives — count >= 5.
    - Byte-for-byte diff between the extracted blocks in nginx.conf vs nginx-https.conf produces NO output (i.e., blocks are identical inside the braces + comment).
    - `grep -c 'location ~ \^/voice(/.*)?\$' docker/nginx-https.conf` = 1 (existing regex block still present).
    - `git diff docker/nginx-https.conf | grep -E '^-\s+' | grep -vE '^---'` empty (no removed lines from existing blocks).
    - `nginx -t` syntax validation passes on nginx-https.conf (same fallback rule as Task 1: if Docker+nginx unavailable, defer to Plan 05 and note in summary).
  </acceptance_criteria>

  <done>
    New `location = /voice/speak-stream` block exists in `docker/nginx-https.conf` immediately before the existing `location ~ ^/voice(/.*)?$` block, byte-identical to Task 1's insertion in `nginx.conf` (inside the braces), and passes nginx `-t` syntax validation. Existing blocks are byte-for-byte unchanged. Both nginx configs now route `/voice/speak-stream` to the backend Express port 30001 with buffering disabled.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| public internet → nginx | Untrusted HTTPS clients hit nginx. nginx does not authenticate; it just proxies to the backend which validates JWT. |
| nginx → Express (127.0.0.1:30001) | Trusted loopback hop inside the container. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-19-N01 | Spoofing | Client sends unauthenticated request to /voice/speak-stream via nginx | mitigate | nginx does no auth; JWT check happens at Express (Plan 01). The threat is inherited posture, not introduced by this plan. Non-issue provided Plan 01 wired `authenticateJWT` correctly. |
| T-19-N02 | Tampering | Attacker modifies nginx config to strip auth-header forwarding | accept | Config file is source-controlled; modification requires repo commit + deploy. Same posture as every other nginx location in this file. Backup mitigation: `proxy_set_header Host $http_host` is present; the Authorization header is forwarded by default when no explicit `proxy_set_header Authorization` overrides it (nginx passes all client headers through when not explicitly overridden). |
| T-19-N03 | Information Disclosure | Missing block in one of the two nginx files causes /voice/speak-stream to 200 with index.html contents | mitigate | Task 2 acceptance criterion enforces byte-identical block presence in both files; grep count = 1 in each; the CLAUDE.md caveat is elevated to a first-class check. Post-deploy `curl -N https://term.gigaashley.click/voice/speak-stream ...` in Plan 05 UAT catches any regression. |
| T-19-N04 | Denial of Service | Long-running streaming request pins an nginx worker | mitigate | `proxy_read_timeout 300s` bounds the upstream wait, matching the backend AbortController cap. nginx worker_connections default is sufficient for Skynet's fleet-of-one traffic pattern; no tuning change needed. |
| T-19-N05 | Elevation of Privilege | Regex `~ ^/voice(/.*)?$` block matches `/voice/speak-stream` and applies default `proxy_buffering on` | mitigate | Exact-match `location = /voice/speak-stream` takes precedence per nginx location matching rules (equals-prefix beats regex). Task 1's acceptance test scopes the awk extraction to the new block, proving the buffering directives are present. Curl smoke test in Plan 05 confirms end-to-end chunked delivery. |
| T-19-N06 | Denial of Service | Missing `X-Accel-Buffering: no` interaction with nginx | mitigate | Plan 01 sets `X-Accel-Buffering: no` on the backend response as a defense-in-depth signal to nginx to disable buffering on this response specifically (in addition to the location-block-level `proxy_buffering off`). Both mechanisms belt-and-suspenders. |
| T-19-SC | Tampering | Package installs | accept | No package installs in this plan. |
</threat_model>

<verification>
Run at plan completion:
1. `grep -c 'location = /voice/speak-stream' docker/nginx.conf` = 1 AND `grep -c 'location = /voice/speak-stream' docker/nginx-https.conf` = 1 (both files updated — CLAUDE.md caveat satisfied).
2. `diff <(awk '/location = \/voice\/speak-stream/,/^        }/' docker/nginx.conf) <(awk '/location = \/voice\/speak-stream/,/^        }/' docker/nginx-https.conf)` prints nothing (blocks match).
3. Existing regex `/voice` block still present in both files: `grep -c 'location ~ \^/voice(/.*)?\$'` = 1 in each.
4. `nginx -t` passes on both files (via docker or local nginx binary; deferred to Plan 05 if neither available in executor sandbox).
5. `git diff --stat docker/nginx.conf docker/nginx-https.conf` shows +N/-0 for each — additive only, no deletions.
</verification>

<success_criteria>
Requirement satisfied by this plan:
- TTSSTR-03: New `location = /voice/speak-stream` block in BOTH `docker/nginx.conf` and `docker/nginx-https.conf` with `proxy_buffering off`, `proxy_request_buffering off`, `chunked_transfer_encoding on`, and `proxy_read_timeout 300s`. Existing `/voice/speak` regex block untouched (patch #232 tuning preserved). Caddy edge streams chunked-transfer by default — end-to-end `curl -N` verification is part of Plan 05's UAT checklist.
</success_criteria>

<output>
Create `.planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-02-SUMMARY.md` when done, using the template in `$HOME/.claude/get-shit-done/templates/summary.md`. Summary must include:
- Grep counts confirming both files have the new block.
- Diff-empty confirmation that the two blocks are byte-identical inside the braces.
- `nginx -t` output for both files (or explicit "deferred to Plan 05" note with the reason — Docker/nginx not available in sandbox).
- `git diff --stat` output showing +N/-0 (additive) for both files.
</output>

# Phase 19 Build Verification Log

**Executor:** Claude (executor for Plan 05)
**Timestamp:** 2026-07-31T23:54:53Z
**Branch:** feat/tab-title-from-tmux

---

## Command 1: TypeScript strict-mode check

```
$ cd /home/ubuntu/skynet && npx tsc --noEmit
(no output — clean)
TSC_EXIT=0
```

**Result:** PASS

---

## Command 2: Full vitest suite

```
$ cd /home/ubuntu/skynet && npx vitest run

 RUN  v4.1.8 /home/ubuntu/skynet

Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
Not implemented: HTMLMediaElement's play() method
[... jsdom not-implemented warnings — expected, pre-existing, non-fatal ...]

 Test Files  85 passed (85)
      Tests  1016 passed | 6 skipped (1022)
   Start at  23:54:57
   Duration  132.13s (transform 5.23s, setup 1.98s, import 33.43s, tests 25.26s, environment 53.34s)

VITEST_EXIT=0
```

**Result:** PASS
**Test count summary:** Test Files 85 passed | Tests 1016 passed | 6 skipped — 0 failed

---

## Command 3: Vite production build

```
$ cd /home/ubuntu/skynet && npm run build
[build output — full asset table]

dist/assets/index-BAOiePJM.css                                    210.29 kB │ gzip:  34.27 kB
dist/assets/rolldown-runtime-Cyuzqnbw.js                            0.82 kB │ gzip:   0.47 kB
dist/assets/main-axios-BB00kuN7.js                                105.19 kB │ gzip:  35.93 kB
dist/assets/ui-vendor-DSaH51Kg.js                                 120.09 kB │ gzip:  40.19 kB
dist/assets/index-CpShkvro.js                                     173.36 kB │ gzip:  52.21 kB
dist/assets/react-vendor-CCoUBvV1.js                              181.79 kB │ gzip:  57.19 kB
dist/assets/Terminal-BrZHVRPX.js                                  258.37 kB │ gzip:  64.12 kB
dist/assets/terminal-vendor-BNMuj_xc.js                           385.92 kB │ gzip: 103.46 kB
dist/assets/codemirror-gY05MbGv.js                                398.06 kB │ gzip: 128.56 kB
[... additional locale bundles ...]

✓ built in 4.05s
BUILD_EXIT=0
```

**Result:** PASS
**Assets emitted:** Main JS bundle `index-CpShkvro.js` 173.36 kB (gzip: 52.21 kB) | CSS `index-BAOiePJM.css` 210.29 kB (gzip: 34.27 kB) | Built in 4.05s

---

## Command 4: Nginx syntax validation

**Context:** Both `docker/nginx.conf` and `docker/nginx-https.conf` are envsubst templates — they contain `${PORT}`, `${SSL_PORT}`, `${SSL_CERT_PATH}`, `${SSL_KEY_PATH}` placeholders that are substituted by the nginx docker container entrypoint at runtime. Running a bare `nginx -t` against the raw template files fails on the `${PORT}` `listen` directive — this is not a config syntax error, it's the expected behavior of an envsubst template being tested outside its runtime context.

**Method used:** Performed `envsubst` on each file with test values, then ran `docker run --rm ... nginx:1.27-alpine nginx -t`. Both configs printed **"nginx: the configuration file /etc/nginx/nginx.conf syntax is ok"** — confirming the directive syntax is valid. The subsequent "test failed" message (exit 1) is caused by the container's `/tmp/nginx/nginx.pid` path not existing in the bare container filesystem (the Skynet container entrypoint creates `/tmp/nginx/` before starting nginx; the bare test image does not), NOT by a config syntax error.

```
$ PORT=8080 envsubst '${PORT}' < docker/nginx.conf > /tmp/nginx-http.conf
$ docker run --rm -v /tmp/nginx-http.conf:/etc/nginx/nginx.conf:ro nginx:1.27-alpine nginx -t
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: [emerg] open() "/tmp/nginx/nginx.pid" failed (No such file or directory)
nginx: configuration file /etc/nginx/nginx.conf test failed
NGINX_HTTP_EXIT=1 (exit 1 due to /tmp/nginx/ path, NOT syntax error — "syntax is ok" confirmed above)

$ PORT=8080 SSL_PORT=8443 SSL_CERT_PATH=/tmp/test-cert.pem SSL_KEY_PATH=/tmp/test-key.pem \
    envsubst '${PORT} ${SSL_PORT} ${SSL_CERT_PATH} ${SSL_KEY_PATH}' \
    < docker/nginx-https.conf > /tmp/nginx-https.conf
$ docker run --rm \
    -v /tmp/nginx-https.conf:/etc/nginx/nginx.conf:ro \
    -v /tmp/test-cert.pem:/tmp/test-cert.pem:ro \
    -v /tmp/test-key.pem:/tmp/test-key.pem:ro \
    nginx:1.27-alpine nginx -t
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: [emerg] open() "/tmp/nginx/nginx.pid" failed (No such file or directory)
nginx: configuration file /etc/nginx/nginx.conf test failed
NGINX_HTTPS_EXIT=1 (exit 1 due to /tmp/nginx/ path, NOT syntax error — "syntax is ok" confirmed above)
```

**Speak-stream block presence verified:**
```
grep -n "speak-stream" docker/nginx.conf docker/nginx-https.conf
docker/nginx.conf:235:        # Patch #237 (Phase 19): /voice/speak-stream — Chatterbox streaming TTS
docker/nginx.conf:248:        location = /voice/speak-stream {
docker/nginx-https.conf:246:        # Patch #237 (Phase 19): /voice/speak-stream — Chatterbox streaming TTS
docker/nginx-https.conf:259:        location = /voice/speak-stream {
```

**Result:** SYNTAX_OK — Both configs pass "syntax is ok" from nginx. The test exit code is 1 due to the missing `/tmp/nginx/` runtime directory in the bare nginx:1.27-alpine image — this is a test-environment limitation, not a config error. The `location = /voice/speak-stream` block is confirmed present in both files.

**Note:** Ashley may optionally run `docker exec skynet nginx -t` on skynet-ec2 post-deploy to get a definitive in-container validation. This is informational (not a deploy blocker) since the syntax check passed.

---

## Overall verdict

- [x] TypeScript check: PASS (TSC_EXIT=0, zero errors)
- [x] Test suite: PASS (VITEST_EXIT=0, 1016 passed / 6 skipped / 0 failed across 85 files)
- [x] Production build: PASS (BUILD_EXIT=0, built in 4.05s)
- [x] Nginx syntax (both configs): SYNTAX_OK — both print "syntax is ok"; test exit 1 is a /tmp/nginx/ path artifact of the bare alpine test image, NOT a config syntax error. location = /voice/speak-stream confirmed in both files.

**Ready for deploy — hand off to Ashley for greenlight per deploy-runbook. All three primary checks PASS; nginx syntax verified clean via the "syntax is ok" line in both configs.**

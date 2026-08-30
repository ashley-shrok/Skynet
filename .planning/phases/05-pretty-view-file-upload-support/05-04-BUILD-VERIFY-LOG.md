# Phase 05 Plan 04 Task 1 — build verification log

**Run at:** 2026-07-20T12:03:32Z
**Working copy:** /home/ubuntu/skynet on `feat/tab-title-from-tmux` at `ce38add`
**Purpose:** Paper trail proving Plans 05-01/02/03 shipped clean into `dist/` before Task 4's deploy checkpoint.

---

## Step A — Clean build

```
$ npm run build
...
dist/assets/index-B_aYXiSO.js                                       332.06 kB │ gzip: 101.84 kB
dist/assets/terminal-vendor-CRHct11n.js                             385.92 kB │ gzip: 103.46 kB
dist/assets/AppShell-DuS0EIOL.js                                    437.68 kB │ gzip:  84.11 kB
dist/assets/graph-vendor-CMfBJNHb.js                                438.72 kB │ gzip: 139.39 kB
dist/assets/file-preview-vendor-BiN9N__o.js                       1,263.62 kB │ gzip: 414.19 kB
dist/assets/codemirror-DmmvekjV.js                                1,608.47 kB │ gzip: 568.29 kB

✓ built in 7.23s
[plugin builtin:vite-reporter]
(!) Some chunks are larger than 1000 kB after minification. Consider:
- Using dynamic import() to code-split the application
```

**Result:** GREEN. Build completes in 7.23s. No `error TS`, no `[vite]` errors. The chunk-size warning is a long-standing informational note from `file-preview-vendor` and `codemirror` (both pre-Phase-05) — not a blocker.

---

## Step B — Backend Phase 5 artifacts in dist

```
$ grep -c 'case "upload_start":' dist/backend/backend/ssh/terminal.js
1
$ grep -c 'case "upload_chunk":' dist/backend/backend/ssh/terminal.js
1
$ grep -c 'case "upload_abort":' dist/backend/backend/ssh/terminal.js
1
$ grep -c 'handleUploadStart' dist/backend/backend/ssh/terminal.js
2
$ ls -la dist/backend/backend/ssh/pretty-view-upload.js
-rw-rw-r-- 1 ubuntu ubuntu 19607 Jul 20 12:03 dist/backend/backend/ssh/pretty-view-upload.js
$ grep -c 'sanitizeFilenameForUpload\|handleUploadStart\|handleUploadChunk' dist/backend/backend/ssh/pretty-view-upload.js
4
```

**Result:** GREEN.
- All three new WS cases present exactly once each.
- `handleUploadStart` = 2 (import + call site).
- Orchestrator module ships (19,607 bytes).
- Orchestrator exports named + reachable in bundle.

---

## Step C — Frontend Phase 5 artifacts in dist (Vite tree-shake survivorship)

Names are mangled by Vite's minifier (`terser`) for internal exports — hooks/components that aren't the public entry are re-bound to short identifiers like `Dr`, `Cn`, etc. So the strategy is: assert **characteristic strings and constants** (which survive because they're string literals) rather than exported identifiers.

```
$ grep -c '\-\-\- attached files \-\-\-' dist/assets/*.js | awk -F: '{sum+=$2} END {print sum}'
1     # INJECTED_DELIMITER constant survived tree-shake (lives in AppShell bundle)

$ grep -c 'webkitGetAsEntry' dist/assets/*.js | awk -F: '{sum+=$2} END {print sum}'
2     # folder-detection code path shipped (hook + fallback)

$ grep -c 'upload_chunk' dist/assets/*.js | awk -F: '{sum+=$2} END {print sum}'
1     # WS protocol case literal shipped (chunk pump)

$ grep -c 'Drop files here' dist/assets/*.js | awk -F: '{sum+=$2} END {print sum}'
2     # DropOverlay visible-text literal shipped

$ grep -c 'please attach files or zip' dist/assets/*.js | awk -F: '{sum+=$2} END {print sum}'
1     # folder-drop nudge text shipped

$ grep -c 'attached files' dist/assets/*.js | awk -F: '{sum+=$2} END {print sum}'
1     # formatInjectedUserTurn/parseInjectedUserTurn body-characteristic
```

**Result:** GREEN. Every Phase 5 frontend feature has at least one visible-string proof of survivorship in dist. Identifiers `usePrettyViewUploads`, `AttachmentChipStrip`, `DropOverlay`, `useIsTouchDevice`, `parseInjectedUserTurn`, `formatInjectedUserTurn` are all mangled by Vite/Terser — this is expected behavior for internal (non-public-entry) exports.

---

## Step D — Load-bearing prior-patch bytes in dist

```
$ grep -c 'message_queue_delete_on_send' dist/backend/backend/ssh/terminal.js
1     # patch #60 log-op marker present — atomic delete-on-send intact

$ grep -c 'ssh_input_delayed_enter' dist/backend/backend/ssh/terminal.js
1     # patch #100 log-op marker present — split-and-delay Enter intact

$ grep -c 'pointer: coarse' dist/assets/*.js | awk -F: '{sum+=$2} END {print sum}'
1     # patch #102 useIsTouchDevice matchMedia query string present

$ grep -c 'putComposeDraft\|flushComposeDraftKeepalive' dist/assets/*.js | awk -F: '{sum+=$2} END {print sum}'
0     # NAMES MANGLED — see follow-up below

$ grep -c 'compose-draft' dist/assets/*.js | awk -F: '{sum+=$2} END {print sum}'
1
$ grep -oE '.{60}compose-draft.{60}' dist/assets/Terminal-Cyyq-xMQ.js | head -2
e)};return t!=null&&(n.tmuxSession=t),{body:(await De.get(`/compose-drafts`,{params:n})).data?.body??``}}catch(e){throw Error(H(e))}}
)}}function Dr(e,t,n){try{let r=`${De.defaults.baseURL??``}/compose-drafts`;fetch(r,{method:`PUT`,headers:{"Content-Type":`applicatio`
```

**Result:** GREEN. Patch #57 machinery IS in `dist/assets/Terminal-Cyyq-xMQ.js` — the function names got mangled (`Dr` etc.) but the `/compose-drafts` URL string survives in both the GET (getComposeDraft) and PUT/fetch (putComposeDraft) call sites. Grep-gate was too strict when authored at plan-write time; the correct post-tree-shake gate for patch #57 is `grep -c 'compose-draft' dist/assets/*.js` (returns ≥ 1). Updated in `05-PATCHES-MD-ENTRY.md`'s post-deploy verify block.

Patches #60, #100 (backend log-op strings) and #102 (matchMedia string) survive verbatim as expected — string literals aren't mangled.

---

## Step E — Diff scope (no unintended source creep)

```
$ git diff --stat src/ui/features/terminal/Terminal.tsx
(empty)     # committed via Plan 03 beef578

$ git diff --stat src/backend/ssh/terminal.ts
(empty)     # committed via Plan 01 8b1225f

$ git diff --stat docker/nginx.conf docker/nginx-https.conf
(empty)     # Phase 5 rides existing /ssh/websocket/ — zero nginx changes

$ git diff --stat package.json package-lock.json
(empty)     # zero new npm dependencies (ssh2 SFTP already in tree from file-manager)
```

**Result:** GREEN. Zero uncommitted changes to Phase-5-relevant source. Zero touches to nginx configs. Zero new npm dependencies.

---

## Byte-identity guard (patches #60 + #100 protection)

```
$ bash scripts/verify-input-case-unchanged.sh src/backend/ssh/terminal.ts
verify-input-case-unchanged: OK (sha256=d8932a8db3a420b61d2792cef0c8d39c15b80c94c4c43252cf5127db17d47709)
$ echo $?
0
```

**Result:** GREEN. The `case "input":` block in backend `terminal.ts` matches the Plan 01 pinned sha256 exactly — patches #60 + #100 are byte-identical to pre-Phase-05. No drift.

---

## Test suite + typecheck

```
$ npx tsc --noEmit --skipLibCheck
(no output)
$ echo $?
0

$ npx vitest run
...
 Test Files  35 passed (35)
      Tests  409 passed (409)
   Start at  12:05:27
   Duration  41.64s
```

**Result:** GREEN. Zero TS errors project-wide. 409/409 tests pass across 35 files (matches Plan 03 summary's final count exactly — no regression).

---

## Summary — all Task 1 acceptance criteria met

- [x] `npm run build` clean — `built in 7.23s`, no `error TS`, no `[vite]` errors
- [x] Backend upload cases in dist — grep = 1 each for `case "upload_start":`, `case "upload_chunk":`, `case "upload_abort":`
- [x] `dist/backend/backend/ssh/pretty-view-upload.js` exists (19,607 bytes)
- [x] Patch #60 marker in dist — `message_queue_delete_on_send` ≥ 1
- [x] Patch #100 marker in dist — `ssh_input_delayed_enter` ≥ 1
- [x] Frontend INJECTED_DELIMITER survived tree-shake — `--- attached files ---` ≥ 1
- [x] Patch #102 marker in dist — `pointer: coarse` ≥ 1
- [x] Patch #57 machinery in dist — `/compose-drafts` URL literal in 2 call sites (grep-gate updated from name-based to URL-based per tree-shake observation)
- [x] Zero diff on `docker/nginx.conf` + `docker/nginx-https.conf`
- [x] Zero diff on `package.json` + `package-lock.json`
- [x] Byte-identity guard passes — `case "input":` sha256 matches Plan 01 pin exactly
- [x] Full test suite 409/409, tsc clean

**Conclusion:** what's in `dist/` IS what Plans 01-03 built. Ready for Task 4's deadman-armed deploy sequence (tina executes directly in the main context).

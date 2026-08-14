# Phase 40 UAT Checklist — In-app text editor for agent-served tailnet files (D-01..D-07)

**Target:** Ashley
**Timing:** After `docker compose up -d --force-recreate skynet` completes AND the HTTP2_PROTOCOL_ERROR first-hard-refresh known-issue (patch #232 discovery) has been cleared.
**URL:** https://term.gigaashley.click
**Estimated duration:** ~10 minutes (7 items + optional bonus mobile check)

Each of the 7 items verifies exactly one LOCKED decision from `40-CONTEXT.md § Decisions` (D-01..D-07). If any item FAILS, escalate that decision's failure mode back to the executor rotation before proceeding to public shipment.

---

## Preconditions

- Skynet deployed to https://term.gigaashley.click via the maintainer's deploy motion (git pull --rebase → coord-room BEFORE announce → docker build → deadman-guarded docker compose up --force-recreate → HTTPS 200 verify).
- Ashley's browser is at HEAD of `feat/tab-title-from-tmux` + Phase 40 patches are live (verify by loading https://term.gigaashley.click; hard-refresh once if the first-load HTTP2_PROTOCOL_ERROR appears).
- At least one fleet agent has served Ashley a tailnet URL via the id skill's `python3 -m http.server` serve pattern (see id-skill § "Sending files to the user"). If unsure whether one is available in a recent conversation, walk the **Ash-side prep** section below first.
- No dev-tools / no `docker exec` / no shell required for any of the 7 items. Every check is UI-observable on the production Skynet PWA (desktop AND iPhone).

---

## Ash-side prep

Before starting the walk, get an agent-served URL into a pretty-view conversation:

- Ask an agent (e.g. "tanya, please serve me the current 40-CONTEXT.md via the id skill's serve pattern so I can UAT the text editor") — the agent's response will be the assistant-role message that carries the tailnet URL Ashley walks Item 1 with.
- The URL will look like `http://100.x.y.z:PORT/40-CONTEXT.md` where `100.x.y.z` is the agent's tailnet IP and `PORT` is the ephemeral port the agent's `python3 -m http.server` bound to.
- Keep the message visible in the pretty-view pane — items 1-6 all reference it.
- Have the agent optionally serve a SECOND file with a different extension for Item 2 byte-sniff coverage (e.g. an extensionless `notes` file or a `.dat` file whose bytes are actually text).

---

### 1. D-01: Passive URL detection (agent-served link appears with edit affordance)

**Verifies decision D-01 verbatim:** "Skynet passively watches agent messages for served-tailnet HTTP URLs — the pattern canonicalized in the id skill's 'Sending files to the user' section. NO new primitive on the agent side. Agents keep serving files exactly as they do today; Skynet does all the enrichment."

**Setup:**
- Have the message from Ash-side prep visible in pretty-view (an assistant message containing a `http://100.x.y.z:PORT/filename.ext` URL).

**Steps:**
1. Look at the agent message that carries the tailnet URL.
2. **Desktop:** hover the message bubble. A pencil glyph (warm-coral color at rest) should fade in next to the link within ~120ms.
3. **Mobile (iPhone PWA):** the pencil glyph should already be visible (~72% opacity) next to the link — no hover needed.

**Expected:**
- The link renders as a normal clickable anchor (target `_blank`, opens in a new tab on click).
- A separate pencil-icon affordance appears **next to** the link (sibling, not wrapper).
- The agent did NOT do anything special to trigger this — this is the passive Skynet-side detection.

**Fail modes:**
- No affordance appears → check the URL matches the CGNAT regex (`100.64.0.0/10`) and the extension is in the whitelist. If the extension is exotic, this is really Item 2 territory.
- The link renders as PLAIN TEXT (not clickable) → ReactMarkdown link rendering regressed independently.
- Agent had to send a NEW message-type or add a `@editable` marker → D-01 principle is violated. Regression, escalate.

---

### 2. D-02: Extension whitelist first, byte-sniff fallback

**Verifies decision D-02 verbatim:** "**Extension whitelist first** — wholesale acceptance for common cases: markdown, plain text, config formats, source code, plus specific extensionless basenames (Dockerfile, Makefile, .gitignore, …). **Byte-sniffing as fallback** — for files that miss the whitelist, inspect bytes to catch extensionless-but-text."

**Setup:**
- Have TWO agent-served files in view: (a) the `.md` file from Item 1, (b) an extensionless-but-text file the agent served (e.g. ask "serve me a file called 'notes' — just plain text, no extension"). Optionally add a THIRD: a small `.png` with no extension in the URL (the agent renames it before serving), to confirm binary detection.

**Steps:**
1. Look at file (a) — the `.md` file. The affordance should be **immediately visible** on message arrival (no perceptible delay — the whitelist check is synchronous, no backend fetch needed).
2. Look at file (b) — the extensionless-but-text file. The affordance should appear after a **~200-500ms delay** (the frontend's `useEditableFileEligibility` hook fires the async fetch → backend runs `sniffTextBytes` → returns `isTextByBytes: true` → Set updates → affordance renders).
3. If you tested a third link to a binary-with-no-extension file: the affordance should **never appear** for that URL (backend sniffs bytes → returns `isTextByBytes: false` → hook does not add URL to Set → no affordance).

**Expected:**
- (a) instant affordance (sync whitelist path).
- (b) delayed-then-appears affordance (async byte-sniff path).
- (c) if tested: never-appearing affordance for binary-with-no-extension.

**Fail modes:**
- (a) has a delay too → sync whitelist path was not exercised; the frontend twin whitelist may have diverged from the backend, OR the hook may be re-doing the backend's job unnecessarily.
- (b) never appears → the byte-sniff fallback isn't reachable. Check that the file's URL doesn't match the whitelist (double-check basename + extension) and that the backend `POST /pretty-view/fetch-tailnet-url` is returning `{isTextByBytes: true}` for that URL.
- (c) affordance DOES appear on binary → sniff heuristic is misclassifying — but per the LOCKED shape decision, "false-positive tolerance is acceptable" (Ashley won't save garbage), so this is a warn-only fail. Note it for a future whitelist-tightening pass, not a phase-blocker.

---

### 3. D-03: Additive-not-replacive (clicking the link still downloads/opens as before)

**Verifies decision D-03 verbatim:** "**Additive, not replacive.** The existing link behavior stays — Ashley can still click through, download, or interact with the link exactly the way she can today. The edit affordance is a NEW action that appears ALONGSIDE the link, never in place of it."

**Setup:**
- Same eligible link from Item 1 in view. Affordance visible (via hover on desktop, or always-visible on mobile).

**Steps:**
1. Click **the link text itself** (NOT the pencil icon).
2. Observe the new-tab / download / native behavior.

**Expected:**
- The link opens in a new browser tab (target=`_blank` preserved) — pointing at the agent's tailnet URL.
- The pretty-view pane stays exactly where it was; no modal opens.
- If the file is short and the browser previews it (e.g. a `.md` file may render as raw text in a tab), that's the browser's default behavior — nothing Skynet is intercepting.

**Fail modes:**
- Clicking the link opens the **editor modal** instead of a new tab → sibling-not-wrapper structure regressed. This is a P0 shape violation — escalate immediately. The affordance became a hijacker instead of a peer.
- The link is un-clickable → anchor semantics regressed (target/href stripped by the ReactMarkdown override).
- New tab opens BUT the modal ALSO opens → click bubbled from anchor into the affordance via a shared parent event handler. Escalate — anchor-only click semantics must be preserved.

---

### 4. D-04: Fresh re-fetch at edit-open + visible failure on stale server

**Verifies decision D-04 verbatim:** "**Fresh re-fetch at edit-open time** to get current bytes when Ashley taps edit. **If the re-fetch fails, Skynet errors explicitly.** Do NOT silently fall back to the detection-time cached bytes. Visible failure over silent maybe-stale."

**Setup:**
- Same eligible link from Item 1. Note the time of the agent's message (the agent's `python3 -m http.server` auto-kills after 30 minutes per the id-skill `sleep 1800; kill "$PID"` block).

**Steps — Happy path (within 30 min of the agent serving the file):**
1. Click the pencil affordance next to the link.
2. Observe the modal opening. Skeleton loading state appears briefly (2-3 stacked skeleton bars).
3. Skeletons cross-fade to a textarea populated with the file's current bytes.

**Steps — Failure path (30+ minutes after the agent served the file, OR ask the agent to kill their `python3 -m http.server` process manually):**
4. Wait 30+ minutes after the agent's message, OR ask the agent to `kill %1` (or similar) on their serving process.
5. Click the same pencil affordance.
6. Observe the modal opening. Skeleton loading state appears briefly.
7. Skeletons cross-fade to an **error message** that reads:
   - Heading: **"Can't fetch the current file."**
   - Body: **"The agent's temporary server may have shut down (they auto-kill after 30 minutes) or the network is unreachable. Ask the agent to re-share the file if you still want to edit it."**
   - A single **Close** button below.
8. A sonner error toast fires: **"Couldn't fetch {filename} — see modal."**

**Expected:**
- Happy path: fresh bytes in the textarea (edit them and save — they should be what the agent has served RIGHT NOW, not what was served an hour ago).
- Failure path: explicit error copy + toast. **Modal did NOT silently open with the detection-time cached bytes.**

**Fail modes:**
- Modal opens with stale content on the failure path → D-04 shape violation. Escalate — this is the load-bearing "visible failure over silent maybe-stale" invariant.
- Failure path shows a bare toast but no in-modal error → the error is invisible if the modal is dismissed before Ashley reads it. Escalate — the copy must be in-body.
- Failure path shows a blank textarea with no error text → error branch is not routing correctly; check `TabState.error(...)` path in the modal source.

---

### 5. D-05: Reused Global Files modal chrome, minus host picker, minus tabs

**Verifies decision D-05 verbatim:** "**Reuse the existing Global Files edit modal** — same modal shell, same editor guts, same look/feel across desktop and mobile. **Strip the host picker** — irrelevant here because Skynet already knows exactly which file is being edited. **Strip the multi-file tab system at the bottom** — this editor works on ONE file at a time."

**Setup:**
- Same eligible link. Modal open (from Item 4 happy path). If you closed it, click the pencil affordance again.

**Steps:**
1. Compare the editor modal chrome visually against the Global Files edit modal that Ashley uses today (open a Global Files modal in a separate tab or by memory — Portal + Overlay + Content, backdrop-filter blur, blue-glass gradient, `inset-4` positioning).
2. Look at the modal HEADER. The title should read **"Edit {filename}"** (e.g. "Edit 40-CONTEXT.md") + optional sub-header **"from {agentIdentityName}"** (e.g. "from tanya") if the agent's identity resolved.
3. Look at the modal for a **host picker `<select>` dropdown**. There should be NONE.
4. Look at the modal for a **bottom tabs bar** (Global Files' multi-file tabs strip). There should be NONE.
5. **Mobile check:** on iPhone PWA, the modal covers the full viewport minus a 16px inset on every edge. iOS Safari safe-area padding should be respected (no content clipped by the notch or home indicator).

**Expected:**
- Same visual chrome as Global Files (Portal, blue-glass, `inset-4`, X close button).
- No host picker.
- No bottom tabs.
- Header shows `Edit {filename}` + optional `from {agentIdentityName}` sub-header.
- Mobile: full-viewport modal minus 16px inset, safe-area respected.

**Fail modes:**
- Host `<select>` visible in the header → D-05 strip-decisions not honored.
- Tabs bar visible at the bottom → D-05 strip-decisions not honored.
- Modal chrome looks NOTHING like Global Files (different border, different overlay opacity, different corner radius) → the forked-chrome pattern drifted or the copy was incomplete.
- iOS PWA: content clipped by notch or bottom clipped by home indicator → safe-area handling regressed (though this is likely inherited from Skynet's `100vh` fix at src/ui/index.css L337-339, verify it's still present).
- Header shows the raw URL instead of `Edit {filename}` → filename extraction regressed (Pitfall 8: URL `?query` may not have been stripped before `.split('/').pop()`).

---

### 6. D-06: Save deposits fresh attachment into ComposeBox (multi-version support)

**Verifies decision D-06 verbatim:** "**Save deposits the edited file into the composebox as a new attachment.** **Editor is stateless.** Every save produces a fresh attachment. **Deliberate consequence:** editing three times and saving three times produces three attachments. The composebox's existing remove affordance handles 'changed my mind.'"

**Setup:**
- Same eligible link. Modal open with textarea populated.

**Steps:**
1. Type an edit into the textarea (add a line of text at the top or bottom — anything that makes the draft different from the initial content).
2. Click **Save**. The button label briefly reads "Saving…" then the modal closes.
3. Look at the ComposeBox at the bottom of the pretty-view pane. A **chip** should appear in the attachment strip showing the edited file's name (e.g. "40-CONTEXT.md").
4. A sonner success toast fires: **"Attached {filename} to your reply"**.
5. Click the pencil affordance for the SAME file link a second time. Modal re-opens with the AGENT'S ORIGINAL content (NOT your previous draft — the editor is stateless).
6. Type a DIFFERENT edit. Click Save.
7. Observe the ComposeBox — a **SECOND** chip appears alongside the first (same filename OR filename with a version suffix, depending on how the chip strip disambiguates — either is acceptable per the LOCKED "deliberate multi-version support").
8. Click the × on one of the chips (whichever). It disappears. This is the existing ComposeBox remove affordance — unchanged.

**Expected:**
- Save → modal closes → chip appears → success toast fires.
- Re-open of the same file starts from agent's original (not your previous draft).
- Two saves → two chips.
- × on a chip removes it.

**Fail modes:**
- Save clicked but modal doesn't close → the `onOpenChange(false)` path is broken (possibly the draft-guard confirm gate is firing incorrectly on save-success — check `savingRef` bypass).
- Modal closes but no chip appears → `uploads.stageAttachments("primary", [file])` wiring broken. This is the D-06 wire-through failure.
- Chip appears but with the wrong filename (e.g. `noname` or URL-encoded gibberish) → filename extraction regressed (Pitfall 8 again).
- Re-open shows the previous draft → editor became stateful; LOCKED "editor is stateless" invariant violated. Escalate.
- Two saves → one chip (chip strip de-dupes by filename) → multi-version support was silently broken by ComposeBox chip logic. Verify against existing ComposeBox behavior for user-picked-then-re-picked attachments; if that ALSO de-dupes, the ComposeBox is the culprit and this is a fleet-wide issue, not a Phase 40 regression.
- × removes the chip AND deletes the file from the agent's box → REPLACIVE write-back happened. Escalate — the return trip is attachment-based only.

---

### 7. D-07: Return trip via existing reply-with-attachment pipeline

**Verifies decision D-07 verbatim:** "Uses Skynet's existing reply-with-attachment path (well-worn, occasional upload bugs but no fundamental flaws). NO new agent-side receive convention — agents already know how to read attachments Ashley sends them. The symmetry is: agent serves a link (their existing pattern), Ashley replies with an attachment (her existing pattern). All novelty lives inside Skynet, in the middle."

**Setup:**
- ComposeBox has at least one chip mounted from Item 6 (an edited version of the agent's file).

**Steps:**
1. Type a caption in the ComposeBox (e.g. "Here's my edit — added a note at the top about the timing").
2. Click **Send**.
3. Observe the message going through: your caption + the file(s) as attachments should appear in the conversation as Ashley's turn.
4. Ask the agent: "can you cat the file I just sent?" (or the equivalent — the agent's identity skill should already know how to read attachments from Ashley's message).
5. The agent replies with the file's contents — INCLUDING your edit.

**Expected:**
- Send succeeds via the existing Phase 05 upload pipeline (well-worn — see UPLOAD-10 for the `~/pretty-view-uploads/<date>/<time>-<name>` deposit path).
- Agent can access the attached file via the standard mechanism (their identity skill handles the read).
- Agent's cat of the file shows your edited content (not the original).

**Fail modes:**
- Send fails → the reply-with-attachment path is broken; this is Phase 05 territory, not Phase 40 (but if it started failing between the last Phase-05 UAT and now, escalate as a Phase 40 side-effect).
- Agent says "I don't see any file" → deposit landed at a different path than the agent expects, OR the agent's identity skill is not reading it. Verify via `docker exec` (maintainer) that the file is present at `~/pretty-view-uploads/<date>/<time>-<name>`.
- Agent sees the file but it's EMPTY → the save closure passed empty content to `stageAttachments`. Check `handleStageEditedFile` in PrettyView.tsx.
- Agent sees the file but with WRONG content (e.g. the original bytes, not your edit) → the save handler snapshotted the initial content instead of the current draft. Check `handleSave` in EditableFileModal.tsx.
- Agent's cat shows the filename with mangled characters (URL-encoded gibberish or truncated) → filename decode regressed (Pitfall 8: `decodeURIComponent` + `pathname.split('/').pop()` should produce a clean name).

---

## Bonus — Full iPhone PWA walk

If items 1-7 all pass on desktop, repeat items 1-6 on the iPhone PWA to confirm the LOAD-BEARING mobile case (the whole reason for this phase's existence — see shape doc: "On mobile, the workflow has no viable equivalent at all").

**Specific mobile checks:**
- Item 1 mobile branch (always-visible-72%-opacity affordance) works.
- Item 5 mobile check (full-viewport modal minus 16px inset, safe-area respected) works.
- Textarea is comfortable to type into on iPhone (min-h 400px, no iOS drag-handle chrome).
- Save button is tap-reachable at bottom-right.
- Draft-guard `window.confirm("Discard unsaved changes?")` renders as iOS native alert (per UI-SPEC L219 — accessible, familiar).

If the desktop walk was fully green and mobile fails a specific item, note WHICH item — that helps route the fix to the right layer (touch-detection, viewport CSS, iOS-specific event handling).

---

## Rollback plan

If ANY item 1-7 fails and the failure cannot be quickly diagnosed:

1. Fleet-standard 15-minute deadman rollback timer (per CLAUDE.md § Deploy safety — no exceptions, even at keyboard).
2. Phase 40 is additive-only — specific surgical reverts are possible:
   - **Fastest revert (frontend-only, degrades gracefully):** revert the ChatMessage.tsx + PrettyView.tsx changes (commits e241adbc..7709b188 range). The affordance disappears; the anchor click behavior stays intact per D-03 additive-not-replacive. Backend proxy stays mounted but dormant (unused).
   - **Full Phase 40 revert:** `git revert 40d228ac..7709b188` (Phase 40 commit range excluding SUMMARY/docs commits). Restores pretty-view to pre-Phase-40 state. Rebuilds required.
3. Specific failure-routing guidance:
   - Item 1/2 fails (affordance never appears): eligibility hook broken — check `useEditableFileEligibility` fires with `(eventId, content)` signature and returns a non-empty Set for the tested URL.
   - Item 3 fails (link click opens modal): sibling-not-wrapper regressed — check ChatMessage.tsx `<a>` override renders Fragment with anchor AND affordance as peers, not affordance wrapping anchor.
   - Item 4 fails (stale bytes served on refetch failure): D-04 invariant regressed — check `handleOpenChange` / `TabState.error` routing in EditableFileModal.tsx.
   - Item 5 fails (host picker visible): D-05 strip-decisions regressed — grep EditableFileModal.tsx for `<select` and remove.
   - Item 6 fails (chip doesn't appear): `handleStageEditedFile` wiring broken — check `uploads.stageAttachments("primary", [file])` call in PrettyView.tsx.
   - Item 7 fails (agent doesn't see the file): Phase 05 upload pipeline issue; check `~/pretty-view-uploads/<date>/` deposit is happening.

---

## Blocking issues found during UAT

(fill in during walk; escalate any items marked FAIL back to the planning/executor rotation before proceeding to public shipment)

- Item __ — FAIL — [notes]
- Item __ — FAIL — [notes]

---

## Passed items — approved for ship

- [ ] Item 1 (D-01) — Passive URL detection
- [ ] Item 2 (D-02) — Whitelist + byte-sniff
- [ ] Item 3 (D-03) — Additive-not-replacive
- [ ] Item 4 (D-04) — Fresh refetch + visible failure
- [ ] Item 5 (D-05) — Modal chrome forked correctly
- [ ] Item 6 (D-06) — Save deposits fresh attachment (multi-version support)
- [ ] Item 7 (D-07) — Return trip via existing pipeline
- [ ] Bonus — iPhone PWA parity

Sign-off (Ashley): __________ Date: __________

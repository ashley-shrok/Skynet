# Shape: text editor in skynet

**Opened:** 2026-08-13
**Vehicle:** GSD phase

## What this is

An in-app text editor inside the Skynet chat surface that lets Ashley edit files an agent has offered her, and reply with the edited versions attached — without the current multi-agent round-trip of "send to another local agent, they open a local editor, I edit, tell the original agent to pull it back." Load-bearing case is mobile, where the current workflow has no viable equivalent at all.

## Shape

- An agent shares a file with Ashley the way agents already do — by starting a temporary tailnet server and giving her the URL. No new convention on the agent side; everything already-familiar to any identity that follows the standard file-serving pattern.
- Skynet watches messages for those URLs. When one appears, Skynet fetches the file immediately to determine whether it's editable. Eligibility is checked with an extension whitelist first (covers the common cases wholesale — markdown, plain text, config formats, source code, and so on — plus specific extensionless names like Dockerfile, Makefile, .gitignore); if the extension doesn't match, Skynet inspects the bytes as a fallback to catch extensionless-but-text files.
- Eligible files gain an edit affordance in the message bubble, **alongside** the existing link behavior — Ashley can still click the link, download it, or interact with it the way she always could. The edit affordance is additive, not replacive.
- Tapping edit fetches the file again (fresh copy from the agent's server). If that re-fetch fails — the agent's server has already been auto-killed, for example — Skynet errors out explicitly rather than silently falling back to the version it fetched during detection. Visible failure was chosen over silent maybe-stale.
- The editor itself reuses the surface Skynet already uses for editing global files — same modal, same editor guts, same look/feel across desktop and mobile. Two things from that modal do NOT come along: the host picker (irrelevant — Skynet already knows which file is being edited) and the multi-file tab system at the bottom (this editor works on one file at a time).
- Saving deposits the edited version into the composebox as a new attachment, exactly the way a user-picked attachment would appear there. The editor is stateless — every save produces a fresh attachment, and re-opening the edit affordance starts over from the agent's original.
- The edited attachment reaches the agent via Skynet's existing reply-with-attachment path, which is well-worn. If Ashley changes her mind, the composebox's built-in remove affordance handles it — no new "unstage" mechanism needed.

## Philosophy

- The pain being solved is the **wait** and the **mobile gap** — not the transport itself. On desktop, the current workflow eats seconds-to-minutes on a whole side-conversation between two agents when the actual editing takes seconds. On mobile, the workflow has no viable path at all because there's no equivalent local agent and iOS has no clean editor story for received files.
- **Passive detection** is a hard principle: agents don't have to know Skynet is doing anything. They serve files the way they always have; Skynet handles the enrichment on its side. This intentionally rules out any solution that requires teaching the fleet a new agent-side primitive.
- **Symmetric hand-off:** each side does something already familiar. Agent serves a link (already-known pattern); Ashley replies with an attachment (already-known pattern). All the novelty lives inside Skynet, in the middle.
- **Additive not replacive:** the edit affordance appears alongside the existing link behavior, never in place of it. Ashley may want to just view, download, or ignore a file — her choice per interaction. She never loses what she has today.
- **Visible failure over silent maybe-wrong:** when Skynet can't fetch the current version at edit-open time, it errors rather than falling back to potentially-stale bytes.

## Prior context

- Ashley's current workflow: an agent working with a file asks another agent (usually the one running on the box she's currently at) over the relay to receive and open it in a local text editor; she edits manually, saves, closes, and tells the original agent to pull it back. Faster than describing edits verbatim, but slow, and mobile-broken.
- Skynet already has an in-app editor surface for "global files" — same platform, mobile-adapted, with saving mechanics all built. It uses a host picker and a multi-file tab system; neither is needed here.
- The tailnet-served file pattern is well-established across the fleet (canonicalized in the identity skill's file-serving section) — agents run a temporary HTTP server on the tailnet and hand Ashley a link. Servers auto-kill after 30 minutes; content is fetchable by any tailnet member, including Skynet itself.
- Skynet's composebox already supports user-picked attachments with a remove affordance and a well-worn reply-with-attachment path. Attachments occasionally have upload bugs, but no fundamental flaws.

## What would make it wrong

- If solving this requires agents to adopt a new primitive on their side, the shape has drifted — the whole point is passive detection on the Skynet side.
- If the edit affordance replaces the link's existing behavior, Ashley has lost something she uses today.
- If Skynet silently uses stale bytes when it couldn't re-fetch, Ashley may believe she's editing the current version when she isn't — the very thing she said she'd rather see fail loudly.
- If Skynet's return path bypasses Ashley's judgment (e.g. writes back to the agent's file directly instead of going through her reply), the safety of the human-in-the-loop is gone.
- If the feature grows into a general file browser for hosts — pickers, tabs, cross-conversation state — the scope has expanded past the narrow "agent hands me a file, I edit, they get it back" flow.
- If mobile doesn't work at least as well as desktop, the load-bearing case has been missed.

## Scope edges

- **In:** text-shaped files that agents serve via tailnet links; edit-then-attach-to-reply flow; reuse of the existing global-files editor modal (minus host picker, minus tabs); extension whitelist + byte-sniff eligibility check; fetch-at-detection for the eligibility check + fresh re-fetch at open time.
- **Out:** any general file browser for hosts; any editor for files NOT offered by an agent in chat; any agent-side primitive; multi-file tabs; draft persistence / stateful editor across opens; automatic write-back to the agent's box.
- **Deferred / TBD in implementation:** the exact visual form of the edit affordance on the link within a message (Ashley flagged she doesn't have a strong picture yet); the specific extensions in the whitelist (grows over time); how re-fetch-fail errors are presented to the user.
- **Tempting-but-no:** making the edit affordance a replacement for the link's default behavior; adding multi-file tabs to edit several attachments at once; adding draft resumption ("continue where I left off") to the editor; sniffing everything without a whitelist (whitelist stays the primary path).

## Vehicle notes

GSD phase. The touch spans message rendering (adding the edit affordance to eligible links), a link-detection layer, a fetch-at-detection cache layer for eligibility, editor invocation and modal reuse (stripping tabs + host picker), editor state model, and composebox attachment integration on save — multi-file, cross-subsystem, real UAT surface. Per the fleet standing directive on not routing around phase setup, if it's phase-shaped, it's a phase.

Handoff: tiffany is the maintainer doing the work. Next step is `/gsd:phase` to slot it into the roadmap, then the standard spec → discuss → plan → execute chain from the phase directory. The Global Files edit modal is the reuse target for the editor surface; the identity skill's tailnet file-serving section documents the URL pattern being detected.

---

## Close-Out

**Closed:** 2026-08-14
**Vehicle used:** GSD phase (Phase 40 — text-editor-in-skynet), 5 plans across 4 waves
**Overall verdict:** closed-with-misses

### Shape features (conformance)

- **What this is** — present · in-app editor for agent-served files in the chat surface, reply-with-attachment on save; frontend detects tailnet URLs, backend proxies fetch, modal reuses Global Files editor guts
- **Shape — passive detection of tailnet URLs (no agent-side primitive)** — present · frontend regex scans message body; backend SSRF-hardened proxy fetches on Skynet's behalf; nothing added to the agent side
- **Shape — extension whitelist first, byte-sniff fallback (with markdown/text/config/source + Dockerfile/Makefile/.gitignore basenames)** — present · starter whitelist mirrored front/back; sniff runs only on extension miss (null-byte + printable-ratio + UTF-8 validity heuristic)
- **Shape — edit affordance additive alongside existing link** — present · anchor renders first with original target/rel; edit button renders as fragment sibling, not a wrapper
- **Shape — tap-edit fetches fresh; explicit error on failure, no silent fallback to detection-time bytes** — present · modal fires fresh fetch on every open; eligibility bytes are discarded and never handed to the editor; failure branch shows explicit in-modal copy about the 30-min auto-kill
- **Shape — editor reuses Global Files modal chrome + editor guts** — present · Portal/Overlay/Content copied verbatim; GlobalFileTab imported unchanged with a backward-compatible optional draft-change callback
- **Shape — host picker stripped; multi-file tabs stripped** — present · neither element rendered in EditableFileModal
- **Shape — save deposits fresh attachment; editor stateless across opens** — present · handleStageEditedFile constructs a new File and calls uploads.stageAttachments primary; modal resets all state on close so re-open starts from the agent's original
- **Shape — edited attachment returns via existing reply-with-attachment path; remove flow via composebox chip** — present · zero new plumbing on the return trip; existing ComposeBox send + AttachmentChipStrip handle it
- **Philosophy — solves the wait / mobile gap** — present · modal reuses mobile-adapted Global Files surface; affordance has explicit 44x44 touch target and mobile always-visible treatment
- **Philosophy — passive detection** — present · agents keep serving files exactly as they do today
- **Philosophy — symmetric hand-off (link in, attachment out)** — present · each side does an already-familiar action; all novelty lives inside Skynet
- **Philosophy — additive not replacive** — present · link click/download/etc. preserved verbatim; edit affordance is opt-in per link
- **Philosophy — visible failure over silent maybe-wrong** — present · fetch failure surfaces explicit modal error copy; no fallback path to cached bytes
- **What would make it wrong: agent-side primitive required** — present · no agent-side change; passive detection honored
- **What would make it wrong: edit affordance replaces the link's behavior** — present · anchor rendered first with original target/rel; affordance is a sibling
- **What would make it wrong: silent use of stale bytes when re-fetch fails** — present · eligibility bytes discarded; open-time fetch failure surfaces explicit error
- **What would make it wrong: return path bypasses Ashley's judgment** — present · save deposits an attachment into the composebox; agent only receives via Ashley's reply
- **What would make it wrong: feature grows into a general file browser** — present · no host picker, no tabs, no cross-conversation state, no arbitrary-file entry point
- **What would make it wrong: mobile doesn't work at least as well as desktop** — present · modal inherits the mobile-adapted Global Files surface; affordance has mobile-specific touch treatment; HOWEVER the newly-added save-success and fetch-fail toasts sit at app-wide bottom-right and will occlude the composebox on mobile — see additions below
- **Scope edges — In (text-shaped files, edit-then-attach, whitelist+sniff, fetch-at-detection + fresh re-fetch)** — present · all four in-scope items honored
- **Scope edges — Out (general file browser; editor for non-chat files; agent-side primitive; multi-file tabs; draft persistence; auto write-back)** — present · all six out-of-scope items honored
- **Scope edges — Tempting-but-no (replacive affordance; multi-file tabs; draft resumption; sniff without whitelist)** — present · all four temptations resisted

### Additions (in the result, not in the shape)

- Editor modal header shows a muted "from {agentIdentityName}" sub-header next to the filename, identifying which agent shared the file — endorsed-as-drift
- "Discard unsaved changes?" window.confirm gate fires on modal close when the draft differs from the fetched content — endorsed-as-drift
- Sonner toast notifications fire on save-success ("Attached {filename} to your reply") and on fetch-failure ("Couldn't fetch {filename} — see modal."). They use the app-wide shared sonner toast layer mounted at position="bottom-right" in FullScreenAppWrapper, which will occlude the composebox on mobile — the load-bearing surface for this whole feature — unsanctioned

### Follow-ups

- Remove or reposition the save-success and fetch-failure toasts in EditableFileModal so they do not occlude the composebox on mobile; the in-modal error copy already satisfies the shape's "visible failure" requirement, and save-success ambient feedback was never asked for — issue

### Notes

Two of three additions were introduced downstream of the shape in the phase's own UI-SPEC (agent-name sub-header and discard-draft confirm) — both were endorsed at close-out but worth flagging that the UI-SPEC layer is where they slipped in. The sonner toast layer is a fleet-wide convention (login/auth/terminal/main-axios/other pretty-view modals all use it), so reflex-copying it into a new modal is a natural pattern trap — but bottom-right + composebox is a mobile occlusion problem the whole app inherits. Worth carrying forward: any new modal that lives on the pretty-view surface should treat bottom-right toasts as suspect until the composebox occlusion issue is solved app-wide.

---

## Close-Out (rev-2)

**Closed:** 2026-08-14
**Vehicle used:** GSD phase (Phase 40 — text-editor-in-skynet), 5 plans across 4 waves, plus a rev-2 fix commit landing the prior close's follow-up
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · in-app editor for agent-served files inside the chat surface; save deposits a fresh attachment for reply
- **Shape — passive detection (no agent-side primitive)** — present · frontend regex scans message body; backend SSRF-hardened proxy fetches on Skynet's behalf; agents unchanged
- **Shape — extension whitelist first, byte-sniff fallback (with basenames like Dockerfile/Makefile/.gitignore)** — present · starter whitelist mirrored front and back; sniff runs only on extension miss (null-byte + printable-ratio + UTF-8 validity)
- **Shape — edit affordance additive alongside the link (never replacive)** — present · anchor renders first with original target/rel; affordance is a fragment sibling
- **Shape — tap-edit fetches fresh; explicit error on failure; no silent fallback to detection-time bytes** — present · modal fires fresh fetch on every open; eligibility bytes are discarded and never handed to the editor; failure branch renders the UI-SPEC L110 error copy in-body
- **Shape — editor reuses Global Files modal chrome + editor guts** — present · Portal/Overlay/Content copied verbatim; GlobalFileTab imported with a backward-compatible optional draft-change callback
- **Shape — host picker stripped; multi-file tabs stripped** — present · neither element rendered
- **Shape — save deposits fresh attachment; editor stateless across opens** — present · handleStageEditedFile constructs a new File and calls uploads.stageAttachments primary; state resets on close
- **Shape — edited attachment returns via existing reply-with-attachment path; remove via composebox chip** — present · zero new plumbing on return trip; existing ComposeBox send and AttachmentChipStrip handle it
- **Philosophy — solves the wait / mobile gap** — present · modal reuses mobile-adapted surface; affordance has 44x44 touch target and mobile always-visible treatment
- **Philosophy — passive detection** — present · agents serve exactly as before
- **Philosophy — symmetric hand-off (link in, attachment out)** — present · each side does an already-familiar action; novelty lives inside Skynet
- **Philosophy — additive not replacive** — present · link click/download preserved verbatim; edit affordance is opt-in
- **Philosophy — visible failure over silent maybe-wrong** — present · in-body error copy on fetch failure; no path to cached bytes
- **What would make it wrong: agent-side primitive required** — present · no agent-side change
- **What would make it wrong: edit affordance replaces the link's behavior** — present · anchor rendered first with original target/rel; affordance is a sibling
- **What would make it wrong: silent use of stale bytes when re-fetch fails** — present · eligibility bytes discarded; open-time fetch failure surfaces explicit error
- **What would make it wrong: return path bypasses Ashley's judgment** — present · save deposits an attachment into the composebox; agent only receives via her reply
- **What would make it wrong: feature grows into a general file browser** — present · no host picker, no tabs, no cross-conversation state, no arbitrary-file entry point
- **What would make it wrong: mobile doesn't work at least as well as desktop** — present · modal inherits mobile-adapted surface; affordance has mobile-specific touch treatment; toasts that would have occluded the composebox on mobile were removed in commit d01079db
- **Scope edges — In (text-shaped files, edit-then-attach, whitelist+sniff, fetch-at-detection + fresh re-fetch)** — present · all four in-scope items honored
- **Scope edges — Out (general file browser; editor for non-chat files; agent-side primitive; multi-file tabs; draft persistence; auto write-back)** — present · all six out-of-scope items honored
- **Scope edges — Tempting-but-no (replacive affordance; multi-file tabs; draft resumption; sniff without whitelist)** — present · all four temptations resisted

### Additions (in the result, not in the shape)

- Editor modal header shows a muted "from {agentIdentityName}" sub-header next to the filename — endorsed-as-drift
- "Discard unsaved changes?" window.confirm gate fires on modal close when the draft differs from the fetched content — endorsed-as-drift

### Follow-ups

None.

### Notes

Second pass of /close. The rev-1 close flagged sonner toasts (save-success and fetch-failure) as an unsanctioned addition because their bottom-right anchor occluded the composebox on mobile. Commit d01079db removes both toasts from EditableFileModal — the in-body UI-SPEC L110 error copy remains as the sole visible-failure surface, and the composebox chip is the save-success confirmation. Only historical docblock comments referencing the removed toasts remain; no toast import, no toast call. The two prior endorsed-as-drift additions (agent-name sub-header, discard-changes confirm) are still present and unchanged. Material now matches the shape both ways with no unresolved divergence.

---

## Close-Out (rev-3)

**Closed:** 2026-08-14
**Vehicle used:** GSD phase (Phase 40 — text-editor-in-skynet), 5 plans across 4 waves, plus rev-2 toast-removal fix and rev-3 code-review fix commit (2 blockers + 4 high + 6 medium + regression guards)
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · in-app editor for agent-served files inside the chat surface; save deposits a fresh attachment for reply — frontend regex scans, backend SSRF-hardened proxy fetches, modal reuses Global Files editor guts
- **Shape — passive detection (no agent-side primitive)** — present · frontend regex scans message body; backend proxy fetches on Skynet's behalf; git diff shows zero agent-side / identity-skill / fleet-skill files touched
- **Shape — extension whitelist first, byte-sniff fallback (Dockerfile/Makefile/.gitignore basenames)** — present · starter whitelist mirrored front and back; sniff runs only when classifyByExtension misses; sniffTextBytes uses null-byte + printable-ratio + UTF-8 validity heuristic
- **Shape — edit affordance additive alongside the link (never replacive)** — present · ChatMessage's `<a>` override renders the anchor first with original target/rel; EditableFileAffordance renders as fragment sibling, never a wrapper
- **Shape — tap-edit fetches fresh; explicit error on failure; no silent fallback to detection-time bytes** — present · EditableFileModal fires fetchTailnetUrl on every open; eligibility bytes are discarded and never handed to the editor; failure branch renders UI-SPEC L110 error copy in-body (agent-server auto-kill guidance)
- **Shape — editor reuses Global Files modal chrome + editor guts** — present · Portal/Overlay/Content/DialogClose copied verbatim from GlobalFilesModal; GlobalFileTab imported with an optional backward-compatible onDraftChange callback that existing GlobalFilesModal caller doesn't pass
- **Shape — host picker stripped; multi-file tabs stripped** — present · neither the host <select> nor the Tabs bar renders in EditableFileModal — the modal handles exactly one file per open
- **Shape — save deposits fresh attachment; editor stateless across opens** — present · handleStageEditedFile constructs a new File and calls uploads.stageAttachments('primary', [File]); modal resets all state on close so re-open starts from the agent's original with no draft persistence
- **Shape — edited attachment returns via existing reply-with-attachment path; remove via composebox chip** — present · zero new plumbing on the return trip — existing ComposeBox send and AttachmentChipStrip handle the reply and unstage
- **Philosophy — solves the wait / mobile gap** — present · modal inherits mobile-adapted Global Files surface; affordance has 44x44 min touch target and mobile always-visible treatment
- **Philosophy — passive detection** — present · agents serve exactly as before; enrichment lives entirely inside Skynet
- **Philosophy — symmetric hand-off (link in, attachment out)** — present · each side does an already-familiar action; all novelty lives inside Skynet between them
- **Philosophy — additive not replacive** — present · anchor's click/download/target/rel preserved verbatim; edit affordance is opt-in per link
- **Philosophy — visible failure over silent maybe-wrong** — present · in-body error copy on fetch failure; no fallback to cached eligibility bytes; sonner toast surface from rev-1 remains removed
- **What would make it wrong: agent-side primitive required** — present · no agent-side change — passive detection honored
- **What would make it wrong: edit affordance replaces the link's behavior** — present · anchor rendered first with original target/rel; affordance is a fragment sibling
- **What would make it wrong: silent use of stale bytes when re-fetch fails** — present · eligibility bytes discarded; open-time fetch failure surfaces explicit error; no path to cached bytes exists
- **What would make it wrong: return path bypasses Ashley's judgment** — present · save deposits an attachment into the composebox — agent only receives via Ashley's reply
- **What would make it wrong: feature grows into a general file browser** — present · no host picker, no tabs, no cross-conversation state, no arbitrary-file entry point, no persistence (localStorage/IndexedDB grep returned nothing)
- **What would make it wrong: mobile doesn't work at least as well as desktop** — present · modal inherits mobile-adapted Global Files surface; affordance has mobile-specific touch treatment; rev-1 toast occlusion regression is not present
- **Scope edges — In (text-shaped files, edit-then-attach, whitelist+sniff, fetch-at-detection + fresh re-fetch)** — present · all four in-scope items honored
- **Scope edges — Out (general file browser; editor for non-chat files; agent-side primitive; multi-file tabs; draft persistence; auto write-back)** — present · all six out-of-scope items honored
- **Scope edges — Tempting-but-no (replacive affordance; multi-file tabs; draft resumption; sniff without whitelist)** — present · all four temptations resisted

### Additions (in the result, not in the shape)

- Editor modal header shows a muted "from {agentIdentityName}" sub-header next to the filename — identifies which agent shared the file — endorsed-as-drift
- "Discard unsaved changes?" window.confirm gate fires on modal close when the draft differs from the fetched content — endorsed-as-drift

### Follow-ups

None.

### Notes

Third pass of /close. Rev-3 (commit 88d7b2c8) landed 2 blockers + 4 highs + 6 mediums from an unbiased code-review, plus 8 regression-guard tests. Every rev-3 change is a defensive bug fix or comment-truth correction — no new user-facing surfaces: SSRF-via-redirect closed with redirect:'error', UTF-8 decode via TextDecoder replacing raw atob (fixes silent destructive corruption on emoji/CJK/accented content), decoded-segment path-traversal check that tolerates data..sql basenames, streaming size cap with Content-Length short-circuit, monotonic mtimeCounter replacing Date.now sentinel, per-effect-run closure-local cancelled flag replacing shared useRef, stripTrailingPunct normalizer aligning eligibility Set with GFM autolink hrefs, dedupe URL Set before the fetch loop, isTextByExt accepted as belt-and-suspenders, savingRef reset on throw in handleSave, sr-only DialogDescription for Radix a11y contract. Two rev-2-endorsed additions (agent-name sub-header, discard-changes confirm) remain present and unchanged. No sonner toast import or call exists in EditableFileModal (only historical docblock references). Material matches the shape both ways with zero unresolved divergences.

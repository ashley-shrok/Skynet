# Phase 40: text-editor-in-skynet — Context

**Gathered:** 2026-08-13
**Status:** Ready for planning
**Source:** Synthesized from `.planning/shapes/shape-skynet-text-editor.md` (agreement locked via `/build` → `/open` conversation with Ashley on 2026-08-13)

<domain>
## Phase Boundary

An in-app text editor inside Skynet's pretty-view chat surface that lets Ashley edit files an agent has served her via the standard id-skill tailnet HTTP pattern, and reply with the edited versions attached — replacing the current multi-agent round-trip of "send to another local agent → they open a local editor → I edit → tell the original agent to pull it back." The load-bearing case is mobile, where the current workflow has no viable equivalent at all (no local agent, no clean iOS editor story for received files).

Scope is deliberately narrow: agent-served text files in chat, edited in-app, returned as an attachment on Ashley's next reply. Nothing more.

</domain>

<decisions>
## Implementation Decisions

### Detection signal (LOCKED)
- Skynet passively watches agent messages for served-tailnet HTTP URLs — the pattern canonicalized in the id skill's "Sending files to the user" section (an agent runs a temporary Python HTTP server bound to the tailnet IP and hands Ashley a link).
- NO new primitive on the agent side. Agents keep serving files exactly as they do today; Skynet does all the enrichment.
- Alternatives rejected in `/open`: keying on fenced code blocks (too noisy — false positives everywhere), and introducing a new "here's a file to edit" explicit convention for agents (violates the passive-detection principle).

### Eligibility check for the edit affordance (LOCKED)
- **Extension whitelist first** — wholesale acceptance for common cases: markdown, plain text, config formats (JSON, YAML, TOML, INI, conf, env), source code across languages, plus specific extensionless basenames (Dockerfile, Makefile, .gitignore, .dockerignore, .editorconfig, extensionless READMEs).
- **Byte-sniffing as fallback** — for files that miss the whitelist, inspect bytes to catch extensionless-but-text. Rationale: recognizer is really "eligible filename" (matches extension OR specific basename OR bytes look text-shaped), not strictly "extension."
- **False-positive tolerance is acceptable.** The return trip goes through Ashley editing + agent receiving an attachment (not silent overwrite of the agent's file), so a sniffer misclassifying a binary as text at worst results in an editor showing garbage — which Ashley won't attempt to save. The agent's judgment on receipt is the safety net.

### Edit affordance behavior (LOCKED)
- **Additive, not replacive.** The existing link behavior stays — Ashley can still click through, download, or interact with the link exactly the way she can today. The edit affordance is a NEW action that appears ALONGSIDE the link, never in place of it.
- She may want to just view, download, or ignore any given file — the affordance is a per-message per-link opt-in, not a hijack.

### Fetch strategy (LOCKED)
- **Fetch at detection time** for the eligibility check (needed anyway to run the byte-sniff fallback path — can't sniff without bytes).
- **Fresh re-fetch at edit-open time** to get current bytes when Ashley taps edit.
- **If the re-fetch fails, Skynet errors explicitly.** Do NOT silently fall back to the detection-time cached bytes. Ashley's exact call: visible failure over silent maybe-stale. Cached-for-eligibility bytes are used ONLY for the eligibility check and then discarded — they are never served to the editor.

### Editor surface (LOCKED — reuse decision)
- **Reuse the existing Global Files edit modal** — same modal shell, same editor guts, same look/feel across desktop and mobile. Skynet already ships this surface; the mobile layout comes along for free.
- **Strip the host picker** — irrelevant here because Skynet already knows exactly which file is being edited (the one whose link Ashley tapped).
- **Strip the multi-file tab system at the bottom** — this editor works on ONE file at a time (Ashley's explicit callout). No tabs.
- Load/save plumbing is genuinely new (fetch from served link on the way in; attach to composebox on the way out) — that plumbing is what this phase builds. The modal chrome + editor UX is what gets reused.

### Save behavior (LOCKED)
- **Save deposits the edited file into the composebox as a new attachment,** exactly the way a user-picked attachment would appear there.
- **Editor is stateless.** Every save produces a fresh attachment. Re-opening the edit affordance on the same link starts over from the agent's original — no draft resumption.
- **Deliberate consequence:** editing three times and saving three times produces three attachments (deliberate multi-version support if Ashley wants it). Not a bug.
- **Remove flow:** the composebox's existing remove affordance handles "changed my mind" — no new unstage mechanism needed.

### Return trip to the agent (LOCKED)
- Uses Skynet's existing reply-with-attachment path (well-worn, occasional upload bugs but no fundamental flaws).
- NO new agent-side receive convention — agents already know how to read attachments Ashley sends them.
- The symmetry is: agent serves a link (their existing pattern), Ashley replies with an attachment (her existing pattern). All novelty lives inside Skynet, in the middle.

### Claude's Discretion
Areas the shape doc leaves to the implementer to figure out from patterns + judgment:
- Where in the message-rendering pipeline the URL detection lives (probably alongside existing link-extraction logic in the pretty-view bubble renderer)
- The specific byte-sniff heuristic (null-byte scan / printable-ratio / UTF-8 validity / libmagic-style — pick a well-known standard)
- Cache lifecycle for detection-time bytes (in-memory only, per-message-life or shorter; NOT persisted; NEVER served to the editor)
- Editor state-model wiring (which store, which hooks, how the modal opens keyed to a specific message + link)
- Loading indicators during the fetch-at-open transition (spinner, skeleton, blocking overlay, etc.) — the reused Global Files modal likely has established patterns here
- Where the extension whitelist itself lives as data (config file, constants module, JSON blob) and how it's extended
- Exact error UI when re-fetch fails (toast, in-modal message, inline error, etc.) — deferred to implementation but MUST NOT silently fall back

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape agreement (load-bearing)
- `.planning/shapes/shape-skynet-text-editor.md` — Full shape file from `/open`, contains philosophy, scope edges, and the exact "what would make it wrong" list. This is the load-bearing agreement — every planning + implementation decision must be checkable against it.

### Detection surface (existing pattern being detected)
- `~/.claude/skills/id/SKILL.md` § "Sending files to the user" — the canonical tailnet-served-file pattern that fleet agents follow when handing Ashley a file. Describes the URL shape Skynet's detector must recognize, filename preservation, and the 30-minute auto-kill lifecycle that makes the re-fetch-fail case a real (if rare) scenario.

### Editor reuse target
- The Skynet frontend's **Global Files edit modal** — the reuse target for the editor UX surface. Planner + implementer must locate this in the codebase, understand its existing shape (modal chrome, editor component, save flow, mobile responsiveness), and identify what to strip (host picker + multi-file tabs at the bottom) vs. what to inherit (everything else). Bounties adjacent: `global-files-config-location-followup`, `global-files-empty-branch-editable-fallthrough`, `global-files-modal-default-to-one-host-picker`.

### Return-trip mechanism
- The Skynet ComposeBox's **existing attachment handling** — file attachments, remove affordance, reply-with-attachment path. All already work; nothing new needed here beyond depositing the saved file into the same in-memory attachment set.

### Message rendering surface
- The pretty-view message bubble render path — specifically where links inside message content are extracted and made interactive today. That's the surface that gains the new edit affordance alongside existing link behavior.

</canonical_refs>

<specifics>
## Specific Ideas

- **URL shape being detected.** Per the id skill's serve pattern, agents run `python3 -m http.server 0 --bind <tailnet-ip>` from a fresh `mktemp -d` and hand out URLs like `http://100.x.y.z:PORT/filename.ext`. Filename is preserved in the URL's last path segment — that's the name the composebox attachment inherits.
- **Auto-kill window.** Temp servers auto-kill after 30 minutes (per the id-skill's `sleep 1800; kill "$PID"` block). This is why the re-fetch-fail case is real: detection happens at message-arrival time, but the user might open the editor 30+ minutes later. When that fails, Skynet errors — does not fall back to cached bytes.
- **Multi-file per message.** An agent may serve several links in one message (each is a distinct temp URL). Each link independently gets its own edit affordance if eligible. Each save independently deposits one attachment. No cross-file behavior; no bulk editor.
- **Fleet adoption note.** Not every fleet agent uses the id-skill serve pattern religiously — some paste files as fenced code blocks. That's fine: those files don't get the edit affordance (fenced-block detection was explicitly rejected). If Ashley wants a specific file editable, she can tell the agent to serve it via the id-skill pattern.
- **Composebox attachment shape.** Whatever the composebox represents an attachment as internally today, a "save from editor" produces the same shape — indistinguishable from a user-picked attachment as far as remove/send/etc. are concerned.
- **Editor for one file at a time.** Ashley was explicit that the Global Files modal's multi-file tab affordance at the bottom does NOT come along. Even if she edits three files sequentially from the same message, that's three modal opens, three saves, three attachments — no in-modal tabs.

</specifics>

<deferred>
## Deferred Ideas

**Explicitly out of scope for this phase (per shape doc):**
- Any general file browser for hosts — this is NOT a mini-Filestash inside Skynet.
- Any editor for files NOT offered by an agent in a chat message (no "open arbitrary file" surface).
- Any agent-side primitive (agents keep doing what they already do — no new "request edits" convention).
- Multi-file editor tabs.
- Draft persistence / stateful editor across opens ("continue where I left off" — deliberately not supported).
- Automatic write-back to the agent's box (return trip is attachment-based only, via Ashley's judgment).
- Editing non-text formats (PDFs, images, binaries, spreadsheets — deliberately rejected).

**Tempting-but-no (also from shape doc):**
- Making the edit affordance a REPLACEMENT for the link's default behavior — must be additive alongside.
- Adding tabs to edit multiple attachments at once.
- Draft resumption on re-open — must start fresh from agent's original.
- Byte-sniffing without a whitelist (whitelist must be the primary path — sniff is only the fallback for extensionless-but-text).

**Deferred to implementation-time (flagged as TBD in the shape doc — expected to be nailed down during plan-phase or UI-SPEC):**
- Exact visual form of the edit affordance on the link within a message bubble (Ashley flagged uncertain during `/open`).
- The specific extensions in the whitelist (a comprehensive starting set that will grow over time as misses are noticed).
- The exact UI presentation of the re-fetch-fail error (must be explicit and visible; specific chrome TBD).

**Deferred to a future phase (adjacent polish, NOT in this phase's scope):**
- Any bulk-edit workflow (out of scope, and Ashley didn't ask for it).
- Persistence of edit state across a message-list virtualization scroll (if reused Global Files modal already handles this, inherit; if not, out of scope).

</deferred>

---

*Phase: 40-text-editor-in-skynet*
*Context gathered: 2026-08-13 — synthesized from `/open` shape agreement*

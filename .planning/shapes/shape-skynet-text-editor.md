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

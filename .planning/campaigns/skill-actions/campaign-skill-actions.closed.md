# Campaign: some way to activate skills with mouse only

**Opened:** 2026-10-09
**Status:** closed (2026-10-09 — all items terminal; pushed, not yet deployed)
**Workspace:** .planning/campaigns/skill-actions/ (in the Skynet repo)

## Concept

Skills feel like actions you take in the app, not text you type — the same way the thumbs-up is an action even though it lands as a chat reply. A new lightning-bolt button beside the thumbs-up opens a menu of the box's skills (the same set the Skills editor shows); tapping one sends it immediately. Deliberately simple v1: one flat list, no curation or stars. Argument-free skills thereby become user-authored custom action buttons. The footer Skills-editor icon becomes the same lightning bolt. Tap-to-send only — no long-press "insert into compose box" variant (a future type-ahead autocomplete covers the needs-more-text case). Alongside: speaking "slash <multi-word skill name>" in voice mode reliably lands as the dashed skill command.

## Success criteria

- Light-review (or any user skill) can be triggered with two clicks/taps and no keyboard, on desktop and phone.
- Every skill the Skills editor shows for the box is reachable from the menu (fleet-distributed ones excluded, matching the editor).
- Saying "slash light review" (or any dashed name) sends `/light-review`.

## Shapes

- **[declared] shape-skill-action-menu** — action button beside thumbs-up + menu (flat list of the box's skills), tap sends — closed

## Other work

- Voice: "slash <multi-word name>" — the matcher already joined dashed names; the user scoped the fix to STT writing a literal "/" for spoken "slash". Gate widened to accept a leading "/" (fix-voice-slash-char.closed.md) — done

## Lingerers (explicitly approved)

## Open questions

# Campaign: speech-to-text fallback — a backup service for when the main one fails

**Opened:** 2026-11-02
**Status:** closed — 2026-11-02, one shape, no tack-ons
**Workspace:** .planning/ in the Skynet repo

## Concept

Each Skynet instance turns speech into text with exactly one service. When that service fails (out of credit, key rejected, down, timing out), dictation fails with it — the recording is kept on disk, but the user's words never arrive. This adds an optional second speech-to-text service, set by the operator alongside the main one: when the main service cannot transcribe a recording, the same recording goes to the backup and the user gets their text. With no backup set, behaviour is exactly what it is today, so instances whose audio must stay inside AWS never send it anywhere new. It covers every place the instance transcribes audio — dictation, the agent-facing speech-to-text service, and phone-call replies — and the admin System page shows which main and backup services are configured.

## Success criteria

- With the main service out of credit and a working backup set, dictation still produces text.
- Every switch to the backup leaves one log line saying which request, from which service, to which, and why.
- With no backup set, nothing about transcription changes.
- A backup setting naming an unknown service, or the main service again, is never used and never mapped to another service.
- Admins can see the configured speech-to-text main and backup services.

## Shapes

- **[declared] shape-stt-fallback** — backup speech-to-text service for all three transcription callers, plus the admin view — closed

## Other work

- Agent speech-to-text requests whose main and backup both time out on every try can outlast the agent helper's 9-minute wait (same for phone replies vs the 13-minute wait) — noted-only (time limits were out of scope)

## Lingerers (explicitly approved)

## Open questions

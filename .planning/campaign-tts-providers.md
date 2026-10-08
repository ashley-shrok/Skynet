# Campaign: selectable TTS provider per instance, like STT

**Opened:** 2026-10-08
**Status:** in_progress
**Workspace:** /home/ubuntu/fleet/identities/anchor-box-maintainer-2/workspace/skynet/.planning/

## Concept

Each Skynet instance chooses which service turns agent messages into speech, the
same way it already chooses its speech-to-text service. Amazon Polly stays the
default, so an instance under an AWS BAA keeps audio inside AWS unless someone
opts in. ElevenLabs and OpenAI are the two alternatives. Every speak path follows
the active provider — the speak button on message bubbles, the voice previews in
the identity and role windows, and the user's fallback voice — and the voice
pickers show the active provider's voices: Polly's fixed seven, OpenAI's fixed
set, or the ElevenLabs account's voices fetched live. Saved voice choices are
never rewritten when the provider changes; a saved voice the active provider
doesn't have falls back to that provider's default, so switching back restores
everyone's old voice.

## Success criteria

- With no provider set, speech sounds and behaves exactly as it does today.
- Switching an instance to another provider changes every speak path to it, with no frontend rebuild.
- Voice pickers show the active provider's voices and only those.
- A saved voice the active provider lacks still speaks, in that provider's default voice — no error, no silence.
- Long messages play through to the end on every provider.
- Logs name the provider and voice behind each speak request.

## Shapes

- **[declared] shape-tts-providers** — provider choice per instance, ElevenLabs + OpenAI adapters, server-served voice lists, saved-voice fallback, per-provider message splitting, docs + id skill — closed

## Other work

- Agent-side "speak this text" service (counterpart to the `stt` agent service) — out of scope per user 2026-10-08; candidate for a later build — noted-only

## Lingerers (explicitly approved)

## Open questions

# Campaign: the voice heard-note shows a short run of what the user heard, so an agent can't misplace their answer

**Opened:** 2026-11-01
**Status:** closed
**Workspace:** ~/fleet/identities/flint-box-maintainer-5/workspace/skynet/.planning/

## Concept

On 2026-11-01 Ashley spoke a voice message after hearing the orchestrator's bare "Okay." about the Google Cloud steps. The orchestrator still read her message as being about the avatar reply, which she hadn't heard yet. The note named "Okay." as the last thing she heard, which was true but gave no topic, and the orchestrator went with the latest thing it had presented. The note should hold up under any conditions. It should show a short run of the conversation as the user experienced it: the last few replies they heard, with their own messages in between, in the order they happened. Under that it always draws a line: nothing after this point had been heard.

## Success criteria

- An agent reading a voice message can tell what it answers from the note alone, even when the last heard reply is a bare acknowledgement.
- The note follows the order the user actually experienced, not the order of the transcript.
- The note never claims more than voice mode knows.

## Shapes

- **[declared] shape-voice-heard-run**: replace the single "last heard" with a heard run plus a standing cut-off line. closed

## Other work

## Lingerers (explicitly approved)

## Open questions

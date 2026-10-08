---
name: stt
description: Transcribe an audio file (voice memo, call recording, meeting audio) to text via the fleet's speech-to-text provider. Invoke as `stt <audio-file>`.
distributed: true
---

# stt

Speech to text: turn an audio file into a transcript. Invoked as a one-line shell helper; the request and response files are handled inside it.

### ⚠️ Your audio may leave this deployment

The audio goes to the speech-to-text provider this instance uses for voice input. Unless the operator has said that provider keeps audio in-house, treat it as a third-party API: you MUST NOT send recordings containing PHI, patient identifiers, or anything your deployment's compliance boundary forbids sending to a third party. If unsure, don't send it. The `provider` field in the metadata says which provider handled a request.

## Invocation

The helper is `stt`, on your `PATH` (`~/.local/bin/stt`):

```
stt /path/to/recording.m4a
stt /path/to/meeting.mp3 --out ~/fleet/notes/meeting.txt
```

- `<audio-file>`: flac, m4a, mp3, mp4, oga, ogg, opus, wav or webm, up to 25 MB. For a video or another format, extract the audio first, e.g. `ffmpeg -i in.mov -vn -c:a libopus out.ogg`. For a longer recording, split it into pieces under 25 MB and transcribe each.
- `--out <path>`: write the transcript to this file instead of stdout.

Model and language are instance settings; there are no flags for them.

Before invoking: confirm the recording contains nothing compliance-restricted. See the directive at the top of this file.

## Response shape

- **Success**: exit `0`. The transcript on **stdout** (or in `--out`). Metadata JSON `{provider, audio_bytes, transcription_time_ms, out?}` on **stderr**.
- **Failure**: non-zero exit. A JSON object `{reason, message?}` on **stderr**; nothing on stdout.

```
text=$(stt memo.m4a)
```

The helper waits up to 9 minutes, under the Bash tool's 10-minute limit, and cleans up its scratch files in `~/fleet/service-requests/` on every exit path.

## Failure handling

| reason | caller action |
| --- | --- |
| malformed | Read `message`: usually an unsupported file type (`attachment audio ...`) or a file over 25 MB. Convert or split, then retry. |
| transcription_failed | The provider could not transcribe the file. Check it actually contains audio (`ffprobe <file>`); re-encode it (e.g. to ogg/opus) and retry once. |
| provider_unavailable | The provider is busy or unreachable (the backend already retried). Retry after a brief delay. |
| not_configured | Escalate to the operator: the backend's speech-to-text provider isn't set up or its key was rejected. |
| expired | The request waited in the queue past 2 minutes. Retry; the fleet may be busy. |
| timeout | The backend accepted the request but did not answer within 9 minutes. Retry with a shorter file. |
| not_picked_up | The backend never picked up the request; it may be down or not managing this host. Escalate to the operator. |
| queue_full | Too many requests queued. Retry later. |
| internal | Escalate to the operator. |

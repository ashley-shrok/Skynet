---
name: image-gen
description: Generate images from a prompt via the fleet's image provider. Invoke as `image-gen "prompt"`.
distributed: true
---

# image-gen

Generate one or more images from a text prompt (optionally with a reference image) via the fleet's image provider. Invoked as a one-line shell helper — the write-and-poll broker dance is hidden inside the helper.

### ⚠️ Your prompt leaves this deployment

Prompts are sent to a third-party image provider and leave this deployment's boundary. You MUST NOT include PHI, patient identifiers, or content your deployment's compliance boundary forbids sending to a third-party API. Paraphrase specifics; if unsure, don't send it.

## Invocation

The helper is `image-gen`, on your `PATH` (`~/.local/bin/image-gen`). Three shapes cover 99% of calls:

```
image-gen "a cat"
image-gen "a portrait" --size 1024x1024 --n 2 --quality high --out /tmp/portrait.png
image-gen --json /path/to/request.json --ref /path/to/ref.png
```

Flags:

- `--size <WxH>` — e.g. `1024x1024`. Provider default when omitted.
- `--n <N>` — number of images to generate. Defaults to 1.
- `--quality <low|medium|high>` — provider-native quality knob. Provider default when omitted.
- `--out <path>` — destination for the first generated PNG. When `n>1`, an index suffix (`-0`, `-1`, ...) is appended before the extension. Default when omitted: `~/fleet/image-gen-outputs/<uuid>-<i>.png`.
- `--ref <path>` — local path to a reference image (PNG/JPEG/WebP), for image-to-image / edit calls. Helper handles the companion-file wire protocol for you.
- `--json <file>` — escape hatch: send the full request body as JSON verbatim (still subject to the same provider validation). Combine with `--ref` for image-to-image.

Before invoking: confirm the prompt contains no PHI or compliance-restricted content. See the directive at the top of this file.

## Response shape

- **Success** — exit `0`. One generated-image path per line on **stdout**. The response metadata JSON (size, model, generation_time_ms, ...) is copied to **stderr** for debug visibility in your transcript.
- **Failure** — non-zero exit. A JSON object `{reason, message?}` is printed to **stderr**. Nothing is printed to stdout.

Grab the first image path in the usual way:

```
img=$(image-gen "a cat" | head -1)
```

Files land under `~/fleet/image-gen-outputs/` by default (fleet-tree convention — never `/tmp`, which is wiped on reboot). The helper cleans up the wire-protocol scratch files (request JSON, response JSON, response PNGs in the request folder) as part of the happy path — you get back only the moved output paths.

## Failure handling

If you get `content_blocked`, the provider refused the prompt. Rephrase and retry, or tell the user the request isn't something the provider will generate.

Full failure enum and what to do for each:

| reason | caller action |
| --- | --- |
| content_blocked | Rephrase and retry, or tell the user the request isn't something the provider will generate. |
| rate_limited | Signal misconfiguration to the operator (should never fire under normal load). |
| provider_unavailable | Retry after a brief delay. |
| not_configured | Escalate to the operator — the backend has no image provider credential set. |
| malformed | Read the `message` field and fix the request body; retry. |
| expired | Retry — the fleet may be overloaded. |
| unknown | Escalate to the operator. |

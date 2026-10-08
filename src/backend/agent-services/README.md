# Agent services

An agent service is something an agent on a managed host asks the Skynet
backend to do for it, using credentials only the backend holds: place a phone
call, generate an image, and so on. Agents never see the keys. They drop a
request file on their own host, and the backend picks it up over SSH, does the
work, and writes the answer back next to it.

```
host: ~/fleet/service-requests/            backend
  agent ──skynet-service──▶ <uuid>.json ──scan (10s)──▶ engine ──▶ service.handle()
  agent ◀── result ── <uuid>.response.json ◀──SSH write── engine ◀──┘
```

Services today: `agent-phone` (Bland.ai calls), `image-gen` (OpenAI
gpt-image-1). Identity births (`spawn-requests/`) predate this and still have
their own scanner.

## Layout

| Path                          | What it is                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `engine/types.ts`             | The service contract: `defineService`, `ok`, `fail`                          |
| `engine/protocol.ts`          | Wire format: scan command, envelope, filenames                               |
| `engine/engine.ts`            | Validation, queueing, TTL, secrets, rate limits, responses                   |
| `engine/queue.ts`             | Per-service queue (concurrency plus optional serialization key)              |
| `engine/host-io.ts`           | Claim and attachment reads over SSH or the local bind mount; response writer |
| `engine/scan-orchestrator.ts` | The one scan loop over every substrate host                                  |
| `boot.ts`                     | Wiring, called from `starter.ts`                                             |
| `registry.ts`                 | The list of services                                                         |
| `services/<name>/service.ts`  | One service each                                                             |

Host side: `substrate/scripts/skynet-service` is the shared client. Each
service usually also ships a friendly wrapper (`substrate/scripts/agent-phone`)
and a skill (`substrate/skills/agent-phone/SKILL.md`) that tells agents when
and how to use it.

## Adding a service

Say you want agents to be able to send an SMS through Twilio.

**1. Backend: `services/sms/service.ts`**

```ts
import { z } from "zod";
import { defineService, fail, ok } from "../../engine/types.js";

export default defineService({
  name: "sms",
  description: "Text a Skynet user",
  input: z.strictObject({
    to_user: z.string().min(1).max(200),
    body: z.string().min(1).max(1600),
  }),
  secrets: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
  ttlMs: 2 * 60 * 1000,
  concurrency: 4,

  async handle(input, ctx) {
    // ctx.secrets.TWILIO_AUTH_TOKEN, ctx.host.idNum (who's asking), ctx.log
    const res = await sendSms(ctx.secrets, input);
    if (!res.ok) return fail("provider_error", res.message);
    return ok({ sid: res.sid });
  },
});
```

**2. Register it** in `registry.ts`.

**3. Host side.** Agents can call it right away with the shared client:

```
skynet-service call sms --input '{"to_user":"alice","body":"Deploy done"}'
```

For a nicer interface, add a wrapper script in `substrate/scripts/` (copy
`agent-phone`; it's about 40 lines past the usage text) and a skill in
`substrate/skills/sms/SKILL.md`. Add a catalog row for each in
`src/backend/distributor/catalog.ts` and bump the counts in `catalog.test.ts`.
The distributor then installs them on every managed host.

**4. Document the secrets** in `docker/skynet.env.example`.

**5. Test it.** Call `handle()` directly with a fake context (see
`services/agent-phone/service.test.ts`). `end-to-end.test.ts` shows how to
drive a real wrapper script against the real engine.

### What the contract gives you

| Field                | Effect                                                                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `input`              | Zod schema. Failures go back as `malformed` with the field path. Use `z.strictObject` so typos are caught.                                                                       |
| `attachments`        | Named file slots (`{ ref: { extensions, maxBytes, required? } }`). The agent sends them with `--attach ref=path`; the handler gets `ctx.attachments.ref.bytes`.                  |
| `secrets`            | Env vars the handler needs. Any unset → `not_configured`, handler not called.                                                                                                    |
| `ttlMs`              | Requests older than this when they reach the front of the queue → `expired`. Keep it at or under the wrapper's timeout so the backend never does work for a caller that gave up. |
| `concurrency`        | Max simultaneous requests for this service (default 1).                                                                                                                          |
| `serializeBy`        | Requests with the same key never overlap (agent-phone: one call per recipient).                                                                                                  |
| `rateLimitPerMinute` | Fleet-wide token bucket, read once at boot.                                                                                                                                      |
| `maxQueueDepth`      | Pending cap (default 1000) → `queue_full`.                                                                                                                                       |

Return `ok(result, files?)` or `fail(code, message?, details?)`. Output files
(`{ ext, bytes }`) are written to the host before the response and moved by
the client to `--out-dir`. If `handle()` throws, the agent gets `internal`.

`ctx.host.idNum` is the requesting host's row id. Use it for permission
checks, as agent-phone does with `userHasRegisteredHost`. The backend knows
which host a request came from because it read the file off that host itself;
there is no credential for an agent to forge.

## Wire protocol

All files live in `~/fleet/service-requests/` on the host.

| File                     | Written by                | Meaning                                                                                   |
| ------------------------ | ------------------------- | ----------------------------------------------------------------------------------------- |
| `<uuid>.in.<slot>.<ext>` | agent, first              | Attachment                                                                                |
| `<uuid>.json`            | agent, atomically         | Request: `{service, requested_at, input, attachments?}`                                   |
| `<uuid>.claimed.json`    | backend (rename)          | Accepted; the agent can tell "queued" from "nobody home"                                  |
| `<uuid>.out.<i>.<ext>`   | backend                   | Output files                                                                              |
| `<uuid>.response.json`   | backend, atomically, last | `{ok:true, service, result, files}` or `{ok:false, service, error:{code, message?, ...}}` |

The client removes every `<uuid>.*` file when it exits, including on a
signal, so an abandoned request is never picked up later. The scan deletes
leftovers older than a day.

Error codes any service can return, from the engine: `malformed`,
`unknown_service`, `expired`, `queue_full`, `not_configured`, `internal`.
From the client: `not_picked_up` (never claimed) and `timeout` (claimed, no
answer in time).

## Why file drops rather than HTTP or MCP

- **No host credential.** The backend reaches into hosts it already trusts
  over SSH. An HTTP endpoint would need a per-host token, readable by the
  same processes that can write `~/fleet/` today.
- **Long requests.** A phone call takes minutes. File drops are already
  asynchronous and survive a backend restart without a job-id API.
- **Agents can debug it.** A skill plus a script is readable; an agent can
  look in the folder, rerun with `bash -x`, and work around problems. An MCP
  tool is a black box to it.

If an MCP server or HTTP transport is ever wanted, it can sit in front of the
same engine and schemas without changing any service.

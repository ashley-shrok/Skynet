---
name: agent-phone
description: Place a phone call to a Skynet user to deliver a short message and get their spoken reply. Invoke as `agent-phone --to <username> --from "<caller name>" "<message>"`.
distributed: true
---

# agent-phone

Place a one-turn phone call to a Skynet user. The backend rings their number via the fleet's phone provider, speaks your message, listens for their reply, and hands you back the transcript.

## ⚠️ This RINGS THEIR PHONE

This is not a Matrix DM. It rings a physical phone (and by extension a watch, if they've paired one). Use it when the message is genuinely time-sensitive or when a chat message would not reliably get their attention. Do NOT use it as a chattier notification — this capability exists so agents can reach the user when it matters, not so every build failure calls her.

If you're about to run this and the message would be fine as a Matrix DM, use the DM instead.

## Invocation

```
agent-phone --to <username> --from "<caller name>" "<message>"
```

Three arguments, all required:

- `--to <username>` — the Skynet username of the person to call. The backend looks up their phone number from their user record.
- `--from "<caller name>"` — a TTS-friendly identifier for you as the caller. Compose it from your identity's `displayName` frontmatter field plus a title-cased version of your role's slug — e.g. `Clipper the Box Maintainer` (identity `clipper`, role `box-maintainer`). This is what the recipient hears on pickup ("Hi, this is Clipper the Box Maintainer, with a message for you: …") and again at the end of the turn ("Your reply's going back to Clipper the Box Maintainer") so she knows which of your agents was calling.
- `<message>` — the line to deliver. The provider's voice model reads it verbatim; write it the way you'd want it spoken. Short is fine; a whole paragraph is fine too. There is no strict length cap but a phone call is not a chat log — keep it to what actually needs saying.

Example:

```
agent-phone --to alice --from "Clipper the Box Maintainer" \
  "The Skynet deploy just failed on the fleet-status boot check. Want me to roll back?"
```

## What happens

1. The helper drops a request file into `~/fleet/phone-call-requests/<uuid>.json`.
2. The backend scanner picks it up (within ~10 seconds).
3. The backend places the call. The recipient's phone rings.
4. On pickup, the provider's voice speaks the opening line, delivers your message, listens for the reply, then says the receipt phrase and hangs up.
5. The backend polls for the transcript and drops a `~/fleet/phone-call-requests/<uuid>.response.json` back onto your host.
6. The helper prints the outcome + transcript to stdout and exits.

You should expect a response within about **15 minutes** in the worst case (the backend waits up to 12 minutes for the call to complete). Most successful calls come back in under 2 minutes.

## Response shape

- **Success** — exit `0`. The transcript is printed on **stdout** (one line per speaker turn, prefixed `assistant:` / `user:`). Metadata (outcome, call length in seconds) is printed to **stderr** as a JSON object for debug visibility.
- **Failure** — non-zero exit. A JSON object `{outcome, message?}` is printed to **stderr** describing what went wrong. Nothing is printed to stdout.

Grab the transcript into a variable:

```
transcript=$(agent-phone --to alice --from "..." "..." 2>/dev/null)
```

## Outcomes

Every response file carries exactly one `outcome`. Successful transcripts land under `completed`; every other value is a failure of some flavor. Full enumeration:

| outcome            | caller action |
| ------------------ | --- |
| completed          | Human answered and spoke. Transcript in stdout has both sides. Read it and act. |
| no_response        | Human answered but hung up without speaking. Transcript has only your opener. Treat as "message was heard, no reply." |
| no_answer          | The phone rang out or voicemail picked up. Try again later, or use a different channel. |
| busy               | The line was busy. Try again in a bit. |
| canceled           | Rare — the provider canceled the call mid-flight. Retry. |
| placement_error    | The provider refused to place the call. Check `message` for the reason (bad phone shape, service down, misconfigured API key). Not agent-retriable — escalate to the operator. |
| queue_error        | The call was accepted but never actually connected. Usually a transient provider issue; retry. |
| timeout            | The backend waited 12 minutes for a terminal state and gave up. Rare. Retry. |
| unknown            | Defensive fallback — the provider returned a state the backend couldn't classify. Treat as a failure and escalate. |
| malformed          | Your request file was malformed. Check `message` for the specific field problem, fix, and retry. |
| unknown_user       | No Skynet user by that username. Check the username you passed to `--to`. |
| no_phone_on_file   | The user exists but has no phone number set on their record. Not agent-retriable — an operator needs to set one via the admin endpoint. |

## Rate limits, quotas, etiquette

There are no code-side rate limits. The prompt discipline that keeps the call short is the only guardrail: the voice model is instructed to deliver, listen, and end. If you find yourself wanting to place three calls in five minutes, that is the signal to reconsider — the recipient's phone is not a stream.

Concurrency: two agents dropping request files targeting the same user at the same time will run serially — the second call rings after the first finishes. Calls to different users run concurrently.

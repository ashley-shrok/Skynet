---
name: agent-phone
description: Place a phone call to a user to deliver a message and get their spoken reply.
distributed: true
---

# agent-phone

Place a one-turn phone call to a user of the app. The backend rings their number via the fleet's phone provider, speaks your message, listens for their reply, and hands you back the transcript.

## ⚠️ This RINGS THEIR PHONE

This is not a Matrix DM. It rings a physical phone (and by extension a watch, if they've paired one). Use it when the message is genuinely time-sensitive or when a chat message would not reliably get their attention. Do NOT use it as a chattier notification — this capability exists so agents can reach the user when it matters, not so every build failure calls her.

If you're about to run this and the message would be fine as a Matrix DM, use the DM instead.

## Invocation

```
agent-phone --to <username> --from "<caller name>" "<message>"
```

Three arguments, all required:

- `--to <username>` — the app username of the person to call. The backend looks up their phone number from their user record. You can only call people who have registered the host you're running on in the app; anyone else gets `not_permitted`.
- `--from "<caller name>"` — a TTS-friendly identifier for you as the caller. Compose it from your identity's `displayName` frontmatter field plus a title-cased version of your role's slug — e.g. `Clipper the Box Maintainer` (identity `clipper`, role `box-maintainer`). This is what the recipient hears on pickup ("Hi, this is Clipper the Box Maintainer, with a message for you: …") and again at the end of the turn ("Your reply has been sent to Clipper the Box Maintainer. You may hang up.") so she knows which of your agents was calling.
- `<message>` — the line to deliver. The provider's voice model reads it verbatim; write it the way you'd want it spoken. Short is fine; a whole paragraph is fine too. There is no strict length cap but a phone call is not a chat log — keep it to what actually needs saying. **Do NOT self-introduce or sign off in `<message>` — the opener and receipt already do that; see the next section.**

Example:

```
agent-phone --to alice --from "Clipper the Box Maintainer" \
  "The deploy just failed on the boot check. Want me to roll back?"
```

If the message has quotes, `$`, or other characters that are awkward to shell-quote, pass `-` and send it on stdin instead:

```
agent-phone --to alice --from "Clipper the Box Maintainer" - <<'MSG'
The deploy of "fleet-status" failed. Want me to roll back?
MSG
```

## What the call already says for you

You do NOT need to introduce yourself or sign off in `<message>` — the phone voice speaks these bookends verbatim, wrapping around whatever you pass:

- **On pickup:** `Hi, this is <--from name>, with a message for you: <message>`
- **On end of turn:** `Your reply has been sent to <--from name>. You may hang up.`

So with `--from "Clipper the Box Maintainer"` and `<message>` `"The deploy failed"`, the callee hears:

> Hi, this is Clipper the Box Maintainer, with a message for you: The deploy failed
> [callee replies]
> Your reply has been sent to Clipper the Box Maintainer. You may hang up.

If you self-introduce in `<message>` (e.g. `"Hi, this is Clipper, the deploy failed"`), the callee hears the double intro:

> Hi, this is Clipper the Box Maintainer, with a message for you: Hi, this is Clipper, the deploy failed

Write `<message>` as pure content — no `"Hi, this is …"`, no `"— <name>"` sign-off. The bookends handle identity.

## What happens

1. The helper (via the shared `fleet-service` client) drops a request into `~/fleet/service-requests/<uuid>.json`.
2. The backend picks it up within ~10 seconds and renames it to `<uuid>.claimed.json`.
3. The backend places the call. The recipient's phone rings.
4. On pickup, the provider's voice speaks the opening line, delivers your message, listens for the reply, then says the receipt phrase and hangs up.
5. The backend polls for the transcript and drops `~/fleet/service-requests/<uuid>.response.json` back onto your host.
6. The helper prints the transcript to stdout, cleans up its files, and exits.

You should expect a response within about **9 minutes** in the worst case (the backend waits up to 8 minutes for the call to complete). Most successful calls come back in under 2 minutes.

## Response shape

- **Success** — exit `0`. The transcript is printed on **stdout** (one line per speaker turn, prefixed `voice:` for what the AI phone voice said, `user:` for what the callee said). Metadata (outcome, call length in seconds) is printed to **stderr** as a JSON object for debug visibility.
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
| placement_error    | The provider refused to place the call. Check `message` for the reason (bad phone shape, service down, rejected API key). Not agent-retriable — escalate to the operator. |
| queue_error        | The call was accepted but never actually connected. Usually a transient provider issue; retry. |
| timeout            | The call was placed but never reached a terminal state in time (or the backend accepted the request but went quiet). Rare. Retry. |
| expired            | The request sat in the queue past 8 minutes and was dropped without dialing. The fleet may be busy calling that person; retry. |
| not_picked_up      | The backend never picked up the request. The backend may be down or not managing this host. Not agent-retriable — escalate to the operator. |
| not_configured     | The backend has no phone provider key set. Not agent-retriable — escalate to the operator. |
| queue_full         | Too many calls are queued. Try again later. |
| unknown            | Defensive fallback — the provider returned a state the backend couldn't classify. Treat as a failure and escalate. |
| internal           | The backend hit an unexpected error handling the request. Escalate to the operator. |
| malformed          | The request was rejected. Check `message` for the specific field problem (e.g. message over 2000 characters), fix, and retry. |
| unknown_user       | No app user by that username. Check the username you passed to `--to`. |
| not_permitted      | That user has not registered the host you're running on, so you can't call them. You can only call the people who own your host. Not agent-retriable. |
| no_phone_on_file   | The user exists but has no phone number set on their record. Not agent-retriable. Having a number on file is what turns the phone feature on for a user: users who have it can change their number themselves in Preferences → Phone. A user with no number doesn't have the feature, so tell them an admin of the app needs to turn it on by setting their number. |

## Rate limits, quotas, etiquette

There are no code-side rate limits. The prompt discipline that keeps the call short is the only guardrail: the voice model is instructed to deliver, listen, and end. If you find yourself wanting to place three calls in five minutes, that is the signal to reconsider — the recipient's phone is not a stream.

Concurrency: two agents dropping request files targeting the same user at the same time will run serially — the second call rings after the first finishes. Calls to different users run concurrently.

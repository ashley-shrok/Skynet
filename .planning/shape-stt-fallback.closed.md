# Shape: speech-to-text fallback — when the main service fails, the backup transcribes the same recording

**Opened:** 2026-11-02

## What this is

An operator can name a backup speech-to-text service next to the main one. When the main service can't turn a recording into text, Skynet sends the same recording to the backup and returns its text instead. With no backup named, transcription behaves exactly as it does today. It applies everywhere the instance transcribes audio — dictation in the compose box, the agent-facing speech-to-text service, and phone-call replies — and Admin → System shows which main and backup speech-to-text services are configured.

## Shape

- **The backup setting.** A new server setting beside the existing main-service setting. It accepts the same service names as the main one, or "none". Unset or "none" means no backup. A name that isn't a known service, or that names the main service again, is ignored: no backup is used, the server logs a warning once, and the admin view shows it as not in use with the reason. It is never mapped to some other service. Any known service may be the backup, including the in-AWS one.
- **One attempt sequence, shared by all three callers.** The main service gets its normal tries first. Failures that retrying can't fix (out of credit or quota, key rejected, account blocked, service not set up) end the main service's turn at once; "busy or unreachable" failures (overloaded, server errors, timeouts, network failures) are retried as today, and only when those retries run out does its turn end. Any failure that ends the main service's turn — whatever its kind — sends the same recording to the backup, which gets the same number of tries with the same per-try time limit. Each caller keeps its own try count and time limit (dictation, the agent service and phone calls already differ).
- **Classifying credit exhaustion.** A service saying it is out of credit or quota counts as "can't be fixed by retrying", the same way the read-aloud side already reads it — so it no longer burns retries before failing, and it goes to the backup straight away.
- **No memory between recordings.** Every recording starts with the main service. Nothing is remembered about earlier failures (no bench).
- **When both fail.** What the caller is told follows the backup's failure, since it had the last word: out of credit → the existing "quota exhausted, your audio was saved" answer; unavailable → the existing "speech-to-text unavailable" answer; anything else → the existing generic error. Both failures are logged.
- **When the main setting itself is broken** (unknown main service), that stays the existing "unavailable" error — the backup covers a service in trouble, not a broken setting.
- **Logs.** One structured line at each switch carrying the request id, the service switched from, the one switched to, and the reason (credit, auth/unavailable, retries exhausted, other error). A line when the backup succeeds and when it also fails. Shaped like the read-aloud fallback lines. Each caller's request gets a short request id so its lines tie together.
- **What callers report.** Where a caller reports which service transcribed (the agent service does), it names the one that actually produced the text.
- **Admin view.** Admin → System gains a second group directly under the read-aloud "Voice" group, titled "Voice input", with "Main service" and "Backup service" lines in the same style (backup shows "None" when unset; an ignored setting shows "Not in use" in red with its reason). Footer: "The services that turn dictation and recordings into text. Set in the server configuration; when the main service fails, the backup transcribes the same recording." The read-only admin information the page already loads carries the speech-to-text pair alongside the read-aloud pair.
- **Docs.** The example server configuration and the voice setup notes describe the new setting, including that a backup off AWS sends audio to a third party when the main fails.

## Philosophy

The backup exists so a recording becomes text when it otherwise wouldn't. It never changes where audio goes unless the operator explicitly named the backup — no defaults, no guessing at a misspelled name. It does not spend the backup on one-off blips the main service would recover from on retry. It keeps the single-service experience byte-for-byte when no backup is set.

## Prior context

The read-aloud side already has a backup setting with switch logging and an admin display; this mirrors its spirit but is simpler: a recording is one whole request, so there is no partial result to resume, and (by decision) no bench. t1000's main speech-to-text service is ElevenLabs, nearly out of credit until Nov 8; the intended config is ElevenLabs main with Groq backup (Groq key already set). Dictation, the agent speech-to-text service and phone-call replies all already go through the same resolve-then-retry path.

## What would make it wrong

- Audio reaching a service the operator didn't name, for any reason.
- An instance with no backup behaving differently in any way.
- A credit-exhausted main service still costing the user retry delays before the backup gets the clip.
- One of the three callers left on the old single-service path.
- A switch happening with no log line explaining it.

## Scope edges

- In: the setting, the shared attempt sequence, credit classification, logs, all three callers, admin "Voice input" group, docs, unit tests next to the existing speech-to-text tests (plus route, agent-service and admin-pane tests as touched).
- Out: a bench / remembering failures across recordings; changing retry counts or time limits; changing the read-aloud backup; a What's-new note and id-skill edit (admin-only).
- Deferred: none.
- Tempting but no: falling back when the main *setting* is invalid; making the backup user-selectable.

## Handoff notes

Identity duet-box-maintainer-5 does the work in its Skynet tree on the shared branch. Commit, scoped tests green, then stop: "committed + green; not pushed, not deployed". Deploy (adding the backup line to the server env and recreating the container) needs Ashley's separate greenlight.

---

## Close-Out

**Closed:** 2026-11-02
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · Backup setting beside the main one; same recording goes to the backup on failure; no backup = main's result unchanged; all three callers; admin shows the pair.
- **Shape: the backup setting** — present · Same names or none; unset/blank = no backup; unknown or same-as-main ignored, never remapped, warned once per value, admin shows not in use with reason; in-AWS service allowed as backup.
- **Shape: one attempt sequence shared by all three callers** — present · Main gets its normal tries; any turn-ending failure hands the same recording to the backup with the same tries and per-try limit; each caller keeps its own count and limit.
- **Shape: classifying credit exhaustion** — present · Out-of-credit/quota replies (incl. payment-required) are not retried and go to the backup at once, same rule as read-aloud.
- **Shape: no memory between recordings** — present · Every call starts with the main service; tested.
- **Shape: when both fail** — present · Answer follows the backup's error; both failures logged.
- **Shape: broken main setting** — present · Unknown main service stays "unavailable" before any backup is considered; tested.
- **Shape: logs** — present · Switch line (request id, from, to, reason), backup-ok and backup-failed lines; request ids for all callers; retry lines carry the id too.
- **Shape: what callers report** — present · Agent service names the service that actually transcribed.
- **Shape: admin view** — present · "Voice input" group under "Voice", Main/Backup lines, None / Not in use with reason, footer exact.
- **Shape: docs** — present · Example config and voice setup notes describe the setting and the third-party caveat.
- **Philosophy** — present · Only an explicitly named backup is used; blips stay on the main service; no-backup result unchanged.
- **Prior context commitments** — present · No bench, no resume; all three callers on the new sequence; deploy config untouched.
- **Scope edges** — present · In-scope items and tests present; retry counts/limits, read-aloud backup logic, What's-new and id skill untouched.
- **What would make it wrong: audio reaching a service the operator didn't name** — present · Guarded.
- **What would make it wrong: an instance with no backup behaving differently** — present · Guarded; only the requested request id in logs differs.
- **What would make it wrong: credit-exhausted main still costing retry delays** — present · Guarded, incl. quota sent as "slow down"; tested.
- **What would make it wrong: a caller left on the old single-service path** — present · None left.
- **What would make it wrong: a switch with no log line** — present · The only path to the backup runs through the switch line.
- **Tempting but no: falling back when the main setting is invalid** — present · Not done.
- **Tempting but no: user-selectable backup** — present · Not done; admin view read-only.

### Additions (in the result, not in the shape)

None.

### Follow-ups

- With a backup set, an agent speech-to-text request whose two services both time out on every try can exceed the agent's 9-minute wait, so the agent may give up first. Expected under the agreed "keep time limits" scope; maybe worth a later look. — accepted-as-drift

### Notes

Settled by reading only. Switch/failure log lines also carry the caller and the error's name and message — treated as part of "both failures are logged", not a new feature.

# Fix: voice skill trigger when STT writes "/" instead of the word "slash"

**Opened:** 2026-10-09

- **Observed wrong behavior:** If speech-to-text renders the spoken word "slash" as a literal "/" (e.g. "/light review"), the server-side voice matcher's wake-word gate only recognises the word "slash", so the transcript passes through untouched and the agent receives "/light review" (skill "light" + argument "review") instead of "/light-review".
- **Correct behavior after the fix:** A transcript starting with "/" followed by spoken words gets the same longest-prefix skill matching as one starting with "slash" — "/light review" → "/light-review", "/ gsd quick fix it" → "/gsd-quick fix it". A leading "/" that matches no skill still passes through unchanged.
- **Suspected file(s):** the voice slash-command transform's wake-word pattern (server side), plus its truth-table tests.

## Change made

Widened the voice transform's wake-word gate (shared by the voice route's pre-check and the matcher) to accept a leading literal "/" with an optional delimiter run after it, alongside the spoken "slash". Matching, longest-prefix joining, verbatim tail, and no-match passthrough are unchanged. Also removed four pre-existing unnecessary escapes in the same file's delimiter classes (lint), with identical meaning. Nine new truth-table tests.

done: "/light review", "/ light review", "/Light Review." → "/light-review"; "/gsd quick fix the login bug" → "/gsd-quick fix the login bug"; "/etc/hosts looks wrong", bare "/", and mid-message "/" pass through unchanged; "slash light review" still works (76/76 voice tests green).

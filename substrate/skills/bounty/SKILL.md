---
description: Save a bounty under your current /id identity without interrupting what you are doing. Invoke on `/bounty <thing>`.
---
Save this as a new bounty under your CURRENT identity's bounty queue: $ARGUMENTS

Do NOT investigate, search the codebase, read files, or make any tool calls to
understand, locate, or flesh out what's described — capture what was said, as it was
said. Do not analyze it, comment on it, research it, or start working on it. The whole
point is a fast, zero-overhead parking spot; any understanding or investigation happens
later, when the bounty is picked up. Capture it, confirm the slug in one line, and return
to whatever you were doing.

When creating the bounty file, set `"pinned": true` on the new bounty. Bounties captured
via /bounty are user-authored (the invocation itself IS the user parking it), so they
inherit user-pinned status by default — this is consistent with the id-skill § pinned
rule that only the user pins, because /bounty invocations ARE the user pinning. She can
unpin later if she wants it off her radar.

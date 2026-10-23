# Shape: agents can un-archive identities — one un-archive path, with the supervisor asking the backend to reactivate the chat account

**Opened:** 2026-10-23
**Supersedes:** shape-agent-side-identity-unarchive-correction.md (declared 2026-10-01, never opened)

## What this is

Today only the front-end button can un-archive an identity, because bringing the identity's chat account back to life needs the chat server's admin credentials, which live only with the Skynet backend on t1000. This work makes un-archive a single path that anyone can start, the front end or an agent, by dropping the "please un-archive me" flag in the archived folder. The supervisor on the identity's box sees the flag and runs the whole un-archive. Its first step is to ask the backend, through the same request-file mechanism agents already use for phone calls and image generation, to reactivate that identity's chat account. The backend does the reactivation only after checking that the account really is a switched-off agent account belonging to an agent archived on the asking box.

## Shape

- **The flag is the only trigger.** The front end and agents both start an un-archive the same way: drop the flag inside the archived identity's folder. The backend no longer does any chat-account work when the button is pressed.
- **The front end's quick checks stay.** Before dropping the flag, the button still checks that the archive exists, the name isn't taken by a live identity, and every role the identity held is live. These give the same immediate alerts as today.
- **The front end waits for the real outcome**, the same way creating a new conversation does. The button's request stays open while the server checks the box every few seconds. The row shows a spinner the whole time, and the wait ends in one alert:
  - **Success:** the folder is back in the live tree, and the alert says "<name> is back".
  - **Refusal:** a refusal note has appeared in the archived folder, and the alert gives its reason.
  - **Timeout:** after 2 minutes, the alert says "still working on it, check back shortly"; the un-archive keeps trying in the background.
  - **Tab closed:** if you close the tab mid-wait, you miss the alert but the un-archive still happens.
- **The supervisor runs the un-archive.** On seeing the flag it re-checks the name and the roles itself, then files a reactivation request with the backend naming only the identity. It keeps the flag in place until the request is answered. If the backend is unreachable, it retries on later passes; that's waiting, not failure.
- **The backend is the gatekeeper for reactivation.** The request names the chat account to bring back, which the supervisor reads from the archived identity's saved login. It never carries a password. The backend checks the account itself and reactivates only if all of these hold:
  - the account is currently switched off;
  - it has at some point been in the agents directory room;
  - it has never been in the humans directory room;
  - it is not an admin account.

  If any check fails, it refuses with a plain reason. Archiving erases the account's password on the chat server, so reactivating always sets a new one. The backend makes a fresh random password, reactivates the account with it, puts the account back in the agents directory, and sends the new password back only to the box that asked, in the response to its request.
- **The supervisor finishes.** Once reactivation succeeds, it saves the new password into the archived identity's saved login, then logs in with it to get a fresh login. It confirms the login works, then does the steps it does today:
  - marks the identity dormant, unless it was always-on;
  - moves the folder back to the live tree;
  - restores the identity's conversation apps;
  - adds the "you were un-archived" banner.
- **Refusals leave a note.** When the supervisor or the backend refuses, a short plain-text note saying why is left in the archived folder and the flag is cleared. The front end reads this note for its alert. An agent that asked for the un-archive looks for this note if the conversation hasn't come back within about a minute.

## Philosophy

- One un-archive path, in one place. The button and an agent's request go through exactly the same steps, so there's no second path to drift out of sync.
- The chat admin credentials never leave the backend. Boxes get a narrow ability, "bring back one of my own archived agents", never a general admin power.
- Trust nothing from the request beyond which account it names. The backend checks the account for itself, and the new password only ever goes back to the box that asked.
- Never touch a live account. Reactivating also sets the account's password, so the "currently switched off" rule is what guarantees no live account, human or agent, can have its password changed through this path.
- The backend no longer creates logins on anyone's behalf during un-archive. It hands back a password, and the supervisor logs in normally with it.
- Agent-initiated un-archives still need the user to ask for them, as they do today.

## Prior context

- Today the button does the chat-account work directly (reactivate, create a login, rewrite the saved login) and then drops the flag. The supervisor moves the folder only after a test login proves the account is live. A flag dropped by an agent alone is refused, which is why agents are currently told they can't un-archive identities.
- The 2026-10-01 declared plan proposed a new backend address that supervisors would call, guarded by a shared secret. This shape uses the existing agent request-file mechanism instead, which already knows which box a request came from, so no new secret has to be distributed.
- Checked on the live chat server, 2026-10-23: archiving takes an agent out of the agents directory room, but the server keeps the record that it used to be a member. 591 of 596 archived agents on t1000 still show up that way. The 5 that don't (tabitha, tanya, taylor, tiffany, tina) are very old, predate the directory, and are out of scope.
- Checked in the chat server's own data, 2026-10-23: archiving erases the account's password (all 1,318 switched-off accounts have none), so reactivation always means setting a new password. That's why the backend generates the password and hands it back, rather than trusting one from the box.
- Accepted gap (Ashley, 2026-10-23): there is no check that the account belongs to the box that asks. Someone on any box could get any switched-off agent account (never a human's, never a live one, never an admin) reactivated with a password only their box receives. Today's button path has a similar exposure. Ashley approved shipping with this gap because host-tagged account names, a separate shape planned to follow quickly, close it properly. Folder-name checks were considered and dropped: 108 of 597 archived agents on t1000 have accounts not named after their folders (pre-current naming), and the check adds no real protection on its own.
- Also found: Ashley's own account has joined the agents directory room. That's why being in the agents directory alone isn't enough, and the "never in the humans directory" and "currently switched off" checks matter.
- Today's un-archive never puts a returned identity back in the agents directory, so a returned identity stays marked as having left, and the app can mistake its chats for a human or unknown account. This shape fixes that as part of reactivation.
- The new-conversation flow is the precedent for the front end's long wait. Its request stays open, checks the box every 2 seconds, and alerts on failure or timeout (5 minutes there; 2 minutes here).

## What would make it wrong

- If any account that is currently active can be reactivated, or have its password set, through this path.
- If a box can get an account reactivated that belongs to a human, is live, or is an admin.
- If the reactivation request ever carries a password, or the new password ever goes anywhere but the box that asked.
- If the button and an agent's flag end up taking different routes through un-archive, or the backend keeps a second copy of the chat-account logic "just in case".
- If the reactivation ability grows into anything else: creating accounts, deactivating, changing other accounts, or managing other rooms.
- If a refusal is silent, meaning the user or the asking agent can't find out why an un-archive didn't happen.
- If a returned identity is still not recognized as an agent afterwards.
- If the front end makes the user watch for the outcome themselves, instead of getting one alert at the end, as with new conversations.

## Scope edges

**In:**
- The reactivation request type and its gatekeeping checks on the backend.
- Re-joining the agents directory when reactivating.
- The supervisor's un-archive becoming the single place the work happens: requesting reactivation, the normal login, the refusal note, and the existing steps.
- The button becoming checks, then the flag, then waiting for the outcome with a 2-minute ceiling.
- The skill agents use for un-archiving: lifting the "agents can't un-archive identities" restriction, explaining the refusal note, and keeping the rule that the user has to ask.

**Out:**
- The five pre-directory agents (tabitha, tanya, taylor, tiffany, tina). They're refused with a clear reason, and there's no cleanup.
- Restoring any room memberships other than the agents directory. The accepted caveat that rooms don't survive archiving stands.
- Role and app un-archive, which already work for agents.

**Deferred:**
- Host-tagged account names: putting a box tag in every new agent's account name, so the backend can tell from the name alone which box an account belongs to. When that lands, reactivation adds "a tagged account must carry the asking box's tag", which closes the accepted gap for every new agent.

**Tempting but no:**
- Having the supervisor react to the flag instantly instead of on its next pass. Normal latency is fine.
- Pinging Ashley when an agent-initiated un-archive is refused.

## Handoff notes

- Implementer: halo-box-maintainer-5. Shipping only on Ashley's go, via the box-maintainer ship skill.
- Where things live today:
  - The button's server-side route: `src/backend/database/routes/identity-unarchive.ts`.
  - The supervisor's un-archive scanner: `substrate/scripts/agent-supervisor.sh`.
  - The agent request-file framework: `src/backend/agent-services/` (see its README; the phone, image and speech-to-text services are examples).
  - Registry rooms: `src/backend/relay-sessions/registry-rooms.ts`.
  - The new-conversation long-wait precedent: the wait-for-supervisor block in `identity-birth-orchestrator.ts` and its spinner in `NewSessionDialog.tsx`.
  - The un-archive button: `ConversationSearchModal.tsx`.
- The reactivation call the backend uses today also sets the password and sets admin to false. That's why the "currently switched off" check must come first.
- The supervisor calls agent services through the shared host-side client. Make sure that works from the supervisor's own context, not just from an agent's session.
- The id skill's identity un-archive section lives in the substrate skills tree. Updating it is part of this work, and it reaches agents through the distributor.
- Existing supervisor shell tests for un-archive need migrating.

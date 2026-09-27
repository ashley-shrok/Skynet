# Shape: notifications-to-harness — tapping a push notification lands on the agent's harness view, not the relay-room mirror

**Opened:** 2026-09-27
**Vehicle:** inline (harness tasks tracking pieces of work)

## What this is

When an agent sends a message into the one-on-one Matrix room she shares with the human, Skynet fires a push notification to the human's phone or desktop. Today, tapping that notification opens the Matrix relay-room view of that DM. This shape swaps that landing target: tapping the notification opens the harness view of the sending agent — the live one-on-one conversation surface for that user↔agent pair — instead of the relay-room mirror underneath it.

## Shape

There are two views over the same conversation between a human and an agent:

- The **harness view** is the live view of the agent itself. It is the primary one-on-one conversation surface for a user↔agent pair.
- The **relay-room view** is the Matrix room where those messages travel between phone and agent brain. It is plumbing under the harness view — the same conversation, in its transport form.

Skynet deliberately hides one-on-one relay rooms from the sidebar because the harness view already IS the one-on-one with each agent. Push notifications are triggered by matrix activity in that hidden relay room, but the tap-target for the notification should be the harness view of the agent, not the relay room.

The routing chain, conceptually:

1. Agent sends a message → matrix activity fires → backend decides a push is warranted.
2. Push payload carries who the sender is and where their home host is, so the phone knows the target agent uniquely.
3. Notification lands on the phone; user taps.
4. The service worker navigates the app; the app resolves the sender to the harness view for that agent.
5. If the user already has a tab open with that agent's harness view, we focus it. If not, we open a fresh one, the same way tapping the agent's row in the sidebar would.
6. The routing information carried in the URL is stripped after arrival, so a reload or a copied URL does not re-fire the deep-link.

If the harness view genuinely cannot come up — the agent's identity has been archived, the tmux session is dead, or the home host is not reachable from this Skynet at this moment — the app lands on its default view and surfaces a brief toast naming the agent it tried to reach. No silent land, no relay-room fallback.

## Philosophy

- **The harness view is the one-on-one conversation.** The relay room is transport; a user should never be pointed at transport as a destination.
- **Tap parity with sidebar rows.** Tapping a notification should feel like tapping the agent's row in the sidebar — same landing, same focus-if-exists rule, same experience.
- **The tap is deterministic.** The payload carries what the phone needs to route. We do not depend on the phone's cached identity list being loaded, current, or complete for the routing to work.
- **Failures are honest and lightweight.** If the harness view cannot open, tell the user briefly and land somewhere sensible; do not silently swallow the tap, do not fall back to the plumbing view, do not open a modal for something this minor.
- **Same behavior on phone and desktop.** A notification tap is a notification tap.

## Prior context

Push notifications are already wired end-to-end: matrix activity in a one-on-one agent room fires a backend loop that dispatches web-push to the human's registered devices. The service worker on the device receives the push, shows a system notification, and on tap navigates the app to a URL that carries the target room. The app reads that URL on mount, opens a tab pointed at the relay-room view of that room, and strips the routing information from the URL so a reload does not re-fire.

The load-bearing invariant that makes this shape simple: in this fleet, an agent's mxid is host-scoped — its homeserver part maps 1:1 to a fleet host. So the sender mxid on the push payload uniquely identifies both the identity and its home host, and the tap-target resolution has no ambiguity.

## What would make it wrong

- If tapping the notification ever lands the user on the relay-room view of the DM, this has missed the point. That is the current bug, and no fallback path is allowed to silently reintroduce it.
- If the tap opens a duplicate harness tab for an agent that already has one open, the change has made the app worse than the current state.
- If the routing depends on the phone's identity list being loaded at tap time, and the tap silently fails (or opens the wrong thing) when the list is stale or empty, the payload isn't carrying its weight.
- If the "couldn't open" failure surface is a blocking modal, or is completely silent, the change has misjudged the register — it should be a brief non-blocking hint.
- If the routing information stays in the URL after arrival, a copied URL leaks routing data and a reload re-fires the deep-link — the current URL-cleanup discipline must carry forward under the new scheme.
- If the change treats phone and desktop differently without a reason we agreed on, we have introduced platform drift where there should be none.

## Scope edges

**In:**
- Notification click routing for one-on-one agent DM pushes — the only kind of push currently fired.
- Payload shape change to carry the sender's home host alongside the mxid.
- Tab focus-if-exists / spawn-if-not for the landing.
- Toast surface when the harness view can't come up.
- URL-cleanup discipline carried forward under the new routing scheme.
- Tests across the touched surfaces.

**Out:**
- Group relay rooms (three or more participants) — they don't fire pushes today; that stays unchanged.
- Any change to the sidebar's row visibility rules or its click behavior — the change is exclusively about how tapping a push notification routes.
- Any change to how notifications are triggered — the trigger loop stays as it is; only the tap-target changes.
- Any change to unread indicators or badges anywhere else in the app.
- Per-agent notification preferences, mute lists, or opt-in surfaces beyond what already exists.

**Deferred / tempting-but-no:**
- Deep-linking to a specific message within the conversation via the notification. Landing at the bottom of the harness view is what we ship.
- Rich actions on the notification itself (reply, mark-read). Same reason — not this shape.

## Vehicle notes

Inline, working through the pieces one at a time with harness tasks tracking each piece. This is a change that fans across backend, frontend, and service worker, but each piece is small and the whole shape is well-scoped — the discussion here does the work a phase spec would otherwise do. Atomic commits per piece; scoped tests as we go per the fleet's dev-time discipline; full suite as the pre-deploy gate.

The Skynet repo working tree lives under this identity's workspace; the current branch carries other in-flight work from peers, so `git pull --rebase` before every push per the multi-identity discipline. Nothing here mutates container state — `docker build` and container restart only happen on the user's deploy greenlight, separate from the code commits.

`/close notifications-to-harness` closes the arc at the end.

---

## Close-Out

**Closed:** 2026-09-27
**Vehicle used:** inline (harness tasks tracking pieces of work) — matches what the shape recorded at open time
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · tap now writes/reads openHarness=mxid&host=hostId instead of the old openRoom=roomId scheme end-to-end
- **Shape: routing chain steps 1-6** — present · payload carries agentMxid + agentHostId; SW writes openHarness URL; AppShell parses + resolves + focuses or spawns; replaceState strips both params post-arrival
- **Philosophy: harness view is the destination, not relay-room** — present · no code path routes to relay-room view from a notification tap; openTab call opens a terminal tab keyed on identityKey
- **Philosophy: tap parity with sidebar rows** — present · same allowCreateTmux:false + targetTmuxSession=identityKey shape onDetachedRowClick uses; existing-tab focus preserves no-duplicate-tab rule
- **Philosophy: deterministic tap (no dependence on identity list)** — present · identityKey derived from mxid regex; host from hostsById; identitiesByKey only used for display label with mxid-localpart fallback
- **Philosophy: failures honest + lightweight** — present · toast.error names the agent; non-blocking; no modal; no silent no-op
- **Philosophy: same behavior phone + desktop** — present · single SW handler + single AppShell parser fire on either platform
- **Prior context: payload carries home host** — present · PushPayload extended with agentHostId; resolveAgentHostId reads IDENTITIES_LOCAL_HOST_IDS and confirms identity folder on disk
- **What would make it wrong: tap lands on relay-room view** — present · no openRoom code remains; SW writes only openHarness; AppShell reads only openHarness
- **What would make it wrong: duplicate harness tab for already-open agent** — present · tabs.find matches (host.id, terminal, targetTmuxSession=identityKey) then selectConversationDeferred; only falls through to openTab when no match
- **What would make it wrong: routing depends on stale identity list** — present · routing key is (mxid, hostId) both carried on payload; identitiesByKey only affects display label with an identityKey fallback
- **What would make it wrong: failure surface is blocking modal or silent** — present · toast.error via Sonner is non-blocking; failure branches are explicit and never silent-drop
- **What would make it wrong: routing info stays in URL after arrival** — present · history.replaceState(null, '', pathname) strips both params on success; BASE_PATH preserved (test case 10)
- **What would make it wrong: phone/desktop drift** — present · single SW handler + single AppShell effect; no platform branching
- **Scope edges: In** — present · notification click routing, payload shape change, focus-if-exists/spawn-if-not, toast surface, URL cleanup, tests across all touched surfaces — all delivered
- **Scope edges: Out** — present · group relay rooms untouched; sidebar visibility + click behavior untouched; trigger loop unchanged (only payload extended); no unread/badge changes; no per-agent prefs changes
- **Scope edges: Deferred** — present · no deep-link-to-message (openHarness carries mxid + host only); no rich actions on notification

### Additions (in the result, not in the shape)

None.

### Follow-ups

None.

### Notes

The material also removed the retired open-room-deep-link module + its tests as the shape implied (successor swap). AppShell open-callback resolves mxid → identityKey via the same lowercased-localpart convention used elsewhere in the fleet (IDENTITY_KEY_RE). Backend resolver has a belt-and-suspenders fs.stat check of the identity folder in case the classifier ever regresses on the local-only gate. Tests cover: happy path, missing/empty/malformed mxid, missing/non-numeric/negative/zero host, callback-throw, BASE_PATH preservation on URL cleanup, SW notificationclick routable vs unroutable, push handler shape (no tag, correct data trio), and the resolver's env-populated / empty-env / multi-entry branches.

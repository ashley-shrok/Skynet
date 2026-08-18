# Shape: Auto-deactivate convs that haven't been entered in a while

**Opened:** 2026-08-18
**Vehicle:** /gsd:quick

## What this is

Each open PWA tab watches which convs are in its active-set and how long ago each one was the currently-entered conv. If a conv has been unentered for longer than a threshold, the tab silently fires the exact same deactivate action a user gets from the deactivate control in the conversation list today — no new mechanism, just the existing action fired by an idle timer instead of a click. The point is freeing resources on convs the user isn't paying attention to right now.

## Shape

Each open tab holds a per-conv timestamp: the last moment that conv stopped being the entered one. A background tick, on some short cadence, walks the active-set. For any conv whose "last unentered at" is older than the threshold, the tab invokes the same deactivate action the user's click already invokes.

The currently-entered conv is exempt. Its clock does not run while it is the entered one. The clock starts the moment the user navigates away.

The threshold value comes from an existing app config source. No settings UI. No knob in the interface.

The whole timer + timestamp map is per-tab, held only in the tab's live running state, never shared, never persisted across tab close, never sent to the server. Each device — desktop, phone — runs its own independent clock.

## Philosophy

This is a pure resource-freeing policy. It is deliberately not:

- a hibernation feature — there is no state preservation beyond what the existing deactivate action does today
- a UI change — no toast, no annotation, no animation, no log entry, no visible signal at all; a conv that auto-deactivates looks identical to a conv the user just clicked to deactivate
- a mechanism change — the deactivate action itself is untouched; the sweep only fires it
- a backend feature — nothing leaves the tab; the server never learns "your idle sweep just fired"
- a per-user or per-account concept — clocks are per-tab, not per-user; two tabs on the same account run independent clocks
- an exemption for special convs — pinned convs participate, convs with an agent actively producing output participate, "just came off the active-set a moment ago" convs participate the moment their clock crosses the threshold

The stance is: if the user is not looking at a conv right now, it costs resources for no reason, and the deactivate action already exists and already frees those resources without any visible cost. So a timer that fires it on idle convs is nothing but win. Anything grafted onto that — a settings surface, an animation, a "wait, the agent's still working" exception, a warmer reactivate path — moves out of the spirit of "silent resource release" and belongs in a different piece of work.

The user's focus is the only signal that keeps a conv alive. Agent activity does not count. Recent scrolling of the conversation list does not count. Having the list open on-screen does not count.

## Prior context

The deactivate action already exists as a click affordance in the conversation list. Ashley uses it manually today.

A crucial current-state fact: activating or deactivating a conv has zero visual or positional consequence — the row stays exactly where it is in the list, no reshuffling, no fade. The only real-world effect is what the tab is holding in memory. That is what makes the silent, sweep-fired variant fine: there is nothing for the user to notice.

The active-set for each tab lives only in the tab's live storage — it dies on tab close, does not sync across devices, does not persist to the server. That is the same layer where this feature's per-conv timestamp map naturally belongs. There is no persisted "here are the convs that were active in your last session" state that would need consulting on tab reopen; a fresh tab starts empty and has nothing to sweep.

The ready-for-attention dot depends on a conv being in the active-set. When a conv auto-deactivates, its dot goes away too — same as when the user clicks deactivate manually. That is intended, not a regression.

A related bounty about pinned convs jumping between hosts during deactivate was invalidated by the recent flat-recency-sort work on the conversation list (no more per-host grouping means no more jump behavior) and has been dropped.

The reactivate path — what happens when the user taps a deactivated conv to open it again — is out of scope. Whatever cost exists today for reactivating is the cost this feature accepts. If reactivation is too slow at the chosen threshold, that is a separate concern about the reactivate path, not about this policy.

## What would make it wrong

- If the currently-entered conv ever deactivates itself out from under the user, this has missed the point. The one you are on is exempt, always.
- If deactivating produces any user-visible signal — a toast, an animation, a mark on the row, a subtle log line — this is doing more than silent resource freeing.
- If entering a conv on one device changes anything about another device's clock, per-tab isolation has been violated.
- If the threshold requires a code change to tweak — rather than reading from the same config layer other tunable values live in — this has left the "policy only" frame.
- If the sweep touches the backend, the server, or any shared state beyond the single tab, this has grown beyond its scope.
- If a conv gets an exemption because "the agent is streaming output," the user's focus stops being the sole signal — the whole model becomes ambiguous and this has picked a side the user did not ask for.
- If pinned convs are quietly excluded because "they feel more important," pin state has been given a new meaning it does not have today.
- If a settings surface appears in the interface to tweak the value, or a "here is why this deactivated" observability panel, this has picked up scope that belongs elsewhere.
- If any code path assumes cross-tab or cross-device knowledge of "when was this last entered anywhere," backend involvement has snuck in through the side door.

## Scope edges

**In:**
- A per-tab timer that walks the tab's active-set on a short cadence
- A per-tab, per-conv timestamp map of "last moment this conv stopped being the entered one"
- Reading the threshold from an existing app config layer
- Firing the existing deactivate action for any conv whose idle time crosses the threshold
- Exempting the currently-entered conv from ever being a candidate

**Out:**
- Any settings UI for the threshold
- Any change to what the deactivate action does
- Any change to the reactivate path
- Any visible signal that the sweep just fired
- Any backend tracking, cross-tab coordination, or cross-device sync
- Any exemption for pinned convs, active-agent convs, or recently-active convs
- Any persisted timestamp store — the map lives only in the running tab

**Deferred / tempting-but-no:**
- A warmer reactivate path — reactivation is whatever it is today; if the chosen threshold makes reactivate cost feel bad, that is a separate piece of work
- A visible "recently auto-deactivated" list for user observability — this is a silent feature
- Any dot or annotation surfacing "this conv was auto-vs-manually deactivated" — no user-visible distinction

## Vehicle notes

Chosen because the change is small — one existing action reused verbatim, one config value read from an existing layer, one tab-local timer and timestamp map — but big enough to want an atomic commit and tracked scope. Inline in a design conversation felt too casual; a whole phase felt oversized for a change with this much clarity and this little touch surface.

Executor guidance:

- Locate the existing deactivate action for a conv in the conversation list and reuse it verbatim. Do not reimplement or fork the deactivate logic.
- The threshold lives in the same config layer other tunable values already live in — find it, add the value there, do not invent a new config location.
- The per-conv timestamp map belongs in the same tab-local layer the active-set already uses. No new persistence layer.
- Do not touch the reactivate path.
- Do not add any user-visible surface — no settings, no toast, no annotation.
- Currently-entered conv exemption is a hard invariant, not a nice-to-have. Verify with a test.

Written in the `~/skynet-tiffany` working tree, currently loaded identity `tiffany`, box-maintainer role. This is the shape-of-record for the follow-up `/gsd:quick`. Close-out via `/close auto-deactivate-idle-convs` after the quick task's ship.

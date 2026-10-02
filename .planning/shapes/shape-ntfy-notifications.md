# Shape: Durable push notifications via self-hosted ntfy, replacing the current browser-push system

**Opened:** 2026-10-02
**Vehicle:** GSD phase(s)

## What this is

Replace Skynet's current browser-based push notification system end-to-end
with a self-hosted ntfy server that publishes to a per-user topic, which
the user receives via the ntfy iOS app over Apple's own push
infrastructure. The triggering event stays the same (a one-on-one DM from
an agent to the user). The notification content stays the same (agent
display name, message preview, tap-through that opens the specific
conversation). What changes is the transport — from a browser subscription
(which iOS silently rots every couple of weeks) to a real native app with
reliable push delivery.

## Shape

Each Skynet instance that enables this feature runs its own ntfy server
alongside the rest of its stack, inside the same Docker stack as the rest
of Skynet. The instance's existing Caddy edge routes a path prefix on the
instance's existing public hostname (whatever that hostname is for that
instance) to the ntfy server — no dedicated subdomain, no additional TLS
certificate, no new DNS record. Publishing from Skynet to ntfy happens
over the internal Docker network. The ntfy server also opens outbound
connections to ntfy.sh over the public internet for iOS wake-up relaying
(see the philosophy section for the trust story).

The user's phone runs the ntfy iOS app, pointed at the instance's own
hostname + the ntfy path prefix, with a per-user reading credential.
Setup is manual entry (the ntfy iOS app has no QR scanner): the
preferences pane displays the server address, topic name, and reading
credential; the user enters them in the ntfy app's add-subscription flow.
Nothing in the code or config may hard-code any specific instance's
hostname — the base URL ntfy uses, the URL the preferences pane shows the
user, and the URL the iOS app points at all derive from the instance's
own existing public-hostname configuration.

Credentials have strict directionality:

- A single Skynet-held **publishing credential**, write-only, lives in the
  encrypted backend store. Only Skynet uses it. Never distributed to
  hosts, never lands in any agent's context.
- A **per-user reading credential**, read-only, also stored encrypted on
  the backend. Surfaced to the user through the preferences pane for
  manual entry into the ntfy app.

The existing trigger loop that watches for one-on-one agent-to-user DMs is
unchanged. The existing display-name resolution and message-preview
composition is unchanged. The existing deep-link that opens the right
conversation when the user taps a notification is unchanged.

What swaps out:

- The publishing step. Instead of calling the browser-push system, Skynet
  does an HTTP POST to the local ntfy server over the internal network.
- The subscription data model. Browser-push subscription records (one per
  user-device, with browser-push-specific cryptographic material) are
  replaced with ntfy-topic + reading-credential records.
- The preferences pane. The "grant browser permission" button is replaced
  with a setup pane showing the values to enter in the ntfy app, a test
  button that buzzes the phone to prove end-to-end delivery, and a
  regenerate button that rotates the reading credential.
- The browser's background worker loses its push handler entirely —
  notifications no longer arrive in the browser; they arrive at the
  ntfy iOS app on the phone.

One topic per user, not per-agent. The notification content continues to
carry the agent's identity in the payload (same as today). Per-agent
muting would require a separate topic per sender and matching extra
credentials; that's a nice-to-have deferred to a future shape.

The preferences pane shows exactly two state signals: whether the user
has completed setup, and the test button's result. No passive "last
delivery was X seconds ago" indicator, no heartbeat, no silent-drift
detection.

## Philosophy

- **Pure cutover, not dual-transport.** The browser-push code gets deleted
  in the same ship as ntfy arrives. No overlap period, no fallback.

- **The ntfy server is a Skynet-internal detail, not a shared box
  service.** One ntfy server per Skynet instance. If anything else on a
  box wants to send notifications in the future, that's a separate shape
  with its own credential and its own conversation.

- **ntfy.sh is a necessary third-party relay for iOS wake-ups, and we
  accept that dependency honestly.** The ntfy iOS app's push certificate
  with Apple is held by the ntfy project, not by us — getting around that
  would require shipping our own iOS app, which we aren't doing. So when
  a message is published to our self-hosted ntfy server, our server sends
  a wake-up signal (message ID + topic hash, no content) upstream to
  ntfy.sh, which uses its own certificate to send an Apple push to the
  user's phone. The phone then fetches the actual message content
  directly from our self-hosted server. **Content stays private; metadata
  is visible to ntfy.sh.** Reliability of iOS pushes couples to
  ntfy.sh's uptime. This is the cost of iOS push without a native app,
  and every alternative push service has the same architecture.

- **No instance-specific hardcoding.** The code we ship must work on any
  Skynet instance at any hostname. The ntfy base URL, the hostname shown
  to the user in the preferences pane, and the hostname the iOS app
  points at all derive from the instance's own existing public-hostname
  configuration — not from any value baked into the codebase.

- **The test button is the only ground truth about delivery health.** The
  system does not probe for silent drift, does not try to detect expired
  topics or dropped Apple pushes ahead of time, does not run heartbeats.
  The user owns their own confidence by tapping the button whenever they
  want certainty.

- **Publishing is fire-and-forget-with-logs.** If ntfy is unreachable the
  moment a DM lands, the notification is lost and the log says so clearly.
  No queue, no backoff, no retry subsystem.

- **One push per DM, no coalescing or priority tiers.** Preserve exactly
  the current cadence; only the transport changes.

- **Hard credential rotation, no overlap window.** When the user hits
  regenerate, the old reading credential stops working the moment the new
  one is issued. The phone stops receiving pushes until the user enters
  the new values in the ntfy app. Simpler and more honest than a soft
  rotation.

- **The preferences pane's state must never lie about reality.** The
  current bug — where the "enabled" indicator reflects a browser
  permission bit, regardless of whether anything downstream still
  functions — does NOT get carried forward.

## Prior context

Skynet already has a working-in-concept push notification system. A loop
polls Matrix every two seconds per user, classifies which rooms are
one-on-one agent-DM rooms, composes a notification using the agent's
display name and a preview of the message, and publishes via the browser's
push infrastructure to all registered subscriptions for that user. The
browser's background worker displays the push and routes taps to the right
conversation.

On iOS specifically, this system silently rots. The browser subscription
gets revoked — either by Apple's privacy policy clearing storage after a
week of PWA inactivity, or by Apple's silent-push revocation after a few
delivery misses. The subscription-renewal mechanism in the background
worker tries to re-register, but if that re-registration fails (network
blip, server error), the failure is logged and ignored — meanwhile the
preferences pane still shows "notifications enabled" because the browser's
permission bit stayed granted. This is the mechanism behind the user's
report that notifications "worked for a while" and then stopped, with the
UI still claiming they were on.

The user has lived with this failure mode for months. The ntfy mobile app
is already installed on her phone from past exploration. An earlier plan
involved a Telegram bridge for notifications; it was removed, and this
shape has nothing to do with Telegram.

An audit of the existing notification pipeline (performed during /open's
discussion beat against the freshest peer tree) confirmed that the trigger
loop, display-name resolution, message-preview composition, and deep-link
behavior are all cleanly separable from the transport. The transport layer
is the only thing that needs to change substantively; everything else is
either kept as-is or deleted.

## What would make it wrong

- If the preferences pane ever shows "set up" while push is actually
  broken. The whole point is closing the current lie; introducing a new
  flavor of the same lie would be worse than the status quo.

- If the user tests the setup, sees it work, closes the app, and later
  discovers they missed something because of silent drift that the system
  swallowed with no log entry. Silent loss during an outage is acceptable;
  silent loss with no trace in the logs is not.

- If any publishing credential ever ends up on a host other than the box
  running Skynet's backend, or in any agent's context. The
  credential-directionality posture is non-negotiable.

- If scope drifts sideways into "while we're building ntfy infrastructure,
  we might as well add deploy alerts, login notifications, per-agent
  muting, coalescing." Any of those additions silently violates the
  shape's intent of being a pure transport swap.

- If the user ever has to think about her topic name, her endpoint URL,
  any internal cryptographic field, or any other mechanical detail of
  either the old or new transport. From her perspective: she sees a setup
  pane with values to enter in the ntfy app, a test button, and a
  regenerate button. Nothing else.

- If browser-push code lingers in the codebase after the swap — unused
  routes, orphan environment variables, dead handlers in the background
  worker. Pure cutover means pure deletion.

- If any part of the implementation hard-codes a specific Skynet
  instance's hostname (even the development one). Every URL — the ntfy
  base URL, the string displayed in the preferences pane, the setup
  value the iOS app receives — must derive from the instance's own
  public-hostname configuration. A codebase that works on one instance
  and silently misbehaves on another has missed the point.

- If a notification's content ever leaks through ntfy.sh. The upstream
  wake-up carries only the message ID and the topic hash; the body,
  the agent identity, and the deep-link URL stay on this instance.
  Breaking that boundary — e.g., by including the message title or body
  in the wake-up payload for "convenience" — undoes the privacy posture.

## Scope edges

**In:**

- Self-hosted ntfy server deployed inside each Skynet instance's compose
  stack.
- Caddy routing: a path prefix on each instance's existing public
  hostname is proxied to that instance's ntfy container. No dedicated
  subdomain, no additional TLS certificate.
- Upstream relay configuration: each instance's ntfy server is
  configured with `ntfy.sh` as its upstream for iOS wake-ups.
- Credential posture: write-only publishing credential held by the
  backend; per-user read-only credential issued and stored encrypted on
  the backend; both strictly directional.
- Backend publishing swap, mirroring the current error-handling posture
  (log on failure, drop the notification, no retry).
- Subscription data model migration: existing browser-push records are
  replaced by ntfy-topic + reading-credential records.
- Preferences pane rebuild: setup values displayed, test button,
  regenerate button, honest setup-status signaling.
- Deletion of the entire browser-push code path — the publishing library
  dependency, the environment credentials, the subscription endpoints,
  the background worker's push and rotation handlers, the old
  permission-grant flow in the preferences pane.

**Out (deliberately not in v1):**

- System-generated notifications beyond agent DMs (deploy events, login
  alerts, task-completion pings, etc.).
- Per-agent muting, coalescing, priority tiers, quiet hours.
- Desktop push of any flavor.
- A native iOS Skynet app wrapper.
- The ntfy server as a general-purpose box service for anything beyond
  Skynet's own needs.
- Proactive drift detection (heartbeat probes, background delivery
  checks).
- Durability queue or retry logic for publishing failures.
- QR-code bootstrap flow (the ntfy iOS app has no QR scanner, so the
  bootstrap UX is manual-entry only).
- Any migration ceremony for existing browser-push subscribers (the user
  is the only affected subscriber; ceremony is noise).

**Deferred (future shapes may pick up):**

- Per-agent topics as a path to per-agent muting UX.
- A Skynet system identity that can DM the user for non-agent-triggered
  notifications, flowing through this same pipeline.
- Desktop push via ntfy's web client or native desktop clients.
- Coalescing or priority tiers if real storms become a pain in practice.

**Tempting but no:**

- "While we're swapping transports, let's build system notifications."
  No. Pure transport swap only.
- "Let's make the ntfy server a shared box service so other things on
  this box can piggyback on the publishing infrastructure." No.
  Skynet-internal; future callers get their own shape and their own
  credential.
- "Let's add a passive 'last delivery was X seconds ago' indicator next
  to the test button for extra confidence." No. Test button is the only
  ground truth; passive indicators invite a new flavor of the lie.
- "Let's keep the browser-push code as a desktop fallback." No. Pure
  cutover.

## Vehicle notes

Vehicle is GSD phase(s). Scope is clearly phase-sized per fleet rule
("don't skip phase setup to avoid ceremony") — multi-step across infra
(ntfy container + Caddy edge), backend (publishing swap + schema), frontend
(preferences pane rebuild + background worker cleanup), and deletion
(ripping out the browser-push dependency and old flow). Likely splits into
a sequenced set of phases rather than one monolith, but the split-vs-one
decision belongs in planning (`/gsd:plan-phase`), not here.

The audit of the existing notification pipeline performed during /open's
discussion beat is the authoritative map of what re-points vs. what
deletes. The planning phase should start from that audit rather than
re-deriving it.

Implementation should sequence the deletion of the old browser-push code
to coincide with ntfy going live — the shape explicitly rejects a
dual-transport window, so planning should structure the final ship so that
the user never sees a half-working intermediate state.

The box-maintainer identity holding this work owns ntfy container
operations, Caddy edge updates, backend changes, and frontend changes. No
other role is involved.

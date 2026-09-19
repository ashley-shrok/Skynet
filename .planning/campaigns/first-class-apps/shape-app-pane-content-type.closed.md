# Shape: Apps as a content type in the pane

**Opened:** 2026-09-18
**Vehicle:** GSD phase
**Part of campaign:** first-class-apps (shape 4 of 4)

## What this is

The final shape of the first-class-apps campaign. The three prior shapes delivered the pieces upstream of this one: the on-disk convention and skill that let an agent build an app on its box (shape 1), the fleet-wide observation and per-user filtering that lets Skynet know which apps exist and who can see them (shape 2), and the sidebar surface that shows the user a tile per app she can reach (shape 3). This shape closes the loop — turning a tile in the sidebar into a working, authenticated, live web view inside Skynet's main working area. An app becomes a kind of thing the pane can hold, alongside a chat with an agent, a terminal on a remote box, or a remote desktop session. Two gestures put an app there: left-click on a sidebar tile replaces the focused leaf with the app, and dragging a sidebar tile into a split makes the app a new leaf in that split.

## Shape

**Apps join the pane's existing family of content types.** Today the pane can hold a small handful of kinds — a chat with an agent, a terminal session on a remote box, a remote desktop session. Each leaf in the pane's layout is identified by a small tuple that names it, and the pane's rendering dispatches on the kind to draw the right treatment. Apps become the fifth kind. The tuple that identifies an app leaf has two parts: which box the app lives on, and which app on that box. Two parts because the same short name can exist on different boxes and mean different apps with different data.

**Two gestures put an app in the pane, both matching existing behavior.** Left-click on a sidebar tile replaces whatever is in the currently-focused leaf with the app. If the pane is unsplit, the whole pane becomes the app. If the pane is split into multiple leaves, only the focused leaf changes; the others stay put. Drag a sidebar tile into the pane and drop targets light up along the edges of existing leaves — the same drop targets any existing leaf-source would produce — and dropping there creates a new leaf holding the app, split off from whichever existing leaf the drop landed near. Both gestures follow the exact same behavior chats and terminals have today; apps join the set of things that can be a source, and nothing about the gesture handling is special-cased on kind.

**The in-pane view of an app is a live web view served under Skynet's own origin.** The app itself runs as a small server on the agent's own box, listening on a private port. Skynet stands up a new reverse-proxy path under its own domain that forwards HTTP and WebSocket bytes both ways between the browser and the app. Because the proxy path is served under Skynet's own origin, the user's browser treats the app as part of Skynet — the session cookie carries, cross-origin embedding restrictions don't apply, and the app renders inside the leaf as if it were any other Skynet surface. This is a separate affordance from shape 3's context-menu "Open in new tab" action, which continues to work as it did — that action navigates to a dedicated per-port public web address on the `.serve.` subdomain family, in a fresh tab. The in-pane path and the fresh-tab path exist side by side; they're for different user intents.

**The trust boundary is at the proxy, not inside the app.** When the browser submits a form inside the embedded app, it stamps the request with an Origin naming Skynet's public domain (because that's where the page is loaded from). The app's home port, on the box, doesn't recognize that Origin as its own — the framework's default same-origin check would refuse the request. Rather than teach the proxy to lie about the Origin (fragile, and it makes the proxy carry knowledge of app-side framework rules) or accept the residual risk (a Skynet-authenticated user can be lured into POSTing to an app they use, from any web page), the proxy itself enforces the check at the boundary. Every state-changing request arriving at the proxy path is inspected — if its Origin names Skynet's own public domain, it's forwarded; otherwise it's refused before the app is even involved. The app's own check stays disabled by design, as shape 1 established, but the comment in the starter template now points to the proxy layer as the site of the check. This keeps the check where the trust boundary actually sits, keeps apps framework-agnostic, and stops the disabled-check line from reading like a shortcut.

**The proxy is subject to the same host-visibility filter that gates every other cross-box view.** A user reaches an app only if she has access to the box the app lives on. This isn't a new check invented at the proxy layer — it's the same access answer the sidebar tile already used to decide whether to show her the tile in the first place, applied a second time at the proxy so the URL itself can't be shared with someone who lacks access to the box.

**Reload persistence comes for free.** The pane already remembers its layout across reloads by saving the tuple that identifies each leaf. App leaves join that machinery without any new persistence mechanism — the (host, slug) tuple gets saved with the layout, and on reload the pane asks the proxy for that app the same way a fresh click would. If, between the save and the reload, the app has been archived or deleted or its box has gone offline, the proxy attempt fails and the leaf shows whatever the browser shows for a failed connection — no special treatment.

**Multi-instance is allowed by default.** If the user splits the pane and puts the same app in two leaves at once, both leaves render independently. The pane keys on the tuple; two leaves holding the same tuple aren't deduplicated or gated. The app itself either handles two open sessions gracefully or it doesn't, but that's the app's own business — this shape doesn't parent the user.

**Unhealthy is display-only, not a behavioral special case.** Shape 3 renders unhealthy tiles with a muted-red second line under the title. This shape doesn't make unhealthy tiles unclickable, and doesn't render a friendly "app is down" placeholder inside the pane when a click on an unhealthy tile lands. The tile is where unhealthiness is communicated visually; if the user clicks anyway, the proxy attempts the connection and the natural failure shows through. Same principle applies to gone-at-reload and to a box being offline — the pane doesn't specialize on app state; the browser's own failure treatment is the fallback.

**The pane is transparent to the app.** The app doesn't know it's being rendered inside the pane vs. as a standalone tab. The proxy forwards no header, no query parameter, nothing that signals its context. The app renders identically in both cases and can't specialize on Skynet's presence. This is what keeps the campaign's instance-agnostic promise intact — an app doesn't grow knowledge of which Skynet is fronting it.

**The leaf title bar shows the app's static metadata title.** The same title that shows on the sidebar tile. It doesn't mirror the app's live page title as the app updates it internally. This holds the "pane is transparent" line — the pane doesn't peek inside the app to read what its current page is calling itself.

**The pane's content-type dispatch gets a small in-place unification, bundled inside this shape.** Today, when the pane needs to decide which rendering treatment a leaf needs, it branches on kind — one branch per kind, four kinds today. Adding apps as the fifth kind is either a fifth branch or the moment we replace the branching with a small local lookup table where each row is a kind paired with how to render it. The behavior is identical either way; the lookup makes future content types one-line additions instead of another branch to remember. The refactor is small, sits in the same file the dispatch already lives in, and its whole rationale is "in service of the fifth kind" — so it lands in the same phase, not as a separate pre-shape.

## Philosophy

**Apps join the existing family; nothing about them is special.** The gestures reuse the existing patterns. The layout reuses the existing split machinery. The persistence reuses the existing tuple-save mechanism. The rendering plugs into the existing dispatch. This shape doesn't establish "apps as a new special citizen of the pane" — it adds one more entry to a list that already exists.

**The pane is a transparent viewport; the app is a black box.** The pane doesn't peek inside the app. It doesn't read the app's current page title, doesn't signal to the app that it's embedded, doesn't specialize its rendering on app-side state. It just holds a leaf that happens to be a live view of what's running on another box. If shape 4 finds itself wanting to know something about the app's internal state to decide how to render a leaf, that's a sign the philosophy has slipped.

**Unhealthy and gone are display concerns, not behavior concerns.** Shape 3 communicates unhealthy state at the tile. Nothing else in the campaign specializes on unhealthy — not the pane, not the proxy, not the persistence layer. Same for gone-at-reload. The instinct to "help" the user with a friendlier placeholder is real but the answer is to keep the pane straightforward — natural browser failures are honest, and specializing would spread state awareness across surfaces that shouldn't need it.

**The trust boundary is at the proxy.** The check that stops a state-changing request from an untrusted origin lives at the layer where "authenticated Skynet user" meets "app on a private port." Not inside every app — because apps are framework-agnostic and shouldn't have to reason about the origin story of a fronting Skynet. Not implicitly trusted away — because the classic CSRF attack still exists in the space of currently-logged-in Skynet users. The proxy enforces it once, cleanly, for every app.

**Small refactor coupled with the addition it enables.** The dispatch unification isn't its own shape because its whole reason to exist is making the fifth-kind addition clean. Landing them separately would mean two phases, one of which reads "prepares for a phase that hasn't happened yet." Bundling them keeps the review narrative honest.

**Instance-agnostic.** The pattern this shape lands works on any Skynet instance identically. Apps don't know or care which Skynet is fronting them. The proxy path is a Skynet-side concept; from the app's perspective the request just arrives. Stacy's Skynet on T800 and the user's Skynet on t1000 use this pattern without per-instance tailoring.

## Prior context

Shape 1 delivered the on-disk convention that every app on every managed box follows. An app lives under a canonical top-level folder, with a two-field metadata card, running under a per-app systemd unit that names the port. The framework config in the starter template ships with the built-in same-origin form-submission check disabled — with a comment explaining why. Shape 4 keeps the check disabled, but updates the comment to point at the proxy as the site of enforcement.

Shape 2 delivered the fleet-wide observation that keeps Skynet's picture of "which apps live where" fresh, filters per-user by host visibility, and pushes live delta frames to subscribed clients. Shape 4 doesn't add a new source of app truth; the tuple the pane persists is drawn from the same picture shape 2 maintains.

Shape 3 delivered the sidebar surface. The tile visual, the empty-expanded state, the context-menu "Open in new tab" action, the muted-red unhealthy line, the neutral hue — all shape 3. Left-click on a tile is currently a deliberate no-op with cursor-default styling (reserved for this shape), and no drag handlers exist on the tile yet (reserved for this shape). Shape 4 wires both.

Shape 3's code-review fix pass introduced a Skynet-side redirect route that translates a stable per-app URL into the direct `.serve.` public web address, for the context-menu action. That route stays as it is — the fresh-tab path uses it, the in-pane path is a separate proxy layer. Shape 4 doesn't replace it.

The pane's existing behavior — how it holds leaves, how it dispatches on content type, how it handles drag-and-drop, how it persists layouts, how the focused-leaf concept works — is prior context this shape reuses without re-litigating.

Skynet's edge already reverse-proxies loopback ports on any managed box to public per-port web addresses under a `.serve.` subdomain pattern. That's what powers shape 3's "Open in new tab" today. The in-pane path is a separate proxy, served under Skynet's own primary origin rather than a per-port subdomain, because embedding an off-origin page inside Skynet's own surface hits cookie-scope and cross-origin-embedding restrictions the in-origin path sidesteps.

## What would make it wrong

- **The pane shows the app but not authenticated.** The user clicks a tile, the leaf renders, and the app greets her with a login prompt, an unstyled error, or an origin-mismatch warning. The whole point of the in-pane path is "just there, authenticated" — anything less means the proxy or the auth flow slipped.

- **WebSocket upgrades don't flow through the proxy.** Any app relying on live sockets — which is most apps under the starter stack — appears static or half-broken, with symptoms that hide the real cause. The proxy has to pass upgrades cleanly.

- **The proxy trusts anything upstream.** A user without access to the app's home box hits the proxy path directly and reaches the app. The visibility filter the sidebar uses to decide "should this user see this tile" has to gate the proxy too — the URL can't be a bypass.

- **The proxy accepts state-changing requests from off-origin pages.** The CSRF check the proxy owns has to be enforced consistently. If a request whose Origin isn't Skynet's own public domain slips through to the app, the boundary's failed and the disabled app-side check leaves nothing behind it.

- **The starter template's disabled-check comment stays pointing at nothing.** The reason the check is off must now point at the proxy layer as the enforcement site. A future maintainer reading the current comment sees a shortcut with no accountability; leaving that in place after the proxy check exists is a small dishonesty that erodes trust in the starter template.

- **The pane specializes on app state.** Unhealthy tiles get a friendly in-pane placeholder. Gone-at-reload gets its own message. Box-offline gets a "network problem" screen. Each of these introduces a new failure state the pane has to know about, and cumulatively they smuggle app-state awareness into the pane the shape's philosophy explicitly rules out.

- **The dispatch refactor gets skipped.** A fifth branch is added instead of unifying into a table. The next content type — a sixth, a seventh — repeats the pattern. The cheap moment where this cleanup was in-scope gets missed and the branch-count keeps growing.

- **Split-drop treats app-tiles specially.** The drag machinery grows an "if it's an app, do this" branch instead of participating in the existing leaf-source pattern. Future content types now have to duplicate that branch or invent their own.

- **Reload restores an app leaf but silently reshapes the layout.** The user's split geometry gets subtly rewritten because the app leaf couldn't be restored the same way other leaves were. The pane's persistence contract has to treat app leaves as first-class in the layout, not as special cases.

- **Multi-instance gets forbidden as a "safety" measure.** The tuple is deduplicated across leaves; splitting the same app for comparison stops working. The instinct that "the user might get confused" is where the pane starts parenting the user — not this shape's job.

- **The pane signals to the app that it's in-pane.** A header, a query param, anything that lets the app specialize on being embedded. Apps grow Skynet-awareness. The instance-agnostic pattern breaks.

- **The leaf title bar mirrors the app's live page title.** The pane starts peeking inside the app's current state. The black-box philosophy takes an exception, and every future case that wants to be "just this one small peek" gets easier to argue for.

- **The `.serve.` context-menu action changes.** Shape 3's "Open in new tab" and its redirect route are prior context this shape leaves alone. Any change to the fresh-tab affordance smuggles shape-3 territory into this shape's scope.

## Scope edges

**In:**

- Left-click on a sidebar tile: replaces the focused leaf with an app leaf identified by (host, slug), reusing the existing leaf-replace behavior for content types.
- Drag from a sidebar tile into the pane: creates a new leaf holding the app in a split, reusing the existing split-drop behavior for leaf sources.
- A new reverse-proxy path served under Skynet's own primary origin that forwards HTTP and WebSocket bytes between the browser and the app's home port on its home box.
- The proxy enforces a same-origin check at the boundary — requests without Skynet's own public domain in the Origin header are refused before reaching the app.
- The proxy applies the existing per-user host-visibility filter — access to the box gates access to the app.
- The starter template's disabled-check comment is updated in place to point at the proxy layer as the site of the check.
- Reload persistence for app leaves via the existing pane-layout mechanism — the (host, slug) tuple is saved and restored on reload.
- Multi-instance: the same app can appear in multiple leaves simultaneously with no deduplication.
- The leaf title bar for an app leaf shows the app's static metadata title.
- A small in-place unification of the pane's content-type dispatch from a branch-per-kind to a small local lookup table — bundled inside this phase.
- Test coverage: proxy behavior (HTTP forwarding, WebSocket upgrade, host-access filter, CSRF-check refusal on off-origin requests, CSRF-check pass on same-origin requests), the dispatch table (each kind resolves to the same rendering it produced before), and the pane's rendering of the fifth kind (leaf identified, leaf title correct, leaf persists across reload, multi-instance renders both leaves independently).

**Out:**

- Shape 3's sidebar surface: the tile visual, the empty-expanded state, the muted-red unhealthy line, the neutral hue, the icon-slot fallback. None of it changes.
- The context-menu "Open in new tab" action and its Skynet-side redirect route: unchanged.
- The `.serve.` per-port public web address pattern that powers the fresh-tab action: unchanged.
- Changes to the starter template's framework config beyond updating the comment on the disabled check.
- App-side changes for any specific app — this shape is instance-agnostic proxy plumbing; apps don't change.
- Any signal from the pane to the app about being in-pane vs. standalone.
- Any specialization inside the pane for unhealthy / gone / box-offline states.
- Additional in-pane actions on an app leaf (favorite, pin, per-app pane settings, reload).
- Chrome deduplication or layout adjustments that would require app-side awareness.
- Cross-app plumbing: deep-linking into an app's sub-page from Skynet, app-to-app communication, shared state across apps.
- Any changes to how the pane holds leaves, dispatches on kind (beyond the small refactor), or handles drag-and-drop for other kinds.

**Deferred:**

- Friendlier in-pane placeholder rendering for known-failure states (unhealthy, gone, box-offline). If the natural browser failure looks bad enough that a placeholder earns its place, it's a small forward addition and lands in one place.
- Per-app customization from the pane side (custom leaf title bar treatment, per-app pane settings, per-app visual affordances).
- Multi-instance restrictions if a specific app misbehaves under multi-instance and the pane needs to intervene.
- Any pane-level "reload this app" action — if we want one it belongs to a general "reload this leaf" affordance across all content types, in a different shape.
- Focus routing specialized for app leaves — the leaf receives focus the same way any other leaf does; special accessibility or keyboard-shortcut handling is a future refinement.

**Tempting but no:**

- Signaling to the app that it's in-pane so it can specialize its layout. Small win, breaks the instance-agnostic promise.
- Making unhealthy tiles unclickable to protect the user from a doomed click. Unhealthy is display-only; the pane doesn't gate.
- Deduplicating multi-instance to prevent user confusion. The pane doesn't parent the user.
- Building a friendly in-pane loading state (spinner, skeleton, "connecting…"). Violates the atomic-render fleet rule and the black-box philosophy in one move.
- Teaching the proxy to rewrite Origin so the app-side framework check could stay on. Fragile, couples the proxy to app-side framework rules, and doesn't add real safety on top of the boundary check the proxy already does.
- Accepting the residual CSRF surface and relying entirely on outer guardrails. The classic attack still works within logged-in Skynet users; the boundary check exists to close that specific window.
- A pre-shape landing the dispatch refactor before shape 4. Too small to earn its own phase; its whole justification is service of shape 4.

## Vehicle notes

**Why a GSD phase:** shape 4 spans backend (a new reverse-proxy path plus its CSRF-check enforcement plus the host-access filter application), the starter-template comment update (a small substrate distributor sweep piece), and client-side work (the dispatch refactor, the sidebar-tile left-click wiring, the drag source on the tile, the pane's rendering of the fifth kind, the reload-persistence integration). Full container deploy plus substrate distributor sweep after. Enough surface to earn phase-level structure, same rhythm as shapes 2 and 3.

**Seed for `/gsd:discuss-phase`:** this shape file is the seed. Every "what + why + constraint + scope edge" the discuss step would otherwise re-elicit is already here. Drop it in as CONTEXT.md or generate CONTEXT.md from it. Do not re-run the discovery.

**Phase-number rule (fleet-standard):** whichever free phase number this shape takes when `/gsd:phase` slots it into ROADMAP.md is fine; if a peer identity races us to the same slot mid-plan, the fleet's phase-collision auto-resolve kicks in — no user check needed for pure slot collisions.

**Deploy hold:** deploy stays held for campaign close, per the campaign artifact's covering greenlight — commits land locally on the current working branch and stack on top of the three previous shapes' held commits, pushed to origin and deployed together once the campaign completes. All four shapes' UAT converges at campaign close, per the shape-3 UAT-defer policy.

**Related pointers:**
- Campaign artifact: `.planning/campaigns/first-class-apps/campaign-first-class-apps.md`
- Prior shape close-outs: `shape-app-runtime-and-skill.closed.md`, `shape-sweep-and-registry-api.closed.md`, `shape-sidebar-apps-surface.closed.md`

---

## Close-Out

**Closed:** 2026-09-18
**Vehicle used:** GSD phase (Phase 120, 8 plans across 6 waves)
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is — fifth content type in the pane, opened via left-click or drag** — present · the pane's family of content kinds gains a fifth member for apps; a leaf can now hold an app identified by which box it lives on and which app on that box.
- **Shape: apps join the pane's existing family of content types** — present · the identity of an app leaf is the two-part tuple named in the shape; the existing dispatch grows a new arm for the app kind.
- **Shape: two gestures put an app in the pane (left-click replace-focused; drag creates a leaf in a split)** — present · left-click fires an open-app handler that replaces the focused leaf; drag emits a payload the split machinery already understands, and drop creates a new leaf next to the drop target — same behaviour every other draggable source has.
- **Shape: in-pane view is a live web view served under Skynet's own origin via a new reverse-proxy path** — present · a new proxy path served from Skynet's own primary origin forwards HTTP and WebSocket bytes between the browser and the app.
- **Shape: trust boundary at the proxy; state-changing requests refused when Origin doesn't name Skynet** — present · safe methods pass through; state-changing methods are refused unless their Origin matches Skynet's primary domain. The app's own framework check stays disabled by design.
- **Shape: proxy applies the same host-visibility filter that gates every other cross-box view** — present · the same access answer used by the sidebar tile is applied again at the proxy so the URL can't be shared with someone who lacks access.
- **Shape: reload persistence comes for free via the existing pane-layout mechanism** — present · the tuple identifying an app leaf is saved with the layout via a new small storage column and the URL-fragment variant; on reload the pane asks the proxy for that app the same way a fresh click would.
- **Shape: multi-instance allowed by default; no dedupe** — present · both the click path and the drop path unconditionally create a new leaf every time.
- **Shape: unhealthy is display-only, no in-pane specialization** — partial · tile side is honoured (clicks/drags on unhealthy tiles are not blocked); however, when a click on an unhealthy app lands and the tunnel refuses, the pane renders the inherited Phase 103 error interstitial inside the leaf — endorsed as drift below.
- **Shape: pane is transparent to the app; no signal that it is embedded** — present · no header, no query parameter, no postMessage carries context about being in-pane; referrer suppressed.
- **Shape: leaf title bar shows the app's static metadata title, not its live page title** — present · leaf title carries the same static title as the sidebar tile.
- **Shape: small in-place unification of the content-type dispatch (branching → local lookup table)** — present · both the icon-choice dispatch and the render-dispatch have been unified into small local lookup tables.
- **Philosophy: apps join the existing family; nothing about them is special** — present · gestures, layout, persistence, rendering all plug into existing mechanisms.
- **Philosophy: pane is a transparent viewport; app is a black box** — present · the pane never peeks inside the app's state.
- **Philosophy: unhealthy and gone are display concerns, not behaviour concerns** — partial · held on the tile side; the pane-side inherits Phase 103's tunnel-error interstitial from reused proxy machinery — endorsed as drift below.
- **Philosophy: trust boundary at the proxy** — present · same-origin refusal enforced once at the proxy layer; app's own check stays disabled; starter template comment now points at the proxy as the enforcement site.
- **Philosophy: small refactor coupled with the addition it enables** — present · dispatch unification lands in the same phase as the fifth-kind addition.
- **Philosophy: instance-agnostic** — present · nothing in the delivered path per-instance-tailors.
- **Prior context: shape 3's `.serve.` context-menu action + redirect route unchanged** — cannot-verify · not directly re-inspected; scope says fresh-tab path stays as it was.
- **Failure mode: pane shows the app but not authenticated** — present · session cookie carries via same-origin proxy path; no login prompt or origin-mismatch by construction.
- **Failure mode: WebSocket upgrades don't flow through the proxy** — present · upgrade path wired at the http.Server level; same access + trust chain runs before handoff.
- **Failure mode: proxy trusts anything upstream** — present · host-visibility filter runs before any tunnel work.
- **Failure mode: proxy accepts state-changing requests from off-origin pages** — present · same-origin refusal enforced on HTTP and upgrade paths; missing Origin on state-changing method refuses too.
- **Failure mode: starter template disabled-check comment stays pointing at nothing** — present · comment now names the proxy layer as the enforcement site.
- **Failure mode: pane specializes on app state (friendly in-pane placeholders)** — drifted · Phase 103's tunnel-error interstitial renders inside the leaf on connection failure — endorsed as drift below.
- **Failure mode: dispatch refactor skipped** — present · both dispatch axes unified into lookup tables; no residual branching.
- **Failure mode: split-drop treats app-tiles specially** — present · split machinery grows one more symmetric parsing branch alongside existing draggable sources.
- **Failure mode: reload silently reshapes layout** — present · app leaves ride existing tuple-save-and-restore machinery.
- **Failure mode: multi-instance forbidden** — present · no dedupe on either the click or the drop path.
- **Failure mode: pane signals to the app that it's in-pane** — present · no header, no query parameter, no postMessage.
- **Failure mode: leaf title mirrors the app's live page title** — present · leaf title bound to static metadata title.
- **Failure mode: `.serve.` context-menu action changes** — cannot-verify · prior fresh-tab path not re-inspected; scope says it stays as it was.
- **Scope: in items delivered end-to-end** — present · every listed in-scope item is present in the material.
- **Scope: out items respected** — present · prior shape 3 surfaces, fresh-tab path, per-port pattern, framework config beyond comment, app-side changes, in-pane state signals, additional in-pane actions — none touched.
- **Scope: tempting-but-no items avoided** — partial · signalling to the app, blocking unhealthy tiles, deduping multi-instance, teaching the proxy to lie about Origin, splitting the refactor pre-shape — all avoided. The "friendly in-pane loading/failure state" line is crossed by the tunnel-failure interstitial — endorsed as drift below.

### Additions (in the result, not in the shape)

- On tunnel failure to reach the app's home box, the pane renders the inherited Phase 103 error interstitial inside the leaf instead of showing the browser's own failed-connection treatment. — endorsed-as-drift · The interstitial comes from the reused Phase 103 `serve-url/` machinery, which CONTEXT.md D-09 explicitly instructed to reuse verbatim. Same surface a user hits from shape 3's fresh-tab "Open in new tab" affordance when a box is unreachable; consistent Skynet-wide error UX. Walking it back would require forking proxy-factory.ts to bypass the interstitial — a bigger philosophy violation than the interstitial itself.
- The proxy sets anti-clickjacking response headers (`X-Frame-Options: SAMEORIGIN` + `Content-Security-Policy: frame-ancestors 'self'`) on every response served under the pane path, so the app can only be framed by Skynet itself. — endorsed-as-drift · Defensive hardening consistent with the shape's trust story; iteration-1 revision explicitly requested this after the plan-checker flagged the gap.
- HTML responses from the app are rewritten on the way through the proxy to prepend a base-URL element so absolute-path references inside the app resolve against the pane's mount prefix. — endorsed-as-drift · Makes the shape's promise of "the app sees itself at root" actually work from the browser's side; identified in RESEARCH.md as the D-11 resolution.
- The refusal response for "host does not exist" is deliberately made byte-identical to "user has no access", so a probe cannot distinguish the two states. — endorsed-as-drift · Standard info-leak-safe 403 hardening inherited from Phase 119's identity-avatar pattern.
- At module load, the proxy layer fails loudly if the primary-domain environment value is unset, rather than defaulting to a hardcoded value. — endorsed-as-drift · Inherited discipline from `serve-url/subdomain-dispatch.ts`.

### Follow-ups

- Docker nginx.conf + nginx-https.conf need a dedicated `/apps/` location block with `proxy_set_header Upgrade` + `Connection` headers so WS upgrades survive the nginx hop at deploy time. Flagged by Plan 05 executor; MUST be fixed before campaign deploy. — deferred · Deploy-adjacent config change, filed as a pre-deploy fix task.
- Pre-existing `open-tabs.ts` write handlers lack `DatabaseSaveTrigger.forceSave()` after `db.insert/update` calls, per the role-file's 2026-08-19 in-memory-SQLite discipline. Silent data-loss risk applies to the new `appSlug` field this phase added. — bounty · Fleet-wide surface, not shape-4 scope. Follow-up bounty for whichever identity picks it up.

### Notes

The delivered result matches the shape closely on almost every facet: the fifth content kind is a real peer alongside the existing four, both gestures reuse existing machinery, the tuple flows through persistence and URL restore, multi-instance is untouched, the trust boundary sits at the proxy with the same-origin refusal enforced consistently on HTTP and upgrade paths, the host-visibility filter is applied a second time at the proxy, the leaf title stays static, no signal leaks to the app about being embedded, and the dispatch is refactored into small lookup tables in the same phase. The one drift worth calling out — the tunnel-failure interstitial rendered inside the leaf — is inherited from the reused Phase 103 proxy machinery, matches Skynet-wide error UX, and was accepted as drift because walking it back would have required forking machinery the shape explicitly said to reuse. Pattern worth carrying forward: when a shape says "reuse existing X verbatim" and X carries UI baggage that the shape's philosophy would otherwise exclude, the reuse decision inherently endorses that baggage — write it into the shape file explicitly at /open time so it doesn't surface as drift at /close.

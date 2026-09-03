# Shape: Configurable per-instance branding for Skynet

**Opened:** 2026-09-03
**Vehicle:** GSD phase

## What this is

A mechanism that lets a Skynet deployment present itself under a different identity than "Skynet" — different name, different logo, different icon in the browser tab and on the phone home screen — without any code change or image rebuild. The operator drops a config file and some image files on the host machine, and the running app picks them up. A deployment with no config file looks exactly like Skynet does today.

The immediate use case is Aither Intelligence Plus: the same Skynet image, deployed for Aither executives, presenting itself as "Aither Intelligence Plus" (or "AI+" on smaller surfaces).

## Shape

There are two things on the host: a config file (text, listing the name, short name, and paths to the image assets) and an asset directory (the actual image files — logo, favicon, PWA icons). Both are made available to the running app at startup via the container's volume mounting mechanism.

The app exposes three things to the outside world:
1. A config endpoint — returns the branding values as structured data. Falls back to built-in defaults if no config file is present on the host.
2. A manifest endpoint — returns the PWA manifest (what the browser uses to install the app to a phone home screen). Dynamically generated from the config, so the installed app's name and icon reflect the deployment's branding.
3. An asset endpoint — serves the image files from the host asset directory, falling back per-file to the bundled defaults for anything not provided.

The app bundles default branding (current Skynet identity) inside the image so a vanilla install needs nothing on the host.

On the frontend, when the app loads it fetches the config and immediately applies it to four surfaces:
- Browser tab title (before a conversation is selected — after selection, the tab title comes from the conversation itself, which is separate behavior)
- Favicon (the icon in the browser tab and bookmark bar)
- The logo shown at the top of the conversation list
- The header and title on the login screen

## Philosophy

This is an operator configuration feature, not a user feature. Users never touch it; they just see whatever the operator configured.

The mechanism is a mounted config directory — the same pattern used by Grafana, Mattermost, GitLab, and essentially every serious self-hosted app that supports operator branding. This is the right pattern because: (a) it handles both text values and image files cleanly under one model, (b) it requires no rebuild to change, only a restart, and (c) it's immediately legible to any operator who has run self-hosted software before.

Environment variables were considered and rejected: they can carry text strings but cannot carry image files, which are half the problem. A hybrid approach (env vars for strings, mounted files for images) would be more complex for no benefit.

What this is NOT doing: theme colors, splash backgrounds, or any visual styling beyond the identity surfaces listed. The visual aesthetic stays consistent across all deployments. Only the name, the logo, and the icon change.

## Prior context

Skynet today is fully hardcoded to the "Skynet" identity. The browser tab says "Skynet," the favicon is the Skynet icon, the conversation list header shows the Skynet logo, and the login screen presents the Skynet name. There is no existing configuration surface for any of this.

The PWA manifest is currently static — it does not participate in any dynamic serving, so the installed-app experience on iPhone home screens reflects whatever was baked into the static file at build time.

The container already uses volume mounting for persistent data storage, so the pattern of mounting host directories into the container is established and understood.

## What would make it wrong

- A deployment without a config file on the host behaves differently than it does today. The fallback to built-in defaults must be complete and seamless — no errors, no blank surfaces, no partial branding.
- An operator updates the config file and restarts, and any surface still shows the old branding. Every branding surface must update on restart.
- The PWA manifest still reflects "Skynet" after branding is configured. If someone installs the app to their iPhone home screen under an AI+ deployment, it must say "AI+" and show the AI+ icon — not Skynet.
- The logo in the conversation list or on the login screen is missed and still shows "Skynet" on a rebranded deployment. Both surfaces must be wired to the config.
- Individual asset fallback is broken — if the config file is present but a specific image file is missing from the host asset directory, it should fall back to the bundled default for that specific file, not fail globally.

## Scope edges

**In scope:**
- Browser tab title (pre-conversation-selection state)
- Favicon
- PWA manifest (name, short name, icons)
- Conversation list header logo
- Login screen header/title

**Out of scope for this feature:**
- Theme color or visual styling of any kind
- The tab title after a conversation is selected (that's driven by the conversation's tmux session name — separate existing behavior, not touched here)
- Admin console labels or any operator-facing UI strings
- Email templates
- OpenGraph meta tags
- Any operator-side names: container image name, compose service name, data volume name, repository name, internal log prefixes

**Implementation-time check:** grep the codebase for user-facing "Skynet" string occurrences that may have been missed in the surface list above. If any are found, decide at that point whether they belong in scope.

## Vehicle notes

GSD phase. Lives in `~/skynet-tiffany/.planning/phases/` — phase number to be assigned when the phase is opened.

The design is fully locked (from a 2026-09-03 planning session). The GSD phase researcher should use this shape file as its CONTEXT.md seed rather than re-eliciting the design — the enumeration of user-facing "Skynet" occurrences in the codebase is the primary discovery task remaining.

Deployment target for this phase is t1000 (current mainline). No config file will be placed on the host after deploy — the deployment uses the bundled defaults, so behavior is identical to today from the user's perspective. The AI+ deployment will supply its own config file when that box is provisioned by Ivy.

Close with `/close branding-config`.

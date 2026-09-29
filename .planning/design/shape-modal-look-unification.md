# Shape: Modal look unification

**Opened:** 2026-09-28
**Vehicle:** inline, one modal at a time (per-modal discussion → code → next)
**Visual reference:** [`modal-tasting.html`](./modal-tasting.html) — open in a browser

## What this is

The Skynet app-modal surface is fragmented — the phase-14B `Dialog` primitive exists and IS pv-styled, but many features ship their own dialog surface because either the primitive is under-featured or the "start here" convention isn't loud enough. Result: modals across the app look and behave inconsistently even though a shared aesthetic exists.

This work rebuilds the modal story around a single canonical container that carries the pv aesthetic natively, applied consistently to every app modal in the app, with a directive that makes the canonical the path of least resistance for future modal work.

## Shape

Three components:

- **A canonical `<Modal>` container** — extends the existing pv-styled Dialog primitive with head/body/foot slotted parts that carry the aesthetic and separator anatomy natively. Variants: default (identity-hue tinted body), settings (nav column + main pane), list (hue-tinted row list), shell (non-dismissible required action). Every real modal composes from this.
- **Every real modal in the app translated to use the canonical.** ~25 app modals across pretty-view, pretty-conversations, sidebar, SSH auth family, feedback, skew-lock, electron-version-check. Each translation matches its mockup in the visual reference.
- **Convention that makes future modals fall in line.** The id skill and box-maintainer role file both name the canonical as the starting point for new modal work; agents picking up feature work naturally reach for it because it's less work than reinventing.

## Philosophy

The aesthetic is settled in the visual reference — the "Assistant Bubble" direction with head/foot separators:

- Identity-hue-tinted body (assistant-bubble gradient), warm-cream text, backdrop blur
- Head separator + foot separator using hue-tinted lines (not cool-cream — matches the warm surface)
- Head anatomy: title (Inter, semi-bold) + optional subtitle (Inter, muted, 1-2 lines of guidance) + close X
- Foot anatomy: buttons flush right by default, primary hue-tinted, secondary dark-glass, destructive red-tinted
- Meta lines above the title exist ONLY when they carry disambiguating info, not label chrome. "SSH · workstation" earns its place; "Fleet-wide · full-text" does not.
- Type is Inter throughout for text and labels; JetBrains Mono is reserved for code content (which the editor widgets own, not us).

Load-bearing invariants:

- **Same job → same layout.** Small destructive confirms should be twins of each other. All auth prompts should feel like siblings. This is what "unified" means.
- **Natives (window.confirm/alert/prompt) are OUT of scope.** They're a legitimate primitive; we don't try to unify what we can't style. If a specific native starts feeling wrong, that's a separate small fix.
- **The editor surface inside content editors isn't ours to design.** The real editor uses Monaco/CodeMirror. We design the container around it — file tabs, head, foot — nothing else.
- **Don't add functionality that wasn't there already.** If we want to add a new affordance, that's an explicit conversation, not a silent extension during translation.
- **Never leak the maintainer's name into user-facing app copy.** No "Ashley reads this" in feedback subtitles, no "Ashley's greenlight" in modal chrome. Windows doesn't say Bill Gates.
- **Adapt to single-host reality.** Most users have one host. Host pickers disappear in single-host mode. "On t1000" subtitle removed — single-host users don't deal in hosts.
- **The canonical is the path of least resistance.** New modals compose from it. Agents picking up feature work should find writing a new modal EASIER via the canonical than by reaching for the raw radix primitive.

## Prior context

- The pv token vocabulary (in `src/ui/index.css` lines 143-176) is the design source of truth: cool-black gradient base (`--color-pv-base` family), warm-cream text (`--color-pv-fg`), per-identity hue (`--pv-id-hue`), radius scale, shadow tokens.
- `src/ui/components/dialog.tsx` is the phase-14B pv-styled Dialog primitive (182 lines). It's the natural extension point — grow it into the canonical, don't replace it.
- Existing pattern for hue-tinted surfaces: `ChatMessage.tsx` assistant bubble uses `linear-gradient(160deg, hsla(var(--pv-id-hue), 50%, 38%, 0.55), hsla(var(--pv-id-hue), 45%, 22%, 0.68))` — the modal recipe matches this at slightly higher alpha for opacity over the app.
- Fragmentation catalog: SkewLockModal is hand-rolled (must portal outside frozen root); SSH auth family lives under its own folder; features have their own `*Modal.tsx` files without a shared shell. All of these become compositions of the canonical after translation.

## What would make it wrong

- A modal in the app that looks visually correct but bypasses the canonical container (drift risk future-forward).
- A "translation" of a modal that adds functionality the original didn't have (feature creep in disguise).
- The canonical exists but new features still reach past it for the raw radix primitive because the convention isn't loud enough or the container isn't rich enough for their case.
- A translated modal that fails single-host case (host picker showing when the user has one host, "on t1000" subtitle appearing, etc.).
- Meta lines and subtitles that describe what the modal is instead of adding real information.
- A translated modal that mentions the maintainer by name in user-visible copy.

## Scope edges

**In:**
- ~17 app modals (see modal-tasting.html for the full list — Categories 1-7, 9, 10, 11 minus retired items and vestigial group)
- The 2 hand-rolled shell modals (SkewLockModal, ElectronVersionCheck)
- Canonical `<Modal>` container as the shared foundation
- Convention updates in the id skill + box-maintainer role file naming the canonical

**Out:**
- All native browser primitives (`window.confirm`/`alert`/`prompt`) — stay as-is
- The internal surface of content editors (Monaco/CodeMirror handles that)
- The multi-file About-you concept in PreferencesModal — the tasting drops it deliberately per Ashley
- Nested modals used for simple destructive confirms (Ashley 2026-09-29: switch these to natives instead of stacking)
- The SSH auth family + tmux session picker (Ashley 2026-09-29: not accessible in the current app — vestigial fork code from `src/ui/features/terminal/Terminal.tsx`, which is no longer part of the live user experience)

**Retired 2026-09-29:**
- **DeleteConfirmDialog** — the only nested app-modal in Skynet, used inside RunbookEditorModal + SkillsEditorModal for delete-file / delete-runbook / delete-skill. Replaced with `window.confirm()` + `window.alert()` for errors, matching the fleet convention already used across ~30 destructive confirms in the app. The component file was deleted; the tasting no longer carries a mockup for it.
- **SSHAuthDialog, TOTPDialog, PassphraseDialog, HostKeyVerificationDialog, OPKSSHDialog, WarpgateDialog, TmuxSessionPicker** — all under `src/ui/ssh/dialogs/`, mounted only inside `Terminal.tsx`. The raw-terminal experience is not part of live Skynet — these dialogs are reachable only if a user opens a terminal session (which pretty-view has replaced). The component files stay in place (they're vestigial code, but deleting them is a separate cleanup decision), but they're EXCLUDED from the modal-look-unification scope. The tasting still shows them for reference but labels them out-of-scope.

## Vehicle notes

- **Per-modal cadence.** One modal at a time, in-line conversation. For each: read the current implementation, compare to the tasting, surface any deltas to Ashley before writing code, then land the change.
- **Order:** canonical container first (task #9), then modals starting with the smallest confirms (DeleteConfirmDialog → FeedbackModal → TOTP/Passphrase/TmuxSessionPicker) to prove the container. Then mid-size single-forms, then list/managers, then multi-pane settings, then content editors, then record editors (Identity/Role), then auth family, then shell-required last.
- **Deploy discipline (box-maintainer role file, applied verbatim):** Code motion is authorized inline; every git push and every docker deploy needs a separate explicit greenlight ("push it" / "ship it") from Ashley. Multi-step pre-authorization does NOT include the push.
- **Testing discipline:** scoped tests during dev per touched paths (`npx vitest related --run <files>`). Full suite runs as the ship gate before docker build + docker compose up.
- **id skill update lands in the same phase as user-facing app changes**, per role file directive added 2026-09-28.

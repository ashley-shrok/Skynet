# Patch #133 — strip shadcn wrappers from PrettyConversationsPanel + prototype fidelity + Skynet base #0a0b12

**Date:** 2026-07-23
**Branch:** feat/tab-title-from-tmux
**Bounty:** phase10-shadcn-strip-and-prototype-fidelity (666704b0-8f39-4f5d-a990-cae701a74717)
**Commit:** f321302
**Deploy status:** DEFERRED — Ashley bundles with prior UAT commits (558749a, 68e4f62, b749bf1, 536d224) in a single grouped deploy.

## What changed (7 files, atomic)

**Panel strip (PrettyConversationsPanel.tsx, ~444→381 LOC):**
- Dropped imports: DropdownMenu*, Tooltip*, renderSettingsMenuItems, Settings icon
- Deleted entire `showGear` JSX branch (34 LOC of TooltipProvider>Tooltip>DropdownMenu wrapper sandwich)
- Deleted dead consts: showGear, settingsLabel
- Removed onRailClick + isAdmin from props typedef (they only fed the gear)
- Inlined 4 text-color sites with prototype-anchored hex/rgba per prototype.html --pv-text-* palette:
  * desktop title `text-foreground/90` → `text-[rgba(240,234,224,0.9)]` (--pv-text-primary #f0eae0 @ 0.9)
  * pencil `text-foreground` → `text-[#f0eae0]`
  * RDP monitor glyph + label `text-muted-foreground/50` → `text-[#5c6070]/50` (--pv-text-hint)
- Header padding `px-3 py-2` → `px-4 py-3` (prototype .top-strip 12px/16px)
- NewSessionDialog untouched (pencil is the ONLY entry point going forward per Skynet direction)
- Rows + PinAction untouched (already clean per Wave 1 handoff)

**AppShell call-site cleanup:**
- `<PrettyConversationsPanel>` no longer passes onRailClick or isAdmin (dead after gear removal)
- `settingsRowSlot` mechanism at same call-site UNCHANGED — mobile bottom-of-scroller settings row survives independently (different mechanism)

**Test file (PrettyConversationsPanel.test.tsx):**
- Test 9 rewritten from "renders gear when onRailClick provided" → asserts gear NEVER renders on desktop (invariant flip)
- Test 10 title/prop-drop updated (assertion unchanged — still asserts no gear on mobile)
- All other tests untouched (they never referenced the gear)

**Skynet base color rebase (#080808/#09090b → #0a0b12):**
- src/ui/index.css `.dark --background`: oklch(0.155 0.004 128.73) → #0a0b12
  * Anchors to --color-pv-base-end at line 121 (existing pretty-view palette) — no palette additions
- public/manifest.webmanifest: theme_color + background_color → #0a0b12
- public/manifest.json: theme_color + background_color → #0a0b12
- index.html: `<meta name="theme-color">` → #0a0b12

## Verify results

- `npx tsc --noEmit`: CLEAN (exit 0, no output — no new errors)
- `npx vitest run src/ui/features/pretty-conversations/`: 27/27 passing (2 test files)
- `npx vitest run` (full-tree): 504/506 passing — 2 pre-existing patch-#124 `/send 'yes'/i` ThumbsUp failures UNCHANGED from STATE.md baseline; no regression
- `npm run build`: SUCCESS in 7.87s
- Grep gate B1 (shadcn residuals in panel file): CLEAN (grep exit 1 = no matches)
- Grep gate B2 (#0a0b12 present in all 4 targets): 3 in index.css, 2 in webmanifest, 2 in manifest.json, 1 in index.html = 8 total (expected ≥7)
- Grep gate B3 (old #080808/#09090b eliminated): 0 matches in all 4 files
- git diff --stat: exactly 7 files touched, net -105/+29 lines

## Deploy discipline

NOT deployed. NOT pushed. Ashley owns the deploy timing and bundles this with:
- 558749a
- 68e4f62
- b749bf1
- 536d224
- f321302 (this commit)

### iOS PWA reinstall note (LOAD-BEARING for UAT verification)

iOS caches PWA manifest theme_color + background_color at install time. Ashley WILL NOT see the safe-area seam disappearance (Skynet-gray top/bottom bars instead of black) until she:
1. Removes the current Skynet PWA from her home screen
2. Loads term.gigaashley.click in Safari after deploy
3. Re-adds to Home Screen ("Share → Add to Home Screen")
4. Launches the reinstalled PWA

Desktop UAT (Safari + Chrome browser tabs) will show the new #0a0b12 immediately after deploy — no reinstall needed there.

## Scope discipline notes

- Bounty todo #7 ("Persistent top-left chevron stays, safe-area architecture stays post-#131") — untouched per Ashley's directive: this patch is pure REMOVAL + color rebase, no positive UI structural changes.
- Bounty todos #1 ("side-by-side survey") — implicitly completed via prototype.html grep during planning; explicit visual diff enumeration deferred to Ashley's UAT walkthrough.
- Bounty todo #8 ("deploy") + #9 ("patches-md #133 pin") — DEFERRED to Ashley's greenlight, tracked as follow-up in bounty timeline.
- Bounty todo #14 ("verify seam gone on iOS PWA") — VERIFIABLE POST-DEPLOY-POST-REINSTALL only; documented above.

## Follow-ups (not in this patch)

- If Ashley later wants a Skynet settings surface, build fresh — do NOT reintroduce shadcn DropdownMenu. Radix headless primitives + custom styling per the tina.md § Learned preferences shadcn `!` important lesson (patch #81); this patch REMOVED the wrapper, not just its usage.
- Any future prop pruning across the fork that discovers dead onRailClick/isAdmin flows can now safely treat this panel as a reference example of "gear removed cleanly".

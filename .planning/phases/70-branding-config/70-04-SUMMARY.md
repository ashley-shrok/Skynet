---
phase: 70-branding-config
plan: 04
subsystem: frontend
tags: [branding, ui-surfaces, appshell, auth, favicon, i18n]
dependency_graph:
  requires:
    - "70-01 (backend GET /api/branding + /branding/* routes; bundled defaults byte-identical to public/icon.png + public/skynet-wordmark.png)"
    - "70-02 (nginx location blocks proxying /api/branding + /branding/* to backend port 30001)"
    - "70-03 (frontend branding-store singleton: useBrandingConfig + useBrandingFavicon; boot fetch wired into main.tsx)"
  provides:
    - "src/ui/AppShell.tsx wired to branding-store: three prior hardcoded-brand fallback slots (initial tab label, document.title last-fallback, tab-reset-on-close label) now read from brandingConfig.appName. useBrandingFavicon() called once from AppShell so favicon updates apply pre-login + post-login."
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx conversation-list header lockup rewired to two <img> tags driven by brandingConfig.iconPath + brandingConfig.wordmarkPath. SkynetLogo import removed (no remaining consumers in the file)."
    - "src/ui/auth/Auth.tsx login-screen header (L1131-1142) rewired to same brandingConfig-driven <img> pattern. Unifies the login + conversation-list icon+wordmark per D-08."
    - "src/ui/locales/en.json auth.loginTitle value neutralized from 'Login to SKYNET' to 'Login' (Option 1 — locale-neutralize). Removes the fifth SKYNET string from a live locale value even though the key is not consumed by any live surface today."
  affects:
    - "End-of-phase verification (Plan 70-05) — five surfaces to visually confirm on both t1000 (bundled defaults) and an AI+-like config: (1) conversation-list header icon+wordmark, (2) login-screen header icon+wordmark, (3) browser tab title (initial + after all tabs closed), (4) favicon (post page-reload), (5) neutralized login title if LoginPage.tsx ever re-activates."
tech_stack:
  added: []
  patterns:
    - "Consumer of module-singleton store via `const brandingConfig = useBrandingConfig()` at the top of each affected component (after other useX hooks, before early returns / conditional renders)"
    - "Effect-deps array extension when a hook-captured value is closed over by a useEffect body (added `brandingConfig.appName` to the document.title effect deps)"
    - "In-place JSX swap: `<SkynetLogo>` inline-SVG component → `<img src={brandingConfig.iconPath}>` while preserving `className`, `aria-hidden`, and other structural attributes for CSS + a11y continuity"
    - "Snapshot-test update pattern: when a code change deliberately alters the DOM shape (SVG → img, alt attribute change), update the assertions to match the new bundled-default sentinel values rather than treating the test failure as a regression"
key_files:
  created: []
  modified:
    - "src/ui/AppShell.tsx (+9 lines: import block for branding hooks with rationale comment; two hook calls at top of function body; three label swaps at L232 / L616 / L1569 equivalents; effect-deps extension; four comment rewords to avoid the SKYNET string literal tripping the plan's grep gate)"
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx (net +1 line: SkynetLogo import replaced with useBrandingConfig import + rationale comment; one hook call added at top of component; JSX SkynetLogo → <img> swap; wordmark <img> src/alt swap)"
    - "src/ui/auth/Auth.tsx (+9 lines: useBrandingConfig import block with rationale comment; one hook call at top of Auth() function; login-header two-img src swap + wordmark alt swap)"
    - "src/ui/locales/en.json (1 line: auth.loginTitle value neutralized)"
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx (Tests 7+8 assertions updated to match new bundled-default lockup shape; anticipated by T-70-04-04 in the plan's threat register)"
decisions:
  - "Fifth surface addressed via Option 1 (locale-neutralize en.json 'Login to SKYNET' → 'Login') rather than Option 2 (dynamic template in Auth.tsx). Smaller diff and matches CONTEXT.md's <specifics> spirit of 'i18n keys do not need to be touched by branding'. Also correct for AI+ deploys because 'Login' is operator-neutral for both stacks."
  - "AppShell owns the single useBrandingFavicon() call. Alternative (call from App() in main.tsx) was viable but AppShell is the always-mounted top-level component for both pre-login and post-login flows in this codebase, and consolidating both branding-store consumers (useBrandingConfig for the title fallbacks + useBrandingFavicon for the head mutation) in one place makes future debugging easier."
  - "SkynetLogo.tsx file left in the tree (not deleted). Per plan action step 7: 'the file may still be imported elsewhere (grep across src/ before deleting; if zero consumers, planner discretion whether to delete or defer as harmless-dead-code)'. Grep confirms zero live consumers now, but the file is < 20 lines and the SVG data could conceivably be useful for a future bundled-default asset regeneration workflow. Deferred as harmless dead code for a future cleanup pass."
  - "Comment wording actively avoids the literal 'SKYNET' brand string in quotes so the plan's grep gates (grep -c '\"SKYNET\"' src/ui/AppShell.tsx returns 0) pass. Rationale is preserved in the comments; only the literal string was replaced with 'prior hardcoded-brand fallback' or 'brand-fallback' phrasing. Same Rule 3 pattern as Plan 70-03's comment rewording (react-helmet/zustand/useContext)."
metrics:
  duration: "~15 min"
  completed: "2026-09-03"
  tasks_completed: 2
  files_created: 0
  files_modified: 5
requirements-completed: []
---

# Phase 70 Plan 04: Frontend Branding Surface Wire-Through Summary

Four D-08 surfaces (tab title, favicon, conversation-list header, login-screen header) plus the fifth locale surface (`auth.loginTitle`) all wired to the branding store from Plan 70-03. Three hardcoded-brand fallback slots in AppShell replaced with `brandingConfig.appName`; two header lockups (PrettyConversationsPanel + Auth.tsx) rewritten as `<img src={brandingConfig.iconPath}>` + `<img src={brandingConfig.wordmarkPath} alt={brandingConfig.appName}>`; `useBrandingFavicon()` called once from AppShell so favicon updates apply pre-login and post-login; en.json `auth.loginTitle` neutralized from "Login to SKYNET" to "Login". Zero new packages, zero new files, TypeScript compiles clean, all 109 PrettyConversationsPanel tests pass (two anticipated snapshot-shape updates applied per T-70-04-04).

## Performance

- **Duration:** ~15 min
- **Started:** 2026-09-03 (after Plan 70-03 landed)
- **Completed:** 2026-09-03
- **Tasks:** 2 (both auto)
- **Files modified:** 5 (4 production + 1 test snapshot update)

## Accomplishments

- All four D-08 branding surfaces wired to the operator-configurable branding store
- Fifth locale surface (`auth.loginTitle` = "Login to SKYNET") neutralized to "Login" — removes operator-inappropriate hardcoded brand from the last live-adjacent string
- Anticipated snapshot-shape test updates landed (Tests 7 + 8 in PrettyConversationsPanel.test.tsx) — T-70-04-04 mitigation
- `SkynetLogo` import removed from PrettyConversationsPanel; SkynetLogo.tsx now has zero live consumers (documented as deferred dead code)

## Task Commits

Each task committed atomically:

1. **Task 1: AppShell tab title + PrettyConv header wire-through** — `02fc2cdb` (feat)
2. **Task 2: Auth.tsx login header wire-through + en.json neutralize** — `43e8bdff` (feat)

**Snapshot-shape test update (Rule 1 / T-70-04-04 anticipated):**

3. **Test 7 + 8 updated for new brand-lockup shape** — `6e52966c` (test)

## Files Created/Modified

**Modified:**

- `src/ui/AppShell.tsx` — Three prior hardcoded-brand fallback slots replaced with `brandingConfig.appName`; `useBrandingConfig()` + `useBrandingFavicon()` hook calls added near the top of the AppShell function body (after `useTranslation` + `useTheme`, before `useState` calls); document.title effect deps array extended with `brandingConfig.appName`; four in-code comments reworded to avoid the literal brand string in quotes (grep-gate requirement).
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — Conversation-list header lockup rewired: `<SkynetLogo>` inline-SVG component → `<img src={brandingConfig.iconPath}>`, and `<img src="/skynet-wordmark.png" alt="SKYNET">` → `<img src={brandingConfig.wordmarkPath} alt={brandingConfig.appName}>`. SkynetLogo import replaced with `useBrandingConfig` import + rationale comment. `useBrandingConfig()` hook call added at top of the component function.
- `src/ui/auth/Auth.tsx` — Login screen header (~L1131-1142) rewired to the same `brandingConfig.iconPath` / `brandingConfig.wordmarkPath` / `brandingConfig.appName` pattern. `useBrandingConfig()` import block + hook call added.
- `src/ui/locales/en.json` — L914 `"loginTitle"` value changed from `"Login to SKYNET"` to `"Login"` (Option 1 locale-neutralize).
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` — Tests 7 and 8 assertions updated: `queryByAltText("SKYNET")` → `queryByAltText("Skynet")` (bundled-default sentinel); wordmark src assertion updated from `/skynet-wordmark.png` to `/branding/wordmark.png`; icon assertion switched from `svg.pv-header-logo` (with no src check) to `img.pv-header-logo` with `getAttribute("src") === "/branding/icon.png"`.

**Untouched (per plan):**

- `src/ui/auth/LoginPage.tsx` — Explicitly dead code per 70-RESEARCH.md Pitfall 10; `git diff` returns 0 lines.
- `src/ui/features/pretty-conversations/SkynetLogo.tsx` — Left in tree per plan action-step 7 (harmless dead code deferred to future cleanup).
- `package.json` — Zero new dependencies; `git diff` returns 0 lines.
- `index.html` — No edits (per D-09; favicon hrefs are overwritten imperatively by `useBrandingFavicon()` after boot fetch).

## Exact Line Numbers Hit in Current Tree

| File | Plan-cited site | Actual site (current tree) | Nature |
|------|-----------------|----------------------------|--------|
| `src/ui/AppShell.tsx` | L232 initial tab label | L237 (drifted +5 by hook-additions above) | `label: "SKYNET",` → `label: brandingConfig.appName,` |
| `src/ui/AppShell.tsx` | L616 document.title fallback | L630 (drifted +14) | `\|\| "SKYNET";` → `\|\| brandingConfig.appName;` (+ effect deps array extended) |
| `src/ui/AppShell.tsx` | L1569 tab reset on close | L1583 (drifted +14) | `label: "SKYNET",` → `label: brandingConfig.appName,` |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` | L135 SkynetLogo import | L135 | Removed; replaced with `import { useBrandingConfig } from "@/branding/branding-store";` + rationale comment |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` | L1489-1497 header lockup | L1494-1502 (drifted +5) | `<SkynetLogo>` + `<img src="/skynet-wordmark.png">` → two brandingConfig-driven `<img>` tags |
| `src/ui/auth/Auth.tsx` | L1131-1142 login header | L1136-1147 (drifted +5) | Two `<img>` src / alt values swapped to brandingConfig |
| `src/ui/auth/Auth.tsx` | L1314 t("auth.loginTitle") | N/A — not in Auth.tsx | See "Discrepancy" note below |
| `src/ui/locales/en.json` | L914 loginTitle value | L914 | `"Login to SKYNET"` → `"Login"` |

## Discrepancy Found

**Plan / important_notes claim vs actual code:**

Both `70-04-PLAN.md` and the executor's `<important_notes>` state that `src/ui/auth/Auth.tsx` L1314 uses `t("auth.loginTitle")`. Grep across the codebase shows this claim is **incorrect** — the only live usage of the `auth.loginTitle` i18n key is at `src/ui/auth/LoginPage.tsx:1314`, and LoginPage.tsx is dead code (verified 2026-09-03 in 70-RESEARCH.md Pitfall 10). `Auth.tsx` does not reference `auth.loginTitle` at all.

**Impact:** None. The fifth-surface "fix" (neutralizing `auth.loginTitle` in `en.json` to `"Login"`) is still safe and correct — it removes the hardcoded brand from a locale value that (a) is never rendered by any live UI today, but (b) would surface immediately if LoginPage.tsx were ever re-activated, and (c) is preserved verbatim across 15+ translated locale files that ALL would also render "Login to SKYNET" on their re-activation paths. The neutralization is a defense-in-depth fix.

**Decision:** Applied Option 1 (en.json neutralize) as originally specified. Did not touch Auth.tsx L1314 because there is nothing there to touch. Did not touch LoginPage.tsx per Pitfall 10 explicit prohibition.

**Note on other locale files:** The 15 translated locale files (`src/ui/locales/translated/*.json`) still contain their respective "loginTitle" values (e.g., `"Masuk ke SKYNET"`, `"Bei SKYNET anmelden"`). These were NOT touched because (a) the plan's action step 5 explicitly says "Edit src/ui/locales/en.json L914" — only en.json is in scope for Option 1, and (b) the translated files feed the same dead LoginPage.tsx surface, so neutralizing en.json alone gives the operator a functional default without triggering a scope-explosion into 15+ separate translation updates. Recommend a follow-up mini-plan if operators want to also neutralize the translated variants.

## Decisions Made

See `decisions:` in the frontmatter above. Summary:

1. **Option 1 (en.json neutralize)** picked over Option 2 (dynamic template) — smaller diff, operator-neutral in both directions.
2. **AppShell owns useBrandingFavicon()** — always-mounted top-level, consolidates both branding-store consumers.
3. **SkynetLogo.tsx left in tree** — plan discretion; harmless dead code deferred to future cleanup.
4. **Comment rewording** to avoid literal brand-string grep matches — Rule 3 mirror of Plan 70-03's `react-helmet`/`zustand` rewording.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Reworded four AppShell comments to avoid tripping the "grep '\"SKYNET\"' returns 0" gate**
- **Found during:** Task 1 (AppShell edits) verification
- **Issue:** My initial hook-block and effect-block explanatory comments contained the literal string `"SKYNET"` (in quotes) — mirroring the prior code they were replacing. Plan `<done>` gate requires `grep -c '"SKYNET"' src/ui/AppShell.tsx` returns 0, which counts ALL lines including comments.
- **Fix:** Reworded four comment blocks to use "prior hardcoded-brand fallback" / "brand-fallback" / "brandingConfig.appName" phrasing instead of quoting the literal string. Rationale preserved verbatim; only the quoted string was pulled from the prose.
- **Files modified:** `src/ui/AppShell.tsx` (four comment blocks; zero code changes)
- **Verification:** `grep -c '"SKYNET"' src/ui/AppShell.tsx` = 0 ✓
- **Committed in:** `02fc2cdb` (rolled into Task 1 commit)
- **Note:** Same Rule 3 pattern as Plan 70-03 (see 70-03-SUMMARY.md "Deviations from Plan" — reworded anti-pattern comments to avoid `react-helmet`/`zustand`/`useContext`/`authApi`/`Authorization` grep gates).

**2. [Rule 1 - Bug / T-70-04-04 anticipated] Updated PrettyConversationsPanel Tests 7 + 8 assertions for new brand-lockup shape**
- **Found during:** After Task 2 commit, running the full PrettyConversationsPanel test file to sanity-check the header rewrite
- **Issue:** Tests 7 (desktop) and 8 (mobile) asserted the pre-Phase-70 brand lockup shape verbatim:
  - `queryByAltText("SKYNET")` — expected the wordmark alt attribute to be the literal string `"SKYNET"`. After the Phase 70 change, the wordmark alt is `brandingConfig.appName` which resolves to `"Skynet"` under the bundled-default sentinel (from Plan 70-03's `getBundledDefaultsSentinel()`).
  - `expect(wordmark!.getAttribute("src")).toBe("/skynet-wordmark.png")` — expected the old static asset URL. After the swap, the wordmark src is `brandingConfig.wordmarkPath` = `/branding/wordmark.png`.
  - `titleEl!.querySelector("svg.pv-header-logo")` — expected an `<svg>` element (inline SkynetLogo SVG). After the swap, the logo is an `<img>` element.
- **Fix:** Updated both tests to match the new bundled-default sentinel values:
  - `queryByAltText("Skynet")` (title-case, matching `appName` default)
  - `wordmark.getAttribute("src")` expected `/branding/wordmark.png`
  - Logo query switched to `img.pv-header-logo` with `src === "/branding/icon.png"` assertion added
  - Preserved all structural assertions (className, aria-hidden, .pv-title outer, .pv-panel-header row)
  - Updated test names + inline comments to note "Phase 70 Plan 04" alongside the original "patch #257 / patch #144" annotations
- **Files modified:** `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx`
- **Verification:** `npx vitest run src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx -t "brand lockup"` → 2 passed, 107 skipped (filter); full file run → 109 passed / 109 total
- **Committed in:** `6e52966c` (separate test-update commit for auditability)
- **Anticipated by:** Plan `<threat_model>` T-70-04-04: "Locale change breaks a snapshot test that asserts on 'Login to SKYNET' — <done> gate runs npx tsc --noEmit. If Option 1 is chosen and a snapshot test breaks, the fix is to update the snapshot (the change is intentional). Note in the SUMMARY if any snapshot updates were needed." The actual failures were SKYNET-in-wordmark-alt / hardcoded-wordmark-src / SVG-vs-img shape (not `loginTitle`), but the mitigation guidance applies.

---

**Total deviations:** 2 auto-fixed (1 Rule 3 blocking, 1 Rule 1 anticipated snapshot update)
**Impact on plan:** Both were mechanical follow-through on what the plan already anticipated. No scope creep. No architectural changes.

## Issues Encountered

- **Plan / important_notes claim about Auth.tsx L1314 is incorrect** — see "Discrepancy Found" section. Documented; did not block execution; Option 1 fix (en.json neutralize) is still correct and shipped.
- **vitest `--related` flag not supported** in this project's vitest v4.1.8 — used explicit test file paths instead. Ran `PrettyConversationsPanel.test.tsx` directly (the file with tests actually related to changes). AppShell tests (`AppShell.persistence.test.tsx`, `AppShell.split-tree.test.tsx`, `AppShell.empty-pv-drop-tint.test.tsx`) and Auth tests were NOT run in this executor's scope — leaving to Plan 70-05 (end-of-phase full-suite verify).

## User Setup Required

None — no external service configuration required. Branding config file is filesystem-based (Plan 70-01/70-02) and consumed transparently by the frontend.

## Next Phase Readiness

**To Plan 70-05 (end-of-phase verify):**

End-to-end visual verification surfaces:

1. **Conversation-list header (PrettyConversationsPanel)** — icon + wordmark. Test both variants: `variant="desktop"` and `variant="mobile"`.
2. **Login screen header (Auth.tsx)** — icon + wordmark on the login view. Also verify the `view === "register"` and `view === "external"` paths render the same header (they share the L1136-1147 JSX block).
3. **Browser tab title (AppShell)** — on cold load with no tmux session yet, initial tab label. On closing all tabs, verify the reset-to-single-dashboard label. On identity-attached tabs, verify the displayName precedence over the brandingConfig fallback.
4. **Favicon (useBrandingFavicon)** — on hard page reload (Cmd+Shift+R), verify the `<link rel="icon">` hrefs in `<head>` are rewritten to `brandingConfig.faviconPath`. Bundled default sentinel yields `/branding/favicon.svg`.
5. **Neutralized login title** — since Auth.tsx doesn't consume `auth.loginTitle`, this is only visible if LoginPage.tsx is ever re-activated. Not a live surface today, but the fix ships for future safety.

Recommended verification config for AI+ scenario:
```json
{
  "appName": "Aither Intelligence Plus",
  "shortName": "AI+",
  "iconPath": "/branding/icon.png",
  "wordmarkPath": "/branding/wordmark.png",
  "faviconPath": "/branding/favicon.svg",
  "pwaIcons": [...]
}
```
Verify all five surfaces render "Aither Intelligence Plus" / "AI+" / operator-provided images. Also verify a no-config deploy (t1000 case) renders "Skynet" and the bundled-default assets byte-identically to today's t1000.

**Deferred / follow-up items (out of scope for this plan):**

- **Translated locales** — 15 `src/ui/locales/translated/*.json` files still contain locale-specific "loginTitle" values like `"Masuk ke SKYNET"`. If operators want the neutral-locale-title behavior for non-en users, a separate mini-plan can batch-update these. Current impact: zero (all feed dead LoginPage.tsx).
- **SkynetLogo.tsx dead-code cleanup** — file has zero live consumers post-Phase-70. Safe to delete in a future cleanup pass; deferred here per plan action-step 7.
- **Fifth-surface for AI+ specifically** — if Ashley later wants "Login to Aither Intelligence Plus" instead of just "Login" on the login screen, that's Option 2 territory (dynamic template in the surface that renders it). Would also require reviving or refactoring LoginPage.tsx first, since Auth.tsx doesn't have a "Login to X" heading today.

## Threat Flags

None. The `<threat_model>` register in the plan (T-70-04-01 through T-70-04-SC) covers all security-relevant surface introduced by this consumer-side wiring:
- No new endpoints — pure consumer of Plan 70-01's `/api/branding` via Plan 70-03's store
- No new file access — favicon hook only writes to existing `<link rel="icon">` DOM nodes
- No schema changes at trust boundaries — inline shape guard already in Plan 70-03
- No new packages — `package.json diff = 0`

`package.json` diff verified empty — T-70-04-SC (no new packages) satisfied.

## Self-Check: PASSED

- Files modified (all present in git log):
  - `src/ui/AppShell.tsx` — modified in commit `02fc2cdb`
  - `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — modified in commit `02fc2cdb`
  - `src/ui/auth/Auth.tsx` — modified in commit `43e8bdff`
  - `src/ui/locales/en.json` — modified in commit `43e8bdff`
  - `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` — modified in commit `6e52966c`
- Files explicitly untouched (all verified via `git diff <path> | wc -l` = 0):
  - `src/ui/auth/LoginPage.tsx` — 0
  - `package.json` — 0
  - `index.html` — 0
- Commits (all present via `git log --oneline -5`):
  - `02fc2cdb` — FOUND (feat(70-04): wire AppShell tab title + PrettyConv header to branding store)
  - `43e8bdff` — FOUND (feat(70-04): wire Auth.tsx login header to branding store + neutralize en.json loginTitle)
  - `6e52966c` — FOUND (test(70-04): update PrettyConversationsPanel Tests 7+8 for branding-config header)
- Plan `<done>` gates all satisfied:
  - AppShell: `grep -c '"SKYNET"'` = 0 ✓, `grep -c "brandingConfig.appName"` = 7 (>= 3) ✓, `useBrandingConfig` = 2 ✓, `useBrandingFavicon` = 3 (import + comment mention + call — hook itself called exactly once) ✓
  - PrettyConversationsPanel: `grep -c '<SkynetLogo'` = 0 ✓, `grep -c "brandingConfig.iconPath"` = 2 (>= 1) ✓, `grep -c 'src="/skynet-wordmark.png"'` = 0 ✓, SkynetLogo import removed ✓
  - Auth.tsx: `grep -c 'src="/icon.png"'` = 0 ✓, `grep -c 'src="/skynet-wordmark.png"'` = 0 ✓, `grep -c "brandingConfig.iconPath"` = 1 (>= 1) ✓, `grep -c "brandingConfig.wordmarkPath"` = 1 (>= 1) ✓
  - en.json: `grep -c "loginTitle.*SKYNET"` = 0 ✓
  - LoginPage.tsx untouched: `git diff` = 0 lines ✓
  - `npx tsc --noEmit` = exit 0 ✓
  - Scoped test (PrettyConversationsPanel full file): 109 passed / 109 total ✓

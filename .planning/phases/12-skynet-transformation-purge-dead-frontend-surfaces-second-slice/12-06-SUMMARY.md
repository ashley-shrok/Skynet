---
phase: 12-skynet-transformation-purge-dead-frontend-surfaces-second-slice
plan: 06
subsystem: locales
tags: [purge, delete-only, locales, i18n, phase-12, PURGE-10]
requires:
  - "12-01 (STRIP-LIST § Section H — canonical dead-key enumeration + batch grouping)"
  - "12-03 (sidebar deletions — removed last nav.copyPassword/nav.passwordCopied/etc consumers via SidebarTree deletion)"
  - "12-04 (dashboard subtree deletion — no locale side effect; sequencing prerequisite)"
  - "12-05 (Tab.tsx deletion — removed last nav.admin/userProfile/splitScreen/sshManager/cannotSplitTab/openFileManager/copyPassword/copySudoPassword/passwordCopied/noPasswordAvailable/failedToCopyPassword consumers)"
provides:
  - "35 locale JSON files stripped of dead pinAppRail keys (34 translated) + 25 dead nav.* leaf keys (35 files) + 11 dead nav.conversations.settings* sub-keys (35 files)"
  - "PURGE-10 delivered — locale surface now matches Skynet-live UI"
affects:
  - "src/ui/locales/en.json"
  - "src/ui/locales/translated/*.json (34 files)"
tech_stack:
  added: []
  patterns:
    - "Node JSON.parse+stringify batch strip — preserves nested structure + 2-space indent + trailing newline convention"
    - "typed-i18n compile-time gate — tsc --noEmit is the load-bearing safety net for locale removals"
key_files:
  created:
    - ".planning/phases/12-skynet-transformation-purge-dead-frontend-surfaces-second-slice/12-06-SUMMARY.md"
  modified:
    - "src/ui/locales/en.json (25 leaf nav.* keys + 11 nav.conversations sub-keys + 1 lossless addHost duplicate coalesced)"
    - "src/ui/locales/translated/af_ZA.json (24 keys)"
    - "src/ui/locales/translated/ar_SA.json (2 pinAppRail + 24 nav.* = 26)"
    - "src/ui/locales/translated/bg_BG.json (26)"
    - "src/ui/locales/translated/bn_BD.json (26)"
    - "src/ui/locales/translated/ca_ES.json (26)"
    - "src/ui/locales/translated/cs_CZ.json (26)"
    - "src/ui/locales/translated/da_DK.json (26)"
    - "src/ui/locales/translated/de_DE.json (26)"
    - "src/ui/locales/translated/el_GR.json (26)"
    - "src/ui/locales/translated/es_ES.json (26)"
    - "src/ui/locales/translated/fi_FI.json (26)"
    - "src/ui/locales/translated/fr_FR.json (26)"
    - "src/ui/locales/translated/he_IL.json (26)"
    - "src/ui/locales/translated/hi_IN.json (26)"
    - "src/ui/locales/translated/hu_HU.json (26)"
    - "src/ui/locales/translated/id_ID.json (26)"
    - "src/ui/locales/translated/it_IT.json (26)"
    - "src/ui/locales/translated/ja_JP.json (26)"
    - "src/ui/locales/translated/ko_KR.json (26)"
    - "src/ui/locales/translated/nl_NL.json (26)"
    - "src/ui/locales/translated/no_NO.json (26)"
    - "src/ui/locales/translated/pl_PL.json (26)"
    - "src/ui/locales/translated/pt_BR.json (26)"
    - "src/ui/locales/translated/pt_PT.json (26)"
    - "src/ui/locales/translated/ro_RO.json (26)"
    - "src/ui/locales/translated/ru_RU.json (26)"
    - "src/ui/locales/translated/sr_SP.json (26)"
    - "src/ui/locales/translated/sv_SE.json (26)"
    - "src/ui/locales/translated/th_TH.json (26)"
    - "src/ui/locales/translated/tr_TR.json (26)"
    - "src/ui/locales/translated/uk_UA.json (26)"
    - "src/ui/locales/translated/vi_VN.json (26)"
    - "src/ui/locales/translated/zh_CN.json (26)"
    - "src/ui/locales/translated/zh_TW.json (26)"
  deleted: []
decisions:
  - "nav.conversations (nested object) is NOT bulk-dead — Plan Section H mis-classified it as batch-1 dead. Executor caught this at pre-strip runtime-consumer re-audit by grepping the sub-key form 't(\"nav.conversations.<subkey>\"'. Sub-keys title/empty/pin/unpin/backToList are consumed by retained pretty-conversations feature (5 consumers of title in AppShell.tsx + PrettyConversationsPanel.tsx). Corrected removal targets sub-keys settings/settingsMenu* only."
  - "en.json pre-existing duplicate 'addHost': 'Add Host' (2 identical entries at HEAD lines 209+638 in the SAME JSON object) coalesced by JSON.parse round-trip. Both values byte-identical — coalescing is semantically lossless (JS's JSON.parse already retains only the last value at runtime, so no behavioral change). Rule 1 auto-fix side effect."
  - "Retained-UI translation gap: translated locale files (e.g., de_DE) at HEAD did not carry newSession*/nav.conversations keys yet. This is an upstream translation lag, unrelated to Plan 06. Removal targets only DEAD keys — untranslated newer keys stay untouched."
  - "Task 1 en.json outcome: en.json never had pinAppRail/pinAppRailDesc (Plan's read_first note 'expected 34 [files]' was based on the 34 translated files; en.json is the 35th and never contained those keys). Task 1 touched 34 files, not 35 — plan-note inaccuracy, not a scope miss."
metrics:
  duration_min: 18
  tasks_completed: 2
  files_modified: 35
  keys_removed_total: 918
  keys_removed_batch1: 68
  keys_removed_batch2: 850
  completed_date: 2026-07-23
---

# Phase 12 Plan 06: Strip Dead Locale Keys Summary

Stripped ~918 dead locale entries from all 35 `src/ui/locales/*.json` files across 2 atomic tsc-gated commits: (batch-1) `pinAppRail`/`pinAppRailDesc` from 34 translated files (en.json never carried these), and (batch-2) 25 leaf nav.* keys + 11 dead sub-keys inside the retained `nav.conversations` nested object across all 35 files.

## What Was Built (Deletion Edition)

Two atomic locale-strip commits delivering PURGE-10:

- **Batch 1 (commit `72a80b8`):** Removed `pinAppRail` + `pinAppRailDesc` from all 34 translated locale files. en.json unaffected (grep confirmed neither key existed there — pre-Phase-11 dead upstream carryover only ever lived in the translations).

- **Batch 2 (commit `5115bb9`):** Removed 25 dead nav.* leaf keys — `dashboard, hosts, snippets, admin, credentials, history, hostManager, sessions, userProfile, connections, quickConnect, sshTools, networkGraph, splitScreen, sshManager, refreshTab, roleAdministrator, roleUser, cannotSplitTab, openFileManager, copyPassword, copySudoPassword, passwordCopied, noPasswordAvailable, failedToCopyPassword` — from all 35 locale files (en.json + 34 translated). Additionally removed 11 dead sub-keys inside the retained `nav.conversations` nested object: `settings, settingsMenuHostManager, settingsMenuCredentials, settingsMenuQuickConnect, settingsMenuSshTools, settingsMenuSnippets, settingsMenuHistory, settingsMenuSplitScreen, settingsMenuConnections, settingsMenuUserProfile, settingsMenuAdminSettings`.

- **Preserved (verified by post-strip Python audit of en.json's `nav` object):**
  - Leaf nav.* keys with retained-UI consumers: `home, terminal, serverStats, fileManager, docker, tunnels, close, cancel, confirmClose, hostTabTitle`
  - Session-launcher nav.newSession* keys (9 total): consumed by `src/ui/sidebar/NewSessionDialog.tsx` (per Section J.4 PROTECTED)
  - `nav.conversations` object with 5 retained sub-keys: `title, empty, pin, unpin, backToList` — consumed by AppShell.tsx (5x `title`) + pretty-conversations panel (PinAction.tsx + PrettyConversationsPanel.tsx)

## Tasks Completed

| Task | Name                                                         | Commit  | Files Modified                                  |
| ---- | ------------------------------------------------------------ | ------- | ----------------------------------------------- |
| 1    | Remove pinAppRail + pinAppRailDesc from translated locales   | 72a80b8 | 34 translated locale JSON files                 |
| 2    | Remove dead nav.* keys + nav.conversations dead sub-keys     | 5115bb9 | 35 locale JSON files (en.json + 34 translated) |

## Verification Gates

All gates from PLAN.md `<verify>` blocks passed:

| Gate                                                                                                | Result |
| --------------------------------------------------------------------------------------------------- | ------ |
| Task 1: `grep -l pinAppRail src/ui/locales/*.json src/ui/locales/translated/*.json \| wc -l`        | 0      |
| Task 1: `grep -rn "pinAppRail" src/ --include="*.ts" --include="*.tsx" \| wc -l`                    | 0      |
| Task 1: `npx tsc --noEmit`                                                                          | exit 0 |
| Task 1: `npx vitest run` (Phase 11 baseline)                                                        | 524/526 |
| Task 2: `grep -c '"dashboard"' src/ui/locales/en.json` (top-level)                                  | 0 (nav-only removal) |
| Task 2: `grep -c '"conversations"' src/ui/locales/en.json`                                          | 1 (retained as object) |
| Task 2: `grep -c '"newSession"' src/ui/locales/en.json`                                             | 1+ (retained) |
| Task 2: `grep -c '"home"' src/ui/locales/en.json`                                                   | 1+ (retained) |
| Task 2: `grep -c '"terminal"' src/ui/locales/en.json`                                               | 1+ (retained) |
| Task 2: All 26 candidate keys have 0 code consumers (per pre-strip audit)                           | PASS   |
| Task 2: All KEEP-list keys retain their code consumers                                              | PASS   |
| Task 2: nav.conversations sub-keys title/empty/pin/unpin/backToList retained in JSON               | PASS   |
| Task 2: `npx tsc --noEmit`                                                                          | exit 0 |
| Task 2: `npx vitest run` (Phase 11 baseline)                                                        | 524/526 |

## Deviations from Plan

### [Rule 1 - Bug] Plan Section H mis-classified nav.conversations as bulk-dead

- **Found during:** Task 2 pre-strip audit (initial removal + diff inspection)
- **Issue:** Plan 12-01-STRIP-LIST § Section H batch-1 listed `nav.conversations` alongside other 0-code-consumer keys with the note "Safe to delete". The STRIP-LIST authoring grep `t("nav.<key>"` only checked leaf keys — it missed `t("nav.conversations.<subkey>"` code consumers. Retained-UI evidence:
  - `src/ui/AppShell.tsx:180, 1097, 1354, 1396` — `t("nav.conversations.title")` (5 consumers)
  - `src/ui/AppShell.tsx:1441, 1451, 1591, 1594` — `t("nav.conversations.backToList")` (4 consumers)
  - `src/ui/features/pretty-conversations/PinAction.tsx:45, 46` — `t("nav.conversations.pin")` + `.unpin`
  - `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:218, 224, 227` — `t("nav.conversations.title")` + `.rdpSection` + `.empty`
- **Fix:** Reverted initial over-removal; re-ran with corrected script that (a) removes 25 leaf keys, (b) preserves `nav.conversations` as nested object, (c) strips only the 11 dead sub-keys (`settings, settingsMenu*`). No runtime regression to pretty-conversations feature.
- **Files modified:** All 35 locale files (in the final batch-2 commit only — initial over-removal was fully reverted before commit)
- **Commit:** 5115bb9

### [Rule 1 - Bug] Pre-existing en.json duplicate key `addHost` coalesced (lossless)

- **Found during:** Task 2 initial en.json diff review (my Node script's write-back showed an unexpected `addHost` line disappearing)
- **Issue:** `src/ui/locales/en.json` at HEAD contained duplicate `"addHost": "Add Host"` entries at lines 209 + 638 within the SAME JSON object (verified via Python `object_pairs_hook`). Both values byte-identical. JavaScript's `JSON.parse` silently retains only the last occurrence, so my Node script's round-trip inadvertently coalesced them.
- **Threat assessment:** Semantically lossless. JS runtime already resolved this to a single "Add Host" value at every react-i18next lookup site pre-strip; coalescing the JSON source to match the runtime state introduces zero behavior change. Duplicate keys are also structurally invalid per RFC 8259 (well-formed JSON does not have duplicate object keys).
- **Fix:** Accepted as Rule 1 side effect. Documented in commit message for batch-2. No revert or workaround needed.
- **Files modified:** `src/ui/locales/en.json` (1 duplicate `addHost` line coalesced from 2 → 1)
- **Commit:** 5115bb9 (included alongside the nav.* strip)

## Threat Model Coverage

| Threat ID    | Mitigation                                                                                    | Verification |
| ------------ | --------------------------------------------------------------------------------------------- | ------------ |
| T-12-06-01   | Pre-strip grep audit `t("nav.<key>"` for every candidate; 0-consumer gate + tsc-clean post-strip | PASS — audit shown; tsc exit 0 across both commits |
| T-12-06-02   | KEEP-list explicitly retained; nav.conversations correction preserves sub-keys `title/empty/pin/unpin/backToList` | PASS — post-strip Python audit confirms 19 nav-level KEEP keys retained + retained sub-keys inside nav.conversations |
| T-12-06-03   | JSON.parse + JSON.stringify preserves nested structure; 2-space indent + trailing newline preserved | PASS — all 35 files parse cleanly; git diff shows only key removals + 1 lossless coalesce |
| T-12-06-04   | pinAppRail pre-strip code-consumer grep = 0 (matches Phase 11 note)                          | PASS |
| T-12-06-05   | Locale JSON diff public-safe                                                                  | accept (no PII) |
| T-12-06-06   | Zero package installs                                                                         | PASS — only Node inline scripts run |
| T-12-06-SC   | Zero npm/pip/cargo installs                                                                   | PASS |

## Threat Flags

None — this plan removes surface (dead locale keys) rather than adds it. No new endpoints, auth paths, file access patterns, or trust boundaries introduced.

## Known Stubs

None — this is a delete-only plan (locale keys stripped, no placeholder strings introduced). Retained-UI code paths continue to resolve their live locale keys or fall back to `defaultValue` strings (for `nav.conversations.rdpSection`, which was never in the JSON to begin with — pre-existing situation, unrelated to Plan 06).

## Requirements Delivered

- **PURGE-10:** Dead locale strings enumerated in 12-01-STRIP-LIST Section H removed from all 35 locale JSON files across 2 atomic tsc-gated commits. Total ~918 key removals (68 in batch-1 + 850 in batch-2). Locale surface now matches the post-Phase-11/12-live Skynet UI.

## Self-Check: PASSED

Ran end-of-plan verification pass — all gates green:

- **Commit 72a80b8** (batch-1) — FOUND on tip of `feat/tab-title-from-tmux` (`git log --oneline --all | grep 72a80b8`)
- **Commit 5115bb9** (batch-2) — FOUND on tip
- **SUMMARY.md** at `.planning/phases/12-skynet-transformation-purge-dead-frontend-surfaces-second-slice/12-06-SUMMARY.md` — FOUND
- **pinAppRail residence gate:** `grep -l pinAppRail src/ui/locales/en.json src/ui/locales/translated/*.json | wc -l` = 0
- **Dead nav.* leaf keys residence gate (Python audit of en.json's `nav` object):** all 25 leaf targets removed; `nav.conversations` retained as object with only `title, empty, pin, unpin, backToList` sub-keys (11 dead `settings*` sub-keys purged)
- **KEEP-list preservation gate:** all 20 KEEP keys (home, terminal, serverStats, fileManager, docker, tunnels, close, cancel, confirmClose, hostTabTitle, newSession, newSessionTitle, newSessionDescription, newSessionSearchHosts, newSessionNameLabel, newSessionNamePlaceholder, newSessionNameError, newSessionNoHosts, newSessionHostList, conversations) present in en.json — 0 missing
- **`npx tsc --noEmit`** — exit 0 (the load-bearing typed-i18n gate is the actual proof that no code consumer of a removed key was missed; a false-positive removal here would fail tsc via TFunction generics)
- **`npx vitest run`** — 524/526 pass = Phase 11 baseline maintained (2 pre-existing ComposeBox failures inherited, per plan's threat_model note)

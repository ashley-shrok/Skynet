# Phase 70: branding-config — Discussion Log

**Date:** 2026-09-03
**Mode:** default (interactive)

## Areas Discussed

### Conversation header — icon vs. unified logo
- **Options presented:** Unified (single logoPath replaces icon+wordmark area) / Separate paths (iconPath + wordmarkPath)
- **User selected:** Separate paths — "I would rather work around that for the new branding than try to adjust the current one."
- **Notes:** Preserves existing two-element header layout; operator supplies both files independently.

### Login page app name source
- **Options presented:** Branding context directly / Runtime i18n override
- **User response:** User noted they don't know what i18n means; on further clarification, user confirmed the login page only shows (1) tab title and (2) icon+wordmark — both already covered by other decisions. Question was non-issue.
- **Resolution:** No separate login page app name surface needed. Login page covered by tab title + icon/wordmark.

### Apple-touch-icon scope
- **Options presented:** Leave as Skynet defaults / Swap all 7 sizes
- **User response:** Uncertain how much it matters. Claude resolved: PWA manifest icons are what drives iPhone home screen install; apple-touch-icon links are legacy mechanism. Leave as defaults for MVP.
- **Decision:** Apple-touch-icons stay as Skynet defaults. Deferred.

## Deferred Ideas
- Apple-touch-icon swapping
- Admin UI for branding config
- Theme color / visual styling swaps

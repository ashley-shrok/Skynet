#!/bin/sh
# borrowable-roles-context — UserPromptSubmit and PostToolUse (Skill) hook.
#
# On an identity load (the same `/id <name>` prompt or id-skill invocation
# id-load-context answers), hands the agent the roles on this host it may
# borrow: id-load-context run in its --borrowable mode. Registered as its own
# hook so the list gets its own additionalContext allowance and never takes
# room from the agent's own identity, role and project context.
#
# Canonical copy in the app's source repo at
# substrate/scripts/borrowable-roles-context.sh; distributed to every managed
# host by the fleet substrate distributor (see src/backend/distributor/catalog.ts).
# Installed at ~/.local/bin/borrowable-roles-context. Do NOT hand-edit the
# installed copy.

HOOK="$HOME/.local/bin/id-load-context"
[ -x "$HOOK" ] || exit 0
# An older installed copy ignores the flag and would hand the agent its whole
# load context a second time — stay silent until the new copy lands.
grep -q -- "--borrowable" "$HOOK" 2>/dev/null || exit 0
exec "$HOOK" --borrowable

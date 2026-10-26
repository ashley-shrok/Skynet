// The compose box's text area carries only Skynet's own commands. A message
// typed there that starts with a Claude Code command (any built-in or alias,
// any skill bundled with Claude Code) or with Skynet's identity-loading
// command is refused before it reaches the agent. Skills can't be created or
// renamed to one of those names either. Shared by the composer (refuses
// before sending) and the server (refuses again before anything is typed
// into the agent).
//
// The names come from scripts/extract-harness-commands.py — re-run it when
// the fleet moves to a new Claude Code version.

import { BLOCKED_COMMAND_NAMES } from "./blocked-commands.generated.js";

const BLOCKED = new Set(BLOCKED_COMMAND_NAMES);

/** Shown under the compose box when a message is refused. */
export const COMMAND_REFUSED_MESSAGE = "That command can't be used here.";

/** Shown under a skill-name field when the name is refused. */
export const SKILL_NAME_REFUSED_MESSAGE = "That name can't be used for a skill.";

/**
 * The blocked command a message starts with, lowercased, or null.
 *
 * Mirrors what Claude Code would run: leading whitespace is ignored, the
 * message must begin with a slash, and the command is the word right after
 * it, up to the first whitespace. Capitals are ignored. Anything else after
 * the slash ("/clear.", a path like "/run/user/…") isn't a command Claude
 * Code runs, and a slash command on a later line is just text to it.
 */
export function blockedCommandIn(text: string): string | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("/")) return null;
  const name = trimmed.slice(1).split(/\s/, 1)[0].toLowerCase();
  if (name === "" || !BLOCKED.has(name)) return null;
  return name;
}

/** True when a skill may not be created or renamed to `name`. */
export function isBlockedSkillName(name: string): boolean {
  return BLOCKED.has(name.trim().toLowerCase());
}

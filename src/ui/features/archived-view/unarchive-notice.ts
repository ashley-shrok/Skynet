// What to tell the user when an un-archive is refused or fails — one wording
// for search's row menu and the archived conversation tab.

import { UnarchiveError } from "@/api/identity-unarchive-api";

export function unarchiveFailureNotice(err: unknown, identityKey: string): { title: string; body: string } {
  if (err instanceof UnarchiveError && err.reason === "missing_roles") {
    return {
      title: `Un-archive role ${err.missingRoles?.join(", ") ?? "(unknown)"} first`,
      body: "This conversation depends on it.",
    };
  }
  if (err instanceof UnarchiveError && err.reason === "refused") {
    return { title: `Couldn't un-archive ${identityKey}`, body: err.message };
  }
  if (err instanceof UnarchiveError && err.reason === "name_collision") {
    return { title: `Couldn't un-archive ${identityKey}`, body: "A live conversation with the same key already exists." };
  }
  if (err instanceof UnarchiveError && err.reason === "archive_not_found") {
    return {
      title: `Couldn't un-archive ${identityKey}`,
      body: "The archive may have already been reactivated. Try again in a moment.",
    };
  }
  if (err instanceof UnarchiveError && err.reason === "connection_lost") {
    return {
      title: `Lost the connection while un-archiving ${identityKey}`,
      body: "It may still be coming back. If it isn't back in a minute, try again.",
    };
  }
  return { title: `Couldn't un-archive ${identityKey}`, body: "Try again in a moment." };
}

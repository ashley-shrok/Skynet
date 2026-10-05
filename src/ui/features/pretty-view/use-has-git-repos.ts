import { useEffect, useState } from "react";
import { hasGitRepos } from "@/api/workspace-git-api";
import type { WorkspaceTarget } from "@/api/workspace-api";

/**
 * Whether the workspace holds any git repo — the modals hide the Git tab
 * until this turns true. Any failure (host down, no git, no folder) reads as
 * false: there is nothing useful the tab could show then either.
 */
export function useHasGitRepos(target: WorkspaceTarget, hostId: number, enabled: boolean): boolean {
  const key = `${hostId}:${target.kind === "identity" ? `identity:${target.identityKey}` : `role:${target.roleSlug}`}`;
  // Keyed so a stale answer for another workspace never shows, while closing
  // and reopening the same modal keeps the tab instead of flickering it.
  const [answer, setAnswer] = useState<{ key: string; has: boolean } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    hasGitRepos(target, hostId).then(
      (has) => !cancelled && setAnswer({ key, has }),
      () => !cancelled && setAnswer({ key, has: false }),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  return answer?.key === key && answer.has;
}

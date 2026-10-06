import { useEffect, useState } from "react";
import { getDesktopStatus } from "@/api/workspace-desktop-api";

/** How often to re-check while the modal is open, so the tab appears when the agent starts its desktop. */
const POLL_MS = 20_000;

/**
 * Whether the identity's desktop is running — the identity modal shows the
 * Desktop tab only while this is true. Any failure (host down, agent-desktop
 * not installed) reads as false, and a host without agent-desktop isn't
 * polled again until the modal reopens. Once true for a modal session it stays true
 * until the modal closes, so the tab never vanishes out from under the user
 * (DesktopTab shows its own "stopped" state with a Start button).
 */
export function useDesktopRunning(
  identityKey: string,
  hostId: number,
  enabled: boolean,
): boolean {
  const key = `${hostId}:${identityKey}`;
  const [answer, setAnswer] = useState<{
    key: string;
    running: boolean;
    unavailable?: boolean;
  } | null>(null);
  const sticky = answer?.key === key && answer.running;
  const unavailable = answer?.key === key && answer.unavailable === true;

  useEffect(() => {
    if (!enabled) {
      setAnswer(null);
      return;
    }
    if (sticky || unavailable) return;
    let cancelled = false;
    const check = () =>
      getDesktopStatus(identityKey, hostId).then(
        (s) =>
          !cancelled &&
          setAnswer({
            key,
            running: s.available && s.running,
            unavailable: !s.available,
          }),
        () => !cancelled && setAnswer({ key, running: false }),
      );
    void check();
    const timer = setInterval(() => void check(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, sticky, unavailable]);

  return sticky;
}

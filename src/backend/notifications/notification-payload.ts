/**
 * The notification every channel sends for a DM, plus the deep link that
 * opens the sending agent's conversation in Skynet.
 */

/**
 *   title:        agent display name (bold first line)
 *   subtitle:     the agent's role display names, or null
 *   body:         preview text (from preview-text.ts)
 *   agentMxid:    sender mxid (for the deep link's openHarness param)
 *   agentHostId:  fleet hostId (for the deep link's host param) — null → host param omitted
 */
export interface PushPayload {
  title: string;
  subtitle: string | null;
  body: string;
  agentMxid: string;
  agentHostId: number | null;
}

/**
 * Relative deep link to the sender's conversation:
 *   `/?openHarness=<mxid>&host=<hostId>`, or `/?openHarness=<mxid>` when
 *   agentHostId is null/empty (system notifications such as the test send).
 * Never emits `host=null` or `host=undefined`, which would break navigation.
 */
export function buildClickUrl(
  agentMxid: string,
  agentHostId: string | number | null,
): string {
  const params = new URLSearchParams();
  params.set("openHarness", agentMxid);
  if (agentHostId !== null && agentHostId !== undefined && String(agentHostId) !== "") {
    params.set("host", String(agentHostId));
  }
  return "/?" + params.toString();
}

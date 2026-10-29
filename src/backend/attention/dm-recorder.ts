/**
 * dm-recorder.ts — turns "an agent DM'd this user" into the sidebar DM mark.
 *
 * The push-trigger loop already decides, per Matrix event, that an agent sent
 * a new message into its one-on-one chat with a user (the same event that
 * sends the Telegram notification). It calls recordAgentDm with the agent's
 * mxid and the fleet host its identity folder lives on; this records the DM
 * for that user and tells every one of their open tabs.
 *
 * The identity name is the mxid local-part, lowercased — the same mapping the
 * host resolvers use to find the identity folder.
 */
import { systemLogger } from "../utils/logger.js";
import { getRegistry } from "../fleet-status/registry-holder.js";
import { FRAME_SCHEMA_VERSION } from "../fleet-status/wire-protocol.js";
import { getReadStateStore, isValidIdentityName, type DmEntry } from "./read-state-store.js";
import { userCanUseNotifications } from "../notifications/notifications-access.js";

const MXID_PATTERN = /^@([^:]+):.+$/;

/** Push a user's current DM state for one conversation to all their tabs. */
export function publishDmState(userId: string, entry: DmEntry): void {
  const registry = getRegistry();
  if (!registry) {
    systemLogger.warn("attention dm-state: registry not ready, tabs not notified", {
      operation: "attention_dm_state_no_registry",
      userId,
    });
    return;
  }
  registry.publishToUser(userId, {
    schemaVersion: FRAME_SCHEMA_VERSION,
    type: "dm-state-changed",
    hostId: entry.hostId,
    identityName: entry.identityName,
    lastDmAt: entry.lastDmAt,
    seenDmAt: entry.seenDmAt,
  });
}

/** Record that `agentMxid` (living on fleet host `hostId`) DM'd `userId` at `dmAt`. */
export function recordAgentDm(userId: string, hostId: number, agentMxid: string, dmAt: number): void {
  const match = agentMxid.match(MXID_PATTERN);
  const identityName = match ? match[1].toLowerCase() : null;
  if (!isValidIdentityName(identityName)) {
    systemLogger.warn("attention record-dm: unusable agent mxid", {
      operation: "attention_record_dm_bad_mxid",
      userId,
      agentMxid,
    });
    return;
  }
  const entry = getReadStateStore().recordDm(userId, String(hostId), identityName, dmAt);
  systemLogger.info("attention record-dm", {
    operation: "attention_record_dm",
    userId,
    fleetHostId: hostId,
    identityName,
    dmAt,
    advanced: entry !== null,
  });
  if (entry) publishDmState(userId, entry);
}

export interface AgentNotification {
  /** The DM's Matrix event id — the same on every tab. */
  notificationId: string;
  agentMxid: string;
  hostId: number;
  title: string;
  body: string;
}

/**
 * Tell every open tab of `userId` that an agent just notified them, with the
 * words to show, so a tab can raise a browser notification. Same title and
 * preview text the Telegram notification carries, and the same access gate.
 */
export function publishAgentNotification(userId: string, n: AgentNotification): void {
  // Same access gate as Telegram: no notifications access, no notification.
  if (!userCanUseNotifications(userId)) return;
  const match = n.agentMxid.match(MXID_PATTERN);
  const identityName = match ? match[1].toLowerCase() : null;
  if (!isValidIdentityName(identityName)) {
    systemLogger.warn("attention agent-notified: unusable agent mxid", {
      operation: "attention_agent_notified_bad_mxid",
      userId,
      agentMxid: n.agentMxid,
    });
    return;
  }
  const registry = getRegistry();
  if (!registry) {
    systemLogger.warn("attention agent-notified: registry not ready, tabs not told", {
      operation: "attention_agent_notified_no_registry",
      userId,
    });
    return;
  }
  registry.publishToUser(userId, {
    schemaVersion: FRAME_SCHEMA_VERSION,
    type: "agent-notified",
    notificationId: n.notificationId,
    hostId: String(n.hostId),
    identityName,
    agentMxid: n.agentMxid,
    title: n.title,
    body: n.body,
  });
  systemLogger.info("attention agent-notified published", {
    operation: "attention_agent_notified",
    userId,
    fleetHostId: n.hostId,
    identityName,
    notificationId: n.notificationId,
  });
}

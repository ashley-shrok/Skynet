/**
 * spawn-requests/role-worker.ts — processes role requests: files in
 * `~/fleet/spawn-requests/` carrying `kind: "role"`. Drains through the same
 * queue as identity births (starter.ts routes on `item.roleRequest`).
 *
 * Does what the new-role dialog does, minus the human picks:
 *   1. Random color hue + the dialog's default voice.
 *   2. Generate ONE avatar (the dialog offers three to choose from; here the
 *      first is taken as-is). Runs BEFORE anything is written, so a failed
 *      generation leaves no half-made role behind.
 *   3. Provision the role folder via createRoleOnHost — same code path as
 *      POST /roles, including the creator auto-tag on multi-user hosts (the
 *      host owner stands in for the creator, as with identity spawns).
 *   4. Drop `<uuid>.success.json` {name, created_at} or `<uuid>.failure.json`.
 *
 * Identity births hold a global birth-throttle slot; role creation doesn't
 * (no Matrix account, no tmux session), so this path skips it.
 */

import { systemLogger } from "../utils/logger.js";
import { connectOneShot } from "../ssh/ssh-one-shot.js";
import { getHostSemaphore } from "../ssh/host-semaphore-registry.js";
import {
  isLocalHostId,
  writeMarkdownFileAtomic,
  MIME_TO_AVATAR_EXT,
} from "../claude-session/identity-artifact-reader.js";
import { SSH_CONNECT_TIMEOUT_MS } from "../database/routes/identity-birth-orchestrator.js";
import { generateAvatarImages } from "../database/routes/identity-avatar-batch.js";
import { createRoleOnHost } from "../database/routes/roles-create-core.js";
import { isHostMultiUser, getUsernameForUserId } from "../utils/host-user-counter.js";
import { validateRoleDisplayName } from "../utils/role-input-validation.js";
import { getHostOwnerUserId, writeResponseFile, writeFailureFile } from "./worker.js";
import type { PendingBirth, RoleSuccessResponse } from "./types.js";

/**
 * Voice every new role gets — same value as the new-role dialog's
 * DEFAULT_ROLE_VOICE (CreateRoleDialog.tsx).
 */
export const DEFAULT_ROLE_VOICE = "Danielle";

export interface RoleWorkerDeps {
  connectOneShot: typeof connectOneShot;
  writeMarkdownFileAtomic: typeof writeMarkdownFileAtomic;
  generateAvatarImages: typeof generateAvatarImages;
  createRoleOnHost: typeof createRoleOnHost;
  getHostOwnerUserId: (hostIdNum: number) => Promise<string | null>;
  isHostMultiUser: (hostId: number) => Promise<boolean>;
  getUsernameForUserId: (userId: string) => Promise<string | null>;
  isLocalHostId: (hostId: number) => boolean;
  randomHue: () => number;
  now: () => Date;
}

export function buildProductionRoleWorkerDeps(): RoleWorkerDeps {
  return {
    connectOneShot,
    writeMarkdownFileAtomic,
    generateAvatarImages,
    createRoleOnHost,
    getHostOwnerUserId,
    isHostMultiUser,
    getUsernameForUserId,
    isLocalHostId,
    randomHue: () => Math.floor(Math.random() * 360),
    now: () => new Date(),
  };
}

export const processRoleRequest = async (
  item: PendingBirth,
  deps: RoleWorkerDeps,
): Promise<void> => {
  const request = item.roleRequest;
  if (!request) return;

  systemLogger.info("role-request worker: processing", {
    operation: "role_request_worker_start",
    uuid: item.uuid,
    hostId: item.hostIdNum,
    roleName: request.name,
    requested_by: request.requested_by ?? null,
  });

  // The scan already validated the name; re-derive for the slug.
  const nameCheck = validateRoleDisplayName(request.name);
  if (nameCheck.ok === false) {
    await writeFailureFile(item, deps, { reason: "malformed", message: nameCheck.error });
    return;
  }

  // Host owner stands in for the creator (auto-tag on multi-user hosts).
  // Null means the host vanished between scan and drain.
  const ownerUserId = await deps.getHostOwnerUserId(item.hostIdNum);
  if (!ownerUserId) {
    await writeFailureFile(item, deps, {
      reason: "role_create_failed",
      message: "host is no longer registered",
    });
    return;
  }

  const colorHue = deps.randomHue();

  // Avatar first — nothing is written if this fails.
  let avatar: { ext: string; bytes: Buffer };
  try {
    const generated = await deps.generateAvatarImages(
      {
        name: nameCheck.displayName,
        title: nameCheck.displayName,
        brief: request.description,
        colorHue,
      },
      1,
    );
    if (generated.ok === false) {
      systemLogger.warn("role-request worker: avatar generation failed", {
        operation: "role_request_avatar_failed",
        uuid: item.uuid,
        status: generated.status,
        error: generated.error,
      });
      await writeFailureFile(item, deps, { reason: "avatar_failed", message: generated.error });
      return;
    }
    const image = generated.images[0];
    const ext = image ? MIME_TO_AVATAR_EXT[image.mime] : undefined;
    if (!image || !ext) {
      throw new Error(`unexpected avatar output (mime ${image?.mime ?? "none"})`);
    }
    avatar = { ext, bytes: image.bytes };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    systemLogger.warn("role-request worker: avatar generation threw", {
      operation: "role_request_avatar_failed",
      uuid: item.uuid,
      error: message,
    });
    await writeFailureFile(item, deps, { reason: "avatar_failed", message });
    return;
  }

  let users: string[] | undefined;
  if (await deps.isHostMultiUser(item.hostIdNum)) {
    const ownerUsername = await deps.getUsernameForUserId(ownerUserId);
    if (ownerUsername) {
      users = [ownerUsername];
    } else {
      systemLogger.warn("role-request worker: owner username lookup failed — auto-tag skipped", {
        operation: "role_request_username_lookup_failed",
        uuid: item.uuid,
        hostId: item.hostIdNum,
      });
    }
  }

  const input = {
    baseSlug: nameCheck.slug,
    displayName: nameCheck.displayName,
    description: request.description,
    colorHue,
    voice: DEFAULT_ROLE_VOICE,
    users,
    avatar,
  };
  const logCtx = { hostId: item.hostIdNum, source: "role-request" as const };

  let createdName: string | null = null;
  try {
    if (deps.isLocalHostId(item.hostIdNum)) {
      const result = await deps.createRoleOnHost(null, input, logCtx);
      if (result.ok === true) createdName = result.name;
    } else {
      const hostDetails = item.hostConnDetails;
      if (!hostDetails) {
        systemLogger.error("role-request worker: hostConnDetails missing on REMOTE item", {
          operation: "role_request_conn_details_missing",
          uuid: item.uuid,
          hostIdNum: item.hostIdNum,
        });
      } else {
        await getHostSemaphore(item.hostIdNum).run(async () => {
          const conn = await deps.connectOneShot(
            hostDetails as Parameters<typeof connectOneShot>[0],
            SSH_CONNECT_TIMEOUT_MS,
          );
          try {
            const result = await deps.createRoleOnHost(conn, input, logCtx);
            if (result.ok === true) createdName = result.name;
          } finally {
            try {
              conn.end();
            } catch {
              /* best-effort cleanup */
            }
          }
        });
      }
    }
  } catch (err) {
    systemLogger.warn("role-request worker: provisioning threw", {
      operation: "role_request_create_threw",
      uuid: item.uuid,
      hostId: item.hostIdNum,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (createdName === null) {
    await writeFailureFile(item, deps, { reason: "role_create_failed" });
    return;
  }

  const success: RoleSuccessResponse = {
    name: createdName,
    created_at: deps.now().toISOString(),
  };
  systemLogger.info("role-request worker: role created", {
    operation: "role_request_created",
    uuid: item.uuid,
    hostId: item.hostIdNum,
    name: createdName,
  });
  await writeResponseFile(item, deps, "success", JSON.stringify(success, null, 2));
};

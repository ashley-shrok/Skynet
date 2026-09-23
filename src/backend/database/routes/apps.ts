/**
 * Phase 119 Plan 05 (D-06): GET /apps/:hostId/:slug/icon.
 *
 * Serves the raw bytes of ~/fleet/apps/<slug>/icon.webp from the target host,
 * mirroring GET /identities/:identityKey/avatar?hostId=<n> at
 * src/backend/database/routes/identities.ts:849-966. The two deliberate
 * differences from the identity-avatar route are:
 *   1. hostId lives in the URL path (`/apps/:hostId/:slug/icon`), not a query
 *      param — D-06 explicit.
 *   2. The slug validator is APP_SLUG_RE (kebab-case only — no underscores),
 *      not IDENTITY_KEY_RE — shape 1 lock (`create-app.sh` requires kebab-case).
 *
 * Discipline (identity-avatar mirror):
 *   - `authenticateJWT` middleware gates every request → 401 without token.
 *   - APP_SLUG_RE regex-gates slug BEFORE any host resolution or SSH work
 *     (shell-safety guard; T-119-05-01 path-traversal + T-119-05-02 command
 *     injection mitigation). Enforced BOTH here AND inside readAppIconFile
 *     for defence-in-depth.
 *   - hostId parsed as a positive integer → 400 on any other shape.
 *   - `resolveHostById(hostId, userId)` returns null when the user has no
 *     access OR the host is unknown; both branches produce a canned 502 with
 *     the SAME body ("app home box unreachable") — RESEARCH.md §Security V4
 *     "does NOT distinguish not-found from not-authorized" invariant matches
 *     the identity-avatar discipline.
 *   - `connectOneShot(host, 5_000)` — 5s hard timeout, one-shot semantics.
 *     Failures → same canned 502.
 *   - `readAppIconFile(conn, slug)` — LOCAL: fs.readFile; REMOTE: SFTP with an
 *     ls-probe front-check. Returns null on absent (→ 404), bytes+mime on
 *     present, throws on error.
 *   - Response: 200 + Content-Type image/webp + Content-Length + ETag +
 *     Cache-Control: no-store. If-None-Match matching → 304 empty.
 *   - `finally { conn.end() }` — SSH connection is always released on EVERY
 *     exit path (200/304/404/502). Enforced by tests T12/T12b/T12c.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Phase 119 code review HIGH-1 (fix pass 2026-09-18):
 * GET /apps/:hostId/:slug — 302 redirect to the app's serve-URL.
 *
 * The tile's context-menu "Open in new tab" opens `/apps/${hostId}/${slug}`.
 * Prior to this fix that URL had no handler — Skynet's SPA index served the
 * request via HTML content-negotiation fallback, and the fresh tab landed
 * on the app-shell instead of the running app. This route resolves the
 * (hostId, slug) pair to the app's tailscale-hostname + port and issues a
 * 302 to `https://<hostname>-<port>.serve.<request-host>` — the standard
 * serve-URL convention used everywhere else in the codebase (see
 * src/backend/serve-url/subdomain-dispatch.ts, editable-file-whitelist.ts).
 *
 * Serve-URL parent = the incoming request's own Host header, NOT
 * SKYNET_COOKIE_DOMAIN. On multi-parent deployments (e.g. an instance
 * reachable via BOTH ai.example.com AND skynet.example.com) the cookie
 * domain has to be the eTLD+1 umbrella so login cookies span both — but
 * that umbrella isn't a served subdomain, so using it as the parent
 * produced dead URLs. Deriving the parent from the click's origin keeps
 * users on whichever domain they arrived from, both of which are already
 * served by the edge.
 *
 * Discipline mirrors the icon route above:
 *   - authenticateJWT gate (401 without token)
 *   - APP_SLUG_RE gate on slug → 400
 *   - hostId as positive integer → 400
 *   - resolveHostById returns null → 502 (unknown host OR no access; same
 *     info-leak-preserving canned body as the icon route)
 *   - App-port lookup via the fleet-status SubscriptionRegistry's
 *     getAppSnapshot() (see fleet-status/registry-holder.ts for the
 *     module-scope accessor). Not-found → 404 ("app no longer present"),
 *     port null → 404 (never got its port populated by the sweep).
 *   - req.hostname must be non-empty → 500 on the (unreachable in practice,
 *     HTTP/1.1 requires Host) empty case; matches the fail-loud shape the
 *     env-guard used to have.
 *   - No SSH connection opened — this route is DB + in-memory-map only.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import express from "express";
import { createHash } from "crypto";
import type { Request, Response } from "express";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { AuthManager } from "../../utils/auth-manager.js";
import {
  APP_SLUG_RE,
  isLocalHostId,
  readAppIconFile,
} from "../../claude-session/identity-artifact-reader.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { sshLogger } from "../../utils/logger.js";
import { getRegistry } from "../../fleet-status/registry-holder.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

router.get(
  "/:hostId/:slug/icon",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    // Slug validation — APP_SLUG_RE gate (defence-in-depth; readAppIconFile
    // re-validates but a clean 400 here beats a downstream throw-as-500).
    const slug = String(req.params.slug);
    if (!APP_SLUG_RE.test(slug)) {
      return res
        .status(400)
        .json({ error: "slug must match [a-z0-9-]{1,64}" });
    }

    // hostId validation — D-06 puts hostId in the URL path (not query).
    const rawHost = req.params.hostId;
    const hostIdNum = Number(rawHost);
    if (
      !Number.isFinite(hostIdNum) ||
      !Number.isInteger(hostIdNum) ||
      hostIdNum <= 0
    ) {
      return res
        .status(400)
        .json({ error: "hostId must be a positive integer" });
    }

    const local = isLocalHostId(hostIdNum);
    let conn: import("ssh2").Client | null = null;
    if (!local) {
      try {
        const host = await resolveHostById(hostIdNum, userId);
        if (!host) {
          // Code-review MEDIUM-3 (fix pass 2026-09-18): resolveHostById
          // returns null for BOTH "hostId doesn't exist" AND "user has no
          // access". Log so recurring 502s on a specific hostId leave a
          // fingerprint in the logs beyond the entry-level access log.
          // Payload deliberately minimal (no user IDs, no stack traces —
          // matches identity-avatar discipline).
          sshLogger.warn("app icon: host unresolvable / no access", {
            operation: "apps_icon_host_unresolvable",
            hostId: hostIdNum,
            slug,
          });
          return res
            .status(502)
            .json({ error: "app home box unreachable" });
        }
        conn = await connectOneShot(host, 5_000);
      } catch (e) {
        // Code-review MEDIUM-3 (fix pass 2026-09-18): log the underlying
        // SSH failure reason so operators can distinguish DNS-vs-timeout-vs-
        // auth-fail without instrumenting the SSH layer. errMessage only —
        // never the full stack.
        sshLogger.warn("app icon: SSH connect failed", {
          operation: "apps_icon_ssh_connect_error",
          hostId: hostIdNum,
          slug,
          errMessage: e instanceof Error ? e.message : String(e),
        });
        return res
          .status(502)
          .json({ error: "app home box unreachable" });
      }
    }

    try {
      const result = await readAppIconFile(conn, slug);
      if (result === null) {
        return res
          .status(404)
          .json({ error: "no icon on disk for this app" });
      }
      // ETag identifies the current bytes; combined with `no-store` below,
      // the browser can still honour a matching If-None-Match (304) but does
      // not cache the payload — matches the identity-avatar discipline at
      // identities.ts:939-953.
      const etag = `"disk-${createHash("md5").update(result.bytes).digest("hex")}"`;
      const ifNoneMatch = req.headers["if-none-match"];
      if (ifNoneMatch && ifNoneMatch === etag) {
        return res.status(304).end();
      }
      res.setHeader("Content-Type", result.mime);
      res.setHeader("Content-Length", String(result.bytes.byteLength));
      res.setHeader("ETag", etag);
      res.setHeader("Cache-Control", "no-store");
      return res.send(result.bytes);
    } catch (e) {
      // SSH / SFTP / readAppIconFile-level error → 502 with canned body.
      // Never leak raw exception messages into the response.
      //
      // Code-review MEDIUM-3 (fix pass 2026-09-18): emit a structured warn
      // with hostId + slug + errMessage so recurring 502s on a specific
      // (hostId, slug) leave a fingerprint. Prior code returned silently.
      sshLogger.warn("app icon: SFTP / read error", {
        operation: "apps_icon_ssh_error",
        hostId: hostIdNum,
        slug,
        errMessage: e instanceof Error ? e.message : String(e),
      });
      return res
        .status(502)
        .json({ error: "app home box unreachable" });
    } finally {
      if (conn) {
        try {
          conn.end();
        } catch {
          /* ignore */
        }
      }
    }
  },
);

// ---------------------------------------------------------------------------
// Phase 119 code review HIGH-1 (fix pass 2026-09-18):
// GET /apps/:hostId/:slug — 302 redirect to the app's serve-URL.
// See the module-header docblock for the full rationale.
// ---------------------------------------------------------------------------

router.get(
  "/:hostId/:slug",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    // Slug validation — APP_SLUG_RE gate BEFORE any DB / host resolution.
    // Same defence-in-depth discipline as the icon route above.
    const slug = String(req.params.slug);
    if (!APP_SLUG_RE.test(slug)) {
      return res
        .status(400)
        .json({ error: "slug must match [a-z0-9-]{1,64}" });
    }

    // hostId as positive integer — same shape check as the icon route.
    const rawHost = req.params.hostId;
    const hostIdNum = Number(rawHost);
    if (
      !Number.isFinite(hostIdNum) ||
      !Number.isInteger(hostIdNum) ||
      hostIdNum <= 0
    ) {
      return res
        .status(400)
        .json({ error: "hostId must be a positive integer" });
    }

    // Serve-URL parent = the incoming request's own host. On multi-parent
    // deployments the cookie domain has to be the eTLD+1 umbrella (so
    // cookies span every parent) and that umbrella isn't a served
    // subdomain; deriving the parent from the click's origin keeps users
    // on whichever domain they arrived from. req.hostname strips the
    // port from the Host header. Empty is unreachable in practice (HTTP/1.1
    // requires Host) but we fail loud rather than emit a broken URL.
    const requestHost = req.hostname;
    if (!requestHost) {
      sshLogger.warn("app redirect: request Host header missing", {
        operation: "apps_redirect_request_host_missing",
        hostId: hostIdNum,
        slug,
      });
      return res
        .status(500)
        .json({ error: "serve-URL parent domain not configured" });
    }

    // Host resolution — same access gate as the icon route. Returns null
    // for BOTH "unknown host" AND "user has no access"; identical 502 body
    // preserves the info-leak invariant.
    let hostname: string;
    try {
      const host = await resolveHostById(hostIdNum, userId);
      if (!host) {
        sshLogger.warn("app redirect: host unresolvable / no access", {
          operation: "apps_redirect_host_unresolvable",
          hostId: hostIdNum,
          slug,
        });
        return res
          .status(502)
          .json({ error: "app home box unreachable" });
      }
      // Host.name is the tailscale hostname (per src/types/index.ts:32);
      // this is what serve URLs are built off (see subdomain-dispatch.ts
      // + editable-file-whitelist.ts:147). D-13 preserves display case
      // (the LOWER() lookup happens in resolveHostByName, not here).
      hostname = host.name;
    } catch (e) {
      sshLogger.warn("app redirect: host resolve threw", {
        operation: "apps_redirect_host_error",
        hostId: hostIdNum,
        slug,
        errMessage: e instanceof Error ? e.message : String(e),
      });
      return res
        .status(502)
        .json({ error: "app home box unreachable" });
    }

    // App-port lookup — read from the fleet-status registry's in-memory
    // apps map. The registry is populated by the ssh-poll-orchestrator's
    // 2s sweep (see Phase 118); a freshly-created app becomes visible on
    // the next tick. The registry holder is set by starter.ts at boot.
    const registry = getRegistry();
    if (registry === null) {
      // Boot-order guard: the registry-holder is set during starter.ts's
      // boot sequence BEFORE Express begins accepting HTTP traffic, so
      // this branch should never fire at steady state. If it does,
      // something in the boot ordering has regressed — 503 is honest.
      sshLogger.warn("app redirect: registry holder not populated", {
        operation: "apps_redirect_registry_missing",
        hostId: hostIdNum,
        slug,
      });
      return res
        .status(503)
        .json({ error: "app registry not yet available" });
    }
    // AppState.hostId is a STRING on the wire (see wire-protocol.ts +
    // ui/api/fleet-status-types.ts:136). Compare against hostIdNum
    // coerced to a string to match. Slug matches verbatim.
    const hostIdStr = String(hostIdNum);
    const app = registry
      .getAppSnapshot()
      .find((a) => a.hostId === hostIdStr && a.slug === slug);
    if (!app) {
      // The tile was rendered from a stale snapshot OR the app has been
      // removed since the frontend last received a frame OR the app was
      // never observed by the sweep. Any of these produce a genuine
      // "not present" for this route's purposes.
      return res
        .status(404)
        .json({ error: "app no longer present" });
    }
    if (app.port === null || !Number.isFinite(app.port) || app.port <= 0) {
      // Sweep observed the app but the app has no listening port (unhealthy
      // stopped-unit case per Phase 118 D-02, or the app.json didn't declare
      // one). We can't construct a serve URL without a port — 404 with an
      // action-hint body.
      return res
        .status(404)
        .json({ error: "app is not currently serving on a port" });
    }

    // Compose the serve URL: `https://<hostname>-<port>.serve.<request-host>`.
    // See src/ui/features/pretty-view/editable-file-whitelist.ts:147 for
    // the grammar this must match — the D-13 last-dash split works
    // unambiguously because port is all-digits (no dashes possible).
    const target = `https://${hostname}-${app.port}.serve.${requestHost}`;

    // 302 (temporary): the redirect target can change if the app's port
    // rotates or the host is renamed. Semantics match a session-scoped
    // redirect the browser should re-resolve on future clicks.
    return res.redirect(302, target);
  },
);

export default router;

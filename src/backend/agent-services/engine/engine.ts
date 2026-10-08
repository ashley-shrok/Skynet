/**
 * agent-services/engine/engine.ts — turns claimed request files into
 * response files.
 *
 * intake(), per claimed request, at scan time:
 *   envelope parse → service lookup → input schema → attachments → enqueue
 * Any failure there is answered straight away (malformed, unknown_service,
 * queue_full) without queueing.
 *
 * Queued job, per request:
 *   TTL → secrets present → rate limit → handle() → write response
 *
 * Every request gets exactly one response file unless the write itself
 * fails, in which case the agent's helper times out.
 */

import { systemLogger } from "../../utils/logger.js";
import type { HostRequestIo, OutgoingFile, ResponseWriter } from "./host-io.js";
import {
  attachmentFilenameError,
  buildResponse,
  engineFailure,
  outputFilename,
  parseEnvelope,
  responseFilename,
  type ClaimedFile,
  type EngineFailure,
} from "./protocol.js";
import { JobQueue } from "./queue.js";
import { createTokenBucket, type TokenBucket } from "./token-bucket.js";
import type {
  ServiceAttachment,
  ServiceContext,
  ServiceDefinition,
  ServiceResult,
} from "./types.js";

interface RequestHost {
  id: string;
  idNum: number;
}

export interface EngineDeps {
  services: readonly ServiceDefinition[];
  writeResponse: ResponseWriter;
  now?: () => number;
  env?: Record<string, string | undefined>;
  createTokenBucket?: (rpm: number) => TokenBucket;
}

export interface AgentServiceEngine {
  /** Validate and queue every request claimed from one host. Never throws. */
  intake(
    host: RequestHost,
    io: HostRequestIo,
    claimed: ClaimedFile[],
  ): Promise<void>;
  /** Stop starting new jobs. Running handlers finish. */
  stop(): void;
  queueSnapshot(): Record<string, { pending: number; running: number }>;
}

const DEFAULT_MAX_QUEUE_DEPTH = 1000;

interface ServiceRuntime {
  def: ServiceDefinition;
  queue: JobQueue;
  bucket: TokenBucket | null;
}

export function createAgentServiceEngine(deps: EngineDeps): AgentServiceEngine {
  const now = deps.now ?? (() => Date.now());
  const env = deps.env ?? process.env;
  const makeBucket = deps.createTokenBucket ?? createTokenBucket;

  const runtimes = new Map<string, ServiceRuntime>();
  for (const def of deps.services) {
    if (runtimes.has(def.name))
      throw new Error(`duplicate agent service: ${def.name}`);
    const rpm = def.rateLimitPerMinute?.();
    runtimes.set(def.name, {
      def,
      bucket: rpm !== undefined ? makeBucket(Math.max(1, rpm)) : null,
      queue: new JobQueue({
        concurrency: def.concurrency ?? 1,
        maxDepth: def.maxQueueDepth ?? DEFAULT_MAX_QUEUE_DEPTH,
        onJobError: (err) =>
          systemLogger.error("agent-services: job escaped its error handling", {
            operation: "agent_services_job_error",
            service: def.name,
            error: err instanceof Error ? err.message : String(err),
          }),
      }),
    });
  }

  async function respond(
    host: RequestHost,
    uuid: string,
    service: string | null,
    result: ServiceResult | EngineFailure,
  ): Promise<void> {
    const files: OutgoingFile[] = [];
    if (result.ok === true) {
      (result.files ?? []).forEach((f, i) =>
        files.push({
          filename: outputFilename(uuid, i, f.ext),
          bytes: f.bytes,
        }),
      );
    }
    const body = buildResponse(
      service,
      result,
      files.map((f) => f.filename),
    );
    systemLogger.info("agent-services: responding", {
      operation: "agent_services_respond",
      service,
      uuid,
      fleetHostId: host.id,
      ok: result.ok,
      code: result.ok === true ? undefined : result.code,
      files: files.length,
    });
    await deps.writeResponse(
      host.idNum,
      uuid,
      files,
      responseFilename(uuid),
      JSON.stringify(body, null, 2),
    );
  }

  async function runJob(
    rt: ServiceRuntime,
    host: RequestHost,
    uuid: string,
    requestedAt: string,
    input: unknown,
    attachments: Record<string, ServiceAttachment>,
  ): Promise<void> {
    const { def } = rt;

    if (now() > Date.parse(requestedAt) + def.ttlMs) {
      await respond(
        host,
        uuid,
        def.name,
        engineFailure("expired", "request expired before it could run"),
      );
      return;
    }

    const secrets: Record<string, string> = {};
    for (const name of def.secrets ?? []) {
      const value = env[name];
      if (!value) {
        await respond(
          host,
          uuid,
          def.name,
          engineFailure(
            "not_configured",
            `${name} is not set on the Skynet backend`,
          ),
        );
        return;
      }
      secrets[name] = value;
    }

    if (rt.bucket) await rt.bucket.acquire();

    const logContext = { service: def.name, uuid, fleetHostId: host.id };
    const ctx: ServiceContext = {
      requestId: uuid,
      host,
      attachments,
      secrets,
      now,
      log: {
        info: (m, c) =>
          systemLogger.info(`${def.name}: ${m}`, { ...logContext, ...c }),
        warn: (m, c) =>
          systemLogger.warn(`${def.name}: ${m}`, { ...logContext, ...c }),
      },
    };

    let result: ServiceResult;
    try {
      result = await def.handle(input, ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      systemLogger.error("agent-services: handler threw", {
        operation: "agent_services_handler_threw",
        ...logContext,
        error: message,
      });
      result = engineFailure("internal", message);
    }
    await respond(host, uuid, def.name, result);
  }

  async function intakeOne(
    host: RequestHost,
    io: HostRequestIo,
    item: ClaimedFile,
  ): Promise<void> {
    const { uuid } = item;
    const parsed = parseEnvelope(item.body);
    if (parsed.ok === false) {
      await respond(
        host,
        uuid,
        parsed.service ?? null,
        engineFailure("malformed", parsed.message),
      );
      return;
    }
    const { envelope } = parsed;
    const rt = runtimes.get(envelope.service);
    if (!rt) {
      await respond(
        host,
        uuid,
        envelope.service,
        engineFailure(
          "unknown_service",
          `no agent service named "${envelope.service}"`,
        ),
      );
      return;
    }
    const { def } = rt;
    const malformed = (message: string) =>
      respond(host, uuid, def.name, engineFailure("malformed", message));

    const input = def.input.safeParse(envelope.input);
    if (!input.success) {
      const issue = input.error.issues[0];
      const where =
        issue && issue.path.length > 0 ? issue.path.join(".") : "input";
      await malformed(`${where}: ${issue?.message ?? "invalid"}`);
      return;
    }

    const specs = def.attachments ?? {};
    const attachments: Record<string, ServiceAttachment> = {};
    for (const [slot, filename] of Object.entries(envelope.attachments)) {
      const spec = specs[slot];
      if (!spec)
        return void (await malformed(`unexpected attachment: ${slot}`));
      const nameError = attachmentFilenameError(
        uuid,
        slot,
        filename,
        spec.extensions,
      );
      if (nameError) return void (await malformed(nameError));
      const bytes = await io.readAttachment(filename, spec.maxBytes);
      if (bytes === "missing")
        return void (await malformed(`attachment ${slot} is missing or empty`));
      if (bytes === "too_large") {
        return void (await malformed(
          `attachment ${slot} exceeds ${spec.maxBytes} bytes`,
        ));
      }
      attachments[slot] = {
        filename,
        ext: filename.slice(filename.lastIndexOf(".") + 1),
        bytes,
      };
    }
    for (const [slot, spec] of Object.entries(specs)) {
      if (spec.required && !attachments[slot])
        return void (await malformed(`attachment ${slot} is required`));
    }

    const queued = rt.queue.enqueue({
      key: def.serializeBy?.(input.data),
      run: () =>
        runJob(rt, host, uuid, envelope.requested_at, input.data, attachments),
    });
    if (!queued) {
      await respond(
        host,
        uuid,
        def.name,
        engineFailure("queue_full", "queue full, try again later"),
      );
      return;
    }
    systemLogger.info("agent-services: queued", {
      operation: "agent_services_queued",
      service: def.name,
      uuid,
      fleetHostId: host.id,
      attachments: Object.keys(attachments).length,
      ...rt.queue.snapshot(),
    });
  }

  return {
    async intake(host, io, claimed) {
      for (const item of claimed) {
        try {
          await intakeOne(host, io, item);
        } catch (err) {
          systemLogger.error("agent-services: intake threw", {
            operation: "agent_services_intake_threw",
            uuid: item.uuid,
            fleetHostId: host.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
    stop() {
      for (const rt of runtimes.values()) rt.queue.stop();
    },
    queueSnapshot() {
      const out: Record<string, { pending: number; running: number }> = {};
      for (const [name, rt] of runtimes) out[name] = rt.queue.snapshot();
      return out;
    },
  };
}

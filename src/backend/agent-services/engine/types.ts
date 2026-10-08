/**
 * agent-services/engine/types.ts — the contract a service module implements.
 *
 * An agent service is something an agent on a managed host can ask the
 * backend to do on its behalf, using credentials only the backend holds
 * (place a phone call, generate an image, ...). The engine owns everything
 * about getting the request off the host and the answer back on: claiming
 * request files, validating input, queueing, rate limiting, TTLs, and the
 * atomic response write. A service only declares what it accepts and
 * implements `handle()`.
 *
 * See ../README.md for the wire protocol and a walkthrough of adding one.
 */

import type { z } from "zod";

/** A file the agent sent alongside the request (e.g. a reference image). */
export interface ServiceAttachment {
  /** Wire filename on the host: `<uuid>.in.<name>.<ext>`. */
  filename: string;
  /** Lower-case extension, without the dot. */
  ext: string;
  bytes: Buffer;
}

/** Limits for one named attachment slot a service accepts. */
export interface AttachmentSpec {
  /** Allowed lower-case extensions, without the dot. */
  extensions: readonly string[];
  /** Largest accepted file. Larger files fail the request as `malformed`. */
  maxBytes: number;
  required?: boolean;
}

/** A file the service hands back to the agent (e.g. a generated image). */
export interface ServiceOutputFile {
  /** Lower-case extension, without the dot. */
  ext: string;
  bytes: Buffer;
}

export interface ServiceLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
}

/** Everything a handler gets besides its validated input. */
export interface ServiceContext {
  /** Request uuid (from the request filename). */
  requestId: string;
  /** The host the request came from. Use it for per-host permission checks. */
  host: { id: string; idNum: number };
  /** Attachments, keyed by the slot name declared in `attachments`. */
  attachments: Record<string, ServiceAttachment>;
  /** Values of the env vars named in `secrets`, all guaranteed non-empty. */
  secrets: Record<string, string>;
  log: ServiceLogger;
  now(): number;
}

export type ServiceResult<R = unknown> =
  | { ok: true; result: R; files?: ServiceOutputFile[] }
  | {
      ok: false;
      /** Machine-readable failure code, snake_case. */
      code: string;
      message?: string;
      /** Extra fields merged into the error object the agent sees. */
      details?: Record<string, unknown>;
    };

export interface ServiceDefinition<
  S extends z.ZodType = z.ZodType,
  R = unknown,
> {
  /** Service name agents put in the request envelope. kebab-case. */
  name: string;
  /** One line for logs and docs. */
  description: string;
  /**
   * Input schema. Use `z.strictObject(...)` so a mistyped field fails as
   * `malformed` instead of being silently ignored.
   */
  input: S;
  /** Named attachment slots. Requests naming any other slot are `malformed`. */
  attachments?: Record<string, AttachmentSpec>;
  /**
   * Env vars the handler needs. If any is unset the engine answers
   * `not_configured` without calling the handler.
   */
  secrets?: readonly string[];
  /**
   * How long a request stays worth answering, measured from the envelope's
   * `requested_at`. Requests dequeued after this get `expired`. Keep it at or
   * under the host-side helper's own timeout so the backend never does work
   * for a caller that has already given up.
   */
  ttlMs: number;
  /** Max requests running at once for this service. Default 1. */
  concurrency?: number;
  /**
   * Optional serialization key. Requests with the same key never run at the
   * same time (e.g. one phone call per recipient), independent of
   * `concurrency`.
   */
  serializeBy?: (input: z.output<S>) => string;
  /** Fleet-wide requests-per-minute cap, read once at engine start. */
  rateLimitPerMinute?: () => number;
  /** Pending-queue cap. Requests past it get `queue_full`. Default 1000. */
  maxQueueDepth?: number;
  handle(input: z.output<S>, ctx: ServiceContext): Promise<ServiceResult<R>>;
}

/**
 * Identity helper that gives `handle()` its input type from the schema.
 * Every service module default-exports `defineService({...})`.
 */
export function defineService<S extends z.ZodType, R>(
  def: ServiceDefinition<S, R>,
): ServiceDefinition<S, R> {
  return def;
}

/** Successful result, optionally with output files. */
export function ok<R>(
  result: R,
  files?: ServiceOutputFile[],
): ServiceResult<R> {
  return files && files.length > 0
    ? { ok: true, result, files }
    : { ok: true, result };
}

/** Failed result. `details` fields are merged into the agent-visible error. */
export function fail(
  code: string,
  message?: string,
  details?: Record<string, unknown>,
): ServiceResult<never> {
  const r: ServiceResult<never> = { ok: false, code };
  if (message !== undefined) r.message = message;
  if (details !== undefined) r.details = details;
  return r;
}

/** Failure codes the engine itself produces, for any service. */
export type EngineErrorCode =
  | "malformed"
  | "unknown_service"
  | "expired"
  | "queue_full"
  | "not_configured"
  | "internal";

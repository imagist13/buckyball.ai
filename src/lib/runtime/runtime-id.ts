/**
 * Runtime identifier — the canonical machine label for any Agent
 * Runtime registered with CodePilot.
 *
 * Slice A of Phase 0.5 (Runtime Contract Hardening, 2026-05-13) — this
 * The ID set is derived from `runtime-catalog.ts`, which also carries the
 * packaged driver and user-facing descriptor. The database/HTTP wire values
 * remain backward compatible, but validation now goes through the explicit
 * registry rather than an independent hand-written whitelist.
 *
 *   - `RuntimeSessionRef.runtimeId` (adapter-owned session metadata)
 *   - `RuntimeRunEvent` / `RuntimePermissionEvent` (internal event union)
 *   - `ModelRuntimeCompat.supportedRuntimes` (model compat matrix)
 *   - `ChatRuntime` (legacy alias for backward compat — same values)
 *
 */

import {
  BUILTIN_RUNTIME_REGISTRATIONS,
  getRuntimeRegistration,
  requireRuntimeRegistration,
  type RegisteredRuntimeId,
} from './runtime-catalog';

export const RUNTIME_IDS: readonly RegisteredRuntimeId[] =
  BUILTIN_RUNTIME_REGISTRATIONS.map((registration) => registration.id);

export type RuntimeId = RegisteredRuntimeId;

export function isRuntimeId(v: unknown): v is RuntimeId {
  return !!getRuntimeRegistration(v);
}

/** Validate a persisted/HTTP value and return its registered wire ID. */
export function parseRuntimeId(v: unknown): RuntimeId {
  return requireRuntimeRegistration(v).id;
}

/** Validate before persisting so unknown IDs never enter a session row. */
export function serializeRuntimeId(v: RuntimeId): string {
  return requireRuntimeRegistration(v).id;
}

/**
 * Wire form for HTTP query params — adds 'auto' (server resolves).
 * Kept here so transport code can validate inputs against a single
 * source of truth.
 */
export type RuntimeIdParam = RuntimeId | 'auto';

export function isRuntimeIdParam(v: unknown): v is RuntimeIdParam {
  return v === 'auto' || isRuntimeId(v);
}

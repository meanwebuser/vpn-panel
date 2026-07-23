import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ServiceCatalogActivationState {
  schemaVersion: 1;
  activeRevision: string | null;
  activeBundleSha256: string | null;
  previousRevision: string | null;
  previousBundleSha256: string | null;
  lastAttempt?: {
    desiredRevision: string;
    applyId: string;
    status: "applying" | "succeeded" | "rolled-back" | "rejected";
    startedAt: string;
    finishedAt?: string;
    error?: string;
  };
}

export class ServiceCatalogApplyInProgressError extends Error {
  constructor(statePath: string) {
    super(`service catalog apply already in progress: ${statePath}`);
    this.name = "ServiceCatalogApplyInProgressError";
  }
}

const STATE_FIELDS = [
  "schemaVersion",
  "activeRevision",
  "activeBundleSha256",
  "previousRevision",
  "previousBundleSha256",
] as const;
type LastAttemptStatus = "applying" | "succeeded" | "rolled-back" | "rejected";

/** Return the configured durable activation-state path. */
export function serviceCatalogActivationStatePath(): string {
  return process.env.VPN_PANEL_SERVICE_CATALOG_ACTIVATION_STATE
    || path.join(process.cwd(), "data", "service-catalog-activation-state.json");
}

/** Load activation state, treating only a missing file as an empty state. */
export async function loadServiceCatalogActivationState(filePath = serviceCatalogActivationStatePath()): Promise<ServiceCatalogActivationState> {
  try {
    const raw = await readFile(filePath, "utf8");
    return validateServiceCatalogActivationState(JSON.parse(raw) as unknown);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return emptyState();
    throw error;
  }
}

/** Validate and atomically persist activation state without mutating its input. */
export async function saveServiceCatalogActivationState(state: ServiceCatalogActivationState, filePath = serviceCatalogActivationStatePath()): Promise<void> {
  const validated = validateServiceCatalogActivationState(state);
  const saved: ServiceCatalogActivationState = {
    ...validated,
    ...(validated.lastAttempt ? { lastAttempt: { ...validated.lastAttempt } } : {}),
  };
  const canonicalPath = path.resolve(filePath);
  const parentDirectory = path.dirname(canonicalPath);
  const temporaryPath = `${canonicalPath}.tmp-${process.pid}-${randomUUID()}`;

  await mkdir(parentDirectory, { recursive: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(saved, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporaryPath, canonicalPath);
  } catch (error: unknown) {
    try {
      await unlink(temporaryPath);
    } catch {
      // The temporary file may have been renamed or never created.
    }
    throw error;
  }
}

/** Run one apply operation while holding an exclusive filesystem lock. */
export async function withServiceCatalogApplyLock<T>(statePath: string, operation: () => Promise<T>): Promise<T> {
  const canonicalStatePath = path.resolve(statePath);
  const lockPath = `${canonicalStatePath}.apply.lock`;
  await mkdir(path.dirname(canonicalStatePath), { recursive: true });

  let lockHandle;
  try {
    lockHandle = await open(lockPath, "wx", 0o600);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "EEXIST") {
      throw new ServiceCatalogApplyInProgressError(canonicalStatePath);
    }
    throw error;
  }

  await lockHandle.close();
  try {
    return await operation();
  } finally {
    await unlink(lockPath);
  }
}

function emptyState(): ServiceCatalogActivationState {
  return {
    schemaVersion: 1,
    activeRevision: null,
    activeBundleSha256: null,
    previousRevision: null,
    previousBundleSha256: null,
  };
}

function validateServiceCatalogActivationState(value: unknown): ServiceCatalogActivationState {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("activation state must be an object");
  const state = value as Record<string, unknown>;
  const keys = Object.keys(state).sort();
  const expected = [...STATE_FIELDS, "lastAttempt"].sort();
  const expectedWithoutAttempt = [...STATE_FIELDS].sort();
  if (!(keys.length === expectedWithoutAttempt.length && keys.every((key, index) => key === expectedWithoutAttempt[index]))
    && !(keys.length === expected.length && keys.every((key, index) => key === expected[index]))) {
    throw new Error("activation state contains unexpected fields");
  }
  if (state.schemaVersion !== 1) throw new Error("unsupported activation state schemaVersion");
  assertNullableString(state.activeRevision, "activeRevision");
  assertNullableString(state.activeBundleSha256, "activeBundleSha256");
  assertNullableString(state.previousRevision, "previousRevision");
  assertNullableString(state.previousBundleSha256, "previousBundleSha256");

  if (state.lastAttempt !== undefined) {
    if (!state.lastAttempt || typeof state.lastAttempt !== "object" || Array.isArray(state.lastAttempt)) {
      throw new Error("lastAttempt must be an object");
    }
    const attempt = state.lastAttempt as Record<string, unknown>;
    const attemptKeys = Object.keys(attempt).sort();
    const required = ["applyId", "desiredRevision", "startedAt", "status"].sort();
    const allowed = [...required, "error", "finishedAt"].sort();
    if (attemptKeys.some((key) => !allowed.includes(key)) || required.some((key) => !attemptKeys.includes(key))) {
      throw new Error("lastAttempt contains invalid fields");
    }
    assertNonEmptyString(attempt.desiredRevision, "lastAttempt.desiredRevision");
    assertNonEmptyString(attempt.applyId, "lastAttempt.applyId");
    assertNonEmptyString(attempt.startedAt, "lastAttempt.startedAt");
    if (attempt.status !== "applying" && attempt.status !== "succeeded" && attempt.status !== "rolled-back" && attempt.status !== "rejected") {
      throw new Error("lastAttempt.status is invalid");
    }
    if (attempt.finishedAt !== undefined) assertNonEmptyString(attempt.finishedAt, "lastAttempt.finishedAt");
    if (attempt.error !== undefined) assertNonEmptyString(attempt.error, "lastAttempt.error");
  }

  return {
    schemaVersion: 1,
    activeRevision: state.activeRevision as string | null,
    activeBundleSha256: state.activeBundleSha256 as string | null,
    previousRevision: state.previousRevision as string | null,
    previousBundleSha256: state.previousBundleSha256 as string | null,
    ...(state.lastAttempt ? {
      lastAttempt: {
        desiredRevision: (state.lastAttempt as Record<string, unknown>).desiredRevision as string,
        applyId: (state.lastAttempt as Record<string, unknown>).applyId as string,
        status: (state.lastAttempt as Record<string, unknown>).status as LastAttemptStatus,
        startedAt: (state.lastAttempt as Record<string, unknown>).startedAt as string,
        ...((state.lastAttempt as Record<string, unknown>).finishedAt !== undefined ? { finishedAt: (state.lastAttempt as Record<string, unknown>).finishedAt as string } : {}),
        ...((state.lastAttempt as Record<string, unknown>).error !== undefined ? { error: (state.lastAttempt as Record<string, unknown>).error as string } : {}),
      },
    } : {}),
  };
}

function assertNullableString(value: unknown, field: string): asserts value is string | null {
  if (value !== null && (typeof value !== "string" || value.length === 0)) throw new Error(`${field} must be a non-empty string or null`);
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${field} must be a non-empty string`);
}

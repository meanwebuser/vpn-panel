import assert from "node:assert/strict";
import { access, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ServiceCatalogApplyInProgressError,
  loadServiceCatalogActivationState,
  saveServiceCatalogActivationState,
  serviceCatalogActivationStatePath,
  withServiceCatalogApplyLock,
  type ServiceCatalogActivationState,
} from "../src/service-catalog-activation-state.js";

function emptyState(): ServiceCatalogActivationState {
  return {
    schemaVersion: 1,
    activeRevision: null,
    activeBundleSha256: null,
    previousRevision: null,
    previousBundleSha256: null,
  };
}

test("missing state loads as an empty valid state", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "service-catalog-activation-state-"));
  assert.deepEqual(await loadServiceCatalogActivationState(path.join(directory, "missing.json")), emptyState());
});

test("save/load is atomic and does not mutate the input", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "service-catalog-activation-state-"));
  const filePath = path.join(directory, "state.json");
  const state: ServiceCatalogActivationState = {
    ...emptyState(),
    activeRevision: "2026-07-20T10:00:00.000Z",
    activeBundleSha256: "a".repeat(64),
    lastAttempt: {
      desiredRevision: "2026-07-20T10:00:00.000Z",
      applyId: "apply-1",
      status: "succeeded",
      startedAt: "2026-07-20T10:00:00.000Z",
      finishedAt: "2026-07-20T10:01:00.000Z",
    },
  };
  const original = structuredClone(state);

  await saveServiceCatalogActivationState(state, filePath);

  assert.deepEqual(state, original);
  assert.deepEqual(await loadServiceCatalogActivationState(filePath), original);
  assert.equal((await stat(filePath)).mode & 0o777, 0o600);
  assert.equal((await readFile(filePath, "utf8")).endsWith("\n"), true);
});

test("malformed state is rejected", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "service-catalog-activation-state-"));
  const filePath = path.join(directory, "state.json");
  await writeFile(filePath, JSON.stringify({ ...emptyState(), activeRevision: 42 }), "utf8");
  await assert.rejects(loadServiceCatalogActivationState(filePath));

  await writeFile(filePath, "{not-json", "utf8");
  await assert.rejects(loadServiceCatalogActivationState(filePath));
});

test("apply lock rejects concurrent work and cleans up after failure", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "service-catalog-activation-state-"));
  const statePath = path.join(directory, "state.json");
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const first = withServiceCatalogApplyLock(statePath, async () => {
    await held;
    throw new Error("apply failed");
  });

  const concurrentAttempt = withServiceCatalogApplyLock(statePath, async () => "unreachable");
  const concurrentAttemptAssertion = assert.rejects(
    concurrentAttempt,
    (error: unknown) => error instanceof ServiceCatalogApplyInProgressError,
  );
  await concurrentAttemptAssertion;
  release();
  await assert.rejects(first, /apply failed/);
  await assert.rejects(access(`${statePath}.apply.lock`));

  assert.equal(await withServiceCatalogApplyLock(statePath, async () => "retry"), "retry");
});

test("default path uses VPN_PANEL_SERVICE_CATALOG_ACTIVATION_STATE", () => {
  const previous = process.env.VPN_PANEL_SERVICE_CATALOG_ACTIVATION_STATE;
  const configuredPath = path.join(os.tmpdir(), "configured-service-catalog-activation-state.json");
  process.env.VPN_PANEL_SERVICE_CATALOG_ACTIVATION_STATE = configuredPath;
  try {
    assert.equal(serviceCatalogActivationStatePath(), configuredPath);
  } finally {
    if (previous === undefined) delete process.env.VPN_PANEL_SERVICE_CATALOG_ACTIVATION_STATE;
    else process.env.VPN_PANEL_SERVICE_CATALOG_ACTIVATION_STATE = previous;
  }
});

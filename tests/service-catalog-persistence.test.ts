import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadServiceCatalog, saveServiceCatalog, ServiceCatalogRevisionConflictError, serviceCatalogPath, validateServiceCatalog, type ServiceCatalog } from "../src/service-catalog.js";

function fixture(updatedAt = "2020-01-01T00:00:00.000Z"): ServiceCatalog {
  return validateServiceCatalog({
    schemaVersion: 2,
    updatedAt,
    description: "Persistence test catalog",
    services: [{
      id: "example-service",
      label: "Example",
      domains: [{ match: "exact", value: "example.com" }],
      workIn: "both",
      routeTo: { kind: "direct" },
    }],
  });
}

test("save/load round trip refreshes updatedAt without mutating the input", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "service-catalog-"));
  const filePath = path.join(directory, "catalog.json");
  const catalog = fixture();
  const original = structuredClone(catalog);

  const saved = await saveServiceCatalog(catalog, filePath);
  const loaded = await loadServiceCatalog(filePath);

  assert.deepEqual(catalog, original);
  assert.notEqual(saved.updatedAt, original.updatedAt);
  assert.equal(Date.parse(saved.updatedAt), Date.parse(loaded.updatedAt));
  assert.deepEqual(loaded.services, original.services);
});

test("default path uses VPN_PANEL_SERVICE_CATALOG", async () => {
  const previous = process.env.VPN_PANEL_SERVICE_CATALOG;
  const configuredPath = path.join(os.tmpdir(), "configured-service-catalog.json");
  process.env.VPN_PANEL_SERVICE_CATALOG = configuredPath;
  try {
    assert.equal(serviceCatalogPath(), configuredPath);
  } finally {
    if (previous === undefined) delete process.env.VPN_PANEL_SERVICE_CATALOG;
    else process.env.VPN_PANEL_SERVICE_CATALOG = previous;
  }
});

test("malformed JSON is rejected", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "service-catalog-"));
  const filePath = path.join(directory, "catalog.json");
  await writeFile(filePath, "{not-json", "utf8");
  await assert.rejects(loadServiceCatalog(filePath));
});

test("validation failure leaves an existing file unchanged", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "service-catalog-"));
  const filePath = path.join(directory, "catalog.json");
  await saveServiceCatalog(fixture(), filePath);
  const before = await readFile(filePath);
  const invalid = { ...fixture(), schemaVersion: 1 } as unknown as ServiceCatalog;

  await assert.rejects(saveServiceCatalog(invalid, filePath));
  assert.deepEqual(await readFile(filePath), before);
});

test("successful save leaves no temporary files", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "service-catalog-"));
  const filePath = path.join(directory, "catalog.json");
  await saveServiceCatalog(fixture(), filePath);
  assert.deepEqual((await readdir(directory)).filter((name) => name.includes(".tmp-")), []);
});

test("conditional saves serialize and reject the stale concurrent writer", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "service-catalog-"));
  const filePath = path.join(directory, "catalog.json");
  const initial = await saveServiceCatalog(fixture(), filePath);
  const expectedRevision = initial.updatedAt;
  const left = { ...initial, description: "left winner" };
  const right = { ...initial, description: "right loser" };

  const results = await Promise.allSettled([
    saveServiceCatalog(left, filePath, { expectedRevision }),
    saveServiceCatalog(right, filePath, { expectedRevision }),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  assert.ok(rejected);
  assert.ok(rejected.reason instanceof ServiceCatalogRevisionConflictError);
  const final = await loadServiceCatalog(filePath);
  assert.ok(final.description === "left winner" || final.description === "right loser");
});

test("conditional save rejects when the expected source is missing", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "service-catalog-"));
  const filePath = path.join(directory, "missing.json");
  await assert.rejects(
    saveServiceCatalog(fixture(), filePath, { expectedRevision: fixture().updatedAt }),
    (error: unknown) => error instanceof ServiceCatalogRevisionConflictError,
  );
});

test("legacy first-save exception still rejects a concurrent second writer", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "service-catalog-"));
  const filePath = path.join(directory, "legacy-first.json");
  const legacy = fixture("2020-01-02T00:00:00.000Z");
  const results = await Promise.allSettled([
    saveServiceCatalog({ ...legacy, description: "first" }, filePath, { expectedRevision: legacy.updatedAt, allowMissingExpectedRevision: true }),
    saveServiceCatalog({ ...legacy, description: "second" }, filePath, { expectedRevision: legacy.updatedAt, allowMissingExpectedRevision: true }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" && result.reason instanceof ServiceCatalogRevisionConflictError).length, 1);
});

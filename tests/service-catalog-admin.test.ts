import test from "node:test";
import assert from "node:assert/strict";
import { serviceCatalogFromForm } from "../src/server.js";
import type { ServiceCatalog } from "../src/service-catalog.js";

const catalog: ServiceCatalog = {
  schemaVersion: 2,
  updatedAt: "2024-01-01T00:00:00Z",
  description: "draft",
  services: [
    {
      id: "telegram",
      label: "Telegram",
      enabled: true,
      domains: [{ match: "suffix", value: "telegram.org" }],
      workIn: "both",
      routeTo: { kind: "vps-pool", allowedVpsIds: ["vpn2"], onNoHealthyTarget: "direct" },
    },
  ],
};

test("serviceCatalogFromForm normalizes checkboxes and preserves pool fallback", () => {
  const updated = serviceCatalogFromForm(catalog, {
    serviceId: "telegram",
    enabled: "on",
    workInLan: "on",
    workInExternal: "on",
    routeKind: "vps-pool",
    allowedVpsIds: ["vusa", "vpn2"],
  });
  const service = updated.services[0];
  assert.equal(service.workIn, "both");
  assert.deepEqual(service.routeTo, { kind: "vps-pool", allowedVpsIds: ["vusa", "vpn2"], onNoHealthyTarget: "direct" });
  assert.equal(service.enabled, true);
});

test("serviceCatalogFromForm direct routes discard submitted pool IDs", () => {
  const updated = serviceCatalogFromForm(catalog, {
    serviceId: "telegram",
    workInLan: "on",
    routeKind: "direct",
    allowedVpsIds: ["vusa"],
  });
  assert.equal(updated.services[0].workIn, "lan-only");
  assert.deepEqual(updated.services[0].routeTo, { kind: "direct" });
  assert.equal(updated.services[0].enabled, false);
});

test("serviceCatalogFromForm rejects an empty WorkIn selection", () => {
  assert.throws(() => serviceCatalogFromForm(catalog, {
    serviceId: "telegram",
    routeKind: "direct",
  }), /at least one WorkIn scope/);
});

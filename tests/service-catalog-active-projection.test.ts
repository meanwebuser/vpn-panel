import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  activeServiceCatalogProjectionPath,
  loadActiveServiceCatalogProjection,
  saveActiveServiceCatalogProjection,
} from "../src/service-catalog-active-projection.js";
import { lowerActivationReadyCatalog } from "../src/service-catalog-activation.js";
import { compileServiceCatalog } from "../src/service-catalog-compiler.js";
import { renderCatalogSmartDnsPolicy } from "../src/service-catalog-policy-render.js";
import type { ServiceRoutingProjection } from "../src/service-catalog-activation.js";
import type { SmartDnsPolicy } from "../src/smart-dns-policy.js";

function projection(): ServiceRoutingProjection {
  return {
    schemaVersion: 1,
    sourceCatalogRevision: "catalog-1",
    activePublicDnsEdgeId: "vusa",
    domains: [{
      serviceId: "chatgpt",
      match: "suffix",
      domain: "chatgpt.com",
      lan: { kind: "proxy", targetId: "vpn2", balancerTag: "proxy" },
      external: { kind: "proxy", targetId: "vpn2", profileId: "public" },
    }],
  };
}

test("active projection rejects an external proxy without a DNS profile", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "service-catalog-active-projection-"));
  const filePath = path.join(directory, "missing-profile.json");
  const invalid = projection() as unknown as {
    domains: Array<{ external?: { kind: string; targetId: string; profileId?: string } }>;
  };
  delete invalid.domains[0]?.external?.profileId;

  await assert.rejects(
    saveActiveServiceCatalogProjection(invalid as ServiceRoutingProjection, filePath),
    /unsupported proxy profile undefined/,
  );
});

test("active projection rejects a duplicate domain owned by another service", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "service-catalog-active-projection-"));
  const filePath = path.join(directory, "duplicate-domain.json");
  const duplicate = projection();
  duplicate.domains.push({
    serviceId: "another-service",
    match: "suffix",
    domain: "chatgpt.com",
    lan: { kind: "proxy", targetId: "vpn2", balancerTag: "proxy" },
    external: { kind: "proxy", targetId: "vpn2", profileId: "public" },
  });

  await assert.rejects(
    saveActiveServiceCatalogProjection(duplicate, filePath),
    /duplicate projected domain/,
  );
});

const basePolicy: SmartDnsPolicy = {
  defaultRoute: "proxy",
  localDefaultRoute: "direct",
  directSuffixes: [],
  directDomains: [],
  proxySuffixes: [],
  proxyDomains: [],
  localProxySuffixes: [],
  localProxyDomains: [],
  vusaProxySuffixes: [],
  vusaProxyDomains: [],
  updatedAt: "2026-07-19T00:00:00.000Z",
};

test("missing active projection loads as null", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "service-catalog-active-projection-"));
  assert.equal(await loadActiveServiceCatalogProjection(path.join(directory, "missing.json")), null);
});

test("save/load is strict, atomic, mode 0600, and does not mutate input", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "service-catalog-active-projection-"));
  const filePath = path.join(directory, "nested", "projection.json");
  const input = projection();
  const before = structuredClone(input);

  await saveActiveServiceCatalogProjection(input, filePath);
  assert.deepEqual(input, before);
  assert.deepEqual(await loadActiveServiceCatalogProjection(filePath), before);
  assert.equal((await stat(filePath)).mode & 0o777, 0o600);
  assert.deepEqual((await stat(filePath)).isFile(), true);
  assert.deepEqual((await readFile(filePath, "utf8")).endsWith("\n"), true);
});

test("configured default path is selected", () => {
  const previous = process.env.VPN_PANEL_SERVICE_CATALOG_ACTIVE_PROJECTION;
  const configured = path.join(os.tmpdir(), "active-projection.json");
  process.env.VPN_PANEL_SERVICE_CATALOG_ACTIVE_PROJECTION = configured;
  try {
    assert.equal(activeServiceCatalogProjectionPath(), configured);
  } finally {
    if (previous === undefined) delete process.env.VPN_PANEL_SERVICE_CATALOG_ACTIVE_PROJECTION;
    else process.env.VPN_PANEL_SERVICE_CATALOG_ACTIVE_PROJECTION = previous;
  }
});

test("malformed JSON and deferred/unrepresentable projections are rejected", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "service-catalog-active-projection-"));
  const malformedPath = path.join(directory, "malformed.json");
  await writeFile(malformedPath, "{not-json", "utf8");
  await assert.rejects(loadActiveServiceCatalogProjection(malformedPath));

  await assert.rejects(saveActiveServiceCatalogProjection({
    ...projection(),
    domains: [{
      serviceId: "deferred",
      match: "suffix",
      domain: "deferred.example.com",
      external: { kind: "proxy", targetId: "vpn2", profileId: "public" },
    }],
  }, path.join(directory, "deferred.json")), /external-only proxy/);

  await assert.rejects(saveActiveServiceCatalogProjection({
    ...projection(),
    domains: [{
      serviceId: "bad",
      match: "exact",
      domain: "bad.example.com",
      lan: { kind: "proxy", targetId: "vpn2", balancerTag: "proxy" },
    }],
  }, path.join(directory, "exact-lan.json")), /exact LAN proxy/);
});

test("active public DNS edge ID is required when saving and loading", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "service-catalog-active-projection-"));
  const savePath = path.join(directory, "null-save.json");
  await assert.rejects(saveActiveServiceCatalogProjection({
    ...projection(),
    activePublicDnsEdgeId: null,
  } as never, savePath), /activePublicDnsEdgeId must be a canonical non-empty string/);

  const loadPath = path.join(directory, "null-load.json");
  await writeFile(loadPath, JSON.stringify({
    ...projection(),
    activePublicDnsEdgeId: null,
  }), "utf8");
  await assert.rejects(loadActiveServiceCatalogProjection(loadPath), /activePublicDnsEdgeId must be a canonical non-empty string/);
});

test("save rejects malformed shape and leaves an existing artifact unchanged", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "service-catalog-active-projection-"));
  const filePath = path.join(directory, "projection.json");
  await saveActiveServiceCatalogProjection(projection(), filePath);
  const before = await readFile(filePath);
  await assert.rejects(saveActiveServiceCatalogProjection({ ...projection(), schemaVersion: 2 } as never, filePath));
  assert.deepEqual(await readFile(filePath), before);
  await chmod(filePath, 0o600);
});

test("preserves an explicit VUSA external profile through save/load", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "service-catalog-active-projection-"));
  const filePath = path.join(directory, "vusa.json");
  const input = projection();
  input.domains[0]!.external = { kind: "proxy", targetId: "vpn2", profileId: "vusa" };

  await saveActiveServiceCatalogProjection(input, filePath);
  assert.deepEqual(await loadActiveServiceCatalogProjection(filePath), input);
});

test("rejects profile IDs on direct and LAN routes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "service-catalog-active-projection-"));
  await assert.rejects(saveActiveServiceCatalogProjection({
    ...projection(),
    domains: [{
      serviceId: "lan-profile",
      match: "suffix",
      domain: "lan-profile.example.com",
      lan: { kind: "proxy", targetId: "vpn2", balancerTag: "proxy", profileId: "vusa" },
    }],
  } as never, path.join(directory, "lan-profile.json")), /unexpected or missing fields/);
  await assert.rejects(saveActiveServiceCatalogProjection({
    ...projection(),
    domains: [{
      serviceId: "direct-profile",
      match: "exact",
      domain: "direct-profile.example.com",
      external: { kind: "direct", profileId: "vusa" },
    }],
  } as never, path.join(directory, "direct-profile.json")), /unexpected or missing fields/);
  await assert.rejects(saveActiveServiceCatalogProjection({
    ...projection(),
    domains: [{
      serviceId: "unknown-profile",
      match: "suffix",
      domain: "unknown-profile.example.com",
      lan: { kind: "proxy", targetId: "vpn2", balancerTag: "proxy" },
      external: { kind: "proxy", targetId: "vpn2", profileId: "other" as never },
    }],
  } as never, path.join(directory, "unknown-profile.json")), /unsupported proxy profile/);
});

test("lower/save/load/render keeps a VUSA both-scope route on vusaProxy lists", async () => {
  const compiled = compileServiceCatalog({
    schemaVersion: 2,
    updatedAt: "2026-07-19T00:00:00.000Z",
    description: "VUSA projection regression",
    services: [{
      id: "antigravity",
      label: "Antigravity",
      domains: [{ match: "suffix", value: "antigravity.google" }],
      workIn: "both",
      routeTo: { kind: "vps-pool", allowedVpsIds: ["vusa"], onNoHealthyTarget: "servfail" },
    }],
  }, {
    targets: [
      { id: "vpn2", publicDnsEdge: true, lanEgress: true, lanBalancerTag: "proxy" },
      { id: "vusa", publicDnsEdge: true, lanEgress: true, lanBalancerTag: "us-auto", dedicatedPublicDnsProfile: "vusa" },
    ],
    activePublicDnsEdgeId: "vpn2",
  });
  const lowered = lowerActivationReadyCatalog(compiled);
  const directory = await mkdtemp(path.join(os.tmpdir(), "service-catalog-active-projection-"));
  const filePath = path.join(directory, "vusa.json");
  await saveActiveServiceCatalogProjection(lowered, filePath);
  const loaded = await loadActiveServiceCatalogProjection(filePath);
  assert.ok(loaded);

  const rendered = renderCatalogSmartDnsPolicy(basePolicy, null, loaded);
  assert.deepEqual(rendered.vusaProxySuffixes, ["antigravity.google"]);
  assert.deepEqual(rendered.proxySuffixes, []);
});

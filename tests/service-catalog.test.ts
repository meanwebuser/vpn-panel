import assert from "node:assert/strict";
import test from "node:test";

import { compileLegacyServiceCatalog, normalizeServiceWorkIn, resolveServiceRoute, validateServiceCatalog, validateServiceTargetCapabilities } from "../src/service-catalog.js";
import { loadRestrictedServicesCatalog } from "../src/restricted-services.js";

const targets = [
  { id: "vpn2", publicDnsEdge: true, lanEgress: true, lanBalancerTag: "proxy" },
  { id: "vusa", publicDnsEdge: true, lanEgress: true, lanBalancerTag: "us-auto" },
];

test("normalizes independent LAN and external WorkIn checkboxes", () => {
  assert.equal(normalizeServiceWorkIn({ lan: true, external: false }), "lan-only");
  assert.equal(normalizeServiceWorkIn({ lan: false, external: true }), "external");
  assert.equal(normalizeServiceWorkIn({ lan: true, external: true }), "both");
  assert.throws(() => normalizeServiceWorkIn({ lan: false, external: false }), /at least one WorkIn scope is required/);
});

test("service route validation rejects stale or unknown discriminated-union fields", () => {
  const base = {
    schemaVersion: 2 as const,
    updatedAt: "2026-07-19",
    description: "Strict route shapes",
    services: [{
      id: "shape-service",
      label: "Shape service",
      domains: [{ match: "exact" as const, value: "shape.example.com" }],
      workIn: "both" as const,
    }],
  };

  assert.throws(() => validateServiceCatalog({
    ...base,
    services: [{ ...base.services[0], routeTo: { kind: "direct", allowedVpsIds: ["vpn2"] } }],
  }), /routeTo must contain exactly kind/);
  assert.throws(() => validateServiceCatalog({
    ...base,
    services: [{ ...base.services[0], routeTo: { kind: "vps-pool", allowedVpsIds: ["vpn2"], onNoHealthyTarget: "servfail", stale: true } }],
  }), /routeTo must contain exactly kind, allowedVpsIds, onNoHealthyTarget/);
});

test("legacy catalog compiles Telegram, ChatGPT, and Antigravity without changing their scope or target", async () => {
  const legacy = await loadRestrictedServicesCatalog();
  const catalog = compileLegacyServiceCatalog(legacy, {
    defaultPoolIds: ["vpn2"],
    localPoolIds: ["vpn2"],
    vusaPoolIds: ["vusa"],
  });

  const telegram = catalog.services.find((service) => service.id === "telegram");
  const chatgpt = catalog.services.find((service) => service.id === "chatgpt-openai");
  const antigravity = catalog.services.find((service) => service.id === "google-antigravity");

  assert.deepEqual(telegram?.workIn, "lan-only");
  assert.deepEqual(telegram?.routeTo, { kind: "vps-pool", allowedVpsIds: ["vpn2"], onNoHealthyTarget: "servfail" });
  assert.deepEqual(chatgpt?.workIn, "both");
  assert.deepEqual(chatgpt?.routeTo, { kind: "vps-pool", allowedVpsIds: ["vpn2"], onNoHealthyTarget: "servfail" });
  assert.deepEqual(antigravity?.workIn, "both");
  assert.deepEqual(antigravity?.routeTo, { kind: "vps-pool", allowedVpsIds: ["vusa"], onNoHealthyTarget: "servfail" });
  assert.ok(antigravity?.domains.every((rule) => rule.match === "suffix"));

  validateServiceTargetCapabilities(catalog, targets);
});

test("service domain matching prefers exact rules, then the longest suffix, within the requested scope", () => {
  const catalog = validateServiceCatalog({
    schemaVersion: 2,
    updatedAt: "2026-07-19",
    description: "Test catalog",
    services: [
      {
        id: "suffix-service",
        label: "Suffix service",
        domains: [{ match: "suffix", value: "example.com" }],
        workIn: "both",
        routeTo: { kind: "vps-pool", allowedVpsIds: ["vpn2"], onNoHealthyTarget: "servfail" },
      },
      {
        id: "exact-service",
        label: "Exact service",
        domains: [{ match: "exact", value: "api.example.com" }],
        workIn: "external",
        routeTo: { kind: "direct" },
      },
      {
        id: "longer-suffix-service",
        label: "Longer suffix service",
        domains: [{ match: "suffix", value: "internal.example.com" }],
        workIn: "lan-only",
        routeTo: { kind: "direct" },
      },
    ],
  });

  assert.equal(resolveServiceRoute("api.example.com", "external", catalog)?.service.id, "exact-service");
  assert.equal(resolveServiceRoute("api.example.com", "lan-only", catalog)?.service.id, "suffix-service");
  assert.equal(resolveServiceRoute("www.internal.example.com", "lan-only", catalog)?.service.id, "longer-suffix-service");
  assert.equal(resolveServiceRoute("api.example.com", "external", catalog)?.rule.match, "exact");
});

test("service catalog rejects conflicting rules and target capabilities that cannot serve their scope", () => {
  assert.throws(() => validateServiceCatalog({
    schemaVersion: 2,
    updatedAt: "2026-07-19",
    description: "Conflicting catalog",
    services: [
      {
        id: "first-service",
        label: "First",
        domains: [{ match: "exact", value: "same.example.com" }],
        workIn: "external",
        routeTo: { kind: "direct" },
      },
      {
        id: "second-service",
        label: "Second",
        domains: [{ match: "exact", value: "same.example.com" }],
        workIn: "external",
        routeTo: { kind: "vps-pool", allowedVpsIds: ["vpn2"], onNoHealthyTarget: "servfail" },
      },
    ],
  }), /conflicting exact domain rule/);

  assert.throws(() => validateServiceCatalog({
    schemaVersion: 2,
    updatedAt: "2026-07-20",
    description: "Cross-scope conflict",
    services: [
      {
        id: "lan-service",
        label: "LAN",
        domains: [{ match: "suffix", value: "same.example.com" }],
        workIn: "lan-only",
        routeTo: { kind: "direct" },
      },
      {
        id: "external-service",
        label: "External",
        domains: [{ match: "suffix", value: "same.example.com" }],
        workIn: "external",
        routeTo: { kind: "direct" },
      },
    ],
  }), /conflicting suffix domain rule/);

  const external = validateServiceCatalog({
    schemaVersion: 2,
    updatedAt: "2026-07-19",
    description: "External catalog",
    services: [{
      id: "external-service",
      label: "External",
      domains: [{ match: "suffix", value: "external.example.com" }],
      workIn: "external",
      routeTo: { kind: "vps-pool", allowedVpsIds: ["lan-only-vps"], onNoHealthyTarget: "servfail" },
    }],
  });
  assert.throws(() => validateServiceTargetCapabilities(external, [
    { id: "lan-only-vps", publicDnsEdge: false, lanEgress: true, lanBalancerTag: "proxy" },
  ]), /does not support public DNS/);
});

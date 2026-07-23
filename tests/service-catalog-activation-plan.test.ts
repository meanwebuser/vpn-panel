import assert from "node:assert/strict";
import test from "node:test";

import { buildServiceCatalogActivationPlan } from "../src/service-catalog-activation-plan.js";

test("activation plan blocks the entire catalog when a LAN pool has no selector", () => {
  const plan = buildServiceCatalogActivationPlan({
    schemaVersion: 2,
    updatedAt: "2026-07-20T13:02:49.029Z",
    description: "Test catalog",
    services: [{
      id: "telegram",
      label: "Telegram",
      domains: [{ match: "suffix", value: "telegram.org" }],
      workIn: "lan-only",
      routeTo: { kind: "vps-pool", allowedVpsIds: ["vpn2", "vusa"], onNoHealthyTarget: "servfail" },
    }],
  }, {
    activePublicDnsEdgeId: "vpn2",
    targets: [
      { id: "vpn2", lanEgress: true, lanBalancerTag: "proxy" },
      { id: "vusa", lanEgress: true, lanBalancerTag: "us-auto", dedicatedPublicDnsProfile: "vusa" },
    ],
  });

  assert.deepEqual(plan, {
    schemaVersion: 1,
    draftRevision: "2026-07-20T13:02:49.029Z",
    activePublicDnsEdgeId: "vpn2",
    status: "blocked",
    routeCount: 0,
    diagnostics: [{
      serviceId: "telegram",
      scope: "lan",
      domain: "telegram.org",
      code: "multi-vps-selector-unavailable",
    }],
  });
});

test("activation plan reports a ready singleton VUSA profile without writing artifacts", () => {
  const plan = buildServiceCatalogActivationPlan({
    schemaVersion: 2,
    updatedAt: "2026-07-20T13:02:50.000Z",
    description: "Test catalog",
    services: [{
      id: "antigravity",
      label: "Antigravity",
      domains: [{ match: "suffix", value: "antigravity.google" }],
      workIn: "both",
      routeTo: { kind: "vps-pool", allowedVpsIds: ["vusa"], onNoHealthyTarget: "servfail" },
    }],
  }, {
    activePublicDnsEdgeId: "vpn2",
    targets: [{ id: "vusa", publicDnsEdge: true, lanEgress: true, lanBalancerTag: "us-auto", dedicatedPublicDnsProfile: "vusa" }],
  });

  assert.equal(plan.status, "ready");
  assert.equal(plan.routeCount, 1);
  assert.deepEqual(plan.diagnostics, []);
});

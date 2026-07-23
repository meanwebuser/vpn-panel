import assert from "node:assert/strict";
import test from "node:test";

import type { ServiceRoutingProjection } from "../src/service-catalog-activation.js";
import { renderCatalogSmartDnsPolicy } from "../src/service-catalog-policy-render.js";
import type { SmartDnsPolicy } from "../src/smart-dns-policy.js";

const basePolicy: SmartDnsPolicy = {
  defaultRoute: "proxy",
  localDefaultRoute: "direct",
  directSuffixes: ["admin.example"],
  directDomains: ["admin.example.com"],
  proxySuffixes: ["admin-proxy.example"],
  proxyDomains: ["admin-proxy.example.com"],
  localProxySuffixes: ["admin-local.example"],
  localProxyDomains: ["admin-local.example.com"],
  vusaProxySuffixes: ["admin-vusa.example"],
  vusaProxyDomains: ["admin-vusa.example.com"],
  updatedAt: "2026-07-19T00:00:00.000Z",
};

function projection(domains: ServiceRoutingProjection["domains"]): ServiceRoutingProjection {
  return { schemaVersion: 1, sourceCatalogRevision: "catalog-1", activePublicDnsEdgeId: "vusa", domains };
}

function domain(
  value: string,
  match: "exact" | "suffix",
  routes: Pick<ServiceRoutingProjection["domains"][number], "lan" | "external">,
): ServiceRoutingProjection["domains"][number] {
  return { serviceId: value, match, domain: value, ...routes };
}

test("places LAN proxy and both-scope proxies deterministically by target and match", () => {
  const next = projection([
    domain("lan-vpn2.example.com", "suffix", { lan: { kind: "proxy", targetId: "vpn2", balancerTag: "lan-vpn2" } }),
    domain("both-vpn2.example.com", "suffix", {
      lan: { kind: "proxy", targetId: "vpn2", balancerTag: "lan-vpn2" },
      external: { kind: "proxy", targetId: "vpn2", profileId: "public" },
    }),
    domain("both-vusa.example.com", "suffix", {
      lan: { kind: "proxy", targetId: "vusa", balancerTag: "lan-vusa" },
      external: { kind: "proxy", targetId: "vusa", profileId: "vusa" },
    }),
  ]);

  const rendered = renderCatalogSmartDnsPolicy(basePolicy, null, next);

  assert.deepEqual(rendered.localProxySuffixes, ["admin-local.example", "lan-vpn2.example.com"]);
  assert.deepEqual(rendered.proxySuffixes, ["admin-proxy.example", "both-vpn2.example.com"]);
  assert.deepEqual(rendered.vusaProxySuffixes, ["admin-vusa.example", "both-vusa.example.com"]);
  assert.deepEqual(rendered.localProxyDomains, ["admin-local.example.com"]);
  assert.deepEqual(rendered.proxyDomains, ["admin-proxy.example.com"]);
  assert.deepEqual(rendered.vusaProxyDomains, ["admin-vusa.example.com"]);
});

test("places external direct domains and omits LAN-only direct domains", () => {
  const next = projection([
    domain("external-direct.example.com", "exact", { external: { kind: "direct" } }),
    domain("both-direct.example.com", "suffix", { lan: { kind: "direct" }, external: { kind: "direct" } }),
    domain("lan-direct.example.com", "exact", { lan: { kind: "direct" } }),
  ]);

  const rendered = renderCatalogSmartDnsPolicy(basePolicy, null, next);

  assert.deepEqual(rendered.directDomains, ["admin.example.com", "external-direct.example.com"]);
  assert.deepEqual(rendered.directSuffixes, ["admin.example", "both-direct.example.com"]);
});

test("scrubs stale managed domains from every route list while preserving administrator entries", () => {
  const stale = domain("stale.example.com", "suffix", { external: { kind: "direct" } });
  const previous = projection([stale]);
  const base: SmartDnsPolicy = {
    ...basePolicy,
    directSuffixes: [...basePolicy.directSuffixes, stale.domain],
    directDomains: [...basePolicy.directDomains, stale.domain],
    proxySuffixes: [...basePolicy.proxySuffixes, stale.domain],
    proxyDomains: [...basePolicy.proxyDomains, stale.domain],
    localProxySuffixes: [...basePolicy.localProxySuffixes, stale.domain],
    localProxyDomains: [...basePolicy.localProxyDomains, stale.domain],
    vusaProxySuffixes: [...basePolicy.vusaProxySuffixes, stale.domain],
    vusaProxyDomains: [...basePolicy.vusaProxyDomains, stale.domain],
  };

  const rendered = renderCatalogSmartDnsPolicy(base, previous, projection([]));

  for (const list of [
    rendered.directSuffixes,
    rendered.directDomains,
    rendered.proxySuffixes,
    rendered.proxyDomains,
    rendered.localProxySuffixes,
    rendered.localProxyDomains,
    rendered.vusaProxySuffixes,
    rendered.vusaProxyDomains,
  ]) {
    assert.equal(list.includes(stale.domain), false);
  }
  assert.deepEqual(rendered.directDomains, ["admin.example.com"]);
  assert.deepEqual(rendered.vusaProxyDomains, ["admin-vusa.example.com"]);
});

test("does not mutate inputs and is stable for reordered equivalent projections", () => {
  const next = projection([
    domain("z.example.com", "suffix", { external: { kind: "direct" } }),
    domain("a.example.com", "exact", { lan: { kind: "direct" } }),
  ]);
  const reordered = projection([...next.domains].reverse());
  const base = structuredClone(basePolicy);
  const previous = projection([]);
  const baseBefore = structuredClone(base);
  const previousBefore = structuredClone(previous);
  const nextBefore = structuredClone(next);

  const first = renderCatalogSmartDnsPolicy(base, previous, next);
  const second = renderCatalogSmartDnsPolicy(base, previous, reordered);

  assert.deepEqual(first, second);
  assert.deepEqual(base, baseBefore);
  assert.deepEqual(previous, previousBefore);
  assert.deepEqual(next, nextBefore);
});

test("rejects malformed or unrepresentable projections", () => {
  const malformed: Array<[string, ServiceRoutingProjection]> = [
    ["external proxy without target", projection([domain("missing-target.example", "suffix", { external: { kind: "proxy" } as never })])],
    [
      "different LAN and external targets",
      projection([domain("different-targets.example", "suffix", { lan: { kind: "proxy", targetId: "vpn2", balancerTag: "x" }, external: { kind: "proxy", targetId: "vusa", profileId: "public" } })]),
    ],
    ["unsupported proxy target", projection([domain("unsupported-target.example", "suffix", { lan: { kind: "proxy", targetId: "other", balancerTag: "x" } })])],
    ["exact LAN proxy", projection([domain("exact-proxy.example", "exact", { lan: { kind: "proxy", targetId: "vpn2", balancerTag: "x" } })])],
    ["external-only proxy", projection([domain("external-only.example", "suffix", { external: { kind: "proxy", targetId: "vpn2", profileId: "public" } })])],
    ["domain without a LAN or external route", projection([domain("no-route.example", "suffix", {})])],
  ];

  for (const [name, malformedProjection] of malformed) {
    assert.throws(() => renderCatalogSmartDnsPolicy(basePolicy, null, malformedProjection), name);
  }
});

test("rejects malformed previous projections before scrubbing", () => {
  const previous = projection([
    domain("old-external-only.example.com", "suffix", { external: { kind: "proxy", targetId: "vpn2", profileId: "public" } }),
  ]);
  const base = structuredClone(basePolicy);

  assert.throws(() => renderCatalogSmartDnsPolicy(base, previous, projection([])), /external-only proxy/);
  assert.deepEqual(base, basePolicy);
});

test("uses explicit external profile instead of inferring from target ID", () => {
  const rendered = renderCatalogSmartDnsPolicy(basePolicy, null, projection([
    domain("vusa-profile.example.com", "suffix", {
      lan: { kind: "proxy", targetId: "vpn2", balancerTag: "lan-vpn2" },
      external: { kind: "proxy", targetId: "vpn2", profileId: "vusa" },
    }),
  ]));

  assert.deepEqual(rendered.proxySuffixes, ["admin-proxy.example"]);
  assert.deepEqual(rendered.vusaProxySuffixes, ["admin-vusa.example", "vusa-profile.example.com"]);
});

test("rejects unknown external proxy profiles", () => {
  assert.throws(() => renderCatalogSmartDnsPolicy(basePolicy, null, projection([
    domain("unknown-profile.example.com", "suffix", {
      lan: { kind: "proxy", targetId: "vpn2", balancerTag: "lan-vpn2" },
      external: { kind: "proxy", targetId: "vpn2", profileId: "unknown" as never },
    }),
  ])), /unsupported proxy profile/);
});

test("rejects conflicting duplicate next domains after normalization", () => {
  const next = projection([
    domain("Conflict.Example.com", "suffix", { external: { kind: "direct" } }),
    domain(".conflict.example.com.", "suffix", {
      lan: { kind: "proxy", targetId: "vpn2", balancerTag: "lan-vpn2" },
      external: { kind: "proxy", targetId: "vpn2", profileId: "public" },
    }),
  ]);

  assert.throws(() => renderCatalogSmartDnsPolicy(basePolicy, null, next), /conflicting duplicate/);
});

test("rejects explicit null scope routes while allowing omitted scopes", () => {
  const lanNull = projection([
    domain("lan-null.example.com", "suffix", { lan: null as never, external: { kind: "direct" } }),
  ]);
  const externalNull = projection([
    domain("external-null.example.com", "suffix", { lan: { kind: "direct" }, external: null as never }),
  ]);

  assert.throws(() => renderCatalogSmartDnsPolicy(basePolicy, null, lanNull), /malformed LAN route/);
  assert.throws(() => renderCatalogSmartDnsPolicy(basePolicy, null, externalNull), /malformed external route/);
});

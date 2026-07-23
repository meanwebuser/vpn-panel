import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { isIP } from "node:net";
import type { Endpoint } from "../src/types.js";
import type { ClientBundle } from "../src/subscriptions.js";
import type { SmartDnsPolicy } from "../src/smart-dns-policy.js";
import {
  happRoutingLink,
  happDeeplink,
  announceHeader,
  linkSlots,
  plainSubscription,
  singBoxSubscription,
  macosSingBoxSubscription,
  v2raySubscription,
  xrayClientSubscription,
  macosXraySubscription,
  vlessLink,
  orderPublicSubscriptionEndpoints,
} from "../src/subscriptions.js";
import type { VpnTestEndpointScore } from "../src/vpn-test-telemetry.js";
import type { SecureConfig } from "../src/secure-config.js";

function decodeHappRoutingLink(link: string): Record<string, unknown> {
  const match = link.match(/^happ:\/\/routing\/(?:add|onadd)\/(.+)$/);
  assert.ok(match);
  return JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
}

const secure: SecureConfig = {
  defaults: {
    fingerprint: "firefox",
    flow: "xtls-rprx-vision",
    sni: "ya.ru",
    domain_strategy: "IPIfNonMatch",
  },
  nodes: [],
  server_configs: {},
};

const endpoints: Endpoint[] = [
  {
    id: "smart-de-relay",
    label: "Smart DE",
    kind: "vless-reality",
    address: "198.51.100.10",
    port: 443,
    profile_id: "smart-de-relay",
    enabled: true,
    sort_order: 0,
    config: { public_key: "ru-pbk", short_id: "ru-sid", sni: "smart-de.relay.example.com" },
  },
  {
    id: "full-de-relay",
    label: "Full DE",
    kind: "vless-reality",
    address: "198.51.100.10",
    port: 443,
    profile_id: "full-de-relay",
    enabled: true,
    sort_order: 1,
    config: { public_key: "ru-pbk", short_id: "ru-sid", sni: "full-de.relay.example.com" },
  },
  {
    id: "smart-us-relay",
    label: "Smart US",
    kind: "vless-reality",
    address: "198.51.100.10",
    port: 443,
    profile_id: "smart-us-relay",
    enabled: true,
    sort_order: 2,
    config: { public_key: "ru-pbk", short_id: "ru-sid", sni: "smart-us.relay.example.com" },
  },
  {
    id: "full-us-relay",
    label: "Full US",
    kind: "vless-reality",
    address: "198.51.100.10",
    port: 443,
    profile_id: "full-us-relay",
    enabled: true,
    sort_order: 3,
    config: { public_key: "ru-pbk", short_id: "ru-sid", sni: "full-us.relay.example.com" },
  },
  {
    id: "de-httpupgrade",
    label: "DE-HTTPUpgrade",
    kind: "vless-httpupgrade",
    address: "edge-de.example.com",
    port: 443,
    profile_id: "de-httpupgrade",
    enabled: true,
    sort_order: 0,
    config: {
      query: {
        security: "tls",
        type: "httpupgrade",
        path: "/httpupgrade",
        host: "edge-de.example.com",
        sni: "edge-de.example.com",
        fp: "chrome",
      },
    },
  },
  {
    id: "ru-full-relay",
    label: "RU-full-relay",
    kind: "vless-reality",
    address: "relay.example.com",
    port: 23444,
    profile_id: "ru-full-relay",
    enabled: true,
    sort_order: 1,
    config: { public_key: "ru-pbk", short_id: "ru-sid" },
  },
  {
    id: "ru-smart-relay",
    label: "RU-smart-relay",
    kind: "vless-reality",
    address: "relay.example.com",
    port: 23445,
    profile_id: "ru-smart-relay",
    enabled: true,
    sort_order: 2,
    config: { public_key: "ru-pbk", short_id: "ru-sid" },
  },
  {
    id: "de-xhttp",
    label: "DE-XHTTP fallback",
    kind: "vless-xhttp",
    address: "edge-de.example.com",
    port: 443,
    profile_id: "de-xhttp",
    enabled: true,
    sort_order: 3,
    config: {
      query: {
        security: "tls",
        type: "xhttp",
        path: "/xhttp",
        host: "edge-de.example.com",
        sni: "edge-de.example.com",
        fp: "chrome",
        mode: "auto",
      },
    },
  },
  {
    id: "de-cdn",
    label: "DE-CDN fallback",
    kind: "vless-ws",
    address: "edge-de.example.com",
    port: 443,
    profile_id: "de-cdn",
    enabled: true,
    sort_order: 4,
    config: {
      query: {
        security: "tls",
        type: "ws",
        path: "/cdn-ws",
        host: "edge-de.example.com",
        sni: "edge-de.example.com",
        fp: "chrome",
      },
    },
  },
];

const bundle: ClientBundle = {
  accountId: "1",
  clientId: "1",
  displayName: "Nikita",
  login: "nikita",
  xrayUuid: "a5c1b3e1-6fc9-4573-ada5-5022d4fc4b6b",
  token: "token",
  endpoints,
};

const smartDnsPolicy: SmartDnsPolicy = {
  defaultRoute: "proxy",
  localDefaultRoute: "direct",
  directSuffixes: ["ru", "local"],
  directDomains: ["localhost"],
  proxySuffixes: ["openai.com", "claude.ai"],
  proxyDomains: ["api.openai.com"],
  localProxySuffixes: ["telegram.org", "youtube.com"],
  localProxyDomains: ["api.telegram.org"],
  vusaProxySuffixes: ["antigravity.google"],
  vusaProxyDomains: ["vusa.example"],
};

const macPolicy: SmartDnsPolicy = {
  defaultRoute: "proxy",
  localDefaultRoute: "direct",
  directSuffixes: ["ru", "local"],
  directDomains: ["edge-de.example.com"],
  proxySuffixes: ["chatgpt.com", "claude.ai"],
  proxyDomains: ["api.openai.com"],
  localProxySuffixes: ["telegram.org"],
  localProxyDomains: ["api.telegram.org"],
  vusaProxySuffixes: ["antigravity.google"],
  vusaProxyDomains: [],
};

test("plain subscription exposes four products followed by assigned legacy fallbacks", () => {
  const plain = plainSubscription(bundle, secure);
  const lines = plain.trim().split("\n");

  assert.equal(lines.length, 7);

  // Diagnostic transports remain assigned for admin testing but never leak to users.
  assert.match(lines[0], /@198\.51\.100\.10:443/);
  assert.match(lines[0], /sni=smart-de\.relay\.example\.com/);
  assert.match(lines[0], /fp=firefox/);
  assert.match(lines[0], /fragment=/);
  assert.match(lines[0], /noises=/);

  assert.match(lines[1], /@198\.51\.100\.10:443/);
  assert.match(lines[1], /sni=full-de\.relay\.example\.com/);
  assert.match(lines[1], /fp=firefox/);
  assert.match(lines[2], /sni=smart-us\.relay\.example\.com/);
  assert.match(lines[3], /sni=full-us\.relay\.example\.com/);
  assert.match(plain, /type=httpupgrade/);
  assert.match(plain, /type=ws/);
  assert.match(plain, /type=xhttp/);
});

test("public subscription removes clearly bad measured endpoints and puts the best first", () => {
  const candidates = [
    { ...endpoints[4], id: "de-direct", label: "DE-Direct", sort_order: 20 },
    { ...endpoints[7], id: "de-xhttp-h2", label: "DE-XHTTP-H2", sort_order: 21 },
    { ...endpoints[5], id: "de-cdn", label: "DE-CDN", sort_order: 22 },
  ];
  const scores: VpnTestEndpointScore[] = [
    {
      endpointId: "de-direct",
      score: 0,
      passed: 0,
      effectiveObservations: 116,
      endpointFailures: 116,
      runnerErrors: 122,
      telegramMedianMs: 11008,
      telegramP95Ms: 11022,
    },
    {
      endpointId: "de-xhttp-h2",
      score: 96.6,
      passed: 114,
      effectiveObservations: 118,
      endpointFailures: 4,
      runnerErrors: 0,
      telegramMedianMs: 364,
      telegramP95Ms: 2875,
    },
  ];

  const ordered = orderPublicSubscriptionEndpoints(candidates, scores);

  assert.deepEqual(ordered.map((endpoint) => endpoint.id), ["de-xhttp-h2", "de-cdn"]);
});

test("Reality VLESS links contain fragment and noises parameters", () => {
  const plain = plainSubscription(bundle, secure);
  const lines = plain.trim().split("\n");

  // Find all Reality links (ru-smart-relay and ru-full-relay)
  const realityLines = lines.filter((l) => l.includes("security=reality"));
  assert.ok(realityLines.length >= 2, "expected at least 2 Reality links");

  for (const line of realityLines) {
    assert.match(line, /fragment=1-10%2C5-20%2Ctlshello/, "Reality link must have fragment param");
    assert.match(line, /noises=rand%2C50-150%2C10-50%2Cip/, "Reality link must have noises param");
  }
});

test("non-Reality endpoints do not have fragment/noises params", () => {
  const diagnosticEndpoint = endpoints.find((endpoint) => endpoint.id === "de-httpupgrade")!;
  const link = vlessLink(diagnosticEndpoint, bundle.xrayUuid, secure);
  assert.ok(link);
  assert.doesNotMatch(link, /fragment=/, "non-Reality link must not have fragment");
  assert.doesNotMatch(link, /noises=/, "non-Reality link must not have noises");
});

test("vlessLink returns link with fragment/noises for Reality endpoint", () => {
  const realityEndpoint = endpoints.find((e) => e.kind === "vless-reality")!;
  const link = vlessLink(realityEndpoint, bundle.xrayUuid, secure);
  assert.ok(link);
  assert.match(link, /fragment=/);
  assert.match(link, /noises=/);
  assert.match(link, /fp=firefox/);
});


test("Happ routing leaves regional smart/full policy to the relay", () => {
  const link = happRoutingLink();
  assert.match(link, /^happ:\/\/routing\/onadd\//);
  const payload = decodeHappRoutingLink(link);

  assert.equal(payload.Name, "Relay-managed routing");
  assert.equal(payload.GlobalProxy, "true");
  assert.equal(payload.FakeDNS, "false");
  assert.equal(payload.Geoipurl, "https://github.com/golukon/russia-only-geoip/releases/latest/download/geoip.dat");
  assert.equal(payload.Geositeurl, "https://github.com/golukon/russia-only-geosite/releases/latest/download/geosite.dat");
  assert.deepEqual(payload.DirectSites, ["panel.example.com"]);
  assert.ok(payload.DirectIp.includes("geoip:private"));
  assert.ok(!payload.DirectIp.includes("geoip:ru"));
  assert.deepEqual(payload.BlockSites, []);
  assert.equal(payload.RemoteDNSDomain, "https://dns.google/dns-query");
});

test("v2ray subscription is base64 plain subscription", () => {
  assert.equal(Buffer.from(v2raySubscription(bundle, secure), "base64").toString("utf8"), plainSubscription(bundle, secure));
});

test("link slots include exactly the four regional relay products", () => {
  const slots = linkSlots(bundle, secure);

  assert.deepEqual(slots.map((slot) => slot.id), ["smart-de-relay", "full-de-relay", "smart-us-relay", "full-us-relay"]);
  assert.equal(slots.filter((slot) => slot.available).length, 4);
});

test("sing-box subscription restores diagnostic fallback transports", () => {
  const generated = singBoxSubscription(bundle, secure);
  const outbounds = generated.outbounds as Array<Record<string, unknown>>;

  assert.equal((generated.route as Record<string, unknown>).final, "proxy");
  assert.equal(outbounds[0].type, "selector");
  assert.deepEqual(outbounds[0].outbounds, ["smart-de-relay", "full-de-relay", "smart-us-relay", "full-us-relay", "de-httpupgrade", "de-cdn"]);
});

test("macOS sing-box profile proxies SmartDNS families and sends everything else direct", () => {
  const generated = macosSingBoxSubscription(bundle, secure, macPolicy);
  const inbound = (generated.inbounds as Array<Record<string, unknown>>)[0];
  const route = generated.route as Record<string, unknown>;
  const rules = route.rules as Array<Record<string, unknown>>;
  const proxyRule = rules.find((rule) => rule.outbound === "proxy");
  const proxy = (generated.outbounds as Array<Record<string, unknown>>).find((outbound) => outbound.tag === "proxy");

  assert.deepEqual(inbound, { type: "mixed", tag: "mixed-in", listen: "127.0.0.1", listen_port: 2080 });
  assert.equal(route.final, "direct");
  assert.equal(route.default_domain_resolver, "local");
  assert.equal(route.rule_set, undefined);
  assert.deepEqual(proxyRule?.domain_suffix, ["antigravity.google", "api.openai.com", "api.telegram.org", "chatgpt.com", "claude.ai", "telegram.org"]);
  assert.equal(proxy?.default, "de-httpupgrade");
  assert.equal((generated.dns as Record<string, unknown>).final, "remote");
  assert.deepEqual((generated.dns as Record<string, unknown>).rules, []);
  assert.deepEqual((generated.dns as Record<string, unknown>).servers, [
    { type: "local", tag: "local" },
    { type: "https", tag: "remote", server: "1.1.1.1", path: "/dns-query" },
  ]);
});

test("xray json leaves RU smart/full policy to the selected relay", () => {
  const generated = xrayClientSubscription(bundle, secure);
  const routing = generated.routing as Record<string, unknown>;
  const rules = routing.rules as Array<Record<string, unknown>>;

  assert.equal(routing.domainStrategy, "IPIfNonMatch");
  assert.deepEqual(rules[0].ip, ["geoip:private"]);
  assert.ok(!rules.some((rule) => Array.isArray(rule.ip) && rule.ip.includes("geoip:ru")));
  assert.ok(!rules.some((rule) => Array.isArray(rule.domain) && rule.domain.includes("geosite:category-ru")));
});

test("xray json restores diagnostic fallback transports", () => {
  const generated = xrayClientSubscription(bundle, secure);
  const outbounds = generated.outbounds as Array<Record<string, unknown>>;
  const tags = outbounds.map((outbound) => outbound.tag);
  assert.deepEqual(tags.slice(0, 4), ["smart-de-relay", "full-de-relay", "smart-us-relay", "full-us-relay"]);
  assert.ok(tags.includes("de-cdn"));
  assert.ok(tags.includes("de-httpupgrade"));
});

test("macOS smart Xray config uses user-level proxies and sends SmartDNS proxy families through least-ping", () => {
  const generated = macosXraySubscription(bundle, secure, smartDnsPolicy, "smart");
  const routing = generated.routing as Record<string, unknown>;
  const rules = routing.rules as Array<Record<string, unknown>>;
  const balancers = routing.balancers as Array<Record<string, unknown>>;

  assert.deepEqual((generated.inbounds as Array<Record<string, unknown>>).map((inbound) => inbound.protocol), ["socks", "http"]);
  assert.equal((generated.inbounds as Array<Record<string, unknown>>).some((inbound) => inbound.protocol === "tun"), false);
  assert.ok((generated.outbounds as Array<Record<string, unknown>>)
    .filter((outbound) => outbound.protocol === "vless")
    .every((outbound) => isIP(String(((outbound.settings as Record<string, unknown>).vnext as Array<Record<string, unknown>>)[0].address)) === 4));

  assert.equal(balancers[0].tag, "bez-de");
  assert.deepEqual(balancers[0].strategy, { type: "leastPing" });
  assert.equal(balancers[0].fallbackTag, "de-httpupgrade");
  assert.ok(rules.some((rule) => rule.balancerTag === "bez-de" && (rule.domain as string[]).includes("domain:openai.com")));
  assert.ok(rules.some((rule) => rule.balancerTag === "bez-de" && (rule.domain as string[]).includes("domain:telegram.org")));
  assert.ok(rules.some((rule) => rule.outboundTag === "direct" && Array.isArray(rule.domain) && rule.domain.includes("domain:ru")));
  assert.ok(rules.some((rule) => rule.outboundTag === "direct" && Array.isArray(rule.ip) && rule.ip.includes("192.168.0.0/16")));
  assert.ok(rules.some((rule) => rule.balancerTag === "bez-us" && (rule.domain as string[]).includes("domain:antigravity.google")));
  assert.equal(rules.at(-1)?.outboundTag, "direct");
});

test("macOS all Xray config routes external traffic through the least-ping balancer without TUN", () => {
  const generated = macosXraySubscription(bundle, secure, smartDnsPolicy, "all");
  const routing = generated.routing as Record<string, unknown>;
  const rules = routing.rules as Array<Record<string, unknown>>;
  const allBalancer = (routing.balancers as Array<Record<string, unknown>>).find((balancer) => balancer.tag === "bez-all");

  assert.ok(allBalancer);
  assert.equal((generated.inbounds as Array<Record<string, unknown>>).some((inbound) => inbound.protocol === "tun"), false);
  assert.ok((generated.outbounds as Array<Record<string, unknown>>)
    .filter((outbound) => outbound.protocol === "vless")
    .every((outbound) => isIP(String(((outbound.settings as Record<string, unknown>).vnext as Array<Record<string, unknown>>)[0].address)) === 4));
  assert.deepEqual(allBalancer.strategy, { type: "leastPing" });
  assert.equal(allBalancer.fallbackTag, "de-httpupgrade");
  assert.ok(rules.some((rule) => rule.balancerTag === "bez-all" && rule.network === "tcp,udp"));
  assert.ok(rules.some((rule) => rule.outboundTag === "direct" && Array.isArray(rule.ip) && rule.ip.includes("192.168.0.0/16")));
  assert.equal(rules.some((rule) => rule.outboundTag === "direct" && Array.isArray(rule.domain) && rule.domain.includes("domain:ru")), false);
  assert.equal(rules.some((rule) => rule.balancerTag === "bez-de" || rule.balancerTag === "bez-us"), false);
  assert.equal(rules.at(-1)?.balancerTag, "bez-all");
});

test("happDeeplink produces valid happ://subscription-url/add/ URL", () => {
  const subUrl = "https://panel.example.com/sub/abc123/plain";
  const link = happDeeplink(subUrl);
  assert.ok(link.startsWith("happ://subscription-url/add/"));
  const decoded = Buffer.from(link.replace("happ://subscription-url/add/", ""), "base64url").toString("utf8");
  assert.equal(decoded, subUrl);
});

test("announceHeader returns base64: prefixed string", () => {
  const msg = "Test announce";
  const hdr = announceHeader(msg);
  assert.ok(hdr.startsWith("base64:"));
  const decoded = Buffer.from(hdr.replace("base64:", ""), "base64").toString("utf8");
  assert.equal(decoded, msg);
});

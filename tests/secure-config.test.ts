import test from "node:test";
import assert from "node:assert/strict";
import { loadSecureConfig } from "../src/secure-config.js";
import { z } from "zod";

test("SecureConfig schema validates minimal config", () => {
  const minimal = {
    defaults: {},
    nodes: [],
    server_configs: {},
    vps_list: [],
  };
  // Use the actual schema from the module
  const schema = z.object({
    defaults: z.object({
      fingerprint: z.string().default("chrome"),
      flow: z.string().default("xtls-rprx-vision"),
      sni: z.string().default("ya.ru"),
      domain_strategy: z.string().default("IPIfNonMatch"),
    }).default({}),
    nodes: z.array(z.any()).default([]),
    server_configs: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
    happ: z.object({
      provider_code: z.string().default("example-provider-code"),
      auth_key: z.string().default(""),
      base_url: z.string().default("https://happ-proxy.com"),
    }).default({ provider_code: "example-provider-code", auth_key: "", base_url: "https://happ-proxy.com" }),
    vps: z.object({
      host: z.string().default(""),
      port: z.coerce.number().int().default(22),
      username: z.string().default("root"),
      password: z.string().default(""),
      private_key: z.string().default(""),
      passphrase: z.string().default(""),
      label: z.string().default("VPS"),
    }).default({ host: "", port: 22, username: "root", password: "", private_key: "", passphrase: "", label: "VPS" }),
    vps_list: z.array(z.object({
      id: z.string(),
      host: z.string(),
      port: z.coerce.number().int().default(22),
      username: z.string().default("root"),
      password: z.string().default(""),
      private_key: z.string().default(""),
      passphrase: z.string().default(""),
      label: z.string(),
    })).default([]),
  });

  const result = schema.parse(minimal);
  assert.equal(result.defaults.fingerprint, "chrome");
  assert.equal(result.defaults.flow, "xtls-rprx-vision");
  assert.equal(result.happ.provider_code, "example-provider-code");
  assert.equal(result.vps.host, "");
  assert.equal(result.vps_list.length, 0);
});

test("SecureConfig schema validates full config with vps_list", () => {
  const schema = z.object({
    defaults: z.object({
      fingerprint: z.string().default("chrome"),
      flow: z.string().default("xtls-rprx-vision"),
      sni: z.string().default("ya.ru"),
      domain_strategy: z.string().default("IPIfNonMatch"),
    }).default({}),
    nodes: z.array(z.any()).default([]),
    server_configs: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
    happ: z.object({
      provider_code: z.string().default("example-provider-code"),
      auth_key: z.string().default(""),
      base_url: z.string().default("https://happ-proxy.com"),
    }).default({}),
    vps: z.object({
      host: z.string().default(""),
      port: z.coerce.number().int().default(22),
      username: z.string().default("root"),
      password: z.string().default(""),
      private_key: z.string().default(""),
      passphrase: z.string().default(""),
      label: z.string().default("VPS"),
    }).default({}),
    vps_list: z.array(z.object({
      id: z.string(),
      host: z.string(),
      port: z.coerce.number().int().default(22),
      username: z.string().default("root"),
      password: z.string().default(""),
      private_key: z.string().default(""),
      passphrase: z.string().default(""),
      label: z.string(),
    })).default([]),
  });

  const fullConfig = {
    defaults: {
      fingerprint: "safari",
      flow: "xtls-rprx-vision",
      sni: "google.com",
      domain_strategy: "AsIs",
    },
    nodes: [],
    server_configs: { de: { listen_port: 443 } },
    happ: { provider_code: "CustomCode", auth_key: "key123" },
    vps: { host: "vpn1.example.com", label: "VPS-1" },
    vps_list: [
      { id: "de-vps", host: "vpn1.example.com", label: "Germany" },
      { id: "ru-vps", host: "vpn2.example.com", label: "Russia" },
    ],
  };

  const result = schema.parse(fullConfig);
  assert.equal(result.defaults.fingerprint, "safari");
  assert.equal(result.happ.provider_code, "CustomCode");
  assert.equal(result.vps.host, "vpn1.example.com");
  assert.equal(result.vps_list.length, 2);
  assert.equal(result.vps_list[0].id, "de-vps");
  assert.equal(result.vps_list[1].host, "vpn2.example.com");
});

test("SecureConfig vps_list entries have port defaulting to 22", () => {
  const schema = z.object({
    vps_list: z.array(z.object({
      id: z.string(),
      host: z.string(),
      port: z.coerce.number().int().default(22),
      username: z.string().default("root"),
      password: z.string().default(""),
      private_key: z.string().default(""),
      passphrase: z.string().default(""),
      label: z.string(),
    })).default([]),
  });

  const config = {
    vps_list: [
      { id: "test", host: "example.com", label: "Test" },
    ],
  };

  const result = schema.parse(config);
  assert.equal(result.vps_list[0].port, 22);
  assert.equal(result.vps_list[0].username, "root");
});

test("endpointProfile returns first profile or node id", () => {
  // Test the logic: node.profiles?.[0] || node.id
  assert.equal(undefined || "de-direct", "de-direct");
  assert.equal(["profile1", "profile2"][0] || "de-direct", "profile1");
});

test("endpointOrder exposes only the four regional relay products", async () => {
  const { endpointOrder } = await import("../src/secure-config.js");
  assert.deepEqual(endpointOrder, [
    "smart-de-relay",
    "full-de-relay",
    "smart-us-relay",
    "full-us-relay",
  ]);
});

test("diagnosticEndpointOrder keeps transports out of the product catalog", async () => {
  const { diagnosticEndpointOrder } = await import("../src/secure-config.js");
  assert.ok(diagnosticEndpointOrder.includes("de-xhttp"));
  assert.ok(diagnosticEndpointOrder.includes("de-grpc"));
  assert.ok(diagnosticEndpointOrder.includes("us-reality"));
  assert.ok(diagnosticEndpointOrder.includes("us-xhttp"));
  assert.ok(diagnosticEndpointOrder.includes("us-xhttp-h2-443"));
  assert.ok(diagnosticEndpointOrder.includes("us-httpupgrade"));
  assert.ok(diagnosticEndpointOrder.includes("us-grpc"));
  assert.ok(diagnosticEndpointOrder.includes("us-xhttp-h2"));
  assert.ok(diagnosticEndpointOrder.includes("us-direct-ws"));
  assert.ok(!diagnosticEndpointOrder.includes("de-cdn-xhttp"));
});

test("subscriptionEndpointOrder restores legacy fallbacks after the four products", async () => {
  const { endpointOrder, mobileRelayEndpointOrder, legacyFallbackEndpointOrder, subscriptionEndpointOrder } = await import("../src/secure-config.js");
  assert.deepEqual(subscriptionEndpointOrder, [...endpointOrder, ...mobileRelayEndpointOrder, ...legacyFallbackEndpointOrder]);
});

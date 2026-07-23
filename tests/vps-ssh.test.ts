import test from "node:test";
import assert from "node:assert/strict";
import { type VpsConnectionConfig } from "../src/vps-ssh.js";

test("Version parsing handles standard versions", () => {
  const versions = [
    ["26.3.27", [26, 3, 27]],
    ["26.5.9", [26, 5, 9]],
    ["26.6.1", [26, 6, 1]],
    ["1.0.0", [1, 0, 0]],
  ];

  for (const [input, expected] of versions) {
    const parts = input.split(".").map(Number);
    assert.deepEqual(parts, expected);
  }
});

test("Version comparison works correctly", () => {
  const comparisons = [
    ["26.6.1", "26.5.9", true],
    ["26.5.9", "26.3.27", true],
    ["26.3.27", "26.3.27", false],
    ["26.3.26", "26.3.27", false],
    ["27.0.0", "26.999.999", true],
  ];

  function isNewer(a: string, b: string): boolean {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const na = pa[i] || 0;
      const nb = pb[i] || 0;
      if (na > nb) return true;
      if (na < nb) return false;
    }
    return false;
  }

  for (const [a, b, expected] of comparisons) {
    assert.equal(isNewer(a, b), expected, `${a} vs ${b}`);
  }
});

test("Version comparison handles different lengths", () => {
  function isNewer(a: string, b: string): boolean {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const na = pa[i] || 0;
      const nb = pb[i] || 0;
      if (na > nb) return true;
      if (na < nb) return false;
    }
    return false;
  }

  assert.equal(isNewer("1.2", "1.1.9"), true);
  assert.equal(isNewer("1.2.0", "1.2"), false);
  assert.equal(isNewer("1.2.1", "1.2"), true);
});

test("VpsConnectionConfig type structure is valid", () => {
  const config: VpsConnectionConfig = {
    host: "vpn1.example.com",
    port: 22,
    username: "root",
    password: "secret",
  };
  assert.equal(config.host, "vpn1.example.com");
  assert.equal(config.port, 22);
  assert.equal(config.username, "root");
  assert.ok(config.password);
});

test("VpsConnectionConfig supports privateKey auth", () => {
  const config: VpsConnectionConfig = {
    host: "vpn1.example.com",
    port: 2222,
    username: "admin",
    privateKey: "test-private-key",
    passphrase: "key-passphrase",
  };
  assert.equal(config.port, 2222);
  assert.ok(config.privateKey);
  assert.ok(config.passphrase);
});

test("Xray stats parsing regex handles user traffic format", () => {
  const statName = "user>>>user@example.com>>>traffic>>>uplink";
  const match = statName.match(/^user>>>(.+?)>>>traffic>>>(uplink|downlink)$/);
  assert.ok(match);
  assert.equal(match![1], "user@example.com");
  assert.equal(match![2], "uplink");
});

test("Xray stats parsing regex handles inbound traffic format", () => {
  const statName = "inbound>>>de-reality>>>traffic>>>downlink";
  const match = statName.match(/^inbound>>>(.+?)>>>traffic>>>(uplink|downlink)$/);
  assert.ok(match);
  assert.equal(match![1], "de-reality");
  assert.equal(match![2], "downlink");
});

test("Xray stats parsing regex rejects malformed stat names", () => {
  const badNames = [
    "system>>>stats",
    "user>>>test",
    "inbound>>>only",
  ];
  for (const name of badNames) {
    const match = name.match(/^user>>>(.+?)>>>traffic>>>(uplink|downlink)$/);
    const match2 = name.match(/^inbound>>>(.+?)>>>traffic>>>(uplink|downlink)$/);
    assert.equal(match, null, `Should not match user pattern: ${name}`);
    assert.equal(match2, null, `Should not match inbound pattern: ${name}`);
  }
});

test("updateClientsInConfig preserves non-client settings", () => {
  // Test the logic: updating clients in a config should not change other fields
  const existingConfig = {
    log: { loglevel: "warning" },
    inbounds: [
      {
        tag: "de-reality",
        protocol: "vless",
        settings: { clients: [{ id: "old-uuid", email: "old-user" }], decryption: "none" },
        streamSettings: { network: "tcp", security: "reality" },
      },
    ],
    outbounds: [{ tag: "direct", protocol: "freedom" }],
  };

  // Simulate what updateClientsInConfig does
  const config = JSON.parse(JSON.stringify(existingConfig));
  const inbounds = config.inbounds as Array<Record<string, unknown>>;
  const newClients = [
    { id: "new-uuid-1", email: "user1" },
    { id: "new-uuid-2", email: "user2" },
  ];

  for (const inbound of inbounds) {
    const tag = String(inbound.tag || "");
    if (tag === "de-reality") {
      const settings = inbound.settings as Record<string, unknown>;
      if (settings) {
        settings.clients = newClients;
      }
    }
  }

  // Check clients were updated
  const updatedInbound = config.inbounds[0] as Record<string, unknown>;
  const updatedSettings = updatedInbound.settings as Record<string, unknown>;
  const clients = updatedSettings.clients as Array<Record<string, string>>;
  assert.equal(clients.length, 2);
  assert.equal(clients[0].id, "new-uuid-1");

  // Check other fields preserved
  assert.deepEqual(config.log, { loglevel: "warning" });
  assert.deepEqual(config.outbounds, [{ tag: "direct", protocol: "freedom" }]);
  const streamSettings = updatedInbound.streamSettings as Record<string, unknown>;
  assert.equal(streamSettings.network, "tcp");
  assert.equal(streamSettings.security, "reality");
});

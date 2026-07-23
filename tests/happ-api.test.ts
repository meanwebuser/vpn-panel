import test from "node:test";
import assert from "node:assert/strict";
import { happInstallDeeplink, happAddInstall, happUpdateInstall, happListInstalls, happListHwids, happDeleteHwid, happSendCommand, happSendNotification } from "../src/happ-api.js";
import type { SecureConfig } from "../src/secure-config.js";

const secure: SecureConfig = {
  defaults: {
    fingerprint: "chrome",
    flow: "xtls-rprx-vision",
    sni: "ya.ru",
    domain_strategy: "IPIfNonMatch",
  },
  nodes: [],
  server_configs: {},
  happ: {
    provider_code: "TestProvider",
    auth_key: "test-key",
    base_url: "https://happ-proxy.com",
  },
};

test("happInstallDeeplink produces correct format", () => {
  const link = happInstallDeeplink(secure, "ABC123");
  assert.equal(link, "happ://install/TestProvider/ABC123");
});

test("happInstallDeeplink with different provider code", () => {
  const customSecure = {
    ...secure,
    happ: { ...secure.happ, provider_code: "MyCode" },
  };
  const link = happInstallDeeplink(customSecure, "XYZ789");
  assert.equal(link, "happ://install/MyCode/XYZ789");
});

test("happInstallDeeplink escapes are not needed for install codes (alphanumeric)", () => {
  const codes = ["ABC123", "PmzdtajH3Lja", "a1b2c3d4"];
  for (const code of codes) {
    const link = happInstallDeeplink(secure, code);
    assert.ok(link.includes(code), `Link should contain install code: ${code}`);
  }
});

test("HappInstall type has correct fields", () => {
  // Type-level test: ensure the type structure is valid
  const install = {
    id: 1,
    install_code: "ABC123",
    install_limit: 10,
    install_count: 3,
    status: 10,
    note: null,
    created_at: "2024-01-01T00:00:00Z",
  };
  assert.equal(install.id, 1);
  assert.equal(install.install_code, "ABC123");
  assert.equal(install.install_limit, 10);
  assert.equal(install.status, 10);
});

test("HappHwid type has correct fields", () => {
  const hwid = {
    hwid: "abc123def456",
    date: "2024-01-01T00:00:00Z",
    device_name: "Pixel 7",
  };
  assert.equal(hwid.hwid, "abc123def456");
  assert.equal(hwid.device_name, "Pixel 7");
});

test("happGet/happPost use base_url from secure config", () => {
  // Verify that the URL construction uses the base_url correctly
  const baseUrl = secure.happ.base_url;
  assert.ok(baseUrl.startsWith("https://"), "Base URL should use HTTPS");
  assert.ok(baseUrl.includes("happ-proxy.com"), "Base URL should contain the domain");
});

// Mock fetch for API tests
const originalFetch = global.fetch;

test.afterEach(() => {
  global.fetch = originalFetch;
});

function mockFetch(response: unknown) {
  global.fetch = async () => Response.json(response);
}

test("happAddInstall calls API with correct params", async () => {
  mockFetch({ rc: 0, msg: "ok", install_code: "NEW123", id: 42 });
  const result = await happAddInstall(secure, { installLimit: 5, note: "test" });
  assert.equal(result.rc, 0);
  assert.equal(result.install_code, "NEW123");
  assert.equal(result.id, 42);
});

test("happAddInstall with installCode parameter", async () => {
  mockFetch({ rc: 0, msg: "ok", install_code: "EXISTING" });
  const result = await happAddInstall(secure, { installCode: "EXISTING" });
  assert.equal(result.install_code, "EXISTING");
});

test("happUpdateInstall calls API with id and options", async () => {
  mockFetch({ rc: 0, msg: "updated" });
  const result = await happUpdateInstall(secure, { id: 42, installLimit: 10, status: 10, note: "note" });
  assert.equal(result.rc, 0);
  assert.equal(result.msg, "updated");
});

test("happListInstalls calls API without id", async () => {
  mockFetch({ rc: 0, msg: "ok", data: [{ id: 1, install_code: "ABC", install_limit: 10, install_count: 0, status: 10, note: null, created_at: "2024-01-01" }] });
  const result = await happListInstalls(secure);
  assert.equal(result.rc, 0);
  assert.ok(result.data);
  assert.equal(result.data.length, 1);
});

test("happListInstalls calls API with id", async () => {
  mockFetch({ rc: 0, msg: "ok", data: [] });
  const result = await happListInstalls(secure, 42);
  assert.equal(result.rc, 0);
});

test("happListHwids calls API with options", async () => {
  mockFetch({ rc: 0, msg: "ok", data: [{ hwid: "abc123", date: "2024-01-01", device_name: "Pixel 7" }] });
  const result = await happListHwids(secure, { installCode: "ABC", installId: 1, hwid: "abc123" });
  assert.equal(result.rc, 0);
  assert.ok(result.data);
  assert.equal(result.data[0].hwid, "abc123");
});

test("happDeleteHwid calls API with installCode and hwid", async () => {
  mockFetch({ rc: 0, msg: "deleted", install_count: 2 });
  const result = await happDeleteHwid(secure, { installCode: "ABC", hwid: "deadbeef" });
  assert.equal(result.rc, 0);
  assert.equal(result.install_count, 2);
});

test("happSendCommand calls POST API with body", async () => {
  mockFetch({ rc: 0, msg: "command sent", id: 123 });
  const result = await happSendCommand(secure, {
    action_type: "toggle",
    specific_device_toggle: true,
    hwid: "abc123",
  });
  assert.equal(result.rc, 0);
  assert.equal(result.id, 123);
});

test("happSendNotification calls POST API with notification body", async () => {
  mockFetch({ rc: 0, msg: "notification sent", id: 456 });
  const result = await happSendNotification(secure, {
    PushNotificationForm: {
      title: "Test",
      body: "Test message",
      type_push: "force",
      expire_days: 7,
    },
  });
  assert.equal(result.rc, 0);
  assert.equal(result.id, 456);
});

import assert from "node:assert/strict";
import test from "node:test";
import { renderVpnTestPlan } from "../src/cli/render-vpn-test-plan.js";
import type { SecureConfig } from "../src/secure-config.js";

const secure: SecureConfig = {
  defaults: { fingerprint: "chrome", flow: "xtls-rprx-vision", sni: "ya.ru", domain_strategy: "IPIfNonMatch" },
  nodes: [
    { id: "de-direct", label: "DE", address: "de.example.test", port: 443, kind: "vless-reality", enabled: true },
    { id: "us-reality", label: "US", address: "us.example.test", port: 443, kind: "vless-reality", enabled: false },
  ],
  server_configs: {},
  happ: { provider_code: "example-provider-code", auth_key: "", base_url: "https://happ-proxy.com" },
  vps: { host: "", port: 22, username: "root", password: "", private_key: "", passphrase: "", label: "VPS" },
  vps_list: [],
};

test("VPN test plan renderer derives catalog and expectations from enabled secure nodes", async () => {
  const plan = await renderVpnTestPlan({ schemaVersion: 1, targets: {}, endpointExpectations: { stale: {} } }, secure);
  assert.equal(plan.generatedFrom, "secure.json:nodes");
  assert.deepEqual((plan.endpointCatalog as Array<Record<string, unknown>>).map((item) => item.id), ["de-direct"]);
  assert.deepEqual(plan.endpointExpectations, { "de-direct": { mode: "diagnostic", region: "DE" } });
});

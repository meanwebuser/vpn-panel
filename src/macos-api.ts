import type { FastifyInstance } from "fastify";
import { accountForLogin } from "./auth.js";
import type { DbPool } from "./db.js";
import { bezMacInstallerScript } from "./macos-installer.js";
import { loadSmartDnsPolicy, type SmartDnsPolicy } from "./smart-dns-policy.js";
import { bundleByAccount, macosXraySubscription } from "./subscriptions.js";
import type { SecureConfig } from "./secure-config.js";
import { MACOS_CONFIG_TOKEN } from "./macos-token.js";

export type MacosRouteDependencies = {
  baseUrl: string;
  pool: DbPool;
  secure: SecureConfig;
  loadPolicy?: () => Promise<SmartDnsPolicy>;
};

/** Register the public bootstrap and fixed-profile macOS Xray API. */
export function registerMacosRoutes(app: FastifyInstance, dependencies: MacosRouteDependencies): void {
  const loadPolicy = dependencies.loadPolicy || (() => loadSmartDnsPolicy());

  app.get("/install/bez", async (_request, reply) => reply
    .type("text/plain; charset=utf-8")
    .header("cache-control", "no-store")
    .send(bezMacInstallerScript(dependencies.baseUrl)));

  app.get("/api/user/macos-xray-config", async (request, reply) => {
    const rawMode = (request.query as { mode?: unknown }).mode;
    if (rawMode !== "smart" && rawMode !== "all") {
      return reply.code(400).header("cache-control", "no-store").send({ error: "mode must be smart or all" });
    }
    const unauthorized = () => reply
      .code(401)
      .header("www-authenticate", 'Bearer realm="BezVPN vpn2-07"')
      .header("cache-control", "no-store")
      .send({ error: "unauthorized" });
    if (request.headers.authorization !== `Bearer ${MACOS_CONFIG_TOKEN}`) return unauthorized();
    const account = await accountForLogin(dependencies.pool, "vpn2-07", "user");
    if (!account) return unauthorized();
    const bundle = await bundleByAccount(dependencies.pool, account.id);
    if (!bundle) return reply.code(404).header("cache-control", "no-store").send({ error: "vpn client not found" });
    return reply
      .type("application/json; charset=utf-8")
      .header("cache-control", "no-store")
      .send(macosXraySubscription(bundle, dependencies.secure, await loadPolicy(), rawMode));
  });
}

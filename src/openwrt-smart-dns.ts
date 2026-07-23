import { readFile } from "node:fs/promises";

import {
  checkSmartDnsRoute,
  loadSmartDnsPolicy,
  normalizeSmartDnsPolicy,
  smartDnsPolicyPath,
  type SmartDnsPolicy,
} from "./smart-dns-policy.js";

/** Domains that OpenWrt must synthesize to the LAN Xray SNI gateway. */
export function openWrtLocalAddressDomains(policy: SmartDnsPolicy): string[] {
  const candidates = new Set([
    ...policy.proxySuffixes,
    ...policy.proxyDomains,
    ...policy.localProxySuffixes,
    ...policy.localProxyDomains,
    ...policy.vusaProxySuffixes,
    ...policy.vusaProxyDomains,
  ].map((domain) => domain.trim().toLowerCase()).filter(Boolean));
  return [...candidates]
    .filter((domain) => checkSmartDnsRoute(domain, policy).localRoute === "proxy")
    .sort();
}

/** Render the line-oriented candidate consumed by the OpenWrt deploy script. */
export function renderOpenWrtAddressRules(policy: SmartDnsPolicy): string {
  return `${openWrtLocalAddressDomains(policy).join("\n")}\n`;
}

/** Load the deployed panel policy, avoiding dirty-checkout defaults during cutover. */
export async function loadOpenWrtSmartDnsPolicy(): Promise<SmartDnsPolicy> {
  const policyFile = smartDnsPolicyPath();
  try {
    await readFile(policyFile, "utf8");
    return loadSmartDnsPolicy(policyFile);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const runtimeFile = process.env.VPN_PANEL_SMART_DNS_RUNTIME_CONFIG || "/opt/smart-dns/config.json";
  try {
    const runtime = JSON.parse(await readFile(runtimeFile, "utf8")) as { sync?: { url?: unknown; token?: unknown } };
    const url = runtime.sync?.url;
    const token = runtime.sync?.token;
    if (typeof url !== "string" || !url || typeof token !== "string" || !token) throw new Error(`missing sync credentials in ${runtimeFile}`);
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`panel policy API returned HTTP ${response.status}`);
    const payload = await response.json() as { policy?: Partial<SmartDnsPolicy> };
    if (!payload.policy) throw new Error("panel policy API response is missing policy");
    return normalizeSmartDnsPolicy(payload.policy);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`no deployed SmartDNS policy found at ${policyFile} or ${runtimeFile}`);
    }
    throw error;
  }
}

import { readFile, writeFile } from "node:fs/promises";

export type SmartDnsResolvedRoute = "direct" | "proxy";
export type SmartDnsRoute = SmartDnsResolvedRoute | "local-proxy" | "vusa-proxy";
export type SmartDnsDefaultRoute = SmartDnsResolvedRoute;

export interface SmartDnsPolicy {
  defaultRoute: SmartDnsDefaultRoute;
  localDefaultRoute: SmartDnsDefaultRoute;
  directSuffixes: string[];
  directDomains: string[];
  proxySuffixes: string[];
  proxyDomains: string[];
  localProxySuffixes: string[];
  localProxyDomains: string[];
  vusaProxySuffixes: string[];
  vusaProxyDomains: string[];
  updatedAt?: string;
}

export interface SmartDnsRouteCheck {
  input: string;
  host: string;
  route: SmartDnsRoute;
  localRoute: SmartDnsResolvedRoute;
  publicRoute: SmartDnsResolvedRoute;
  /** Public Smart Edge profile when publicRoute is proxy; null for direct. */
  publicEdgeProfile: "public" | "vusa" | null;
  reason: string;
  matched: string | null;
}

export const DEFAULT_SMART_DNS_POLICY: SmartDnsPolicy = {
  defaultRoute: "proxy",
  localDefaultRoute: "direct",
  directSuffixes: ["ru", "su", "xn--p1ai", "local", "lan", "example.com"],
  directDomains: ["edge-de.example.com", "edge-us.example.com", "worker-lan", "localhost"],
  proxySuffixes: [
    "openai.com",
    "chatgpt.com",
    "oaistatic.com",
    "oaiusercontent.com",
    "oaistatsig.com",
    "openaimerge.com",
    "workos.com",
    "workoscdn.com",
    "claude.ai",
    "claude.com",
    "anthropic.com",
    "spotify.com",
    "scdn.co",
    "spotifycdn.com",
    "qoder.com",
  ],
  proxyDomains: [],
  localProxySuffixes: [
    "telegram.org",
    "telegram.me",
    "t.me",
    "tdesktop.com",
    "telesco.pe",
    "telegra.ph",
    "youtube.com",
    "youtu.be",
    "youtube-nocookie.com",
    "youtube.googleapis.com",
    "youtubei.googleapis.com",
    "googlevideo.com",
    "ytimg.com",
    "ggpht.com",
    "gvt1.com",
    "gvt2.com",
    "discord.com",
    "discord.gg",
    "discordapp.com",
    "discordapp.net",
    "discord.media",
    "discordstatus.com",
    "whatsapp.com",
    "whatsapp.net",
    "wa.me",
    "facebook.com",
    "facebook.net",
    "fb.com",
    "fbsbx.com",
    "messenger.com",
    "m.me",
    "threads.net",
    "threads.com",
    "instagram.com",
    "cdninstagram.com",
    "fbcdn.net",
    "ig.me",
    "x.com",
    "twitter.com",
    "t.co",
    "twimg.com",
    "grok.com",
    "x.ai",
    "signal.org",
    "signal.art",
    "viber.com",
    "viber.me",
    "viber.net",
    "linkedin.com",
    "licdn.com",
  ],
  localProxyDomains: ["api.telegram.org", "web.telegram.org", "i.instagram.com"],
  vusaProxySuffixes: [],
  vusaProxyDomains: [],
};

export function smartDnsPolicyPath(): string {
  return process.env.VPN_PANEL_SMART_DNS_POLICY || "/etc/vpn-panel/smart-dns-policy.json";
}

function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
}

function normalizeList(values: unknown, fallback: string[]): string[] {
  const list = Array.isArray(values)
    ? values
    : typeof values === "string"
      ? values.split(/[\n,]+/)
      : fallback;
  return [...new Set(list.map((v) => normalizeHost(String(v))).filter(Boolean))].sort();
}

export function parseListText(value: unknown): string[] {
  return normalizeList(value, []);
}

export function normalizeSmartDnsPolicy(input: Partial<SmartDnsPolicy>): SmartDnsPolicy {
  const defaultRoute = input.defaultRoute === "direct" ? "direct" : "proxy";
  const localDefaultRoute = input.localDefaultRoute === "proxy" ? "proxy" : "direct";
  return {
    defaultRoute,
    localDefaultRoute,
    directSuffixes: normalizeList(input.directSuffixes, DEFAULT_SMART_DNS_POLICY.directSuffixes),
    directDomains: normalizeList(input.directDomains, DEFAULT_SMART_DNS_POLICY.directDomains),
    proxySuffixes: normalizeList(input.proxySuffixes, DEFAULT_SMART_DNS_POLICY.proxySuffixes),
    proxyDomains: normalizeList(input.proxyDomains, DEFAULT_SMART_DNS_POLICY.proxyDomains),
    localProxySuffixes: normalizeList(input.localProxySuffixes, DEFAULT_SMART_DNS_POLICY.localProxySuffixes),
    localProxyDomains: normalizeList(input.localProxyDomains, DEFAULT_SMART_DNS_POLICY.localProxyDomains),
    vusaProxySuffixes: normalizeList(input.vusaProxySuffixes, DEFAULT_SMART_DNS_POLICY.vusaProxySuffixes),
    vusaProxyDomains: normalizeList(input.vusaProxyDomains, DEFAULT_SMART_DNS_POLICY.vusaProxyDomains),
    updatedAt: input.updatedAt,
  };
}

const POLICY_READ_ATTEMPTS = 3;
const POLICY_READ_RETRY_MS = 20;

function waitForPolicyWrite(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, POLICY_READ_RETRY_MS));
}

export async function loadSmartDnsPolicy(file = smartDnsPolicyPath()): Promise<SmartDnsPolicy> {
  for (let attempt = 1; attempt <= POLICY_READ_ATTEMPTS; attempt += 1) {
    try {
      const raw = await readFile(file, "utf8");
      return normalizeSmartDnsPolicy(JSON.parse(raw));
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return normalizeSmartDnsPolicy(DEFAULT_SMART_DNS_POLICY);
      }
      if (err instanceof SyntaxError && attempt < POLICY_READ_ATTEMPTS) {
        // A legacy writer may briefly expose a partial JSON document.
        await waitForPolicyWrite();
        continue;
      }
      throw err;
    }
  }
  throw new Error(`unable to load SmartDNS policy from ${file}`);
}

export async function saveSmartDnsPolicy(policy: SmartDnsPolicy, file = smartDnsPolicyPath()): Promise<SmartDnsPolicy> {
  const normalized = normalizeSmartDnsPolicy({ ...policy, updatedAt: new Date().toISOString() });
  // The protected /etc/vpn-panel directory must stay non-writable because it also
  // contains credentials. Readers retry briefly to cover this small direct write.
  await writeFile(file, JSON.stringify(normalized, null, 2) + "\n", "utf8");
  return normalized;
}

function hasSuffix(host: string, suffixes: string[]): string | null {
  const h = normalizeHost(host);
  for (const s of suffixes) {
    if (h === s || h.endsWith(`.${s}`)) return s;
  }
  return null;
}

export function hostFromInput(input: string): string {
  const raw = input.trim();
  if (!raw) throw new Error("empty input");
  try {
    const url = raw.includes("://") ? new URL(raw) : new URL(`https://${raw}`);
    return normalizeHost(url.hostname);
  } catch {
    return normalizeHost(raw.split(/[/?#]/, 1)[0] || raw);
  }
}

export function checkSmartDnsRoute(input: string, policy: SmartDnsPolicy): SmartDnsRouteCheck {
  const host = hostFromInput(input);
  if (!host) throw new Error("cannot parse host");
  if (policy.directDomains.includes(host)) {
    return resolvedCheck(input, host, "direct", "directDomains exact match", host);
  }
  const directSuffix = hasSuffix(host, policy.directSuffixes);
  if (directSuffix) {
    return resolvedCheck(input, host, "direct", "directSuffixes match", directSuffix);
  }
  if (policy.localProxyDomains.includes(host)) {
    return localProxyCheck(input, host, "localProxyDomains exact match", host);
  }
  const localProxySuffix = hasSuffix(host, policy.localProxySuffixes);
  if (localProxySuffix) {
    return localProxyCheck(input, host, "localProxySuffixes match", localProxySuffix);
  }
  if (policy.vusaProxyDomains.includes(host)) {
    return vusaProxyCheck(input, host, "vusaProxyDomains exact match", host);
  }
  const vusaProxySuffix = hasSuffix(host, policy.vusaProxySuffixes);
  if (vusaProxySuffix) {
    return vusaProxyCheck(input, host, "vusaProxySuffixes match", vusaProxySuffix);
  }
  if (policy.proxyDomains.includes(host)) {
    return resolvedCheck(input, host, "proxy", "proxyDomains exact match", host);
  }
  const proxySuffix = hasSuffix(host, policy.proxySuffixes);
  if (proxySuffix) {
    return resolvedCheck(input, host, "proxy", "proxySuffixes match", proxySuffix);
  }
  return {
    input,
    host,
    route: policy.defaultRoute,
    localRoute: policy.localDefaultRoute,
    publicRoute: policy.defaultRoute,
    publicEdgeProfile: policy.defaultRoute === "proxy" ? "public" : null,
    reason: "profile defaultRoute",
    matched: `local=${policy.localDefaultRoute}, public=${policy.defaultRoute}`,
  };
}

function resolvedCheck(input: string, host: string, route: SmartDnsResolvedRoute, reason: string, matched: string): SmartDnsRouteCheck {
  return { input, host, route, localRoute: route, publicRoute: route, publicEdgeProfile: route === "proxy" ? "public" : null, reason, matched };
}

function vusaProxyCheck(input: string, host: string, reason: string, matched: string): SmartDnsRouteCheck {
  return { input, host, route: "vusa-proxy", localRoute: "proxy", publicRoute: "proxy", publicEdgeProfile: "vusa", reason, matched };
}

function localProxyCheck(input: string, host: string, reason: string, matched: string): SmartDnsRouteCheck {
  return { input, host, route: "local-proxy", localRoute: "proxy", publicRoute: "direct", publicEdgeProfile: null, reason, matched };
}

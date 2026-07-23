import { readFile } from "node:fs/promises";
import { z } from "zod";

const nodeSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  enabled: z.boolean().default(true),
  kind: z.string().default("vless-reality"),
  address: z.string(),
  port: z.coerce.number().int().positive(),
  public_key: z.string().optional(),
  short_id: z.string().optional(),
  profiles: z.array(z.string()).optional(),
  flow: z.string().optional(),
  sni: z.string().optional(),
  fingerprint: z.string().optional(),
  fragment: z.string().optional(),
  noises: z.string().optional(),
  query: z.record(z.string(), z.string()).optional(),
});

const secureConfigSchema = z.object({
  defaults: z
    .object({
      fingerprint: z.string().default("firefox"),
      flow: z.string().default("xtls-rprx-vision"),
      sni: z.string().default("ya.ru"),
      domain_strategy: z.string().default("IPIfNonMatch"),
      fragment: z.string().optional(),
      noises: z.string().optional(),
    })
    .default({
      fingerprint: "firefox",
      flow: "xtls-rprx-vision",
      sni: "ya.ru",
      domain_strategy: "IPIfNonMatch",
    }),
  nodes: z.array(nodeSchema),
  server_configs: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  happ: z
    .object({
      provider_code: z.string().default("example-provider-code"),
      auth_key: z.string().default(""),
      base_url: z.string().default("https://happ-proxy.com"),
    })
    .default({
      provider_code: "example-provider-code",
      auth_key: "",
      base_url: "https://happ-proxy.com",
    }),
  vps: z
    .object({
      host: z.string().default(""),
      port: z.coerce.number().int().default(22),
      username: z.string().default("root"),
      password: z.string().default(""),
      private_key: z.string().default(""),
      passphrase: z.string().default(""),
      label: z.string().default("VPS"),
    })
    .default({
      host: "",
      port: 22,
      username: "root",
      password: "",
      private_key: "",
      passphrase: "",
      label: "VPS",
    }),
  vps_list: z
    .array(
      z.object({
        id: z.string(),
        host: z.string(),
        port: z.coerce.number().int().default(22),
        username: z.string().default("root"),
        password: z.string().default(""),
        private_key: z.string().default(""),
        passphrase: z.string().default(""),
        label: z.string(),
      }),
    )
    .default([]),
});

export type SecureNode = z.infer<typeof nodeSchema>;
export type SecureConfig = z.infer<typeof secureConfigSchema>;

export async function loadSecureConfig(path: string): Promise<SecureConfig> {
  const raw = await readFile(path, "utf8");
  return secureConfigSchema.parse(JSON.parse(raw));
}

export function endpointProfile(node: SecureNode): string {
  return node.profiles?.[0] || node.id;
}

/** Stable products shown to users. Transport selection happens behind each relay. */
export const endpointOrder = [
  "smart-de-relay", // RU/private direct; all other traffic exits through DE
  "full-de-relay",  // all traffic exits through DE
  "smart-us-relay", // RU/private direct; all other traffic exits through US
  "full-us-relay",  // all traffic exits through US
] as const;

/** Safari-profile variants that keep the stable primary ingress for mobile networks. */
export const mobileRelayEndpointOrder = [
  "smart-de-relay-mobile",
  "full-de-relay-mobile",
  "smart-us-relay-mobile",
  "full-us-relay-mobile",
] as const;

/**
 * Low-level routes retained for health checks and admin diagnostics.
 *
 * VUSA keeps several independent public-443 transports plus a high-port H2
 * fallback so restrictive mobile networks never depend on :28443.
 */
export const diagnosticEndpointOrder = [
  "de-direct",
  "de-xhttp",
  "de-xhttp-h2",
  "de-direct-ws",
  "de-cdn",
  "de-cdn2",
  "de-httpupgrade",
  "de-grpc",
  "us-reality",
  "us-xhttp",
  "us-xhttp-h2-443",
  "us-httpupgrade",
  "us-direct-ws",
  "us-grpc",
  "us-cdn",
  "us-cdn2",
  "us-xhttp-h2",
] as const;

/** Previously advertised direct transports restored as client fallbacks. */
export const legacyFallbackEndpointOrder = [
  "de-httpupgrade",
  "de-direct-ws",
  "de-xhttp",
  "de-grpc",
  "de-cdn",
  "de-cdn2",
  "de-xhttp-h2",
  "us-reality",
  "us-xhttp",
  "us-xhttp-h2-443",
  "us-httpupgrade",
  "us-direct-ws",
  "us-grpc",
  "us-cdn",
  "us-cdn2",
  "us-xhttp-h2",
  "de-direct",
] as const;

/** Stable subscription order: direct products, mobile relay entrances, then low-level fallbacks. */
export const subscriptionEndpointOrder = [...endpointOrder, ...mobileRelayEndpointOrder, ...legacyFallbackEndpointOrder] as const;

const userFacingEndpointIds: ReadonlySet<string> = new Set(endpointOrder);

/** Return whether an endpoint is part of the supported four-product catalog. */
export function isUserFacingEndpoint(id: string): boolean {
  return userFacingEndpointIds.has(id);
}

const subscriptionEndpointIds: ReadonlySet<string> = new Set(subscriptionEndpointOrder);

/** Return whether an endpoint is emitted in normal client subscriptions. */
export function isSubscriptionEndpoint(id: string): boolean {
  return subscriptionEndpointIds.has(id);
}

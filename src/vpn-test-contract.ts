import { z } from "zod";

/** The runtime client or daemon that owns the tested connection. */
export const vpnTestClientSchema = z.enum(["xray", "sing-box", "smartdns"]);

/** The local access protocol used by the benchmark. */
export const vpnTestAccessMethodSchema = z.enum(["http-proxy", "socks-proxy", "smart-http", "dns"]);

/** The physical/network path used to reach the client under test. */
export const vpnTestWireMethodSchema = z.enum(["4g", "wire-internal", "wire-external", "unknown"]);

/** The concrete machine or device role running the client. */
export const vpnTestHostRoleSchema = z.enum(["worker-lan", "worker-dev", "worker-main", "mac", "android"]);

export type VpnTestClient = z.infer<typeof vpnTestClientSchema>;
export type VpnTestAccessMethod = z.infer<typeof vpnTestAccessMethodSchema>;
export type VpnTestWireMethod = z.infer<typeof vpnTestWireMethodSchema>;
export type VpnTestHostRole = z.infer<typeof vpnTestHostRoleSchema>;

/** Convert the explicit wire dimension to the persisted legacy network class. */
export function networkClassForWireMethod(wireMethod: VpnTestWireMethod): "lan" | "external-wired" | "external-mobile" | "external-unknown" {
  if (wireMethod === "4g") return "external-mobile";
  if (wireMethod === "wire-external") return "external-wired";
  if (wireMethod === "unknown") return "external-unknown";
  return "lan";
}

/** Require the dimensions to describe one physically coherent test target. */
export function assertVpnTestTargetDimensions(input: {
  networkClass: string;
  client: VpnTestClient;
  accessMethod: VpnTestAccessMethod;
  wireMethod: VpnTestWireMethod;
}): void {
  const expected = networkClassForWireMethod(input.wireMethod);
  if (input.networkClass !== expected) {
    throw new Error(`wireMethod ${input.wireMethod} requires networkClass ${expected}, got ${input.networkClass}`);
  }
}

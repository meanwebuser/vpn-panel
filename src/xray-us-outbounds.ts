import type { SecureConfig } from "./secure-config.js";

type UsOutboundTransport = "reality" | "xhttp" | "xhttp-h2-443" | "httpupgrade" | "ws" | "grpc" | "cdn" | "cdn2" | "xhttp-h2";

const US_RELAY_TRANSPORTS: UsOutboundTransport[] = ["reality", "xhttp", "xhttp-h2-443", "httpupgrade", "ws", "grpc", "cdn", "cdn2", "xhttp-h2"];

function usOutbound(
  serverConfig: Record<string, unknown>,
  defaults: SecureConfig["defaults"],
  transport: UsOutboundTransport,
  tag: string,
): Record<string, unknown> {
  const vusaAddress = String(serverConfig.us_address || "edge-us.example.com");
  const address = transport === "cdn"
    ? String(serverConfig.us_cdn_address || "us-cdn.example.com")
    : transport === "cdn2"
      ? String(serverConfig.us_cdn2_address || "us-cdn2.example.com")
      : vusaAddress;
  const uuid = String(serverConfig.us_relay_uuid || serverConfig.relay_uuid || "");
  const fingerprint = String(
    transport === "cdn" || transport === "cdn2"
      ? (serverConfig.us_cdn_fingerprint || "ios")
      : (serverConfig.us_fingerprint || defaults.fingerprint),
  );
  const base: Record<string, unknown> = {
    tag,
    protocol: "vless",
    settings: { vnext: [{ address, port: 443, users: [{ id: uuid, encryption: "none" }] }] },
  };

  if (transport === "reality") {
    return {
      ...base,
      streamSettings: {
        network: "tcp",
        security: "reality",
        realitySettings: {
          serverName: String(serverConfig.us_sni || "www.google.com"),
          fingerprint,
          publicKey: String(serverConfig.us_public_key || ""),
          shortId: String(serverConfig.us_short_id || ""),
        },
      },
    };
  }
  if (transport === "xhttp") {
    return {
      ...base,
      streamSettings: {
        network: "xhttp",
        security: "tls",
        tlsSettings: { serverName: vusaAddress, fingerprint },
        xhttpSettings: { host: vusaAddress, path: String(serverConfig.us_xhttp_path || "/xhttp"), mode: "auto", h2: false },
      },
    };
  }
  if (transport === "xhttp-h2-443") {
    return {
      ...base,
      streamSettings: {
        network: "xhttp",
        security: "tls",
        tlsSettings: { serverName: vusaAddress, fingerprint, alpn: ["h2"] },
        xhttpSettings: {
          host: vusaAddress,
          path: String(serverConfig.us_xhttp_h2_443_path || "/xhttp-h2-443"),
          mode: "stream-up",
          h2: true,
        },
      },
    };
  }
  if (transport === "httpupgrade") {
    return {
      ...base,
      streamSettings: {
        network: "httpupgrade",
        security: "tls",
        tlsSettings: { serverName: vusaAddress, fingerprint },
        httpupgradeSettings: { host: vusaAddress, path: String(serverConfig.us_hup_path || "/hup") },
      },
    };
  }
  if (transport === "grpc") {
    return {
      ...base,
      streamSettings: {
        network: "grpc",
        security: "tls",
        tlsSettings: { serverName: vusaAddress, fingerprint },
        grpcSettings: { serviceName: String(serverConfig.us_grpc_path || "/grpc"), multiMode: true },
      },
    };
  }
  if (transport === "ws" || transport === "cdn" || transport === "cdn2") {
    const path = transport === "cdn"
      ? String(serverConfig.us_cdn_path || "/cdn-ws")
      : transport === "cdn2"
        ? String(serverConfig.us_cdn2_path || "/cdn2-ws")
        : String(serverConfig.us_ws_path || "/direct-ws");
    return {
      ...base,
      streamSettings: {
        network: "ws",
        security: "tls",
        tlsSettings: { serverName: vusaAddress, fingerprint, alpn: ["http/1.1"] },
        wsSettings: { path, host: address },
      },
    };
  }
  return {
    ...base,
    settings: {
      vnext: [{
        address: vusaAddress,
        port: Number(serverConfig.us_xhttp_h2_port || 28443),
        users: [{ id: uuid, encryption: "none" }],
      }],
    },
    streamSettings: {
      network: "xhttp",
      security: "tls",
      tlsSettings: { serverName: vusaAddress, fingerprint, alpn: ["h2"] },
      xhttpSettings: {
        host: vusaAddress,
        path: String(serverConfig.us_xhttp_h2_path || "/xhttp-h2"),
        mode: "stream-up",
        h2: true,
      },
    },
  };
}

/** Generate all independent US outbounds used by regional and LAN balancers. */
export function usMultiOutbounds(
  serverConfig: Record<string, unknown>,
  defaults: SecureConfig["defaults"],
): { outbounds: Record<string, unknown>[]; balancerTags: string[] } {
  const outbounds: Record<string, unknown>[] = [];
  const balancerTags: string[] = [];
  for (const transport of US_RELAY_TRANSPORTS) {
    const tag = `to-us-${transport}`;
    outbounds.push(usOutbound(serverConfig, defaults, transport, tag));
    balancerTags.push(tag);
  }
  return { outbounds, balancerTags };
}

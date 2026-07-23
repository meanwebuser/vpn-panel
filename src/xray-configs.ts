import type { DbPool } from "./db.js";
import type { SecureConfig, SecureNode } from "./secure-config.js";
import { usMultiOutbounds } from "./xray-us-outbounds.js";

export type XrayClient = {
  id: string;
  email?: string;
  flow?: string;
};

export async function clientsForEndpoint(pool: DbPool, endpointId: string): Promise<XrayClient[]> {
  const result = await pool.query(
    `select vc.xray_uuid::text as id, a.login as email
     from client_profiles cp
     join vpn_clients vc on vc.id = cp.client_id
     join accounts a on a.id = vc.account_id
     where cp.endpoint_id = $1 and vc.enabled = true and a.enabled = true
     order by a.login`,
    [endpointId],
  );
  return result.rows;
}

async function allEnabledClients(pool: DbPool): Promise<XrayClient[]> {
  const result = await pool.query(
    `select vc.xray_uuid::text as id, a.login as email
     from vpn_clients vc
     join accounts a on a.id = vc.account_id
     where vc.enabled = true and a.enabled = true
     order by a.login`,
  );
  return result.rows;
}

function relayClientFromConfig(
  serverConfig: Record<string, unknown>,
  defaults: SecureConfig["defaults"],
): XrayClient | undefined {
  const configured = serverConfig.relay_client as Record<string, string> | undefined;
  const id = configured?.id || (serverConfig.relay_uuid ? String(serverConfig.relay_uuid) : "");
  if (!id) return undefined;
  return {
    id,
    email: configured?.email || "ru-relay",
    flow: configured?.flow || String(serverConfig.relay_flow || defaults.flow),
  };
}

function appendUniqueClient(clients: XrayClient[], client: XrayClient | undefined): XrayClient[] {
  if (!client) return clients;
  if (clients.some((existing) => existing.id === client.id)) return clients;
  return [...clients, client];
}

function xrayUdpSniffing(): Record<string, unknown> {
  return {
    enabled: true,
    destOverride: ["http", "tls", "quic"],
    routeOnly: false,
  };
}

function clientEntry(client: XrayClient, defaultFlow: string): Record<string, string> {
  return {
    id: client.id,
    email: client.email || client.id,
    flow: client.flow || defaultFlow,
  };
}

function realityInbound(input: {
  tag: string;
  listenPort: number;
  privateKey: string;
  serverNames: string[];
  shortIds: string[];
  clients: XrayClient[];
  defaultFlow: string;
  dest: string;
  xver: number;
  listen?: string;
  sniffing?: boolean;
}): Record<string, unknown> {
  const inbound: Record<string, unknown> = {
    tag: input.tag,
    ...(input.listen ? { listen: input.listen } : {}),
    port: input.listenPort,
    protocol: "vless",
    settings: {
      clients: input.clients.map((client) => clientEntry(client, input.defaultFlow)),
      decryption: "none",
    },
    streamSettings: {
      network: "tcp",
      security: "reality",
      realitySettings: {
        show: false,
        dest: input.dest,
        xver: input.xver,
        serverNames: input.serverNames,
        privateKey: input.privateKey,
        shortIds: input.shortIds,
      },
    },
  };
  if (input.sniffing !== false) {
    inbound.sniffing = xrayUdpSniffing();
  }
  return inbound;
}

function clientSettings(clients: XrayClient[], defaultFlow?: string): Record<string, unknown> {
  return {
    clients: clients.map((client) => {
      const entry: Record<string, string> = {
        id: client.id,
        email: client.email || client.id,
      };
      if (defaultFlow) {
        entry.flow = client.flow || defaultFlow;
      }
      return entry;
    }),
    decryption: "none",
  };
}

type PathNetwork = "xhttp" | "ws" | "grpc" | "httpupgrade";

function pathInbound(input: {
  tag: string;
  port: number;
  clients: XrayClient[];
  network: PathNetwork;
  host: string;
  path: string;
  xhttpMode?: "auto" | "stream-up" | "packet-up";
  xhttpH2?: boolean;
  listen?: string;
}): Record<string, unknown> {
  let streamSettingsExtra: Record<string, unknown>;
  if (input.network === "xhttp") {
    streamSettingsExtra = {
      xhttpSettings: {
        host: input.host,
        path: input.path,
        mode: input.xhttpMode || "auto",
        ...(input.xhttpH2 === undefined ? {} : { h2: input.xhttpH2 }),
      },
    };
  } else if (input.network === "ws") {
    streamSettingsExtra = { wsSettings: { path: input.path, host: input.host } };
  } else if (input.network === "grpc") {
    streamSettingsExtra = { grpcSettings: { serviceName: input.path, multiMode: true } };
  } else {
    streamSettingsExtra = { httpupgradeSettings: { host: input.host, path: input.path } };
  }

  return {
    tag: input.tag,
    listen: input.listen || "127.0.0.1",
    port: input.port,
    protocol: "vless",
    settings: clientSettings(input.clients),
    streamSettings: {
      network: input.network,
      security: "none",
      ...(["xhttp", "ws"].includes(input.network) ? { sockopt: { trustedXForwardedFor: ["X-Forwarded-For"] } } : {}),
      ...streamSettingsExtra,
    },
    sniffing: xrayUdpSniffing(),
  };
}

function directTlsXhttpInbound(input: {
  tag: string;
  port: number;
  clients: XrayClient[];
  host: string;
  path: string;
  certFile: string;
  keyFile: string;
  mode: "stream-up" | "packet-up";
  h2: boolean;
  listen?: string;
}): Record<string, unknown> {
  return {
    tag: input.tag,
    listen: input.listen || "0.0.0.0",
    port: input.port,
    protocol: "vless",
    settings: clientSettings(input.clients),
    streamSettings: {
      network: "xhttp",
      security: "tls",
      tlsSettings: {
        certificates: [
          {
            certificateFile: input.certFile,
            keyFile: input.keyFile,
          },
        ],
        alpn: ["h2", "http/1.1"],
      },
      // Xray 26.6 requires a non-empty trust marker for HTTP transports.
      // NUL is not a valid HTTP header name, so no direct client can satisfy it
      // and therefore no client-supplied XFF can replace the peer address.
      sockopt: { trustedXForwardedFor: ["\u0000"] },
      xhttpSettings: {
        host: input.host,
        path: input.path,
        mode: input.mode,
        h2: input.h2,
      },
    },
    sniffing: xrayUdpSniffing(),
  };
}

function endpointNode(secure: SecureConfig, endpointId: string): SecureNode | undefined {
  return secure.nodes.find((node) => node.id === endpointId && node.enabled);
}

export async function deServerConfig(pool: DbPool, secure: SecureConfig): Promise<Record<string, unknown>> {
  const defaults = secure.defaults;
  const serverConfig = secure.server_configs.de || {};
  const relayClient = relayClientFromConfig(serverConfig, defaults);
  const clients = appendUniqueClient(await clientsForEndpoint(pool, "de-direct"), relayClient);

  const inbounds: Array<Record<string, unknown>> = [
    realityInbound({
      tag: "de-reality",
      listenPort: Number(serverConfig.listen_port || 23443),
      privateKey: String(serverConfig.private_key || ""),
      serverNames: (serverConfig.server_names as string[] | undefined) || [defaults.sni],
      shortIds: (serverConfig.short_ids as string[] | undefined) || [],
      clients,
      defaultFlow: defaults.flow,
      dest: String(serverConfig.dest || "127.0.0.1:8443"),
      xver: Number(serverConfig.xver || 0),
    }),
  ];

  const xhttpNode = endpointNode(secure, "de-xhttp");
  if (xhttpNode) {
    const xhttpClients = appendUniqueClient(await clientsForEndpoint(pool, "de-xhttp"), relayClient);
    inbounds.push(
      pathInbound({
        tag: "de-xhttp",
        port: Number((serverConfig.xhttp_listen_port as number | undefined) || 20080),
        clients: xhttpClients,
        network: "xhttp",
        host: xhttpNode.address,
        path: String(xhttpNode.query?.path || "/xhttp"),
      }),
    );
  }

  const cdnNode = endpointNode(secure, "de-cdn");
  if (cdnNode) {
    const cdnClients = appendUniqueClient(await clientsForEndpoint(pool, "de-cdn"), relayClient);
    inbounds.push(
      pathInbound({
        tag: "de-cdn",
        port: Number((serverConfig.cdn_listen_port as number | undefined) || 20081),
        clients: cdnClients,
        network: "ws",
        host: cdnNode.address,
        path: String(cdnNode.query?.path || "/cdn-ws"),
      }),
    );
  }

  const cdn2Node = endpointNode(secure, "de-cdn2");
  if (cdn2Node) {
    const cdn2Clients = appendUniqueClient(await clientsForEndpoint(pool, "de-cdn2"), relayClient);
    inbounds.push(
      pathInbound({
        tag: "de-cdn2",
        port: Number((serverConfig.cdn2_listen_port as number | undefined) || 20084),
        clients: cdn2Clients,
        network: "ws",
        host: cdn2Node.address,
        path: String(cdn2Node.query?.path || "/cdn2-ws"),
      }),
    );
  }

  const grpcNode = endpointNode(secure, "de-grpc");
  if (grpcNode) {
    const grpcClients = appendUniqueClient(await clientsForEndpoint(pool, "de-grpc"), relayClient);
    inbounds.push(
      pathInbound({
        tag: "de-grpc",
        port: Number((serverConfig.grpc_listen_port as number | undefined) || 20082),
        clients: grpcClients,
        network: "grpc",
        host: grpcNode.address,
        path: String(grpcNode.query?.serviceName || "/grpc"),
      }),
    );
  }

  const hupNode = endpointNode(secure, "de-httpupgrade");
  if (hupNode) {
    const hupClients = appendUniqueClient(await clientsForEndpoint(pool, "de-httpupgrade"), relayClient);
    inbounds.push(
      pathInbound({
        tag: "de-httpupgrade",
        port: Number((serverConfig.httpupgrade_listen_port as number | undefined) || 20083),
        clients: hupClients,
        network: "httpupgrade",
        host: hupNode.address,
        path: String(hupNode.query?.path || "/hup"),
      }),
    );
  }

  // API inbound for xray stats/management
  const apiPort = Number(serverConfig.api_port || 10085);
  inbounds.push({
    tag: "api",
    listen: "127.0.0.1",
    port: apiPort,
    protocol: "dokodemo-door",
    settings: { address: "" },
  });

  // Direct WS endpoint (no CloudFlare CDN, sing-box compatible)
  const directWsNode = endpointNode(secure, "de-direct-ws");
  if (directWsNode) {
    const directWsClients = appendUniqueClient(await clientsForEndpoint(pool, "de-direct-ws"), relayClient);
    inbounds.push(
      pathInbound({
        tag: "de-direct-ws",
        port: Number((serverConfig.direct_ws_listen_port as number | undefined) || 20085),
        clients: directWsClients,
        network: "ws",
        host: directWsNode.address,
        path: String(directWsNode.query?.path || "/direct-ws"),
      }),
    );
  }

  // Direct XHTTP H2 (stream-up H2) endpoint on public port, no nginx needed.
  // Terminates TLS directly at Xray using the Let's Encrypt cert for vpn2.
  const xhttpH2Node = endpointNode(secure, "de-xhttp-h2");
  if (xhttpH2Node) {
    const xhttpH2Clients = appendUniqueClient(await clientsForEndpoint(pool, "de-xhttp-h2"), relayClient);
    inbounds.push(
      directTlsXhttpInbound({
        tag: "de-xhttp-h2",
        port: Number((serverConfig.xhttp_h2_listen_port as number | undefined) || 28443),
        clients: xhttpH2Clients,
        host: xhttpH2Node.address,
        path: String(xhttpH2Node.query?.path || "/xhttp-h2"),
        certFile: String(
          serverConfig.xhttp_h2_cert || "/etc/letsencrypt/live/edge-de.example.com/fullchain.pem",
        ),
        keyFile: String(
          serverConfig.xhttp_h2_key || "/etc/letsencrypt/live/edge-de.example.com/privkey.pem",
        ),
        mode: "stream-up",
        h2: true,
      }),
    );
  }

  return {
    log: { loglevel: "warning" },
    inbounds,
    outbounds: [
      { tag: "direct", protocol: "freedom" },
      { tag: "block", protocol: "blackhole" },
    ],
    api: {
      services: ["HandlerService", "StatsService"],
      tag: "api",
    },
    stats: {},
    policy: {
      levels: {
        "0": {
          statsUserUplink: true,
          statsUserDownlink: true,
          statsUserOnline: true,
        },
      },
      system: {
        statsInboundUplink: true,
        statsInboundDownlink: true,
        statsOutboundUplink: true,
        statsOutboundDownlink: true,
      },
    },
    routing: {
      rules: [
        {
          type: "field",
          inboundTag: ["api"],
          outboundTag: "api",
        },
      ],
    },
  };
}

export async function usServerConfig(pool: DbPool, secure: SecureConfig): Promise<Record<string, unknown>> {
  const defaults = secure.defaults;
  const serverConfig = secure.server_configs.us || {};
  const ruRelayConfig = { ...(secure.server_configs.ru || {}), ...(secure.server_configs["ru-combined"] || {}) };
  const relayClient = relayClientFromConfig(serverConfig, defaults) || relayClientFromConfig(ruRelayConfig, defaults);
  const inbounds: Array<Record<string, unknown>> = [];

  // All VUSA transports share one client set. Separate profile queries caused
  // healthy listeners to reject probes whenever endpoint assignments drifted.
  // VUSA deliberately mirrors the complete active VPN2 user set. Endpoint
  // profile drift must never produce different UUID lists between transports.
  const clients = appendUniqueClient(await allEnabledClients(pool), relayClient);

  const usRealityNode = endpointNode(secure, "us-reality");
  if (usRealityNode) {
    inbounds.push(
      realityInbound({
        tag: "us-reality",
        listen: String(serverConfig.listen_address || "127.0.0.1"),
        listenPort: Number(serverConfig.listen_port || 23443),
        privateKey: String(serverConfig.private_key || ""),
        serverNames: (serverConfig.server_names as string[] | undefined) || ["www.google.com", "google.com"],
        shortIds: (serverConfig.short_ids as string[] | undefined) || [],
        clients,
        defaultFlow: defaults.flow,
        dest: String(serverConfig.dest || "www.google.com:443"),
        xver: Number(serverConfig.xver ?? 0),
      }),
    );
  }

  const usXhttpNode = endpointNode(secure, "us-xhttp");
  if (usXhttpNode) {
    inbounds.push(
      pathInbound({
        tag: "us-xhttp",
        port: Number((serverConfig.xhttp_listen_port as number | undefined) || 20080),
        clients,
        network: "xhttp",
        host: usXhttpNode.address,
        path: String(usXhttpNode.query?.path || "/xhttp"),
        xhttpMode: "auto",
        xhttpH2: false,
      }),
    );
  }

  const usXhttpH2On443Node = endpointNode(secure, "us-xhttp-h2-443");
  if (usXhttpH2On443Node) {
    inbounds.push(
      pathInbound({
        tag: "us-xhttp-h2-443",
        port: Number((serverConfig.xhttp_h2_443_listen_port as number | undefined) || 20087),
        clients,
        network: "xhttp",
        host: usXhttpH2On443Node.address,
        path: String(usXhttpH2On443Node.query?.path || "/xhttp-h2-443"),
        // Public HTTP/2 terminates at nginx; its loopback hop to Xray is HTTP/1.1.
        xhttpMode: "auto",
        xhttpH2: false,
      }),
    );
  }

  const usCdnNode = endpointNode(secure, "us-cdn");
  if (usCdnNode) {
    inbounds.push(pathInbound({
      tag: "us-cdn",
      port: Number((serverConfig.cdn_listen_port as number | undefined) || 20081),
      clients,
      network: "ws",
      host: usCdnNode.address,
      path: String(usCdnNode.query?.path || "/cdn-ws"),
    }));
  }

  const usGrpcNode = endpointNode(secure, "us-grpc");
  if (usGrpcNode) {
    inbounds.push(pathInbound({
      tag: "us-grpc",
      port: Number((serverConfig.grpc_listen_port as number | undefined) || 20082),
      clients,
      network: "grpc",
      host: usGrpcNode.address,
      path: String(usGrpcNode.query?.serviceName || "/grpc"),
    }));
  }

  const usHupNode = endpointNode(secure, "us-httpupgrade");
  if (usHupNode) {
    inbounds.push(pathInbound({
      tag: "us-httpupgrade",
      port: Number((serverConfig.httpupgrade_listen_port as number | undefined) || 20083),
      clients,
      network: "httpupgrade",
      host: usHupNode.address,
      path: String(usHupNode.query?.path || "/hup"),
    }));
  }

  const usCdn2Node = endpointNode(secure, "us-cdn2");
  if (usCdn2Node) {
    inbounds.push(pathInbound({
      tag: "us-cdn2",
      port: Number((serverConfig.cdn2_listen_port as number | undefined) || 20084),
      clients,
      network: "ws",
      host: usCdn2Node.address,
      path: String(usCdn2Node.query?.path || "/cdn2-ws"),
    }));
  }

  const usDirectWsNode = endpointNode(secure, "us-direct-ws");
  if (usDirectWsNode) {
    inbounds.push(
      pathInbound({
        tag: "us-direct-ws",
        port: Number((serverConfig.direct_ws_listen_port as number | undefined) || 20085),
        clients,
        network: "ws",
        host: usDirectWsNode.address,
        path: String(usDirectWsNode.query?.path || "/direct-ws"),
      }),
    );
  }

  // The high-port listener is a last-resort route, not the primary mobile path.
  const usXhttpH2Node = endpointNode(secure, "us-xhttp-h2");
  if (usXhttpH2Node) {
    inbounds.push(
      directTlsXhttpInbound({
        tag: "us-xhttp-h2",
        port: Number((serverConfig.xhttp_h2_listen_port as number | undefined) || 28443),
        clients,
        host: usXhttpH2Node.address,
        path: String(usXhttpH2Node.query?.path || "/xhttp-h2"),
        certFile: String(
          serverConfig.xhttp_h2_cert || "/etc/letsencrypt/live/edge-us.example.com/fullchain.pem",
        ),
        keyFile: String(
          serverConfig.xhttp_h2_key || "/etc/letsencrypt/live/edge-us.example.com/privkey.pem",
        ),
        mode: "stream-up",
        h2: true,
      }),
    );
  }

  const apiPort = Number(serverConfig.api_port || 10085);
  inbounds.push({
    tag: "api",
    listen: "127.0.0.1",
    port: apiPort,
    protocol: "dokodemo-door",
    settings: { address: "" },
  });

  return {
    log: { loglevel: "warning" },
    inbounds,
    outbounds: [
      { tag: "direct", protocol: "freedom" },
      { tag: "block", protocol: "blackhole" },
    ],
    api: {
      services: ["HandlerService", "StatsService"],
      tag: "api",
    },
    stats: {},
    policy: {
      levels: {
        "0": {
          statsUserUplink: true,
          statsUserDownlink: true,
          statsUserOnline: true,
        },
      },
      system: {
        statsInboundUplink: true,
        statsInboundDownlink: true,
        statsOutboundUplink: true,
        statsOutboundDownlink: true,
      },
    },
    routing: {
      rules: [
        { type: "field", inboundTag: ["api"], outboundTag: "api" },
      ],
    },
  };
}

type RelayMode = "smart" | "full";

type RelayConfigInput = {
  endpointId: string;
  tag: string;
  listenPort: number;
  mode: RelayMode;
  balancerTag: "de-auto" | "us-auto";
};

type DeOutboundTransport = "reality" | "xhttp" | "xhttp-h2" | "ws" | "grpc" | "httpupgrade";

// Production selectors contain only independently useful routes. Deprecated or
// repeatedly failing transports remain available as diagnostics, but probing
// them inside every relay caused noisy flapping and bad leastPing selections.
// HTTPUpgrade is first so a cold observatory has a known-good, public-443
// fallback. XHTTP currently stalls under fresh streams and must remain a
// diagnostic transport until that is fixed upstream.
const RELAY_TRANSPORTS: DeOutboundTransport[] = ["httpupgrade", "ws", "reality"];

function deOutboundBase(
  serverConfig: Record<string, unknown>,
  defaults: SecureConfig["defaults"],
  transport: DeOutboundTransport,
  tag: string,
  fingerprintOverride?: string,
): Record<string, unknown> {
  const address = String(serverConfig.de_address || "edge-de.example.com");
  const uuid = String(serverConfig.relay_uuid || "");
  const fingerprint = fingerprintOverride || String(serverConfig.de_fingerprint || defaults.fingerprint);

  const base: Record<string, unknown> = {
    tag,
    protocol: "vless",
    settings: {
      vnext: [
        {
          address,
          port: Number(transport === "reality" ? (serverConfig.de_reality_port || 443) : 443),
          users: [
            {
              id: uuid,
              encryption: "none",
              ...(transport === "reality" ? { flow: String(serverConfig.relay_flow || defaults.flow) } : {}),
            },
          ],
        },
      ],
    },
  };

  if (transport === "reality") {
    return {
      ...base,
      streamSettings: {
        network: "tcp",
        security: "reality",
        realitySettings: {
          serverName: String(serverConfig.de_sni || defaults.sni),
          fingerprint,
          publicKey: String(serverConfig.de_public_key || ""),
          shortId: String(serverConfig.de_short_id || ""),
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
        tlsSettings: { serverName: address, fingerprint },
        xhttpSettings: {
          host: address,
          path: String(serverConfig.de_xhttp_path || serverConfig.de_path || "/xhttp"),
          mode: String(serverConfig.de_mode || "auto"),
          h2: false,
        },
      },
    };
  }

  if (transport === "xhttp-h2") {
    return {
      ...base,
      settings: {
        vnext: [
          {
            address,
            port: Number(serverConfig.de_xhttp_h2_port || 28443),
            users: [{ id: uuid, encryption: "none" }],
          },
        ],
      },
      streamSettings: {
        network: "xhttp",
        security: "tls",
        tlsSettings: {
          serverName: address,
          fingerprint,
          alpn: ["h2"],
        },
        xhttpSettings: {
          host: address,
          path: String(serverConfig.de_xhttp_h2_path || "/xhttp-h2"),
          mode: "stream-up",
          h2: true,
        },
      },
    };
  }

  if (transport === "ws") {
    return {
      ...base,
      streamSettings: {
        network: "ws",
        security: "tls",
        tlsSettings: { serverName: address, fingerprint, alpn: ["http/1.1"] },
        wsSettings: {
          path: String(serverConfig.de_ws_path || "/direct-ws"),
          host: address,
        },
      },
    };
  }

  if (transport === "grpc") {
    return {
      ...base,
      streamSettings: {
        network: "grpc",
        security: "tls",
        tlsSettings: { serverName: address, fingerprint },
        grpcSettings: {
          serviceName: String(serverConfig.de_grpc_path || serverConfig.de_path || "/grpc"),
          multiMode: true,
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
        tlsSettings: { serverName: address, fingerprint },
        httpupgradeSettings: {
          host: address,
          path: String(serverConfig.de_hup_path || serverConfig.de_path || "/hup"),
        },
      },
    };
  }

  return base;
}

function deOutbound(serverConfig: Record<string, unknown>, defaults: SecureConfig["defaults"]): Record<string, unknown> {
  const transport = String(serverConfig.de_transport || "reality") as DeOutboundTransport;
  return deOutboundBase(serverConfig, defaults, transport, "to-de");
}

const REALITY_FINGERPRINTS = ["firefox"] as const;

/** Generate multiple DE outbounds for relay auto-selection + balancer config */
function deMultiOutbounds(
  serverConfig: Record<string, unknown>,
  defaults: SecureConfig["defaults"],
): { outbounds: Record<string, unknown>[]; balancerTags: string[] } {
  const outbounds: Record<string, unknown>[] = [];
  const balancerTags: string[] = [];

  for (const transport of RELAY_TRANSPORTS) {
    if (transport === "reality") {
      // Generate one outbound per fingerprint variant for Reality
      for (const fp of REALITY_FINGERPRINTS) {
        const tag = `to-de-reality-${fp}`;
        outbounds.push(deOutboundBase(serverConfig, defaults, transport, tag, fp));
        balancerTags.push(tag);
      }
    } else {
      const tag = `to-de-${transport}`;
      outbounds.push(deOutboundBase(serverConfig, defaults, transport, tag));
      balancerTags.push(tag);
    }
  }

  return { outbounds, balancerTags };
}

async function ruRelayInbound(
  pool: DbPool,
  secure: SecureConfig,
  serverConfig: Record<string, unknown>,
  input: RelayConfigInput,
): Promise<Record<string, unknown>> {
  const clients = await clientsForEndpoint(pool, input.endpointId);
  return realityInbound({
    tag: input.tag,
    listenPort: input.listenPort,
    privateKey: String(serverConfig.private_key || ""),
    serverNames: (serverConfig.server_names as string[] | undefined) || [secure.defaults.sni],
    shortIds: (serverConfig.short_ids as string[] | undefined) || [],
    clients,
    defaultFlow: secure.defaults.flow,
    dest: String(serverConfig.dest || "127.0.0.1:8443"),
    xver: Number(serverConfig.xver || 0),
    sniffing: true,
  });
}

function ruRelayRules(input: RelayConfigInput): Array<Record<string, unknown>> {
  if (input.mode === "full") {
    return [{ type: "field", inboundTag: [input.tag], network: "tcp,udp", balancerTag: input.balancerTag }];
  }
  return [
    { type: "field", inboundTag: [input.tag], ip: ["geoip:private"], outboundTag: "direct-ru" },
    { type: "field", inboundTag: [input.tag], domain: ["geosite:ru-inside"], outboundTag: "direct-ru" },
    { type: "field", inboundTag: [input.tag], ip: ["geoip:ru"], outboundTag: "direct-ru" },
    { type: "field", inboundTag: [input.tag], network: "tcp,udp", balancerTag: input.balancerTag },
  ];
}

function relayConfigInput(
  endpointId: string,
  listenPort: number,
  mode: RelayMode,
  region: "de" | "us",
): RelayConfigInput {
  return {
    endpointId,
    tag: endpointId,
    listenPort,
    mode,
    balancerTag: `${region}-auto`,
  };
}

/** Generate the canonical four relay profiles with strict country affinity. */
export async function regionalRelayServerConfig(pool: DbPool, secure: SecureConfig): Promise<Record<string, unknown>> {
  const serverConfig = { ...(secure.server_configs.ru || {}), ...(secure.server_configs["regional-relays"] || {}) };
  const relays = [
    relayConfigInput("full-de-relay", Number(serverConfig.full_de_listen_port || 23444), "full", "de"),
    relayConfigInput("smart-de-relay", Number(serverConfig.smart_de_listen_port || 23445), "smart", "de"),
    relayConfigInput("full-us-relay", Number(serverConfig.full_us_listen_port || 23446), "full", "us"),
    relayConfigInput("smart-us-relay", Number(serverConfig.smart_us_listen_port || 23447), "smart", "us"),
  ];
  const de = deMultiOutbounds(serverConfig, secure.defaults);
  const us = usMultiOutbounds(serverConfig, secure.defaults);
  const inbounds = await Promise.all(relays.map((relay) => ruRelayInbound(pool, secure, serverConfig, relay)));
  return {
    log: { loglevel: "warning" },
    inbounds,
    outbounds: [...de.outbounds, ...us.outbounds, { tag: "direct-ru", protocol: "freedom" }, { tag: "block", protocol: "blackhole" }],
    routing: {
      domainStrategy: secure.defaults.domain_strategy,
      balancers: [
        { tag: "de-auto", selector: de.balancerTags, fallbackTag: "to-de-httpupgrade", strategy: { type: "leastPing" } },
        { tag: "us-auto", selector: us.balancerTags, fallbackTag: "to-us-xhttp-h2", strategy: { type: "leastPing" } },
      ],
      rules: relays.flatMap((relay) => ruRelayRules(relay)),
    },
    observatory: {
      subjectSelector: [...de.balancerTags, ...us.balancerTags],
      probeUrl: "https://www.gstatic.com/generate_204",
      probeInterval: "30s",
    },
  };
}
/** @deprecated Use regionalRelayServerConfig; retained temporarily for the old smart-DE deployment ID. */
export async function ruServerConfig(pool: DbPool, secure: SecureConfig): Promise<Record<string, unknown>> {
  const serverConfig = { ...(secure.server_configs.ru || {}), ...(secure.server_configs["ru-smart"] || {}) };
  const smart: RelayConfigInput = {
    endpointId: "ru-smart-relay",
    tag: "ru-smart-relay",
    listenPort: Number(serverConfig.listen_port || 23445),
    mode: "smart",
    balancerTag: "de-auto",
  };
  const de = deMultiOutbounds(serverConfig, secure.defaults);
  return {
    log: { loglevel: "warning" },
    inbounds: [await ruRelayInbound(pool, secure, serverConfig, smart)],
    outbounds: [...de.outbounds, { tag: "direct-ru", protocol: "freedom" }, { tag: "block", protocol: "blackhole" }],
    routing: {
      domainStrategy: secure.defaults.domain_strategy,
      balancers: [{ tag: "de-auto", selector: de.balancerTags, strategy: { type: "leastPing" } }],
      rules: ruRelayRules(smart),
    },
    observatory: {
      subjectSelector: de.balancerTags,
      probeUrl: "https://www.gstatic.com/generate_204",
      probeInterval: "30s",
    },
  };
}

/** @deprecated Use regionalRelayServerConfig; retained temporarily for the old two-inbound DE deployment. */
export async function ruCombinedServerConfig(pool: DbPool, secure: SecureConfig): Promise<Record<string, unknown>> {
  const serverConfig = { ...(secure.server_configs.ru || {}), ...(secure.server_configs["ru-combined"] || {}) };
  const smart: RelayConfigInput = {
    endpointId: "ru-smart-relay",
    tag: "ru-smart-relay",
    listenPort: Number(serverConfig.smart_listen_port || 23445),
    mode: "smart",
    balancerTag: "de-auto",
  };
  const full: RelayConfigInput = {
    endpointId: "ru-full-relay",
    tag: "ru-full-relay",
    listenPort: Number(serverConfig.full_listen_port || 23444),
    mode: "full",
    balancerTag: "de-auto",
  };
  const de = deMultiOutbounds(serverConfig, secure.defaults);
  const [smartInbound, fullInbound] = await Promise.all([
    ruRelayInbound(pool, secure, serverConfig, smart),
    ruRelayInbound(pool, secure, serverConfig, full),
  ]);
  return {
    log: { loglevel: "warning" },
    inbounds: [fullInbound, smartInbound],
    outbounds: [...de.outbounds, { tag: "direct-ru", protocol: "freedom" }, { tag: "block", protocol: "blackhole" }],
    routing: {
      domainStrategy: secure.defaults.domain_strategy,
      balancers: [{ tag: "de-auto", selector: de.balancerTags, strategy: { type: "leastPing" } }],
      rules: [...ruRelayRules(full), ...ruRelayRules(smart)],
    },
    observatory: {
      subjectSelector: de.balancerTags,
      probeUrl: "https://www.gstatic.com/generate_204",
      probeInterval: "30s",
    },
  };
}

/** @deprecated Use regionalRelayServerConfig; retained temporarily for the old full-DE deployment ID. */
export async function ruFullServerConfig(pool: DbPool, secure: SecureConfig): Promise<Record<string, unknown>> {
  const serverConfig = { ...(secure.server_configs.ru || {}), ...(secure.server_configs["ru-full"] || {}) };
  const full: RelayConfigInput = {
    endpointId: "ru-full-relay",
    tag: "ru-full-relay",
    listenPort: Number(serverConfig.listen_port || 23444),
    mode: "full",
    balancerTag: "de-auto",
  };
  const de = deMultiOutbounds(serverConfig, secure.defaults);
  return {
    log: { loglevel: "warning" },
    inbounds: [await ruRelayInbound(pool, secure, serverConfig, full)],
    outbounds: [...de.outbounds, { tag: "direct-ru", protocol: "freedom" }, { tag: "block", protocol: "blackhole" }],
    routing: {
      domainStrategy: secure.defaults.domain_strategy,
      balancers: [{ tag: "de-auto", selector: de.balancerTags, strategy: { type: "leastPing" } }],
      rules: ruRelayRules(full),
    },
    observatory: {
      subjectSelector: de.balancerTags,
      probeUrl: "https://www.gstatic.com/generate_204",
      probeInterval: "30s",
    },
  };
}

export async function serverConfig(
  pool: DbPool,
  secure: SecureConfig,
  serverId: string,
): Promise<Record<string, unknown>> {
  if (serverId === "de") return deServerConfig(pool, secure);
  if (serverId === "ru" || serverId === "ru-smart") return ruServerConfig(pool, secure);
  if (serverId === "ru-combined") return ruCombinedServerConfig(pool, secure);
  if (serverId === "ru-full") return ruFullServerConfig(pool, secure);
  if (serverId === "regional-relays") return regionalRelayServerConfig(pool, secure);
  if (serverId === "us") return usServerConfig(pool, secure);
  throw new Error(`unknown server config: ${serverId}`);
}

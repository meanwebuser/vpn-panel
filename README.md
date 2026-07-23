# VPN Panel — Self-Hosted Smart DNS, Router VPN & VDS Control Panel

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

<img width="1040" height="600" alt="VPN Panel architecture: Smart DNS, router VPN, endpoint monitoring, and VDS control panel" src="https://github.com/user-attachments/assets/fb3ba2ee-cdaf-4c26-a755-ea629e0dcad3" />

VPN Panel is an open-source, self-hosted control plane for **Smart DNS**,
**router-wide VPN routing**, **Xray/sing-box subscriptions**, **endpoint
monitoring**, and **remote VDS management**. It is an extensible
TypeScript/Fastify application for managing VLESS-compatible VPN endpoints,
subscriptions, health checks, and an administrative UI.

It is designed for people who already have compatible VPN endpoints and want
one policy to serve phones, computers, smart TVs, game consoles, and other LAN
devices. The public repository is deployment-neutral: it contains the
application, schemas, migrations, tests, and test-runner core, while production
credentials and infrastructure automation stay in your own environment.

## At a glance

| Question | Short answer |
|---|---|
| What is it? | A self-hosted Smart DNS, router VPN, endpoint monitoring, and VDS control panel. |
| What does it use? | Compatible Xray/sing-box endpoints, VLESS/Reality transports, SmartDNS policy, and a supported router. |
| Who is it for? | Self-hosters, VPN operators, families, and small teams that need per-client or per-domain routing. |
| Does DNS hide DPI/SNI? | No. DPI-sensitive traffic needs a suitable VPN transport; DNS steering alone is not a tunnel. |

## Stop paying twice for Smart DNS

Already using [**Happ**](https://happ.info/),
[**V2Box**](https://apps.apple.com/us/app/v2box-v2ray-client/id6446814690),
[**Streisand**](https://apps.apple.com/us/app/streisand/id6450534064),
[**v2rayNG**](https://github.com/2dust/v2rayNG),
[**NekoBox**](https://github.com/MatsuriDayo/NekoBoxForAndroid), or another
[Xray](https://github.com/XTLS/Xray-core)/[sing-box](https://github.com/SagerNet/sing-box)
client? If your subscription exposes compatible endpoints, you may already
have the transport needed for a personal SmartDNS and routing layer.

This project is a self-hosted alternative to paying separately for:

- [**AETERNIA**](https://aeternia.space/en)-style SmartDNS routing;
- [**Smart DNS Proxy**](https://www.smartdnsproxy.com/) service;
- [**Control D**](https://controld.com/) domain and country routing;
- a paid router-VPN gateway;
- a commercial endpoint monitoring service; and
- a hosted VPN management panel.

No additional SmartDNS subscription is required. You continue paying only for
the VPN subscription or VPS infrastructure that provides your endpoints.

## Frequently asked questions

### Can one router route every device?

On a supported router, yes. DNS and policy-based direct/VPN routing can cover
phones, laptops, TVs, consoles, and IoT devices without installing a VPN app on
each device. Compatibility depends on router firmware, available RAM,
connection count, and the selected routing mode.

### Does SmartDNS bypass DPI and TLS blocking?

Not by itself. SmartDNS changes DNS answers, but public DNS steering does not
hide TLS SNI or create a general VPN tunnel. DPI-sensitive services need a
transport that works on the current ISP and network type.

### Does every Xray or sing-box endpoint work everywhere?

No. Wired internet, 4G, Xray, and sing-box can produce different results.
Endpoint health checks and fallback paths are therefore part of the design.

This repository is a deployment-neutral reference distribution. It contains
application code, schemas, migrations, tests, and the test-runner core. It does
not contain production SSH keys, endpoint credentials, server inventories,
router/HAProxy files, DNS configuration, or deployment automation.

## What it provides

- PostgreSQL-backed admin and user accounts.
- Endpoint catalog and per-client subscription assignment.
- Plain, V2Ray, Xray, and sing-box subscription formats.
- Health and benchmark telemetry with a filterable admin history.
- Configurable test targets: SSH/Docker, native clients, and Android ADB.
- A rootless macOS client bootstrap path that uses values from your own config.

## Requirements

- Node.js 22 or newer
- PostgreSQL 14 or newer
- A local `secure.json` containing your own endpoint catalog

Optional test runners need their own tools: Docker plus Xray/sing-box for
container targets, a native Xray binary for native targets, and Android SDK/ADB
for the Android target. These are never downloaded from this repository.

## Quick start

```bash
git clone https://github.com/meanwebuser/vpn-panel.git
cd vpn-panel
npm ci
cp .env.example .env
cp config/secure.example.json config/secure.json
# Edit .env, config/secure.json, and create the PostgreSQL database.
npm run build
npm run migrate
npm start
```

For local development:

```bash
npm run dev
```

The application listens on `127.0.0.1:3129` by default. Put your own reverse
proxy in front of it if it must be reachable from another machine.

## Configuration

Start with [.env.example](.env.example) and
[config/secure.example.json](config/secure.example.json). The only required
environment variable is `DATABASE_URL`; session, admin, public URL, and health
API settings are documented in [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

Never commit `secure.json`, `.env`, private keys, UUIDs, subscription tokens, or
health API keys.

## Testing

```bash
npm test
npm run build
python3 vpn-testing/test_unified_contract.py
```

See [docs/TESTING.md](docs/TESTING.md) for Docker/native/SSH/ADB target setup.

## Documentation

- [Installation](docs/INSTALLATION.md)
- [Configuration](docs/CONFIGURATION.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Testing](docs/TESTING.md)
- [Security](docs/SECURITY.md)

## License

VPN Panel is released under the [MIT License](LICENSE).

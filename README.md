# VPN Panel

An extensible TypeScript/Fastify control panel for managing VLESS-compatible
VPN endpoints, subscriptions, health checks, and an administrative UI.

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
git clone https://github.com/OWNER/vpn-panel.git
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

Add the license that matches your intended distribution before publishing a
release.

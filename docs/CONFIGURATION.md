# Configuration

Configuration has two layers:

1. Environment variables for the application and secrets.
2. `secure.json` for endpoint and optional SSH/VPS settings.

`DATABASE_URL` is required. Common variables are:

| Variable | Purpose | Default |
|---|---|---|
| `HOST` | Listen address | `127.0.0.1` |
| `PORT` | Listen port | `3129` |
| `VPN_PANEL_PUBLIC_BASE_URL` | Links and telemetry URL | local URL |
| `VPN_PANEL_SECURE_CONFIG` | Secure config path | `/etc/vpn-panel/secure.json` |
| `VPN_PANEL_SESSION_SECRET` | Session signing key | random per start |
| `VPN_PANEL_ADMIN_LOGIN` | Initial admin login | `admin` |
| `VPN_PANEL_ADMIN_PASSWORD` | Initial admin password | unset |
| `VPN_PANEL_HEALTH_API_KEY` | Runner telemetry bearer key | unset |

Copy the example before editing:

```bash
cp config/secure.example.json config/secure.json
```

The secure file contains `nodes`, optional `server_configs`, and optional
`vps_list` entries. Put only public transport metadata in nodes; keep private
keys, passwords, UUIDs, and tokens in the secret store or an ignored file.

The admin UI's test-target selector is an allowlist. A target entry contains a
stable ID, label, runner type, SSH host/port, execution mode, and engine. The
browser submits IDs only; it cannot submit arbitrary SSH destinations.

For a new deployment, start with one local or SSH target and prove it manually
before enabling scheduled health checks.

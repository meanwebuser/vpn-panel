# Installation

## 1. Prepare PostgreSQL

Create a database and a role with access to it. Keep the password outside git.
For a local development database:

```sql
create user vpnpanel with password 'choose-a-local-password';
create database vpn_panel owner vpnpanel;
```

## 2. Install the application

```bash
git clone https://github.com/OWNER/vpn-panel.git
cd vpn-panel
npm ci
cp .env.example .env
cp config/secure.example.json config/secure.json
```

Edit `.env` and `config/secure.json`. At least one enabled node with your own
address and public transport parameters is required before issuing usable
subscriptions.

## 3. Initialize and run

```bash
npm run build
npm run migrate
npm start
```

For a development loop use `npm run dev`. The default listener is local-only;
use a reverse proxy with your own domain and TLS certificate when exposing it.

## Production process

Run the compiled `dist/server.js` under your process supervisor. Set the
working directory to the repository, pass environment variables through the
supervisor's secret mechanism, and restrict `secure.json` to the service user.
Back up the database and `secure.json` before upgrades.

## Upgrade

```bash
git fetch --tags origin
git checkout <release-or-commit>
npm ci
npm run build
npm run migrate
sudo systemctl restart vpn-panel   # adapt to your supervisor
```

If a migration or health check fails, stop the rollout and restore the backup;
the project does not include a provider-specific rollback script.

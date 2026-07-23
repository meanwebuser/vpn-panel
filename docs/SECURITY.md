# Security

This repository is safe to publish only as a code and documentation template.
Before every release, verify that the public tree contains no:

- `.env`, `secure.json`, private keys, passwords, UUIDs, subscription tokens, or
  health API keys;
- real hostnames, public IPs, LAN addresses, SSH usernames, device serials, or
  production service names;
- generated deployment files, router/firewall rules, monitoring results, or
  operational runbooks;
- Git history copied from a private deployment.

Use a fresh repository history for the public copy. Keep production deployment
files in the private repository and provide placeholders plus documented
interfaces here instead.

Rotate any credential immediately if it ever appeared in a commit, even if the
file was later deleted. A GitHub repository's visibility setting is not a
secret-management system.

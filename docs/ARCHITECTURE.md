# Architecture

```text
Browser
  -> Fastify admin/user API
       -> PostgreSQL migrations and repository layer
       -> secure endpoint catalog
       -> subscription renderers
       -> telemetry event storage

Test UI
  -> allowlisted target IDs
       -> runner on a worker
            -> Docker Xray/sing-box, native Xray, or Android ADB
            -> incremental telemetry back to the panel
```

The application owns the product/API contract. A deployment owns its own
reverse proxy, DNS, firewall, system service, VPN nodes, and SSH credentials.
Those operational layers are intentionally absent from this public repository.

The test plan is data-driven. `vpn-testing/unified_runner.py` validates the
plan before running a profile; target metadata controls how the wrapper reaches
the worker, while the endpoint catalog controls what is measured. Test events
are append-only and can be inspected from the admin history.

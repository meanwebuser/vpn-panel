# Testing

## Application checks

```bash
npm test
npm run build
python3 vpn-testing/test_unified_contract.py
```

## Test profiles

- `quick`: preflight and required HTTP gate.
- `health`: gates, site checks, and optional UDP.
- `benchmark`: health plus QUIC and throughput measurements.

The shared plan lives in `vpn-testing/test-plan.json`. Start with disabled or
example endpoints and replace them with your own catalog before running a real
benchmark.

## Target types

### Docker

Use a Linux SSH worker with Docker and the selected Xray or sing-box binary
available to the runner. The runner copies only its temporary plan and script
to the worker; credentials remain in the worker's SSH configuration.

### Native

Use a worker where the native client binary is installed and available on
`PATH`. This is useful for macOS or Linux clients where Docker would not match
the real client behavior.

### Android ADB

Use a host with Android SDK platform tools and one explicitly selected ADB
device. The Android agent runs the test client on the phone and requires a
validated cellular transport when the plan declares a mobile target. Never
publish the device serial, Wi-Fi address, or SSH credentials in a public plan;
use a private deployment overlay.

## Adding a target

1. Add an allowlisted target to your private `test-plan.json`.
2. Match its `planTarget` to a matrix target.
3. Install the required client on the worker.
4. Verify SSH/ADB access with a harmless command.
5. Run `quick` manually, inspect telemetry, then enable longer profiles.

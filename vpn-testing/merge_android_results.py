#!/usr/bin/env python3
"""Merge per-endpoint Android agent files into the common run document."""

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

from unified_runner import endpoint_eligible, load_plan, summarize_run, validate_result


def now() -> str:
    """Return a UTC result timestamp."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main() -> int:
    """CLI entrypoint."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--input-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    plan = load_plan(args.plan)
    endpoints: List[Dict[str, Any]] = []
    target_details: Dict[str, Any] = {}
    network_checks: Dict[str, Any] = {}
    for result_path in sorted(args.input_dir.glob("endpoint-*.json")):
        endpoint = json.loads(result_path.read_text(encoding="utf-8"))
        target_details = endpoint.pop("target", target_details)
        if "quic" in endpoint:
            network_checks["quic"] = endpoint.pop("quic")
        endpoint["eligible"] = endpoint_eligible(plan, endpoint, args.profile)
        endpoints.append(endpoint)
    target = {
        "id": "external-wireless-android",
        "networkClass": "external-mobile",
        "client": "xray",
        "accessMethod": "socks-proxy",
        "wireMethod": "4g",
        "hostRole": "android",
        **target_details,
    }
    result = {
        "schemaVersion": 1,
        "runId": args.run_id,
        "planSha256": hashlib.sha256(args.plan.read_bytes()).hexdigest(),
        "profile": args.profile,
        "target": target,
        "engine": "xray-android-shell",
        "startedAt": now(),
        "finishedAt": now(),
        "networkChecks": network_checks,
        "endpoints": endpoints,
        "summary": summarize_run(endpoints),
    }
    validate_result(result)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(args.output)
    return 0 if endpoints else 2


if __name__ == "__main__":
    raise SystemExit(main())

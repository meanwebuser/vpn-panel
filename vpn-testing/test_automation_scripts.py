#!/usr/bin/env python3
"""Regression tests for orchestration shell and health-policy contracts."""

import importlib.util
import os
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]


def load_health_module():
    """Load the hyphenated health CLI as a testable Python module."""
    path = ROOT / "scripts" / "apply-endpoint-health.py"
    spec = importlib.util.spec_from_file_location("apply_endpoint_health", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class AutomationScriptsTest(unittest.TestCase):
    """Protect target isolation and health publication ordering."""

    def test_no_endpoint_is_unconditionally_included_by_default(self) -> None:
        module = load_health_module()
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(module.always_include_endpoints(), [])

    def test_total_probe_failure_falls_back_only_to_public_products(self) -> None:
        module = load_health_module()
        run = {"endpoints": [{"endpoint": "de-xhttp", "eligible": False}]}
        self.assertEqual(module.eligible_relays(run), module.CANONICAL_RELAYS)
        self.assertNotIn("de-xhttp", module.eligible_relays(run))

    def test_legacy_fallbacks_are_preserved_for_every_user(self) -> None:
        module = load_health_module()
        self.assertIn("de-direct", module.LEGACY_FALLBACK_ENDPOINTS)
        self.assertIn("us-xhttp-h2-443", module.LEGACY_FALLBACK_ENDPOINTS)
        self.assertIn("us-xhttp-h2", module.LEGACY_FALLBACK_ENDPOINTS)

    def test_remote_spool_default_is_target_local(self) -> None:
        script = (ROOT / "scripts" / "run-network-test.sh").read_text(encoding="utf-8")
        self.assertIn('remote_spool_dir="/tmp/vpn-panel-telemetry-spool"', script)
        self.assertNotIn('TELEMETRY_SPOOL_DIR:-$HOME/.local/state', script)

    def test_health_is_published_before_policy_can_restart_panel(self) -> None:
        script = (ROOT / "scripts" / "auto-endpoint-check.sh").read_text(encoding="utf-8")
        post = script.index("/api/admin/endpoint-health")
        apply_profiles = script.index("--apply-profiles")
        self.assertLess(post, apply_profiles)
        self.assertIn("--retry-connrefused", script)


if __name__ == "__main__":
    unittest.main()

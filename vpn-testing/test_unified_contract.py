from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "vpn-testing"))

import unified_runner  # noqa: E402


PLAN_PATH = REPO_ROOT / "vpn-testing" / "test-plan.json"


class PublicPlanContractTests(unittest.TestCase):
    def test_public_plan_loads_and_has_disabled_example_targets(self) -> None:
        plan = unified_runner.load_plan(PLAN_PATH)
        self.assertEqual(plan["generatedFrom"], "manual-example")
        self.assertTrue(all(target["enabled"] is False for target in plan["testTargets"]))

    def test_target_registry_declares_runner_mode_and_matching_matrix_target(self) -> None:
        plan = unified_runner.load_plan(PLAN_PATH)
        for target in plan["testTargets"]:
            self.assertEqual(target["id"], target["planTarget"])
            self.assertIn(target["runner"], {"ssh", "android-adb"})
            self.assertIn(target["mode"], {"docker", "native", "android"})
            self.assertIn(target["planTarget"], plan["targets"])

    def test_android_target_is_a_private_deployment_example(self) -> None:
        plan = json.loads(PLAN_PATH.read_text(encoding="utf-8"))
        android = next(target for target in plan["testTargets"] if target["id"] == "android-adb")
        self.assertEqual(android["runner"], "android-adb")
        self.assertEqual(android["sshHost"], "tester@example.com")
        self.assertEqual(android["adbSerial"], "REPLACE_WITH_ADB_SERIAL")

    def test_public_http_checks_do_not_include_disabled_private_catalog_entries(self) -> None:
        plan = json.loads(PLAN_PATH.read_text(encoding="utf-8"))
        check_ids = {check["id"] for check in plan["httpChecks"]}
        self.assertNotIn("reddit", check_ids)
        self.assertNotIn("gstatic", check_ids)


if __name__ == "__main__":
    unittest.main()

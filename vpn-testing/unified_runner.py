#!/usr/bin/env python3
"""Run the shared staged VPN endpoint test plan on a native or Docker Xray.

The plan, result schema, and eligibility decision live here so quick checks,
health automation, full benchmarks, and Android adapters do not invent their
own definitions of a working endpoint.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import copy
import fcntl
import hashlib
import hmac
import ipaddress
import json
import os
import platform
import shutil
import socket
import struct
import subprocess
import tempfile
import threading
import time
import urllib.request
import urllib.parse
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence


JsonObject = dict[str, Any]
SUCCESS_CODES = {200, 201, 202, 204, 301, 302, 303, 307, 308}
_docker_command_cache: list[str] | None = None
_docker_command_lock = threading.Lock()


class PlanError(ValueError):
    """Raised when the shared test plan violates its required contract."""


WIRE_NETWORK_CLASS = {
    "4g": "external-mobile",
    "wire-internal": "lan",
    "wire-external": "external-wired",
    "unknown": "external-unknown",
}
VALID_CLIENTS = {"xray", "sing-box", "smartdns"}
VALID_ACCESS_METHODS = {"http-proxy", "socks-proxy", "smart-http", "dns"}
VALID_WIRE_METHODS = set(WIRE_NETWORK_CLASS)


@dataclass
class PortReservations:
    """Hold process-wide SOCKS port locks until an entire test run finishes."""

    ports: list[int]
    sockets: list[socket.socket | None]
    lock_files: list[Any]

    @classmethod
    def create(cls, count: int) -> "PortReservations":
        """Reserve distinct loopback ports that concurrent runners cannot reuse."""
        ports: list[int] = []
        sockets: list[socket.socket | None] = []
        lock_files: list[Any] = []
        try:
            while len(ports) < count:
                reservation = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                reservation.bind(("127.0.0.1", 0))
                port = int(reservation.getsockname()[1])
                lock_file = Path(tempfile.gettempdir(), f"vpn-unified-socks-{port}.lock").open("a+")
                try:
                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    lock_file.close()
                    reservation.close()
                    continue
                ports.append(port)
                sockets.append(reservation)
                lock_files.append(lock_file)
            return cls(ports, sockets, lock_files)
        except Exception:
            cls(ports, sockets, lock_files).close()
            raise

    def release_socket(self, index: int) -> None:
        """Release the bind immediately before Xray claims the locked port."""
        reservation = self.sockets[index]
        if reservation is not None:
            reservation.close()
            self.sockets[index] = None

    def close(self) -> None:
        """Release all socket reservations and inter-process locks."""
        for reservation in self.sockets:
            if reservation is not None:
                reservation.close()
        self.sockets = [None] * len(self.sockets)
        for lock_file in self.lock_files:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
            lock_file.close()
        self.lock_files = []


def _utc_now() -> str:
    """Return an RFC3339 UTC timestamp."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_plan(path: Path) -> JsonObject:
    """Load and validate the shared test plan.

    Args:
        path: JSON plan path.

    Returns:
        Validated plan object.

    Raises:
        PlanError: If required fields or cross-references are invalid.
    """
    try:
        plan = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise PlanError(f"cannot read plan {path}: {exc}") from exc

    required = {"schemaVersion", "profiles", "targets", "testTargets", "httpChecks", "udpCheck", "quicCheck", "throughput", "eligibility"}
    missing = required - set(plan)
    if missing:
        raise PlanError(f"missing plan fields: {', '.join(sorted(missing))}")
    if plan["schemaVersion"] != 1:
        raise PlanError(f"unsupported plan schemaVersion: {plan['schemaVersion']}")
    for profile in ("quick", "health", "benchmark"):
        if profile not in plan["profiles"]:
            raise PlanError(f"missing profile: {profile}")
        stages = plan["profiles"][profile].get("stages")
        if not isinstance(stages, list) or not stages:
            raise PlanError(f"profile {profile} has no stages")
    for target_id, target in plan["targets"].items():
        if not isinstance(target, Mapping):
            raise PlanError(f"target {target_id} must be an object")
        required_target_fields = {"client", "accessMethod", "wireMethod", "hostRole", "networkClass"}
        missing_target_fields = required_target_fields - set(target)
        if missing_target_fields:
            raise PlanError(f"target {target_id} missing matrix fields: {', '.join(sorted(missing_target_fields))}")
        if target["client"] not in VALID_CLIENTS:
            raise PlanError(f"target {target_id} has invalid client")
        if target["accessMethod"] not in VALID_ACCESS_METHODS:
            raise PlanError(f"target {target_id} has invalid accessMethod")
        if target["wireMethod"] not in VALID_WIRE_METHODS or target["networkClass"] != WIRE_NETWORK_CLASS[target["wireMethod"]]:
            raise PlanError(f"target {target_id} has inconsistent wireMethod/networkClass")
    test_target_ids: set[str] = set()
    for test_target in plan["testTargets"]:
        if not isinstance(test_target, Mapping):
            raise PlanError("testTargets entries must be objects")
        test_target_id = test_target.get("id")
        if not isinstance(test_target_id, str) or not test_target_id or test_target_id in test_target_ids:
            raise PlanError("testTargets must have unique non-empty ids")
        test_target_ids.add(test_target_id)
        if test_target_id not in plan["targets"]:
            raise PlanError(f"testTarget references unknown plan target: {test_target_id}")
        if test_target.get("planTarget") != test_target_id:
            raise PlanError(f"testTarget {test_target_id} has invalid planTarget")
        if test_target.get("runner") not in {"ssh", "android-adb"}:
            raise PlanError(f"testTarget {test_target_id} has invalid runner")
        if not isinstance(test_target.get("sshHost"), str) or not test_target["sshHost"]:
            raise PlanError(f"testTarget {test_target_id} has no sshHost")
        if not isinstance(test_target.get("sshPort"), int) or test_target["sshPort"] < 1:
            raise PlanError(f"testTarget {test_target_id} has invalid sshPort")
        if test_target.get("mode") not in {"docker", "native", "android"}:
            raise PlanError(f"testTarget {test_target_id} has invalid mode")
        if test_target.get("engine") not in {"xray", "singbox"}:
            raise PlanError(f"testTarget {test_target_id} has invalid engine")
        if test_target.get("runner") == "android-adb" and (not isinstance(test_target.get("adbSerial"), str) or not test_target["adbSerial"]):
            raise PlanError(f"testTarget {test_target_id} has no adbSerial")
    checks = plan["httpChecks"]
    check_ids = [check.get("id") for check in checks]
    if None in check_ids or len(check_ids) != len(set(check_ids)):
        raise PlanError("httpChecks must have unique non-empty ids")
    if any("enabled" in check and not isinstance(check["enabled"], bool) for check in checks):
        raise PlanError("httpChecks enabled values must be boolean")
    unknown_gates = set(plan["eligibility"].get("requiredGateChecks", [])) - set(check_ids)
    if unknown_gates:
        raise PlanError(f"eligibility references unknown checks: {', '.join(sorted(unknown_gates))}")
    return plan


def selected_http_checks(plan: Mapping[str, Any], profile: str, requested_ids: Sequence[str] | None = None) -> list[Mapping[str, Any]]:
    """Return the HTTP targets selected by the plan defaults or an explicit UI selection."""
    stages = set(plan["profiles"][profile]["stages"])
    candidates = [check for check in plan["httpChecks"] if check["group"] == "gate" or "sites" in stages]
    if requested_ids is None:
        return [check for check in candidates if check.get("enabled", True)]

    requested = set(requested_ids)
    known = {str(check["id"]) for check in plan["httpChecks"]}
    unknown = requested - known
    if unknown:
        raise PlanError(f"unknown HTTP checks: {', '.join(sorted(unknown))}")
    required = set(str(check_id) for check_id in plan["eligibility"].get("requiredGateChecks", []))
    missing_required = required - requested
    if missing_required:
        raise PlanError(f"required HTTP checks cannot be disabled: {', '.join(sorted(missing_required))}")
    return [check for check in candidates if str(check["id"]) in requested]


def endpoint_eligible(plan: Mapping[str, Any], endpoint: Mapping[str, Any], profile: str) -> bool:
    """Apply the common gate and site-ratio decision to an endpoint result."""
    endpoint_id = str(endpoint.get("endpoint", ""))
    expectation = plan.get("endpointExpectations", {}).get(endpoint_id, {})
    expected_exit_ip = expectation.get("exitIp")
    if expected_exit_ip and endpoint.get("exitIp") != expected_exit_ip:
        return False

    checks = {str(check.get("id")): check for check in endpoint.get("checks", [])}
    required = plan["eligibility"]["requiredGateChecks"]
    if any(not checks.get(check_id, {}).get("reachable", checks.get(check_id, {}).get("ok", False)) for check_id in required):
        return False

    stages = set(plan["profiles"][profile]["stages"])
    if "sites" in stages:
        gate_ids = set(required)
        site_checks = [check for check_id, check in checks.items() if check_id not in gate_ids]
        if site_checks:
            ratio = sum(bool(check.get("reachable", check.get("ok", False))) for check in site_checks) / len(site_checks)
            if ratio < float(plan["eligibility"]["minimumSiteRatio"]):
                return False
    if "udp" in stages and plan["eligibility"].get("requireUdp", False):
        if not endpoint.get("udp", {}).get("ok", False):
            return False
    return True


def summarize_run(endpoints: Sequence[Mapping[str, Any]]) -> JsonObject:
    """Build the stable summary shared by all execution adapters."""
    errors = sum(1 for endpoint in endpoints if endpoint.get("error"))
    eligible = sum(1 for endpoint in endpoints if endpoint.get("eligible") is True)
    return {"total": len(endpoints), "eligible": eligible, "failed": len(endpoints) - eligible - errors, "errors": errors}


def validate_result(result: Mapping[str, Any]) -> None:
    """Validate fields required from native, Docker, and Android runners."""
    required = {"schemaVersion", "runId", "profile", "target", "engine", "startedAt", "finishedAt", "endpoints", "summary"}
    missing = required - set(result)
    if missing:
        raise PlanError(f"result missing fields: {', '.join(sorted(missing))}")
    if result["schemaVersion"] != 1:
        raise PlanError("result schemaVersion must be 1")
    if not isinstance(result["target"], Mapping):
        raise PlanError("result target must be an object")
    target = result["target"]
    required_target_fields = {"networkClass", "client", "accessMethod", "wireMethod", "hostRole"}
    missing_target_fields = required_target_fields - set(target)
    if missing_target_fields:
        raise PlanError(f"result target missing matrix fields: {', '.join(sorted(missing_target_fields))}")
    if target["client"] not in VALID_CLIENTS or target["accessMethod"] not in VALID_ACCESS_METHODS:
        raise PlanError("result target has invalid client/accessMethod")
    if target["wireMethod"] not in VALID_WIRE_METHODS or target["networkClass"] != WIRE_NETWORK_CLASS[target["wireMethod"]]:
        raise PlanError("result target has inconsistent wireMethod/networkClass")
    if not isinstance(result["endpoints"], list):
        raise PlanError("result endpoints must be an array")


def classify_http_response(check: Mapping[str, Any], code: int) -> JsonObject:
    """Separate network reachability from expected application content.

    Any real HTTP response proves DNS/TCP/TLS/HTTP reachability. Codes such as
    401, 403, and 429 are warnings unless a check explicitly accepts them;
    transport failures represented by code 0 are fatal.
    """
    reachable = 100 <= code <= 599
    content_ok = code in set(check["acceptedCodes"])
    return {
        "reachable": reachable,
        "contentOk": content_ok,
        "severity": "ok" if content_ok else ("warning" if reachable else "fatal"),
    }


class TelemetrySink:
    """Publish every test event immediately with durable local/S3 fallback."""

    def __init__(self, run_id: str, profile: str, target: Mapping[str, Any], spool_dir: Path) -> None:
        self.run_id = run_id
        self.profile = profile
        self.target = dict(target)
        self.url = os.environ.get("TELEMETRY_URL", "")
        self.api_key = os.environ.get("TELEMETRY_API_KEY", os.environ.get("HEALTH_API_KEY", os.environ.get("VPN_PANEL_HEALTH_API_KEY", "")))
        self.s3_uri = os.environ.get("TELEMETRY_S3_URI", "").rstrip("/")
        self.s3_endpoint = os.environ.get("TELEMETRY_S3_ENDPOINT", "")
        self.spool_dir = spool_dir / run_id
        self.spool_dir.mkdir(parents=True, exist_ok=True)
        self._sequence = 0
        self._lock = threading.Lock()
        self.replay_pending()

    def replay_pending(self) -> None:
        """Replay durable events from older crashed or disconnected runs."""
        parent = self.spool_dir.parent
        if not parent.exists():
            return
        for event_path in sorted(parent.glob("*/*.json")):
            try:
                encoded = event_path.read_bytes().strip()
            except OSError:
                continue
            if self._post(encoded) or self._upload_s3(event_path):
                event_path.unlink(missing_ok=True)

    def emit(self, event_type: str, *, endpoint: str | None = None, stage: str | None = None, payload: Mapping[str, Any] | None = None) -> JsonObject:
        """Send one event; retain and optionally upload it when POST fails."""
        with self._lock:
            self._sequence += 1
            sequence = self._sequence
        event: JsonObject = {
            "schemaVersion": 1,
            "eventId": str(uuid.uuid4()),
            "runId": self.run_id,
            "sequence": sequence,
            "timestamp": _utc_now(),
            "type": event_type,
            "profile": self.profile,
            "target": self.target,
            "payload": dict(payload or {}),
        }
        if endpoint is not None:
            event["endpoint"] = endpoint
        if stage is not None:
            event["stage"] = stage
        encoded = json.dumps(event, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        delivered = self._post(encoded)
        if not delivered:
            event_path = self.spool_dir / f"{sequence:06d}-{event['eventId']}.json"
            event_path.write_bytes(encoded + b"\n")
            self._upload_s3(event_path)
        return event

    def _post(self, encoded: bytes) -> bool:
        """POST one event to the public panel endpoint."""
        if not self.url or not self.api_key:
            return False
        request = urllib.request.Request(
            self.url,
            data=encoded,
            method="POST",
            headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=8) as response:
                return 200 <= response.status < 300
        except OSError:
            return False

    def _upload_s3(self, event_path: Path) -> bool:
        """Upload a failed event immediately through an explicit aws CLI setup."""
        if not self.s3_uri:
            return False
        destination = f"{self.s3_uri}/{self.run_id}/{event_path.name}"
        aws = shutil.which("aws")
        if aws:
            command = [aws, "s3", "cp", str(event_path), destination, "--only-show-errors"]
            if self.s3_endpoint:
                command.extend(["--endpoint-url", self.s3_endpoint])
            try:
                return _run(command, timeout=30).returncode == 0
            except (OSError, subprocess.SubprocessError):
                return False
        return self._upload_s3_sigv4(event_path, destination)

    def _upload_s3_sigv4(self, event_path: Path, destination: str) -> bool:
        """PUT one object with SigV4 when an aws CLI is unavailable."""
        access_key = os.environ.get("AWS_ACCESS_KEY_ID", "")
        secret_key = os.environ.get("AWS_SECRET_ACCESS_KEY", "")
        if not access_key or not secret_key or not destination.startswith("s3://"):
            return False
        bucket, _, object_key = destination[5:].partition("/")
        endpoint = self.s3_endpoint or "https://storage.yandexcloud.net"
        parsed = urllib.parse.urlparse(endpoint)
        host = parsed.netloc
        canonical_uri = "/" + urllib.parse.quote(f"{bucket}/{object_key}", safe="/-_.~")
        payload = event_path.read_bytes()
        payload_hash = hashlib.sha256(payload).hexdigest()
        now = datetime.now(timezone.utc)
        amz_date = now.strftime("%Y%m%dT%H%M%SZ")
        date_stamp = now.strftime("%Y%m%d")
        region = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "ru-central1"))
        service = "s3"
        session_token = os.environ.get("AWS_SESSION_TOKEN", "")
        headers = {"host": host, "x-amz-content-sha256": payload_hash, "x-amz-date": amz_date}
        if session_token:
            headers["x-amz-security-token"] = session_token
        signed_headers = ";".join(sorted(headers))
        canonical_headers = "".join(f"{key}:{headers[key]}\n" for key in sorted(headers))
        canonical_request = f"PUT\n{canonical_uri}\n\n{canonical_headers}\n{signed_headers}\n{payload_hash}"
        scope = f"{date_stamp}/{region}/{service}/aws4_request"
        string_to_sign = f"AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{hashlib.sha256(canonical_request.encode()).hexdigest()}"

        def sign(key: bytes, value: str) -> bytes:
            return hmac.new(key, value.encode(), hashlib.sha256).digest()

        signing_key = sign(sign(sign(sign(("AWS4" + secret_key).encode(), date_stamp), region), service), "aws4_request")
        signature = hmac.new(signing_key, string_to_sign.encode(), hashlib.sha256).hexdigest()
        authorization = f"AWS4-HMAC-SHA256 Credential={access_key}/{scope}, SignedHeaders={signed_headers}, Signature={signature}"
        request_headers = {**headers, "Authorization": authorization, "Content-Type": "application/json"}
        request = urllib.request.Request(f"{parsed.scheme}://{host}{canonical_uri}", data=payload, method="PUT", headers=request_headers)
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                return 200 <= response.status < 300
        except OSError:
            return False


def health_payload(result: Mapping[str, Any]) -> JsonObject:
    """Convert a unified run into the panel's existing health ingestion payload."""
    payload: list[JsonObject] = []
    for endpoint in result["endpoints"]:
        checks = endpoint.get("checks", [])
        first_ok = next((check for check in checks if check.get("ok")), None)
        payload.append({
            "endpoint": endpoint["endpoint"],
            "pass": 1 if endpoint.get("eligible") else 0,
            "fail": 0 if endpoint.get("eligible") else 1,
            "latency_ms": first_ok.get("latencyMs") if first_ok else None,
            "speed_mbps": endpoint.get("throughput", {}).get("mbps"),
            "exit_ip": endpoint.get("exitIp"),
            "sites": [{
                "label": check["label"],
                "code": str(check.get("code", 0)),
                "ms": int(check.get("latencyMs", 0)),
                "ok": bool(check.get("reachable", check.get("ok"))),
            } for check in checks],
            **({"error": endpoint["error"]} if endpoint.get("error") else {}),
        })
    return {"results": payload}


def _run(args: Sequence[str], timeout: int = 30, check: bool = False) -> subprocess.CompletedProcess[str]:
    """Run a subprocess with bounded output and explicit timeout."""
    return subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, check=check)


def _public_ip() -> str | None:
    """Best-effort direct public IP used to identify the tested network."""
    try:
        with urllib.request.urlopen("https://api.ipify.org", timeout=6) as response:
            return response.read().decode("ascii").strip() or None
    except OSError:
        return None


def _docker_command() -> list[str]:
    """Return a working Docker command, failing explicitly when unavailable."""
    global _docker_command_cache
    with _docker_command_lock:
        if _docker_command_cache is not None:
            return list(_docker_command_cache)
        if shutil.which("docker") and _run(["docker", "info"], timeout=10).returncode == 0:
            _docker_command_cache = ["docker"]
        elif shutil.which("sudo") and shutil.which("docker") and _run(["sudo", "docker", "info"], timeout=10).returncode == 0:
            _docker_command_cache = ["sudo", "docker"]
        else:
            raise RuntimeError("Docker is unavailable")
        return list(_docker_command_cache)


def _native_xray(requested: str | None) -> str:
    """Resolve the native Xray executable without optional-import fallbacks."""
    candidates = [requested] if requested else ["/opt/homebrew/bin/xray", "/usr/local/bin/xray", shutil.which("xray")]
    for candidate in candidates:
        if candidate and Path(candidate).is_file() and os.access(candidate, os.X_OK):
            return candidate
    raise RuntimeError("native Xray executable is unavailable")


def _endpoint_tags(config: Mapping[str, Any]) -> list[str]:
    """Return subscription outbound tags that represent VPN endpoints."""
    return [str(outbound["tag"]) for outbound in config.get("outbounds", []) if outbound.get("tag") not in {"direct", "block"}]


def _singbox_endpoint_supported(config: Mapping[str, Any], endpoint: str) -> bool:
    """Return whether the panel subscription can be rendered for sing-box."""
    try:
        singbox_endpoint_config(config, endpoint, 1)
    except PlanError:
        return False
    return True


def endpoint_config(base: Mapping[str, Any], endpoint: str, socks_port: int) -> JsonObject:
    """Create a single-endpoint Xray client config from the panel subscription."""
    config = copy.deepcopy(base)
    inbounds = [inbound for inbound in config.get("inbounds", []) if inbound.get("tag") == "socks-in"]
    if not inbounds:
        raise PlanError("subscription has no socks-in inbound")
    for inbound in inbounds:
        inbound["port"] = socks_port
        inbound["listen"] = "127.0.0.1"
        settings = inbound.setdefault("settings", {})
        settings["udp"] = True
    config["inbounds"] = inbounds
    config["routing"] = {"domainStrategy": "IPIfNonMatch", "rules": [{"type": "field", "network": "tcp,udp", "outboundTag": endpoint}]}
    config["log"] = {"loglevel": os.environ.get("VPN_TEST_LOGLEVEL", "warning")}
    config.pop("dns", None)
    return config


def singbox_endpoint_config(base: Mapping[str, Any], endpoint: str, socks_port: int) -> JsonObject:
    """Create a single-endpoint sing-box client config from an Xray subscription.

    The panel's sing-box contract supports Reality, WebSocket, and HTTPUpgrade
    transports. XHTTP and gRPC stay Xray-only until sing-box support is added to
    the subscription generator as well.
    """
    source = next((outbound for outbound in base.get("outbounds", []) if outbound.get("tag") == endpoint), None)
    if not isinstance(source, Mapping) or source.get("protocol") != "vless":
        raise PlanError(f"subscription has no VLESS outbound for endpoint {endpoint}")
    settings = source.get("settings")
    vnext = settings.get("vnext") if isinstance(settings, Mapping) else None
    if not isinstance(vnext, list) or len(vnext) != 1 or not isinstance(vnext[0], Mapping):
        raise PlanError(f"endpoint {endpoint} is not a single-server VLESS outbound")
    server = vnext[0]
    users = server.get("users")
    if not isinstance(users, list) or len(users) != 1 or not isinstance(users[0], Mapping):
        raise PlanError(f"endpoint {endpoint} has no single VLESS user")
    user = users[0]
    stream = source.get("streamSettings")
    if not isinstance(stream, Mapping):
        raise PlanError(f"endpoint {endpoint} has no stream settings")
    network = str(stream.get("network", ""))
    security = str(stream.get("security", ""))
    if network not in {"tcp", "ws", "httpupgrade"} or (network == "tcp" and security != "reality"):
        raise PlanError(f"unsupported sing-box transport for endpoint {endpoint}: {network}/{security}")

    address = server.get("address")
    port = server.get("port")
    uuid_value = user.get("id")
    if not isinstance(address, str) or not address or not isinstance(port, int) or not isinstance(uuid_value, str) or not uuid_value:
        raise PlanError(f"endpoint {endpoint} has an invalid VLESS server")
    outbound: JsonObject = {
        "type": "vless",
        "tag": endpoint,
        "server": address,
        "server_port": port,
        "uuid": uuid_value,
    }
    if user.get("flow"):
        outbound["flow"] = user["flow"]

    tls_settings = stream.get("realitySettings") if security == "reality" else stream.get("tlsSettings")
    if not isinstance(tls_settings, Mapping):
        raise PlanError(f"endpoint {endpoint} has incomplete TLS settings")
    server_name = str(tls_settings.get("serverName", ""))
    fingerprint = str(tls_settings.get("fingerprint", "chrome"))
    tls: JsonObject = {"enabled": True, "server_name": server_name, "utls": {"enabled": True, "fingerprint": fingerprint}}
    if security == "reality":
        public_key = tls_settings.get("publicKey")
        short_id = tls_settings.get("shortId")
        if not isinstance(public_key, str) or not public_key or not isinstance(short_id, str) or not short_id:
            raise PlanError(f"endpoint {endpoint} has incomplete Reality settings")
        tls["reality"] = {"enabled": True, "public_key": public_key, "short_id": short_id}
    outbound["tls"] = tls

    if network == "ws":
        ws_settings = stream.get("wsSettings")
        if not isinstance(ws_settings, Mapping):
            raise PlanError(f"endpoint {endpoint} has incomplete WebSocket settings")
        transport: JsonObject = {"type": "ws", "path": str(ws_settings.get("path", "/"))}
        host = ws_settings.get("host")
        if host:
            transport["headers"] = {"Host": str(host)}
        outbound["transport"] = transport
    elif network == "httpupgrade":
        upgrade_settings = stream.get("httpupgradeSettings")
        if not isinstance(upgrade_settings, Mapping):
            raise PlanError(f"endpoint {endpoint} has incomplete HTTPUpgrade settings")
        outbound["transport"] = {
            "type": "httpupgrade",
            "host": str(upgrade_settings.get("host", address)),
            "path": str(upgrade_settings.get("path", "/")),
        }

    return {
        "log": {"level": "error"},
        "inbounds": [{"type": "socks", "tag": "socks-in", "listen": "127.0.0.1", "listen_port": socks_port}],
        "outbounds": [outbound, {"type": "direct", "tag": "direct"}],
        "route": {"rules": [], "final": endpoint, "auto_detect_interface": True},
    }


def cellular_bridge_endpoint_config(base: Mapping[str, Any], endpoint: str, socks_port: int, bridge_port: int) -> tuple[JsonObject, str, int]:
    """Route one Xray server dial through a cellular-bound Android TCP bridge.

    Args:
        base: Subscription Xray configuration.
        endpoint: Selected outbound tag.
        socks_port: Local SOCKS inbound port.
        bridge_port: Loopback port exposed by the Android bridge service.

    Returns:
        The rewritten config plus the original remote host and port.

    Raises:
        PlanError: If the selected endpoint is not a single-server VLESS outbound.
    """
    config = endpoint_config(base, endpoint, socks_port)
    selected = next((outbound for outbound in config.get("outbounds", []) if outbound.get("tag") == endpoint), None)
    if selected is None:
        raise PlanError(f"subscription has no outbound for endpoint {endpoint}")
    vnext = selected.get("settings", {}).get("vnext")
    if not isinstance(vnext, list) or len(vnext) != 1 or not isinstance(vnext[0], dict):
        raise PlanError(f"endpoint {endpoint} is not a single-server VLESS outbound")
    server = vnext[0]
    remote_host = server.get("address")
    remote_port = server.get("port")
    if not isinstance(remote_host, str) or not remote_host or not isinstance(remote_port, int):
        raise PlanError(f"endpoint {endpoint} has an invalid server address")
    # TLS/Reality SNI stays in streamSettings; only the underlying TCP dial is
    # redirected through the Android service bound with Network.SocketFactory.
    server["address"] = "127.0.0.1"
    server["port"] = bridge_port
    return config, remote_host, remote_port


@dataclass
class EngineProcess:
    """Lifecycle handle for one isolated endpoint Xray process."""

    mode: str
    identity: str
    process: subprocess.Popen[str] | None
    docker_command: list[str] | None

    def stop(self) -> None:
        """Stop only the process/container created for this endpoint."""
        if self.mode == "native" and self.process is not None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
        elif self.docker_command is not None:
            _run([*self.docker_command, "rm", "-f", self.identity], timeout=15)


def _start_engine(config_path: Path, mode: str, xray_bin: str | None, image: str, identity: str, engine: str) -> EngineProcess:
    """Start one isolated Xray or sing-box process and return its lifecycle handle."""
    if mode == "native":
        if engine != "xray":
            raise RuntimeError("native sing-box runner is unavailable")
        executable = _native_xray(xray_bin)
        log_path = config_path.with_suffix(".log")
        log_handle = log_path.open("w", encoding="utf-8")
        process = subprocess.Popen([executable, "run", "-c", str(config_path)], stdout=log_handle, stderr=subprocess.STDOUT, text=True)
        time.sleep(2)
        log_handle.close()
        if process.poll() is not None:
            raise RuntimeError(f"Xray exited during startup; see {log_path}")
        return EngineProcess("native", str(process.pid), process, None)

    docker = _docker_command()
    mount_path = "/etc/xray/config.json" if engine == "xray" else "/etc/sing-box/config.json"
    command = [
        *docker, "run", "-d", "--name", identity, "--network", "host",
        "-v", f"{config_path}:{mount_path}:ro", image,
    ]
    if engine == "singbox":
        command.extend(["run", "-c", mount_path])
    completed = _run(command, timeout=30)
    if completed.returncode != 0:
        raise RuntimeError(f"Docker Xray startup failed: {completed.stderr.strip()}")
    time.sleep(2)
    return EngineProcess("docker", identity, None, docker)


def _wait_socks(port: int, timeout_seconds: int = 12) -> None:
    """Wait until the endpoint's local SOCKS listener accepts connections."""
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                return
        except OSError:
            time.sleep(0.4)
    raise RuntimeError(f"SOCKS listener 127.0.0.1:{port} did not become ready")


def _http_check(check: Mapping[str, Any], socks_port: int) -> JsonObject:
    """Run one HTTPS check through an endpoint's SOCKS proxy."""
    timeout_seconds = int(check["timeoutSeconds"])
    started = time.monotonic()
    command = [
        "curl", "-sS", "--retry", "1", "--retry-all-errors", "--retry-delay", "1",
        "--max-time", str(timeout_seconds), "--socks5-hostname", f"127.0.0.1:{socks_port}",
        "-o", "/dev/null", "-w", "%{http_code} %{time_total}", str(check["url"]),
    ]
    try:
        completed = _run(command, timeout=timeout_seconds + 3)
    except subprocess.TimeoutExpired:
        code = 0
        classification = classify_http_response(check, code)
        return {
            "id": check["id"], "label": check["label"], "group": check["group"], "code": code,
            "latencyMs": round((time.monotonic() - started) * 1000), "ok": False, **classification,
            "error": f"curl timed out after {timeout_seconds + 3} seconds",
        }
    parts = completed.stdout.strip().split()
    code = int(parts[0]) if parts and parts[0].isdigit() else 0
    latency_ms = round(float(parts[1]) * 1000) if len(parts) > 1 else round((time.monotonic() - started) * 1000)
    classification = classify_http_response(check, code)
    return {
        "id": check["id"], "label": check["label"], "group": check["group"], "code": code,
        "latencyMs": latency_ms, "ok": classification["contentOk"], **classification,
        **({"error": completed.stderr.strip()} if completed.returncode != 0 else {}),
    }


def _exit_ip(socks_port: int) -> str | None:
    """Resolve the observed VPN exit IP through SOCKS."""
    for url in ("https://api.ipify.org", "https://ifconfig.me/ip", "https://icanhazip.com"):
        completed = _run(["curl", "-sS", "--max-time", "8", "--socks5-hostname", f"127.0.0.1:{socks_port}", url], timeout=10)
        candidate = completed.stdout.strip()
        try:
            return str(ipaddress.ip_address(candidate))
        except ValueError:
            continue
    return None


def _dns_query(name: str) -> bytes:
    """Build a minimal A-record DNS query for a SOCKS UDP test."""
    labels = b"".join(bytes([len(label)]) + label.encode("ascii") for label in name.rstrip(".").split("."))
    return struct.pack("!HHHHHH", 0x4455, 0x0100, 1, 0, 0, 0) + labels + b"\x00" + struct.pack("!HH", 1, 1)


def _read_exact(sock: socket.socket, size: int) -> bytes:
    """Read exactly size bytes from a control socket or fail."""
    data = b""
    while len(data) < size:
        chunk = sock.recv(size - len(data))
        if not chunk:
            raise OSError("unexpected EOF from SOCKS server")
        data += chunk
    return data


def _udp_check(spec: Mapping[str, Any], socks_port: int) -> JsonObject:
    """Verify real UDP forwarding with SOCKS5 UDP ASSOCIATE and a DNS query."""
    started = time.monotonic()
    timeout_seconds = int(spec["timeoutSeconds"])
    try:
        with socket.create_connection(("127.0.0.1", socks_port), timeout=timeout_seconds) as control:
            control.settimeout(timeout_seconds)
            control.sendall(b"\x05\x01\x00")
            if _read_exact(control, 2) != b"\x05\x00":
                raise OSError("SOCKS server rejected no-auth negotiation")
            control.sendall(b"\x05\x03\x00\x01\x00\x00\x00\x00\x00\x00")
            header = _read_exact(control, 4)
            if header[1] != 0:
                raise OSError(f"SOCKS UDP ASSOCIATE failed with code {header[1]}")
            if header[3] == 1:
                relay_host = socket.inet_ntoa(_read_exact(control, 4))
            elif header[3] == 4:
                relay_host = socket.inet_ntop(socket.AF_INET6, _read_exact(control, 16))
            else:
                domain_len = _read_exact(control, 1)[0]
                relay_host = _read_exact(control, domain_len).decode("ascii")
            relay_port = struct.unpack("!H", _read_exact(control, 2))[0]
            if relay_host in {"0.0.0.0", "::"}:
                relay_host = "127.0.0.1"

            payload = _dns_query(str(spec["queryName"]))
            target_host = socket.inet_aton(str(spec["host"]))
            packet = b"\x00\x00\x00\x01" + target_host + struct.pack("!H", int(spec["port"])) + payload
            family = socket.AF_INET6 if ":" in relay_host else socket.AF_INET
            with socket.socket(family, socket.SOCK_DGRAM) as udp:
                udp.settimeout(timeout_seconds)
                udp.sendto(packet, (relay_host, relay_port))
                response, _ = udp.recvfrom(4096)
                if len(response) < 10 or response[:3] != b"\x00\x00\x00":
                    raise OSError("malformed SOCKS UDP response")
                atyp = response[3]
                offset = 10 if atyp == 1 else (22 if atyp == 4 else 5 + response[4])
                dns = response[offset:]
                ok = len(dns) >= 12 and dns[:2] == b"DU" and bool(dns[2] & 0x80) and (dns[3] & 0x0F) == 0
        return {"id": spec["id"], "ok": ok, "latencyMs": round((time.monotonic() - started) * 1000)}
    except OSError as exc:
        return {"id": spec["id"], "ok": False, "latencyMs": round((time.monotonic() - started) * 1000), "error": str(exc)}


def _throughput(spec: Mapping[str, Any], socks_port: int) -> JsonObject:
    """Measure a bounded download through the endpoint."""
    url = f"{spec['url']}?bytes={int(spec['bytes'])}"
    timeout_seconds = int(spec["timeoutSeconds"])
    completed = _run([
        "curl", "-sS", "--max-time", str(timeout_seconds), "--socks5-hostname", f"127.0.0.1:{socks_port}",
        "-o", "/dev/null", "-w", "%{http_code} %{speed_download}", url,
    ], timeout=timeout_seconds + 3)
    parts = completed.stdout.strip().split()
    code = int(parts[0]) if parts and parts[0].isdigit() else 0
    bytes_per_second = float(parts[1]) if len(parts) > 1 else 0.0
    return {"ok": code in SUCCESS_CODES, "code": code, "mbps": round(bytes_per_second * 8 / 1_000_000, 2)}


def _direct_quic(spec: Mapping[str, Any]) -> JsonObject:
    """Test QUIC on the target network itself, independently of endpoint TCP tests."""
    version = _run(["curl", "--version"], timeout=5)
    if "HTTP3" not in version.stdout.upper():
        return {"id": spec["id"], "ok": None, "supported": False, "error": "curl lacks HTTP/3 support"}
    timeout_seconds = int(spec["timeoutSeconds"])
    completed = _run([
        "curl", "-sS", "--http3-only", "--max-time", str(timeout_seconds), "-o", "/dev/null", "-w", "%{http_code} %{time_total}", str(spec["url"]),
    ], timeout=timeout_seconds + 3)
    parts = completed.stdout.strip().split()
    code = int(parts[0]) if parts and parts[0].isdigit() else 0
    return {"id": spec["id"], "ok": code in SUCCESS_CODES, "supported": True, "code": code, "error": completed.stderr.strip() or None}


def _run_endpoint(plan: Mapping[str, Any], profile: str, selected_checks: Sequence[Mapping[str, Any]], base: Mapping[str, Any], endpoint: str, index: int, socks_port: int, reservations: PortReservations, run_id: str, args: argparse.Namespace, work_dir: Path, telemetry: TelemetrySink) -> JsonObject:
    """Execute the selected staged profile for one endpoint."""
    result: JsonObject = {"endpoint": endpoint, "checks": []}
    config_path = work_dir / f"config-{index}.json"
    identity = f"vpn-unified-{run_id[:12]}-{index}"
    engine: EngineProcess | None = None
    telemetry.emit("endpoint_started", endpoint=endpoint, payload={"index": index})
    try:
        config_builder = endpoint_config if args.engine == "xray" else singbox_endpoint_config
        config_path.write_text(json.dumps(config_builder(base, endpoint, socks_port), indent=2), encoding="utf-8")
        telemetry.emit("stage_started", endpoint=endpoint, stage="preflight")
        reservations.release_socket(index)
        image = args.xray_image if args.engine == "xray" else args.singbox_image
        engine = _start_engine(config_path, args.mode, args.xray_bin, image, identity, args.engine)
        _wait_socks(socks_port)
        result["preflight"] = {"ok": True, "socksPort": socks_port}
        telemetry.emit("stage_finished", endpoint=endpoint, stage="preflight", payload={"ok": True})

        for check in selected_checks:
            telemetry.emit("stage_started", endpoint=endpoint, stage=str(check["id"]))
            check_result = _http_check(check, socks_port)
            result["checks"].append(check_result)
            telemetry.emit("stage_finished", endpoint=endpoint, stage=str(check["id"]), payload=check_result)
        result["exitIp"] = _exit_ip(socks_port)
        if "udp" in stages:
            telemetry.emit("stage_started", endpoint=endpoint, stage="udp")
            result["udp"] = _udp_check(plan["udpCheck"], socks_port)
            telemetry.emit("stage_finished", endpoint=endpoint, stage="udp", payload=result["udp"])
        if "throughput" in stages:
            telemetry.emit("stage_started", endpoint=endpoint, stage="throughput")
            result["throughput"] = _throughput(plan["throughput"], socks_port)
            telemetry.emit("stage_finished", endpoint=endpoint, stage="throughput", payload=result["throughput"])
        result["eligible"] = endpoint_eligible(plan, result, profile)
    except (OSError, RuntimeError, subprocess.SubprocessError, PlanError) as exc:
        result.update({"eligible": False, "error": str(exc)})
    finally:
        if engine is not None:
            engine.stop()
    telemetry.emit("endpoint_finished", endpoint=endpoint, payload={"eligible": result.get("eligible", False), "error": result.get("error")})
    return result


def _subscription(url: str) -> JsonObject:
    """Fetch the panel's Xray JSON subscription."""
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            value = json.load(response)
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"subscription fetch failed: {exc}") from exc
    if not isinstance(value, dict):
        raise RuntimeError("subscription is not a JSON object")
    return value


def run_plan(args: argparse.Namespace) -> JsonObject:
    """Run a profile and return the validated common result document."""
    plan = load_plan(args.plan)
    if args.profile not in plan["profiles"]:
        raise PlanError(f"unknown profile: {args.profile}")
    if args.target not in plan["targets"]:
        raise PlanError(f"unknown target: {args.target}")
    target = dict(plan["targets"][args.target])
    target.update({"id": args.target, "hostname": platform.node(), "directIp": _public_ip()})
    base = _subscription(args.subscription)
    available = _endpoint_tags(base)
    catalog = plan.get("endpointCatalog")
    if isinstance(catalog, list):
        enabled_catalog = {str(item["id"]) for item in catalog if isinstance(item, Mapping) and item.get("enabled", True)}
        available = [endpoint for endpoint in available if endpoint in enabled_catalog]
    if args.engine == "singbox":
        available = [endpoint for endpoint in available if _singbox_endpoint_supported(base, endpoint)]
    requested = [value for value in args.endpoints.split(",") if value] if args.endpoints else available
    unknown = set(requested) - set(available)
    if unknown:
        raise PlanError(f"unknown endpoints: {', '.join(sorted(unknown))}")
    requested_checks = None if args.checks is None else [value for value in args.checks.split(",") if value]
    selected_checks = selected_http_checks(plan, args.profile, requested_checks)

    started_at = _utc_now()
    run_id = str(uuid.uuid4())
    plan_hash = hashlib.sha256(args.plan.read_bytes()).hexdigest()
    spool_dir = Path(os.environ.get("TELEMETRY_SPOOL_DIR", str(Path(__file__).with_name("results") / "spool")))
    telemetry = TelemetrySink(run_id, args.profile, target, spool_dir)
    telemetry.emit("run_started", payload={"planSha256": plan_hash, "engine": f"{args.engine}-{args.mode}", "endpoints": requested})
    reservations = PortReservations.create(len(requested))
    try:
        with tempfile.TemporaryDirectory(prefix="vpn-unified-") as temp_dir:
            work_dir = Path(temp_dir)
            parallelism = args.parallelism or int(plan["profiles"][args.profile]["parallelism"])
            with concurrent.futures.ThreadPoolExecutor(max_workers=parallelism) as executor:
                futures = [executor.submit(_run_endpoint, plan, args.profile, selected_checks, base, endpoint, index, reservations.ports[index], reservations, run_id, args, work_dir, telemetry) for index, endpoint in enumerate(requested)]
                endpoints = [future.result() for future in futures]
    finally:
        reservations.close()

    stages = set(plan["profiles"][args.profile]["stages"])
    network_checks: JsonObject = {}
    if "quic" in stages:
        telemetry.emit("stage_started", stage="quic", payload={"scope": "target-network"})
        network_checks["quic"] = _direct_quic(plan["quicCheck"])
        telemetry.emit("stage_finished", stage="quic", payload=network_checks["quic"])
    result: JsonObject = {
        "schemaVersion": 1,
        "runId": run_id,
        "planSha256": plan_hash,
        "profile": args.profile,
        "target": target,
        "engine": f"{args.engine}-{args.mode}",
        "startedAt": started_at,
        "finishedAt": _utc_now(),
        "networkChecks": network_checks,
        "endpoints": endpoints,
        "summary": summarize_run(endpoints),
    }
    telemetry.emit("run_finished", payload={"summary": result["summary"], "networkChecks": result["networkChecks"]})
    validate_result(result)
    return result


def _parser() -> argparse.ArgumentParser:
    """Build the command-line parser for all native/Docker profiles."""
    default_plan = Path(__file__).with_name("test-plan.json")
    parser = argparse.ArgumentParser(description="Unified staged VPN endpoint test runner")
    parser.add_argument("--plan", type=Path, default=default_plan)
    parser.add_argument("--profile", choices=["quick", "health", "benchmark"], default="quick")
    parser.add_argument("--target", default="lan-server44")
    parser.add_argument("--subscription", default=os.environ.get("SUBSCRIPTION_URL", ""))
    parser.add_argument("--endpoints", default="")
    parser.add_argument("--checks", default=None, help="comma-separated HTTP check ids; omitted uses plan defaults")
    parser.add_argument("--mode", choices=["native", "docker"], default="docker")
    parser.add_argument("--engine", choices=["xray", "singbox"], default="xray")
    parser.add_argument("--xray-bin")
    parser.add_argument("--xray-image", default=os.environ.get("XRAY_IMAGE", "teddysun/xray:26.6.1"))
    parser.add_argument("--singbox-image", default=os.environ.get("SINGBOX_IMAGE", "ghcr.io/sagernet/sing-box:latest"))
    parser.add_argument("--parallelism", type=int)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--health-output", type=Path)
    return parser


def main() -> int:
    """CLI entrypoint shared by quick, health, and benchmark wrappers."""
    args = _parser().parse_args()
    if not args.subscription:
        token = os.environ.get("VPN_TOKEN")
        base_url = os.environ.get("BASE_URL", "https://panel.example.com")
        if not token:
            raise SystemExit("SUBSCRIPTION_URL or VPN_TOKEN is required")
        args.subscription = f"{base_url}/sub/{token}/xray-json"
    result = run_plan(args)
    rendered = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    else:
        print(rendered)
    if args.health_output:
        args.health_output.parent.mkdir(parents=True, exist_ok=True)
        args.health_output.write_text(json.dumps(health_payload(result), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0 if result["summary"]["eligible"] > 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())

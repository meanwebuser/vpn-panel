#!/usr/bin/env python3
"""Resolve a validated Android cellular interface from ConnectivityService."""

from __future__ import annotations

import re
import sys


INTERFACE_PATTERN = re.compile(r"\bInterfaceName:\s*([^\s}]+)")


def validated_cellular_interface(connectivity_dump: str) -> str:
    """Return the interface for a connected, internet-capable cellular network.

    Args:
        connectivity_dump: Output from ``dumpsys connectivity``.

    Returns:
        The Android network-interface name, for example ``rmnet4``.

    Raises:
        RuntimeError: If no validated cellular network is present.
    """
    for line in connectivity_dump.splitlines():
        if "NetworkAgentInfo{network" not in line or "ni{MOBILE" not in line or "CONNECTED" not in line:
            continue
        if "Transports: CELLULAR" not in line or "INTERNET" not in line or "VALIDATED" not in line:
            continue
        match = INTERFACE_PATTERN.search(line)
        if match:
            return match.group(1)
    raise RuntimeError("Android has no connected, validated cellular network")


def main() -> int:
    """Read ConnectivityService output from stdin and print its cellular interface."""
    try:
        print(validated_cellular_interface(sys.stdin.read()))
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Reject a stale or unrelated compiled APK before exporting it."""
import re
import subprocess
import sys
from pathlib import Path


def verify(aapt2, apk, source):
    text = Path(source).read_text()
    code = re.search(r'val\s+volnaVersionCode\s*=\s*([0-9_]+)', text)
    name = re.search(r'val\s+volnaVersionName\s*=\s*"([^"]+)"', text)
    package = re.search(r'applicationId\s*=\s*"([^"]+)"', text)
    if not all((code, name, package)):
        raise ValueError("Cannot read the expected Android version/applicationId.")
    result = subprocess.run([aapt2, "dump", "badging", apk], check=True, capture_output=True, text=True)
    line = next((line for line in result.stdout.splitlines() if line.startswith("package: ")), "")
    values = dict(re.findall(r"([a-zA-Z]+)='([^']*)'", line))
    expected = {"name": package.group(1), "versionCode": str(int(code.group(1).replace("_", ""))), "versionName": name.group(1)}
    if any(values.get(key) != value for key, value in expected.items()):
        raise ValueError("Compiled APK version/applicationId does not match the sources. Publication stopped.")
    print(f"Verified compiled Android version: Volna {expected['versionName']} ({expected['versionCode']}).")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit("Usage: check-apk-version.py AAPT2 APK GRADLE_SOURCE")
    try:
        verify(*sys.argv[1:])
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error))

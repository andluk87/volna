#!/usr/bin/env python3
"""Verify vendored upstream inputs without fetching code during CMake builds."""
import hashlib
import json
from pathlib import Path
root = Path(__file__).resolve().parents[1] / 'third_party'
manifest = json.loads((root / 'sources.json').read_text())
for name, expected in manifest['sha256'].items():
    actual = hashlib.sha256((root / name).read_bytes()).hexdigest()
    if actual != expected:
        raise SystemExit(f'Upstream file checksum mismatch: {name}')
print(f"Verified {len(manifest['sha256'])} pinned upstream files")

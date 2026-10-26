#!/usr/bin/env python3
"""Copy the pinned, checked-in TGS bundle into APK assets without network access."""
import gzip, hashlib, json, os, shutil
from pathlib import Path
def close_opacity_endpoints(animation):
    """Extend implicit endpoint opacity explicitly, preserving the gradient.

    Lottie Android 6.6.7 otherwise reads past a stop array when interpolating
    bronze-medal keyframes whose merged color/opacity ranges differ.
    """
    changed = 0
    def walk(node):
        nonlocal changed
        if isinstance(node, dict):
            if node.get("ty") in ("gf", "gs") and "g" in node:
                gradient = node["g"]; count = gradient["p"]
                keys = gradient["k"]["k"]
                arrays = [keys] if keys and isinstance(keys[0], (int, float)) else [frame[key] for frame in keys for key in ("s", "e") if key in frame]
                for values in arrays:
                    tail = values[count * 4:]
                    assert len(tail) % 2 == 0
                    if not tail: tail = [0, 1, 1, 1]
                    else:
                        if tail[0] > 0: tail = [0, tail[1]] + tail
                        if tail[-2] < 1: tail += [1, tail[-1]]
                    if tail != values[count * 4:]:
                        values[count * 4:] = tail; changed += 1
            for value in node.values(): walk(value)
        elif isinstance(node, list):
            for value in node: walk(value)
    walk(animation)
    return changed

def prepare(root, source):
    original = json.loads((source / 'manifest.json').read_text())
    entries = {}
    for row in original['animations']:
        entries.setdefault(row['unicode'].replace('\ufe0f',''), row.copy())
    manifest = {'revision': original['revision'], 'count': len(entries), 'entries': entries}
    assert manifest['count'] == 580
    output = root / 'app/src/main/assets/animated-emoji'
    output.mkdir(parents=True, exist_ok=True)
    expected = set()
    adjustments = []
    for row in manifest['entries'].values():
        name = row['file']; assert '/' not in name and name.endswith('.tgs')
        data = (source / name).read_bytes()
        assert hashlib.sha256(data).hexdigest() == row['sha256'], name
        if name == "tg_emoji_483.tgs":
            animation = json.loads(gzip.decompress(data))
            changed = close_opacity_endpoints(animation)
            assert changed > 0
            row["source_sha256"] = row["sha256"]
            data = gzip.compress(json.dumps(animation, separators=(",", ":"), ensure_ascii=False).encode(), mtime=0)
            row["sha256"] = hashlib.sha256(data).hexdigest()
            adjustments.append({"file": name, "opacity_arrays_extended": changed})
        (output / name).write_bytes(data); expected.add(name)
    for old in output.glob('*.tgs'):
        if old.name not in expected: old.unlink()
    manifest["android_compatibility"] = {"method": "explicit unchanged opacity at gradient endpoints", "files": adjustments}
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    for name in ['SOURCE.md', 'Lottie-Android-LICENSE.txt', 'Lottie-Android-NOTICE.txt']: shutil.copyfile(source / name, output / name)
    print('Animated emoji: bundled', len(expected), 'validated TGS files')

if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1]
    source = Path(os.environ.get('VOLNA_ANIMATED_EMOJI', root.parent / 'client/public/site/animated-emoji'))
    prepare(root, source)

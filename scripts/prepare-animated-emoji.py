#!/usr/bin/env python3
"""Vendor the pinned Telegram emoji dataset; run explicitly, never during builds."""
import argparse
import concurrent.futures
import gzip
import hashlib
import json
from pathlib import Path
import time
import urllib.request

REPOSITORY = 'smmisha/telegram-animated-emojis-60fps'
REVISION = '8b81dfed18dab9aace949d9e59d863e2fef1b063'
BASE = f'https://huggingface.co/datasets/{REPOSITORY}/resolve/{REVISION}/'
ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'client/public/site/animated-emoji'


def download(path):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(BASE + path, timeout=60) as response:
                return response.read()
        except Exception:
            if attempt == 3:
                raise
            time.sleep(attempt + 1)


def main(cache):
    def cached(path):
        file = cache / path
        if not file.exists():
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(download(path))
        return file.read_bytes()
    metadata = cached('metadata.jsonl')
    rows = [json.loads(line) for line in metadata.decode().splitlines() if line.strip()]
    assert len(rows) == 599
    DEST.mkdir(parents=True, exist_ok=True)

    previous = json.loads((DEST / 'manifest.json').read_text()) if (DEST / 'manifest.json').exists() else {}
    old = {row['file']: row for row in previous.get('animations', [])}

    def vendor(row):
        filename = row['tgs_file']
        assert filename == f"{row['code']}.tgs"
        target = DEST / filename
        source_cache = cache / 'tgs' / filename
        if target.exists() and not source_cache.exists() and 'source_tgs_sha256' not in old.get(filename, {}):
            source_cache.parent.mkdir(parents=True, exist_ok=True)
            source_cache.write_bytes(target.read_bytes())
        original = cached('tgs/' + filename)
        raw_json = cached('lottie/' + row['code'] + '.json')
        animation = json.loads(raw_json)
        assert animation['fr'] == 60 and animation['op'] > animation.get('ip', 0)
        assert animation['w'] == 512 and animation['h'] == 512
        assert not any(asset.get('p') for asset in animation.get('assets', [])), 'External image asset'
        repaired = animation != json.loads(gzip.decompress(original))
        data = gzip.compress(json.dumps(animation, ensure_ascii=False, separators=(',', ':')).encode(), mtime=0) if repaired else original
        target.write_bytes(data); target.chmod(0o644)
        return row['unicode_char'].replace('\ufe0f', ''), {
            'file': filename, 'name': row['name'], 'sha256': hashlib.sha256(data).hexdigest(),
            'source_tgs_sha256': hashlib.sha256(original).hexdigest(),
            'source_json_sha256': hashlib.sha256(raw_json).hexdigest(), 'repaired_from_lottie': repaired
        }

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        entries = list(pool.map(vendor, rows))
    # Several source entries repeat an emoji or differ only by VS16.
    # Keep Telegram's first occurrence for a stable Unicode lookup.
    unique = {}
    for emoji, item in entries:
        unique.setdefault(emoji, item)
    manifest = {'repository': REPOSITORY, 'revision': REVISION,
                'animations': [dict(unicode=emoji, **item) for emoji, item in entries]}
    (DEST / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    (ROOT / 'client/src/animated-emoji-index.json').write_text(json.dumps(
        {emoji: item['file'] for emoji, item in unique.items()}, ensure_ascii=False, indent=2) + '\n')
    print('Repaired from pinned Lottie JSON:', [(emoji, item['file']) for emoji, item in entries if item['repaired_from_lottie']], flush=True)
    print(f'Vendored {len(entries)} animations, {sum(p.stat().st_size for p in DEST.glob("*.tgs")):,} bytes')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--cache', type=Path, default=ROOT / 'artifacts/animated-emoji-source')
    main(parser.parse_args().cache)

#!/usr/bin/env python3
"""Vendor the pinned Telegram emoji dataset; run explicitly, never during builds."""
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


def main():
    metadata = download('metadata.jsonl')
    rows = [json.loads(line) for line in metadata.decode().splitlines() if line.strip()]
    assert len(rows) == 599
    DEST.mkdir(parents=True, exist_ok=True)

    def vendor(row):
        filename = row['tgs_file']
        assert filename == f"{row['code']}.tgs"
        target = DEST / filename
        data = target.read_bytes() if target.exists() else download('tgs/' + filename)
        animation = json.loads(gzip.decompress(data))
        assert animation['fr'] == 60 and animation['op'] > animation.get('ip', 0)
        assert not any(asset.get('p') for asset in animation.get('assets', [])), 'External image asset'
        target.write_bytes(data)
        return row['unicode_char'].replace('\ufe0f', ''), {
            'file': filename, 'name': row['name'], 'sha256': hashlib.sha256(data).hexdigest()
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
    print(f'Vendored {len(entries)} animations, {sum(p.stat().st_size for p in DEST.glob("*.tgs")):,} bytes')


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Bundle a pinned Unicode 17 colour font and Russian emoji index into the APK.

Downloads are atomic, reusable and optional after the first build. No phone needs
to contact Google/Unicode to render or search standard emoji.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import xml.etree.ElementTree as ET

NOTO_COMMIT = "8998f5dd683424a73e2314a8c1f1e359c19e8742"
BASE = f"https://raw.githubusercontent.com/googlefonts/noto-emoji/{NOTO_COMMIT}"
SOURCES = {
    "NotoColorEmoji.ttf": BASE + "/fonts/NotoColorEmoji.ttf",
    "FONT-LICENSE.txt": BASE + "/fonts/LICENSE",
    "emoji-test.txt": "https://unicode.org/Public/17.0.0/emoji/emoji-test.txt",
    "ru.xml": "https://raw.githubusercontent.com/unicode-org/cldr/release-48/common/annotations/ru.xml",
    "ru-derived.xml": "https://raw.githubusercontent.com/unicode-org/cldr/release-48/common/annotationsDerived/ru.xml",
    "UNICODE-LICENSE.txt": "https://raw.githubusercontent.com/unicode-org/cldr/release-48/LICENSE",
}
GROUPS = {"Smileys & Emotion": "faces", "People & Body": "people",
          "Animals & Nature": "animals", "Food & Drink": "food",
          "Travel & Places": "travel", "Activities": "activities",
          "Objects": "objects", "Symbols": "symbols", "Flags": "flags"}
SYNONYMS = {"сердце": "любовь сердечко", "улыб": "радость весело смешно",
            "смех": "смешно смеюсь ржу", "слез": "плачу грустно", "слёз": "плачу грустно",
            "автомоб": "машина авто", "лицо": "смайл эмоция", "кот": "кошка котик",
            "палец": "рука лайк", "торт": "праздник день рождения", "еда": "кушать"}

def key(text):
    return text.replace("\ufe0f", "")

def catalog(test_text, annotation_texts):
    names, keywords = {}, {}
    for xml in annotation_texts:
        for node in ET.fromstring(xml).iter("annotation"):
            value = key(node.attrib.get("cp", ""))
            label = (node.text or "").strip()
            if node.attrib.get("type") == "tts":
                names[value] = label
            else:
                keywords.setdefault(value, set()).update(w.strip() for w in label.split("|"))
    entries, aliases = [], {}
    group = "faces"
    for line in test_text.splitlines():
        if line.startswith("# group:"):
            group = GROUPS.get(line.split(":", 1)[1].strip(), "people")
        match = re.match(r"^([0-9A-F ]+)\s*;\s*([a-z-]+)\s*#\s*\S+\s+E[0-9.]+\s+(.+)$", line)
        if not match:
            continue
        codepoints, status, english = match.groups()
        value = "".join(chr(int(cp, 16)) for cp in codepoints.split())
        normalized = key(value)
        if status not in ("fully-qualified", "component"):
            aliases[value] = normalized
            continue
        label = names.get(normalized, english)
        tags = set(keywords.get(normalized, ())) | {label, english}
        for word, synonyms in SYNONYMS.items():
            if word in label.lower():
                tags.add(synonyms)
        # Keep fully qualified sequences, including families, flags and mixed skin tones.
        base = "".join(c for c in value if not 0x1F3FB <= ord(c) <= 0x1F3FF)
        entries.append({"text": value, "name": label, "group": group,
                        "keywords": " ".join(sorted(tags)).lower(), "base": base})
    return {"version": 17, "font": "Noto Color Emoji 2.051", "entries": entries, "aliases": aliases}

def prepare(root, cache, offline):
    cache.mkdir(parents=True, exist_ok=True)
    pinned = cache / "noto-2.051-unicode-17-cldr-48"
    pinned.mkdir(exist_ok=True)
    for name, url in SOURCES.items():
        target = pinned / name
        if target.is_file() and target.stat().st_size > 100:
            continue
        if offline:
            raise RuntimeError(f"Emoji resource {name} is not cached. Run with ANDROID_BUILD_OFFLINE=0 once.")
        partial = target.with_suffix(target.suffix + ".part")
        subprocess.run(["curl", "--fail", "--location", "--retry", "3", "--connect-timeout", "20",
                        "--max-time", "180", url, "-o", str(partial)], check=True)
        partial.replace(target)
    font = (pinned / "NotoColorEmoji.ttf").read_bytes()
    if len(font) < 5_000_000 or font[:4] not in (b"\x00\x01\x00\x00", b"OTTO"):
        raise RuntimeError("Invalid Noto colour font; remove the cached file and retry.")
    data = catalog((pinned / "emoji-test.txt").read_text(), [(pinned / n).read_text() for n in ("ru.xml", "ru-derived.xml")])
    if len(data["entries"]) < 3500:
        raise RuntimeError("Emoji catalog is incomplete; APK publication stopped.")
    destination = root / "app/src/main/assets/emoji"
    destination.mkdir(parents=True, exist_ok=True)
    for name in ("NotoColorEmoji.ttf", "FONT-LICENSE.txt", "UNICODE-LICENSE.txt"):
        (destination / name).write_bytes((pinned / name).read_bytes())
    (destination / "catalog.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    manifest = {"noto_commit": NOTO_COMMIT, "unicode": 17, "cldr": 48,
                "emoji_count": len(data["entries"]), "font_sha256": hashlib.sha256(font).hexdigest()}
    (destination / "manifest.json").write_text(json.dumps(manifest) + "\n")
    print(f"Emoji: bundled {len(data['entries'])} Unicode 17 sequences and Noto 2.051; cache: {pinned}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--cache", type=Path, default=Path(os.environ.get("ANDROID_DOWNLOAD_CACHE", "/cache/downloads")))
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    prepare(args.root, args.cache, args.offline)

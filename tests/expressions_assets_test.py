import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("assets", Path(__file__).resolve().parents[1] / "android-native/scripts/prepare-expressions.py")
assets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assets)

class EmojiAssetsTest(unittest.TestCase):
    def test_catalog_keeps_zwj_skin_flags_aliases_and_russian_search(self):
        text = """# group: People & Body
1F44D ; fully-qualified # 👍 E0.6 thumbs up
1F44D 1F3FD ; fully-qualified # 👍🏽 E1.0 thumbs up: medium skin tone
1F468 200D 1F469 200D 1F467 ; fully-qualified # 👨‍👩‍👧 E2.0 family
# group: Smileys & Emotion
2764 FE0F ; fully-qualified # ❤️ E0.6 red heart
2764 ; unqualified # ❤ E0.6 red heart
# group: Flags
1F1F7 1F1FA ; fully-qualified # 🇷🇺 E2.0 flag Russia
"""
        xml = '<ldml><annotations><annotation cp="❤️" type="tts">красное сердце</annotation><annotation cp="❤️">любовь | сердце</annotation><annotation cp="👍" type="tts">большой палец</annotation></annotations></ldml>'
        catalog = assets.catalog(text, [xml]); rows = {e["text"]: e for e in catalog["entries"]}
        self.assertEqual(rows["👍🏽"]["base"], "👍")
        self.assertEqual(rows["👨‍👩‍👧"]["text"], "👨‍👩‍👧")
        self.assertEqual(rows["🇷🇺"]["group"], "flags")
        self.assertEqual(rows["❤️"]["name"], "красное сердце")
        self.assertIn("любовь", rows["❤️"]["keywords"])
        self.assertEqual(catalog["aliases"]["❤"], "❤")

    def test_strict_offline_never_starts_curl_for_missing_resources(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(assets.subprocess, "run") as download:
            with self.assertRaisesRegex(RuntimeError, "not cached"):
                assets.prepare(Path(directory) / "root", Path(directory) / "cache", True)
            download.assert_not_called()

    def test_cached_build_is_complete_and_does_not_download(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(assets.subprocess, "run") as download:
            root = Path(directory) / "root"; cache = Path(directory) / "cache"
            pinned = cache / "noto-2.051-unicode-17-cldr-48"; pinned.mkdir(parents=True)
            for name in assets.SOURCES:
                (pinned / name).write_text("fixture " * 30)
            (pinned / "NotoColorEmoji.ttf").write_bytes(b"\x00\x01\x00\x00" + bytes(5_000_000))
            rows = [f"{0x1F600+i:X} ; fully-qualified # 😀 E1.0 fixture-{i}" for i in range(3600)]
            (pinned / "emoji-test.txt").write_text("# group: Smileys & Emotion\n" + "\n".join(rows))
            for name in ("ru.xml", "ru-derived.xml"):
                (pinned / name).write_text("<ldml>" + " " * 150 + "</ldml>")
            assets.prepare(root, cache, True)
            download.assert_not_called()
            self.assertTrue((root / "app/src/main/assets/emoji/catalog.json").is_file())
            self.assertTrue((root / "app/src/main/assets/emoji/FONT-LICENSE.txt").is_file())
            (pinned / "NotoColorEmoji.ttf").write_bytes(b"invalid" * 30)
            with self.assertRaisesRegex(RuntimeError, "Invalid Noto"):
                assets.prepare(root, cache, True)

if __name__ == "__main__":
    unittest.main()

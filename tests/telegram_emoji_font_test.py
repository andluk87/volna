import hashlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
from PIL import Image
from fontTools.ttLib import TTFont

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('telegram_builder',ROOT/'scripts/prepare-telegram-emoji.py')
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)

class TelegramEmojiFontTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.assets=ROOT/'client/public/site/emoji'
        cls.font=TTFont(cls.assets/'TelegramEmoji.ttf')
        cls.shape=builder.Shaper(cls.assets/'TelegramEmoji.ttf')
        cls.order=cls.font.getGlyphOrder()
    def bitmap(self,text):
        glyphs=self.shape(text)
        self.assertEqual(len(glyphs),1,text)
        return Image.open(io.BytesIO(self.font['CBDT'].strikeData[0][self.order[glyphs[0]]].imageData)).convert('RGBA')
    def test_actual_font_pixels_match_pinned_telegram_atlas_samples(self):
        golden=json.loads((ROOT/'tests/telegram-emoji-golden.json').read_text())
        for text,expected in golden.items():
            image=self.bitmap(text)
            self.assertEqual(image.size,(72,72),text)
            self.assertEqual(hashlib.sha256(image.tobytes()).hexdigest(),expected,text)
    def test_all_supported_sequences_shape_without_missing_or_fallback_art(self):
        supported=json.loads((self.assets/'supported.json').read_text())
        self.assertEqual(len(supported),3941)
        unknown=self.bitmap('❓').tobytes()
        for text in supported:
            image=self.bitmap(text)
            if text!='❓':self.assertNotEqual(image.tobytes(),unknown,text)
        for bitmap in self.font['CBDT'].strikeData[0].values():
            self.assertEqual(Image.open(io.BytesIO(bitmap.imageData)).size,(72,72))
    def test_manifest_licenses_and_same_tone_aliases_are_bundled(self):
        manifest=json.loads((self.assets/'manifest.json').read_text())
        self.assertEqual(hashlib.sha256((self.assets/'TelegramEmoji.ttf').read_bytes()).hexdigest(),manifest['font_sha256'])
        self.assertEqual(manifest['tdesktop_commit'],builder.TDESKTOP)
        for name in ['TELEGRAM-LICENSE.txt','SHAPING-LICENSE.txt','NOTICE.txt','font.css']:
            self.assertGreater((self.assets/name).stat().st_size,100)
        for extended,canonical in manifest['aliases'].items():self.assertEqual(self.shape(extended),self.shape(canonical))

if __name__=='__main__':unittest.main()

# Telegram animated emoji assets

TGS/Lottie assets from smmisha/telegram-animated-emojis-60fps:
https://huggingface.co/datasets/smmisha/telegram-animated-emojis-60fps/tree/8b81dfed18dab9aace949d9e59d863e2fef1b063

The dataset card declares MIT. The upstream repository does not supply a separate
license text or copyright attribution for the Telegram artwork; this notice
records the publisher's declaration without asserting additional rights.

599 files represent 580 unique emoji after removing the optional U+FE0F
presentation selector. The lookup uses the first entry in Telegram order when
there are duplicates. Other selectors, skin tones and ZWJ sequences are retained.
manifest.json records the source revision, original TGS and JSON hashes, and
packaged SHA-256 for every file. All 599 TGS were compared with their matching
Lottie JSON. The source tg_emoji_001.tgs incorrectly duplicates the skull file;
only this heart animation is rebuilt (deterministic gzip) from tg_emoji_001.json.
The other 598 TGS remain byte-for-byte unchanged.

Reproduce with: python3 scripts/prepare-animated-emoji.py
The runtime loads these local files; it makes no requests to Hugging Face.

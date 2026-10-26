# Telegram animated emoji assets

Original TGS files from smmisha/telegram-animated-emojis-60fps:
https://huggingface.co/datasets/smmisha/telegram-animated-emojis-60fps/tree/8b81dfed18dab9aace949d9e59d863e2fef1b063

The dataset card declares MIT. The upstream repository does not supply a separate
license text or copyright attribution for the Telegram artwork; this notice
records the publisher's declaration without asserting additional rights.

599 original files represent 580 unique emoji after removing the optional U+FE0F
presentation selector. The lookup uses the first entry in Telegram order when
there are duplicates. Other selectors, skin tones and ZWJ sequences are retained.
manifest.json records source revision and SHA-256 hashes for all files.

Reproduce with: python3 scripts/prepare-animated-emoji.py
The runtime loads these local files; it makes no requests to Hugging Face.

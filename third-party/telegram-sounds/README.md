# Telegram call sounds

The MP3 files are copied without modification from the official source repositories listed in `manifest.json`. The manifest records exact source commits, original paths, destination paths, sizes and SHA-256 hashes.

- Android VoIP sounds: https://github.com/DrKLO/Telegram — upstream license reproduced in `android-LICENSE` (GPL v2).
- Desktop/Web call sounds: https://github.com/telegramdesktop/tdesktop — upstream license reproduced in `desktop-LICENSE` (GPL v3).
- Desktop/Web failure uses Android's `voip_failed.mp3`, renamed `call_failed.mp3` without changing its bytes.

Copyright remains with the respective upstream authors. Consult the included upstream licenses and source repositories for their terms. Android's `voip_busy.mp3` and `voip_end.mp3` have identical bytes in the pinned upstream snapshot; the busy effect is repeated while end is played once. Existing Android incoming ringtone selection remains in effect.

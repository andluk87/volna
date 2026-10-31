# Волна 0.12.96 — русские голосовые, CPU, локальная GigaAM v3

Основной движок русского распознавания заменён на GigaAM v3 E2E RNN-T в полной float32-точности. ONNX Runtime работает на CPU, GPU не требуется. Модель возвращает текст с регистром и пунктуацией. Аудио не передаётся бесплатным/платным внешним API. Интернет нужен один раз для весов, которые сохраняются в постоянном volume.

Длинное сообщение делится по паузам с запасом вокруг слов, каждый фрагмент помещается в поддерживаемое окно модели. Понижен порог VAD для короткой и тихой речи. Скрытый переход на старую base отключён; health показывает фактическую модель. Для других языков и сравнения сохранена Whisper large-v3: beam=10, patience=2, float32, без случайного температурного семплирования. Версия PyAV закреплена: реальный тест выявил несовместимость latest PyAV с faster-whisper 1.2.1.

Сервер общий для Android, Windows и Web. Поведение клиентов и формат сохранённого текста совместимы с предыдущей версией.

## Обновление одной вставкой

Из существующей папки проекта с `.env`:

```sh
( set -eu; test -f compose.yaml && test -f .env; volna_update_dir=$(mktemp -d); trap 'rm -rf "$volna_update_dir"' EXIT; git clone --depth 1 --branch v0.12.96 https://github.com/andluk87/volna.git "$volna_update_dir/source"; git -C "$volna_update_dir/source" archive --output="$volna_update_dir/source.tar" HEAD; sh "$volna_update_dir/source/scripts/backup.sh"; if [ -d android-native/app/src ]; then mkdir -p backups; volna_source_backup=$(mktemp -d "$PWD/backups/android-source-0.12.96-XXXXXXXX"); mv android-native/app/src "$volna_source_backup/src"; fi; tar -xf "$volna_update_dir/source.tar" -C .; python3 scripts/improve-transcription.py; VOLNA_BUILD_NETWORK=host sh scripts/build-clients.sh )
```

Миграция сохраняет `.env` приватно в `backups/`. Прежний стандартный русский профиль получает `ASR_ENGINE=gigaam`, потоки `auto`, резерв base отключается. Явно заданный движок, нестандартный путь модели и другой/автоматический язык сохраняются; для них остаётся Whisper. TURN, ключи подписи и данные не меняются.

После первого скачивания дождитесь готовности:

```sh
docker compose exec -T transcription python -c 'import urllib.request; print(urllib.request.urlopen("http://127.0.0.1:8000/health").read().decode())'
docker compose logs --since=15m --timestamps transcription
```

Для русского стандартного профиля ожидаются `engine:gigaam`, `active_model:gigaam-v3-e2e-rnnt`, `state:ready`. HTTP 200 от health сам по себе не означает, что загрузка закончилась. Старый результат нужно обновить кнопкой **«Распознать заново»**. Простое открытие текста читает кэш. При сбое старый текст сохраняется.

Потоки: `ASR_CPU_THREADS=auto` учитывает affinity и cgroup v2 CPU quota, до 16 потоков. На выделенном сервере можно задать 24 или 32 (максимум 64), но ускорение нужно измерять. Подробности, альтернативный Whisper и проверка качества: [TRANSCRIPTION-QUALITY.md](docs/TRANSCRIPTION-QUALITY.md).

Проверки: 235 Node-тестов, 19 Python unit/HTTP тестов для каждого из двух движков и тесты при сборке настоящего production Docker-образа; реальные веса float32 на CPU. Проверены записи 11,29 и 71,25 секунды, WAV, Ogg/Opus, WebM/Opus, M4A/AAC и тихая запись. В отдельном контейнере с непривилегированным пользователем, read-only кэшем и отключённой сетью проверены HTTP-распознавание, тишина и повреждённое аудио. Production-сборки Web/Windows renderer и APK. Исходные WAV на тестовой машине с четырьмя CPU-потоками заняли примерно 1,4 и 7,7 секунды. Это не WER-бенчмарк; точность на ваших записях пока не измерена.

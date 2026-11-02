# Волна 0.12.101 — диагностика звонка при потере клиентских отчётов

Лог 0.12.100 может содержать `offer`/`answer` без единого события `rtc.state`: ошибки отдельной отправки отчётов игнорировались Android, а отказы их приёмника не попадали в журнал. По такому файлу нельзя отличить отсутствие клиентского отчёта от его недоставки. Это ограничение диагностики, а не установленная причина обрыва медиасоединения.

## Быстрое обновление только сервера

Для следующей проверки можно оставить оба клиента на **0.12.100**. Новый сервер сам считает ICE-кандидаты из уже полученных offer/answer и записывает `rtc.sdp_summary`: роль стороны, этап, количество relay/host/srflx/prflx и UDP/TCP. Сам SDP, адреса и пароли не записываются. Для Android сервер также записывает платформу/версию из штатного User-Agent, не сохраняя сам заголовок.

Из существующей папки проекта с `.env`, одной вставкой:

```sh
( set -eu; test -f compose.yaml && test -f .env; volna_update_dir=$(mktemp -d); trap 'rm -rf "$volna_update_dir"' EXIT; git clone --depth 1 --branch v0.12.101 https://github.com/andluk87/volna.git "$volna_update_dir/source"; git -C "$volna_update_dir/source" archive --output="$volna_update_dir/source.tar" HEAD; sh "$volna_update_dir/source/scripts/backup.sh"; tar -xf "$volna_update_dir/source.tar" -C .; docker compose build server; docker compose up -d --no-deps server )
```

Команда сохраняет резервную копию, обновляет исходники и пересобирает/перезапускает только `server`. Windows, Android и Web не пересобираются, проверки наличия 4 ГБ для Windows здесь нет. `.env`, APK/EXE и постоянные Docker volumes сохраняются. Если сборка сервера завершится ошибкой, его рабочий контейнер не пересоздаётся.

Затем повторите неудачный звонок и пришлите журнал:

```sh
docker compose exec -T server tail -n 300 /data/logs/volna-calls.log
```

Нужны две записи `rtc.sdp_summary` — для исходящей и принимающей стороны. `relay_count:0` означает, что к моменту передачи соответствующего SDP в нём не было relay-кандидатов. Положительное значение подтверждает наличие такого кандидата, но ещё не доказывает прохождение медиа через TURN. `call.diagnostics_rejected` показывает HTTP-статус отказа отдельной диагностики. Исторический лог задним числом дополнить нельзя — нужен новый звонок после обновления сервера.

## Резервная доставка в клиентах 0.12.101

Android/Web/Windows дополнительно передают последнюю сводку вместе с обычными запросами звонка, включая polling и offer/answer. Поэтому отдельный запрос к приёмнику диагностики больше не является единственным способом доставки. У каждого отчёта есть ID: сервер убирает дубли между двумя каналами, проверяет участника звонка и допустимые поля. Резервный отчёт ограничен по размеру, аккаунту и сроку жизни; его ошибка не прерывает основной запрос звонка.

В журнале `source:"post"` означает отдельный отчёт, `source:"call_request"` — доставку с обычным запросом. При ошибке отдельной доставки новая сводка может содержать `delivery_http_status` / `delivery_error_type`. Android также пишет короткое сообщение `VolnaCallTelemetry` без текста сетевой ошибки, URL и токенов. Невозможность записи в сам журнал возвращается отдельному отправителю как 503, а не подтверждается как успешная запись.

Файл `/data/logs/volna-calls.log`, лимит 1 МиБ и архивирование в датированные `.log.tar.gz` сохранены. Само соединение, TURN-only и модель распознавания не меняются. Сбор логов и чтение архивов описаны в [0.12.100](UPDATE-0.12.100.md).

## Полное обновление клиентов, если требуется резервная доставка

```sh
( set -eu; test -f compose.yaml && test -f .env; volna_update_dir=$(mktemp -d); trap 'rm -rf "$volna_update_dir"' EXIT; git clone --depth 1 --branch v0.12.101 https://github.com/andluk87/volna.git "$volna_update_dir/source"; git -C "$volna_update_dir/source" archive --output="$volna_update_dir/source.tar" HEAD; sh "$volna_update_dir/source/scripts/backup.sh"; if [ -d android-native/app/src ]; then mkdir -p backups; volna_source_backup=$(mktemp -d "$PWD/backups/android-source-0.12.101-XXXXXXXX"); mv android-native/app/src "$volna_source_backup/src"; fi; tar -xf "$volna_update_dir/source.tar" -C .; python3 scripts/improve-transcription.py; VOLNA_BUILD_NETWORK=host sh scripts/build-clients.sh )
```

После полного обновления установите новые Android/Windows и перезагрузите Web. Для первичного сбора сводок ICE достаточно обновления только сервера выше. Обновление вашего сервера автоматически не выполнялось.

## Проверки

Прошли 259 Node-тестов и 230 Android-тестов; собраны Web, Windows renderer и APK 12101. API-тесты воспроизводят сводки offer/answer от клиента 0.12.100, резервную доставку, удаление дублей между каналами, отказы и запрет чужих отчётов без прерывания polling. Проверены ограничения размера/возраста/аккаунта и отсутствие SDP/токенов в журнале. В Chromium проверены звонки Web/Windows при отказе отдельного приёмника и передача диагностики обычными запросами. Реальная причина сбоя конкретной сети определяется по следующему журналу; физические телефоны и ваш TURN из этой среды недоступны.

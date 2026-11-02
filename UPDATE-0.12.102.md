# Волна 0.12.102 — раннее восстановление при пустом наборе TURN-кандидатов

Исправление основано на журнале: в начальном offer или answer иногда нет ни одного relay-кандидата, после чего клиенты ждут ошибки ICE около 20 секунд. После ICE restart кандидаты появляются, звонок соединяется, медиапакеты идут через relay. Наличие отдельных ошибок ICE 701 при этом не означает, что весь TURN недоступен: часть попыток к серверу или сетевых интерфейсов может завершаться ошибкой, а другие дают рабочий relay.

Теперь после первого answer сервер проверяет полный ICE SDP обеих сторон. Если у одной из них нет relay-кандидатов и оба клиента поддерживают протокол восстановления, сервер сразу запрашивает ICE restart. Существующие Android/Web/Windows клиенты выполняют восстановление при следующем обычном обновлении состояния, не ожидая первичного ICE failure.

- Работает с клиентами 0.12.100; пересборка приложений для этого исправления не нужна.
- Нормальный начальный набор relay-кандидатов не вызывает дополнительного восстановления.
- Автоматический ранний запрос делается один раз; действующий тайм-аут восстановления остаётся, бесконечного цикла нет.
- Повторная отправка исходного answer после потери HTTP-ответа безопасна: она не перезаписывает новое поколение ICE и не завершает звонок ошибкой конфликта.
- TURN-only сохранён. Идентификатор звонка и таймер разговора не сбрасываются.
- В журнале появляется `call.reconnecting` с `reason:"empty_initial_relay"`, `caller_relay_count` и `callee_relay_count`.

Это сокращает ожидание в выявленном сценарии, но не устраняет недоступность TURN или ограничения сети, если повторное получение кандидатов тоже не удаётся. Саму причину первоначального пустого набора (интерфейс, маршрут, DNS, доступность транспорта TURN) из имеющегося журнала установить нельзя. Полные SDP, IP-адреса кандидатов и секреты не сохраняются.

## Обновить только сервер одной вставкой

Из стандартной папки проекта с `.env`:

```sh
( set -eu; test -f compose.yaml && test -f .env; volna_update_dir=$(mktemp -d); trap 'rm -rf "$volna_update_dir"' EXIT; git clone --depth 1 --branch v0.12.102 https://github.com/andluk87/volna.git "$volna_update_dir/source"; git -C "$volna_update_dir/source" archive --output="$volna_update_dir/source.tar" HEAD; sh "$volna_update_dir/source/scripts/backup.sh"; tar -xf "$volna_update_dir/source.tar" -C .; docker build --network=host -f docker/server.Dockerfile -t volna-server .; docker compose up -d --no-deps --no-build server )
```

Сборка сервера использует сеть хоста, как при обходе ошибки Docker DNS `EAI_AGAIN registry.npmjs.org`. Команда обновляет исходники, но не пересобирает Windows/Android/Web и не требует прохождения Windows-проверки на 4 ГБ. `.env`, готовые APK/EXE и постоянные данные сохраняются. TURN и transcription не пересоздаются. При ошибке сборки команда останавливается до пересоздания сервера.

Проверка установленного сервера:

```sh
docker compose exec -T server node -p "require('./package.json').version"
```

Ожидается `0.12.102`. После обновления повторите звонок, примите на втором устройстве и сохраните журнал:

```sh
docker compose exec -T server tail -n 200 /data/logs/volna-calls.log
```

Нужно сравнить первый `rtc.answer`, ранний `call.reconnecting` с указанной причиной и последующий `call.connected`. Для подтверждения передачи медиа используются счётчики `rtc.stats`. Обновление вашего сервера автоматически не выполнялось.

## Полное обновление, если требуется

```sh
( set -eu; test -f compose.yaml && test -f .env; volna_update_dir=$(mktemp -d); trap 'rm -rf "$volna_update_dir"' EXIT; git clone --depth 1 --branch v0.12.102 https://github.com/andluk87/volna.git "$volna_update_dir/source"; git -C "$volna_update_dir/source" archive --output="$volna_update_dir/source.tar" HEAD; sh "$volna_update_dir/source/scripts/backup.sh"; if [ -d android-native/app/src ]; then mkdir -p backups; volna_source_backup=$(mktemp -d "$PWD/backups/android-source-0.12.102-XXXXXXXX"); mv android-native/app/src "$volna_source_backup/src"; fi; tar -xf "$volna_update_dir/source.tar" -C .; python3 scripts/improve-transcription.py; VOLNA_BUILD_NETWORK=host sh scripts/build-clients.sh )
```

## Проверки

Прошли 262 Node-теста и 230 Android-тестов; собраны Web, Windows renderer и APK 12102. Проверены пустой набор у инициатора и получателя, отсутствие лишнего рестарта при нормальном relay, совместимость старого протокола, повторные и запоздавшие answer, защита от устаревших поколений, подтверждение обоими участниками и ограниченный тайм-аут при повторном пустом наборе. Состояние и права остальных звонков проверяются общим набором API-тестов. Физические телефоны и сеть вашего TURN в этой среде недоступны; ускорение в вашей сети нужно подтвердить новым звонком после обновления.

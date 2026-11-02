# Волна 0.12.106 — общий ICE-транспорт и предварительный сбор кандидатов

Видео и три последних звонка 0.12.105 показывают оставшееся ожидание после принятия. По журналу соединение подтверждалось через 3,99 / 4,82 / 5,23 секунды после `call.accepted`. Во всех трёх случаях первый answer получателя содержал ноль relay-кандидатов, затем выполнялся ICE restart. Время ответа человека в эти значения не входит. Android также сообщал завершение первого сбора за несколько миллисекунд, хотя события ошибок отдельных попыток TURN приходили позже.

В Android, Web и Windows изменена начальная конфигурация WebRTC:

- `bundlePolicy=max-bundle`: аудио, камера и демонстрация экрана используют один ICE/DTLS-транспорт. Не создаются отдельные первоначальные транспорты аудио и видео с последующим объединением при ответе.
- `iceCandidatePoolSize=1`: одна сессия сбора ICE-кандидатов готовится заранее, до offer/answer.
- `rtcpMuxPolicy=require` и Unified Plan в Android сохранены вместе с TURN-only. UDP/TCP адреса TURN и учётные данные остаются прежними.

Это уменьшает работу при первом согласовании и меняет запуск ICE в проблемном месте. Привязка пустого первого answer именно к прежнему объединению транспортов на физических телефонах пока не подтверждена. Выпуск не обещает конкретное время в любой сети: следующий журнал должен показать, появились ли relay-кандидаты уже в первом ответе и удалось ли обойтись без ICE restart.

Диагностика дополнена `bundle_policy`, `candidate_pool_size`, безопасными событиями `rtc.candidate` с типом/протоколом и временем сбора `rtc.gathered.elapsed_ms` в Android. IP-адреса кандидатов, SDP, ICE-пароли и TURN-пароли не записываются. Ускоренное продолжение согласования из 0.12.105 и раннее восстановление при пустом SDP остаются доступны.

## Обновление

Из `/root/volna-messenger`, где есть `.env` и `compose.yaml`:

```sh
( set -eu; test -f compose.yaml && test -f .env; volna_update_dir=$(mktemp -d); trap 'rm -rf "$volna_update_dir"' EXIT; git clone --depth 1 --branch v0.12.106 https://github.com/andluk87/volna.git "$volna_update_dir/source"; git -C "$volna_update_dir/source" archive --output="$volna_update_dir/source.tar" HEAD; sh "$volna_update_dir/source/scripts/backup.sh"; if [ -d android-native/app/src ]; then mkdir -p backups; volna_source_backup=$(mktemp -d "$PWD/backups/android-source-0.12.106-XXXXXXXX"); mv android-native/app/src "$volna_source_backup/src"; fi; tar -xf "$volna_update_dir/source.tar" -C .; VOLNA_BUILD_NETWORK=host sh scripts/build-clients.sh )
```

Установите **Android 0.12.106 (12106) на оба телефона**. Для Windows нужен новый клиент, Web нужно перезагрузить после публикации. Если сейчас требуется только Android, замените в команде `sh scripts/build-clients.sh` на `sh scripts/build-android.sh`. Существующие настройки, данные и артефакты сохраняются, перед обновлением создаётся резервная копия. Windows-builder требует 4 ГБ свободного места.

После тестового звонка пришлите ту же действующую ссылку либо создайте новую через меню бота → `/calllog`. Сравним первый `rtc.sdp_summary` со `stage:answer`, наличие `call.reconnecting` и интервал от принятия до фактического `rtc.state.connection:connected` / `call.connected`.

## Проверки

Прошли 269 Node-тестов и 241 Android-тест. Собраны Web, Windows renderer и APK; проверена версия 0.12.106 (12106).

Проверяются реальная Android RTCConfiguration из используемого WebRTC SDK, BUNDLE, RTCP mux, один предварительный пул и принудительный relay, сохранение обоих TURN-транспортов, отсутствие адресов/секретов в событиях кандидатов, фильтрация полей сервером. Chromium проверяет передачу новой конфигурации реальному RTCPeerConnection в Web/Windows. Дополнительно выполняются общие серверные и Android-тесты, сборка клиентов и проверка версии APK. Физические телефоны и TURN-сеть пользователя в среде сборки недоступны.

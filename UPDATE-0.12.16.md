# Обновление Волны до 0.12.16

Исправлен разбор шестнадцатеричного ID шлюза, например `00003c01`. Ранее SMS могла прийти, но код ошибочно отклонял ответ и делал попытку входа недействительной. Теперь такой ответ считается принятым, и OTP можно подтвердить.

Для этого исправления достаточно обновить сервер: установленный Android 0.12.15 пересобирать не нужно. Для перехода со старых APK к новому экрану и SMS Retriever используйте [инструкцию Android 0.12.15](UPDATE-0.12.15.md).

Выполните целиком в прежнем каталоге установки с compose.yaml и .env. Будет создана резервная копия, исходники заменены фиксированной версией, сервер и веб-клиент пересобраны. Данные и настройки сохраняются.

```sh
(
  set -eu
  test -f compose.yaml && test -f .env
  volna_update_dir=$(mktemp -d)
  trap 'rm -rf "$volna_update_dir"' EXIT
  git clone --depth 1 --branch v0.12.16 https://github.com/andluk87/volna.git "$volna_update_dir/source"
  git -C "$volna_update_dir/source" archive --output="$volna_update_dir/source.tar" HEAD
  sh "$volna_update_dir/source/scripts/backup.sh"
  tar -xf "$volna_update_dir/source.tar" -C .
  VOLNA_BUILD_NETWORK=host sh scripts/update.sh
)
```

После обновления запросите новый SMS-код один раз. Коды из ранее ошибочно отклонённых попыток остаются недействительными. Реальную доставку необходимо проверить на вашем шлюзе: в разработке SMS не отправлялись. Если ошибка остаётся, пришлите безопасную диагностику:

```sh
sh scripts/check-sms.sh
docker compose logs --since 10m --tail 300 server | grep '\[sms\]'
```

[Настройка провайдеров](UPDATE-0.12.13.md), [панель администратора](ADMIN.md).

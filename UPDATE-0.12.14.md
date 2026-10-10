# Обновление Волны до 0.12.14

Исправлена ошибка HTTPParserError при обращении к старому SMS-шлюзу. Транспорт совместимости применяется только к шлюзу; Notificore и выбор провайдера сохранены.

Выполните целиком в прежнем каталоге установки с compose.yaml и .env. Будет создана резервная копия, исходники заменены фиксированной версией, сервер и веб-клиент пересобраны. Данные и настройки сохраняются.

```sh
(
  set -eu
  test -f compose.yaml && test -f .env
  volna_update_dir=$(mktemp -d)
  trap 'rm -rf "$volna_update_dir"' EXIT
  git clone --depth 1 --branch v0.12.14 https://github.com/andluk87/volna.git "$volna_update_dir/source"
  git -C "$volna_update_dir/source" archive --output="$volna_update_dir/source.tar" HEAD
  sh "$volna_update_dir/source/scripts/backup.sh"
  tar -xf "$volna_update_dir/source.tar" -C .
  VOLNA_BUILD_NETWORK=host sh scripts/update.sh
)
```

После обновления повторите вход один раз. Реальную доставку необходимо проверить на вашем шлюзе: в разработке SMS не отправлялись. Если ошибка остаётся, пришлите безопасную диагностику:

```sh
sh scripts/check-sms.sh
docker compose logs --since 10m --tail 300 server | grep '\[sms\]'
```

[Настройка провайдеров](UPDATE-0.12.13.md), [панель администратора](ADMIN.md).

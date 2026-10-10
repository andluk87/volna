# Обновление Волны до 0.12.12

Добавлена панель администратора на **8998** со входом по SMS на **89681411241**. Управление пользователями, чатами, участниками, сообщениями, файлами, наборами эмодзи, SMS, устройствами, звонками, настройками, объявлениями и резервными копиями. Все изменения фиксируются в журнале.

Выполните блок целиком в **прежнем каталоге установки**, где находятся `compose.yaml` и `.env`. Он получает фиксированный тег GitHub, сохраняет резервную копию, заменяет исходники, пересобирает и проверяет сервер и веб-клиент. Данные, `.env` и ключи подписи сохраняются; локальные изменения исходников заменяются. Android и Windows для добавления панели пересобирать не требуется.

```sh
(
  set -eu
  test -f compose.yaml && test -f .env || {
    echo 'Откройте каталог установленной Волны с compose.yaml и .env.'
    exit 1
  }
  command -v git >/dev/null
  docker compose version >/dev/null
  volna_update_dir=$(mktemp -d)
  trap 'rm -rf "$volna_update_dir"' EXIT
  git clone --depth 1 --branch v0.12.12 https://github.com/andluk87/volna.git "$volna_update_dir/source"
  git -C "$volna_update_dir/source" archive --output="$volna_update_dir/source.tar" HEAD
  sh "$volna_update_dir/source/scripts/backup.sh"
  tar -xf "$volna_update_dir/source.tar" -C .
  VOLNA_BUILD_NETWORK=host sh scripts/update.sh
  echo 'Волна обновлена до 0.12.12. Панель: https://ваш-домен:8998'
)
```

Разрешите **8998/tcp** в сетевом экране хостинга. Если включён UFW:

```sh
sudo ufw allow 8998/tcp
```

Откройте `https://ВАШ_CHAT_DOMAIN:8998`, введите `89681411241`, запросите SMS и введите шесть цифр. Используются существующие `NOTIFICORE_API_KEY` и `NOTIFICORE_ORIGINATOR`; дополнительные пароли не нужны. `CHAT_DOMAIN` должен содержать ваш рабочий домен с настроенным DNS. Caddy выдаёт HTTPS-сертификат через существующие порты 80/443.

Проверить запуск:

```sh
docker compose logs --tail 80 server
docker compose -f compose.yaml -f compose.https.yaml ps
```

В журнале должны быть строки `Volna API listening on :3000` и `Volna admin listening on :8998`. Если SMS принята провайдером, но не дошла, проверьте доставку в Notificore по `reference`; статус `sent` не гарантирует доставку.

[Возможности, доступ, резервные копии и восстановление](ADMIN.md). Для установки без домена используйте описанный там локальный доступ через SSH-туннель.

Проверки выпуска: 99 серверных тестов, браузерная проверка панели на компьютере и телефоне, production-сборка веб-клиента, проверка Caddy и запуск серверного Docker-образа. Настоящие SMS и доступ к порту на вашем VPS необходимо проверить после обновления.

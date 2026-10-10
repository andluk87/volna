# Обновление Волны до 0.12.13

Добавлен второй SMS-провайдер — HTTP-шлюз на линии 4. Выбор в панели **Настройки → Отправлять SMS через** применяется сразу к входу в мессенджер и панель администратора. По умолчанию сохраняется Notificore.

Выполните целиком в прежнем каталоге установки с `compose.yaml` и `.env`. Блок создаёт резервную копию, получает фиксированную версию GitHub, пересобирает сервер и веб-клиент. Данные, `.env` и подписи приложений сохраняются; локальные изменения исходников заменяются. Пересборка Android/Windows не требуется.

```sh
(
  set -eu
  test -f compose.yaml && test -f .env
  volna_update_dir=$(mktemp -d)
  trap 'rm -rf "$volna_update_dir"' EXIT
  git clone --depth 1 --branch v0.12.13 https://github.com/andluk87/volna.git "$volna_update_dir/source"
  git -C "$volna_update_dir/source" archive --output="$volna_update_dir/source.tar" HEAD
  sh "$volna_update_dir/source/scripts/backup.sh"
  tar -xf "$volna_update_dir/source.tar" -C .
  VOLNA_BUILD_NETWORK=host sh scripts/update.sh
)
```

Для активации шлюза добавьте его реквизиты в `.env` (логин и пароль вводятся только на вашем сервере):

```dotenv
SMS_GATEWAY_URL=http://188.128.67.14:3825/default/en_US/send.html
SMS_GATEWAY_USER=логин_шлюза
SMS_GATEWAY_PASSWORD=пароль_шлюза
SMS_GATEWAY_LINE=4
```

Затем примените `.env` и при необходимости выберите шлюз из консоли, чтобы получить SMS администратора через него:

```sh
docker compose -f compose.yaml -f compose.https.yaml up -d --no-deps --force-recreate server
sh scripts/select-sms-provider.sh gateway
sh scripts/check-sms.sh
```

Для установки без домена уберите `-f compose.https.yaml`. Панель: `https://ВАШ_CHAT_DOMAIN:8998`, номер администратора `89681411241`. В дальнейшем можно переключаться между двумя провайдерами в панели. Notificore остаётся доступным с прежними реквизитами.

Шлюз получает номер в формате `89997776655`, текст `123-456 твоя волна`. Поддерживается предоставленный ответ `Sending,L4 ... ID:...`; сохраняются провайдер и ID без полного ответа. Принятие шлюзом не подтверждает доставку. Реальные SMS при разработке не отправлялись.

[Инструкция панели](ADMIN.md). Проверки выпуска: 104 серверных теста, выбор провайдера в браузере, production-сборка веб-клиента и запуск Docker-образа.

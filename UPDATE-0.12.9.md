# Обновление Волны до 0.12.9 через GitHub

В этой версии панель эмодзи открывается компактным всплывающим окном справа над вводом, по предоставленному образцу. Высота переписки сохраняется. Подтверждение открепления открывается внутри веб-клиента; главное меню стало компактнее. В меню вложений добавлены музыка, серверные опросы и совместные списки; кошелька нет. Миграция базы добавляет поле для этих сообщений без сброса переписок.

Инструкция предназначена для существующей установки 0.12.x на Linux с Docker Compose. Выполняйте команды в прежнем каталоге установки, где находятся `compose.yaml` и ваш `.env`. Используйте прежнего пользователя и настройки Compose, чтобы сохранить тот же проект и его volumes. Переход с 0.11.x описан отдельно в [UPDATE-0.12.0.md](UPDATE-0.12.0.md).

## Быстрое обновление: скопировать и вставить

Откройте терминал в существующем каталоге Волны, где лежат `compose.yaml` и `.env`, и вставьте весь блок. Он останавливается при ошибке, скачивает именно 0.12.9 и сохраняет резервную копию до замены исходников. Локальные изменения кода будут заменены.

```sh
(
  set -eu
  test -f compose.yaml && test -f .env || {
    echo 'Откройте каталог установленной Волны, где лежат compose.yaml и .env.'
    exit 1
  }
  command -v git >/dev/null
  docker compose version >/dev/null
  volna_update_dir=$(mktemp -d)
  trap 'rm -rf "$volna_update_dir"' EXIT
  git clone --depth 1 --branch v0.12.9 https://github.com/andluk87/volna.git "$volna_update_dir/source"
  git -C "$volna_update_dir/source" archive --output="$volna_update_dir/source.tar" HEAD
  sh "$volna_update_dir/source/scripts/backup.sh"
  tar -xf "$volna_update_dir/source.tar" -C .
  VOLNA_BUILD_NETWORK=host sh scripts/update.sh
  echo 'Волна обновлена до 0.12.9. Обновите браузер: Ctrl+F5.'
)
```

## 1. Сохраните данные

Перейдите в свой каталог установки (замените путь, если он другой):

```sh
cd ~/volna-messenger
test -f compose.yaml && test -f .env
sh scripts/backup.sh
```

Продолжайте только после успешного создания архива в `backups/`. Сохраните `.env` отдельно в безопасном месте. Не удаляйте Docker volumes и не выполняйте `docker compose down -v`.

## 2. Получите конкретную версию из GitHub

Этот способ работает и для установки, которая была распакована из ZIP. Команды копируют исходники в текущий каталог, сохраняя существующий `.env`, резервные копии и данные Docker:

```sh
(
  set -eu
  test -f compose.yaml
  test -f .env
  volna_update_dir=$(mktemp -d)
  trap 'rm -rf "$volna_update_dir"' EXIT
  git clone --depth 1 --branch v0.12.9 https://github.com/andluk87/volna.git "$volna_update_dir/source"
  git -C "$volna_update_dir/source" archive HEAD | tar -x -C .
  node_version=$(sed -n 's/^[[:space:]]*"version": "\([^"]*\)".*/\1/p' package.json | head -n 1)
  test "$node_version" = 0.12.9
)
```

При любой ошибке остановитесь и проверьте вывод. Локальные изменения исходников будут заменены файлами этой версии; сохраните их заранее, если вы меняли код.

## 3. Пересоберите и запустите

```sh
VOLNA_BUILD_NETWORK=host sh scripts/update.sh
```

Скрипт пересобирает API, веб-клиент и transcription, создаёт ещё одну резервную копию и ждёт готовности контейнеров. HTTPS и TURN подключаются по существующей конфигурации. Успешный результат содержит `Verified web assets: Volna 0.12.9` и `Update complete`.

После завершения обновите браузер через Ctrl+F5. Проверьте вход, старые переписки и переход по закреплённому сообщению.

## Android и Windows

Для пересборки и публикации установщиков на вашем сервере выполните после успешного обновления:

```sh
VOLNA_BUILD_NETWORK=host sh scripts/build-clients.sh
```

Сохраните прежний ключ подписи Android. Тег GitHub содержит исходники; готовые APK и EXE этой инструкцией не прилагаются.

## Если API не запускается

При ошибке скрипт выводит журналы `server`, `web` и `transcription`. Дополнительно:

```sh
docker logs --tail 120 volna-server-1
```

Если после обновления остаётся прежняя ошибка `FOREIGN KEY constraint failed`, проверьте, что запускали команды в каталоге действующей установки и что сборка завершилась успешно. Не сбрасывайте базу: версия 0.12.9 устраняет причину ошибки без удаления переписок. Если старый код уже удалил отдельные файлы вложений, восстановление этих файлов из резервной копии выполняется отдельно; обновление не возвращает удалённые файлы автоматически.

## Версии

История изменений находится в [CHANGELOG.md](CHANGELOG.md). Исходники этой версии: [v0.12.9](https://github.com/andluk87/volna/tree/v0.12.9), [ZIP](https://github.com/andluk87/volna/archive/refs/tags/v0.12.9.zip). Для следующих версий используйте соответствующий тег и инструкцию `UPDATE-<версия>.md`.

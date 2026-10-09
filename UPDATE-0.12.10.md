# Обновление Волны до 0.12.10

Выполните блок целиком в прежнем каталоге установки, где лежат `compose.yaml` и `.env`. Он создаёт резервную копию, получает фиксированную версию, пересобирает Android и Windows и обновляет сервер и веб-клиент. Первый запуск сборки клиентов требует загрузки SDK и зависимостей и занимает время. Используется адрес вашего сервера из существующего `.env`; данные и настройки сохраняются. Локальные изменения исходников будут заменены.

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
  git clone --depth 1 --branch v0.12.10 https://github.com/andluk87/volna.git "$volna_update_dir/source"
  git -C "$volna_update_dir/source" archive --output="$volna_update_dir/source.tar" HEAD
  sh "$volna_update_dir/source/scripts/backup.sh"
  tar -xf "$volna_update_dir/source.tar" -C .
  VOLNA_BUILD_NETWORK=host sh scripts/build-clients.sh
  echo 'Волна обновлена до 0.12.10. В браузере нажмите Ctrl+F5; обновите приложения Windows и Android.'
)
```

Если требуется только сервер и веб-клиент, замените вызов `scripts/build-clients.sh` на `scripts/update.sh`. Для получения нового оформления Windows/Android необходимы новые EXE/APK. Windows: «Проверить обновления» в трее или установщик со страницы загрузок вашей Волны. Android: встроенное обновление или APK с этой страницы поверх установленного приложения. Подпись Android должна совпадать с прежней; при стандартной Docker-сборке сохраняйте прежнюю папку `artifacts/android-home` с ключом. Не удаляйте приложение и Docker volumes ради обновления.

Если ошибка распознавания остаётся после обновления:

```sh
docker compose logs --tail 100 transcription server
docker compose exec -T transcription python -c 'import urllib.request; print(urllib.request.urlopen("http://127.0.0.1:8000/health").read().decode())'
```

`ready: false` означает, что модель ещё загружается или её загрузка не удалась; поле `state` различает эти случаи. Не присылайте `.env` или секреты. При ошибке обновления резервная копия остаётся в `backups/`.

Сравнение и границы проверки клиентов: [NATIVE-CLIENTS.md](design/reference/NATIVE-CLIENTS.md).

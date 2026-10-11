# Обновление Волны до 0.12.26

Общие папки Android/Web/Windows, оформление звонков, разрешение камеры Windows и автоматический запрос включения уведомлений. Запускайте целиком в прежнем каталоге Волны, где лежат `compose.yaml` и `.env`. Нужны Docker, Git, доступ к сети и свободное место для сборок. `VITE_API_URL` в существующем `.env` должен указывать на ваш HTTPS API.

Локальные исходники заменяются версией GitHub; перед заменой создаётся резервная копия данных. `.env`, данные и подпись Android сохраняются. Не удаляйте `artifacts/android-home`: прежняя подпись нужна для установки APK поверх установленного приложения.

```sh
(
  set -eu
  test -f compose.yaml && test -f .env
  volna_update_dir=$(mktemp -d)
  trap 'rm -rf "$volna_update_dir"' EXIT
  git clone --depth 1 --branch v0.12.26 \
    https://github.com/andluk87/volna.git "$volna_update_dir/source"
  git -C "$volna_update_dir/source" archive \
    --output="$volna_update_dir/source.tar" HEAD
  sh "$volna_update_dir/source/scripts/backup.sh"
  tar -xf "$volna_update_dir/source.tar" -C .
  VOLNA_BUILD_NETWORK=host sh scripts/build-clients.sh
)
```

После завершения установите новый Android APK через предложение обновления в Волне или `https://ВАШ_CHAT_DOMAIN/download/volna-android.apk`. Windows получит новый установщик через свой механизм обновления; файлы доступны на `/download`. Сборки проверяются перед публикацией. Тег GitHub сам по себе не обновляет установленные приложения: этот блок публикует собранные клиенты на вашем сервере.

Проверки этого выпуска описаны в CHANGELOG.md. В облачной среде нет телефона для визуальной проверки первого кадра и настройки крупных шрифтов.


[Изменения, перенос папок и проверка уведомлений](FOLDERS-NOTIFICATIONS-0.12.26.md).

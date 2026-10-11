# Обновление Волны до 0.12.29

Обновляются Web и Windows: размеры колонок, строки чатов, адаптивные панели, меню, клавиши и ночной режим. [Изменения и проверки](DESKTOP-WEB-0.12.29.md).

Запустите блок в прежнем каталоге Волны с `compose.yaml` и `.env`. Перед заменой исходников создаётся резервная копия данных. `.env`, данные и подпись Android сохраняются; не удаляйте `artifacts/android-home`. `VITE_API_URL` должен указывать на ваш настоящий HTTPS API. Облачные тестовые сборки с `example.invalid` устанавливать не нужно.

```sh
(
  set -eu
  test -f compose.yaml && test -f .env
  volna_update_dir=$(mktemp -d)
  trap 'rm -rf "$volna_update_dir"' EXIT
  git clone --depth 1 --branch v0.12.29 \
    https://github.com/andluk87/volna.git "$volna_update_dir/source"
  git -C "$volna_update_dir/source" archive \
    --output="$volna_update_dir/source.tar" HEAD
  sh "$volna_update_dir/source/scripts/backup.sh"
  tar -xf "$volna_update_dir/source.tar" -C .
  VOLNA_BUILD_NETWORK=host sh scripts/build-windows.sh
)
```

После сборки установщик Windows доступен на `/download`; установленный Windows-клиент получает версию 0.12.29 через штатную проверку обновлений. Web обновляется на сервере вместе с сервисами. Если открыта старая вкладка, перезагрузите её. Настройки, аккаунты и переписки сохраняются. Android в этом обновлении пересобирать не требуется.

Проверьте: ширину списка мышью и после перезапуска, меню правой кнопкой и щелчок вне меню, Escape по одному уровню, Alt+↑/↓ в папке, ↑ в пустом поле, отправку с сохранением фокуса, ночной переключатель, панели эмодзи и информации при изменении размера окна.

Облачный проверочный установщик с `example.invalid` не предназначен для установки: используйте сборку из этого блока с вашим настоящим API.

# Обновление Волны до 0.12.47

Убрана большая дублирующая картинка (largeIcon) в уведомлениях сообщений Android, включая повторные уведомления после ответа и групповые сводки, использующие общий message builder. Тест часов также не добавляет largeIcon. SmallIcon — белые PNG для пяти плотностей — и application/launcher icons сохранены. Уведомления звонков, обновлений и фоновой связи сохраняют своё оформление. Категории, каналы, разрешения, имена, привязка к аккаунту и ответ из уведомлений не изменены.

Это эксперимент для Huawei Watch Ultimate / Huawei Health, не гарантия появления значка. После установки отправьте новое сообщение при заблокированном телефоне; старые уведомления могут содержать прежний largeIcon. На телефоне проверьте отсутствие второго логотипа справа, затем часы. Можно использовать Настройки → Уведомления → «Проверить уведомление на часах». Если значка нет, нужны logcat и dumpsys notification во время нового сообщения, как обсуждалось ранее.

Выполните в прежнем каталоге сервера с compose.yaml и .env. Данные и подпись сохраняются. Облачный Debug APK с тестовым API не устанавливайте.

```sh
(
  set -eu
  test -f compose.yaml && test -f .env
  volna_update_dir=$(mktemp -d)
  trap 'rm -rf "$volna_update_dir"' EXIT
  git clone --depth 1 --branch v0.12.47 \
    https://github.com/andluk87/volna.git "$volna_update_dir/source"
  git -C "$volna_update_dir/source" archive \
    --output="$volna_update_dir/source.tar" HEAD
  sh "$volna_update_dir/source/scripts/backup.sh"
  tar -xf "$volna_update_dir/source.tar" -C .
  VOLNA_BUILD_NETWORK=host sh scripts/build-clients.sh
)
```

Публикуются исходники; сервер и производственные установщики обновляются командой выше.

Проверки: 164 Node-теста, 90 Android/JVM-тестов, сборки Web и Android Debug прошли. Графическое отображение Samsung/Huawei в облаке не проверяется.

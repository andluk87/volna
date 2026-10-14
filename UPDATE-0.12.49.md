# Обновление Волны до 0.12.49

В официальных исходниках Telegram Android (commit f32ffeec763f0bdbf4bec25b52d654f77bff733d) и предоставленном пользователем дампе найдено android.wearable.EXTENSIONS с actions, dismissalId и bridgeTag. Теперь аналогичные стандартные поля добавлены Волне через android.app.Notification.WearableExtender; идентификаторы начинаются с volna, разделяют аккаунты, чаты, сообщения и реакции. Чужие package name и идентификаторы Telegram не используются.

Обычные сообщения сохраняют прежний стиль, получают WearableExtender и то же безопасное действие ответа, которое было в уведомлении. Реакции получают идентификаторы без действия ответа. Действия помечены semantic REPLY, allowGeneratedReplies, showsUserInterface=false. Повтор ответа и сетевые ошибки обрабатывает существующий NotificationReplyReceiver. Большая дублирующая картинка не возвращается.

Тест часов сохраняет MessagingStyle + Person и добавляет WearableExtender с действием «Ответить». Это локальный тест: текст не сохраняется и не отправляется на сервер. Отдельный receiver не экспортирован, проверяет тип Intent, аккаунт и время последнего теста. При успешном тестовом ответе уведомление снимается, в настройках появляется подтверждение. Ответ на старый тест игнорируется, новый тест не снимается. При перезапуске процесса проверочный ответ может быть проигнорирован; это не затрагивает реальные ответы.

## Проверка на устройстве

1. Установите производственную сборку 0.12.49.
2. Android → Настройки → Уведомления → «Проверить уведомление на часах»; заблокируйте телефон. Через 10 секунд придёт один тест.
3. Проверьте значок. Если часы предлагают ответ, введите «тест»: он никому не отправится.
4. Сравните с новым обычным сообщением. Если значка нет, оставьте тест и сообщение в шторке и снимите `adb shell dumpsys notification > notification-wearable.txt`. Ожидается android.wearable.EXTENSIONS с bridgeTag, dismissalId и actions.

Shortcut/locusId в этом эксперименте не добавлялись. Поддержка полей расширения прошивкой Huawei не гарантируется; выпуск не объявляет значок исправленным.

Обновляйте в прежнем каталоге сервера с compose.yaml и .env. Данные и подпись сохраняются; облачный Debug APK с тестовым API не устанавливайте.

```sh
(
  set -eu
  test -f compose.yaml && test -f .env
  volna_update_dir=$(mktemp -d)
  trap 'rm -rf "$volna_update_dir"' EXIT
  git clone --depth 1 --branch v0.12.49 \
    https://github.com/andluk87/volna.git "$volna_update_dir/source"
  git -C "$volna_update_dir/source" archive \
    --output="$volna_update_dir/source.tar" HEAD
  sh "$volna_update_dir/source/scripts/backup.sh"
  tar -xf "$volna_update_dir/source.tar" -C .
  VOLNA_BUILD_NETWORK=host sh scripts/build-clients.sh
)
```

Это публикация исходников. Сервер и производственные установщики обновляет приведённая команда.

Проверки: 164 Node-теста, 90 Android/JVM-тестов, Web и итоговая Android Debug сборка прошли. Нативный Action.Builder не имеет метода setShowsUserInterface: использовано стандартное поле android.support.action.showsUserInterface в extras, совпадающее с сериализацией AndroidX. Проверка изображения и ответа на Huawei Watch Ultimate в облаке недоступна.

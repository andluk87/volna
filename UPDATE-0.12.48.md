# Обновление Волны до 0.12.48

Изолированный тест формата уведомления Huawei Watch. В предоставленных дампах Samsung Android 16 smallIcon есть у Волны и Telegram, largeIcon сообщения отсутствует у обоих. Различие: Telegram использует MessagingStyle и Person. Повторяющаяся ошибка Huawei Health Binder error -32 встречается и у Telegram, поэтому её связь со значком не установлена.

Кнопка «Проверить уведомление на часах» теперь создаёт стандартный MessagingStyle с Person на Android 9+. Android 8 использует строковый вариант MessagingStyle. Значки, канал, разрешения и отсутствие largeIcon сохранены. Искусственный sender теста называется «Волна · Проверка уведомлений» (либо с включённой текстовой меткой), владельцем обозначено «Вы». Настоящие контакты и переписки не создаются. Время ожидания 10 секунд, отмена, частичная блокировка сна и переход в приложение сохранены. Shortcut/locusId не добавлены: проверяем отдельно влияние MessagingStyle/Person. Реальные уведомления сообщений не меняются в этом эксперименте.

## Проверка после установки

1. Откройте Android → Настройки → Уведомления → «Проверить уведомление на часах».
2. Заблокируйте телефон; через 10 секунд придёт одно локальное тестовое уведомление.
3. Проверьте значок на часах, сделайте фото. Сравните с обычным сообщением Волны.
4. Оставив тест в шторке телефона, при необходимости выполните `adb shell dumpsys notification > notification-messagingstyle.txt`. В записи volna-watch-test должен быть android.template=android.app.Notification$MessagingStyle.

Успех эксперимента на Huawei Watch Ultimate пока не подтверждён. Отрицательный результат позволит исключить изменение этого формата как достаточное исправление.

Выполните в прежнем каталоге сервера с compose.yaml и .env. Данные и подпись сохраняются. Облачный Debug APK с тестовым адресом API не устанавливайте.

```sh
(
  set -eu
  test -f compose.yaml && test -f .env
  volna_update_dir=$(mktemp -d)
  trap 'rm -rf "$volna_update_dir"' EXIT
  git clone --depth 1 --branch v0.12.48 \
    https://github.com/andluk87/volna.git "$volna_update_dir/source"
  git -C "$volna_update_dir/source" archive \
    --output="$volna_update_dir/source.tar" HEAD
  sh "$volna_update_dir/source/scripts/backup.sh"
  tar -xf "$volna_update_dir/source.tar" -C .
  VOLNA_BUILD_NETWORK=host sh scripts/build-clients.sh
)
```

Публикуются исходники; сервер и производственные установщики обновляет команда выше.

Проверки: 164 Node-теста, 90 Android/JVM-тестов, сборки Web и Android Debug прошли. Поведение MessagingStyle на физических Samsung/Huawei проверяется после установки производственной сборки.

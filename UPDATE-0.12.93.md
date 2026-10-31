# VLN 0.12.93 — совместимость значка с приложениями часов

Для Huawei Watch Ultimate 2 с Huawei Health 16.1.1.320 подготовлено исправление источника значка Android. ApplicationInfo.icon, roundIcon и значок запускаемой Activity теперь ссылаются непосредственно на существующий цветной PNG логотипа 512×512. Приложению-компаньону не нужно декодировать адаптивный XML или объединять слои AdaptiveIconDrawable. Сам рисунок не менялся.

В дополнительных адаптивных ресурсах теперь есть видимый передний слой вместо полностью прозрачного, с безопасным отступом и цветным фоном. Монохромная маска Android status bar, аватарки отправителей, MessagingStyle, ярлыки диалогов и действия ответа сохраняются. Принудительная подмена аватарок логотипом и новые переключатели не добавлены.

Это устранение конкретной проблемы совместимости ресурсов, а не подтверждённый результат на Huawei: физических часов и установленного Huawei Health в среде разработки нет. Прошивка часов и Huawei Health управляют отображением пересланных значков; если используется собственный каталог поддерживаемых приложений, изменение APK может не дать значок на часах.

## Обновление одной вставкой

Из существующего каталога проекта с `.env`:

```sh
( set -eu; test -f compose.yaml && test -f .env; volna_update_dir=$(mktemp -d); trap 'rm -rf "$volna_update_dir"' EXIT; git clone --depth 1 --branch v0.12.93 https://github.com/andluk87/volna.git "$volna_update_dir/source"; git -C "$volna_update_dir/source" archive --output="$volna_update_dir/source.tar" HEAD; sh "$volna_update_dir/source/scripts/backup.sh"; if [ -d android-native/app/src ]; then mkdir -p backups; volna_source_backup=$(mktemp -d "$PWD/backups/android-source-0.12.93-XXXXXXXX"); mv android-native/app/src "$volna_source_backup/src"; fi; tar -xf "$volna_update_dir/source.tar" -C .; VOLNA_BUILD_NETWORK=host sh scripts/build-clients.sh )
```

Установите Android 0.12.93. Откройте приложение и убедитесь в версии. В Huawei Health → Устройства → Watch Ultimate 2 → Уведомления выключите и снова включите пересылку для VLN, затем закройте и снова откройте Health. Старые уведомления на часах не являются проверкой: удалите их и получите новое сообщение при заблокированном телефоне. Можно использовать Волна → Уведомления → Проверить уведомление на часах (отложенный тест через 10 секунд).

Если значок всё ещё отсутствует, пришлите фото нового уведомления на часах и уточните, есть ли значок VLN в списке приложений уведомлений самого Huawei Health. Это различает получение значка телефоном-компаньоном и отображение на часах; одинаковый интерфейс для неизвестного приложения на разных прошивках не гарантируется.

Проверки: существующие Android unit/UI тесты и 3 целевые проверки загрузки PNG, непустого адаптивного foreground и монохромной маски уведомления; 230 Node-тестов; APK 103.3 МиБ, версия 12093. AAPT2 подтверждает PNG в ApplicationInfo и launcher Activity для всех плотностей. Production-сборки Web и Windows renderer прошли. Реальное отображение на Huawei Watch Ultimate 2 / Health 16.1.1.320 не проверено.

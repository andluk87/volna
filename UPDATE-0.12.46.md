# Обновление Волны до 0.12.46

В Android, Web и Windows одна синтетическая вкладка «Все чаты». Прежние сохранённые записи с rule=all, id=builtin_all или названием «Все чаты» не дублируют её. Данные этих записей не удаляются.

Полоса появляется после явного добавления существующего чата в папку (либо закрепления в папке), с учётом исключений. До этого — обычный список без вкладок. В «Все чаты» остаются чаты, не входящие в другие папки; учитываются также правила и исключения этих папок. Поиск работает по всем чатам; архив доступен отдельно. Счётчики вкладки соответствуют оставшимся чатам.

Выполните в прежнем каталоге сервера с compose.yaml и .env; данные и подпись сохраняются.

```sh
(
  set -eu
  test -f compose.yaml && test -f .env
  volna_update_dir=$(mktemp -d)
  trap 'rm -rf "$volna_update_dir"' EXIT
  git clone --depth 1 --branch v0.12.46 \
    https://github.com/andluk87/volna.git "$volna_update_dir/source"
  git -C "$volna_update_dir/source" archive \
    --output="$volna_update_dir/source.tar" HEAD
  sh "$volna_update_dir/source/scripts/backup.sh"
  tar -xf "$volna_update_dir/source.tar" -C .
  VOLNA_BUILD_NETWORK=host sh scripts/build-clients.sh
)
```

Публикуются исходники; сервер и производственные установщики обновляются указанной командой. Облачный Debug APK с тестовым API не устанавливайте.

Проверки: 164 Node-теста и 90 Android/JVM-тестов прошли, сборки Web и Android Debug успешны. Браузером проверены отсутствие вкладок при пустой папке, устранение дублей и исключение распределённого чата из «Все чаты».

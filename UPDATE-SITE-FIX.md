# Исправление главной страницы после 0.12.30

Причина: производственный Nginx продолжал отдавать прежний `landing.html`, а новая страница была только в приложении. Проверка через Vite не обнаруживала этот маршрут.

Исправление `v0.12.30-sitefix` переключает `/` на актуальный `index.html`, перенаправляет старый `/landing.html` на главную, исключает старый landing и медиа демо из сборки даже при обновлении распаковкой поверх старых файлов. Скрипт обновления проверяет фактически обслуживаемую главную страницу, а не только номер версии в JS.

Запустите в прежнем каталоге проекта с `compose.yaml` и `.env`. Данные сохраняются; резервная копия создаётся до замены исходников. Установщики Android/Windows не пересобираются и не заменяются.

```sh
(
  set -eu
  test -f compose.yaml && test -f .env
  volna_site_fix=$(mktemp -d)
  trap 'rm -rf "$volna_site_fix"' EXIT
  git clone --depth 1 --branch v0.12.30-sitefix \
    https://github.com/andluk87/volna.git "$volna_site_fix/source"
  sh "$volna_site_fix/source/scripts/backup.sh"
  git -C "$volna_site_fix/source" archive --output="$volna_site_fix/source.tar" HEAD
  tar -xf "$volna_site_fix/source.tar" -C .
  VOLNA_BUILD_NETWORK=host sh scripts/update.sh
)
```

В конце должна появиться строка `Verified public homepage route and absence of production demo files.` Откройте корень сайта `/`; после обновления уже открытой вкладки можно нажать Ctrl+F5.

Проверка исправления: production-сборка, сохранённый старый файл после распаковки и настоящий Nginx 1.28 с браузерными сценариями для компьютера и телефона. Живой сервер из облачной среды не обновлялся.

# Web K: исходные измерения и незавершённая визуальная приёмка

Дата: 2026-10-09. Эталон: https://web.telegram.org/k/ . Публичный исходный код: https://github.com/TelegramOrg/Telegram-web-k , commit `125a31da7665d5ee09ceb9c5de66e2615e3276b6`.

## Что измерено по исходным файлам

| Элемент | Значение | Источник в Web K |
|---|---:|---|
| Начальная ширина боковых панелей | 360 px | `src/helpers/updateColumnWidths.ts` |
| Допустимая ширина панелей | 320–480 px | тот же файл; интерактивное изменение ширины в Волна пока не реализовано |
| Максимальная ширина переписки | 696 px | `CHAT_WIDTH_MAX` в том же файле |
| Внешний отступ колонок на desktop | 16 px | тот же файл |
| Desktop dock правой панели | от 1480 px | `360 + 360 + 696 + 4 × 16` |
| Handheld | до 600 px | `src/scss/variables.scss` |
| Плавающая левая панель | до 925 px | тот же файл |
| Высота заголовка | 56 px | `$header-height: 3.5rem` |
| Размер аватара списка | 54 px | `src/scss/partials/_avatar.scss` |
| Отступы пузыря | 4 px сверху, 5 px снизу, 8 px по горизонтали | `src/scss/partials/_chatVariables.scss` |
| Скругление группы / пузыря | 5 / 15 px | тот же файл |
| Между сообщениями | 2 px | `$bubble-margin: .125rem` |
| Медиа | до 420 × 400 px | `src/scss/partials/_chatBubble.scss` |
| Основной шрифт | Roboto, 16 px | `src/scss/base.scss`, `fonts/_roboto.scss` |
| Рисунок обоев | исходный SVG | `public/assets/img/pattern.svg` |

Высота строк списка 72 px взята из ТЗ. Иконки, рисунок обоев и исходная палитра градиентных аватаров взяты из Web K. Варианты пользовательского оформления Волны остаются доступны и могут менять базовый вид. Прозрачность обоев, цвета выбранной темы, детали меню и переходов ещё требуют калибровки по одинаковым скриншотам.

## Доступный снимок оригинала

`web-k-login-background-light.jpg`: только верхние 140 px экрана входа. Viewport 1363 × 936, DPR 1, светлая тема. QR-код и данные входа в файл не включены. Этот снимок **не является эталоном переписки**.

Оригинал потребовал входа. Снимки личной и групповой переписки, настроек, поиска, контекстного меню и эмодзи с вымышленными одинаковыми данными не получены. Другие скриншоты оригинала не подменены изображениями Волны.

## Браузерные проверки

В `client/tests/web-client.spec.mjs` подготовлены 40 запусков: 4 сценария × 5 размеров × 2 темы. Viewport: 1920×1080, 1440×900, 1366×768, 1024×768, 390×844; DPR 1; UTC; ru-RU; фиксированные Date; Reduce Motion. Набор проверяет список, геометрию, сообщения, вложения, настройки, папки, поиск, контекстное меню, эмодзи, отправку/ответ/реакцию/редактирование/удаление и голосование.

```sh
npm ci --prefix client
cd client
npx playwright install chromium
# На Linux при отсутствии системных библиотек:
# npx playwright install --with-deps chromium
npm run test:visual -- --update-snapshots
npm run test:visual
```

Первый запуск создаёт **снимки Волны для регрессионных тестов** в `design/checks/baselines`. Это не доказательство соответствия Telegram. Полученные снимки нужно сначала просмотреть; последующее обновление baseline допускается только после проверки изменений.

В текущей среде: перечисление 40 тестов прошло; один фактический запуск `1440x900-light` завершился до открытия страницы — Chromium получил SIGTRAP. Снимки Волны и baseline не созданы. Полный интерактивный прогон и visual diff **не выполнены**. Сборка и SSR-проверки не заменяют эти проверки.

## Сравнение с оригиналом

Нужны эталонные PNG с теми же вымышленными данными и состояниями. Список состояний: empty, chat, short-message, media, group, main-menu, profile, settings, appearance, search, context-menu, emoji; отдельный мобильный chat уже входит в матрицу. Для каждого снимка укажите viewport, DPR, тему, дату и commit. Не добавляйте реальные приватные сообщения или QR-коды авторизации.

Команда создаёт 50% overlay, абсолютный pixel diff и JSON статистику, но **сама не подтверждает допуски геометрии**:

```sh
python3 -m pip install Pillow
python3 scripts/compare-reference.py original.png volna.png --out design/checks/comparison
```

Приёмка ТЗ (±2 px основных элементов / ±3 px пузырей) остаётся открытой. До визуальной проверки версия 0.12.4 считается сборкой для проверки, а не подтверждённым точным воспроизведением Web K.

### Live inspection, 0.12.5

The authenticated Web K session was inspected on 2026-10-09, without retaining messages, contacts or account details. The left column measured x=16, y=16, width=360, radius=24, with Roboto. General Settings shows a text-size slider, wallpaper entry, Classic/Night/Day/Dark/System themes. The expression panel has an icon category strip, rounded search, scrollable emoji content and lower Emoji/Stickers/GIF/delete controls; observed content width 382 px and category strip height 49 px. Volna now uses this compact organization while retaining its own custom-pack tab, skin-tone selection and favorites management. Presets change appearance preferences only, preserving font size and density. Own-pack title/description editing calls the existing authenticated PATCH endpoint.

Local browser acceptance remains blocked: the Playwright Chromium process terminates with SIGTRAP before loading a page. This is not a passed visual test, and pixel identity is not claimed. The targeted appearance/editor/emoji scenario is included in the test suite for execution on the deployment machine.

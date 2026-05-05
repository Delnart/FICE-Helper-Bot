# FICE Helper

Telegram Mini App + бот для академічних груп ФІОТ КПІ. Проєкт об’єднує розклад, черги, домашні завдання, журнал, корисні посилання та чат-нагадування в одному робочому просторі.

## Що вміє

| Напрям     | Що робить                                                                              |
| ---------- | -------------------------------------------------------------------------------------- |
| Розклад    | показує поточну й наступну пару, тиждень, вибіркові дисципліни та deep-link на предмет |
| Предмети   | викладачі, корисні посилання, домашки, журнал, черга, видимість розділів               |
| Черги      | до 50 слотів, статуси, обміни, групова здача, авто-відкриття та авто-закриття          |
| Сповіщення | нагадування про пару, DM-сповіщення, привітання з днем народження, `/now`, `/left`     |
| Ролі       | студент, викладач, староста, заступник старости, адмін                                 |

## Стек

NestJS 10 · Next.js 14 (App Router) · MongoDB 7 · Telegram Bot API через `grammy` · Tailwind CSS · TypeScript · npm workspaces · Docker Compose.

## Ролі та доступ

### Студент

Студент використовує бота як щоденний інструмент: `/start` відкриває Mini App, `/now` і `/left` показують поточну або наступну пару, а в груповому чаті приходять нагадування про пари, черги та оголошення.

### Викладач

Викладач отримує окремий інтерфейс без студентських налаштувань. Йому доступні власний розклад, предмети, журнал і сторінки з даними груп, якщо він прив’язаний до Campus KPI.

### Староста

Староста прив’язує групу через `/verify`, додає предмети, викладачів і посилання, керує чергами та домашками, вмикає або вимикає групові сповіщення і може позначати, чи показувати посилання в нагадуванні про пару.

### Заступник старости

Заступник має ті самі права, що й староста, але без формального головного ролі. Це зручно для підстраховки, коли староста недоступний.

### Адмін

Адмінська група використовується для технічних команд і підтримки. Саме тут доступна `/refresh_heads`, а також бачать службові повідомлення про синхронізацію та помилки.

## Репозиторій

```text
apps/
  backend/   NestJS API, бот, cron-нагадування
  frontend/  Next.js Mini App (Tailwind, React Query)
packages/
  shared/    Спільні типи та enums (@fice/shared)
docker/      Compose + Dockerfiles
docs/        Локальний запуск і додаткова документація
```

## Швидкий старт

```bash
cp .env.example .env
npm install
npm run dev
```

Після старту відкрийте бота в Telegram і заходьте в Mini App через кнопку меню. Якщо запускаєте локально без публічного домену, одразу дивіться [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md).

## Змінні середовища

Заповніть мінімум такі значення у `.env`:

| Змінна                               | Для чого                             |
| ------------------------------------ | ------------------------------------ |
| `MONGO_URI`                          | підключення до MongoDB               |
| `JWT_SECRET`                         | підпис JWT-сесій                     |
| `TELEGRAM_BOT_TOKEN`                 | токен бота від BotFather             |
| `TELEGRAM_BOT_USERNAME`              | username бота                        |
| `GOOGLE_SHEETS_ID`                   | таблиця зі старостами та викладачами |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`       | service account для Sheets           |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | приватний ключ service account       |
| `CAMPUS_API_BASE`                    | базовий URL Campus KPI API           |
| `PUBLIC_MINI_APP_URL`                | публічний HTTPS URL Mini App         |
| `NEXT_PUBLIC_API_BASE`               | URL API для фронтенду                |
| `CORS_ORIGIN`                        | дозволений origin для браузера       |

> Для локального запуску через один домен зручно ставити `NEXT_PUBLIC_API_BASE=/api`, а тунель вести лише на фронтенд.

## Команди

| Команда               | Що робить                                                 |
| --------------------- | --------------------------------------------------------- |
| `npm run dev`         | запускає backend і frontend паралельно                    |
| `npm run build`       | збирає shared, backend і frontend                         |
| `npm run lint`        | запускає lint для backend і frontend                      |
| `npm run docker:up`   | піднімає MongoDB, backend і frontend через Docker Compose |
| `npm run docker:down` | зупиняє Docker-стек                                       |
| `npm run docker:logs` | показує логи Docker-стеку                                 |

## Docker

```bash
npm run docker:up
```

Альтернатива без npm-скрипта:

```bash
docker compose -f docker/docker-compose.yml --env-file .env up -d --build
```

## Локальний запуск у Telegram

Telegram Mini App потребує публічний HTTPS URL. Для локальної розробки використовуйте ngrok або Cloudflare Tunnel. Повний покроковий сценарій є в [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md).

## Публікація на GitHub

Після створення порожнього репозиторію на GitHub виконайте в корені проєкту:

```bash
git init -b main
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

Якщо репозиторій уже ініціалізований, пропустіть `git init` і використайте `git branch -M main` перед push.

## Безпека

- Telegram WebApp `initData` перевіряється через HMAC-SHA256 з constant-time порівнянням і 24-годинним TTL. Деталі є в [SECURITY.md](SECURITY.md).
- JWT передається через `Authorization: Bearer`, а `x-group-id` визначає скоуп ролі на групу.
- На backend увімкнені `helmet`, `compression`, глобальний `ThrottlerGuard` і `ValidationPipe` з `whitelist + forbidNonWhitelisted`.

## Довідка

- Telegram Bot API: https://core.telegram.org/bots/api
- Telegram WebApp signature: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

## Ліцензія

MIT.

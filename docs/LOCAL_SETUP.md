# Локальний запуск без домена та IP

Telegram не вміє відкривати Mini App з `http://localhost` або приватної IP — йому потрібен публічний HTTPS URL. Але свій сервер нам світити не треба: ми робимо **тунель** через [ngrok](https://ngrok.com/) або [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/). Нижче — повний сценарій на Windows.

## 1. Встановіть інструменти

- **Node.js ≥ 20** і **npm ≥ 10**
- **Docker Desktop** (для MongoDB; якщо Mongo ставите локально сам — пропустіть)
- **ngrok** — https://ngrok.com/download (безкоштовний акаунт, заберіть authtoken і `ngrok config add-authtoken <token>`)

## 2. Створіть бота в @BotFather

1. `/newbot` → отримайте `TELEGRAM_BOT_TOKEN` і `TELEGRAM_BOT_USERNAME`.
2. Поки Mini App URL не налаштовуємо — це зробимо на кроці 6.

## 3. Google Sheet і Campus KPI

- Створіть Google Sheet з двома вкладками (`Старости` — Group | TG tag | Full name; `Викладачі` — Full name | Phone | TG | Email).
- У Google Cloud Console створіть service account → JSON-ключ → поділіться таблицею з `client_email` з правом Viewer.
- Для Campus KPI лиш `CAMPUS_API_BASE=https://api.campus.kpi.ua` — токен поки необов’язковий.

## 4. Підніміть MongoDB

```bash
docker run -d --name fice-mongo -p 27017:27017 \
  -e MONGO_INITDB_ROOT_USERNAME=root \
  -e MONGO_INITDB_ROOT_PASSWORD=devpass \
  -v fice_mongo:/data/db mongo:7
```

## 5. Створіть `.env` у корені

```bash
cp .env.example .env
```

Заповніть мінімально:

```ini
MONGO_URI=mongodb://root:devpass@localhost:27017/fice?authSource=admin
JWT_SECRET=$(openssl rand -base64 48)     # або будь-який ≥32 симв.
TELEGRAM_BOT_TOKEN=123456:AA...
TELEGRAM_BOT_USERNAME=fice_helper_bot
GOOGLE_SHEETS_ID=1AbC...
GOOGLE_SERVICE_ACCOUNT_EMAIL=...@...iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
CORS_ORIGIN=*                              # на час dev-режиму
NEXT_PUBLIC_API_BASE=/api                  # фронт викликає бекенд через rewrite або через тунель
```

> ⚠️ На продакшні **CORS_ORIGIN має вказувати точний домен**, а не `*`.

## 6. Запустіть backend + frontend

```bash
npm install
npm run dev
```

- backend → `http://localhost:3000/api`
- frontend → `http://localhost:3001`

## 7. Підніміть **один** тунель ngrok

Безкоштовний ngrok дозволяє лише **одну** активну сесію одночасно, тому ми тунелюємо **лише фронт**. Next.js dev-сервер автоматично проксить запити `/api/*` на бекенд (це прописано в [next.config.js](../apps/frontend/next.config.js) через `rewrites`).

```bash
ngrok http 3001
```

Отримаєте URL на кшталт `https://abc-123.ngrok-free.app`. Усе — і Mini App, і API — буде доступне через цей же домен. Нічого перезапускати не треба: у `.env` вже стоїть `NEXT_PUBLIC_API_BASE=/api` (same-origin).

> **Якщо отримали `ERR_NGROK_334`** — значить у вас уже працює інший тунель з тим самим reserved-доменом. Зупиніть попередній процес (`Ctrl+C` у тому терміналі, або `taskkill /F /IM ngrok.exe` у Windows) і запустіть знову.

## 8. Зв’яжіть бот із Mini App

У @BotFather:

```
/mybots → your_bot → Bot Settings → Menu Button → Configure Menu Button
URL: https://abc-123.ngrok-free.app     # ваш єдиний ngrok-домен
Текст: Відкрити
```

Також `/setdomain` (для логіну) → той самий ngrok-домен.

## 9. Перевірка

1. У Telegram зайдіть до свого бота → `/start` → натисніть кнопку меню. Відкриється Mini App.
2. Спробуйте додати бота в тестову групу → `/bind` (ваш `@username` має бути у вкладці «Старости»).
3. У Mini App потрапляєте на головний екран з авторизацією.

## Типові помилки

| Симптом | Причина | Фікс |
| --- | --- | --- |
| `Auth failed: 401` | initData застаріла (>24 год) або сервіс не має `TELEGRAM_BOT_TOKEN` | Перезапустіть застосунок у Telegram; перевірте `.env` |
| `Telegram WebApp initData недоступна` | Відкрили фронт у звичайному браузері, не через бота | Відкривайте через кнопку меню бота |
| CORS-помилка в консолі | `CORS_ORIGIN` не збігається з доменом фронта | Поставте `CORS_ORIGIN` = повний HTTPS-домен ngrok фронта |
| Бот не реагує | `grammy` не запустив long-polling | Подивіться логи backend — має бути `Bot started as @your_bot` |
| `/bind` каже «Ваш Telegram тег не знайдено» | В Google Sheet немає вашого `@username` у вкладці «Старости» | Додайте рядок `ФІОТ-01 | @your_tag | Прізвище Імʼя` |

## Альтернатива: Cloudflare Tunnel (безкоштовно, стабільний піддомен)

```bash
cloudflared tunnel login
cloudflared tunnel create fice-dev
cloudflared tunnel route dns fice-dev fice-dev.your-domain.com
cloudflared tunnel run fice-dev --url http://localhost:3001
```

Перевага: постійний URL (не змінюється після перезапуску, як у безкоштовного ngrok).

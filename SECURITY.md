# Security

## Повідомлення про вразливості

Якщо ви знайшли вразливість, **не** створюйте публічний issue. Надішліть деталі на пошту супровідника репозиторію — ми відреагуємо протягом 72 годин.

## Модель загроз

| Поверхня | Ризик | Мітигація |
| --- | --- | --- |
| Mini App auth | Підробка `initData` / повтор | HMAC-SHA256 з секретом `WebAppData`, `timingSafeEqual`, `auth_date` ≤ 24 год |
| JWT | Крадіжка / tampering | `JWT_SECRET` ≥ 32 симв., `HS256`, TTL 7 днів, зберігається лише в `localStorage` mini-app (не cookie) |
| Role escalation | Студент підробляє роль | Ролі беруться з `User.memberships[]` сервером, скоуп по `x-group-id` перевіряється `RolesGuard` |
| Group binding | Випадковий користувач робить себе старостою | Whitelist у Google Sheet (`Старости!A:C`), перевірка при `/bind` |
| Input | Масаний шейп / NoSQL injection | `class-validator` + `ValidationPipe({whitelist, forbidNonWhitelisted, transform})`, Mongoose типізація |
| XSS у чаті | `<script>` в тайтлі оголошення | `escapeHtml` перед відправкою в Telegram |
| Race у чергах | Два студенти на один слот | Атомарні `findOneAndUpdate` з фільтром `slots.$.userId: null` |
| Запити ззовні | Перевантаження | `@nestjs/throttler` глобально, `helmet`, `compression`, `cors` за whitelist |
| Mongo | Дефолтні креди | `MONGO_URI` з authSource=admin, унікальні індекси |

## Практики

- Усі секрети — лише через `.env` (`.gitignore` це покриває).
- `.env.example` ніколи не містить реальних значень.
- Ніякого `eval`, `Function` constructor, динамічних `require`.
- Не логуємо `initData`, JWT, номери телефонів.
- Оновлюйте залежності регулярно (`npm audit`).

## Verification cheat-sheet

```ts
const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
const check  = createHmac('sha256', secret).update(dataCheckString).digest('hex');
timingSafeEqual(Buffer.from(check, 'hex'), Buffer.from(hashFromInitData, 'hex'));
```

`dataCheckString` — відсортовані `key=value`, з’єднані `\n`, без поля `hash`.

# Деплой і CI/CD

Пайплайн — [.github/workflows/ci.yml](../.github/workflows/ci.yml):

| Подія | Що відбувається |
|---|---|
| Pull request | `checks`: `npm ci`, typecheck бекенду й фронтенду, `next build` |
| Push у `main` (або ручний запуск) | `checks` → `images`: збирає `fice-backend` і `fice-frontend`, пушить у GHCR з тегами `latest` і `sha-<commit>` → `deploy`: по SSH оновлює compose-файл на сервері, `pull` + `up -d`, чистить старі образи й перевіряє, що контейнери піднялися |

Образи збираються на раннерах GitHub, сервер нічого не збирає.

## Одноразове налаштування

### 1. Доступ Actions до пакетів GHCR

Пакети `fice-backend` і `fice-frontend` раніше пушились з ноутбука, тож вони ще не привʼязані до репозиторію.
Для кожного: GitHub → Packages → пакет → **Package settings** → **Manage Actions access** → **Add repository** →
`Delnart/FICE-Helper-Bot`, роль **Write**. Без цього крок `images` впаде з `permission_denied: write_package`.

### 2. Змінні та секрети репозиторію

Settings → Secrets and variables → Actions.

**Variables**

| Назва | Приклад | Обовʼязково |
|---|---|---|
| `DEPLOY_HOST` | `203.0.113.10` | так — без неї крок `deploy` пропускається |
| `DEPLOY_PATH` | `/root/FICE-Helper-Bot` | так — тека з `.env` і `docker/` на сервері |
| `DEPLOY_USER` | `root` | ні (за замовчуванням `root`) |
| `DEPLOY_PORT` | `22` | ні |
| `NEXT_PUBLIC_API_BASE` | `https://api.ficebot.dev` | ні (це значення за замовчуванням) |

**Secrets**

| Назва | Що це |
|---|---|
| `DEPLOY_SSH_KEY` | приватний ключ, публічна частина якого лежить у `~/.ssh/authorized_keys` на сервері |
| `DEPLOY_KNOWN_HOSTS` | (рекомендовано) вивід `ssh-keyscan -p <port> <host>`; без нього ключ сервера береться при першому підключенні |

Ключ лише для деплою:

```bash
ssh-keygen -t ed25519 -f fice_deploy -N "" -C "github-actions-deploy"
```

Вміст `fice_deploy.pub` додайте в `~/.ssh/authorized_keys` на сервері, вміст `fice_deploy` — у секрет `DEPLOY_SSH_KEY`.

### 3. Сервер

У `DEPLOY_PATH` мають бути `.env` і тека `docker/` (compose-файл пайплайн оновлює сам).

На VPS з ~1 ГБ RAM обовʼязково додайте swap — це страховка від OOM під час `pull` і піків:

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl vm.swappiness=10 && echo 'vm.swappiness=10' >> /etc/sysctl.conf
```

## Міграція даних (одноразово після цього релізу)

Реліз перевів усі id-поля схем на справжній тип `ObjectId` і додав два унікальні індекси: одна черга на предмет у групі
та один `pending`-запит на обмін від користувача в черзі. Старі дані можуть містити id-рядки (типізовані запити їх не
знаходять) і дублікати (через них індекси не будуються). Це виправляє скрипт `dist/scripts/migrate-data.js`; запустіть
його одразу після деплою.

1. **Спершу бекап** (`-T`, бо вивід бінарний):

   ```bash
   docker compose -f docker/docker-compose.prod.yml --env-file .env exec -T mongo \
     sh -c 'mongodump --archive --gzip -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin' \
     > mongo-backup-$(date +%F).gz
   ```

   Для Atlas — `mongodump --uri "<MONGO_URI>" --archive=mongo-backup.gz --gzip` або snapshot у консолі Atlas.
   Відновлення, якщо щось пішло не так (`--drop` замінює колекції на ті, що в бекапі):

   ```bash
   docker compose -f docker/docker-compose.prod.yml --env-file .env exec -T mongo \
     sh -c 'mongorestore --archive --gzip --drop -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin' \
     < mongo-backup-YYYY-MM-DD.gz
   ```

2. **Пробний прогін** — лише читає й показує, що знайдено (кількість і приклади `_id`):

   ```bash
   docker compose -f docker/docker-compose.prod.yml --env-file .env exec backend node dist/scripts/migrate-data.js
   ```

3. **Застосування**:

   ```bash
   docker compose -f docker/docker-compose.prod.yml --env-file .env exec backend node dist/scripts/migrate-data.js --apply
   ```

Що робить скрипт:

- id, збережені рядком, перетворює на `ObjectId` у всіх колекціях, зокрема в масивах і вкладених записах. Значення, які
  не можна перетворити (рядок, що не є 24-символьним hex, число, обʼєкт), лише показує й не чіпає; з `--apply` це `ERROR`:
  Mongoose їх не прочитає, а кожне збереження такого документа падатиме на валідації.
- `users.memberships`: якщо одна група записана кілька разів, лишає запис із найвищою роллю (серед рівних — з найранішим
  `joinedAt`).
- Кілька `pending`-запитів на обмін від одного користувача в черзі: лишає найновіший, решту позначає `expired`. Дублікати
  однієї черги тут рахуються як одна черга.
- Дублікати черг на той самий предмет і групу: лишає найстарішу чергу й переносить у неї записи, якщо місце вільне і
  студента там ще немає. Дублікат видаляє лише тоді, коли перенесено все, а його запити на обмін перепривʼязує до
  залишеної черги. Конфлікти виводить рядками `conflict:` — їх треба розвʼязати вручну.
- `subjects.teachers`: прибирає точні дублікати (той самий викладач і та сама роль); записи з різними ролями лишає.
- Лише з `--apply`: будує індекси черг і запитів на обмін (`createIndexes`, наявні індекси не видаляє).

Скрипт ідемпотентний: повторний запуск нічого не змінює, тож його можна запускати скільки завгодно. Код виходу 0 означає,
що нічого не лишилось. Інакше перегляньте рядки `ERROR` і просто запустіть `--apply` ще раз: перший прогін може не
перетворити id черги чи запиту на обмін, якщо бекенд уже побудував новий унікальний індекс, а дублікат прибирається лише
пізнішим кроком. Що лишилось і після повтору (конфлікт черги, що блокує індекс, колізія унікального ключа, значення, яке
не є id), виправте вручну й запустіть `--apply` знову.

## Памʼять

Ліміти в [docker-compose.prod.yml](../docker/docker-compose.prod.yml): Mongo — кеш WiredTiger 256 МБ і `mem_limit` 512m,
бекенд — heap 256 МБ / 384m, фронтенд (Next standalone) — heap 128 МБ / 192m. Якщо процес упирається в ліміт, Docker
перезапускає саме його (`restart: unless-stopped`), а не весь сервер повільно йде у swap.

Подивитися фактичне споживання:

```bash
docker stats --no-stream
```

## Reverse proxy і ліміти

Бекенд довіряє заголовку `X-Forwarded-For` лише від приватних адрес (localhost, docker-мережа), тож проксі перед `:3000`
(nginx / Caddy / cloudflared) має його виставляти — інакше всі клієнти виглядають як одна IP-адреса. Rate limit діє лише на
публічний `POST /api/auth/telegram` (`RATE_LIMIT_MAX` запитів за `RATE_LIMIT_TTL` секунд з однієї IP, за замовчуванням 120/60);
решта маршрутів закрита JWT.

## Відкат

```bash
IMAGE_TAG=sha-<commit> docker compose -f docker/docker-compose.prod.yml --env-file .env up -d
```

Або перезапустіть workflow для потрібного коміту (Actions → CI/CD → Re-run).

## Ручний деплой (якщо Actions недоступні)

`./scripts/build-and-push.sh` на ноутбуці, потім на сервері `pull` + `up -d` (команди — у шапці compose-файлу).

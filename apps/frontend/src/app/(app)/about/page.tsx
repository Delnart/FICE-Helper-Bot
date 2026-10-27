'use client';

import type { Route } from 'next';
import { useTelegramBackButton } from '../../../components/PageHeader';
import { Section } from '../../../components/ui/Section';
import { SettingsRow } from '../../../components/ui/SettingsRow';
import { Logo, type IconName } from '../../../components/icons';
import { getWebApp, haptic } from '../../../lib/telegram';
import { useMe } from '../../../hooks/useMe';

const FEATURES: Array<[IconName, string, string]> = [
  ['calendar', 'Розклад', 'Пари й сесія з Кампусу КПІ'],
  ['list', 'Черги на здачу', 'Запис, обмін місцями, хто здає'],
  ['task', 'Домашні завдання', 'Спільний список групи з дедлайнами'],
  ['calendarCheck', 'Відвідуваність', 'Журнал для старости й викладачів'],
  ['bell', 'Сповіщення', 'Нагадування від бота в чат і в ЛС'],
];

export default function AboutPage() {
  useTelegramBackButton();
  const me = useMe();
  // Same as the profile's «Підтримка»: the bot chat, where /support reaches the admins.
  const supportBot = me.data?.botUsername;
  // Inlined from apps/frontend/package.json at build time (next.config.js).
  const version = process.env.NEXT_PUBLIC_APP_VERSION;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col items-center gap-3 pt-2 text-center">
        <Logo size={72} />
        <div className="flex flex-col items-center gap-1.5">
          <h1 className="h1">FICE Helper</h1>
          {version ? <span className="chip">v{version}</span> : null}
        </div>
        <p className="small muted max-w-[34ch]">
          Telegram-застосунок для академічних груп ФІОТ КПІ: розклад, черги на здачу, домашні завдання, відвідуваність і
          сповіщення.
        </p>
      </header>

      <Section title="Що всередині">
        <div className="card-flat flex flex-col px-3.5 py-1">
          {FEATURES.map(([icon, title, hint], i) => (
            <div key={title}>
              {i > 0 ? <div className="divider" /> : null}
              <SettingsRow icon={icon} title={title} hint={hint} />
            </div>
          ))}
        </div>
      </Section>

      <div className="card-flat flex flex-col px-3.5 py-1">
        <SettingsRow
          icon="help"
          title="Підтримка"
          hint="Написати адмінам · /support"
          onClick={
            supportBot
              ? () => {
                  haptic('light');
                  getWebApp()?.openTelegramLink(`https://t.me/${supportBot}`);
                }
              : undefined
          }
        />
        <div className="divider" />
        <SettingsRow
          href={'/privacy' as Route}
          icon="file"
          title="Політика конфіденційності"
          hint="Які дані ми зберігаємо і навіщо"
        />
      </div>
    </div>
  );
}

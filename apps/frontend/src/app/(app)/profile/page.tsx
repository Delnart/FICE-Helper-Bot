'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, setActiveGroup } from '../../../lib/api';
import { PageHeader } from '../../../components/PageHeader';
import { Section } from '../../../components/ui/Section';
import { SettingsRow } from '../../../components/ui/SettingsRow';
import { Sheet } from '../../../components/ui/Sheet';
import { ErrorState, Loading } from '../../../components/Empty';
import { Icon } from '../../../components/icons';
import { UserAvatar, myAvatarUrl } from '../../../components/UserAvatar';
import { getWebApp, haptic, syncTheme, THEME_KEY } from '../../../lib/telegram';
import { cn } from '../../../lib/cn';
import { useActiveGroup, useCanManage, useIsTeacherOnly, useMe, type Me } from '../../../hooks/useMe';

// Same keys as settings/notifications, so the «N з M увімкнено» counts agree.
const PREF_KEYS = [
  'dmQueueOpen',
  'dmNextInQueue',
  'dmDeadlineTomorrow',
  'dmSwapRequests',
  'dmMorningDigest',
  'dmLessonReminder',
] as const;
type Prefs = Record<(typeof PREF_KEYS)[number], boolean>;

// Stored theme override (THEME_KEY); absent = follow Telegram. syncTheme() (and
// the boot script in app/layout.tsx) read the same key.
type ThemePref = 'auto' | 'light' | 'dark';
const THEMES: Array<[ThemePref, string, string]> = [
  ['auto', 'Як у Telegram', 'Світла чи темна разом із Telegram'],
  ['light', 'Світла', 'Завжди світла'],
  ['dark', 'Темна', 'Завжди темна'],
];

// Mirror of the backend regex (UpdateProfileDto). Latin + Cyrillic letters,
// space, dot, hyphen, apostrophes — anything else (digits, emoji, symbols)
// is rejected. We pre-validate client-side so the user gets instant feedback
// instead of a generic 400 from the server.
const FULL_NAME_RE = /^[\p{Script=Latin}\p{Script=Cyrillic}\s.'’\-]+$/u;
function validateName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'Вкажіть ПІБ.';
  if (trimmed.length > 200) return 'ПІБ занадто довге (макс. 200 символів).';
  if (!FULL_NAME_RE.test(trimmed)) {
    return 'ПІБ має містити лише літери, пробіл, дефіс або апостроф. Емодзі та цифри не допускаються.';
  }
  return null;
}

export default function ProfilePage() {
  const qc = useQueryClient();
  const isTeacherOnly = useIsTeacherOnly();
  const canManage = useCanManage();
  const activeGroupId = useActiveGroup();
  const me = useMe();
  // Prefs are per group: the active one, i.e. what settings/notifications opens on (same key, shared cache).
  const groups = me.data?.memberships ?? [];
  const prefsGroupId = (groups.find((m) => m.groupId === activeGroupId) ?? groups[0])?.groupId;
  const prefs = useQuery({
    queryKey: ['prefs', prefsGroupId ?? null],
    queryFn: () => api<Prefs>(`/notifications/prefs${prefsGroupId ? `?groupId=${prefsGroupId}` : ''}`),
    enabled: !!me.data && !isTeacherOnly,
  });
  const [fullName, setFullName] = useState('');
  const [birthday, setBirthday] = useState('');
  const [editing, setEditing] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  // Read up front, so the theme thumb starts on the saved option instead of sliding there.
  // Safe without an effect: Shell never server-renders pages (Loading until auth is ready).
  const [theme, setTheme] = useState<ThemePref>(() => {
    try {
      const t = localStorage.getItem(THEME_KEY);
      return t === 'light' || t === 'dark' ? t : 'auto';
    } catch {
      return 'auto'; // storage blocked
    }
  });

  function pickTheme(t: ThemePref) {
    setTheme(t);
    haptic('selection');
    try {
      if (t === 'auto') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, t);
    } catch {
      /* storage blocked — the choice just won't persist */
    }
    syncTheme()(); // re-apply once with the new choice; Providers keeps the live listener
  }

  // Fill the sheet when it opens, not on every ['me'] refetch — a background
  // refetch must not overwrite what the user is typing.
  function openEdit() {
    setFullName(me.data?.fullName ?? '');
    setBirthday(me.data?.birthday ? me.data.birthday.slice(0, 10) : '');
    setNameError(null);
    setEditing(true);
  }

  const save = useMutation({
    mutationFn: () =>
      api<Me>('/users/me', {
        method: 'PATCH',
        json: { fullName: fullName.trim(), birthday: birthday || null },
      }),
    onSuccess: () => {
      haptic('success');
      setEditing(false);
      setNameError(null);
      qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (err: Error) => {
      setNameError(err.message);
      haptic('error');
    },
  });

  function handleSave() {
    const err = validateName(fullName);
    if (err) {
      setNameError(err);
      haptic('error');
      return;
    }
    setNameError(null);
    save.mutate();
  }

  function cancelEdit() {
    setEditing(false);
    setNameError(null);
  }

  if (me.isLoading || me.isError) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Профіль" />
        {me.isError ? <ErrorState error={me.error} onRetry={() => me.refetch()} /> : <Loading />}
      </div>
    );
  }

  const memberships = me.data?.memberships ?? [];
  const activeMembership = memberships.find((m) => m.groupId === activeGroupId);
  // ПІБ is stored «Прізвище Ім'я По-батькові»; the card shows «Ім'я Прізвище» (the full ПІБ is in the edit sheet).
  const [surname, given] = (me.data?.fullName ?? '').trim().split(/\s+/);
  const display = given
    ? `${given} ${surname}`
    : surname || [me.data?.firstName, me.data?.lastName].filter(Boolean).join(' ');
  const prefsOn = prefs.data ? PREF_KEYS.filter((k) => prefs.data[k]).length : null;
  // «Підтримка» opens the bot chat (its /support reaches the admins); a static row until the name is known.
  const supportBot = me.data?.botUsername;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Профіль" />

      {/* The identity card is the entry point to editing ПІБ / birthday. */}
      <button
        type="button"
        className="card flex w-full items-center gap-3.5 text-left transition-transform active:scale-[0.985]"
        onClick={openEdit}
        aria-label={`${display || 'Профіль'} — редагувати особисті дані`}
      >
        <UserAvatar name={display} src={myAvatarUrl(me.data)} className="tile-accent h-16 w-16 text-[20px]" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="truncate text-[18px] font-bold leading-[1.2]">{display || '—'}</span>
          {me.data?.username ? <span className="small muted truncate">@{me.data.username}</span> : null}
          {isTeacherOnly ? (
            <div className="flex flex-wrap gap-1.5">
              <span className="chip chip-accent">Викладач</span>
            </div>
          ) : activeMembership ? (
            <div className="flex flex-wrap gap-1.5">
              <span className="chip chip-accent">{roleLabel(activeMembership.role)}</span>
              {activeMembership.groupName ? <span className="chip">{activeMembership.groupName}</span> : null}
            </div>
          ) : null}
        </div>
        <Icon name="edit" size={18} className="chev" />
      </button>

      {!isTeacherOnly && memberships.length > 0 ? (
        <Section
          title="Групи"
          aside={
            memberships.length > 1 ? (
              <Link href="/select-group" className="-my-3 inline-flex min-h-11 items-center font-semibold text-accent-text">
                Змінити активну
              </Link>
            ) : null
          }
        >
          <div className="card-flat flex flex-col px-3.5 py-1" role="radiogroup" aria-label="Активна група">
            {memberships.map((m, i) => {
              const active = m.groupId === activeGroupId;
              const body = (
                <>
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={cn('radio', active && 'on')} aria-hidden="true" />
                    <div className="flex min-w-0 flex-col">
                      <span className="h3 truncate">{m.groupName ?? 'Група'}</span>
                      <span className="tiny faint">
                        {roleLabel(m.role)}
                        {active ? ' · активна група' : ''}
                      </span>
                    </div>
                  </div>
                  {active ? <span className="chip chip-ok">активна</span> : null}
                </>
              );
              return (
                <div key={m.groupId}>
                  {i > 0 ? <div className="divider" /> : null}
                  {/* The rows are radios: tapping one switches the active group in place
                      (Providers refetches group-scoped data, the card chips update). */}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className="row-plain w-full justify-between text-left"
                    onClick={() => {
                      if (active) return;
                      setActiveGroup(m.groupId);
                      haptic('selection');
                    }}
                  >
                    {body}
                  </button>
                </div>
              );
            })}
          </div>
        </Section>
      ) : null}

      <Section title="Налаштування">
        <div className="card-flat flex flex-col px-3.5 py-1">
          {/* Teachers don't get notification toggles — they don't subscribe to
              the student-side DMs (queue, deadlines, swaps). */}
          {!isTeacherOnly ? (
            <SettingsRow
              href="/settings/notifications"
              icon="bell"
              title="Сповіщення"
              hint={prefsOn === null ? 'Що бот надсилає в ЛС' : `${prefsOn} з ${PREF_KEYS.length} увімкнено`}
            />
          ) : null}
          {!isTeacherOnly && canManage ? (
            <>
              <div className="divider" />
              <SettingsRow
                href="/settings/group"
                icon="sliders"
                title="Налаштування групи"
                hint={activeMembership?.groupName ?? 'Активна група'}
              />
            </>
          ) : null}
          {!isTeacherOnly ? <div className="divider" /> : null}
          <SettingsRow
            icon="theme"
            title="Вигляд"
            hint={THEMES.find(([t]) => t === theme)?.[1]}
            onClick={() => setThemeOpen(true)}
          />
          <div className="divider" />
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
            href={'/about' as Route}
            icon="info"
            title="Про застосунок"
            hint="FICE Helper · розклад, черги, завдання"
          />
        </div>
      </Section>

      <button
        type="button"
        className="btn btn-ghost btn-block h-11 text-bad hover:text-bad"
        onClick={() => {
          const wa = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;
          if (wa?.close) wa.close();
        }}
      >
        <Icon name="enter" size={18} />
        Вийти з застосунку
      </button>

      {/* Inlined from apps/frontend/package.json at build time (next.config.js). */}
      {process.env.NEXT_PUBLIC_APP_VERSION ? (
        <p className="tiny faint -mt-2 text-center">FICE Helper · v{process.env.NEXT_PUBLIC_APP_VERSION}</p>
      ) : null}

      <Sheet open={themeOpen} onClose={() => setThemeOpen(false)} title="Вигляд">
        <div className="card-flat flex flex-col px-3.5 py-1" role="radiogroup" aria-label="Тема застосунку">
          {THEMES.map(([t, label, hint], i) => (
            <div key={t}>
              {i > 0 ? <div className="divider" /> : null}
              <button
                type="button"
                role="radio"
                aria-checked={theme === t}
                className="row-plain w-full gap-3 text-left"
                onClick={() => {
                  pickTheme(t);
                  setThemeOpen(false);
                }}
              >
                <span className={cn('radio', theme === t && 'on')} aria-hidden="true" />
                <span className="flex min-w-0 flex-col">
                  <span className="h3">{label}</span>
                  <span className="tiny faint">{hint}</span>
                </span>
              </button>
            </div>
          ))}
        </div>
      </Sheet>

      <Sheet open={editing} onClose={cancelEdit} title="Особисті дані">
        <div>
          <div className="label">ПІБ</div>
          <input
            className="input"
            value={fullName}
            maxLength={100}
            onChange={(e) => {
              // Strip disallowed chars on input so the user sees instant
              // feedback instead of typing happily into a field that will
              // 400 on save. Keep only Latin/Cyrillic letters, space,
              // hyphen, apostrophes, dot. Same set as backend regex.
              const filtered = e.target.value.replace(/[^\p{Script=Latin}\p{Script=Cyrillic}\s.'’\-]/gu, '');
              setFullName(filtered.slice(0, 100));
              if (nameError) setNameError(null);
            }}
            placeholder="Прізвище Імʼя По-батькові"
          />
          {nameError ? (
            <div className="hint text-bad">{nameError}</div>
          ) : (
            <div className="hint">Лише літери, пробіл, дефіс або апостроф. До 100 символів.</div>
          )}
        </div>
        {!isTeacherOnly ? (
          <div>
            <div className="label">День народження</div>
            <input type="date" className="input" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
            <div className="hint">Привітаємо в груповому чаті у цей день.</div>
          </div>
        ) : null}
        <div className="flex gap-2">
          <button type="button" className="btn btn-secondary flex-1" onClick={cancelEdit}>
            Скасувати
          </button>
          <button
            type="button"
            className="btn btn-primary flex-[2]"
            disabled={save.isPending || !fullName.trim()}
            onClick={handleSave}
          >
            {save.isPending ? 'Зберігаємо…' : 'Зберегти'}
          </button>
        </div>
      </Sheet>
    </div>
  );
}

function roleLabel(r: string): string {
  const m: Record<string, string> = {
    Student: 'Студент',
    Teacher: 'Викладач',
    DeputyHead: 'Заступник старости',
    GroupHead: 'Староста',
    Admin: 'Адмін',
    student: 'Студент',
    teacher: 'Викладач',
    deputy_head: 'Заступник старости',
    group_head: 'Староста',
    admin: 'Адмін',
  };
  return m[r] ?? r;
}

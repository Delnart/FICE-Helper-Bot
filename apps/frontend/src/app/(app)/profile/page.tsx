'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { api } from '../../../lib/api';
import { PageHeader } from '../../../components/PageHeader';
import { Section } from '../../../components/ui/Section';
import { Sheet } from '../../../components/ui/Sheet';
import { ErrorState, Loading } from '../../../components/Empty';
import { Icon, type IconName } from '../../../components/icons';
import { haptic } from '../../../lib/telegram';
import { initials } from '../../../lib/name';
import { cn } from '../../../lib/cn';
import { useActiveGroup, useCanManage, useIsTeacherOnly, useMe, type Me } from '../../../hooks/useMe';

type Prefs = Record<'dmQueueOpen' | 'dmNextInQueue' | 'dmDeadlineTomorrow' | 'dmSwapRequests', boolean>;
const PREF_KEYS: Array<keyof Prefs> = ['dmQueueOpen', 'dmNextInQueue', 'dmDeadlineTomorrow', 'dmSwapRequests'];

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
  const prefs = useQuery({
    queryKey: ['prefs'],
    queryFn: () => api<Prefs>('/notifications/prefs'),
    enabled: !!me.data && !isTeacherOnly,
  });
  const [fullName, setFullName] = useState('');
  const [birthday, setBirthday] = useState('');
  const [editing, setEditing] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

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
  const display = me.data?.fullName || [me.data?.firstName, me.data?.lastName].filter(Boolean).join(' ');
  const prefsOn = prefs.data ? PREF_KEYS.filter((k) => prefs.data[k]).length : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Профіль" />

      <section className="card flex items-center gap-3.5">
        {me.data?.avatarUrl ? (
          <img src={me.data.avatarUrl} alt="" className="avatar h-16 w-16 object-cover" />
        ) : (
          <span className="avatar tile-accent h-16 w-16 text-[20px]">{initials(display)}</span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="truncate text-[18px] font-bold leading-tight">{display || '—'}</span>
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
      </section>

      <Section title="Особисті дані">
        <div className="card-flat flex flex-col px-3.5 py-1">
          <button type="button" className="row-plain w-full justify-between text-left" onClick={openEdit}>
            <div className="flex min-w-0 flex-col">
              <span className="tiny faint">ПІБ</span>
              <span className="h3 truncate">{me.data?.fullName || '—'}</span>
            </div>
            <Icon name="chevronRight" className="chev" />
          </button>
          {!isTeacherOnly ? (
            <>
              <div className="divider" />
              <button type="button" className="row-plain w-full justify-between text-left" onClick={openEdit}>
                <div className="flex min-w-0 flex-col">
                  <span className="tiny faint">День народження</span>
                  <span className="h3">
                    {me.data?.birthday ? `${formatBirthday(me.data.birthday)} · бот привітає в чаті` : '—'}
                  </span>
                </div>
                <Icon name="chevronRight" className="chev" />
              </button>
            </>
          ) : null}
        </div>
      </Section>

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
          <div className="card-flat flex flex-col px-3.5 py-1">
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
                  {active ? (
                    <div className="row-plain justify-between">{body}</div>
                  ) : (
                    <Link href="/select-group" className="row-plain justify-between">
                      {body}
                    </Link>
                  )}
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
          <SettingsRow icon="help" title="Підтримка" hint={<>Напишіть боту <span className="font-mono">/support</span></>} />
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

function SettingsRow({ href, icon, title, hint }: { href?: Route; icon: IconName; title: string; hint: ReactNode }) {
  const body = (
    <div className="flex min-w-0 items-center gap-3">
      <span className="tile tile-soft h-9 w-9 rounded-[10px]">
        <Icon name={icon} size={18} />
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="h3">{title}</span>
        <span className="tiny faint truncate">{hint}</span>
      </div>
    </div>
  );
  if (!href) return <div className="row-plain">{body}</div>;
  return (
    <Link href={href} className="row-plain justify-between">
      {body}
      <Icon name="chevronRight" className="chev" />
    </Link>
  );
}

/** "2005-03-14T00:00:00Z" → "14 березня" (date-only value, read in UTC). */
function formatBirthday(iso: string): string {
  return new Date(iso.slice(0, 10)).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', timeZone: 'UTC' });
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

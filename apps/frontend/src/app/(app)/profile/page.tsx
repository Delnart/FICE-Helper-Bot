'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, getActiveGroup } from '../../../lib/api';
import { PageHeader } from '../../../components/PageHeader';
import { haptic } from '../../../lib/telegram';
import { useIsTeacherOnly } from '../../../hooks/useMe';

interface MeDto {
  _id: string;
  telegramId: number;
  firstName?: string;
  lastName?: string;
  username?: string;
  avatarUrl?: string;
  fullName?: string;
  birthday?: string;
  memberships: Array<{ groupId: string; role: string; groupName?: string }>;
}

export default function ProfilePage() {
  const qc = useQueryClient();
  const isTeacherOnly = useIsTeacherOnly();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<MeDto>('/users/me') });
  const [fullName, setFullName] = useState('');
  const [birthday, setBirthday] = useState('');
  const [editing, setEditing] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    if (me.data) {
      setFullName(me.data.fullName ?? '');
      setBirthday(me.data.birthday ? me.data.birthday.slice(0, 10) : '');
    }
  }, [me.data]);

  // Mirror of the backend regex (UpdateProfileDto). Latin + Cyrillic letters,
  // space, dot, hyphen, apostrophes — anything else (digits, emoji, symbols)
  // is rejected. We pre-validate client-side so the user gets instant feedback
  // instead of a generic 400 from the server.
  const FULL_NAME_RE = /^[\p{Script=Latin}\p{Script=Cyrillic}\s.'’\-]+$/u;
  const validateName = (name: string): string | null => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return 'Вкажіть ПІБ.';
    if (trimmed.length > 200) return 'ПІБ занадто довге (макс. 200 символів).';
    if (!FULL_NAME_RE.test(trimmed)) {
      return 'ПІБ має містити лише літери, пробіл, дефіс або апостроф. Емодзі та цифри не допускаються.';
    }
    return null;
  };

  const save = useMutation({
    mutationFn: () =>
      api<MeDto>('/users/me', {
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

  const activeGroupId = getActiveGroup();
  const activeMembership = me.data?.memberships.find((m) => m.groupId === activeGroupId);
  const display = fullName || [me.data?.firstName, me.data?.lastName].filter(Boolean).join(' ');
  const initials = buildInitials(display);

  return (
    <div className="space-y-5">
      <PageHeader title="Профіль" />

      <section className="card flex items-center gap-4">
        <Avatar url={me.data?.avatarUrl} initials={initials} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[17px] truncate">{display || '—'}</div>
          {me.data?.username ? (
            <div className="text-sm text-ink-500 truncate">@{me.data.username}</div>
          ) : null}
          {isTeacherOnly ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <span className="chip bg-accent-soft text-accent">Викладач</span>
            </div>
          ) : activeMembership ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <span className="chip">{roleLabel(activeMembership.role)}</span>
              {activeMembership.groupName ? (
                <span className="chip bg-accent-soft text-accent">{activeMembership.groupName}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <section className="card space-y-4">
        <div className="flex items-center justify-between">
          <div className="font-medium">Особисті дані</div>
          {!editing ? (
            <button type="button" className="chip" onClick={() => setEditing(true)}>
              Редагувати
            </button>
          ) : null}
        </div>
        {editing ? (
          <>
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
                  const filtered = e.target.value.replace(
                    /[^\p{Script=Latin}\p{Script=Cyrillic}\s.'’\-]/gu,
                    '',
                  );
                  setFullName(filtered.slice(0, 100));
                  if (nameError) setNameError(null);
                }}
                placeholder="Прізвище Імʼя По-батькові"
              />
              {nameError ? (
                <div className="text-[12px] text-danger mt-1.5">{nameError}</div>
              ) : (
                <div className="text-[12px] text-ink-500 mt-1.5">
                  Лише літери, пробіл, дефіс або апостроф. До 100 символів.
                </div>
              )}
            </div>
            {!isTeacherOnly ? (
              <div>
                <div className="label">День народження</div>
                <input
                  type="date"
                  className="input"
                  value={birthday}
                  onChange={(e) => setBirthday(e.target.value)}
                />
                <div className="text-[12px] text-ink-500 mt-1.5">
                  Привітаємо в груповому чаті у цей день.
                </div>
              </div>
            ) : null}
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary flex-1"
                onClick={() => {
                  setEditing(false);
                  setFullName(me.data?.fullName ?? '');
                  setBirthday(me.data?.birthday ? me.data.birthday.slice(0, 10) : '');
                }}
              >
                Скасувати
              </button>
              <button
                className="btn-primary flex-1"
                disabled={save.isPending || !fullName.trim()}
                onClick={handleSave}
              >
                {save.isPending ? 'Зберігаємо…' : 'Зберегти'}
              </button>
            </div>
          </>
        ) : (
          <div className="space-y-2 text-sm">
            <Row label="ПІБ" value={me.data?.fullName ?? '—'} />
            {!isTeacherOnly ? (
              <Row
                label="День народження"
                value={me.data?.birthday ? new Date(me.data.birthday).toLocaleDateString('uk-UA') : '—'}
              />
            ) : null}
          </div>
        )}
      </section>

      {!isTeacherOnly && me.data?.memberships && me.data.memberships.length > 1 ? (
        <section>
          <div className="section-title">Інші групи</div>
          <Link href="/select-group" className="card flex items-center justify-between hover:bg-paper-100">
            <div>
              <div className="font-medium">Змінити активну групу</div>
              <div className="text-sm text-ink-500 mt-0.5">
                Ви входите до {me.data.memberships.length} груп
              </div>
            </div>
            <span className="chip">Обрати</span>
          </Link>
        </section>
      ) : null}

      <section>
        <div className="section-title">Налаштування</div>
        <div className="card divide-y divide-paper-300">
          {/* Teachers don't get notification toggles — they don't subscribe to
              the student-side DMs (queue, deadlines, swaps). */}
          {!isTeacherOnly ? (
            <Link href="/settings/notifications" className="flex items-center justify-between py-3 first:pt-0">
              <span>Сповіщення</span>
              <span className="text-ink-300">›</span>
            </Link>
          ) : null}
          {!isTeacherOnly && canManageActive(activeMembership?.role) ? (
            <Link href="/settings/group" className="flex items-center justify-between py-3 last:pb-0">
              <span>Налаштування групи</span>
              <span className="text-ink-300">›</span>
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => {
              const wa =
                typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;
              if (wa?.close) wa.close();
            }}
            className="flex items-center justify-between py-3 last:pb-0 first:pt-0 w-full text-left text-danger"
          >
            <span>Вийти з застосунку</span>
            <span className="text-ink-300">›</span>
          </button>
        </div>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-ink-500">{label}</span>
      <span className="font-medium text-right truncate">{value}</span>
    </div>
  );
}

function Avatar({ url, initials }: { url?: string; initials: string }) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className="h-16 w-16 rounded-full object-cover border border-paper-300 flex-shrink-0"
      />
    );
  }
  return (
    <div className="h-16 w-16 rounded-full bg-paper-200 text-ink-700 flex items-center justify-center font-semibold text-[20px] flex-shrink-0">
      {initials || '—'}
    </div>
  );
}

function buildInitials(name: string | undefined): string {
  if (!name) return '';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('');
}

function canManageActive(role: string | undefined): boolean {
  if (!role) return false;
  return role === 'group_head' || role === 'deputy_head' || role === 'admin';
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

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/PageHeader';
import { ErrorState, Loading } from '../../../../components/Empty';
import { Icon } from '../../../../components/icons';
import { Section } from '../../../../components/ui/Section';
import { Sheet } from '../../../../components/ui/Sheet';
import { Toggle } from '../../../../components/ui/Toggle';
import { UserAvatar } from '../../../../components/UserAvatar';
import { haptic } from '../../../../lib/telegram';
import { timeAgo } from '../../../../lib/time';
import { cn, slideVars } from '../../../../lib/cn';

interface GroupSettings {
  _id: string;
  name: string;
  notificationsEnabled: boolean;
  birthdayAnnouncementsEnabled: boolean;
  lessonReminderMinutes: number;
  campusGroupId?: string;
  scheduleSyncedAt?: string;
  canEdit: boolean;
  iAmHead: boolean;
  headUserId: string;
  deputyUserIds: string[];
}

interface CampusGroupRow {
  id: string;
  name: string;
}

interface GroupMember {
  _id: string;
  fullName: string;
  username?: string;
  avatarUrl?: string;
  role: string;
}

// Stable module-level reference (see notifications/page.tsx for why).
const GROUP_SETTINGS_KEY = ['group-settings'] as const;

// Quick picks for the lesson reminder (backend accepts 0..60).
const REMINDER_PRESETS = [0, 5, 10, 15, 30, 60];

export default function GroupSettingsPage() {
  const qc = useQueryClient();
  const { data, isError, error, refetch } = useQuery({
    queryKey: GROUP_SETTINGS_KEY,
    queryFn: () => api<GroupSettings>('/groups/current/settings'),
  });
  // Optimistic-update + refetch-on-settled pattern (same as notifications page).
  // Toggles flip instantly; the final source of truth is the server's GET
  // response refetched once the PATCH settles. We avoid writing the PATCH
  // response into the cache directly because a partial Mongoose serialisation
  // would zero-out unmentioned booleans → all toggles flicker off.
  const save = useMutation({
    mutationFn: (p: Partial<GroupSettings>) =>
      api<GroupSettings>('/groups/current/settings', { method: 'PATCH', json: p }),
    onMutate: async (partial) => {
      await qc.cancelQueries({ queryKey: GROUP_SETTINGS_KEY });
      const prev = qc.getQueryData<GroupSettings>(GROUP_SETTINGS_KEY);
      if (prev) qc.setQueryData<GroupSettings>(GROUP_SETTINGS_KEY, { ...prev, ...partial });
      return { prev };
    },
    onSuccess: () => haptic('selection'),
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData<GroupSettings>(GROUP_SETTINGS_KEY, ctx.prev);
      haptic('error');
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: GROUP_SETTINGS_KEY });
    },
  });

  // Local state for the reminder picker — debounced so rapid taps don't fire a
  // PATCH each. The value is shown immediately from `localMinutes`; the server
  // call only goes out once the user stops for 300ms.
  const [localMinutes, setLocalMinutes] = useState<number | null>(null);
  const minutesValue = localMinutes ?? data?.lessonReminderMinutes ?? 0;
  useEffect(() => {
    if (localMinutes === null) return;
    const t = setTimeout(() => {
      save.mutate({ lessonReminderMinutes: localMinutes });
      setLocalMinutes(null); // hand control back to server-state
    }, 300);
    return () => clearTimeout(t);
  }, [localMinutes]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isError && !data) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Налаштування групи" />
        <ErrorState title="Не вдалося завантажити налаштування" error={error} onRetry={() => refetch()} />
      </div>
    );
  }
  if (!data) return <Loading />;
  const disabled = !data.canEdit;
  // A value set outside the presets (old ±5 stepper, bot) stays visible as its own chip.
  const reminderOptions = REMINDER_PRESETS.includes(data.lessonReminderMinutes)
    ? REMINDER_PRESETS
    : [...REMINDER_PRESETS, data.lessonReminderMinutes].sort((a, b) => a - b);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Налаштування групи" subtitle={`${data.name} · доступно старості та адміну`} />

      {disabled ? (
        <div className="card-soft small muted">
          Лише староста, заступники або адміністратор можуть змінювати ці налаштування.
        </div>
      ) : null}

      <CampusBindingCard
        currentId={data.campusGroupId}
        syncedAt={data.scheduleSyncedAt}
        groupName={data.name}
        canEdit={data.canEdit}
      />

      {data.canEdit ? <TeacherJoinRequests groupId={data._id} /> : null}

      {data.iAmHead ? (
        <DeputiesSection groupId={data._id} headUserId={data.headUserId} deputyUserIds={data.deputyUserIds} />
      ) : null}

      <Section title="Сповіщення в чаті групи">
        <div className="card-flat flex flex-col px-3.5 py-1">
          <SwitchRow
            title="Нагадування про пари"
            hint="Перед початком пари та про відкриття черг"
            checked={data.notificationsEnabled}
            disabled={disabled}
            onChange={(v) => save.mutate({ notificationsEnabled: v })}
          />
          {/* Lead time only matters while reminders are on. */}
          <div className={cn('pb-3', !data.notificationsEnabled && 'hidden')}>
            <div
              className="seg seg-slide"
              style={slideVars(reminderOptions.indexOf(minutesValue), reminderOptions.length)}
              role="radiogroup"
              aria-label="За скільки хвилин до пари сповіщати"
            >
              {reminderOptions.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={minutesValue === m}
                  className={cn('whitespace-nowrap', minutesValue === m && 'on')}
                  disabled={disabled}
                  onClick={() => setLocalMinutes(m)}
                >
                  {m} хв
                </button>
              ))}
            </div>
          </div>
          <div className="divider" />
          <Link href="/settings/notifications" className="row-plain justify-between">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="h3">Дедлайни завдань</span>
              <span className="tiny faint">За 24 години до дедлайну · кожному в особисті</span>
            </div>
            <Icon name="chevronRight" size={20} className="chev" />
          </Link>
          <div className="divider" />
          <SwitchRow
            title="Привітання з днем народження"
            hint="Автоматично о 9:00"
            checked={data.birthdayAnnouncementsEnabled}
            disabled={disabled}
            onChange={(v) => save.mutate({ birthdayAnnouncementsEnabled: v })}
          />
          <div className="divider" />
          <div className="row-plain">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="h3">Куди надсилати</span>
              <span className="tiny faint">Чат групи чи топік · змінити командою /migrate</span>
            </div>
          </div>
        </div>
        {save.isError ? (
          <div className="small text-bad" role="alert">
            {save.error.message || 'Не вдалося зберегти'}
          </div>
        ) : null}
      </Section>
    </div>
  );
}

function CampusBindingCard({
  currentId,
  syncedAt,
  groupName,
  canEdit,
}: {
  currentId?: string;
  syncedAt?: string;
  groupName: string;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(groupName);
  const [debounced, setDebounced] = useState(groupName);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const search = useQuery({
    queryKey: ['campus-search', debounced],
    queryFn: () => api<CampusGroupRow[]>('/campus/groups', { query: { q: debounced } }),
    enabled: canEdit && open && debounced.length >= 2,
  });

  const bind = useMutation({
    mutationFn: (campusGroupId: string) =>
      api<GroupSettings>('/groups/current/campus', { method: 'PATCH', json: { campusGroupId } }),
    onSuccess: () => {
      haptic('success');
      qc.invalidateQueries({ queryKey: ['group-settings'] });
      setOpen(false);
    },
    onError: () => haptic('error'),
  });

  const sync = useMutation({
    mutationFn: () => api<{ count: number }>('/schedule/sync', { method: 'POST', json: {} }),
    onSuccess: (res) => {
      haptic('success');
      setSyncMsg(`Завантажено пар: ${res.count}`);
      qc.invalidateQueries({ queryKey: ['schedule-now'] });
      qc.invalidateQueries({ queryKey: ['schedule'] });
      qc.invalidateQueries({ queryKey: ['schedule-group-week'] });
      qc.invalidateQueries({ queryKey: ['attendance-grid'] });
      qc.invalidateQueries({ queryKey: ['group-settings'] });
    },
    onError: (err: unknown) => {
      haptic('error');
      setSyncMsg(`Помилка: ${err instanceof Error ? err.message : 'невідома'}`);
    },
  });

  const results = search.data ?? [];

  return (
    <section className="card flex flex-col gap-3.5">
      <div className="flex items-center gap-3">
        <span className="subj subj-ink">
          <Icon name="users" strokeWidth={1.9} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="h3">
            {groupName} · {currentId ? 'привʼязано до Кампус КПІ' : 'не привʼязано до Кампусу'}
          </span>
          <span className="tiny faint">
            {currentId
              ? `Розклад оновлюється авто кожні 12 год${syncedAt ? ` · синхр. ${timeAgo(syncedAt)}` : ''}`
              : 'Знайдіть свою академічну групу — після збереження розклад тягтиметься автоматично.'}
          </span>
        </div>
        {currentId ? (
          <span className="chip chip-ok">
            <span className="dot bg-ok" />
            ok
          </span>
        ) : (
          <span className="chip chip-warn">немає</span>
        )}
      </div>

      {currentId || canEdit ? (
        <div className="flex gap-2">
          {currentId ? (
            <button
              type="button"
              className="btn btn-secondary btn-md flex-1"
              disabled={!canEdit || sync.isPending}
              onClick={() => {
                setSyncMsg(null);
                sync.mutate();
              }}
            >
              <Icon name="refresh" size={18} className={cn(sync.isPending && 'animate-spin')} />
              {sync.isPending ? 'Синхронізація…' : 'Синхронізувати'}
            </button>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              className={cn('btn btn-md flex-1', currentId ? 'btn-outline' : 'btn-primary')}
              onClick={() => setOpen(true)}
            >
              {currentId ? 'Змінити групу' : 'Привʼязати групу'}
            </button>
          ) : null}
        </div>
      ) : null}
      {syncMsg ? (
        <div className={cn('small', syncMsg.startsWith('Помилка') ? 'text-bad' : 'muted')}>{syncMsg}</div>
      ) : null}

      <Sheet open={open} onClose={() => setOpen(false)} title="Група в Кампусі">
        {currentId ? (
          <div className="small muted">
            Зараз привʼязано: Campus ID <span className="num break-all">{currentId}</span>
          </div>
        ) : null}
        <div>
          <label className="label" htmlFor="campus-search">
            Пошук за назвою
          </label>
          <input
            id="campus-search"
            className="input"
            placeholder="Наприклад: ФІ-31"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {debounced.length < 2 ? (
          <div className="small muted">Введіть назву (мінімум 2 символи)</div>
        ) : search.isLoading ? (
          <div className="small muted">Шукаємо…</div>
        ) : search.isError ? (
          <ErrorState title="Пошук не вдався" error={search.error} onRetry={() => search.refetch()} />
        ) : results.length === 0 ? (
          <div className="small muted">Нічого не знайшли</div>
        ) : (
          <div className="flex flex-col">
            {results.map((g, i) => {
              const active = currentId === g.id;
              return (
                <div key={g.id}>
                  {i > 0 ? <div className="divider" /> : null}
                  <button
                    type="button"
                    onClick={() => bind.mutate(g.id)}
                    disabled={bind.isPending || active}
                    className="row-plain w-full justify-between text-left"
                  >
                    <span className="h3 truncate">{g.name}</span>
                    {active ? (
                      <span className="chip chip-ok">привʼязано</span>
                    ) : (
                      <span className="tiny faint num">ID {g.id}</span>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {bind.isError ? (
          <div className="small text-bad" role="alert">
            {bind.error.message || 'Не вдалося привʼязати групу'}
          </div>
        ) : null}
        <ManualIdEntry currentId={currentId} bind={bind.mutate} pending={bind.isPending} />
      </Sheet>
    </section>
  );
}

function ManualIdEntry({
  currentId,
  bind,
  pending,
}: {
  currentId?: string;
  bind: (id: string) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(currentId ?? '');
  if (!open) {
    return (
      <button type="button" className="btn btn-ghost btn-md self-start" onClick={() => setOpen(true)}>
        Або ввести ID вручну
      </button>
    );
  }
  return (
    <div className="card-soft flex flex-col gap-2">
      <div className="small muted">
        ID можна знайти в URL на campus.kpi.ua — після <code className="font-mono">?groupId=</code>.
      </div>
      <div className="flex gap-2">
        <input
          className="input num flex-1"
          aria-label="ID групи в Кампусі"
          placeholder="5627"
          inputMode="numeric"
          value={val}
          onChange={(e) => setVal(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending || !val.trim()}
          onClick={() => bind(val.trim())}
        >
          Зберегти
        </button>
      </div>
    </div>
  );
}

function DeputiesSection({
  groupId,
  headUserId,
  deputyUserIds,
}: {
  groupId: string;
  headUserId: string;
  deputyUserIds: string[];
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const members = useQuery({
    queryKey: ['group-members'],
    queryFn: () => api<GroupMember[]>('/users/group'),
  });
  const deputySet = new Set(deputyUserIds);

  const assign = useMutation({
    mutationFn: (targetUserId: string) =>
      api(`/groups/${groupId}/deputies`, { method: 'POST', json: { targetUserId } }),
    onSuccess: () => {
      haptic('success');
      qc.invalidateQueries({ queryKey: ['group-settings'] });
      qc.invalidateQueries({ queryKey: ['group-members'] });
    },
    onError: () => haptic('error'),
  });

  const remove = useMutation({
    mutationFn: (targetUserId: string) =>
      api(`/groups/${groupId}/deputies/${targetUserId}`, { method: 'DELETE' }),
    onSuccess: () => {
      haptic('success');
      qc.invalidateQueries({ queryKey: ['group-settings'] });
      qc.invalidateQueries({ queryKey: ['group-members'] });
    },
    onError: () => haptic('error'),
  });

  const list = (members.data ?? []).filter((m) => m._id !== headUserId);
  const q = search.trim().toLowerCase();
  const visible = q
    ? list.filter((m) => m.fullName.toLowerCase().includes(q) || (m.username ?? '').toLowerCase().includes(q))
    : list;
  const deputies = list.filter((m) => deputySet.has(m._id));

  return (
    <Section title="Заступники старости">
      {members.isError && !members.data ? (
        <ErrorState title="Не вдалося завантажити учасників" error={members.error} onRetry={() => members.refetch()} />
      ) : null}
      {remove.isError ? (
        <div className="small text-bad" role="alert">
          {remove.error.message || 'Не вдалося зняти заступника'}
        </div>
      ) : null}
      <div className="card-flat flex flex-col px-3.5 py-1">
        {deputies.map((m) => (
          <div key={m._id}>
            <div className="row-plain justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <UserAvatar name={m.fullName} src={m.avatarUrl} />
                <div className="flex min-w-0 flex-col">
                  <span className="h3 truncate">{m.fullName}</span>
                  <span className="tiny faint truncate">
                    {m.username ? `@${m.username} · ` : ''}відмічає, керує чергами
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="icon-btn-plain"
                aria-label="Зняти з заступників"
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm(`Зняти ${m.fullName} з ролі заступника?`)) {
                    remove.mutate(m._id);
                  }
                }}
              >
                <Icon name="close" size={20} />
              </button>
            </div>
            <div className="divider" />
          </div>
        ))}
        <button
          type="button"
          className="row-plain w-full justify-start text-left text-accent-text"
          onClick={() => setOpen(true)}
        >
          <span className="tile tile-soft h-10 w-10 rounded-full">
            <Icon name="plus" size={20} strokeWidth={2.2} />
          </span>
          <span className="h3 text-accent-text">Призначити заступника</span>
        </button>
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title="Призначити заступника">
        <div className="small muted">
          Заступники мають ті ж права, що й староста: редагувати розклад, налаштування, журнал, черги.
        </div>
        <input
          className="input"
          placeholder="Пошук за ПІБ або @username"
          aria-label="Пошук учасника"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {assign.isError ? (
          <div className="small text-bad" role="alert">
            {assign.error.message || 'Не вдалося призначити заступника'}
          </div>
        ) : null}
        {members.isLoading ? (
          <Loading />
        ) : members.isError && !members.data ? (
          <ErrorState title="Не вдалося завантажити учасників" error={members.error} onRetry={() => members.refetch()} />
        ) : visible.length === 0 ? (
          <div className="small muted">Нікого не знайдено</div>
        ) : (
          <div className="flex flex-col">
            {visible.slice(0, 50).map((m, i) => (
              <div key={m._id}>
                {i > 0 ? <div className="divider" /> : null}
                <div className="row-plain justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <UserAvatar name={m.fullName} src={m.avatarUrl} />
                    <div className="flex min-w-0 flex-col">
                      <span className="h3 truncate">{m.fullName}</span>
                      {m.username ? <span className="tiny faint truncate">@{m.username}</span> : null}
                    </div>
                  </div>
                  {deputySet.has(m._id) ? (
                    <span className="chip chip-accent">Заступник</span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={assign.isPending}
                      onClick={() => assign.mutate(m._id)}
                    >
                      Призначити
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Sheet>
    </Section>
  );
}

// ── Pending teacher join requests ────────────────────────────────────────────

interface JoinRequest {
  _id: string;
  teacherUserId: string;
  fullName: string;
  username?: string;
  avatarUrl?: string;
  note?: string;
}

const ASK = 'доступ до черг і журналу вашої групи';

function TeacherJoinRequests({ groupId }: { groupId: string }) {
  const qc = useQueryClient();
  const requests = useQuery({
    queryKey: ['teacher-join-requests', groupId],
    queryFn: () => api<JoinRequest[]>('/teachers/join-requests', { query: { groupId } }),
    refetchInterval: 60_000, // poll every minute (small VPS)
  });

  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) =>
      api(`/teachers/applications/${id}/decide`, { method: 'POST', json: { action } }),
    onSuccess: () => {
      haptic('success');
      qc.invalidateQueries({ queryKey: ['teacher-join-requests', groupId] });
    },
    onError: () => haptic('error'),
  });

  const list = requests.data ?? [];
  if (!list.length) return null; // hide section when nothing pending

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <h2 className="h2">Запити викладачів</h2>
        <span className="count num">{list.length}</span>
      </div>
      {decide.isError ? (
        <div className="small text-bad" role="alert">
          {decide.error.message || 'Не вдалося обробити запит'}
        </div>
      ) : null}
      {list.map((r) => (
        <div key={r._id} className="card-flat flex flex-col gap-3 border-accent">
          <div className="flex items-start gap-3">
            <UserAvatar name={r.fullName} src={r.avatarUrl} className="bg-accent-soft text-accent-text" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="h3">{r.fullName}</span>
              <span className="small muted">
                {r.username ? `@${r.username} · просить ${ASK}` : `Просить ${ASK}`}
              </span>
              {r.note ? (
                <span className="small rounded-[10px] bg-surface-2 px-2.5 py-2 text-ink-2">«{r.note}»</span>
              ) : null}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-primary btn-md flex-1"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ id: r._id, action: 'approve' })}
            >
              Підтвердити
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-md flex-1"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ id: r._id, action: 'reject' })}
            >
              Відхилити
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

function SwitchRow({
  title,
  hint,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="row-plain justify-between">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="h3">{title}</span>
        <span className="tiny faint">{hint}</span>
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} label={title} />
    </div>
  );
}

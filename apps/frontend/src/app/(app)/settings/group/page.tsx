'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/PageHeader';
import { haptic } from '../../../../lib/telegram';
import { cn } from '../../../../lib/cn';

interface GroupSettings {
  _id: string;
  name: string;
  notificationsEnabled: boolean;
  birthdayAnnouncementsEnabled: boolean;
  lessonReminderMinutes: number;
  campusGroupId?: string;
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
  role: string;
}

// Stable module-level reference (see notifications/page.tsx for why).
const GROUP_SETTINGS_KEY = ['group-settings'] as const;

export default function GroupSettingsPage() {
  const qc = useQueryClient();
  const { data } = useQuery({
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

  // Local state for the slider — debounced so we don't fire a PATCH per pixel
  // dragged. The value is shown immediately from `localMinutes`; the server
  // call only goes out once the user stops moving for 300ms.
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

  if (!data) return <div className="card text-sm text-ink-500">Завантаження…</div>;
  const disabled = !data.canEdit;

  return (
    <div className="space-y-4">
      <PageHeader title="Налаштування групи" subtitle={data.name} />

      {disabled ? (
        <div className="card text-sm text-ink-500">Лише староста або адміністратор можуть змінювати ці налаштування.</div>
      ) : null}

      <CampusBindingSection
        currentId={data.campusGroupId}
        groupName={data.name}
        canEdit={data.canEdit}
      />

      {data.iAmHead ? (
        <DeputiesSection
          groupId={data._id}
          headUserId={data.headUserId}
          deputyUserIds={data.deputyUserIds}
        />
      ) : null}

      {data.canEdit ? <TeacherJoinRequests groupId={data._id} /> : null}

      <section className="card space-y-4">
        <Row
          title="Сповіщення-нагадування у чат"
          hint="Пари та відкриття черг, повідомлення в групі"
          checked={data.notificationsEnabled}
          disabled={disabled}
          onChange={(v) => save.mutate({ notificationsEnabled: v })}
        />
        <Row
          title="Привітання з днем народження"
          hint="Автоматичні привітання в групі"
          checked={data.birthdayAnnouncementsEnabled}
          disabled={disabled}
          onChange={(v) => save.mutate({ birthdayAnnouncementsEnabled: v })}
        />
        <div>
          <div className="label">За скільки хвилин до пари сповіщати</div>
          <input
            type="range"
            min={0}
            max={60}
            step={5}
            value={minutesValue}
            disabled={disabled}
            onChange={(e) => setLocalMinutes(Number(e.target.value))}
            className="w-full"
          />
          <div className="text-sm text-ink-500">
            {minutesValue === 0 ? 'Не сповіщати' : `${minutesValue} хв до пари`}
          </div>
        </div>
      </section>
    </div>
  );
}

function CampusBindingSection({
  currentId,
  groupName,
  canEdit,
}: {
  currentId?: string;
  groupName: string;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
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
    enabled: canEdit && debounced.length >= 2,
  });

  const bind = useMutation({
    mutationFn: (campusGroupId: string) =>
      api<GroupSettings>('/groups/current/campus', { method: 'PATCH', json: { campusGroupId } }),
    onSuccess: () => {
      haptic('success');
      qc.invalidateQueries({ queryKey: ['group-settings'] });
    },
    onError: () => haptic('error'),
  });

  const sync = useMutation({
    mutationFn: () => api<{ count: number }>('/schedule/sync', { method: 'POST', json: {} }),
    onSuccess: (res) => {
      haptic('success');
      setSyncMsg(`Завантажено пар: ${res.count}`);
      qc.invalidateQueries({ queryKey: ['schedule-now'] });
      qc.invalidateQueries({ queryKey: ['my-schedule'] });
    },
    onError: (err: unknown) => {
      haptic('error');
      setSyncMsg(`Помилка: ${err instanceof Error ? err.message : 'невідома'}`);
    },
  });

  return (
    <section className="card space-y-3">
      <div>
        <div className="font-medium">Привʼязка до Кампусу</div>
        <div className="text-sm text-ink-500">
          Знайдіть свою академічну групу — після збереження розклад тягтиметься автоматично.
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[12px] uppercase tracking-wide text-ink-500">Зараз</div>
          <div className="font-medium">
            {currentId ? `ID: ${currentId}` : 'Не привʼязано'}
          </div>
        </div>
        {currentId ? (
          <button
            type="button"
            className="btn-primary h-9 px-3 text-sm"
            disabled={!canEdit || sync.isPending}
            onClick={() => {
              setSyncMsg(null);
              sync.mutate();
            }}
          >
            {sync.isPending ? 'Синхронізація…' : 'Синхронізувати'}
          </button>
        ) : null}
      </div>
      {syncMsg ? <div className="text-sm text-ink-500">{syncMsg}</div> : null}

      {canEdit ? (
        <div className="space-y-2">
          <div>
            <div className="label">Пошук за назвою</div>
            <input
              className="input"
              placeholder="Наприклад: ФІ-31"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {debounced.length < 2 ? (
            <div className="text-sm text-ink-500">Введіть назву (мінімум 2 символи)</div>
          ) : search.isLoading ? (
            <div className="text-sm text-ink-500">Шукаємо…</div>
          ) : (search.data ?? []).length === 0 ? (
            <div className="text-sm text-ink-500">Нічого не знайшли</div>
          ) : (
            <div className="space-y-1.5">
              {(search.data ?? []).map((g) => {
                const active = currentId === g.id;
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => bind.mutate(g.id)}
                    disabled={bind.isPending || active}
                    className={cn(
                      'w-full flex items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors',
                      active
                        ? 'bg-ink-900 text-paper-50'
                        : 'bg-paper-200 text-ink-700 hover:bg-paper-300',
                    )}
                  >
                    <span className="font-medium truncate">{g.name}</span>
                    <span className={cn('text-xs', active ? 'text-paper-300' : 'text-ink-500')}>
                      {active ? 'привʼязано' : `ID ${g.id}`}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <ManualIdEntry currentId={currentId} bind={bind.mutate} pending={bind.isPending} />
        </div>
      ) : null}
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
      <button
        type="button"
        className="text-sm text-ink-500 underline underline-offset-2"
        onClick={() => setOpen(true)}
      >
        Або ввести ID вручну
      </button>
    );
  }
  return (
    <div className="space-y-2 rounded-xl border border-paper-300 p-3">
      <div className="text-sm text-ink-500">
        ID можна знайти в URL на campus.kpi.ua — після <code>?groupId=</code>.
      </div>
      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder="5627"
          inputMode="numeric"
          value={val}
          onChange={(e) => setVal(e.target.value)}
        />
        <button
          type="button"
          className="btn-primary px-3"
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
  const visible = search.trim()
    ? list.filter((m) =>
        m.fullName.toLowerCase().includes(search.trim().toLowerCase()) ||
        (m.username ?? '').toLowerCase().includes(search.trim().toLowerCase()),
      )
    : list;
  const deputies = list.filter((m) => deputySet.has(m._id));

  return (
    <section className="card space-y-3">
      <div>
        <div className="font-medium">Заступники старости</div>
        <div className="text-sm text-ink-500">
          Заступники мають ті ж права, що й староста: редагувати розклад, налаштування, журнал, черги.
        </div>
      </div>

      {deputies.length ? (
        <div className="space-y-1.5">
          <div className="text-[12px] uppercase tracking-wide text-ink-500">Призначено</div>
          {deputies.map((m) => (
            <div key={m._id} className="flex items-center justify-between gap-2 rounded-xl bg-paper-100 px-3 py-2">
              <div className="min-w-0">
                <div className="font-medium truncate text-sm">{m.fullName}</div>
                {m.username ? (
                  <div className="text-xs text-ink-500 truncate">@{m.username}</div>
                ) : null}
              </div>
              <button
                type="button"
                className="btn-secondary h-8 px-3 text-xs text-danger"
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm(`Зняти ${m.fullName} з ролі заступника?`)) {
                    remove.mutate(m._id);
                  }
                }}
              >
                Зняти
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div>
        <div className="label">Призначити заступника</div>
        <input
          className="input"
          placeholder="Пошук за ПІБ або @username"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {members.isLoading ? (
        <div className="text-sm text-ink-500">Завантаження…</div>
      ) : visible.length === 0 ? (
        <div className="text-sm text-ink-500">Нікого не знайдено</div>
      ) : (
        <div className="max-h-72 overflow-y-auto space-y-1">
          {visible.slice(0, 50).map((m) => {
            const isDeputy = deputySet.has(m._id);
            return (
              <div
                key={m._id}
                className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5"
              >
                <div className="min-w-0 text-sm">
                  <div className="font-medium truncate">{m.fullName}</div>
                  {m.username ? (
                    <div className="text-xs text-ink-500 truncate">@{m.username}</div>
                  ) : null}
                </div>
                {isDeputy ? (
                  <span className="chip bg-accent-soft text-accent">Заступник</span>
                ) : (
                  <button
                    type="button"
                    className="btn-secondary h-8 px-3 text-xs"
                    disabled={assign.isPending}
                    onClick={() => assign.mutate(m._id)}
                  >
                    Призначити
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── Pending teacher join requests ────────────────────────────────────────────

interface JoinRequest {
  _id: string;
  teacherUserId: string;
  fullName: string;
  username?: string;
  note?: string;
}

function TeacherJoinRequests({ groupId }: { groupId: string }) {
  const qc = useQueryClient();
  const requests = useQuery({
    queryKey: ['teacher-join-requests', groupId],
    queryFn: () => api<JoinRequest[]>('/teachers/join-requests', { query: { groupId } }),
    refetchInterval: 30_000, // poll every 30 s
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
    <section className="card space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-sm">Запити викладачів</div>
        <span className="chip bg-warning/15 text-warning font-semibold">{list.length}</span>
      </div>
      <div className="text-xs text-ink-500">
        Викладачі, які хочуть отримати доступ до черги та журналу вашої групи.
      </div>
      <div className="space-y-2">
        {list.map((r) => (
          <div key={r._id} className="rounded-xl bg-paper-100 px-3 py-2.5 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{r.fullName}</div>
                {r.username ? (
                  <div className="text-xs text-ink-500">@{r.username}</div>
                ) : null}
                {r.note ? (
                  <div className="text-xs text-ink-600 mt-0.5 italic">«{r.note}»</div>
                ) : null}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-primary flex-1 h-8 text-xs"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ id: r._id, action: 'approve' })}
              >
                ✅ Підтвердити
              </button>
              <button
                type="button"
                className="btn-secondary flex-1 h-8 text-xs text-danger"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ id: r._id, action: 'reject' })}
              >
                ❌ Відхилити
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Row({
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
    <div className="flex items-center justify-between gap-3">
      <div className="flex-1">
        <div className="font-medium">{title}</div>
        <div className="text-sm text-ink-500">{hint}</div>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-7 w-12 rounded-full transition-colors',
          checked ? 'bg-ink-900' : 'bg-paper-300',
          disabled && 'opacity-40',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-paper-50 shadow transition-transform',
            checked && 'translate-x-5',
          )}
        />
      </button>
    </div>
  );
}

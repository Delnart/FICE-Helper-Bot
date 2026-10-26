'use client';

import { useParams } from 'next/navigation';
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api } from '../../../../../lib/api';
import { PageHeader } from '../../../../../components/PageHeader';
import { Empty, ErrorState, Loading } from '../../../../../components/Empty';
import { Icon } from '../../../../../components/icons';
import { Sheet } from '../../../../../components/ui/Sheet';
import { Section } from '../../../../../components/ui/Section';
import { Toggle } from '../../../../../components/ui/Toggle';
import { haptic } from '../../../../../lib/telegram';
import { cn } from '../../../../../lib/cn';
import { initials, shortenName } from '../../../../../lib/name';
import { LabNumberInput } from '../../../../../components/LabNumberInput';

type QueueStatus =
  | 'default'
  | 'preparing'
  | 'passing'
  | 'passed'
  | 'missed'
  | 'failed';

interface Occupant {
  userId: string | null;
  fullName: string;
  avatarUrl?: string;
  username?: string;
  labNumber: number;
  status: QueueStatus;
  enrolledAt?: string;
}

interface Slot {
  slotIndex: number;
  occupants: Occupant[];
}

interface QueueDetail {
  _id: string;
  title: string;
  subjectId: string;
  slotsCount: number;
  status: 'open' | 'closed';
  rules: {
    allowMultipleEntriesPerUser: boolean;
    allowGroupSubmission: boolean;
    isOpen: boolean;
    autoOpenAt?: string;
    autoCloseAt?: string;
  };
  slots: Slot[];
  myRole: 'student' | 'teacher' | 'deputy_head' | 'group_head' | 'admin';
  myUserId: string;
}

interface IncomingSwap {
  _id: string;
  fromUserId: string;
  fromFullName: string;
  fromSlotIndex: number;
  toSlotIndex: number;
}

interface OutgoingSwap {
  _id: string;
  toUserId: string;
  toFullName: string;
  fromSlotIndex: number;
  toSlotIndex: number;
}

interface Member {
  _id: string;
  fullName: string;
  username?: string;
}

type View = 'student' | 'manager' | 'teacher';

const STATUS_LABEL: Record<QueueStatus, string> = {
  default: 'Очікує',
  preparing: 'Готується',
  passing: 'Здає',
  passed: 'Здав',
  missed: 'Пропустив',
  failed: 'Не здав',
};
const STATUSES = Object.keys(STATUS_LABEL) as QueueStatus[];

const STATUS_CHIP: Record<QueueStatus, string> = {
  default: 'chip',
  preparing: 'chip chip-info',
  passing: 'chip chip-accent',
  passed: 'chip chip-ok',
  missed: 'chip chip-warn',
  failed: 'chip chip-bad',
};

const MAX_SLOTS = 50;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Помилка');

/** Refetch everything a queue write can change (inactive keys are only marked stale). */
function resync(qc: QueryClient) {
  for (const key of ['queue-by-subject', 'queue-incoming-swaps', 'queue-outgoing-swaps', 'queues-all']) {
    void qc.invalidateQueries({ queryKey: [key] });
  }
}

/**
 * Every queue write goes through here: haptics, the server's message in `setError`
 * (cleared on the next attempt) and a resync on success AND failure — a 409
 * «Черга щойно змінилась» means the queue moved under us, so the user retries
 * against fresh data. Callbacks live on the mutation, so they still run when an
 * optimistic update unmounts the caller (pass a setter that outlives it).
 */
function useQueueWrite<V = void>(
  mutationFn: (v: V) => Promise<unknown>,
  setError: (msg: string | null) => void,
  opts: { onMutate?: (v: V) => void; onSuccess?: () => void } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onMutate: (v: V) => {
      setError(null);
      opts.onMutate?.(v);
    },
    onSuccess: () => {
      haptic('success');
      resync(qc);
      opts.onSuccess?.();
    },
    onError: (e) => {
      haptic('error');
      setError(errMsg(e));
      resync(qc);
    },
  });
}

/** Ukrainian plural forms: plural(5, ['місце', 'місця', 'місць']) → 'місць'. */
function plural(n: number, [one, few, many]: [string, string, string]): string {
  const d = n % 10;
  const h = n % 100;
  if (d === 1 && h !== 11) return one;
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return few;
  return many;
}

export default function SubjectQueuePage() {
  const { id: subjectId } = useParams<{ id: string }>();
  const qc = useQueryClient();

  // The only polled query on this page (the VPS is small).
  const queue = useQuery({
    queryKey: ['queue-by-subject', subjectId],
    queryFn: () => api<QueueDetail>(`/queues/by-subject/${subjectId}`),
    refetchInterval: 30_000,
  });

  const queueId = queue.data?._id;

  const incoming = useQuery({
    queryKey: ['queue-incoming-swaps', queueId],
    queryFn: () =>
      api<IncomingSwap[]>(`/queues/${queueId}/swaps/incoming`),
    enabled: !!queueId,
  });

  const outgoing = useQuery({
    queryKey: ['queue-outgoing-swaps', queueId],
    queryFn: () => api<OutgoingSwap[]>(`/queues/${queueId}/swaps/outgoing`),
    enabled: !!queueId,
  });

  // Swaps aren't polled: refetch them when the polled queue actually changed
  // (structural sharing keeps queue.data's identity while nothing moved) and
  // after every write (resync). cancelRefetch:false joins an in-flight fetch.
  useEffect(() => {
    if (!queueId) return;
    for (const key of ['queue-incoming-swaps', 'queue-outgoing-swaps']) {
      void qc.invalidateQueries({ queryKey: [key, queueId] }, { cancelRefetch: false });
    }
  }, [qc, queueId, queue.data]);

  const [openSlot, setOpenSlot] = useState<{ index: number; admin: boolean } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showSwap, setShowSwap] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [labFilter, setLabFilter] = useState<number | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  // Teachers see queues read-only (per product spec: "тільки переглядати"):
  // they get no settings panel, no admin enroll, no enroll-self, no swap.
  const isTeacher = queue.data?.myRole === 'teacher';
  const canManage =
    queue.data?.myRole === 'group_head' ||
    queue.data?.myRole === 'deputy_head' ||
    queue.data?.myRole === 'admin';

  const myEntries = useMemo(() => {
    if (!queue.data) return [];
    const out: Array<{ slotIndex: number; occupant: Occupant }> = [];
    for (const s of queue.data.slots) {
      for (const o of s.occupants) {
        if (o.userId === queue.data.myUserId) {
          out.push({ slotIndex: s.slotIndex, occupant: o });
        }
      }
    }
    return out;
  }, [queue.data]);

  // "Звільнити місце" from the "Ваше місце" card.
  const leave = useQueueWrite(
    (slotIndex: number) => api(`/queues/${queueId}/entries/${slotIndex}`, { method: 'DELETE' }),
    setListError,
  );

  if (queue.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Черга" />
        <Loading label="Завантаження черги…" />
      </div>
    );
  }
  if (queue.isError || !queue.data) {
    // No data without an error usually means the request never resolved (offline):
    // surface it with a retry rather than spin forever.
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Черга" />
        <ErrorState
          error={queue.error}
          onRetry={() => queue.refetch()}
          title={queue.isError ? 'Не вдалося завантажити чергу' : 'Черга не повернула жодних даних'}
        />
      </div>
    );
  }
  const data = queue.data;
  const isOpen = data.status === 'open';
  const view: View = isTeacher ? 'teacher' : canManage ? 'manager' : 'student';

  const occupied = data.slots.filter((s) => s.occupants.length > 0);
  const firstFree = data.slots.find((s) => s.occupants.length === 0);
  const lastOccupied = occupied.length ? occupied[occupied.length - 1].slotIndex : 0;
  const mine = myEntries[0] ?? null;
  const enrolled = myEntries.length > 0;
  const swapFrom = new Set((incoming.data ?? []).map((s) => s.fromSlotIndex));
  const swapCandidates = occupied.filter(
    (s) => !s.occupants.some((o) => o.userId === data.myUserId),
  );
  const ahead =
    mine && (mine.occupant.status === 'default' || mine.occupant.status === 'preparing')
      ? occupied.filter(
          (s) =>
            s.slotIndex < mine.slotIndex &&
            ['default', 'preparing', 'passing'].includes(s.occupants[0].status),
        ).length
      : null;
  const freeAction = isTeacher
    ? undefined
    : canManage
      ? 'Записати'
      : isOpen && (!enrolled || data.rules.allowMultipleEntriesPerUser)
        ? 'Записатись'
        : undefined;

  const labs = Array.from(
    new Set(data.slots.flatMap((s) => s.occupants.map((o) => o.labNumber))),
  ).sort((a, b) => a - b);
  const filtered =
    labFilter == null
      ? data.slots
      : data.slots.filter((s) => s.occupants.some((o) => o.labNumber === labFilter));
  // Trailing free places collapse behind "Показати решту".
  const visible = showAll ? filtered : filtered.filter((s) => s.slotIndex <= lastOccupied + 1);
  const hidden = filtered.length - visible.length;

  const openSheet = (index: number, admin = false) => setOpenSlot({ index, admin });
  const sheetSlot = openSlot ? data.slots.find((s) => s.slotIndex === openSlot.index) : undefined;

  const row = (s: Slot) => (
    <SlotRow
      key={s.slotIndex}
      slot={s}
      view={view}
      myUserId={data.myUserId}
      queueId={data._id}
      wantsSwap={swapFrom.has(s.slotIndex)}
      freeAction={freeAction}
      onOpen={() => openSheet(s.slotIndex)}
      onError={setListError}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={isTeacher ? 'Черга на захист' : 'Черга на здачу'}
        chips={
          <>
            {isOpen ? (
              <span className="chip chip-ok">
                <span className="dot bg-ok" />
                відкрита
              </span>
            ) : (
              <span className="chip">закрита</span>
            )}
            <span className="chip">
              {occupied.length} із {data.slotsCount}{' '}
              {plural(data.slotsCount, ['місця', 'місць', 'місць'])}
            </span>
            <span className="small muted">
              {data.title}
              {isTeacher ? ' · перегляд' : ''}
            </span>
          </>
        }
        action={
          canManage ? (
            <button
              type="button"
              className="icon-btn"
              aria-label="Налаштування черги"
              onClick={() => setShowSettings(true)}
            >
              <Icon name="sliders" size={22} />
            </button>
          ) : undefined
        }
      />

      {/* Incoming swaps */}
      {/* Swap cards report errors to the page: an optimistic removal may unmount them. */}
      {incoming.data && incoming.data.length > 0 ? (
        <IncomingSwapsCard queueId={data._id} swaps={incoming.data} onError={setListError} />
      ) : null}

      {/* My own outgoing swap requests — gives the user a way to cancel them
          (since "1 active per queue" cap blocks new ones until this one resolves). */}
      {outgoing.data && outgoing.data.length > 0 ? (
        <OutgoingSwapsCard queueId={data._id} swaps={outgoing.data} onError={setListError} />
      ) : null}

      {/* Status banner — what happens next, and when. Only shown when the head
          actually scheduled an open/close time; otherwise stays silent. */}
      <QueueStatusBanner
        isOpen={isOpen}
        canManage={canManage}
        autoOpenAt={data.rules.autoOpenAt}
        autoCloseAt={data.rules.autoCloseAt}
      />

      {!isTeacher && mine ? (
        <section className="now flex flex-col gap-3.5" aria-label="Ваше місце">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="now-eyebrow">Ваше місце</span>
              <span className="num now-accent text-[48px] leading-[0.95]">№ {mine.slotIndex}</span>
              {myEntries.length > 1 ? (
                <span className="small now-muted">
                  також {myEntries.slice(1).map((e) => `№${e.slotIndex}`).join(', ')}
                </span>
              ) : null}
            </div>
            <div className="flex flex-col items-end gap-1.5 text-right">
              <button
                type="button"
                className="chip chip-btn bg-now-bg-2 text-now-ink"
                aria-label="Змінити номер лаби"
                onClick={() => openSheet(mine.slotIndex)}
              >
                лаб {mine.occupant.labNumber}
                <Icon name="edit" size={14} />
              </button>
              <span className="small now-muted">
                {STATUS_LABEL[mine.occupant.status].toLowerCase()}
              </span>
              {ahead != null ? <span className="small now-muted">перед вами {ahead}</span> : null}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-now btn-md flex-1"
              disabled={swapCandidates.length === 0}
              onClick={() => setShowSwap(true)}
            >
              <Icon name="swap" size={18} />
              Обмінятись
            </button>
            <button
              type="button"
              className="btn btn-now-ghost btn-md flex-1"
              disabled={leave.isPending}
              onClick={() => {
                if (window.confirm(`Звільнити місце №${mine.slotIndex}?`)) leave.mutate(mine.slotIndex);
              }}
            >
              Звільнити місце
            </button>
          </div>
        </section>
      ) : null}

      {canManage ? (
        <section className="flex gap-2">
          <button
            type="button"
            className="btn btn-primary btn-md flex-1"
            disabled={!firstFree}
            onClick={() => firstFree && openSheet(firstFree.slotIndex, true)}
          >
            <Icon name="plus" size={18} />
            Записати студента
          </button>
          {!enrolled && isOpen && firstFree ? (
            <button
              type="button"
              className="btn btn-secondary btn-md flex-1"
              onClick={() => openSheet(firstFree.slotIndex)}
            >
              Записатися
            </button>
          ) : null}
        </section>
      ) : !isTeacher && !enrolled && isOpen && firstFree ? (
        <section className="card-soft flex items-center gap-3 px-3.5 py-3">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="h3">Ви ще не в черзі</span>
            <span className="tiny faint">
              Найближче вільне місце — <span className="num">№{firstFree.slotIndex}</span>
            </span>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-md"
            onClick={() => openSheet(firstFree.slotIndex)}
          >
            Записатися
          </button>
        </section>
      ) : null}

      {data.slots.length === 0 ? (
        <Empty
          title="Черга ще не створена"
          hint="Староста ще не відкрив чергу для цієї дисципліни."
          icon="users"
        />
      ) : isTeacher ? (
        <>
          <TeacherOverview slots={data.slots} />
          {labs.length > 1 ? (
            <div className="scroll-x -mx-4 flex items-center gap-1.5 px-4">
              <span className="tiny faint mr-1 flex-shrink-0">Лаба:</span>
              {[null, ...labs].map((l) => (
                <button
                  key={l ?? 'all'}
                  type="button"
                  className={cn('chip chip-btn flex-shrink-0', labFilter === l && 'chip-ink')}
                  onClick={() => setLabFilter(l)}
                >
                  {l ?? 'Усі'}
                </button>
              ))}
            </div>
          ) : null}
          <section aria-label="Список черги" className="card-flat flex flex-col px-3.5 py-1">
            {visible.map((s, i) => (
              <Fragment key={s.slotIndex}>
                {i > 0 ? <div className="divider" /> : null}
                {row(s)}
              </Fragment>
            ))}
            {hidden > 0 ? (
              <>
                <div className="divider" />
                <div className="row-plain justify-center">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setShowAll(true)}
                  >
                    Показати ще {hidden}
                  </button>
                </div>
              </>
            ) : null}
          </section>
          <div className="card-soft flex items-center gap-3 px-3.5 py-3">
            <Icon name="eye" className="flex-shrink-0 text-ink-3" />
            <span className="small muted">
              Режим перегляду: чергою керує староста. Оновлюється кожні 30 секунд.
            </span>
          </div>
        </>
      ) : (
        <Section
          title="Місця"
          aside={
            <span className="faint">
              {canManage
                ? 'торкніться статусу, щоб змінити'
                : `оновлено о ${dayjs(queue.dataUpdatedAt).format('HH:mm')}`}
            </span>
          }
        >
          {listError ? <div className="card-flat small text-bad">{listError}</div> : null}
          <div className="flex flex-col gap-2">
            {visible.map(row)}
            {hidden > 0 ? (
              <button
                type="button"
                className="btn btn-outline btn-md btn-block"
                onClick={() => setShowAll(true)}
              >
                Показати решту · {hidden}{' '}
                {plural(hidden, ['вільне місце', 'вільні місця', 'вільних місць'])}
              </button>
            ) : null}
          </div>
        </Section>
      )}

      {openSlot && sheetSlot ? (
        <SlotSheet
          queue={data}
          slot={sheetSlot}
          adminFirst={openSlot.admin}
          canManage={canManage}
          isTeacher={isTeacher}
          isOpen={isOpen}
          onClose={() => setOpenSlot(null)}
          mySlotIndex={mine?.slotIndex ?? null}
          allowMultipleEntries={data.rules.allowMultipleEntriesPerUser}
          alreadyEnrolled={enrolled}
        />
      ) : null}

      {showSwap && mine ? (
        <SwapSheet
          queueId={data._id}
          mySlotIndex={mine.slotIndex}
          candidates={swapCandidates}
          onClose={() => setShowSwap(false)}
        />
      ) : null}

      {canManage ? (
        <Sheet open={showSettings} onClose={() => setShowSettings(false)} title="Налаштування черги">
          <SettingsForm
            queue={data}
            isOpenNow={isOpen}
            occupied={occupied.length}
            onSaved={() => setShowSettings(false)}
          />
        </Sheet>
      ) : null}
    </div>
  );
}

/**
 * "Черга відкриється о 14:00" / "Закриється о 16:00" / "Зараз закрита, відкриється…".
 * Re-renders every second so the countdown stays fresh without polling the API.
 *
 * Hidden when neither auto-open nor auto-close is scheduled.
 */
function QueueStatusBanner({
  isOpen,
  canManage,
  autoOpenAt,
  autoCloseAt,
}: {
  isOpen: boolean;
  canManage: boolean;
  autoOpenAt?: string;
  autoCloseAt?: string;
}) {
  // Tick once a second so countdowns stay live. Cheap because the component
  // is small — just an inline date diff.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  // Reference `tick` so React doesn't tree-shake the timer effect.
  void tick;

  const now = dayjs();
  const openAt = autoOpenAt ? dayjs(autoOpenAt) : null;
  const closeAt = autoCloseAt ? dayjs(autoCloseAt) : null;

  // ── Decide what to show ─────────────────────────────────────────────────
  let title: string | null = null;
  let hint: string | null = null;
  let tone: 'info' | 'warn' | 'closed' = 'info';

  if (!isOpen) {
    if (openAt && openAt.isAfter(now)) {
      title = `Черга відкриється ${formatWhen(openAt)}`;
      hint = `За ${formatRemaining(openAt.diff(now))}`;
      tone = 'info';
    } else if (!openAt && !closeAt) {
      // No schedule at all — keep banner empty (nothing useful to add).
      title = null;
    } else {
      title = 'Черга наразі закрита';
      hint = canManage ? 'Відкрийте її в налаштуваннях.' : null;
      tone = 'closed';
    }
  } else {
    if (closeAt && closeAt.isAfter(now)) {
      title = `Черга закриється ${formatWhen(closeAt)}`;
      hint = `За ${formatRemaining(closeAt.diff(now))}`;
      tone = 'warn';
    } else {
      // Open with no closing time — no banner needed.
      title = null;
    }
  }

  if (!title) return null;

  return (
    <div
      className={cn(
        'card-soft flex items-center gap-3 px-3.5 py-3',
        tone === 'warn' && 'bg-warn-soft',
        tone === 'info' && 'bg-accent-soft',
      )}
    >
      <Icon
        name="clock"
        className={cn(
          'flex-shrink-0',
          tone === 'warn' ? 'text-warn' : tone === 'info' ? 'text-accent-text' : 'text-ink-3',
        )}
      />
      <div className="flex min-w-0 flex-col">
        <span className="h3">{title}</span>
        {hint ? <span className="small muted">{hint}</span> : null}
      </div>
    </div>
  );
}

/** "сьогодні о 14:00" / "завтра о 09:00" / "13.05 о 14:00" */
function formatWhen(d: dayjs.Dayjs): string {
  const today = dayjs().startOf('day');
  if (d.isSame(today, 'day')) return `сьогодні о ${d.format('HH:mm')}`;
  if (d.isSame(today.add(1, 'day'), 'day')) return `завтра о ${d.format('HH:mm')}`;
  return `${d.format('DD.MM')} о ${d.format('HH:mm')}`;
}

/** "5 хв 30 с" / "1 год 5 хв" / "2 дн 3 год" — granular enough to feel live. */
function formatRemaining(diffMs: number): string {
  const totalSec = Math.max(0, Math.floor(diffMs / 1000));
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (days > 0) return `${days} дн ${hours} год`;
  if (hours > 0) return `${hours} год ${minutes} хв`;
  if (minutes > 0) return `${minutes} хв ${seconds.toString().padStart(2, '0')} с`;
  return `${seconds} с`;
}

function Avatar({ o, className }: { o: Occupant; className?: string }) {
  return (
    <span className={cn('avatar', className)}>
      {o.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={o.avatarUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        initials(o.fullName)
      )}
    </span>
  );
}

function StatusChip({ status, className }: { status: QueueStatus; className?: string }) {
  return (
    <span className={cn(STATUS_CHIP[status], 'flex-shrink-0', className)}>
      {status === 'passing' ? <span className="dot bg-accent" /> : null}
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Head/deputy status control: a chip with a native picker on top, or a plain `.input` select. */
function StatusSelect({
  queueId,
  slotIndex,
  status,
  variant,
  onError,
}: {
  queueId: string;
  slotIndex: number;
  status: QueueStatus;
  variant: 'chip' | 'input';
  onError: (msg: string | null) => void;
}) {
  const setStatus = useQueueWrite(
    (next: QueueStatus) =>
      api(`/queues/${queueId}/entries/${slotIndex}`, {
        method: 'PATCH',
        json: { status: next },
      }),
    onError,
  );

  const select = (className: string) => (
    <select
      className={className}
      aria-label="Статус"
      value={status}
      onChange={(e) => setStatus.mutate(e.target.value as QueueStatus)}
      disabled={setStatus.isPending}
    >
      {STATUSES.map((k) => (
        <option key={k} value={k}>
          {STATUS_LABEL[k]}
        </option>
      ))}
    </select>
  );

  if (variant === 'input') return select('input');
  return (
    <label className={cn(STATUS_CHIP[status], 'chip-btn relative flex-shrink-0 px-3')}>
      {status === 'passing' ? <span className="dot bg-accent" /> : null}
      {STATUS_LABEL[status]}
      <Icon name="chevronDown" size={14} />
      {select('absolute inset-0 h-full w-full cursor-pointer appearance-none text-base opacity-0')}
    </label>
  );
}

function SlotRow({
  slot,
  view,
  myUserId,
  queueId,
  wantsSwap,
  freeAction,
  onOpen,
  onError,
}: {
  slot: Slot;
  view: View;
  myUserId: string;
  queueId: string;
  /** The occupant of this slot asked to swap with me. */
  wantsSwap: boolean;
  /** Button label on a free place ("Записатись" / "Записати"), none for read-only. */
  freeAction?: string;
  onOpen: () => void;
  onError: (msg: string | null) => void;
}) {
  const o = slot.occupants[0];
  const me = slot.occupants.find((x) => x.userId === myUserId);
  const plain = view === 'teacher';
  const place = (accent: boolean) => (
    <span className={cn('num w-7 flex-shrink-0 text-sm', accent ? 'text-accent-text' : 'text-ink-3')}>
      {slot.slotIndex}
    </span>
  );

  if (!o) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={cn('w-full text-left', plain ? 'row-plain' : 'row border-dashed bg-transparent')}
      >
        {place(false)}
        <span className="small faint flex-1">Вільне місце</span>
        {freeAction ? <span className="btn btn-secondary btn-sm">{freeAction}</span> : null}
      </button>
    );
  }

  const passing = o.status === 'passing';
  const done = o.status === 'passed' || o.status === 'missed';
  const extra = slot.occupants.length - 1;
  const sub = [
    `лаб ${o.labNumber}`,
    me?.enrolledAt ? `записались ${dayjs(me.enrolledAt).format('HH:mm')}` : null,
    wantsSwap ? 'хоче обмін з вами' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const info = (
    <>
      {place(passing || !!me)}
      {view === 'student' ? (
        <Avatar
          o={o}
          className={me ? 'tile-accent' : passing ? 'bg-accent-soft text-accent-text' : undefined}
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="h3 truncate">
          {me ? 'Ви · ' : ''}
          {o.fullName || 'Без імені'}
          {extra > 0 ? ` +${extra}` : ''}
        </span>
        <span className={cn('tiny truncate', me ? 'text-ink-2' : 'faint')}>{sub}</span>
      </div>
    </>
  );
  const status =
    view === 'manager' ? (
      <StatusSelect
        variant="chip"
        queueId={queueId}
        slotIndex={slot.slotIndex}
        status={o.status}
        onError={onError}
      />
    ) : (
      <StatusChip status={o.status} className={me && o.status === 'default' ? 'bg-surface' : undefined} />
    );

  if (plain) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={cn('row-plain w-full text-left', done && 'opacity-60')}
      >
        {info}
        {status}
      </button>
    );
  }
  return (
    <div
      className={cn(
        'row',
        done && 'opacity-60',
        me
          ? 'border-transparent bg-accent-soft'
          : passing && 'border-accent shadow-[0_0_0_3px_var(--accent-soft)]',
      )}
    >
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        {info}
      </button>
      {status}
    </div>
  );
}

/** Teacher read-only header: who is passing now, who is next, and counters. */
function TeacherOverview({ slots }: { slots: Slot[] }) {
  const occupants = slots.flatMap((s) => s.occupants);
  const count = (...st: QueueStatus[]) => occupants.filter((o) => st.includes(o.status)).length;
  const current = slots.find((s) => s.occupants[0]?.status === 'passing');
  const p = current?.occupants[0];
  const next = current
    ? slots
        .filter(
          (s) =>
            s.slotIndex > current.slotIndex &&
            (s.occupants[0]?.status === 'default' || s.occupants[0]?.status === 'preparing'),
        )
        .slice(0, 2)
        .map((s) => s.occupants[0])
    : [];

  return (
    <>
      {current && p ? (
        <section className="now flex flex-col gap-3" aria-label="Зараз здає">
          <div className="flex items-center gap-3.5">
            <Avatar o={p} className="h-[52px] w-[52px] bg-now-bg-2 text-base text-now-ink" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="truncate text-xl font-bold leading-tight">{p.fullName || 'Без імені'}</span>
              <div className="meta">
                <span className="chip bg-now-accent text-now-accent-ink">
                  <span className="dot bg-current" />
                  здає
                </span>
                <span className="small now-muted">лабораторна {p.labNumber}</span>
              </div>
            </div>
            <span className="num now-accent text-[28px]">№{current.slotIndex}</span>
          </div>
          {next.length ? (
            <>
              <div className="h-px bg-now-muted opacity-40" />
              <div className="flex items-center justify-between gap-3">
                <span className="small now-muted min-w-0 truncate">
                  Далі:{' '}
                  <span className="font-semibold text-now-ink">
                    {shortenName(next[0].fullName) || 'Без імені'}
                  </span>{' '}
                  · лаб {next[0].labNumber}
                </span>
                {next[1] ? (
                  <span className="small now-muted truncate">
                    потім {shortenName(next[1].fullName) || 'Без імені'}
                  </span>
                ) : null}
              </div>
            </>
          ) : null}
        </section>
      ) : null}
      <section className="grid grid-cols-3 gap-2">
        {[
          { value: count('passed'), label: 'здали', cls: 'text-ok' },
          { value: count('default', 'preparing'), label: 'очікують', cls: 'text-accent-text' },
          { value: slots.filter((s) => !s.occupants.length).length, label: 'вільно', cls: '' },
        ].map((t) => (
          <div key={t.label} className="card-flat flex flex-col gap-0.5 px-3.5 py-3">
            <span className={cn('num text-[22px] leading-none', t.cls)}>{t.value}</span>
            <span className="tiny faint">{t.label}</span>
          </div>
        ))}
      </section>
    </>
  );
}

function useSwapRequest(
  queueId: string,
  mySlotIndex: number | null,
  setError: (msg: string | null) => void,
  onDone: () => void,
) {
  return useQueueWrite(
    (targetSlotIndex: number) => {
      if (mySlotIndex == null) throw new Error('Ви ще не у черзі');
      return api(`/queues/${queueId}/entries/${mySlotIndex}/swap`, {
        method: 'POST',
        json: { targetSlotIndex },
      });
    },
    setError,
    { onSuccess: onDone },
  );
}

/** "Обмінятись" from the "Ваше місце" card: pick whom to send a swap request to. */
function SwapSheet({
  queueId,
  mySlotIndex,
  candidates,
  onClose,
}: {
  queueId: string;
  mySlotIndex: number;
  candidates: Slot[];
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const swap = useSwapRequest(queueId, mySlotIndex, setError, onClose);

  return (
    <Sheet open onClose={onClose} title="Обмін місцями">
      <p className="small muted">
        Оберіть, з ким помінятися місцем <span className="num">№{mySlotIndex}</span>. Людина отримає
        запит і має його підтвердити.
      </p>
      {candidates.length ? (
        <div className="card-soft flex flex-col px-3.5 py-1">
          {candidates.map((s, i) => {
            const o = s.occupants[0];
            return (
              <Fragment key={s.slotIndex}>
                {i > 0 ? <div className="divider" /> : null}
                <button
                  type="button"
                  className="row-plain w-full text-left"
                  disabled={swap.isPending}
                  onClick={() => swap.mutate(s.slotIndex)}
                >
                  <span className="num w-7 flex-shrink-0 text-sm text-ink-3">{s.slotIndex}</span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="h3 truncate">{o.fullName || 'Без імені'}</span>
                    <span className="tiny faint">лаб {o.labNumber}</span>
                  </div>
                  <StatusChip status={o.status} className="bg-surface" />
                </button>
              </Fragment>
            );
          })}
        </div>
      ) : (
        <p className="small faint">У черзі поки немає з ким помінятися.</p>
      )}
      {error ? <div className="small text-bad">{error}</div> : null}
    </Sheet>
  );
}

/**
 * Sender's view of their own pending swap requests in this queue.
 * Shows who they wrote to + which slots they want to swap, with a Cancel
 * button. Required because the backend caps users to one active outgoing
 * swap per queue — without this UI you'd have no way to free that slot.
 */
function OutgoingSwapsCard({
  queueId,
  swaps,
  onError,
}: {
  queueId: string;
  swaps: OutgoingSwap[];
  onError: (msg: string | null) => void;
}) {
  const qc = useQueryClient();

  // Optimistic: the row vanishes at once; a failure resyncs and brings it back.
  const cancel = useQueueWrite(
    (swapId: string) => api(`/queues/swaps/${swapId}`, { method: 'DELETE' }),
    onError,
    {
      onMutate: (swapId) =>
        qc.setQueryData<OutgoingSwap[]>(['queue-outgoing-swaps', queueId], (prev) =>
          (prev ?? []).filter((s) => s._id !== swapId),
        ),
    },
  );

  return (
    <section className="card-flat flex flex-col px-3.5 pb-1 pt-3" aria-label="Ваші запити на обмін">
      <span className="eyebrow">Ваші запити на обмін · {swaps.length}</span>
      {swaps.map((s) => (
        <div key={s._id} className="row-plain">
          <span className="avatar">{initials(s.toFullName)}</span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="h3 truncate">{s.toFullName}</span>
            <span className="tiny faint">
              ваше <span className="num">№{s.fromSlotIndex}</span> ↔ їхнє{' '}
              <span className="num">№{s.toSlotIndex}</span> · чекає відповіді
            </span>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm flex-shrink-0"
            disabled={cancel.isPending}
            onClick={() => {
              if (window.confirm(`Скасувати запит до ${s.toFullName}?`)) {
                cancel.mutate(s._id);
              }
            }}
          >
            Скасувати
          </button>
        </div>
      ))}
    </section>
  );
}

/**
 * Receiver's incoming swaps: one card per request, plus a one-click
 * "Decline all" button when there are 2+ — anti-spam relief.
 *
 * Optimistic UI: when receiver clicks Accept/Decline, the card disappears
 * immediately (we patch React Query's cache before the server responds).
 */
function IncomingSwapsCard({
  queueId,
  swaps,
  onError,
}: {
  queueId: string;
  swaps: IncomingSwap[];
  onError: (msg: string | null) => void;
}) {
  const qc = useQueryClient();
  const cacheKey = ['queue-incoming-swaps', queueId];

  // Optimistically remove a swap from the local list so the row vanishes
  // before the network round-trip completes. On failure useQueueWrite's
  // resync refetches the truth (rollback).
  const removeFromCache = (swapId: string) => {
    qc.setQueryData<IncomingSwap[]>(cacheKey, (prev) =>
      (prev ?? []).filter((s) => s._id !== swapId),
    );
  };

  const declineAll = useQueueWrite(
    () =>
      api<{ declined: number }>(`/queues/${queueId}/swaps/decline-all`, {
        method: 'POST',
      }),
    onError,
    { onMutate: () => qc.setQueryData<IncomingSwap[]>(cacheKey, []) },
  );

  return (
    <div className="flex flex-col gap-2">
      {swaps.length > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <span className="eyebrow">Пропозиції обміну · {swaps.length}</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={declineAll.isPending}
            onClick={() => {
              if (window.confirm(`Відхилити всі ${swaps.length} пропозицій обміну?`)) {
                declineAll.mutate();
              }
            }}
          >
            Відхилити всі
          </button>
        </div>
      ) : null}
      {swaps.map((s) => (
        <SwapInvite
          key={s._id}
          swap={s}
          // Optimistic remove on click — DON'T also invalidate here, otherwise
          // React Query immediately refetches and the still-pending row from
          // the backend reappears before the respond request finishes.
          onResolveStart={() => removeFromCache(s._id)}
          onError={onError}
        />
      ))}
    </div>
  );
}

function SwapInvite({
  swap,
  onResolveStart,
  onError,
}: {
  swap: IncomingSwap;
  /** Called BEFORE the network request — strip the row from the cache. */
  onResolveStart: () => void;
  /** Must outlive this row: the optimistic strip unmounts it before the reply. */
  onError: (msg: string | null) => void;
}) {
  // The queue is resynced only after the backend answered (useQueueWrite),
  // otherwise the refetch returns the still-pending row and undoes the strip.
  const respond = useQueueWrite(
    (accept: boolean) =>
      api(`/queues/swaps/${swap._id}/respond`, {
        method: 'POST',
        json: { accept },
      }),
    onError,
    { onMutate: onResolveStart },
  );
  return (
    <section className="card-soft flex flex-col gap-3 bg-accent-soft" aria-label="Запит на обмін">
      <div className="flex items-center gap-3">
        <span className="avatar bg-surface text-accent-text">{initials(swap.fromFullName)}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="h3">{swap.fromFullName} пропонує обмін</span>
          <span className="small text-ink-2">
            їхнє <span className="num text-[13px]">№{swap.fromSlotIndex}</span> ↔ ваше{' '}
            <span className="num text-[13px]">№{swap.toSlotIndex}</span>
          </span>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-primary btn-md flex-1"
          disabled={respond.isPending}
          onClick={() => respond.mutate(true)}
        >
          Прийняти
        </button>
        <button
          type="button"
          className="btn btn-md flex-1 bg-surface text-ink"
          disabled={respond.isPending}
          onClick={() => respond.mutate(false)}
        >
          Відхилити
        </button>
      </div>
    </section>
  );
}

function SettingsForm({
  queue,
  isOpenNow,
  occupied,
  onSaved,
}: {
  queue: QueueDetail;
  /** Live status from the API (schedule already applied). */
  isOpenNow: boolean;
  occupied: number;
  onSaved: () => void;
}) {
  const [slotsCount, setSlotsCount] = useState(queue.slotsCount);
  const [allowMulti, setAllowMulti] = useState(queue.rules.allowMultipleEntriesPerUser);
  const [allowGroup, setAllowGroup] = useState(queue.rules.allowGroupSubmission);
  const [autoOpenOn, setAutoOpenOn] = useState(!!queue.rules.autoOpenAt);
  const [autoOpenAt, setAutoOpenAt] = useState(toLocalInput(queue.rules.autoOpenAt));
  const [autoCloseOn, setAutoCloseOn] = useState(!!queue.rules.autoCloseAt);
  const [autoCloseAt, setAutoCloseAt] = useState(toLocalInput(queue.rules.autoCloseAt));
  const [error, setError] = useState<string | null>(null);

  // `openNow` set → "Відкрити/Закрити зараз"; undefined → plain save keeping rules.isOpen.
  const save = useQueueWrite(
    (openNow: boolean | undefined) => {
      const iso = (on: boolean, v: string) => (on && v ? new Date(v).toISOString() : undefined);
      const isPast = (v?: string) => !!v && new Date(v) <= new Date();
      let openAt = iso(autoOpenOn, autoOpenAt);
      let closeAt = iso(autoCloseOn, autoCloseAt);
      // The backend lets an already-passed schedule time override isOpen, so drop it here.
      if (openNow === false && isPast(openAt)) openAt = undefined;
      if (openNow === true && isPast(closeAt)) closeAt = undefined;
      return api(`/queues/${queue._id}`, {
        method: 'PATCH',
        json: {
          slotsCount,
          rules: {
            isOpen: openNow ?? queue.rules.isOpen,
            allowMultipleEntriesPerUser: allowMulti,
            allowGroupSubmission: allowGroup,
            autoOpenAt: openAt,
            autoCloseAt: closeAt,
          },
        },
      });
    },
    setError,
    { onSuccess: onSaved },
  );
  const run = (openNow: boolean | undefined) => save.mutate(openNow);

  return (
    <>
      <div className="card-soft flex items-center justify-between gap-3 px-3.5 py-3">
        <div className="flex min-w-0 flex-col">
          <span className="h3">Кількість місць</span>
          <span className="tiny faint">
            від 1 до {MAX_SLOTS} · зайнято {occupied}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="icon-btn bg-surface"
            aria-label="Менше"
            disabled={slotsCount <= 1}
            onClick={() => setSlotsCount((n) => Math.max(1, n - 1))}
          >
            <Icon name="minus" />
          </button>
          <span className="num w-11 text-center text-lg">{slotsCount}</span>
          <button
            type="button"
            className="icon-btn bg-surface"
            aria-label="Більше"
            disabled={slotsCount >= MAX_SLOTS}
            onClick={() => setSlotsCount((n) => Math.min(MAX_SLOTS, n + 1))}
          >
            <Icon name="plus" />
          </button>
        </div>
      </div>

      <div className="card-soft flex flex-col px-3.5 py-1">
        <SwitchRow
          title="Автовідкриття"
          hint="Черга відкриється в заданий час"
          checked={autoOpenOn}
          onChange={setAutoOpenOn}
        >
          {autoOpenOn ? (
            <input
              type="datetime-local"
              className="input mb-3"
              aria-label="Автоматично відкрити о"
              value={autoOpenAt}
              onChange={(e) => setAutoOpenAt(e.target.value)}
            />
          ) : null}
        </SwitchRow>
        <div className="divider" />
        <SwitchRow
          title="Автозакриття"
          hint="Черга закриється в заданий час"
          checked={autoCloseOn}
          onChange={setAutoCloseOn}
        >
          {autoCloseOn ? (
            <input
              type="datetime-local"
              className="input mb-3"
              aria-label="Автоматично закрити о"
              value={autoCloseAt}
              onChange={(e) => setAutoCloseAt(e.target.value)}
            />
          ) : null}
        </SwitchRow>
        <div className="divider" />
        <SwitchRow
          title="Кілька записів на студента"
          hint="Можна займати кілька місць"
          checked={allowMulti}
          onChange={setAllowMulti}
        />
        <div className="divider" />
        <SwitchRow
          title="Командна здача"
          hint="Одне місце на кілька людей"
          checked={allowGroup}
          onChange={setAllowGroup}
        />
      </div>

      {error ? <div className="small text-bad">{error}</div> : null}

      <div className="flex gap-2">
        {isOpenNow ? (
          <button
            type="button"
            className="btn btn-danger flex-1"
            disabled={save.isPending}
            onClick={() => run(false)}
          >
            Закрити зараз
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-secondary flex-1"
            disabled={save.isPending}
            onClick={() => run(true)}
          >
            Відкрити зараз
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary flex-[1.4]"
          disabled={save.isPending}
          onClick={() => run(undefined)}
        >
          {save.isPending ? 'Зберігаємо…' : 'Зберегти'}
        </button>
      </div>
    </>
  );
}

function SwitchRow({
  title,
  hint,
  checked,
  onChange,
  children,
}: {
  title: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <div className="row-plain justify-between">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="h3">{title}</span>
          {hint ? <span className="tiny faint">{hint}</span> : null}
        </div>
        <Toggle checked={checked} onChange={onChange} label={title} />
      </div>
      {children}
    </div>
  );
}

function SlotSheet({
  queue,
  slot,
  adminFirst,
  canManage,
  isTeacher,
  isOpen,
  onClose,
  mySlotIndex,
  allowMultipleEntries,
  alreadyEnrolled,
}: {
  queue: QueueDetail;
  slot: Slot;
  /** Opened via "Записати студента": start with the admin-enroll form expanded. */
  adminFirst: boolean;
  canManage: boolean;
  isTeacher: boolean;
  isOpen: boolean;
  onClose: () => void;
  mySlotIndex: number | null;
  allowMultipleEntries: boolean;
  alreadyEnrolled: boolean;
}) {
  const empty = slot.occupants.length === 0;
  const myUserId = queue.myUserId;
  // Lives here, not in the forms: a failed write resyncs the queue, which can
  // swap the form for the occupant view (e.g. "Slot is already taken").
  const [error, setError] = useState<string | null>(null);

  return (
    <Sheet
      open
      onClose={onClose}
      title={
        <>
          Місце <span className="num">№{slot.slotIndex}</span>
        </>
      }
    >
      {empty ? (
        isTeacher ? (
          <p className="small muted">
            Місце вільне. Викладачі переглядають чергу без можливості записатися.
          </p>
        ) : (
          <EnrollForm
            queueId={queue._id}
            slotIndex={slot.slotIndex}
            isOpen={isOpen}
            disabled={!isOpen || (alreadyEnrolled && !allowMultipleEntries)}
            disabledHint={
              !isOpen
                ? 'Черга закрита'
                : alreadyEnrolled && !allowMultipleEntries
                  ? 'Ви вже записані. Адміністратор має дозволити кілька записів.'
                  : undefined
            }
            canManageEnrollAnyone={canManage}
            initialAdmin={adminFirst}
            setError={setError}
            onDone={onClose}
          />
        )
      ) : (
        <>
          {slot.occupants.map((o, i) => (
            <OccupantBlock
              key={(o.userId ?? '') + i}
              queue={queue}
              slot={slot}
              occupant={o}
              isMine={o.userId === myUserId}
              canManage={canManage}
              isTeacher={isTeacher}
              mySlotIndex={mySlotIndex}
              setError={setError}
              onCloseModal={onClose}
            />
          ))}
          {/* Allow extra group submission entry — never for teachers (read-only) */}
          {queue.rules.allowGroupSubmission && isOpen && !isTeacher ? (
            <EnrollForm
              queueId={queue._id}
              slotIndex={slot.slotIndex}
              isOpen={isOpen}
              disabled={false}
              title="Доєднатися до місця"
              canManageEnrollAnyone={canManage}
              setError={setError}
              onDone={onClose}
            />
          ) : null}
        </>
      )}
      {error ? (
        <div className="small text-bad" role="alert">
          {error}
        </div>
      ) : null}
    </Sheet>
  );
}

function EnrollForm({
  queueId,
  slotIndex,
  isOpen,
  disabled,
  disabledHint,
  title,
  canManageEnrollAnyone,
  initialAdmin = false,
  setError,
  onDone,
}: {
  queueId: string;
  slotIndex: number;
  isOpen: boolean;
  disabled: boolean;
  disabledHint?: string;
  title?: string;
  canManageEnrollAnyone: boolean;
  initialAdmin?: boolean;
  setError: (msg: string | null) => void;
  onDone: () => void;
}) {
  const [labNumber, setLabNumber] = useState<number>(1);
  const [adminMode, setAdminMode] = useState(initialAdmin);

  const enroll = useQueueWrite(
    () =>
      api(`/queues/${queueId}/enroll`, {
        method: 'POST',
        json: { slotIndex, labNumber },
      }),
    setError,
    { onSuccess: onDone },
  );

  return (
    <div className="flex flex-col gap-3">
      {title ? <div className="h3">{title}</div> : null}
      {!isOpen ? <div className="small muted">Черга закрита.</div> : null}
      <div>
        <div className="label">Номер лабораторної</div>
        <LabNumberInput value={labNumber} onChange={setLabNumber} disabled={disabled} />
        {disabledHint ? <div className="hint">{disabledHint}</div> : null}
      </div>
      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={disabled || enroll.isPending}
        onClick={() => enroll.mutate()}
      >
        {enroll.isPending ? 'Записуємо…' : 'Записатися'}
      </button>

      {canManageEnrollAnyone ? (
        <>
          <div className="divider" />
          {adminMode ? (
            <AdminEnrollSection
              queueId={queueId}
              slotIndex={slotIndex}
              setError={setError}
              onDone={onDone}
            />
          ) : (
            <button
              type="button"
              className="btn btn-secondary btn-block"
              onClick={() => setAdminMode(true)}
            >
              Записати когось іншого
            </button>
          )}
        </>
      ) : null}
    </div>
  );
}

function AdminEnrollSection({
  queueId,
  slotIndex,
  setError,
  onDone,
}: {
  queueId: string;
  slotIndex: number;
  setError: (msg: string | null) => void;
  onDone: () => void;
}) {
  const [search, setSearch] = useState('');
  const [labNumber, setLabNumber] = useState<number>(1);
  const [picked, setPicked] = useState<Member | null>(null);

  const members = useQuery({
    queryKey: ['group-members'],
    queryFn: () => api<Member[]>('/users/group'),
  });

  const filtered = (members.data ?? []).filter((m) =>
    m.fullName.toLowerCase().includes(search.trim().toLowerCase()),
  );

  const enroll = useQueueWrite(
    () =>
      api(`/queues/${queueId}/admin-enroll`, {
        method: 'POST',
        json: { slotIndex, labNumber, userId: picked!._id },
      }),
    setError,
    { onSuccess: onDone },
  );

  return (
    <div className="card-flat flex flex-col gap-3 p-3.5">
      <div className="h3">Записати когось</div>
      <input
        className="input"
        placeholder="Пошук за ПІБ"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPicked(null);
        }}
      />
      {members.isError ? (
        <ErrorState
          error={members.error}
          onRetry={() => members.refetch()}
          title="Не вдалося завантажити список групи"
        />
      ) : !picked ? (
        <div className="flex max-h-56 flex-col overflow-y-auto">
          {filtered.slice(0, 30).map((m) => (
            <button
              key={m._id}
              type="button"
              className="row-plain w-full text-left"
              onClick={() => {
                setPicked(m);
                setSearch(m.fullName);
              }}
            >
              <span className="avatar">{initials(m.fullName)}</span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="h3 truncate">{m.fullName}</span>
                {m.username ? <span className="tiny faint">@{m.username}</span> : null}
              </div>
            </button>
          ))}
        </div>
      ) : null}
      <div>
        <div className="label">Номер лаби</div>
        <LabNumberInput value={labNumber} onChange={setLabNumber} />
      </div>
      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={!picked || enroll.isPending}
        onClick={() => enroll.mutate()}
      >
        {enroll.isPending ? 'Записуємо…' : 'Записати'}
      </button>
    </div>
  );
}

function OccupantBlock({
  queue,
  slot,
  occupant,
  isMine,
  canManage,
  isTeacher,
  mySlotIndex,
  setError,
  onCloseModal,
}: {
  queue: QueueDetail;
  slot: Slot;
  occupant: Occupant;
  isMine: boolean;
  canManage: boolean;
  isTeacher: boolean;
  mySlotIndex: number | null;
  setError: (msg: string | null) => void;
  onCloseModal: () => void;
}) {
  const queueId = queue._id;
  const slotIndex = slot.slotIndex;
  const [labNumber, setLabNumber] = useState<number>(occupant.labNumber);

  const updateLab = useQueueWrite(
    () =>
      api(`/queues/${queueId}/entries/${slotIndex}`, {
        method: 'PATCH',
        json: { labNumber },
      }),
    setError,
  );

  const leave = useQueueWrite(
    () => api(`/queues/${queueId}/entries/${slotIndex}`, { method: 'DELETE' }),
    setError,
    { onSuccess: onCloseModal },
  );

  const swap = useSwapRequest(queueId, mySlotIndex, setError, onCloseModal);

  const canLeave = isMine && !isTeacher;
  const canRemove = !isTeacher && canManage && !isMine;
  const canSwap = !isTeacher && !isMine && mySlotIndex != null;

  return (
    <div className="card-flat flex flex-col gap-3 px-3.5 py-3">
      <div className="flex items-center gap-3">
        <Avatar o={occupant} className="h-12 w-12" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="h3 truncate">{occupant.fullName || 'Без імені'}</span>
          {occupant.username ? <span className="tiny faint">@{occupant.username}</span> : null}
          {occupant.enrolledAt ? (
            <span className="tiny faint">
              записаний{' '}
              <span className="num">{dayjs(occupant.enrolledAt).format('DD.MM HH:mm')}</span>
            </span>
          ) : null}
        </div>
        <StatusChip status={occupant.status} />
      </div>

      {/* Lab number editor (mine or manage) — never for teachers */}
      {!isTeacher && (isMine || canManage) ? (
        <div>
          <div className="label">Номер лаби</div>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <LabNumberInput value={labNumber} onChange={setLabNumber} />
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={updateLab.isPending || labNumber === occupant.labNumber}
              onClick={() => updateLab.mutate()}
            >
              Оновити
            </button>
          </div>
        </div>
      ) : null}

      {/* Status edit (manage only) — never for teachers */}
      {!isTeacher && canManage ? (
        <div>
          <div className="label">Статус</div>
          <StatusSelect
            variant="input"
            queueId={queueId}
            slotIndex={slotIndex}
            status={occupant.status}
            onError={setError}
          />
        </div>
      ) : null}

      {canLeave || canRemove || canSwap ? (
        <div className="flex flex-wrap gap-2">
          {canLeave ? (
            <button
              type="button"
              className="btn btn-danger btn-md flex-1"
              disabled={leave.isPending}
              onClick={() => leave.mutate()}
            >
              Виписатись
            </button>
          ) : null}

          {canRemove ? (
            <button
              type="button"
              className="btn btn-danger btn-md flex-1"
              disabled={leave.isPending}
              onClick={() => {
                if (window.confirm('Видалити студента з цього місця?')) leave.mutate();
              }}
            >
              Видалити
            </button>
          ) : null}

          {canSwap ? (
            <button
              type="button"
              className="btn btn-primary btn-md flex-1"
              disabled={swap.isPending}
              onClick={() => swap.mutate(slotIndex)}
            >
              {swap.isPending ? 'Надсилаємо…' : 'Запропонувати обмін'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function toLocalInput(iso?: string): string {
  if (!iso) return '';
  const d = dayjs(iso);
  if (!d.isValid()) return '';
  return d.format('YYYY-MM-DDTHH:mm');
}

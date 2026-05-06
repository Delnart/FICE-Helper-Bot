'use client';

import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api } from '../../../../../lib/api';
import { PageHeader } from '../../../../../components/PageHeader';
import { haptic } from '../../../../../lib/telegram';
import { cn } from '../../../../../lib/cn';
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

interface Member {
  _id: string;
  fullName: string;
  username?: string;
}

const STATUS_LABEL: Record<QueueStatus, string> = {
  default: 'Очікує',
  preparing: 'Готується',
  passing: 'Здає',
  passed: 'Здав',
  missed: 'Пропустив',
  failed: 'Не здав',
};

const STATUS_CLASS: Record<QueueStatus, string> = {
  default: 'bg-paper-200 text-ink-700',
  preparing: 'bg-paper-200 text-ink-900 ring-1 ring-ink-300',
  passing: 'bg-accent-soft text-accent',
  passed: 'bg-success/10 text-success',
  missed: 'bg-ink-100 text-ink-500',
  failed: 'bg-danger/10 text-danger',
};

/** Outline ring for an occupied slot, by occupant status. */
const STATUS_RING: Record<QueueStatus, string> = {
  default: 'border-paper-300',
  preparing: 'border-ink-700 ring-2 ring-ink-700/15',
  passing: 'border-accent ring-2 ring-accent/20',
  passed: 'border-success ring-2 ring-success/20',
  missed: 'border-paper-300',
  failed: 'border-danger ring-2 ring-danger/20',
};

export default function SubjectQueuePage() {
  const { id: subjectId } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const queue = useQuery({
    queryKey: ['queue-by-subject', subjectId],
    queryFn: () => api<QueueDetail>(`/queues/by-subject/${subjectId}`),
    refetchInterval: 15_000,
  });

  const queueId = queue.data?._id;

  const incoming = useQuery({
    queryKey: ['queue-incoming-swaps', queueId],
    queryFn: () =>
      api<IncomingSwap[]>(`/queues/${queueId}/swaps/incoming`),
    enabled: !!queueId,
    refetchInterval: 20_000,
  });

  const [openSlot, setOpenSlot] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);

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

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['queue-by-subject', subjectId] });
    if (queueId) qc.invalidateQueries({ queryKey: ['queue-incoming-swaps', queueId] });
  };

  if (queue.isLoading) {
    return <div className="card text-sm text-ink-500">Завантаження черги…</div>;
  }
  if (queue.isError) {
    const msg = queue.error instanceof Error ? queue.error.message : 'Невідома помилка';
    return (
      <div className="space-y-3">
        <div className="card border-danger/40 space-y-2">
          <div className="font-medium text-danger">Не вдалося завантажити чергу</div>
          <div className="text-sm text-ink-700">{msg}</div>
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => queue.refetch()}
          >
            Спробувати ще
          </button>
        </div>
      </div>
    );
  }
  if (!queue.data) {
    // No data, no loading, no error — usually means the request never resolved.
    // Surface it as a hint rather than spin forever.
    return (
      <div className="card text-sm text-ink-500 space-y-2">
        <div>Черга не повернула жодних даних.</div>
        <button
          type="button"
          className="btn-secondary text-sm"
          onClick={() => queue.refetch()}
        >
          Перезавантажити
        </button>
      </div>
    );
  }
  const data = queue.data;
  const isOpen = data.status === 'open';

  const occupiedSlots = data.slots.filter((s) => s.occupants.length > 0).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title={data.title}
        subtitle={`${occupiedSlots}/${data.slotsCount} зайнято · ${isOpen ? 'відкрита' : 'закрита'}`}
        action={
          canManage ? (
            <button
              type="button"
              className="btn-secondary h-9 px-3 text-sm"
              onClick={() => setShowSettings((v) => !v)}
            >
              {showSettings ? 'Закрити' : 'Налаштування'}
            </button>
          ) : undefined
        }
      />

      {/* Incoming swaps */}
      {incoming.data && incoming.data.length > 0 ? (
        <IncomingSwapsCard
          queueId={data._id}
          swaps={incoming.data}
          onChanged={refresh}
        />
      ) : null}

      {/* Settings (manage only) */}
      {canManage && showSettings ? (
        <SettingsPanel queue={data} onSaved={refresh} />
      ) : null}

      {/* Status banner — what happens next, and when. Only shown when the head
          actually scheduled an open/close time; otherwise stays silent. */}
      <QueueStatusBanner
        isOpen={isOpen}
        canManage={canManage}
        autoOpenAt={data.rules.autoOpenAt}
        autoCloseAt={data.rules.autoCloseAt}
      />

      {/* Slots grid */}
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {data.slots.map((s) => (
          <SlotCard
            key={s.slotIndex}
            slot={s}
            myUserId={data.myUserId}
            onClick={() => setOpenSlot(s.slotIndex)}
          />
        ))}
      </div>

      {/* Slot modal */}
      {openSlot !== null ? (
        <SlotModal
          queue={data}
          slot={data.slots.find((s) => s.slotIndex === openSlot)!}
          canManage={canManage}
          isTeacher={isTeacher}
          isOpen={isOpen}
          onClose={() => setOpenSlot(null)}
          onChanged={refresh}
          mySlotIndex={myEntries[0]?.slotIndex ?? null}
          allowMultipleEntries={data.rules.allowMultipleEntriesPerUser}
          alreadyEnrolled={myEntries.length > 0}
        />
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

  const cls =
    tone === 'warn'
      ? 'card border-warn/40 bg-warn/5 text-ink-900'
      : tone === 'closed'
        ? 'card text-sm text-ink-500'
        : 'card border-accent/40 bg-accent-soft text-ink-900';

  return (
    <div className={cls}>
      <div className="font-medium text-sm">{title}</div>
      {hint ? <div className="text-xs text-ink-500 mt-0.5">{hint}</div> : null}
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

function SlotCard({
  slot,
  myUserId,
  onClick,
}: {
  slot: Slot;
  myUserId: string;
  onClick: () => void;
}) {
  const empty = slot.occupants.length === 0;
  const mine = slot.occupants.some((o) => o.userId === myUserId);
  const primary = slot.occupants[0];

  if (empty) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="aspect-[3/4] rounded-2xl border-2 border-dashed border-paper-300 bg-paper-50 hover:bg-paper-100 hover:border-ink-300 transition-colors flex flex-col items-center justify-center gap-1 text-ink-500"
      >
        <span className="text-2xl font-semibold leading-none">{slot.slotIndex}</span>
        <span className="text-[11px]">Вільне місце</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'aspect-[3/4] rounded-2xl bg-paper-50 border p-2.5 flex flex-col items-center text-center transition-colors active:scale-[0.98]',
        STATUS_RING[primary.status],
        !mine && 'hover:bg-paper-100',
      )}
    >
      <div className="self-stretch flex items-center justify-between">
        <span className="text-[11px] text-ink-500 font-medium">№{slot.slotIndex}</span>
        {mine ? (
          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0 rounded-full bg-ink-900 text-paper-50 leading-4">
            Я
          </span>
        ) : slot.occupants.length > 1 ? (
          <span className="text-[10px] chip py-0 h-4">+{slot.occupants.length - 1}</span>
        ) : null}
      </div>
      <Avatar src={primary.avatarUrl} name={primary.fullName} className="mt-1.5" />
      <div className="mt-1.5 text-[12px] font-semibold leading-tight line-clamp-2">
        {primary.fullName || 'Без імені'}
      </div>
      <div className="mt-auto self-stretch flex items-center justify-between text-[11px]">
        <span className="text-ink-500">Лаба №{primary.labNumber}</span>
        <span className={cn('chip py-0 h-4 text-[10px]', STATUS_CLASS[primary.status])}>
          {shortStatus(primary.status)}
        </span>
      </div>
    </button>
  );
}

function shortStatus(s: QueueStatus): string {
  const m: Record<QueueStatus, string> = {
    default: '·',
    preparing: 'Готує',
    passing: 'Здає',
    passed: '✓',
    missed: '∅',
    failed: '×',
  };
  return m[s];
}

function Avatar({
  src,
  name,
  className,
  size = 'md',
}: {
  src?: string;
  name: string;
  className?: string;
  size?: 'md' | 'lg';
}) {
  const dim = size === 'lg' ? 'w-14 h-14 text-base' : 'w-10 h-10 text-sm';
  const initials = (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        className={cn(dim, 'rounded-full object-cover bg-paper-200', className)}
      />
    );
  }
  return (
    <div
      className={cn(
        dim,
        'rounded-full bg-paper-200 text-ink-700 font-semibold flex items-center justify-center',
        className,
      )}
    >
      {initials || '?'}
    </div>
  );
}

/**
 * Section card for the receiver: shows every pending incoming swap, plus a
 * one-click "Decline all" button when there are 2+ — anti-spam relief.
 *
 * Optimistic UI: when receiver clicks Accept/Decline, the row disappears
 * immediately (we patch React Query's cache before the server responds).
 */
function IncomingSwapsCard({
  queueId,
  swaps,
  onChanged,
}: {
  queueId: string;
  swaps: IncomingSwap[];
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const cacheKey = ['queue-incoming-swaps', queueId];

  // Optimistically remove a swap from the local list so the row vanishes
  // before the network round-trip completes.
  const removeFromCache = (swapId: string) => {
    qc.setQueryData<IncomingSwap[]>(cacheKey, (prev) =>
      (prev ?? []).filter((s) => s._id !== swapId),
    );
  };
  const removeAllFromCache = () => {
    qc.setQueryData<IncomingSwap[]>(cacheKey, []);
  };

  const declineAll = useMutation({
    mutationFn: () =>
      api<{ declined: number }>(`/queues/${queueId}/swaps/decline-all`, {
        method: 'POST',
      }),
    onMutate: () => removeAllFromCache(),
    onSuccess: () => {
      haptic('success');
      onChanged();
    },
    onError: () => {
      haptic('error');
      // Roll back: refetch the truth.
      void qc.invalidateQueries({ queryKey: cacheKey });
    },
  });

  return (
    <section className="card border-warn/40 bg-warn/5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12px] uppercase tracking-wide text-warn font-medium">
          Пропозиції обміну ({swaps.length})
        </div>
        {swaps.length > 1 ? (
          <button
            type="button"
            className="text-xs text-ink-500 hover:text-danger underline disabled:opacity-50"
            disabled={declineAll.isPending}
            onClick={() => {
              if (window.confirm(`Відхилити всі ${swaps.length} пропозицій обміну?`)) {
                declineAll.mutate();
              }
            }}
          >
            Відхилити всі
          </button>
        ) : null}
      </div>
      {swaps.map((s) => (
        <SwapInvite
          key={s._id}
          swap={s}
          onResolve={() => {
            removeFromCache(s._id);
            onChanged();
          }}
          onError={() => void qc.invalidateQueries({ queryKey: cacheKey })}
        />
      ))}
    </section>
  );
}

function SwapInvite({
  swap,
  onResolve,
  onError,
}: {
  swap: IncomingSwap;
  onResolve: () => void;
  onError: () => void;
}) {
  const respond = useMutation({
    mutationFn: (accept: boolean) =>
      api(`/queues/swaps/${swap._id}/respond`, {
        method: 'POST',
        json: { accept },
      }),
    // Fire optimistic removal *before* network so the row disappears instantly.
    onMutate: () => onResolve(),
    onSuccess: () => haptic('success'),
    onError: () => {
      haptic('error');
      onError();
    },
  });
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="text-sm leading-snug">
        <div className="font-medium">{swap.fromFullName}</div>
        <div className="text-xs text-ink-500 mt-0.5">
          їхнє місце <b>№{swap.fromSlotIndex}</b> → ваше <b>№{swap.toSlotIndex}</b>
        </div>
      </div>
      <div className="flex gap-1.5 flex-shrink-0">
        <button
          className="btn-primary h-8 px-3 text-xs disabled:opacity-50"
          disabled={respond.isPending}
          onClick={() => respond.mutate(true)}
        >
          Згоден
        </button>
        <button
          className="btn-secondary h-8 px-3 text-xs disabled:opacity-50"
          disabled={respond.isPending}
          onClick={() => respond.mutate(false)}
        >
          Ні
        </button>
      </div>
    </div>
  );
}

function SettingsPanel({ queue, onSaved }: { queue: QueueDetail; onSaved: () => void }) {
  const [slotsCount, setSlotsCount] = useState(queue.slotsCount);
  const [isOpenRule, setIsOpenRule] = useState(queue.rules.isOpen);
  const [allowMulti, setAllowMulti] = useState(queue.rules.allowMultipleEntriesPerUser);
  const [allowGroup, setAllowGroup] = useState(queue.rules.allowGroupSubmission);
  const [autoOpenAt, setAutoOpenAt] = useState(toLocalInput(queue.rules.autoOpenAt));
  const [autoCloseAt, setAutoCloseAt] = useState(toLocalInput(queue.rules.autoCloseAt));
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api(`/queues/${queue._id}`, {
        method: 'PATCH',
        json: {
          slotsCount,
          rules: {
            isOpen: isOpenRule,
            allowMultipleEntriesPerUser: allowMulti,
            allowGroupSubmission: allowGroup,
            autoOpenAt: autoOpenAt ? new Date(autoOpenAt).toISOString() : undefined,
            autoCloseAt: autoCloseAt ? new Date(autoCloseAt).toISOString() : undefined,
          },
        },
      }),
    onSuccess: () => {
      haptic('success');
      onSaved();
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : 'Помилка');
      haptic('error');
    },
  });

  return (
    <section className="card space-y-3">
      <div className="font-medium">Налаштування черги</div>

      <div>
        <div className="label">Кількість місць (1–50)</div>
        <input
          type="range"
          min={1}
          max={50}
          value={slotsCount}
          onChange={(e) => setSlotsCount(Number(e.target.value))}
          className="w-full"
        />
        <div className="text-sm text-ink-500">{slotsCount}</div>
      </div>

      <ToggleRow
        title="Черга відкрита"
        hint="Студенти можуть записатись"
        checked={isOpenRule}
        onChange={setIsOpenRule}
      />
      <ToggleRow
        title="Дозволити декілька записів від одного студента"
        hint="Можна займати кілька місць"
        checked={allowMulti}
        onChange={setAllowMulti}
      />
      <ToggleRow
        title="Групова здача"
        hint="Кілька людей на одне місце"
        checked={allowGroup}
        onChange={setAllowGroup}
      />

      <div>
        <div className="label">Автоматично відкрити о</div>
        <input
          type="datetime-local"
          className="input"
          value={autoOpenAt}
          onChange={(e) => setAutoOpenAt(e.target.value)}
        />
      </div>
      <div>
        <div className="label">Автоматично закрити о</div>
        <input
          type="datetime-local"
          className="input"
          value={autoCloseAt}
          onChange={(e) => setAutoCloseAt(e.target.value)}
        />
      </div>

      {error ? <div className="text-sm text-danger">{error}</div> : null}

      <button
        type="button"
        className="btn-primary w-full"
        disabled={save.isPending}
        onClick={() => save.mutate()}
      >
        {save.isPending ? 'Зберігаємо…' : 'Зберегти'}
      </button>
    </section>
  );
}

function SlotModal({
  queue,
  slot,
  canManage,
  isTeacher,
  isOpen,
  onClose,
  onChanged,
  mySlotIndex,
  allowMultipleEntries,
  alreadyEnrolled,
}: {
  queue: QueueDetail;
  slot: Slot;
  canManage: boolean;
  isTeacher: boolean;
  isOpen: boolean;
  onClose: () => void;
  onChanged: () => void;
  mySlotIndex: number | null;
  allowMultipleEntries: boolean;
  alreadyEnrolled: boolean;
}) {
  const empty = slot.occupants.length === 0;
  const myUserId = queue.myUserId;

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-ink-900/40 backdrop-blur-sm">
      <div
        className="absolute inset-0"
        onClick={onClose}
        role="button"
        aria-label="Закрити"
      />
      <div className="relative card w-full sm:max-w-md max-h-[85vh] overflow-y-auto rounded-b-none sm:rounded-2xl pb-[calc(env(safe-area-inset-bottom)+5rem)] sm:pb-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="font-semibold text-[16px]">Місце №{slot.slotIndex}</div>
          <button
            type="button"
            className="chip"
            onClick={onClose}
            aria-label="Закрити"
          >
            ✕
          </button>
        </div>

        {empty ? (
          isTeacher ? (
            <div className="text-sm text-ink-500">
              Місце вільне. Викладачі переглядають чергу без можливості записатися.
            </div>
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
              queueGroupId={queue.subjectId}
              onDone={() => {
                onChanged();
                onClose();
              }}
            />
          )
        ) : (
          <div className="space-y-3">
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
                onChanged={() => {
                  onChanged();
                }}
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
                queueGroupId={queue.subjectId}
                onDone={() => {
                  onChanged();
                  onClose();
                }}
              />
            ) : null}
          </div>
        )}
      </div>
    </div>
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
  onDone,
}: {
  queueId: string;
  slotIndex: number;
  isOpen: boolean;
  disabled: boolean;
  disabledHint?: string;
  title?: string;
  canManageEnrollAnyone: boolean;
  queueGroupId: string;
  onDone: () => void;
}) {
  const [labNumber, setLabNumber] = useState<number>(1);
  const [error, setError] = useState<string | null>(null);
  const [adminMode, setAdminMode] = useState(false);

  const enroll = useMutation({
    mutationFn: () =>
      api(`/queues/${queueId}/enroll`, {
        method: 'POST',
        json: { slotIndex, labNumber },
      }),
    onSuccess: () => {
      haptic('success');
      onDone();
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : 'Помилка');
      haptic('error');
    },
  });

  return (
    <div className="space-y-3">
      {title ? <div className="font-medium text-sm">{title}</div> : null}
      {!isOpen ? (
        <div className="text-sm text-ink-500">Черга закрита.</div>
      ) : null}
      <div>
        <div className="label">Номер лабораторної</div>
        <LabNumberInput value={labNumber} onChange={setLabNumber} disabled={disabled} />
      </div>
      {disabledHint ? <div className="text-xs text-ink-500">{disabledHint}</div> : null}
      {error ? <div className="text-sm text-danger">{error}</div> : null}
      <button
        type="button"
        className="btn-primary w-full"
        disabled={disabled || enroll.isPending}
        onClick={() => {
          setError(null);
          enroll.mutate();
        }}
      >
        {enroll.isPending ? 'Записуємо…' : 'Записатися'}
      </button>

      {canManageEnrollAnyone ? (
        <>
          <div className="border-t border-paper-300 my-1" />
          {adminMode ? (
            <AdminEnrollSection
              queueId={queueId}
              slotIndex={slotIndex}
              onDone={onDone}
            />
          ) : (
            <button
              type="button"
              className="btn-secondary w-full text-sm"
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
  onDone,
}: {
  queueId: string;
  slotIndex: number;
  onDone: () => void;
}) {
  const [search, setSearch] = useState('');
  const [labNumber, setLabNumber] = useState<number>(1);
  const [picked, setPicked] = useState<Member | null>(null);
  const [error, setError] = useState<string | null>(null);

  const members = useQuery({
    queryKey: ['group-members'],
    queryFn: () => api<Member[]>('/users/group'),
  });

  const filtered = (members.data ?? []).filter((m) =>
    m.fullName.toLowerCase().includes(search.trim().toLowerCase()),
  );

  const enroll = useMutation({
    mutationFn: () =>
      api(`/queues/${queueId}/admin-enroll`, {
        method: 'POST',
        json: { slotIndex, labNumber, userId: picked!._id },
      }),
    onSuccess: () => {
      haptic('success');
      onDone();
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : 'Помилка');
      haptic('error');
    },
  });

  return (
    <div className="space-y-2 rounded-xl border border-paper-300 p-3">
      <div className="font-medium text-sm">Записати когось</div>
      <input
        className="input"
        placeholder="Пошук за ПІБ"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPicked(null);
        }}
      />
      {!picked ? (
        <div className="max-h-40 overflow-y-auto space-y-1">
          {filtered.slice(0, 30).map((m) => (
            <button
              key={m._id}
              type="button"
              className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-paper-100 text-sm"
              onClick={() => {
                setPicked(m);
                setSearch(m.fullName);
              }}
            >
              {m.fullName}
              {m.username ? <span className="text-ink-500"> @{m.username}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      <div>
        <div className="label">Номер лаби</div>
        <LabNumberInput value={labNumber} onChange={setLabNumber} />
      </div>
      {error ? <div className="text-sm text-danger">{error}</div> : null}
      <button
        type="button"
        className="btn-primary w-full"
        disabled={!picked || enroll.isPending}
        onClick={() => {
          setError(null);
          enroll.mutate();
        }}
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
  onChanged,
  onCloseModal,
}: {
  queue: QueueDetail;
  slot: Slot;
  occupant: Occupant;
  isMine: boolean;
  canManage: boolean;
  isTeacher: boolean;
  mySlotIndex: number | null;
  onChanged: () => void;
  onCloseModal: () => void;
}) {
  const queueId = queue._id;
  const slotIndex = slot.slotIndex;
  const [labNumber, setLabNumber] = useState<number>(occupant.labNumber);
  const [error, setError] = useState<string | null>(null);

  const setStatus = useMutation({
    mutationFn: (status: QueueStatus) =>
      api(`/queues/${queueId}/entries/${slotIndex}`, {
        method: 'PATCH',
        json: { status },
      }),
    onSuccess: () => {
      haptic('success');
      onChanged();
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : 'Помилка');
      haptic('error');
    },
  });

  const updateLab = useMutation({
    mutationFn: () =>
      api(`/queues/${queueId}/entries/${slotIndex}`, {
        method: 'PATCH',
        json: { labNumber },
      }),
    onSuccess: () => {
      haptic('success');
      onChanged();
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : 'Помилка');
      haptic('error');
    },
  });

  const leave = useMutation({
    mutationFn: () =>
      api(`/queues/${queueId}/entries/${slotIndex}`, { method: 'DELETE' }),
    onSuccess: () => {
      haptic('success');
      onChanged();
      onCloseModal();
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : 'Помилка');
      haptic('error');
    },
  });

  const swap = useMutation({
    mutationFn: () => {
      if (mySlotIndex == null) throw new Error('Ви ще не у черзі');
      return api(`/queues/${queueId}/entries/${mySlotIndex}/swap`, {
        method: 'POST',
        json: { targetSlotIndex: slotIndex },
      });
    },
    onSuccess: () => {
      haptic('success');
      onCloseModal();
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : 'Помилка');
      haptic('error');
    },
  });

  return (
    <div className="rounded-xl border border-paper-300 p-3 space-y-3">
      <div className="flex items-center gap-3">
        <Avatar src={occupant.avatarUrl} name={occupant.fullName} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold truncate">{occupant.fullName || 'Без імені'}</div>
          {occupant.username ? (
            <div className="text-xs text-ink-500">@{occupant.username}</div>
          ) : null}
          {occupant.enrolledAt ? (
            <div className="text-xs text-ink-500 mt-0.5">
              записаний {dayjs(occupant.enrolledAt).format('DD.MM HH:mm')}
            </div>
          ) : null}
        </div>
        <span className={cn('chip', STATUS_CLASS[occupant.status])}>
          {STATUS_LABEL[occupant.status]}
        </span>
      </div>

      {/* Lab number editor (mine or manage) — never for teachers */}
      {!isTeacher && (isMine || canManage) ? (
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <div className="label">Номер лаби</div>
            <LabNumberInput value={labNumber} onChange={setLabNumber} />
          </div>
          <button
            type="button"
            className="btn-secondary h-10 px-3 text-sm"
            disabled={updateLab.isPending || labNumber === occupant.labNumber}
            onClick={() => updateLab.mutate()}
          >
            Оновити
          </button>
        </div>
      ) : null}

      {/* Status edit (manage only) — never for teachers */}
      {!isTeacher && canManage ? (
        <div>
          <div className="label">Статус</div>
          <select
            className="input"
            value={occupant.status}
            onChange={(e) => setStatus.mutate(e.target.value as QueueStatus)}
            disabled={setStatus.isPending}
          >
            {(Object.keys(STATUS_LABEL) as QueueStatus[]).map((k) => (
              <option key={k} value={k}>
                {STATUS_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {error ? <div className="text-sm text-danger">{error}</div> : null}

      <div className="flex flex-wrap gap-2">
        {isMine && !isTeacher ? (
          <button
            type="button"
            className="btn-secondary text-danger flex-1"
            disabled={leave.isPending}
            onClick={() => leave.mutate()}
          >
            Виписатись
          </button>
        ) : null}

        {!isTeacher && canManage && !isMine ? (
          <button
            type="button"
            className="btn-secondary text-danger flex-1"
            disabled={leave.isPending}
            onClick={() => {
              if (window.confirm('Видалити студента з цього місця?')) leave.mutate();
            }}
          >
            Видалити
          </button>
        ) : null}

        {!isTeacher && !isMine && mySlotIndex != null ? (
          <button
            type="button"
            className="btn-primary flex-1"
            disabled={swap.isPending}
            onClick={() => swap.mutate()}
          >
            {swap.isPending ? 'Надсилаємо…' : 'Запропонувати обмін'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ToggleRow({
  title,
  hint,
  checked,
  onChange,
}: {
  title: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm">{title}</div>
        {hint ? <div className="text-xs text-ink-500">{hint}</div> : null}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-7 w-12 rounded-full transition-colors flex-shrink-0',
          checked ? 'bg-ink-900' : 'bg-paper-300',
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

function toLocalInput(iso?: string): string {
  if (!iso) return '';
  const d = dayjs(iso);
  if (!d.isValid()) return '';
  return d.format('YYYY-MM-DDTHH:mm');
}

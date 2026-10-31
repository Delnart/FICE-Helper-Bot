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
import { UserAvatar, myAvatarUrl } from '../../../../../components/UserAvatar';
import { haptic } from '../../../../../lib/telegram';
import { cn } from '../../../../../lib/cn';
import { runsOn } from '../../../../../lib/lessons';
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
  /** When they last started passing / finished (passed, missed or failed). */
  startedAt?: string;
  finishedAt?: string;
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
    /** "Здав" removes the entry and everyone below moves up. */
    autoCompact?: boolean;
  };
  slots: Slot[];
  myRole: 'student' | 'teacher' | 'deputy_head' | 'group_head' | 'admin';
  myUserId: string;
  /** Teacher view only: the group's name for the header chip. */
  groupName?: string;
  /** Average time one person spends passing; null until someone has been timed. */
  avgPassMs?: number | null;
}

interface IncomingSwap {
  _id: string;
  fromUserId: string;
  fromFullName: string;
  fromAvatarUrl?: string;
  fromSlotIndex: number;
  toSlotIndex: number;
}

interface OutgoingSwap {
  _id: string;
  toUserId: string;
  toFullName: string;
  toAvatarUrl?: string;
  fromSlotIndex: number;
  toSlotIndex: number;
}

interface Member {
  _id: string;
  fullName: string;
  username?: string;
  avatarUrl?: string;
}

interface Lesson {
  subjectId?: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  dates?: string[];
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

/** Selected `.st` pill in the place sheet's status picker. */
const STATUS_ST: Record<QueueStatus, string> = {
  default: 'border-ink text-ink',
  preparing: 'on-info',
  passing: 'border-transparent bg-accent-soft text-accent-text',
  passed: 'on-ok',
  missed: 'on-warn',
  failed: 'on-bad',
};

const STATUS_HINT: Record<QueueStatus, string> = {
  default: 'Чекає своєї черги',
  preparing: 'Наступний, готується',
  passing: 'Зараз здає — наступного попередимо',
  passed: 'Лабу зараховано',
  missed: 'Не прийшов на свою чергу',
  failed: 'Лабу не прийняли',
};

const WAITING: QueueStatus[] = ['default', 'preparing'];
const FINISHED: QueueStatus[] = ['passed', 'missed', 'failed'];

const MAX_SLOTS = 50;

const DOW_SHORT = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Помилка');

const hm = (iso: string) => dayjs(iso).format('HH:mm');

/** "Коваль Марія Олегівна" → "Коваль Марія": rows and the now card show two-word names. */
const twoWords = (full: string) => full.trim().split(/\s+/).slice(0, 2).join(' ');

/** Whole minutes since `iso` as of `now`. */
const minutesSince = (iso: string, now: number) =>
  Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));

/** ETA wording: "25 хв", "2 год". */
function duration(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  return min < 60 ? `${min} хв` : `${Math.round(min / 60)} год`;
}

/** Row tail from the passing timestamps: "здає 6 хв" / "10:31–10:44". */
function timing(o: Occupant, now: number): string | null {
  if (o.status === 'passing' && o.startedAt) return `здає ${minutesSince(o.startedAt, now)} хв`;
  if (FINISHED.includes(o.status) && o.finishedAt) {
    return o.startedAt ? `${hm(o.startedAt)}–${hm(o.finishedAt)}` : hm(o.finishedAt);
  }
  return null;
}

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
  opts: { onMutate?: (v: V) => void; onSuccess?: (v: V) => void } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onMutate: (v: V) => {
      setError(null);
      opts.onMutate?.(v);
    },
    onSuccess: (_data, v) => {
      haptic('success');
      resync(qc);
      opts.onSuccess?.(v);
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
  // Manager's status sheet: the person (first in the slot) whose status is being changed.
  const [statusFor, setStatusFor] = useState<{ slot: number; userId: string | null } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showCompact, setShowCompact] = useState(false);
  const [showSwap, setShowSwap] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [labFilter, setLabFilter] = useState<number | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  // Clock for "здає 6 хв" / "оновлено щойно" between polls.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

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

  // "Наступний →": the current passer is done, the next one is called (the one after gets the DM).
  const advance = useQueueWrite(
    () => api(`/queues/${queueId}/advance`, { method: 'POST' }),
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
  const avg = data.avgPassMs ?? null;

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
  // Managers tap the free place itself (mockup 19). Students get a button on it only
  // for an extra entry: before their first one the "Ви ще не в черзі" card is the
  // single call to action (the place rows stay tappable).
  const freeAction =
    !isTeacher && !canManage && isOpen && enrolled && data.rules.allowMultipleEntriesPerUser
      ? 'Записатися'
      : undefined;

  const everyone = data.slots.flatMap((s) => s.occupants);
  const canAdvance = everyone.some((o) => o.status === 'passing' || WAITING.includes(o.status));
  const finished = (
    [
      ['здали', 'passed'],
      ['не здали', 'failed'],
      ['пропустили', 'missed'],
    ] as const
  )
    .map(([label, st]) => ({ label, n: everyone.filter((o) => o.status === st).length }))
    .filter((f) => f.n > 0)
    .map((f) => `${f.label} ${f.n}`)
    .join(' · ');

  const updatedMin = Math.floor((now - queue.dataUpdatedAt) / 60_000);

  const labs = Array.from(
    new Set(data.slots.flatMap((s) => s.occupants.map((o) => o.labNumber))),
  ).sort((a, b) => a - b);
  const filtered =
    labFilter == null
      ? data.slots
      : data.slots.filter((s) => s.occupants.some((o) => o.labNumber === labFilter));
  // Teachers see only taken places, 7 at a time (mockup 22); for the rest trailing
  // free places collapse behind "Показати решту".
  const rows = isTeacher ? filtered.filter((s) => s.occupants.length > 0) : filtered;
  const visible = showAll
    ? rows
    : isTeacher
      ? rows.slice(0, 7)
      : rows.filter((s) => s.slotIndex <= lastOccupied + 1);
  const hidden = rows.length - visible.length;

  const openSheet = (index: number, admin = false) => setOpenSlot({ index, admin });
  const sheetSlot = openSlot ? data.slots.find((s) => s.slotIndex === openSlot.index) : undefined;
  // Derived from live data: once that person is no longer at that place (a poll, a
  // compaction moved them) the sheet closes instead of showing whoever moved in.
  const statusOccupant = statusFor
    ? data.slots
        .find((s) => s.slotIndex === statusFor.slot)
        ?.occupants.find((o) => o.userId === statusFor.userId)
    : undefined;

  const row = (s: Slot) => (
    <SlotRow
      key={s.slotIndex}
      slot={s}
      view={view}
      myUserId={data.myUserId}
      now={now}
      wantsSwap={swapFrom.has(s.slotIndex)}
      freeAction={freeAction}
      onOpen={() => openSheet(s.slotIndex)}
      onStatus={
        view === 'manager'
          ? () => setStatusFor({ slot: s.slotIndex, userId: s.occupants[0]?.userId ?? null })
          : undefined
      }
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={isTeacher ? 'Черга на захист' : 'Черга на здачу'}
        chips={
          <>
            {isTeacher && data.groupName ? (
              <span className="chip chip-ink">{data.groupName}</span>
            ) : null}
            {isOpen ? (
              <span className="chip chip-ok">
                <span className="dot bg-ok" />
                відкрита
              </span>
            ) : (
              <span className="chip">закрита</span>
            )}
            <span className="chip">
              {occupied.length} із {data.slotsCount}
              {isTeacher ? '' : ` ${plural(data.slotsCount, ['місця', 'місць', 'місць'])}`}
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
              {/* Visually the mockup's 24px chip; the pseudo-element pads the tap area to 44px. */}
              <button
                type="button"
                className="chip relative bg-now-bg-2 text-now-ink after:absolute after:-inset-2.5"
                aria-label="Змінити номер лаби"
                onClick={() => openSheet(mine.slotIndex)}
              >
                лаб {mine.occupant.labNumber}
              </button>
              {mine.occupant.status !== 'default' ? (
                <span className="small now-muted">
                  {STATUS_LABEL[mine.occupant.status].toLowerCase()}
                </span>
              ) : null}
              {ahead != null ? (
                <span className="small now-muted">{ahead ? `перед вами ${ahead}` : 'ви наступні'}</span>
              ) : null}
              {ahead && avg ? (
                <span className="small now-muted">орієнтовно через {duration(ahead * avg)}</span>
              ) : null}
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
        <>
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
            <button
              type="button"
              className="btn btn-secondary btn-md flex-1"
              disabled={!canAdvance || advance.isPending}
              onClick={() => advance.mutate()}
            >
              Наступний →
            </button>
          </section>
          {finished ? (
            <section className="card-flat flex items-center gap-3 px-3.5 py-3" aria-label="Підтягнути чергу">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="h3">Підтягнути чергу</span>
                <span className="tiny faint">
                  {finished.charAt(0).toUpperCase() + finished.slice(1)} — решта підніметься вгору
                </span>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm flex-shrink-0"
                onClick={() => setShowCompact(true)}
              >
                Підтягнути
              </button>
            </section>
          ) : null}
        </>
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
          <TeacherOverview slots={data.slots} now={now} avgPassMs={avg} />
          {labs.length > 1 ? (
            <div className="scroll-x -mx-4 flex items-center gap-1.5 px-4">
              <span className="tiny faint mr-1 flex-shrink-0">Лаба:</span>
              {[null, ...labs].map((l) => (
                <button
                  key={l ?? 'all'}
                  type="button"
                  className={cn('chip chip-btn h-[34px] flex-shrink-0', labFilter === l && 'chip-ink')}
                  onClick={() => setLabFilter(l)}
                >
                  {l ?? 'Усі'}
                </button>
              ))}
            </div>
          ) : null}
          {visible.length ? (
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
          ) : (
            <Empty title="Ще ніхто не записався" icon="users" />
          )}
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
                : updatedMin < 1
                  ? 'оновлено щойно'
                  : `оновлено ${updatedMin} хв тому`}
            </span>
          }
        >
          {listError ? <div className="card-flat small text-bad">{listError}</div> : null}
          <div className="flex flex-col gap-2">
            {visible.map(row)}
            {hidden > 0 ? (
              <button
                type="button"
                className="btn btn-outline btn-block h-11"
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

      {canManage && statusFor && statusOccupant ? (
        <StatusSheet
          queueId={data._id}
          slotIndex={statusFor.slot}
          occupant={statusOccupant}
          autoCompact={!!data.rules.autoCompact}
          onClose={() => setStatusFor(null)}
        />
      ) : null}

      {canManage && showCompact ? (
        <CompactSheet queueId={data._id} slots={data.slots} onClose={() => setShowCompact(false)} />
      ) : null}

      {canManage ? (
        <Sheet open={showSettings} onClose={() => setShowSettings(false)} title="Налаштування черги">
          <SettingsForm
            queue={data}
            isOpenNow={isOpen}
            occupied={occupied.length}
            lastOccupied={lastOccupied}
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

function StatusChip({ status, className }: { status: QueueStatus; className?: string }) {
  return (
    <span className={cn(STATUS_CHIP[status], 'flex-shrink-0', className)}>
      {status === 'passing' ? <span className="dot bg-accent" /> : null}
      {STATUS_LABEL[status]}
    </span>
  );
}

function SlotRow({
  slot,
  view,
  myUserId,
  now,
  wantsSwap,
  freeAction,
  onOpen,
  onStatus,
}: {
  slot: Slot;
  view: View;
  myUserId: string;
  now: number;
  /** The occupant of this slot asked to swap with me. */
  wantsSwap: boolean;
  /** Button label on a free place ("Записатись"), none for managers / read-only. */
  freeAction?: string;
  onOpen: () => void;
  /** Managers: the status chip opens the status sheet. */
  onStatus?: () => void;
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
    // The teacher's "now" card already shows how long the current one is passing.
    plain && passing ? null : timing(o, now),
    me?.enrolledAt ? `записались ${hm(me.enrolledAt)}` : null,
    wantsSwap ? 'хоче обмін з вами' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const info = (
    <>
      {place(passing || !!me)}
      {view === 'student' ? (
        <UserAvatar
          name={o.fullName}
          src={o === me ? myAvatarUrl({ avatarUrl: o.avatarUrl }) : o.avatarUrl}
          className={me ? 'tile-accent' : passing ? 'bg-accent-soft text-accent-text' : undefined}
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="h3 truncate">
          {me ? 'Ви · ' : ''}
          {twoWords(o.fullName) || 'Без імені'}
          {extra > 0 ? ` +${extra}` : ''}
        </span>
        <span className={cn('tiny truncate', me ? 'text-ink-2' : 'faint')}>{sub}</span>
      </div>
    </>
  );
  const status = onStatus ? (
    <button
      type="button"
      className={cn(
        STATUS_CHIP[o.status],
        'relative h-8 flex-shrink-0 after:absolute after:inset-x-0 after:-inset-y-1.5',
      )}
      aria-label={`Статус «${STATUS_LABEL[o.status]}», змінити`}
      onClick={onStatus}
    >
      {STATUS_LABEL[o.status]} <span aria-hidden>▾</span>
    </button>
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

/** Head/deputy: the six statuses as rows; replaces the native <select> (bad in desktop Telegram). */
function StatusSheet({
  queueId,
  slotIndex,
  occupant,
  autoCompact,
  onClose,
}: {
  queueId: string;
  slotIndex: number;
  occupant: Occupant;
  autoCompact: boolean;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const setStatus = useQueueWrite(
    (next: QueueStatus) =>
      api(`/queues/${queueId}/entries/${slotIndex}`, {
        method: 'PATCH',
        json: { status: next, userId: occupant.userId ?? undefined },
      }),
    setError,
    { onSuccess: onClose },
  );

  return (
    <Sheet
      open
      onClose={onClose}
      title={
        <>
          Статус · місце <span className="num">№{slotIndex}</span>
        </>
      }
    >
      <p className="small muted -mt-1.5 truncate">
        {occupant.fullName || 'Без імені'} · лаб {occupant.labNumber}
      </p>
      <div className="card-flat flex flex-col px-3.5 py-1">
        {STATUSES.map((k, i) => {
          const current = k === occupant.status;
          return (
            <Fragment key={k}>
              {i > 0 ? <div className="divider" /> : null}
              <button
                type="button"
                className="row-plain w-full text-left"
                aria-pressed={current}
                disabled={setStatus.isPending}
                onClick={() => (current ? onClose() : setStatus.mutate(k))}
              >
                <StatusChip status={k} className="w-[92px] justify-center" />
                <span className="small muted min-w-0 flex-1">
                  {k === 'passed' && autoCompact ? 'Зарахувати й прибрати з черги' : STATUS_HINT[k]}
                </span>
                {current ? <Icon name="check" className="flex-shrink-0 text-accent-text" /> : null}
              </button>
            </Fragment>
          );
        })}
      </div>
      {error ? (
        <div className="small text-bad" role="alert">
          {error}
        </div>
      ) : null}
    </Sheet>
  );
}

/**
 * "Підтягнути чергу" — the spreadsheet move: finished people leave, everyone
 * below moves up 1..n in the same order. Counts mirror the backend's walk.
 */
function CompactSheet({
  queueId,
  slots,
  onClose,
}: {
  queueId: string;
  slots: Slot[];
  onClose: () => void;
}) {
  const [pick, setPick] = useState<QueueStatus[]>(['passed']);
  const [error, setError] = useState<string | null>(null);
  const compact = useQueueWrite(
    () => api(`/queues/${queueId}/compact`, { method: 'POST', json: { statuses: pick } }),
    setError,
    { onSuccess: onClose },
  );

  let next = 1;
  let moved = 0;
  let removed = 0;
  for (const s of slots) {
    const keep = s.occupants.filter((o) => !pick.includes(o.status));
    removed += s.occupants.length - keep.length;
    if (!keep.length) continue;
    if (s.slotIndex !== next) moved += keep.length;
    next++;
  }
  const count = (st: QueueStatus) =>
    slots.reduce((n, s) => n + s.occupants.filter((o) => o.status === st).length, 0);

  return (
    <Sheet open onClose={onClose} title="Підтягнути чергу">
      <p className="small muted">
        Вибрані записи зникнуть із черги, а всі нижче піднімуться на звільнені місця — порядок не
        зміниться. Запити на обмін перейдуть на нові номери.
      </p>
      <div className="card-flat flex flex-col px-3.5 py-1">
        {(['passed', 'failed', 'missed'] as const).map((k, i) => {
          const on = pick.includes(k);
          return (
            <Fragment key={k}>
              {i > 0 ? <div className="divider" /> : null}
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                className="row-plain w-full text-left"
                onClick={() => setPick((p) => (on ? p.filter((x) => x !== k) : [...p, k]))}
              >
                <span className={cn('check', on && 'on')}>
                  {on ? <Icon name="check" size={16} strokeWidth={3} /> : null}
                </span>
                <span className="h3 flex-1">{STATUS_LABEL[k]}</span>
                <span className="num text-sm text-ink-3">{count(k)}</span>
              </button>
            </Fragment>
          );
        })}
      </div>
      {error ? (
        <div className="small text-bad" role="alert">
          {error}
        </div>
      ) : null}
      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={(!removed && !moved) || compact.isPending}
        onClick={() => compact.mutate()}
      >
        {compact.isPending
          ? 'Підтягуємо…'
          : moved
            ? `Підтягнути (${moved} вгору)`
            : removed
              ? `Прибрати ${removed}`
              : 'Нічого підтягувати'}
      </button>
    </Sheet>
  );
}

/** Teacher read-only header: who is passing now, who is next, and counters. */
function TeacherOverview({
  slots,
  now,
  avgPassMs,
}: {
  slots: Slot[];
  now: number;
  avgPassMs: number | null;
}) {
  const occupants = slots.flatMap((s) => s.occupants);
  const count = (...st: QueueStatus[]) => occupants.filter((o) => st.includes(o.status)).length;
  const waiting = count('default', 'preparing');
  const current = slots.find((s) => s.occupants[0]?.status === 'passing');
  const p = current?.occupants[0];
  // Nobody passing yet: the first waiting one ("Першим: …").
  const next = slots
    .filter(
      (s) =>
        s.slotIndex > (current?.slotIndex ?? 0) &&
        (s.occupants[0]?.status === 'default' || s.occupants[0]?.status === 'preparing'),
    )
    .slice(0, 2)
    .map((s) => s.occupants[0]);

  return (
    <>
      {current && p ? (
        <section className="now flex flex-col gap-3" aria-label="Зараз здає">
          <div className="flex items-center gap-3.5">
            <UserAvatar
              name={p.fullName}
              src={p.avatarUrl}
              className="h-[52px] w-[52px] bg-now-bg-2 text-base text-now-ink"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="truncate text-xl font-bold leading-tight">{twoWords(p.fullName) || 'Без імені'}</span>
              <div className="meta">
                <span className="chip gap-1.5 bg-now-accent text-now-accent-ink">
                  <span className="dot bg-current" />
                  здає{p.startedAt ? ` · ${minutesSince(p.startedAt, now)} хв` : ''}
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
                    {twoWords(next[0].fullName) || 'Без імені'}
                  </span>{' '}
                  · лаб {next[0].labNumber}
                </span>
                {next[1] ? (
                  <span className="small now-muted truncate">
                    потім {twoWords(next[1].fullName) || 'Без імені'}
                  </span>
                ) : null}
              </div>
            </>
          ) : null}
        </section>
      ) : next.length ? (
        <section className="now flex flex-col gap-1.5" aria-label="Хто наступний">
          <span className="now-eyebrow">Зараз ніхто не здає</span>
          <span className="small now-muted truncate">
            Першим:{' '}
            <span className="font-semibold text-now-ink">
              {twoWords(next[0].fullName) || 'Без імені'}
            </span>{' '}
            · лаб {next[0].labNumber}
          </span>
        </section>
      ) : null}
      <section className="grid grid-cols-3 gap-2">
        {[
          { value: count('passed'), label: 'здали', cls: 'text-ok' },
          { value: waiting, label: 'очікують', cls: 'text-accent-text' },
          avgPassMs && waiting
            ? { value: `~${duration(waiting * avgPassMs)}`, label: 'на всіх', cls: '' }
            : { value: slots.filter((s) => !s.occupants.length).length, label: 'вільно', cls: '' },
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
                  <UserAvatar name={o.fullName} src={o.avatarUrl} />
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
          <UserAvatar name={s.toFullName} src={s.toAvatarUrl} />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="h3 truncate">{s.toFullName}</span>
            <span className="tiny faint">
              ваше <span className="num">№{s.fromSlotIndex}</span> ↔ місце{' '}
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
        <UserAvatar
          name={swap.fromFullName}
          src={swap.fromAvatarUrl}
          className="bg-surface text-accent-text"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="h3">{swap.fromFullName} пропонує обмін</span>
          <span className="small text-ink-2">
            його <span className="num text-[13px]">№{swap.fromSlotIndex}</span> ↔ ваше{' '}
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

/**
 * The subject's next lesson in the group timetable (weeks alternate 1/2): the
 * presets for auto open/close. Shares cache entries with the schedule page.
 */
function useNextLesson(subjectId: string): { start: dayjs.Dayjs; end: dayjs.Dayjs } | null {
  const nowQ = useQuery({
    queryKey: ['schedule-now', false],
    queryFn: () => api<{ weekType: 1 | 2 }>('/schedule/now'),
  });
  const cur = nowQ.data?.weekType;
  const week = (w: 1 | 2) => ({
    queryKey: ['schedule', w, false],
    queryFn: () => api<Lesson[]>('/schedule/my', { query: { week: w } }),
    enabled: !!cur,
  });
  const w1 = useQuery(week(1));
  const w2 = useQuery(week(2));
  if (!cur || !w1.data || !w2.data) return null;

  const byWeek = { 1: w1.data, 2: w2.data };
  const t = dayjs();
  const monday = t.startOf('day').subtract((t.day() + 6) % 7, 'day');
  for (let d = 0; d < 21; d++) {
    const date = monday.add(d, 'day');
    const iso = date.format('YYYY-MM-DD');
    const w = Math.floor(d / 7) % 2 === 0 ? cur : cur === 1 ? 2 : 1;
    const at = (hhmm: string) => {
      const [h, m] = hhmm.split(':').map(Number);
      return date.hour(h).minute(m);
    };
    const hit = byWeek[w]
      .filter((l) => l.subjectId === subjectId && l.dayOfWeek === (d % 7) + 1 && runsOn(l, iso))
      .map((l) => ({ start: at(l.startTime), end: at(l.endTime) }))
      .filter((l) => l.start.isAfter(t))
      .sort((a, b) => a.start.valueOf() - b.start.valueOf())[0];
    if (hit) return hit;
  }
  return null;
}

function SettingsForm({
  queue,
  isOpenNow,
  occupied,
  lastOccupied,
  onSaved,
}: {
  queue: QueueDetail;
  /** Live status from the API (schedule already applied). */
  isOpenNow: boolean;
  occupied: number;
  /** The backend refuses to shrink below the last taken place. */
  lastOccupied: number;
  onSaved: () => void;
}) {
  const [slotsCount, setSlotsCount] = useState(queue.slotsCount);
  const [allowMulti, setAllowMulti] = useState(queue.rules.allowMultipleEntriesPerUser);
  const [allowGroup, setAllowGroup] = useState(queue.rules.allowGroupSubmission);
  const [autoCompact, setAutoCompact] = useState(!!queue.rules.autoCompact);
  const [autoOpenOn, setAutoOpenOn] = useState(!!queue.rules.autoOpenAt);
  const [autoOpenAt, setAutoOpenAt] = useState(toLocalInput(queue.rules.autoOpenAt));
  const [autoCloseOn, setAutoCloseOn] = useState(!!queue.rules.autoCloseAt);
  const [autoCloseAt, setAutoCloseAt] = useState(toLocalInput(queue.rules.autoCloseAt));
  const [error, setError] = useState<string | null>(null);
  const lesson = useNextLesson(queue.subjectId);
  const minSlots = Math.max(1, lastOccupied);

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
            autoCompact,
          },
        },
      });
    },
    setError,
    { onSuccess: onSaved },
  );
  const run = (openNow: boolean | undefined) => save.mutate(openNow);

  // Switching a schedule toggle on fills an empty / past time from the next lesson.
  const stale = (v: string) => !v || !dayjs(v).isAfter(dayjs());
  const local = (d: dayjs.Dayjs) => d.format('YYYY-MM-DDTHH:mm');
  const lessonAt = (d: dayjs.Dayjs) => `${DOW_SHORT[d.day()]} ${d.format('HH:mm')}`;

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
            disabled={slotsCount <= minSlots}
            onClick={() => setSlotsCount((n) => Math.max(minSlots, n - 1))}
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
          title="Автовідкриття за розкладом"
          hint={
            autoOpenOn && autoOpenAt
              ? `Відкриється ${formatWhen(dayjs(autoOpenAt))}`
              : lesson
                ? `За 10 хв до пари · наступне ${lessonAt(lesson.start)}`
                : 'Черга відкриється в заданий час'
          }
          checked={autoOpenOn}
          onChange={(on) => {
            setAutoOpenOn(on);
            if (on && lesson && stale(autoOpenAt)) setAutoOpenAt(local(lesson.start.subtract(10, 'minute')));
          }}
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
          hint={
            autoCloseOn && autoCloseAt
              ? `Закриється ${formatWhen(dayjs(autoCloseAt))}`
              : lesson
                ? `Після завершення пари · ${lesson.end.format('HH:mm')}`
                : 'Черга закриється в заданий час'
          }
          checked={autoCloseOn}
          onChange={(on) => {
            setAutoCloseOn(on);
            if (on && lesson && stale(autoCloseAt)) setAutoCloseAt(local(lesson.end));
          }}
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
          hint="Для здачі кількох лаб за раз"
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
        <div className="divider" />
        <SwitchRow
          title="Підтягувати автоматично"
          hint="«Здав» прибирає з черги, решта піднімається"
          checked={autoCompact}
          onChange={setAutoCompact}
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

  const self = (
    <>
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
    </>
  );
  const admin = !canManageEnrollAnyone ? null : adminMode ? (
    <AdminEnrollSection queueId={queueId} slotIndex={slotIndex} setError={setError} onDone={onDone} />
  ) : (
    <button type="button" className="btn btn-secondary btn-block" onClick={() => setAdminMode(true)}>
      Записати когось іншого
    </button>
  );

  // Opened via "Записати студента": the student picker leads, self-enrol follows.
  return (
    <div className="flex flex-col gap-3">
      {initialAdmin ? admin : self}
      {admin ? <div className="divider" /> : null}
      {initialAdmin ? self : admin}
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
              <UserAvatar name={m.fullName} src={m.avatarUrl} />
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
  // Names this person to the backend: in a shared slot the edit must not land on a teammate.
  const userId = occupant.userId ?? undefined;

  const updateLab = useQueueWrite(
    () =>
      api(`/queues/${queueId}/entries/${slotIndex}`, {
        method: 'PATCH',
        json: { labNumber, userId },
      }),
    setError,
  );

  const setStatus = useQueueWrite(
    (next: QueueStatus) =>
      api(`/queues/${queueId}/entries/${slotIndex}`, {
        method: 'PATCH',
        json: { status: next, userId },
      }),
    setError,
    // Auto-compaction removed them and moved the next person into this place: close
    // rather than show someone else under the same number.
    { onSuccess: (next) => next === 'passed' && queue.rules.autoCompact && onCloseModal() },
  );

  const leave = useQueueWrite(
    () => api(`/queues/${queueId}/entries/${slotIndex}`, { method: 'DELETE', query: { userId } }),
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
        <UserAvatar
          name={occupant.fullName}
          src={isMine ? myAvatarUrl({ avatarUrl: occupant.avatarUrl }) : occupant.avatarUrl}
          className="h-12 w-12"
        />
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

      {/* Status edit (manage only) — never for teachers. `.st` pills, not a native <select>. */}
      {!isTeacher && canManage ? (
        <div>
          <div className="label">Статус</div>
          <div className="grid grid-cols-3 gap-2">
            {STATUSES.map((k) => {
              const current = k === occupant.status;
              return (
                <button
                  key={k}
                  type="button"
                  className={cn('st', current && STATUS_ST[k])}
                  aria-pressed={current}
                  disabled={setStatus.isPending}
                  onClick={() => !current && setStatus.mutate(k)}
                >
                  {STATUS_LABEL[k]}
                </button>
              );
            })}
          </div>
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

import { Types } from 'mongoose';
import { Role } from '@fice/shared';
import { SchedulerService } from './scheduler.service';

/** Mongoose query stand-in: supports .lean().exec() and .exec(). */
const query = <T>(value: T) => {
  const q = { lean: () => q, exec: async () => value };
  return q;
};

/** What Mongo returns for an inclusive projection: the listed fields and _id. */
const project = (row: object, fields: Record<string, number>) =>
  Object.fromEntries(Object.entries(row).filter(([k]) => k === '_id' || fields[k]));

type StubUser ={ _id: Types.ObjectId; telegramId: number; memberships: Array<{ groupId: Types.ObjectId; role: Role }> };
/** Honors the `_id: { $in }` part of the filter — that's how the service narrows users to the opted-in ones. */
const usersModel = (users: StubUser[]) => ({
  find: (filter: { _id: { $in: Types.ObjectId[] } }) =>
    query(users.filter((u) => filter._id.$in.some((id) => String(id) === String(u._id)))),
});
const user = (telegramId: number, ...memberships: Array<[Types.ObjectId, Role?]>): StubUser => ({
  _id: new Types.ObjectId(),
  telegramId,
  memberships: memberships.map(([groupId, role]) => ({ groupId, role: role ?? Role.Student })),
});

type PrefsRows = Record<string, object>;
/** Values at a dotted path, through arrays as Mongo reads `groups.dmX`. */
const valuesAt = (v: unknown, path: string[]): unknown[] =>
  !path.length
    ? [v]
    : Array.isArray(v)
      ? v.flatMap((x) => valuesAt(x, path))
      : v && typeof v === 'object'
        ? valuesAt((v as Record<string, unknown>)[path[0]], path.slice(1))
        : [];
/**
 * Prefs rows: `optedIn` people switched it on user-wide, `prefs` replaces whole rows. Honors the
 * opt-in filter (`{ path: value }`, optionally under `$or`), so a row it wouldn't match isn't returned.
 */
const prefsModel = (people: Record<string, StubUser>, key: string, optedIn: string[], prefs: PrefsRows) => {
  const rows: PrefsRows = { ...Object.fromEntries(optedIn.map((k) => [k, { [key]: true }])), ...prefs };
  return {
    find: (filter: Record<string, unknown> & { $or?: Array<Record<string, unknown>> }) =>
      query(
        Object.entries(rows)
          .map(([k, p]) => ({ userId: people[k]._id, ...p }))
          .filter((row) =>
            (filter.$or ?? [filter]).some((c) =>
              Object.entries(c).every(([path, v]) => valuesAt(row, path.split('.')).includes(v)),
            ),
          ),
      ),
  };
};

/**
 * One group with three lessons + one elective at 10:25 and one at 12:20; `claimed` = subjects another
 * tick already announced. Students: A picked the elective, B didn't, C never opted in, T is a teacher.
 */
function setup({
  claimed = [] as string[],
  notificationsEnabled = true,
  optedIn = ['A', 'B', 'T'],
  failDmFor = [] as number[],
  prefs = (_G: Types.ObjectId): PrefsRows => ({}),
  dated = false,
} = {}) {
  const G = new Types.ObjectId();
  const people = { A: user(1, [G]), B: user(2, [G]), C: user(3, [G]), T: user(4, [G, Role.Teacher]) };
  const at = (startTime: string, subjectName: string, electiveStudentIds?: Types.ObjectId[], dates?: string[]) => ({
    _id: new Types.ObjectId(),
    groupId: G,
    subjectName,
    type: 'lab',
    teacherNames: [],
    startTime,
    endTime: '12:00',
    weekType: 0,
    isElective: !!electiveStudentIds,
    electiveStudentIds: electiveStudentIds ?? [],
    ...(dates && { dates }),
  });
  const lessons = [
    at('10:25', 'ОС'),
    at('10:25', 'Бази даних'),
    at('10:25', 'Фізика'),
    at('10:25', 'Вибіркова', [people.A._id]),
    at('12:20', 'Пізніше'),
    ...(dated
      ? [at('10:25', 'Сьогоднішня', undefined, ['2026-10-26', '2026-11-09']), at('10:25', 'Минула', undefined, ['2026-10-12'])]
      : []),
  ];
  const nameById = new Map(lessons.map((l) => [String(l._id), l.subjectName]));
  const broadcastLessonReminders = jest.fn(async (_g: string, _m: number, _l: Array<{ subjectName: string }>) => undefined);
  const sendDirect = jest.fn(async (telegramId: number, _text: string) => {
    if (failDmFor.includes(telegramId)) throw new Error('Forbidden: bot was blocked by the user');
  });
  const updateOne = jest.fn((filter: { lessonId: Types.ObjectId }) =>
    query({ upsertedCount: claimed.includes(nameById.get(String(filter.lessonId))!) ? 0 : 1, upsertedId: null }),
  );
  const svc = new SchedulerService(
    { broadcastLessonReminders, sendDirect } as never,
    { find: () => query(lessons) } as never,
    {} as never,
    {} as never,
    {} as never,
    { find: () => query([{ _id: G, notificationsEnabled, lessonReminderMinutes: 10 }]) } as never,
    usersModel(Object.values(people)) as never,
    { find: () => query([]) } as never,
    { updateOne } as never,
    { refreshWeekParity: async () => 1 } as never,
    prefsModel(people, 'dmLessonReminder', optedIn, prefs(G)) as never,
  );
  /** telegramId → DM text */
  const dms = () => new Map(sendDirect.mock.calls.map(([id, text]) => [id, text]));
  return { svc, G, broadcastLessonReminders, sendDirect, updateOne, dms };
}

describe('SchedulerService.tickLessonReminders', () => {
  beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    // Monday 10:15 local → the 10-minute lead targets the 10:25 lessons.
    jest.setSystemTime(new Date(2026, 9, 26, 10, 15, 0));
  });
  afterAll(() => jest.useRealTimers());

  it('sends one message per group for all lessons starting at the same minute', async () => {
    const { svc, G, broadcastLessonReminders } = setup();
    await svc.tickLessonReminders();
    expect(broadcastLessonReminders).toHaveBeenCalledTimes(1);
    const [groupId, minutes, list] = broadcastLessonReminders.mock.calls[0];
    expect(groupId).toBe(String(G));
    expect(minutes).toBe(10);
    expect(list.map((l) => l.subjectName).sort()).toEqual(['Бази даних', 'Вибіркова', 'ОС', 'Фізика'].sort());
  });

  it('leaves out lessons another tick already announced', async () => {
    const { svc, broadcastLessonReminders, dms } = setup({ claimed: ['ОС'] });
    await svc.tickLessonReminders();
    expect(broadcastLessonReminders.mock.calls[0][2].map((l) => l.subjectName).sort()).toEqual(
      ['Бази даних', 'Вибіркова', 'Фізика'].sort(),
    );
    expect(dms().get(2)).not.toContain('ОС');
  });

  it('sends nothing when every due lesson was already announced', async () => {
    const { svc, broadcastLessonReminders, sendDirect } = setup({ claimed: ['ОС', 'Бази даних', 'Фізика', 'Вибіркова'] });
    await svc.tickLessonReminders();
    expect(broadcastLessonReminders).not.toHaveBeenCalled();
    expect(sendDirect).not.toHaveBeenCalled();
  });

  it('DMs one message to each opted-in student with only the lessons they attend', async () => {
    const { svc, dms } = setup();
    await svc.tickLessonReminders();
    const sent = dms();
    expect([...sent.keys()].sort()).toEqual([1, 2]); // C never opted in, T only teaches the group
    expect(sent.get(1)).toContain('пари (4)');
    expect(sent.get(1)).toContain('Вибіркова');
    expect(sent.get(2)).toContain('пари (3)');
    expect(sent.get(2)).not.toContain('Вибіркова');
  });

  it('still DMs opted-in students when the group chat reminders are off', async () => {
    const { svc, broadcastLessonReminders, dms } = setup({ notificationsEnabled: false });
    await svc.tickLessonReminders();
    expect(broadcastLessonReminders).not.toHaveBeenCalled();
    expect([...dms().keys()].sort()).toEqual([1, 2]);
  });

  it("doesn't touch a group with chat reminders off and nobody opted in", async () => {
    const { svc, broadcastLessonReminders, sendDirect, updateOne } = setup({ notificationsEnabled: false, optedIn: [] });
    await svc.tickLessonReminders();
    expect(updateOne).not.toHaveBeenCalled();
    expect(broadcastLessonReminders).not.toHaveBeenCalled();
    expect(sendDirect).not.toHaveBeenCalled();
  });

  it("follows the group's own choice over the user-wide one, and the user-wide one when the group has none", async () => {
    const { svc, dms } = setup({
      optedIn: [],
      prefs: (G) => ({
        A: { dmLessonReminder: true, groups: [{ groupId: G, dmLessonReminder: false }] }, // off for this group
        B: { groups: [{ groupId: G, dmLessonReminder: true }] }, // on only for this group
        C: { dmLessonReminder: true, groups: [{ groupId: new Types.ObjectId(), dmLessonReminder: false }] }, // other group's entry
      }),
    });
    await svc.tickLessonReminders();
    expect([...dms().keys()].sort()).toEqual([2, 3]);
  });

  it('keeps sending when one DM fails', async () => {
    const { svc, sendDirect } = setup({ failDmFor: [1] });
    await svc.tickLessonReminders();
    expect(sendDirect.mock.calls.map(([id]) => id).sort()).toEqual([1, 2]);
  });

  it('skips a lesson that runs on other dates, in the chat and in DMs, and claims nothing for it', async () => {
    const { svc, broadcastLessonReminders, dms, updateOne } = setup({ dated: true });
    await svc.tickLessonReminders();
    const list = broadcastLessonReminders.mock.calls[0][2].map((l) => l.subjectName);
    expect(list).toContain('Сьогоднішня');
    expect(list).toContain('ОС'); // no dates at all: every week
    expect(list).not.toContain('Минула');
    expect(dms().get(2)).toContain('Сьогоднішня');
    expect(dms().get(2)).not.toContain('Минула');
    expect(updateOne).toHaveBeenCalledTimes(5);
  });
});

describe('SchedulerService.tickMorningDigest', () => {
  beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date(2026, 9, 27, 8, 0, 0));
  });
  afterAll(() => jest.useRealTimers());

  function digestSetup(prefs = (_G1: Types.ObjectId, _G2: Types.ObjectId): PrefsRows => ({})) {
    const G1 = new Types.ObjectId();
    const G2 = new Types.ObjectId();
    const people = {
      A: user(1, [G1]), // lessons + deadline
      B: user(2, [G2]), // G2 has no lessons and B already did its homework → nothing
      M: user(3, [G1], [G2]), // two groups → group names in the text
      T: user(4, [G1, Role.Teacher]), // teaching G1 isn't their timetable
      N: user(5, [G1]), // never opted in
    };
    const S = new Types.ObjectId();
    const lesson = (
      groupId: Types.ObjectId,
      subjectName: string,
      startTime: string,
      electiveStudentIds?: Types.ObjectId[],
      dates?: string[],
    ) => ({
      _id: new Types.ObjectId(),
      groupId,
      subjectName,
      type: 'lecture',
      startTime,
      endTime: '12:00',
      room: '18-511',
      isElective: !!electiveStudentIds,
      electiveStudentIds: electiveStudentIds ?? [],
      ...(dates && { dates }),
    });
    const lessons = [
      lesson(G1, 'ОС', '10:25'),
      lesson(G1, 'Вибіркова', '08:30', [people.M._id]),
      lesson(G1, 'Сьогоднішня', '12:20', undefined, ['2026-10-27']),
      lesson(G1, 'Минула', '12:20', undefined, ['2026-10-13']),
    ];
    const hw = (groupId: Types.ObjectId, title: string) => ({
      _id: new Types.ObjectId(),
      groupId,
      subjectId: S,
      title,
      deadline: new Date(2026, 9, 27, 23, 59),
    });
    const homework = [hw(G1, 'Лаба 1'), hw(G2, 'Есе')];
    const sendDirect = jest.fn(async (_id: number, _text: string) => undefined);
    const svc = new SchedulerService(
      { sendDirect } as never,
      { find: (_filter: unknown, fields: Record<string, number>) => query(lessons.map((l) => project(l, fields))) } as never,
      {} as never,
      { find: () => query(homework) } as never,
      { find: () => query([{ homeworkId: homework[1]._id, userId: people.B._id }]) } as never,
      {
        find: () =>
          query([
            { _id: G1, academicName: 'ІП-31' },
            { _id: G2, academicName: 'ІП-32' },
          ]),
      } as never,
      usersModel(Object.values(people)) as never,
      { find: () => query([{ _id: S, name: 'Операційні системи' }]) } as never,
      {} as never,
      { refreshWeekParity: async () => 1 } as never,
      prefsModel(people, 'dmMorningDigest', ['A', 'B', 'M', 'T'], prefs(G1, G2)) as never,
    );
    return { svc, sendDirect };
  }

  it('sends one digest per user with something today, and nothing to the rest', async () => {
    const { svc, sendDirect } = digestSetup();
    await svc.tickMorningDigest();
    const sent = new Map(sendDirect.mock.calls.map(([id, text]) => [id, text]));
    expect([...sent.keys()].sort()).toEqual([1, 3]);

    const a = sent.get(1)!;
    expect(a).toContain('ОС');
    expect(a).not.toContain('Вибіркова'); // A didn't pick the elective
    expect(a).toContain('• <b>Лаба 1</b> · Операційні системи');
    expect(a).not.toContain('ІП-31'); // single group → no prefix

    const m = sent.get(3)!;
    expect(m.indexOf('Вибіркова')).toBeLessThan(m.indexOf('ОС')); // start-time order
    expect(m).toContain('<i>ІП-31</i> · ОС');
    expect(m).toContain('<i>ІП-32</i> · <b>Есе</b>');
  });

  it("includes only the groups where the user's digest is on", async () => {
    for (const rows of [
      (G1: Types.ObjectId) => ({ M: { groups: [{ groupId: G1, dmMorningDigest: true }] } }), // on only in G1
      (_G1: Types.ObjectId, G2: Types.ObjectId) => ({
        M: { dmMorningDigest: true, groups: [{ groupId: G2, dmMorningDigest: false }] }, // on, but off in G2
      }),
    ]) {
      const { svc, sendDirect } = digestSetup(rows);
      await svc.tickMorningDigest();
      const sent = new Map(sendDirect.mock.calls.map(([id, text]) => [id, text]));
      expect([...sent.keys()].sort()).toEqual([1, 3]); // A keeps its user-wide choice
      const m = sent.get(3)!;
      expect(m).toContain('ОС');
      expect(m).not.toContain('Есе'); // G2's deadline
      expect(m).not.toContain('ІП-31'); // one group left → no prefix
    }
  });

  it('leaves out a lesson that runs on other dates', async () => {
    const { svc, sendDirect } = digestSetup();
    await svc.tickMorningDigest();
    const a = new Map(sendDirect.mock.calls.map(([id, text]) => [id, text])).get(1)!;
    expect(a).toContain('Сьогоднішня');
    expect(a).not.toContain('Минула');
  });
});

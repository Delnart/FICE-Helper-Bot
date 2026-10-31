import { Types } from 'mongoose';
import { ScheduleService } from './schedule.service';
import { CampusScheduleItem } from '../campus/campus.service';

/** Mongoose query stand-in: supports .lean().exec() and .exec(). */
const query = <T>(value: T) => {
  const q = { lean: () => q, exec: async () => value };
  return q;
};

const ONS = 'Основи національного спротиву';
const ROSHCHENKO = 'Рощенко Сергій Віталійович';

/** A row of ІП-55's Wednesday 14:15 slot. */
const item = (dates: string[], over: Partial<CampusScheduleItem> = {}): CampusScheduleItem => ({
  subjectName: ONS,
  teacherNames: [ROSHCHENKO],
  type: 'lecture',
  dayOfWeek: 3,
  lessonNumber: 4,
  startTime: '14:15',
  endTime: '15:50',
  weekType: 1,
  dates,
  ...over,
});
/** The real slot: four rows that differ only by dates. */
const SLOT = [['2026-10-14'], ['2026-11-11', '2026-11-25'], ['2026-12-09'], ['2026-12-23', '2027-01-06', '2027-01-20']];

type Doc = Record<string, unknown> & { _id: Types.ObjectId; dates?: string[] };
/** A stored lesson from before `dates`: the field isn't there at all. */
const legacyDoc = (over: Partial<CampusScheduleItem> = {}): Doc => {
  const { dates: _none, ...fields } = item([], over);
  return { _id: new Types.ObjectId(), ...fields, isElective: false, electiveStudentIds: [] };
};

function syncSetup(stored: Doc[] = []) {
  let campus: CampusScheduleItem[] = [];
  const bulkWrite = jest.fn(async (ops: Array<Record<string, any>>) => {
    for (const { deleteMany, updateOne, insertOne } of ops) {
      if (deleteMany) stored.splice(0, stored.length, ...stored.filter((d) => !deleteMany.filter._id.$in.includes(d._id)));
      if (insertOne) stored.push({ _id: new Types.ObjectId(), ...insertOne.document });
      if (updateOne) {
        const doc = stored.find((d) => d._id === updateOne.filter._id)!;
        Object.assign(doc, updateOne.update.$set);
        for (const k of Object.keys(updateOne.update.$unset ?? {})) delete doc[k];
      }
    }
  });
  const svc = new ScheduleService(
    { find: () => query(stored.map((d) => ({ ...d }))), bulkWrite } as never,
    { updateOne: () => query(undefined) } as never,
    {} as never,
    {} as never,
    { fetchGroupSchedule: async () => campus } as never,
  );
  const sync = (items: CampusScheduleItem[]) => {
    campus = items;
    return svc.syncGroupSchedule({ _id: new Types.ObjectId(), campusGroupId: '5627' });
  };
  const idWith = (dates: string[]) => String(stored.find((d) => String(d.dates) === String(dates))?._id);
  /** Every op of the last sync, by kind. */
  const opKinds = () => bulkWrite.mock.lastCall![0].map((op) => Object.keys(op)[0]);
  return { stored, bulkWrite, sync, idWith, opKinds };
}

describe('ScheduleService sync with dates', () => {
  const rows = () => SLOT.map((dates) => item(dates));

  it('stores the dates of a new lesson', async () => {
    const { stored, sync } = syncSetup();
    await sync(rows());
    expect(stored.map((d) => d.dates)).toEqual(SLOT);
  });

  it('gives legacy docs their dates in place on the first dated sync', async () => {
    const { stored, sync, bulkWrite, opKinds } = syncSetup(SLOT.map(() => legacyDoc()));
    const ids = stored.map((d) => d._id);
    await sync(rows());
    expect(opKinds()).toEqual(['updateOne', 'updateOne', 'updateOne', 'updateOne']); // no deletes, no inserts
    expect(stored.map((d) => d._id)).toEqual(ids);
    expect(stored.map((d) => d.dates)).toEqual(SLOT);

    bulkWrite.mockClear();
    await sync(rows().reverse());
    expect(bulkWrite).not.toHaveBeenCalled();
  });

  it('writes a legacy doc of an undated row once, then leaves it alone', async () => {
    const { stored, sync, bulkWrite, opKinds } = syncSetup([legacyDoc()]);
    const [{ _id }] = stored;
    await sync([item([])]);
    expect(opKinds()).toEqual(['updateOne']);
    expect(stored).toEqual([expect.objectContaining({ _id, dates: [] })]);

    bulkWrite.mockClear();
    await sync([item([])]);
    expect(bulkWrite).not.toHaveBeenCalled();
  });

  // Undated row first: it must not grab the dated doc. Dated row first: nor must it grab the legacy one.
  it.each([
    ['undated', [[], ['2026-10-28']]],
    ['dated', [['2026-10-28'], []]],
  ])('matches a legacy doc to an undated row as the same dates, %s row first', async (_name, order) => {
    const dated = { ...legacyDoc(), dates: ['2026-10-14'] };
    const legacy = legacyDoc();
    const { sync, idWith } = syncSetup([dated, legacy]);
    await sync(order.map((dates) => item(dates)));
    expect(idWith([])).toBe(String(legacy._id));
    expect(idWith(['2026-10-28'])).toBe(String(dated._id));
  });

  it('keeps ids and dates of rows that differ only by dates, however Campus orders them', async () => {
    const { sync, bulkWrite, idWith } = syncSetup();
    await sync(rows());
    const ids = SLOT.map(idWith);

    bulkWrite.mockClear();
    const [a, b, c, d] = rows();
    for (const order of [[d, c, b, a], [c, a, d, b], [b, d, a, c]]) {
      await sync(order);
      expect(bulkWrite).not.toHaveBeenCalled();
      expect(SLOT.map(idWith)).toEqual(ids);
    }
  });

  it('keeps the id of a row whose date list changed', async () => {
    const { stored, sync, idWith } = syncSetup();
    await sync(rows());
    const grown = idWith(SLOT[1]);
    const moved = idWith(SLOT[2]);

    // Listed before the row that grew: a greedy pick would take the shared-date doc.
    await sync([item(SLOT[0]), item(['2026-12-16']), item([...SLOT[1], '2026-12-02']), item(SLOT[3])]);
    expect(stored).toHaveLength(4);
    expect(idWith([...SLOT[1], '2026-12-02'])).toBe(grown); // a shared date
    expect(idWith(['2026-12-16'])).toBe(moved); // none left in common: the row that's left over
  });

  it('prefers the row of the same date over the row of the same teacher', async () => {
    const { sync, idWith } = syncSetup();
    await sync([item(['2026-10-14'], { teacherNames: ['Нечай'] }), item(['2026-10-28'], { teacherNames: ['Бех'] })]);
    const [first, second] = [idWith(['2026-10-14']), idWith(['2026-10-28'])];

    await sync([item(['2026-10-14'], { teacherNames: ['Бех'] }), item(['2026-10-28'], { teacherNames: [] })]);
    expect([idWith(['2026-10-14']), idWith(['2026-10-28'])]).toEqual([first, second]);
  });

  it('prefers the row sharing a date over the row of the same teacher', async () => {
    const { sync, idWith } = syncSetup();
    await sync([item(SLOT[1], { teacherNames: ['Нечай'] }), item(SLOT[3], { teacherNames: ['Бех'] })]);
    const ids = [idWith(SLOT[1]), idWith(SLOT[3])];

    const moved = [['2026-11-11'], ['2026-12-23']];
    await sync([item(moved[0], { teacherNames: ['Бех'] }), item(moved[1], { teacherNames: ['Нечай'] })]);
    expect(moved.map(idWith)).toEqual(ids);
  });

  it('prefers the doc of the exact dates over a doc sharing one of them', async () => {
    const [broad, narrow] = [['2026-11-11', '2026-11-25'], ['2026-11-11']];
    const { sync, idWith } = syncSetup();
    await sync([item(broad), item(narrow)]);
    const ids = [broad, narrow].map(idWith);

    for (const order of [[narrow, broad], [broad, narrow]]) {
      await sync(order.map((dates) => item(dates)));
      expect([broad, narrow].map(idWith)).toEqual(ids);
    }
  });

  it('prefers the same teacher over the same room', async () => {
    const { stored, sync } = syncSetup();
    await sync([item(SLOT[0], { teacherNames: ['Нечай'], room: '18-101' }), item(SLOT[0], { teacherNames: ['Бех'], room: '18-202' })]);
    const nechai = stored[0];

    await sync([item(SLOT[0], { teacherNames: ['Нечай'], room: '18-202' }), item(SLOT[0], { teacherNames: ['Бех'], room: '18-101' })]);
    expect(nechai).toEqual(expect.objectContaining({ teacherNames: ['Нечай'], room: '18-202' }));
  });

  // A one-pass pick lets the row listed first take the doc another row shares more with.
  it.each([
    ['as listed', (rows: CampusScheduleItem[]) => rows],
    ['reversed', (rows: CampusScheduleItem[]) => [...rows].reverse()],
  ])('follows a date moved to the next row, %s', async (_name, order) => {
    const { stored, sync, idWith } = syncSetup();
    await sync([item(SLOT[1]), item(SLOT[2])]);
    const ids = [idWith(SLOT[1]), idWith(SLOT[2])];

    const moved = [['2026-11-11'], ['2026-11-25', '2026-12-09']];
    await sync(order(moved.map((dates) => item(dates))));
    expect(stored).toHaveLength(2);
    expect(moved.map(idWith)).toEqual(ids);
  });

  it.each([
    ['as listed', (rows: CampusScheduleItem[]) => rows],
    ['reversed', (rows: CampusScheduleItem[]) => [...rows].reverse()],
  ])('leaves a split row with its bigger part, %s', async (_name, order) => {
    const whole = ['2026-09-14', '2026-09-28', '2026-10-12', '2026-10-26', '2026-11-09', '2026-11-23', '2026-12-07'];
    const { sync, idWith } = syncSetup();
    await sync([item(whole)]);
    const id = idWith(whole);

    await sync(order([item(whole.slice(0, 4)), item(whole.slice(4))]));
    expect(idWith(whole.slice(0, 4))).toBe(id);
  });

  it('keeps subgroups: rows of one date with different teachers', async () => {
    const lab = (name: string) => item(['2026-10-14'], { type: 'lab', teacherNames: [name] });
    const { stored, sync, bulkWrite } = syncSetup();
    await sync([lab('Козленко'), lab('Федотов')]);
    expect(stored).toHaveLength(2);

    bulkWrite.mockClear();
    await sync([lab('Федотов'), lab('Козленко')]);
    expect(bulkWrite).not.toHaveBeenCalled();
  });

  it('deletes a row Campus dropped and leaves the others alone', async () => {
    const { stored, sync, opKinds, idWith } = syncSetup();
    await sync(rows());
    const ids = SLOT.map(idWith);

    await sync(rows().slice(1));
    expect(opKinds()).toEqual(['deleteMany']);
    expect(stored.map((d) => String(d._id))).toEqual(ids.slice(1));
  });

  it('keeps what the app owns when Campus changes a row', async () => {
    const owned = {
      subjectId: new Types.ObjectId(),
      meetingUrl: 'https://meet.example/ons',
      isElective: true,
      electiveStudentIds: [new Types.ObjectId()],
    };
    const { stored, sync } = syncSetup([{ ...legacyDoc(), dates: SLOT[0], ...owned }]);
    await sync([item(SLOT[0], { teacherNames: ['Бех'], room: '18-101' })]);
    expect(stored[0]).toEqual(expect.objectContaining({ ...owned, teacherNames: ['Бех'], room: '18-101' }));

    await sync([item(SLOT[0], { teacherNames: ['Бех'] })]); // the other update: the room goes
    expect(stored[0]).toEqual(expect.objectContaining(owned));
  });

  it('clears the room when Campus clears it', async () => {
    const { stored, sync } = syncSetup();
    await sync([item(SLOT[0], { room: '18-101' })]);
    await sync([item(SLOT[0])]);
    expect(stored[0]).not.toHaveProperty('room');
  });

  it('gives a new row of an elective discipline its flag and students', async () => {
    const student = new Types.ObjectId();
    const { stored, sync } = syncSetup([{ ...legacyDoc(), dates: SLOT[0], isElective: true, electiveStudentIds: [student] }]);
    await sync([item(SLOT[0]), item(SLOT[1])]);
    expect(stored[1]).toEqual(expect.objectContaining({ dates: SLOT[1], isElective: true, electiveStudentIds: [student] }));
  });
});

describe('ScheduleService now', () => {
  beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date(2026, 9, 28, 10, 30, 0)); // Wednesday
  });
  afterAll(() => jest.useRealTimers());

  const G = String(new Types.ObjectId());
  const U = String(new Types.ObjectId());
  const lesson = (startTime: string, endTime: string, subjectName: string, dates?: string[]) => ({
    _id: new Types.ObjectId(),
    subjectName,
    teacherNames: [],
    type: 'lecture',
    dayOfWeek: 3,
    lessonNumber: 1,
    startTime,
    endTime,
    weekType: 1,
    isElective: false,
    electiveStudentIds: [],
    ...(dates && { dates }),
  });
  // Listed first on purpose: without the date check it would win the 10:25 slot.
  const LESSONS = [
    lesson('10:25', '12:00', 'Минула', ['2026-10-14']),
    lesson('10:25', '12:00', 'Сьогоднішня', ['2026-10-28']),
    lesson('12:20', '13:55', 'Майбутня', ['2026-11-11', '2026-11-25']),
    lesson('14:15', '15:50', 'Щотижнева'), // no field: a doc not re-synced yet
  ];

  const service = () =>
    new ScheduleService(
      { find: () => query(LESSONS) } as never,
      {} as never,
      { find: () => query([]) } as never,
      { findById: () => query({ _id: new Types.ObjectId(), campusLecturerId: 'L' }) } as never,
      { refreshWeekParity: async () => 1, getLecturerLessons: async () => LESSONS.map((l) => ({ ...l, groupCampusId: '5627' })) } as never,
    );

  it.each([
    ['nowFor', () => service().nowFor(G, U)],
    ['nowForGroup', () => service().nowForGroup(G)],
    ['lecturerNow', () => service().lecturerNow(U)],
  ])('%s only sees lessons that run today', async (_name, now) => {
    const { current, next } = (await now()) as unknown as { current: { subjectName: string }; next: { subjectName: string } };
    expect(current.subjectName).toBe('Сьогоднішня');
    expect(next.subjectName).toBe('Щотижнева');
  });

  it('finds nothing when the only lesson of the slot runs on other dates', async () => {
    const svc = new ScheduleService(
      { find: () => query([LESSONS[0], LESSONS[2]]) } as never,
      {} as never,
      { find: () => query([]) } as never,
      {} as never,
      { refreshWeekParity: async () => 1 } as never,
    );
    await expect(svc.nowFor(G, U)).resolves.toEqual({ current: null, next: null, weekType: 1 });
  });

  it('hands the week lists over unfiltered, with their dates', async () => {
    const list = await service().getForUser(G, U, 1);
    expect(list.map((l) => l.dates)).toEqual([['2026-10-14'], ['2026-10-28'], ['2026-11-11', '2026-11-25'], undefined]);
    expect((await service().getForGroup(G, 1)).map((l) => l.dates)).toEqual(list.map((l) => l.dates));
  });
});

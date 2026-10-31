import { Logger } from '@nestjs/common';
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
type Rec = { _id: Types.ObjectId; scheduleLessonId: Types.ObjectId; date: Date; entries: Array<{ status: string }> };
/** A stored lesson from before `dates`: the field isn't there at all. */
const legacyDoc = (over: Partial<CampusScheduleItem> = {}): Doc => {
  const { dates: _none, ...fields } = item([], over);
  return { _id: new Types.ObjectId(), ...fields, isElective: false, electiveStudentIds: [] };
};

function syncSetup(stored: Doc[] = [], marks: Rec[] = []) {
  let campus: CampusScheduleItem[] = [];
  const bulkWrite = jest.fn(async (ops: Array<Record<string, any>>) => {
    for (const { updateOne, insertOne } of ops) {
      if (insertOne) stored.push({ _id: new Types.ObjectId(), ...insertOne.document });
      if (updateOne) {
        const doc = stored.find((d) => d._id === updateOne.filter._id)!;
        Object.assign(doc, updateOne.update.$set);
        for (const k of Object.keys(updateOne.update.$unset ?? {})) delete doc[k];
      }
    }
  });
  const deleteMany = jest.fn(async ({ _id }: { _id: { $in: Types.ObjectId[] } }) => {
    stored.splice(0, stored.length, ...stored.filter((d) => !_id.$in.includes(d._id)));
  });
  const records = {
    find: ({ scheduleLessonId }: { scheduleLessonId: { $in: Types.ObjectId[] } }) =>
      query(marks.filter((r) => scheduleLessonId.$in.includes(r.scheduleLessonId)).map((r) => ({ ...r }))),
    updateOne: jest.fn(async (filter: Pick<Rec, '_id' | 'scheduleLessonId'>, update: { $set: Pick<Rec, 'scheduleLessonId'> }) => {
      const r = marks.find((m) => m._id === filter._id && m.scheduleLessonId === filter.scheduleLessonId);
      if (r) Object.assign(r, update.$set);
      return { matchedCount: r ? 1 : 0 };
    }),
  };
  const groups = { updateOne: jest.fn(() => query(undefined)) };
  const svc = new ScheduleService(
    { find: () => query(stored.map((d) => ({ ...d }))), bulkWrite, deleteMany } as never,
    groups as never,
    {} as never,
    {} as never,
    { fetchGroupSchedule: async () => campus } as never,
    records as never,
  );
  const sync = (items: CampusScheduleItem[]) => {
    campus = items;
    return svc.syncGroupSchedule({ _id: new Types.ObjectId(), campusGroupId: '5627' });
  };
  const idWith = (dates: string[]) => String(stored.find((d) => String(d.dates) === String(dates))?._id);
  /** Every op of the last sync, by kind. */
  const opKinds = () => bulkWrite.mock.lastCall![0].map((op) => Object.keys(op)[0]);
  return { stored, bulkWrite, deleteMany, records, groups, sync, idWith, opKinds };
}

describe('ScheduleService sync with dates', () => {
  const rows = () => SLOT.map((dates) => item(dates));

  it('stores the dates of a new lesson', async () => {
    const { stored, sync } = syncSetup();
    await sync(rows());
    expect(stored.map((d) => d.dates)).toEqual(SLOT);
  });

  it('gives legacy docs their dates in place on the first dated sync', async () => {
    const { stored, sync, bulkWrite, deleteMany, opKinds } = syncSetup(SLOT.map(() => legacyDoc()));
    const ids = stored.map((d) => d._id);
    await sync(rows());
    expect(opKinds()).toEqual(['updateOne', 'updateOne', 'updateOne', 'updateOne']); // no deletes, no inserts
    expect(deleteMany).not.toHaveBeenCalled();
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
    const { stored, sync, bulkWrite, deleteMany, idWith } = syncSetup();
    await sync(rows());
    const ids = SLOT.map(idWith);

    bulkWrite.mockClear();
    await sync(rows().slice(1));
    expect(bulkWrite).not.toHaveBeenCalled();
    expect(deleteMany).toHaveBeenCalledTimes(1);
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

describe('ScheduleService sync moves marks', () => {
  const [OLD, NEW] = ['2026-10-14', '2026-10-28'];
  const row = (dates: string[], over: Partial<CampusScheduleItem> = {}): Doc => ({ ...legacyDoc(over), dates });
  const record = (l: Doc, day: string, statuses = ['absent']): Rec => ({
    _id: new Types.ObjectId(),
    scheduleLessonId: l._id,
    date: new Date(day),
    entries: statuses.map((status) => ({ status })),
  });
  /** Campus rows that leave `docs` as they are. */
  const same = (docs: Doc[]) => docs.map((d) => ({ ...d }) as unknown as CampusScheduleItem);

  let log: jest.SpyInstance;
  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => log.mockRestore());

  it('moves a mark to the row that ran that day, on a sync that changed no rows', async () => {
    const [ghost, ran] = [row([OLD]), row([NEW])];
    const r = record(ghost, NEW);
    const { sync, bulkWrite } = syncSetup([ghost, ran], [r]);
    await sync(same([ghost, ran]));
    expect(bulkWrite).not.toHaveBeenCalled();
    expect(r.scheduleLessonId).toBe(ran._id);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Moved 1 attendance record(s)'));
  });

  it('sorts out the marks of legacy rows on the first dated sync', async () => {
    const legacy = SLOT.map(() => legacyDoc());
    // The old mark page picked the first row, so the marks of the whole slot piled up there.
    const days = [SLOT[0][0], SLOT[1][1], SLOT[3][2]];
    const marks = days.map((day) => record(legacy[0], day));
    const { sync, idWith } = syncSetup(legacy, marks);
    await sync(SLOT.map((dates) => item(dates)));
    expect(marks.map((r) => String(r.scheduleLessonId))).toEqual([idWith(SLOT[0]), idWith(SLOT[1]), idWith(SLOT[3])]);
  });

  it('gives a new row the marks of its day', async () => {
    const ghost = row([OLD]);
    const r = record(ghost, NEW);
    const { sync, idWith } = syncSetup([ghost], [r]);
    await sync([item([OLD]), item([NEW])]);
    expect(String(r.scheduleLessonId)).toBe(idWith([NEW]));
  });

  it('follows a date Campus moved to another row', async () => {
    const [first, second] = [row([OLD, NEW]), row(['2026-11-11'])];
    const r = record(first, NEW);
    const { sync } = syncSetup([first, second], [r]);
    await sync([item([OLD]), item([NEW, '2026-11-11'])]);
    expect(r.scheduleLessonId).toBe(second._id);
  });

  it('sends two marks of one row to different rows', async () => {
    const [ghost, a, b] = [row(['2026-09-30']), row([OLD]), row([NEW])];
    const [toA, toB] = [record(ghost, OLD), record(ghost, NEW)];
    const { sync } = syncSetup([ghost, a, b], [toA, toB]);
    await sync(same([ghost, a, b]));
    expect([toA.scheduleLessonId, toB.scheduleLessonId]).toEqual([a._id, b._id]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Moved 2 attendance record(s)'));
  });

  it('prefers the row of the same teachers', async () => {
    const lab = (dates: string[], name: string) => row(dates, { type: 'lab', teacherNames: [name] });
    const [ghost, other, own] = [lab([OLD], 'Козленко'), lab([NEW], 'Федотов'), lab([NEW], 'Козленко')];
    const r = record(ghost, NEW);
    const { sync } = syncSetup([ghost, other, own], [r]);
    await sync(same([ghost, other, own]));
    expect(r.scheduleLessonId).toBe(own._id);
  });

  it('takes another free row when the one of the same teachers is taken', async () => {
    const lab = (dates: string[], name: string) => row(dates, { type: 'lab', teacherNames: [name] });
    const [ghost, other, own] = [lab([OLD], 'Козленко'), lab([NEW], 'Федотов'), lab([NEW], 'Козленко')];
    const r = record(ghost, NEW);
    const { sync } = syncSetup([ghost, other, own], [r, record(own, NEW, [])]);
    await sync(same([ghost, other, own]));
    expect(r.scheduleLessonId).toBe(other._id);
  });

  it.each([
    ['real marks', ['present']],
    ['no entries', []],
    ['only unknown', ['unknown']],
  ])('leaves a mark alone when the row that ran already has a record with %s', async (_name, statuses) => {
    const [ghost, ran] = [row([OLD]), row([NEW])];
    const r = record(ghost, NEW);
    const { sync, records } = syncSetup([ghost, ran], [r, record(ran, NEW, statuses)]);
    await sync(same([ghost, ran]));
    expect(records.updateOne).not.toHaveBeenCalled();
    expect(r.scheduleLessonId).toBe(ghost._id);
  });

  it('counts a planned move: never two records on one row and day', async () => {
    const [a, b, ran] = [row(['2026-09-30']), row([OLD]), row([NEW])];
    const [first, second] = [record(a, NEW), record(b, NEW)];
    const { sync } = syncSetup([a, b, ran], [first, second]);
    await sync(same([a, b, ran]));
    expect([first.scheduleLessonId, second.scheduleLessonId]).toEqual([ran._id, b._id]);
  });

  it.each([
    ['no entries', []],
    ['only unknown', ['unknown', 'unknown']],
  ])('leaves a record with %s: it holds no marks', async (_name, statuses) => {
    const [ghost, ran] = [row([OLD]), row([NEW])];
    const { sync, records } = syncSetup([ghost, ran], [record(ghost, NEW, statuses)]);
    await sync(same([ghost, ran]));
    expect(records.updateOne).not.toHaveBeenCalled();
  });

  it('moves a record with one real mark among unknown ones', async () => {
    const [ghost, ran] = [row([OLD]), row([NEW])];
    const r = record(ghost, NEW, ['unknown', 'late']);
    const { sync } = syncSetup([ghost, ran], [r]);
    await sync(same([ghost, ran]));
    expect(r.scheduleLessonId).toBe(ran._id);
  });

  it('leaves a mark on a row that ran that day', async () => {
    const [ran, twin] = [row([NEW]), row([NEW], { teacherNames: ['Бех'] })];
    const { sync, records } = syncSetup([ran, twin], [record(ran, NEW)]);
    await sync(same([ran, twin]));
    expect(records.updateOne).not.toHaveBeenCalled();
  });

  it.each<[string, Partial<CampusScheduleItem>]>([
    ['day', { dayOfWeek: 4 }],
    ['lesson number', { lessonNumber: 5 }],
    ['parity', { weekType: 2 }],
    ['type', { type: 'lab' }],
    ['subject', { subjectName: 'Фізика' }],
  ])('stays inside the slot: another %s is another lesson', async (_name, over) => {
    const [ghost, other] = [row([OLD]), row([NEW], over)];
    const { sync, records } = syncSetup([ghost, other], [record(ghost, NEW)]);
    await sync(same([ghost, other]));
    expect(records.updateOne).not.toHaveBeenCalled();
  });

  it('moves the marks of a merged row to the row that now holds the date, then deletes it', async () => {
    const [kept, merged] = [row([OLD]), row([NEW])];
    const r = record(merged, NEW);
    const { stored, sync, records, deleteMany } = syncSetup([kept, merged], [r]);
    await sync([item([OLD, NEW])]);
    expect(r.scheduleLessonId).toBe(kept._id);
    expect(stored).toEqual([expect.objectContaining({ _id: kept._id, dates: [OLD, NEW] })]);
    expect(records.updateOne.mock.invocationCallOrder[0]).toBeLessThan(deleteMany.mock.invocationCallOrder[0]);
  });

  it('finds the slot by its normalised name: a leftover spelt another way still gives', async () => {
    const [kept, gone] = [row([OLD]), row([NEW], { subjectName: `«${ONS}»` })];
    const r = record(gone, NEW);
    const { sync } = syncSetup([kept, gone], [r]);
    await sync([item([OLD, NEW])]);
    expect(r.scheduleLessonId).toBe(kept._id);
  });

  it('never moves a mark onto a row about to be deleted', async () => {
    const [ghost, gone] = [row([OLD]), row([NEW])];
    const { sync, records } = syncSetup([ghost, gone], [record(ghost, NEW)]);
    await sync(same([ghost]));
    expect(records.updateOne).not.toHaveBeenCalled();
  });

  it('leaves the record of a dropped row with no sibling, and deletes the row', async () => {
    const [gone, other] = [row([NEW], { subjectName: 'Фізика' }), row([OLD])];
    const r = record(gone, NEW);
    const { stored, sync, records } = syncSetup([gone, other], [r]);
    await sync([item([OLD])]);
    expect(records.updateOne).not.toHaveBeenCalled();
    expect(r.scheduleLessonId).toBe(gone._id);
    expect(stored.map((d) => d._id)).toEqual([other._id]);
  });

  it('never gives from a row without dates, nor takes for one', async () => {
    const [undated, ran] = [row([]), row([NEW])];
    const [ghost, sibling] = [row([OLD], { lessonNumber: 5 }), row([], { lessonNumber: 5 })];
    const { sync, records } = syncSetup(
      [undated, ran, ghost, sibling],
      [record(undated, NEW), record(ghost, NEW)],
    );
    await sync(same([undated, ran, ghost, sibling]));
    expect(records.updateOne).not.toHaveBeenCalled();
  });

  it('does take the marks of a dropped row without dates', async () => {
    const [kept, gone] = [legacyDoc(), legacyDoc()];
    const r = record(gone, NEW);
    const { stored, sync } = syncSetup([kept, gone], [r]);
    await sync([item([NEW])]);
    expect(r.scheduleLessonId).toBe(kept._id);
    expect(stored).toHaveLength(1);
  });

  it('gives the marks of a dropped row to a free row without dates', async () => {
    const [weekly, oneOff] = [row([]), row([NEW])];
    const r = record(oneOff, NEW);
    const { stored, sync } = syncSetup([weekly, oneOff], [r]);
    await sync([item([])]);
    expect(r.scheduleLessonId).toBe(weekly._id);
    expect(stored.map((d) => d._id)).toEqual([weekly._id]);
  });

  it('moves nothing on the next sync', async () => {
    const [ghost, ran] = [row([OLD]), row([NEW])];
    const { sync, records } = syncSetup([ghost, ran], [record(ghost, NEW)]);
    await sync(same([ghost, ran]));
    log.mockClear();
    await sync(same([ghost, ran]));
    expect(records.updateOne).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });

  it('heals by itself once a row of that day appears', async () => {
    const [ghost, other] = [row([OLD]), row(['2026-11-11'])];
    const r = record(ghost, NEW);
    const { sync } = syncSetup([ghost, other], [r]);
    await sync(same([ghost, other]));
    expect(r.scheduleLessonId).toBe(ghost._id);

    await sync([item([OLD]), item(['2026-11-11', NEW])]);
    expect(r.scheduleLessonId).toBe(other._id);
  });

  it('skips a row that got a record meanwhile and moves the rest', async () => {
    const [ghost, a, b] = [row(['2026-09-30']), row([OLD]), row([NEW])];
    const [lost, won] = [record(ghost, OLD), record(ghost, NEW)];
    const { sync, records } = syncSetup([ghost, a, b], [lost, won]);
    records.updateOne.mockRejectedValueOnce(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));
    await expect(sync(same([ghost, a, b]))).resolves.toBe(3);
    expect([lost.scheduleLessonId, won.scheduleLessonId]).toEqual([ghost._id, b._id]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Moved 1 attendance record(s)'));
  });

  it('does not count a record that went away meanwhile', async () => {
    const [ghost, ran] = [row([OLD]), row([NEW])];
    const { sync, records } = syncSetup([ghost, ran], [record(ghost, NEW)]);
    records.updateOne.mockResolvedValueOnce({ matchedCount: 0 });
    await sync(same([ghost, ran]));
    expect(log).not.toHaveBeenCalled();
  });

  it('filters the move on the row it read, for a head marking at the same moment', async () => {
    const [ghost, ran] = [row([OLD]), row([NEW])];
    const r = record(ghost, NEW);
    const { sync, records } = syncSetup([ghost, ran], [r]);
    await sync(same([ghost, ran]));
    expect(records.updateOne).toHaveBeenCalledWith(
      { _id: r._id, scheduleLessonId: ghost._id },
      { $set: { scheduleLessonId: ran._id } },
    );
  });

  it('keeps the leftover row when the move fails, and the next sync retries', async () => {
    const [kept, merged] = [row([OLD]), row([NEW])];
    const r = record(merged, NEW);
    const { stored, sync, records, deleteMany, groups } = syncSetup([kept, merged], [r]);
    records.updateOne.mockRejectedValueOnce(new Error('connection lost'));
    await expect(sync([item([OLD, NEW])])).rejects.toThrow('connection lost');
    expect(stored).toHaveLength(2);
    expect(deleteMany).not.toHaveBeenCalled();
    expect(groups.updateOne).not.toHaveBeenCalled();

    await sync([item([OLD, NEW])]);
    expect(r.scheduleLessonId).toBe(kept._id);
    expect(stored.map((d) => d._id)).toEqual([kept._id]);
    expect(groups.updateOne).toHaveBeenCalledTimes(1);
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

  const service = (lessons = LESSONS) =>
    new ScheduleService(
      { find: () => query(lessons) } as never,
      {} as never,
      { find: () => query([]) } as never,
      { findById: () => query({ _id: new Types.ObjectId(), campusLecturerId: 'L' }) } as never,
      { refreshWeekParity: async () => 1, getLecturerLessons: async () => lessons.map((l) => ({ ...l, groupCampusId: '5627' })) } as never,
      {} as never,
    );

  const NOWS: Array<[string, (s: ScheduleService) => Promise<unknown>]> = [
    ['nowFor', (s) => s.nowFor(G, U)],
    ['nowForGroup', (s) => s.nowForGroup(G)],
    ['lecturerNow', (s) => s.lecturerNow(U)],
  ];

  it.each(NOWS)('%s only sees lessons that run today', async (_name, now) => {
    const { current, next } = (await now(service())) as { current: { subjectName: string }; next: { subjectName: string } };
    expect(current.subjectName).toBe('Сьогоднішня');
    expect(next.subjectName).toBe('Щотижнева');
  });

  it.each(NOWS)('%s lists every lesson in progress, the first as current', async (_name, now) => {
    const { running, current, next } = (await now(
      service([
        lesson('09:00', '10:30', 'Щойно скінчилась'),
        lesson('10:25', '12:00', 'Перша підгрупа', ['2026-10-28']),
        lesson('10:25', '12:00', 'Інша дата', ['2026-10-14']),
        lesson('10:30', '12:05', 'Щойно почалась'),
        lesson('12:20', '13:55', 'Пізніша'),
        lesson('10:31', '12:05', 'Найближча'),
      ]),
    )) as { running: Array<{ subjectName: string }>; current: unknown; next: { subjectName: string } };
    expect(running.map((l) => l.subjectName)).toEqual(['Перша підгрупа', 'Щойно почалась']);
    expect(current).toBe(running[0]);
    expect(next.subjectName).toBe('Найближча');
  });

  it('finds nothing when the only lesson of the slot runs on other dates', async () => {
    const svc = new ScheduleService(
      { find: () => query([LESSONS[0], LESSONS[2]]) } as never,
      {} as never,
      { find: () => query([]) } as never,
      {} as never,
      { refreshWeekParity: async () => 1 } as never,
      {} as never,
    );
    await expect(svc.nowFor(G, U)).resolves.toEqual({ running: [], current: null, next: null, weekType: 1 });
  });

  it('hands the week lists over unfiltered, with their dates', async () => {
    const list = await service().getForUser(G, U, 1);
    expect(list.map((l) => l.dates)).toEqual([['2026-10-14'], ['2026-10-28'], ['2026-11-11', '2026-11-25'], undefined]);
    expect((await service().getForGroup(G, 1)).map((l) => l.dates)).toEqual(list.map((l) => l.dates));
  });

  it('reads the current lesson link from its subject, else takes its own', async () => {
    const zoom = { label: 'Zoom', url: 'https://zoom.us/j/1', showInLessonReminder: true, lessonReminderType: 'lecture' };
    const svc = new ScheduleService({} as never, {} as never, { findById: () => query({ links: [zoom] }) } as never, {} as never, {} as never, {} as never);
    const own = { type: 'lecture', meetingUrl: 'meet.google.com/abc' };
    await expect(svc.lessonLink({ subjectId: 's', ...own })).resolves.toEqual({ label: 'Zoom', url: zoom.url });
    await expect(svc.lessonLink(own)).resolves.toEqual({ label: 'Зустріч', url: 'https://meet.google.com/abc' });
    await expect(svc.lessonLink(null)).resolves.toBeUndefined();
  });
});

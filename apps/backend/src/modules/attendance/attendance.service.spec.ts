import { Types } from 'mongoose';
import { AttendanceService } from './attendance.service';

/** Mongoose query stand-in: supports .lean().exec() and .exec(). */
const query = <T>(value: T) => {
  const q = { lean: () => q, exec: async () => value };
  return q;
};

const G = String(new Types.ObjectId());
const lesson = (subjectName: string, dates?: string[]) => ({
  _id: new Types.ObjectId(),
  subjectName,
  type: 'lecture',
  dayOfWeek: 3, // Wednesday
  lessonNumber: 2,
  startTime: '10:25',
  endTime: '12:00',
  weekType: 1,
  ...(dates && { dates }),
});
const record = (l: { _id: Types.ObjectId }, day: string, statuses = ['absent']) => ({
  scheduleLessonId: l._id,
  date: new Date(day),
  entries: statuses.map((status) => ({ userId: new Types.ObjectId(), status })),
});

function grid(lessons: Array<ReturnType<typeof lesson>>, records: Array<ReturnType<typeof record>> = []) {
  const svc = new AttendanceService(
    {
      // Honours the week range: that's how the service narrows records.
      find: ({ date }: { date: { $gte: Date; $lt: Date } }) =>
        query(records.filter((r) => r.date >= date.$gte && r.date < date.$lt)),
      aggregate: async () => [],
    } as never,
    { find: () => ({ sort: () => query(lessons) }) } as never,
    { find: () => query([]) } as never,
    {} as never,
    { listGroupMembersForUi: async () => [] } as never,
    { currentWeekParity: () => 1 } as never,
    { listForGroup: async () => [] } as never,
  );
  return async (week: string) => {
    const res = await svc.weekGrid(G, new Date(week));
    return { names: res.lessons.map((l) => l.subjectName), res };
  };
}

describe('AttendanceService.weekGrid', () => {
  it('shows a date-limited lesson only in the week of its date', async () => {
    const week = grid([
      lesson('14 жовтня', ['2026-10-14']),
      lesson('28 жовтня', ['2026-10-28']),
      lesson('Щотижнева'), // no field: a doc not re-synced yet
      lesson('Щотижнева, синхронізована', []),
    ]);
    expect((await week('2026-10-12')).names).toEqual(['14 жовтня', 'Щотижнева', 'Щотижнева, синхронізована']);
    expect((await week('2026-10-26')).names).toEqual(['28 жовтня', 'Щотижнева', 'Щотижнева, синхронізована']);
    expect((await week('2026-12-07')).names).toEqual(['Щотижнева', 'Щотижнева, синхронізована']);
  });

  it('keeps a lesson that already has marks on its day, whatever its dates say', async () => {
    const marked = lesson('З відмітками', ['2026-12-09']);
    const week = grid([marked], [record(marked, '2026-10-28')]);

    const { names, res } = await week('2026-10-26');
    expect(names).toEqual(['З відмітками']);
    expect(res.lessons[0].date).toBe('2026-10-28T00:00:00.000Z');
    expect(res.marks.map((m) => m.lessonId)).toEqual([String(marked._id)]);

    expect((await week('2026-10-12')).names).toEqual([]); // the mark keeps it in its own week only
  });

  it("doesn't let another lesson's mark keep a lesson", async () => {
    const shown = lesson('Сьогоднішня', ['2026-10-28']);
    const hidden = lesson('Інша', ['2026-10-14']);
    const week = grid([shown, hidden], [record(shown, '2026-10-28')]);
    expect((await week('2026-10-26')).names).toEqual(['Сьогоднішня']);
  });

  it.each([
    ['the mark screen saved nothing', []],
    ['the journal set it to unknown', ['unknown']],
  ])("doesn't keep a lesson once its marks are cleared: %s", async (_name, statuses) => {
    const cleared = lesson('Очищена', ['2026-12-09']);
    const week = grid([cleared], [record(cleared, '2026-10-28', statuses)]);
    expect((await week('2026-10-26')).names).toEqual([]);
  });

  it('keeps a lesson while one entry is a real mark', async () => {
    const marked = lesson('З відмітками', ['2026-12-09']);
    const week = grid([marked], [record(marked, '2026-10-28', ['unknown', 'late'])]);
    expect((await week('2026-10-26')).names).toEqual(['З відмітками']);
  });

  it('keeps a lesson for a mark filed on another day of its week', async () => {
    const marked = lesson('Запис на день раніше', ['2026-12-09']);
    const week = grid([marked], [record(marked, '2026-10-27')]);
    expect((await week('2026-10-26')).names).toEqual(['Запис на день раніше']);
  });

  it('still counts a mark on a lesson it no longer lists', async () => {
    const gone = lesson('Видалена з Кампусу');
    const { names, res } = await grid([lesson('Щотижнева')], [record(gone, '2026-10-28')])('2026-10-26');
    expect(names).toEqual(['Щотижнева']);
    expect(res.marks.map((m) => m.lessonId)).toEqual([String(gone._id)]);
    expect(Object.values(res.perStudentWeek)).toEqual([{ absent: 1, excused: 0, late: 0 }]);
  });
});

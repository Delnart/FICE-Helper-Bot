import { Types } from 'mongoose';
import { SchedulerService } from './scheduler.service';

/** Mongoose query stand-in: supports .lean().exec() and .exec(). */
const query = <T>(value: T) => {
  const q = { lean: () => q, exec: async () => value };
  return q;
};

/** One group with three lessons at 10:25 and one at 12:20; `claimed` = subjects another tick already announced. */
function setup(claimed: string[] = []) {
  const G = new Types.ObjectId();
  const at = (startTime: string, subjectName: string) => ({
    _id: new Types.ObjectId(),
    groupId: G,
    subjectName,
    type: 'lab',
    teacherNames: [],
    startTime,
    endTime: '12:00',
    weekType: 0,
  });
  const lessons = [at('10:25', 'ОС'), at('10:25', 'Бази даних'), at('10:25', 'Фізика'), at('12:20', 'Пізніше')];
  const nameById = new Map(lessons.map((l) => [String(l._id), l.subjectName]));
  const broadcastLessonReminders = jest.fn(async (_g: string, _m: number, _l: Array<{ subjectName: string }>) => undefined);
  const svc = new SchedulerService(
    { broadcastLessonReminders } as never,
    { find: () => query(lessons) } as never,
    {} as never,
    {} as never,
    {} as never,
    { find: () => query([{ _id: G, lessonReminderMinutes: 10 }]) } as never,
    {} as never,
    { find: () => query([]) } as never,
    {
      updateOne: (filter: { lessonId: Types.ObjectId }) =>
        query({ upsertedCount: claimed.includes(nameById.get(String(filter.lessonId))!) ? 0 : 1, upsertedId: null }),
    } as never,
    { refreshWeekParity: async () => 1 } as never,
  );
  return { svc, G, broadcastLessonReminders };
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
    expect(list.map((l) => l.subjectName).sort()).toEqual(['Бази даних', 'ОС', 'Фізика'].sort());
  });

  it('leaves out lessons another tick already announced', async () => {
    const { svc, broadcastLessonReminders } = setup(['ОС']);
    await svc.tickLessonReminders();
    expect(broadcastLessonReminders.mock.calls[0][2].map((l) => l.subjectName).sort()).toEqual(['Бази даних', 'Фізика'].sort());
  });

  it('sends nothing when every due lesson was already announced', async () => {
    const { svc, broadcastLessonReminders } = setup(['ОС', 'Бази даних', 'Фізика']);
    await svc.tickLessonReminders();
    expect(broadcastLessonReminders).not.toHaveBeenCalled();
  });
});

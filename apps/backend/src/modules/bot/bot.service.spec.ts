import { BotService } from './bot.service';

const lesson = (subjectName: string, dayOfWeek: number, dates?: string[]) => ({
  subjectName,
  dayOfWeek,
  lessonNumber: 1,
  startTime: '10:25',
  endTime: '12:00',
  ...(dates && { dates }),
});
// 2026-09-30 is a Wednesday, the last day of the month.
const LESSONS = [
  lesson('Цієї середи', 3, ['2026-09-30']),
  lesson('Іншої середи', 3, ['2026-10-14']),
  lesson('Цього четверга', 4, ['2026-10-01']),
  lesson('Іншого четверга', 4, ['2026-10-15']),
  lesson('Щочетверга', 4),
];

function ask(chatType: 'private' | 'supergroup', kind: 'today' | 'tomorrow') {
  const reply = jest.fn(async (_text: string) => undefined);
  const svc = new BotService(
    {} as never,
    { findByChat: async () => ({ _id: 'g', academicName: 'ІП-55' }), findById: async () => ({ academicName: 'ІП-55' }) } as never,
    { findByTelegramId: async () => ({ _id: 'u', memberships: [{ groupId: 'g' }] }) } as never,
    { refreshWeekParity: async () => 1 } as never,
    {} as never,
    { getForGroup: async () => LESSONS, getForUser: async () => LESSONS } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return svc['handleDaySchedule']({ chat: { id: 1, type: chatType }, from: { id: 2 }, reply } as never, kind).then(
    () => reply.mock.calls[0][0],
  );
}

describe('BotService /today and /tomorrow', () => {
  beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date(2026, 8, 30, 9, 0, 0));
  });
  afterAll(() => jest.useRealTimers());

  it.each(['private', 'supergroup'] as const)('%s: /today lists what runs today', async (chat) => {
    const text = await ask(chat, 'today');
    expect(text).toContain('Цієї середи');
    expect(text).not.toContain('Іншої середи');
  });

  it.each(['private', 'supergroup'] as const)('%s: /tomorrow checks the next calendar day across a month end', async (chat) => {
    const text = await ask(chat, 'tomorrow');
    expect(text).toContain('Цього четверга');
    expect(text).toContain('Щочетверга');
    expect(text).not.toContain('Іншого четверга');
  });
});

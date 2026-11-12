import { GrammyError } from 'grammy';
import { BotService } from './bot.service';
import { renderCard } from './cards/render';
import { pickLessonLink, Subject } from '../subjects/subject.schema';

// Drawing a card starts a node process; cards.spec.ts covers the drawing itself.
jest.mock('./cards/render', () => ({ renderCard: jest.fn(async () => Buffer.from('png')) }));

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

function ask(chatType: 'private' | 'supergroup', kind: 'today' | 'tomorrow', lessons: unknown[] = LESSONS) {
  const reply = jest.fn(async (_text: string) => undefined);
  const svc = new BotService(
    {} as never,
    { findByChat: async () => ({ _id: 'g', academicName: 'ІП-55' }), findById: async () => ({ academicName: 'ІП-55' }) } as never,
    { findByTelegramId: async () => ({ _id: 'u', memberships: [{ groupId: 'g' }] }) } as never,
    { refreshWeekParity: async () => 1 } as never,
    {} as never,
    { getForGroup: async () => lessons, getForUser: async () => lessons } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  // No bot in these tests: what a card would fall back to is the text under test.
  svc.sendCard = async (_chatId, _card, text) => void (await reply(text));
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

  it.each(['private', 'supergroup'] as const)('%s: /today shows no link, even for a lesson with its own', async (chat) => {
    const text = await ask(chat, 'today', [{ ...LESSONS[0], meetingUrl: 'https://meet.example/"x' }]);
    expect(text).toContain('Цієї середи');
    expect(text).not.toContain('🔗');
    expect(text).not.toContain('href');
  });
});

const ZOOM = { label: 'Zoom <лекції>', url: 'https://zoom.us/j/1?pwd=a&b=c', showInLessonReminder: true, lessonReminderType: 'lecture' };

const ONS = { subjectId: 's', subjectName: 'ОНС', type: 'lecture', startTime: '10:25', endTime: '12:00', room: '18-101' };
const NEXT = { subjectId: 's', subjectName: 'БД', type: 'lecture', startTime: '12:20', endTime: '13:55' };

function now(
  chatType: 'private' | 'supergroup',
  links: unknown[],
  kind: 'now' | 'left' = 'now',
  running: unknown[] = [ONS],
  next: unknown = NEXT,
) {
  const reply = jest.fn(async (_text: string) => undefined);
  const result = { running, current: running[0] ?? null, next, weekType: 1 };
  const svc = new BotService(
    {} as never,
    { findByChat: async () => ({ _id: 'g', academicName: 'ІП-55' }), findById: async () => ({ academicName: 'ІП-55' }) } as never,
    { findByTelegramId: async () => ({ _id: 'u', memberships: [{ groupId: 'g' }] }) } as never,
    {} as never,
    {} as never,
    {
      nowFor: async () => result,
      nowForGroup: async () => result,
      lessonLink: async (l: { type?: string }) => {
        if (l.type === 'broken') throw new Error('Mongo is down');
        return pickLessonLink({ links } as Pick<Subject, 'links'>, l);
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  // No bot in these tests: what a card would fall back to is the text under test.
  svc.sendCard = async (_chatId, _card, text) => void (await reply(text));
  return svc['handleNowOrLeft']({ chat: { id: 1, type: chatType }, from: { id: 2 }, reply } as never, kind).then(
    () => reply.mock.calls[0][0],
  );
}

describe('BotService /now', () => {
  it.each(['private', 'supergroup'] as const)('%s: links the current lesson, escaped for HTML', async (chat) => {
    const text = await now(chat, [ZOOM]);
    expect(text).toContain('🔗 <a href="https://zoom.us/j/1?pwd=a&amp;b=c">Zoom &lt;лекції&gt;</a>');
    expect(text.indexOf('🔗')).toBeLessThan(text.indexOf('Наступна'));
    expect(text.match(/🔗/g)).toHaveLength(1);
  });

  it.each([
    ['of another lesson type', { ...ZOOM, lessonReminderType: 'lab' }],
    ['not flagged for reminders', { ...ZOOM, showInLessonReminder: false }],
    ['with a broken url', { ...ZOOM, url: 'javascript:alert(1)' }],
  ])('skips a link %s', async (_name, link) => {
    expect(await now('private', [link])).not.toContain('🔗');
  });

  it('/left stays without a link', async () => {
    expect(await now('private', [ZOOM], 'left')).not.toContain('🔗');
  });

  const CHATS = ['private', 'supergroup'] as const;
  const LAB = { ...ONS, subjectName: 'БД <лаб>', type: 'lab', room: '18-202' };
  const MEET = { ...ZOOM, label: 'Meet', url: 'https://meet.google.com/abc', lessonReminderType: 'lab' };

  it.each(CHATS)('%s: a failed link lookup costs only that link', async (chat) => {
    const text = await now(chat, [ZOOM], 'now', [ONS, { ...LAB, type: 'broken' }]);
    expect(text).toContain('<b>Зараз:</b> БД &lt;лаб&gt;');
    expect(text.match(/🔗/g)).toHaveLength(1);
    expect(text).toContain('Наступна');
  });

  it.each(CHATS)('%s: shows every lesson in progress with its own link, the next one after them', async (chat) => {
    const text = await now(chat, [ZOOM, MEET], 'now', [ONS, LAB]);
    expect(text.split('\n')).toEqual([
      '<b>ІП-55</b> · I тиждень',
      '🟢 <b>Зараз:</b> ОНС',
      '    10:25 — 12:00 · 18-101',
      '    🔗 <a href="https://zoom.us/j/1?pwd=a&amp;b=c">Zoom &lt;лекції&gt;</a>',
      '🟢 <b>Зараз:</b> БД &lt;лаб&gt;',
      '    10:25 — 12:00 · 18-202',
      '    🔗 <a href="https://meet.google.com/abc">Meet</a>',
      '⏳ <b>Наступна:</b> БД',
      '    12:20 — 13:55',
    ]);
  });

  it.each(CHATS)('%s: a lesson with no link still gets its block', async (chat) => {
    const text = await now(chat, [MEET], 'now', [ONS, LAB]);
    expect(text.match(/🟢/g)).toHaveLength(2);
    expect(text.match(/🔗/g)).toHaveLength(1);
    expect(text).toContain('Meet');
  });

  it.each(CHATS)('%s: identical rows collapse to one block', async (chat) => {
    const text = await now(chat, [ZOOM], 'now', [ONS, { ...ONS, teacherNames: ['Інший'] }]);
    expect(text.match(/🟢/g)).toHaveLength(1);
    expect(text.match(/🔗/g)).toHaveLength(1);
  });

  it('rows of one subject in different rooms stay two blocks', async () => {
    const text = await now('private', [ZOOM], 'now', [ONS, { ...ONS, room: '18-303' }]);
    expect(text.match(/🟢/g)).toHaveLength(2);
  });

  it.each(CHATS)('%s: says the day is over only with nothing running and nothing next', async (chat) => {
    expect(await now(chat, [], 'now', [], null)).toContain('Сьогодні пар більше немає');
    expect(await now(chat, [], 'now', [ONS], null)).not.toContain('Сьогодні пар більше немає');
    const onlyNext = await now(chat, [], 'now', []);
    expect(onlyNext).toContain('Наступна');
    expect(onlyNext).not.toContain('Зараз');
    expect(onlyNext).not.toContain('Сьогодні пар більше немає');
  });

  it.each([
    ['"https://zoom.us/j/1"', 'https://&quot;https//zoom.us/j/1%22'],
    ['https://zo"om.us/j/1', 'https://zo&quot;om.us/j/1'],
    ["https://zo'om.us/j/1", 'https://zo&#39;om.us/j/1'],
  ])('escapes the href of %s, and leaves the label to escapeHtml', async (url, href) => {
    const text = await now('supergroup', [{ ...ZOOM, label: 'Зум "1"', url }]);
    expect(text).toContain(`🔗 <a href="${href}">Зум "1"</a>`);
  });

  it('/left names only the first lesson in progress', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date(2026, 9, 28, 11, 0, 0));
    const text = await now('supergroup', [ZOOM], 'left', [ONS, LAB]);
    jest.useRealTimers();
    expect(text).toBe('<b>ІП-55</b>\n🟢 <b>ОНС</b>\nДо кінця: <b>60 хв</b> (до 12:00)');
  });
});

describe('BotService.avatar', () => {
  it('gives the 320px profile photo as a data URI, and nothing when there is no photo', async () => {
    const svc = new BotService(...(Array(9).fill({}) as ConstructorParameters<typeof BotService>));
    const sizes = [160, 320, 640].map((width) => ({ file_id: `photo-${width}`, width }));
    const getUserProfilePhotos = jest.fn(async () => ({ photos: [sizes] }));
    const getFile = jest.fn(async () => ({ file_path: 'profile_photos/file_1.jpg' }));
    svc['bot'] = { token: 'TOKEN', api: { getUserProfilePhotos, getFile } } as never;
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const download = jest.spyOn(global, 'fetch').mockImplementation(async () => new Response(jpeg));

    await expect(svc.avatar(5)).resolves.toBe(`data:image/jpeg;base64,${jpeg.toString('base64')}`);
    expect(getFile).toHaveBeenCalledWith('photo-320');
    expect(download.mock.calls[0][0]).toBe('https://api.telegram.org/file/botTOKEN/profile_photos/file_1.jpg');

    // Not a picture (an error page) → the card keeps the initials.
    download.mockImplementation(async () => new Response('<html>'));
    await expect(svc.avatar(5)).resolves.toBeUndefined();
    getUserProfilePhotos.mockResolvedValueOnce({ photos: [] });
    await expect(svc.avatar(5)).resolves.toBeUndefined();
    download.mockRestore();
  });
});

describe('BotService.sendCard', () => {
  const card = { tree: { type: 'div', props: {} } };
  const setup = (sendPhoto: jest.Mock) => {
    const svc = new BotService(...(Array(9).fill({}) as ConstructorParameters<typeof BotService>));
    const sendMessage = jest.fn(async () => undefined);
    svc['bot'] = { api: { sendPhoto, sendMessage } } as never;
    return { svc, sendMessage };
  };
  beforeEach(() => (renderCard as jest.Mock).mockClear());

  it('draws and uploads a card once, then reuses its file_id', async () => {
    const sendPhoto = jest.fn(async () => ({ photo: [{ file_id: 'small' }, { file_id: 'big' }] }));
    const { svc, sendMessage } = setup(sendPhoto);
    await svc.sendCard(1, card, 'текст', { message_thread_id: 7, link_preview_options: { is_disabled: true } });
    await svc.sendCard(2, card, 'текст');
    expect(renderCard).toHaveBeenCalledTimes(1);
    // The text is the caption: a notification shows it, and it reads where the picture does not load.
    expect(sendPhoto.mock.calls[0]).toEqual([1, expect.anything(), { caption: 'текст', parse_mode: 'HTML', message_thread_id: 7 }]);
    expect(sendPhoto.mock.calls[1].slice(0, 2)).toEqual([2, 'big']);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('sends the text alone when it is too long for a caption', async () => {
    const sendPhoto = jest.fn(async () => ({ photo: [{ file_id: 'big' }] }));
    const { svc, sendMessage } = setup(sendPhoto);
    // 1024 characters is the limit, and tags do not count.
    await svc.sendCard(1, card, `<b>${'я'.repeat(1024)}</b>`);
    expect(sendPhoto).toHaveBeenCalledTimes(1);
    await svc.sendCard(1, card, 'я'.repeat(1025));
    expect(sendPhoto).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(1, 'я'.repeat(1025), { parse_mode: 'HTML' });
    expect(renderCard).toHaveBeenCalledTimes(1);
  });

  it('puts lesson links under the card as buttons, in place of the keyboard the caller passed', async () => {
    const sendPhoto = jest.fn(async () => ({ photo: [{ file_id: 'big' }] }));
    const { svc } = setup(sendPhoto);
    const links = [{ label: 'Meet', url: 'https://meet.google.com/x' }];
    await svc.sendCard(1, { ...card, links }, 'текст', { reply_markup: { keyboard: [] } });
    expect(sendPhoto).toHaveBeenCalledWith(1, expect.anything(), {
      caption: 'текст',
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: 'Meet', url: 'https://meet.google.com/x' }]] },
    });
  });

  it('sends the text when the card cannot be drawn', async () => {
    (renderCard as jest.Mock).mockRejectedValueOnce(new Error('out of memory'));
    const { svc, sendMessage } = setup(jest.fn());
    await svc.sendCard(1, card, 'текст', { message_thread_id: 7 });
    expect(sendMessage).toHaveBeenCalledWith(1, 'текст', { parse_mode: 'HTML', message_thread_id: 7 });
  });

  it('sends the text when a builder gave no card', async () => {
    const sendPhoto = jest.fn();
    const { svc, sendMessage } = setup(sendPhoto);
    await svc.sendCard(1, undefined, 'текст');
    expect(sendMessage).toHaveBeenCalledWith(1, 'текст', { parse_mode: 'HTML' });
    expect(sendPhoto).not.toHaveBeenCalled();
  });

  it('sends the text when Telegram refuses the photo, and draws the card again next time', async () => {
    const noMedia = new GrammyError('sendPhoto failed', { ok: false, error_code: 400, description: 'Bad Request: not enough rights to send photos to the chat' }, 'sendPhoto', {});
    const { svc, sendMessage } = setup(jest.fn(async () => Promise.reject(noMedia)));
    await svc.sendCard(1, card, 'текст');
    await svc.sendCard(1, card, 'текст');
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(renderCard).toHaveBeenCalledTimes(2);
  });
});

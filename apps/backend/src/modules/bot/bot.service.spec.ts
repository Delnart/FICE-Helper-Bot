import { createHash } from 'crypto';
import { Bot, GrammyError } from 'grammy';
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

  it('lays the day out as a headline and one quote block, a lesson in two lines', async () => {
    const day = [
      { ...lesson('Операційні системи', 3), room: '18-511' },
      { ...lesson('C++ <STL>', 3), lessonNumber: 3, startTime: '12:20', endTime: '13:55' },
    ];
    expect(await ask('supergroup', 'today', day)).toBe(
      [
        '📅 <b>Середа</b> · ІП-55 · I тиждень',
        '',
        '<blockquote><b>10:25 – 12:00</b> · 18-511',
        'Операційні системи',
        '',
        '<b>12:20 – 13:55</b>',
        'C++ &lt;STL&gt;</blockquote>',
      ].join('\n'),
    );
    expect(await ask('private', 'today', [])).toBe('🎉 <b>Середа — пар немає</b> · ІП-55 · I тиждень');
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
    expect(text.indexOf('🔗')).toBeLessThan(text.indexOf('Далі'));
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
    expect(text).toContain('<blockquote><b>БД &lt;лаб&gt;</b>');
    expect(text.match(/🔗/g)).toHaveLength(1);
    expect(text).toContain('Далі');
  });

  it.each(CHATS)('%s: shows every lesson in progress with its own link, the next one after them', async (chat) => {
    const text = await now(chat, [ZOOM, MEET], 'now', [ONS, LAB]);
    expect(text.split('\n')).toEqual([
      '🟢 <b>Зараз</b> · ІП-55 · I тиждень',
      '',
      '<blockquote><b>ОНС</b>',
      '🕒 10:25 – 12:00',
      '📍 18-101',
      '🔗 <a href="https://zoom.us/j/1?pwd=a&amp;b=c">Zoom &lt;лекції&gt;</a></blockquote>',
      '<blockquote><b>БД &lt;лаб&gt;</b>',
      '🕒 10:25 – 12:00',
      '📍 18-202',
      '🔗 <a href="https://meet.google.com/abc">Meet</a></blockquote>',
      '⏭️ Далі о <b>12:20</b> — БД',
    ]);
  });

  it.each(CHATS)('%s: a lesson with no link still gets its block', async (chat) => {
    const text = await now(chat, [MEET], 'now', [ONS, LAB]);
    expect(text.match(/<blockquote>/g)).toHaveLength(2);
    expect(text.match(/🔗/g)).toHaveLength(1);
    expect(text).toContain('Meet');
  });

  it.each(CHATS)('%s: identical rows collapse to one block', async (chat) => {
    const text = await now(chat, [ZOOM], 'now', [ONS, { ...ONS, teacherNames: ['Інший'] }]);
    expect(text.match(/<blockquote>/g)).toHaveLength(1);
    expect(text.match(/🔗/g)).toHaveLength(1);
  });

  it('rows of one subject in different rooms stay two blocks', async () => {
    const text = await now('private', [ZOOM], 'now', [ONS, { ...ONS, room: '18-303' }]);
    expect(text.match(/<blockquote>/g)).toHaveLength(2);
  });

  it.each(CHATS)('%s: says the day is over only with nothing running and nothing next', async (chat) => {
    expect(await now(chat, [], 'now', [], null)).toContain('Сьогодні пар більше немає');
    expect(await now(chat, [], 'now', [ONS], null)).not.toContain('Сьогодні пар більше немає');
    const onlyNext = await now(chat, [], 'now', []);
    expect(onlyNext).toBe('☕ <b>Зараз пари немає</b> · ІП-55 · I тиждень\n\n⏭️ Далі о <b>12:20</b> — БД');
    expect(onlyNext).not.toContain('🟢');
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
    expect(text).toBe('⏳ <b>До кінця пари 60 хв</b> · ІП-55\n\n<blockquote><b>ОНС</b>\n🕒 до 12:00</blockquote>');
  });

  it('/left in a break says when the next lesson starts', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date(2026, 9, 28, 10, 15, 0));
    const text = await now('private', [], 'left', [], { ...NEXT, room: '18-205' });
    jest.useRealTimers();
    expect(text).toBe('☕ <b>Зараз пари немає</b> · ІП-55\n\n⏭️ Далі о <b>12:20</b> — БД · 18-205 · через 2 год 5 хв');
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
  const keyOf = (tree: unknown) => createHash('sha1').update(JSON.stringify(tree)).digest('hex');
  const preview = (tree: unknown = card.tree) => ({
    url: `https://api.test/api/cards/${keyOf(tree)}.png`,
    prefer_large_media: true,
    show_above_text: true,
  });
  const setup = (sendMessage: jest.Mock = jest.fn(async () => undefined), api: string | undefined = 'https://api.test/api/') => {
    const config = { get: (name: string) => (name === 'PUBLIC_API_URL' ? api : undefined) };
    const svc = new BotService(...([config, ...Array(8).fill({})] as ConstructorParameters<typeof BotService>));
    svc['bot'] = { api: { sendMessage } } as never;
    return { svc, sendMessage };
  };
  beforeEach(() => (renderCard as jest.Mock).mockClear());

  it('sends the text with the card as its link preview, drawn once for every chat it goes to', async () => {
    const { svc, sendMessage } = setup();
    await svc.sendCard(1, card, 'текст', { message_thread_id: 7, link_preview_options: { is_disabled: true } });
    await svc.sendCard(2, card, 'текст');
    expect(renderCard).toHaveBeenCalledTimes(1);
    // A text message: out of the chat's media, in the notification, readable where the picture does not load.
    expect(sendMessage.mock.calls).toEqual([
      [1, 'текст', { parse_mode: 'HTML', message_thread_id: 7, link_preview_options: preview() }],
      [2, 'текст', { parse_mode: 'HTML', link_preview_options: preview() }],
    ]);
    // What Telegram fetches for the preview.
    expect(svc.cardPng(keyOf(card.tree))).toEqual(Buffer.from('png'));
    expect(svc.cardPng('other')).toBeUndefined();
  });

  it('puts lesson links under the message as buttons, in place of the keyboard the caller passed', async () => {
    const { svc, sendMessage } = setup();
    const links = [{ label: 'Meet', url: 'https://meet.google.com/x' }];
    await svc.sendCard(1, { ...card, links }, 'текст', { reply_markup: { keyboard: [] } });
    expect(sendMessage).toHaveBeenCalledWith(1, 'текст', {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: 'Meet', url: 'https://meet.google.com/x' }]] },
      link_preview_options: preview(),
    });
  });

  it('keeps the pictures of the last 100 cards', async () => {
    const { svc } = setup();
    const trees = Array.from({ length: 101 }, (_, n) => ({ type: 'div', props: { n } }));
    for (const tree of trees) await svc.sendCard(1, { tree }, 'текст');
    expect(svc.cardPng(keyOf(trees[0]))).toBeUndefined();
    expect(svc.cardPng(keyOf(trees[1]))).toBeDefined();
    expect(svc.cardPng(keyOf(trees[100]))).toBeDefined();
  });

  it('sends the text alone when the card cannot be drawn', async () => {
    (renderCard as jest.Mock).mockRejectedValueOnce(new Error('out of memory'));
    const { svc, sendMessage } = setup();
    await svc.sendCard(1, card, 'текст', { message_thread_id: 7 });
    expect(sendMessage.mock.calls).toEqual([[1, 'текст', { parse_mode: 'HTML', message_thread_id: 7 }]]);
  });

  it('sends the text alone when a builder gave no card, or Telegram has nowhere to fetch one from', async () => {
    const noCard = setup();
    await noCard.svc.sendCard(1, undefined, 'текст');
    expect(noCard.sendMessage.mock.calls).toEqual([[1, 'текст', { parse_mode: 'HTML' }]]);
    const noAddress = setup(undefined, '');
    await noAddress.svc.sendCard(1, card, 'текст', { link_preview_options: { is_disabled: true } });
    expect(noAddress.sendMessage.mock.calls).toEqual([[1, 'текст', { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }]]);
    expect(renderCard).not.toHaveBeenCalled();
  });

  describe('with a sticker', () => {
    const pack = {
      stickers: [
        { emoji: '👍', file_id: 'thumb' },
        { emoji: '🎉', file_id: 'party' },
        { emoji: '🎉', file_id: 'party-2' },
        { emoji: '☀️', file_id: 'sun' },
      ],
    };
    const withSet = (getStickerSet: jest.Mock, set: string | undefined = 'Pack') => {
      const config = { get: (name: string) => ({ PUBLIC_API_URL: 'https://api.test/api', STICKER_SET: set })[name] };
      const svc = new BotService(...([config, ...Array(8).fill({})] as ConstructorParameters<typeof BotService>));
      const sendSticker = jest.fn(async () => undefined);
      svc['bot'] = { api: { sendMessage: jest.fn(async () => undefined), getStickerSet, sendSticker } } as never;
      return { svc, sendSticker };
    };

    it('follows a card that calls for one with the first sticker the set has for its emoji', async () => {
      const getStickerSet = jest.fn(async () => pack);
      const { svc, sendSticker } = withSet(getStickerSet);
      await svc.sendCard(1, { ...card, sticker: ['🎂', '🎉'] }, 'текст', { message_thread_id: 7, reply_markup: {} });
      // The same emoji spelled without its variation selector.
      await svc.sendCard(2, { ...card, sticker: ['☀'] }, 'текст');
      await svc.sendCard(3, { ...card, sticker: ['🦆'] }, 'текст');
      await svc.sendCard(4, card, 'текст');
      expect(getStickerSet.mock.calls).toEqual([['Pack']]);
      expect(sendSticker.mock.calls).toEqual([
        [1, 'party', { message_thread_id: 7 }],
        [2, 'sun', {}],
      ]);
    });

    it('sends none without a set, and asks again for a set Telegram did not give', async () => {
      const none = withSet(jest.fn(), '');
      await none.svc.sendCard(1, { ...card, sticker: ['🎉'] }, 'текст');
      expect(none.sendSticker).not.toHaveBeenCalled();

      const getStickerSet = jest.fn().mockRejectedValueOnce(new Error('STICKERSET_INVALID')).mockResolvedValue(pack);
      const { svc, sendSticker } = withSet(getStickerSet);
      await svc.sendCard(1, { ...card, sticker: ['🎉'] }, 'текст');
      expect(sendSticker).not.toHaveBeenCalled();
      await svc.sendCard(1, { ...card, sticker: ['🎉'] }, 'текст');
      expect(sendSticker).toHaveBeenCalledTimes(1);
    });
  });

  it('sends the text alone when Telegram refuses the message with the preview', async () => {
    const refused = new GrammyError('sendMessage failed', { ok: false, error_code: 400, description: 'Bad Request: WEBPAGE_CURL_FAILED' }, 'sendMessage', {});
    const { svc, sendMessage } = setup(jest.fn().mockRejectedValueOnce(refused).mockResolvedValue(undefined));
    await svc.sendCard(1, card, 'текст');
    expect(sendMessage.mock.calls).toEqual([
      [1, 'текст', { parse_mode: 'HTML', link_preview_options: preview() }],
      [1, 'текст', { parse_mode: 'HTML' }],
    ]);
  });
});

describe('BotService /notice', () => {
  const ADMINS = -100500;
  const ID = 'a'.repeat(24);
  const setup = () => {
    const notices = {
      create: jest.fn(async (doc: { title: string; body: string }) => ({ ...doc, id: ID })),
      deleteOne: jest.fn(() => ({ exec: async () => undefined })),
    };
    const config = { get: (name: string) => (name === 'ADMIN_CHAT_ID' ? String(ADMINS) : undefined) };
    const svc = new BotService(...([config, ...Array(8).fill({}), notices] as unknown as ConstructorParameters<typeof BotService>));
    // A real grammY bot with the handlers on it; what it would send to Telegram lands in `sent`.
    const bot = new Bot('1:test', { botInfo: { id: 1, is_bot: true, first_name: 'Bot', username: 'fice_bot' } as never });
    const sent: Array<{ method: string; payload: Record<string, any> }> = [];
    bot.api.config.use(async (_prev, method, payload) => {
      sent.push({ method, payload: payload as Record<string, any> });
      return { ok: true, result: true } as never;
    });
    svc['registerHandlers'](bot);
    const chat = (id: number) => ({ id, type: 'supergroup', title: 'chat' });
    const from = { id: 5, is_bot: false, first_name: 'Dev' };
    const say = (chatId: number, text: string) =>
      bot.handleUpdate({
        update_id: 1,
        message: { message_id: 1, date: 0, chat: chat(chatId), from, text, entities: [{ type: 'bot_command', offset: 0, length: '/notice'.length }] },
      } as never);
    const press = (chatId: number, data: string) =>
      bot.handleUpdate({
        update_id: 2,
        callback_query: { id: '1', from, chat_instance: 'x', data, message: { message_id: 7, date: 0, chat: chat(chatId) } },
      } as never);
    return { notices, sent, say, press };
  };

  it('publishes what the admins wrote, the first line as the title, and takes it back at a tap', async () => {
    const { notices, sent, say, press } = setup();
    await say(ADMINS, '/notice Версія 2.5.0 \nТемні картки.\n\nІ сповіщення. ');
    expect(notices.create.mock.calls).toEqual([[{ title: 'Версія 2.5.0', body: 'Темні картки.\n\nІ сповіщення.' }]]);
    expect(sent[0].method).toBe('sendMessage');
    expect(sent[0].payload.reply_markup.inline_keyboard[0][0].callback_data).toBe(`notice:del:${ID}`);

    await press(ADMINS, `notice:del:${ID}`);
    expect(notices.deleteOne).toHaveBeenCalledWith({ _id: ID });
    expect(sent.map((s) => s.method).slice(1)).toEqual(['editMessageText', 'answerCallbackQuery']);
  });

  it('is for the admins chat only, and wants a title', async () => {
    const { notices, sent, say, press } = setup();
    await say(-1, '/notice Спам');
    await say(ADMINS, '/notice');
    await press(-1, `notice:del:${ID}`);
    expect(notices.create).not.toHaveBeenCalled();
    expect(notices.deleteOne).not.toHaveBeenCalled();
    expect(sent.map((s) => s.payload.text)).toEqual([
      'Команда /notice доступна лише в групі адмінів.',
      'Після /notice напишіть заголовок, а з нового рядка — текст повідомлення.',
      undefined,
    ]);
  });
});

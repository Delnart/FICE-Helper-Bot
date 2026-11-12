import { Logger } from '@nestjs/common';
import { fork } from 'child_process';
import { EventEmitter } from 'events';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { renderCard, renderTree } from './render';
import * as cards from './templates';

jest.mock('child_process', () => ({ fork: jest.fn() }));

/**
 * Every card renders to a PNG. `CARDS_OUT=some/dir npx jest cards` also saves them there, to look at
 * a template after changing it.
 */
const NOW = new Date(2026, 10, 11, 11, 23); // Wednesday
const lesson = (over: Partial<cards.CardLesson> = {}): cards.CardLesson => ({
  subjectName: 'Операційні системи',
  type: 'lab',
  teacherNames: ['Петренко О. В.'],
  startTime: '10:25',
  endTime: '12:00',
  room: '18-511',
  lessonNumber: 2,
  ...over,
});
const db = lesson({
  subjectName: 'Бази даних',
  type: 'practice',
  teacherNames: ['Коваль І. С.'],
  startTime: '12:20',
  endTime: '13:55',
  room: '18-205',
  lessonNumber: 3,
});
const meet = { label: 'Meet', url: 'https://meet.google.com/x' };
const day = [
  lesson({ subjectName: 'Теорія ймовірностей', type: 'lecture', startTime: '08:30', endTime: '10:05', room: '18-309' }),
  lesson(),
  db,
  lesson({ subjectName: 'Англійська мова', type: 'practice', startTime: '14:15', endTime: '15:50', room: '7-213' }),
];
const long = 'Обʼєктно-орієнтоване програмування та проєктування великих програмних систем';

const SAMPLES: Record<string, cards.Card | undefined> = {
  reminder: cards.lessonReminderCard('ІП-31', 10, [lesson({ link: meet })]),
  'reminder-bare': cards.lessonReminderCard(undefined, 5, [
    lesson({ subjectName: long, type: 'other', room: ' ', teacherNames: [], lessonNumber: undefined }),
  ]),
  'reminder-multi': cards.lessonReminderCard('ІП-31', 10, [
    lesson({ subjectName: 'Бази даних', teacherNames: ['Коваль І. С.'], room: '18-205' }),
    lesson(),
    lesson({
      subjectName: 'Теорія ймовірностей',
      type: 'practice',
      teacherNames: [],
      room: undefined,
      link: { label: 'Zoom', url: 'https://zoom.us/j/1' },
    }),
  ]),
  'reminder-many': cards.lessonReminderCard(
    'ІП-31',
    10,
    Array.from({ length: 9 }, (_, i) => lesson({ subjectName: `${long} ${i}`, endTime: i % 2 ? '11:15' : '12:00' })),
  ),
  now: cards.nowCard('ІП-31', 1, [{ lesson: lesson(), link: meet }], db, NOW),
  'now-subgroups': cards.nowCard(
    'ІП-31',
    2,
    [{ lesson: lesson() }, { lesson: lesson({ subjectName: long, room: undefined }), link: meet }],
    null,
    NOW,
  ),
  'now-break': cards.nowCard('ІП-31', 1, [], db, new Date(2026, 10, 11, 12, 5)),
  'now-done': cards.nowCard('ІП-31', 1, [], null, NOW),
  left: cards.leftCard('ІП-31', lesson(), db, NOW),
  'left-break': cards.leftCard('ІП-31', null, lesson({ subjectName: long, startTime: '14:15', endTime: '15:50' }), NOW),
  'left-done': cards.leftCard('ІП-31', null, null, NOW),
  today: cards.dayCard('ІП-31', 'today', 'Середа', NOW, 1, day, NOW),
  tomorrow: cards.dayCard('ІП-31', 'tomorrow', 'Четвер', new Date(2026, 10, 12), 1, [
    lesson({ subjectName: 'Обʼєктно-орієнтоване програмування', type: 'lecture', room: '18-401' }),
    lesson({ subjectName: 'Компʼютерні мережі', startTime: '12:20', endTime: '13:55', room: '18-530' }),
    lesson({
      subjectName: 'Алгоритми та структури даних',
      type: 'practice',
      startTime: '14:15',
      endTime: '15:50',
      room: undefined,
    }),
  ]),
  'day-free': cards.dayCard('ІП-31', 'today', 'Субота', new Date(2026, 10, 14), 1, []),
  'day-sunday': cards.dayCard('ІП-31', 'tomorrow', 'Неділя', new Date(2026, 10, 15), 2, []),
  digest: cards.digestCard(
    NOW,
    day,
    [
      { title: 'Лабораторна робота №3', subjectName: 'Бази даних', deadline: new Date(2026, 10, 11, 23, 59) },
      { title: 'Есе «Remote work»', subjectName: 'Англійська мова', deadline: new Date(2026, 10, 11, 18, 0) },
    ],
    'ІП-31',
  ),
  'digest-groups': cards.digestCard(
    NOW,
    [lesson({ groupName: 'ІП-31', subjectName: long }), lesson({ groupName: 'ІП-32', subjectName: 'Англійська мова', startTime: '12:20' })],
    Array.from({ length: 8 }, (_, i) => ({
      title: `${long} ${i}`,
      groupName: 'ІП-32',
      deadline: new Date(2026, 10, 11, 23, 59),
    })),
  ),
  'digest-deadlines': cards.digestCard(NOW, [], [{ title: 'Лаба 3', deadline: new Date(2026, 10, 11, 23, 59) }]),
  birthday: cards.birthdayCard('ІП-31', 'Марія Шевченко'),
  'birthday-long': cards.birthdayCard('ІП-31', 'Константиновський Олександр-Вікторович Володимирович'),
  // A 4×4 orange square in place of a profile photo.
  'birthday-photo': cards.birthdayCard(
    'ІП-31',
    'Марія Шевченко',
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAFElEQVR42mP8MC2KAQaYGJAAbg4AX1oB6NELRnUAAAAASUVORK5CYII=',
  ),
  deadline: cards.deadlineCard('ІП-31', 'Лабораторна робота №4', new Date(2026, 10, 12, 23, 59), 'Операційні системи'),
  'deadline-long': cards.deadlineCard(undefined, long, new Date(2026, 8, 28, 18, 0)),
  announcement: cards.announcementCard(
    'ІП-31',
    'Перенесення модульної контрольної',
    'Модульна з баз даних переноситься з четверга на вівторок, 17 листопада, о 12:20, ауд. 18-205. Питання — у корисних посиланнях дисципліни.',
    NOW,
    { name: 'Олена Бондар', role: 'староста' },
  ),
  // The longest that still gets a card: an 80-character title and a dozen lines of body.
  'announcement-long': cards.announcementCard('ІП-31', long.padEnd(80, '!'), `${long}.\n\n`.repeat(3).trim(), NOW),
  'queue-soon': cards.queueSoonCard('ІП-31', 'Бази даних — захист лаб', new Date(2026, 10, 11, 12, 20), new Date(2026, 10, 11, 12, 15)),
  'queue-open': cards.queueOpenCard('ІП-31', 'Бази даних — захист лаб', 30),
  'queue-next': cards.queueNextCard('Бази даних — захист лаб', 7, [
    { slot: 5, status: 'missed' },
    { slot: 6, status: 'passing' },
    { slot: 7, status: 'preparing' },
    { slot: 8, status: 'default' },
    { slot: 9 },
  ]),
  'queue-next-first': cards.queueNextCard(long, 1, [{ slot: 1 }, { slot: 2 }, { slot: 3 }]),
  'swap-request': cards.swapRequestCard('Андрій Мельник', 'Бази даних — захист лаб', 5, 12),
  'swap-accepted': cards.swapResultCard(true, 'Олена Бондар', 'Бази даних — захист лаб', 5, 12),
  'swap-declined': cards.swapResultCard(false, 'Олена Бондар', long, 5, 50),
  'teacher-request': cards.teacherRequestCard('ІП-31', 'Коваль Ірина Сергіївна', 'koval_is', 'Веду практики з баз даних у вашій групі.'),
  'teacher-request-bare': cards.teacherRequestCard('ІП-31', '@koval_is'),
  'teacher-approved': cards.teacherDecisionCard('ІП-31', true),
  'teacher-rejected': cards.teacherDecisionCard('ІП-31', false),
};

describe('cards', () => {
  const out = process.env.CARDS_OUT;
  if (out) mkdirSync(out, { recursive: true });

  it.each(Object.entries(SAMPLES))('%s renders to a 1280px wide PNG', async (name, card) => {
    if (!card) throw new Error('the builder failed');
    const png = await renderTree(card.tree);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(1280);
    // Telegram refuses photos whose sides add up to more than 10000px.
    expect(png.readUInt32BE(20)).toBeLessThan(8000);
    if (out) writeFileSync(join(out, `${name}.png`), png);
  });

  it('hands lesson links over as buttons, named after the subject when lessons are several', () => {
    expect(cards.lessonReminderCard('A', 10, [lesson({ link: meet })])?.links).toEqual([meet]);
    expect(cards.lessonReminderCard('A', 10, [lesson({ link: meet }), db])?.links).toEqual([
      { label: 'Операційні системи · Meet', url: meet.url },
    ]);
    expect(cards.nowCard('A', 1, [{ lesson: lesson() }], db, NOW)?.links).toBeUndefined();
  });

  it('gives no card to an announcement a picture cannot hold: a long one, one with a link or a mention', () => {
    const card = (title: string, body: string) => cards.announcementCard('A', title, body, NOW);
    expect(card('Збори', 'Завтра о 12:20 в ауд. 18-205.')).toBeDefined();
    expect(card('Збори', 'Слово '.repeat(80))).toBeUndefined();
    expect(card('Збори', 'пункт\n'.repeat(13))).toBeUndefined();
    expect(card('Опитування', 'Заповніть форму: forms.gle/abc')).toBeUndefined();
    expect(card('Розклад', 'Зміни вже на kpi.ua')).toBeUndefined();
    expect(card('Журнал', '@ivan_p, принеси журнал')).toBeUndefined();
  });

  it('draws the text without what the fonts lack', async () => {
    const png = (title: string) => renderTree(cards.queueOpenCard('ІП-31', title, 30)!.tree);
    const plain = await png('Лаба 3');
    expect((await png('🔥 Лаба 👩‍💻 3 数学')).equals(plain)).toBe(true);
    // An arrow is in Onest's symbols subset: drawn, not dropped.
    expect((await png('Лаба → 3')).equals(plain)).toBe(false);
  });

  describe('renderCard', () => {
    const tree = { type: 'div', props: {} };
    /** How long the fake renderer takes over a card. */
    let drawMs = 100;
    const forked = (fork as unknown as jest.Mock).mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), {
        kill: jest.fn(),
        send: () => setTimeout(() => child.emit('message', { png: new Uint8Array([1, 2]) }), drawMs),
      });
      return child;
    });
    const renderer = (n: number) => forked.mock.results[n].value as EventEmitter & { kill: jest.Mock };
    /** A card drawn to the end. */
    const card = async () => {
      const png = renderCard(tree);
      await jest.advanceTimersByTimeAsync(drawMs);
      return png;
    };
    // Every test in an hour of its own (a fresh drawing budget), and over with the renderer idled out.
    let now = Date.now();
    beforeEach(() => {
      drawMs = 100;
      forked.mockClear();
      jest.useFakeTimers({ now: (now += 3_600_000) });
    });
    afterEach(async () => {
      await jest.advanceTimersByTimeAsync(5 * 60_000);
      jest.useRealTimers();
    });

    it('draws on one warm renderer and starts another once it idled out, died or hung', async () => {
      await expect(card()).resolves.toEqual(Buffer.from([1, 2]));
      await card();
      expect(forked).toHaveBeenCalledTimes(1);
      // Five minutes without cards: it goes, and the next card starts a new one.
      await jest.advanceTimersByTimeAsync(5 * 60_000);
      expect(renderer(0).kill).toHaveBeenCalled();
      await card();
      expect(forked).toHaveBeenCalledTimes(2);
      // Killed mid-card (out of memory): that card fails, the next one gets a new renderer.
      const killed = renderCard(tree);
      await jest.advanceTimersByTimeAsync(drawMs / 2);
      renderer(1).emit('exit', null, 'SIGKILL');
      await expect(killed).rejects.toThrow('SIGKILL');
      await card();
      expect(forked).toHaveBeenCalledTimes(3);
      // Stuck on a card: killed after 20 s.
      drawMs = 60_000;
      const stuck = renderCard(tree);
      await jest.advanceTimersByTimeAsync(20_000);
      await expect(stuck).rejects.toThrow('over 20 s');
      expect(renderer(2).kill).toHaveBeenCalled();
    });

    it('refuses to draw for the rest of a minute that spent 20 s on cards', async () => {
      drawMs = 11_000;
      await card();
      await card();
      await expect(renderCard(tree)).rejects.toThrow('drawing budget');
      await jest.advanceTimersByTimeAsync(60_000 - 22_000);
      await expect(card()).resolves.toEqual(Buffer.from([1, 2]));
    });
  });

  it('calls for a sticker after a birthday and after a day with nothing left to attend, and only then', () => {
    const names = Object.entries(SAMPLES).flatMap(([name, card]) => (card?.sticker ? [name] : []));
    expect(names.sort()).toEqual(['birthday', 'birthday-long', 'birthday-photo', 'day-free', 'day-sunday', 'left-done', 'now-done']);
  });

  it('gives no card when a builder trips, so the sender falls back to the text', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    expect(cards.birthdayCard('ІП-31', undefined as never)).toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('birthdayCard failed'));
    error.mockRestore();
  });
});

import { buildLessonRemindersText, LessonReminder } from './notifications.service';

const lesson = (over: Partial<LessonReminder> = {}): LessonReminder => ({
  subjectName: 'Операційні системи',
  lessonType: 'lab',
  teacherNames: ['Петренко О. В.'],
  startTime: '10:25',
  endTime: '12:00',
  room: '18-511',
  ...over,
});

describe('buildLessonRemindersText', () => {
  it('lays a lesson out as a headline and a quote block, a line for each thing it has', () => {
    expect(buildLessonRemindersText(10, [lesson({ link: { label: 'Meet', url: 'https://meet.google.com/x' } })])).toBe(
      [
        '🔔 <b>Пара через 10 хв</b>',
        '',
        '<blockquote><b>Операційні системи</b>',
        '🕒 10:25 – 12:00 · Лабораторна',
        '📍 18-511',
        '👤 Петренко О. В.',
        '🔗 <a href="https://meet.google.com/x">Meet</a></blockquote>',
      ].join('\n'),
    );
  });

  it('puts several lessons into one message, a block each, with no line for what a lesson lacks', () => {
    const text = buildLessonRemindersText(10, [
      lesson({ subjectName: 'Бази даних', teacherNames: ['Коваль І. С.'], room: '18-205' }),
      lesson(),
      lesson({ subjectName: 'Бази даних', teacherNames: [], room: ' ' }),
    ]);
    expect(text.split('\n').slice(0, 2)).toEqual(['🔔 <b>3 пари через 10 хв</b>', '']);
    expect(text.match(/<blockquote>/g)).toHaveLength(3);
    expect(text.indexOf('Бази даних')).toBeLessThan(text.indexOf('Операційні системи'));
    expect(text).toContain('<blockquote><b>Бази даних</b>\n🕒 10:25 – 12:00 · Лабораторна</blockquote>');
  });

  it('gives every lesson its own time', () => {
    const text = buildLessonRemindersText(5, [lesson(), lesson({ subjectName: 'Фізика', endTime: '11:15' })]);
    expect(text).toContain('<b>Фізика</b>\n🕒 10:25 – 11:15');
    expect(text).toContain('<b>Операційні системи</b>\n🕒 10:25 – 12:00');
  });

  it('stays under the Telegram limit, closes every block and says how many were cut', () => {
    const many = Array.from({ length: 60 }, (_, i) => lesson({ subjectName: `Дисципліна ${String(i).padStart(2, '0')}`, teacherNames: ['Дуже Довге Прізвище Викладача І. І.'] }));
    const text = buildLessonRemindersText(10, many);
    expect(text.length).toBeLessThan(4096);
    const shown = text.match(/<blockquote>/g)!.length;
    expect(text.match(/<\/blockquote>/g)).toHaveLength(shown);
    expect(text).toMatch(new RegExp(`</blockquote>\n…і ще ${60 - shown}$`));
  });

  it('escapes HTML in subject names', () => {
    expect(buildLessonRemindersText(10, [lesson(), lesson({ subjectName: 'C++ <STL>' })])).toContain('C++ &lt;STL&gt;');
  });
});

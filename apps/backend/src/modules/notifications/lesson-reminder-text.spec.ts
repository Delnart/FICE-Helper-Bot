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
  it('keeps the original single-lesson format', () => {
    expect(buildLessonRemindersText(10, [lesson({ link: { label: 'Meet', url: 'https://meet.google.com/x' } })])).toBe(
      [
        '🔔 Нагадування про пару через 10 хвилин!',
        '',
        '📚 Дисципліна: <b>Операційні системи</b>',
        '📝 Тип: <b>Лабораторна</b>',
        '👨‍🏫 Викладач: Петренко О. В.',
        '⏰ Час: <b>10:25</b> — <b>12:00</b>',
        '📍 Місце: <b>18-511</b>',
        '🔗 Приєднатися до зустрічі: <a href="https://meet.google.com/x">Meet</a>',
      ].join('\n'),
    );
  });

  it('puts several lessons into one message with a shared time line', () => {
    const text = buildLessonRemindersText(10, [
      lesson({ subjectName: 'Бази даних', teacherNames: ['Коваль І. С.'], room: '18-205' }),
      lesson(),
      lesson({ subjectName: 'Бази даних', teacherNames: [], room: undefined }),
    ]);
    expect(text.match(/🔔/g)).toHaveLength(1);
    expect(text).toContain('🔔 Через 10 хвилин пари (3):');
    expect(text.split('\n')[1]).toBe('⏰ <b>10:25</b> — <b>12:00</b>');
    expect(text.indexOf('1. Бази даних')).toBeLessThan(text.indexOf('3. Операційні системи'));
    expect(text).toContain('👨‍🏫 — · 📍 —');
  });

  it('shows the time per lesson when end times differ', () => {
    const text = buildLessonRemindersText(5, [lesson(), lesson({ subjectName: 'Фізика', endTime: '11:15' })]);
    expect(text.split('\n')[1]).toBe('');
    expect(text).toContain('⏰ <b>10:25</b> — <b>11:15</b>');
    expect(text).toContain('⏰ <b>10:25</b> — <b>12:00</b>');
  });

  it('stays under the Telegram limit and says how many were cut', () => {
    const many = Array.from({ length: 60 }, (_, i) => lesson({ subjectName: `Дисципліна ${String(i).padStart(2, '0')}`, teacherNames: ['Дуже Довге Прізвище Викладача І. І.'] }));
    const text = buildLessonRemindersText(10, many);
    expect(text.length).toBeLessThan(4096);
    expect(text).toMatch(/…і ще \d+$/);
  });

  it('escapes HTML in subject names', () => {
    expect(buildLessonRemindersText(10, [lesson(), lesson({ subjectName: 'C++ <STL>' })])).toContain('C++ &lt;STL&gt;');
  });
});

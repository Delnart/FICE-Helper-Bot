import { buildMorningDigestText, DigestDeadline, DigestLesson } from './notifications.service';

const TODAY = new Date(2026, 9, 27, 9, 0); // Tuesday

const lesson = (over: Partial<DigestLesson> = {}): DigestLesson => ({
  subjectName: 'Операційні системи',
  lessonType: 'lecture',
  startTime: '10:25',
  endTime: '12:00',
  room: '18-511',
  ...over,
});
const deadline = (over: Partial<DigestDeadline> = {}): DigestDeadline => ({
  title: 'Лаба 3',
  subjectName: 'Бази даних',
  deadline: new Date(2026, 9, 27, 23, 59),
  ...over,
});

describe('buildMorningDigestText', () => {
  it('says nothing when there are no lessons and no deadlines', () => {
    expect(buildMorningDigestText(TODAY, [], [])).toBeNull();
  });

  it('lists lessons in start-time order and deadlines for a single group', () => {
    expect(
      buildMorningDigestText(
        TODAY,
        [lesson(), lesson({ subjectName: 'Фізика', lessonType: 'lab', startTime: '08:30', endTime: '10:05', room: ' ' })],
        [deadline()],
      ),
    ).toBe(
      [
        '☀️ Доброго ранку! Сьогодні вт, 27 жовтня',
        '',
        '📚 <b>Пари</b>',
        '<b>08:30–10:05</b> · Фізика · Лабораторна',
        '<b>10:25–12:00</b> · Операційні системи · Лекція · 📍 18-511',
        '',
        '⏳ <b>Дедлайни сьогодні</b>',
        '• <b>Лаба 3</b> · Бази даних',
      ].join('\n'),
    );
  });

  it('prefixes the group name when lessons come from several groups', () => {
    const text = buildMorningDigestText(
      TODAY,
      [lesson({ groupName: 'ІП-31' }), lesson({ groupName: 'ІП-32', subjectName: 'Англійська', startTime: '12:20' })],
      [deadline({ groupName: 'ІП-32' })],
    )!;
    expect(text).toContain('<b>10:25–12:00</b> · <i>ІП-31</i> · Операційні системи');
    expect(text).toContain('· <i>ІП-32</i> · Англійська');
    expect(text).toContain('• <i>ІП-32</i> · <b>Лаба 3</b>');
  });

  it('shows the deadline time only when it is not the 23:59 default', () => {
    const text = buildMorningDigestText(TODAY, [], [deadline(), deadline({ title: 'Есе', deadline: new Date(2026, 9, 27, 18, 0) })])!;
    expect(text).not.toContain('📚');
    expect(text).toContain('• <b>Есе</b> · Бази даних · до 18:00');
    expect(text.endsWith('• <b>Лаба 3</b> · Бази даних')).toBe(true);
    expect(text.indexOf('Есе')).toBeLessThan(text.indexOf('Лаба 3')); // earlier cut-off first
  });

  it('escapes HTML', () => {
    const text = buildMorningDigestText(TODAY, [lesson({ subjectName: 'C++ <STL>', groupName: 'A&B' })], [deadline({ title: '<b>x</b>' })])!;
    expect(text).toContain('C++ &lt;STL&gt;');
    expect(text).toContain('<i>A&amp;B</i>');
    expect(text).toContain('<b>&lt;b&gt;x&lt;/b&gt;</b>');
  });

  it('stays under the Telegram limit and says how many were cut', () => {
    const many = Array.from({ length: 80 }, (_, i) => deadline({ title: `${'Дуже довга назва завдання '.repeat(4)}${i}` }));
    const text = buildMorningDigestText(TODAY, [lesson()], many)!;
    expect(text.length).toBeLessThan(4096);
    const cut = Number(text.match(/…і ще (\d+)$/)![1]);
    expect(text.split('\n').filter((l) => l.startsWith('• ')).length + cut).toBe(80);
  });
});

import { normaliseSchedule, parseDates, parseLecturerSchedule } from './campus.service';

describe('parseDates', () => {
  it('sorts and dedupes calendar days', () => {
    expect(parseDates(['2026-11-25', '2026-11-11', '2026-11-25'])).toEqual(['2026-11-11', '2026-11-25']);
  });

  it('takes the date part of a longer ISO timestamp', () => {
    expect(parseDates(['2026-11-11T00:00:00.000Z', '2026-11-11'])).toEqual(['2026-11-11']);
  });

  it('drops anything else', () => {
    expect(parseDates(['завтра', '', null, 20261111, '2026-11-1', '2026-11-111', '11.11.2026', '2026-11-25'])).toEqual([
      '2026-11-25',
    ]);
  });

  it('reads a missing or malformed field as no dates', () => {
    expect(parseDates(undefined)).toEqual([]);
    expect(parseDates(null)).toEqual([]);
    expect(parseDates('2026-11-11')).toEqual([]);
  });
});

describe('Campus pairs keep their dates', () => {
  // ІП-55's Wednesday 14:15 (group 5627): rows of one slot that differ only by dates.
  const pair = (dates: unknown) => ({
    lecturer: { id: '1f156e82', name: 'Рощенко Сергій Віталійович' },
    type: 'Лек',
    time: '14:15:00',
    name: 'Основи національного спротиву',
    location: null,
    tag: 'lec',
    dates,
  });

  it('in a group schedule, row by row', () => {
    const items = normaliseSchedule({
      groupCode: '5627',
      scheduleFirstWeek: [{ day: 'Ср', pairs: [pair(['2026-10-14']), pair(['2026-11-25', '2026-11-11']), pair([])] }],
      scheduleSecondWeek: [],
    });
    expect(items.map((i) => i.dates)).toEqual([['2026-10-14'], ['2026-11-11', '2026-11-25'], []]);
    expect(items[0]).toMatchObject({ dayOfWeek: 3, weekType: 1, lessonNumber: 4, startTime: '14:15', endTime: '15:50' });
  });

  it('in a lecturer schedule, on the row of every group of a pair', () => {
    const items = parseLecturerSchedule({
      lecturerId: 'x',
      scheduleFirstWeek: [
        {
          day: 'Пн',
          pairs: [
            {
              groups: [
                { id: 5627, name: 'ІП-55' },
                { id: 5628, name: 'ІП-56' },
              ],
              type: 'Лек',
              time: '14:15:00',
              name: 'Проєктування алгоритмів',
              location: null,
              tag: 'lec',
              dates: ['2026-10-26', '2026-10-12'],
            },
          ],
        },
      ],
      scheduleSecondWeek: [],
    });
    expect(items.map((i) => [i.groupName, i.dates])).toEqual([
      ['ІП-55', ['2026-10-12', '2026-10-26']],
      ['ІП-56', ['2026-10-12', '2026-10-26']],
    ]);
  });

  it('in the flat-list fallback', () => {
    const [item] = normaliseSchedule([{ name: 'ОС', dayOfWeek: 3, dates: ['2026-10-14'] }]);
    expect(item.dates).toEqual(['2026-10-14']);
    expect(normaliseSchedule([{ name: 'ОС', dayOfWeek: 3 }])[0].dates).toEqual([]);
  });
});

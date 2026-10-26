import { utcDay } from './attendance.service';

describe('utcDay', () => {
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  it('keeps a plain day', () => {
    expect(iso(utcDay(new Date('2026-10-26')))).toBe('2026-10-26');
  });

  it('files a Kyiv local midnight (old clients) on that day, not the previous one', () => {
    expect(iso(utcDay(new Date('2026-10-25T22:00:00.000Z')))).toBe('2026-10-26'); // UTC+2
    expect(iso(utcDay(new Date('2026-09-14T21:00:00.000Z')))).toBe('2026-09-15'); // UTC+3
  });

  it('keeps the journal grid dates (UTC midnight)', () => {
    expect(utcDay(new Date('2026-10-26T00:00:00.000Z')).toISOString()).toBe('2026-10-26T00:00:00.000Z');
  });
});

/** `dates` are the only ISO days a Campus row runs on; without them it runs every week of its parity. */
export function runsOn(l: { dates?: string[] }, day: string): boolean {
  return !l.dates?.length || l.dates.includes(day);
}

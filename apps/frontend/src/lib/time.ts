/** «щойно» / «12 хв тому» / «2 год тому» / «3 дні тому», as in the mockups. */
export function timeAgo(iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (min < 1) return 'щойно';
  if (min < 60) return `${min} хв тому`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} год тому`;
  const d = Math.round(h / 24);
  const mod10 = d % 10;
  const mod100 = d % 100;
  const word = mod10 === 1 && mod100 !== 11 ? 'день' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'дні' : 'днів';
  return `${d} ${word} тому`;
}

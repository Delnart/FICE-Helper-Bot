/**
 * Shorten a Ukrainian/Russian/English personal name to surname + initials.
 * "Бурлака Микита Олегович" → "Бурлака М.О."
 * "Smith Jane Anne"          → "Smith J.A."
 * "Сидоренко"                 → "Сидоренко"
 * Empty / single-token names are returned as-is.
 */
export function shortenName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return full.trim();
  const surname = parts[0];
  const initials = parts
    .slice(1)
    .map((p) => {
      const ch = [...p][0];
      return ch ? ch.toUpperCase() + '.' : '';
    })
    .join('');
  return initials ? `${surname} ${initials}` : surname;
}

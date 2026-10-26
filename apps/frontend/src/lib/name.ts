/**
 * Shorten a Ukrainian/Russian/English personal name to surname + initials.
 * "Бурлака Микита Олегович" → "Бурлака М. О."
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
    .filter(Boolean)
    .join(' '); // "О. В." as in the mockups
  return initials ? `${surname} ${initials}` : surname;
}

/**
 * Short label for a subject without a short name (journal columns, homework chips):
 * "Операційні системи" → "ОС", "Алгоритми та структури даних" → "АСД", "Фізика" → "Фіз"
 * ("Фізика" with keepOneWord, for chips that truncate anyway).
 */
export function subjectAcronym(name: string, keepOneWord = false): string {
  const words = name.split(/[\s\-–—.,()]+/).filter((w) => w.length > 2);
  if (words.length < 2) return keepOneWord ? name.trim() : name.trim().slice(0, 3);
  return words.map((w) => w[0].toUpperCase()).join('').slice(0, 4);
}

/** Two-letter avatar initials: "Коваль Марія" → "КМ", "Andrii" → "AN". */
export function initials(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const letters = parts.length === 1 ? [...parts[0]].slice(0, 2) : parts.slice(0, 2).map((p) => [...p][0]);
  return letters.join('').toUpperCase();
}

/**
 * Ukrainian vocative of a first name for greetings, as in the mockups:
 * "Оксана" → "Оксано", "Марія" → "Маріє", "Андрій" → "Андрію", "Іван" → "Іване",
 * "Олег" → "Олегу", "Дмитро" → "Дмитре". Non-Cyrillic names stay as they are.
 */
// ponytail: suffix rules cover common first names; rare forms may stay nominative.
export function vocative(name: string): string {
  const n = name.trim();
  if (!/^[А-ЩЬЮЯҐЄІЇа-щьюяґєії'’ʼ-]+$/.test(n) || n.length < 3) return n;
  const rules: Array<[RegExp, string]> = [
    [/ія$/, 'іє'],
    [/я$/, 'ю'],
    [/а$/, 'о'],
    [/й$/, 'ю'],
    [/ко$/, 'ку'],
    [/о$/, 'е'],
    [/([гкхжчшщ])$/, '$1у'],
    [/([бвдзлмнпрстфц])$/, '$1е'],
  ];
  for (const [re, to] of rules) if (re.test(n)) return n.replace(re, to);
  return n;
}

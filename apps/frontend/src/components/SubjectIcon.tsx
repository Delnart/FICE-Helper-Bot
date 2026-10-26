import { cn } from '../lib/cn';
import { Icon, type IconName } from './icons';

/** Icons a discipline tile can show (also the picker set in the subject editor). */
export const SUBJECT_ICONS = [
  'cpu',
  'database',
  'code',
  'sigma',
  'globe',
  'chat',
  'graph',
  'braces',
  'dice',
  'flask',
  'stack',
  'bookOpen',
  'book',
] as const satisfies readonly IconName[];
export type SubjectIconName = (typeof SUBJECT_ICONS)[number];

export const SUBJECT_ICON_LABELS: Record<SubjectIconName, string> = {
  cpu: 'Процесор',
  database: 'База даних',
  code: 'Код',
  sigma: 'Математика',
  globe: 'Мережі',
  chat: 'Мова',
  graph: 'Алгоритми',
  braces: 'Програмування',
  dice: 'Ймовірності',
  flask: 'Наука',
  stack: 'Архітектура',
  bookOpen: 'Гуманітарне',
  book: 'Інше',
};

// First match wins, so the more specific stems go first.
const RULES: Array<[RegExp, SubjectIconName]> = [
  [/ймовірн|статист|probab|statist/i, 'dice'],
  [/баз[аи] даних|^бд$|sql|database/i, 'database'],
  [/алгоритм|структур[аи] даних|граф|algorithm/i, 'graph'],
  [/архітектур|апаратн|комп.ютерн[аі] систем|hardware/i, 'stack'],
  [/операційн|мікропроц|схемотех|електрон|cpu/i, 'cpu'],
  [/мереж|network|інтернет|кібер|cyber|безпек/i, 'globe'],
  [/обʼєктн|об'єктн|об’єктн|^ооп$|oop|java|c\+\+|c#|python|програмуванн/i, 'braces'],
  [/веб|web|розробк|програмн|software|тестуванн|devops|front|back/i, 'code'],
  [/матем|аналіз|алгебр|дискретн|обчислюв|чисельн|геометр|логік|math|calculus/i, 'sigma'],
  [/мова|мови|англ|english|іноземн|українськ|language/i, 'chat'],
  [/фізик|хімі|біолог|еколог|physics|chem/i, 'flask'],
  [/істор|філософ|право|економ|культур|психолог|соціолог|менеджм|history|philosoph/i, 'bookOpen'],
];

export function subjectIcon(name: string, override?: string | null): SubjectIconName {
  if (override && (SUBJECT_ICONS as readonly string[]).includes(override)) return override as SubjectIconName;
  return RULES.find(([re]) => re.test(name))?.[1] ?? 'book';
}

/** Discipline tile: an icon picked from the subject's name — never initials. */
export function SubjectTile({
  name,
  icon,
  size = 'md',
  tone = 'soft',
  className,
}: {
  name: string;
  icon?: string | null;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'soft' | 'ink' | 'accent';
  className?: string;
}) {
  return (
    <span
      className={cn(
        'subj',
        size === 'sm' && 'subj-sm',
        size === 'lg' && 'subj-lg',
        tone === 'ink' && 'subj-ink',
        tone === 'accent' && 'subj-accent',
        className,
      )}
      aria-hidden="true"
    >
      <Icon name={subjectIcon(name, icon)} strokeWidth={1.9} />
    </span>
  );
}

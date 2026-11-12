import { Logger } from '@nestjs/common';
import type { CardNode } from './render';

/**
 * Picture cards for the bot's messages, in the look of the Mini App's dark theme («Campus Signal»):
 * Unbounded digits, Onest text, a night ground with lime and violet for what matters. 640px wide, as
 * tall as the content. Each builder takes the same data as the text it illustrates and returns the
 * picture: the bot sends the text, and the picture above it as the message's link preview.
 *
 * Preview every card as a PNG: `CARDS_OUT=some/dir npx jest cards` (see cards.spec.ts).
 */
export interface Card {
  tree: CardNode;
  /** Lessons' online links. Text on a picture cannot be clicked, so they go under it as URL buttons. */
  links?: CardLink[];
}

export interface CardLink {
  label: string;
  url: string;
}

/** A lesson as any of the bot's sources has it: a reminder, a /now slot, a schedule row, a digest line. */
export interface CardLesson {
  subjectName: string;
  /** 'lecture' | 'practice' | 'lab' | 'seminar' | 'other'; reminders and the digest call it `lessonType`. */
  type?: string;
  lessonType?: string;
  startTime: string;
  endTime: string;
  room?: string;
  teacherNames?: string[];
  link?: CardLink;
  lessonNumber?: number;
  /** Set only when the reader is in several groups. */
  groupName?: string;
}

export interface CardDeadline {
  title: string;
  subjectName?: string;
  deadline: Date;
  groupName?: string;
}

type Kid = CardNode | string | number | false | null | undefined | Kid[];
type Style = Record<string, string | number>;

// ── Design tokens (`:root.dark` in apps/frontend/src/styles/globals.css) and the few shared pieces ─
const NIGHT = '#0E1120';
const LIME = '#C9F55B';
const VIOLET = '#5B4DFF';
/** A line on a soft panel, the outline of what is empty or over. */
const LINE = '#2A3050';
const UNBOUNDED = "Unbounded, 'Unbounded Cyr'";

const CSS = `
.card{display:flex;flex-direction:column;box-sizing:border-box;width:640px;padding:40px;background:${NIGHT};color:#F4F5FB;font-family:Onest,'Onest Cyr';font-size:24px;font-weight:500;line-height:1.3;word-break:break-word;position:relative;overflow:hidden}
.row{display:flex;align-items:center}
.col{display:flex;flex-direction:column}
.between{justify-content:space-between}
.grow{flex:1 1 0;min-width:0}
.num{font-family:${UNBOUNDED};font-weight:600;white-space:nowrap}
.b{font-weight:700}
.cut{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.eyebrow{font-size:22px;font-weight:700;line-height:1.2;letter-spacing:0.08em;text-transform:uppercase;white-space:nowrap}
.small{font-size:22px;line-height:1.25}
.muted{color:#A4A9C4}
.faded{color:#8A90AC}
.olive{color:#3A4620}
.head{height:52px;flex-shrink:0;position:relative;z-index:1}
.label{margin-left:14px;font-weight:700;line-height:1.2;white-space:nowrap}
.chip{display:flex;align-items:center;gap:10px;box-sizing:border-box;height:44px;padding:0 18px;border-radius:999px;font-size:22px;font-weight:700;line-height:1;white-space:nowrap;flex-shrink:0}
.dot{width:10px;height:10px;border-radius:999px;background:currentColor;flex-shrink:0}
.gchip{background:#1A1E33;font-weight:600}
.dark{background:${NIGHT};color:${LIME}}
.lime{background:${LIME};color:${NIGHT}}
.ok{background:#153626;color:#4CCB85}
.bad{background:#3F1A20;color:#FF6B7A}
.warn{background:#3A2C12;color:#F2B64A}
.panel{display:flex;flex-direction:column;flex-shrink:0;padding:28px 32px 30px;border-radius:36px}
.soft{background:#1A1E33}
.tile{display:flex;align-items:center;justify-content:center;flex-shrink:0;background:#262552;color:#ADA5FF}
.tag{display:flex;align-items:center;gap:8px;height:40px;padding:0 16px;border-radius:999px;background:#1A1E33;font-size:22px;font-weight:600;line-height:1;white-space:nowrap}
.online{background:#262552;color:#ADA5FF}
.center{display:flex;flex-direction:column;align-items:center;justify-content:center}
.bar{display:flex;flex-shrink:0;border-radius:999px;overflow:hidden}
.avatar{display:flex;align-items:center;justify-content:center;flex-shrink:0;border-radius:999px;background:#262552;color:#ADA5FF;font-family:${UNBOUNDED};font-weight:600;line-height:1}
.slot{box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;flex-shrink:0}
`;

/** h('div.row.between', kids…) → a satori element; hs() takes an inline style first. */
function hs(sel: string, style: Style | null, ...kids: Kid[]): CardNode {
  const [tag, ...cls] = sel.split('.');
  const children = (kids as unknown[]).flat(Infinity as 1).filter((k) => k !== false && k != null && k !== '');
  return {
    type: tag || 'div',
    props: {
      ...(cls.length ? { className: cls.join(' ') } : {}),
      ...(style ? { style } : {}),
      ...(children.length ? { children: children.length === 1 ? children[0] : children } : {}),
    },
  };
}
const h = (sel: string, ...kids: Kid[]): CardNode => hs(sel, null, ...kids);

/** Line icons of the Mini App (apps/frontend/src/components/icons.tsx), 24×24, stroke = text colour. */
const ICONS = {
  pin: '<path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  video: '<rect x="3" y="7" width="13" height="10" rx="2"/><path d="M16 10l5-3v10l-5-3"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  swap: '<path d="M4 8h15m0 0l-4-4m4 4l-4 4"/><path d="M20 16H5m0 0l4-4m-4 4l4 4"/>',
  arrowRight: '<path d="M5 12h14m0 0l-6-6m6 6l-6 6"/>',
  arrowDown: '<path d="M12 5v14m0 0l-6-6m6 6l6-6"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.2L4 21l1.8-5.4A8 8 0 1 1 21 12z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1.2" fill="currentColor"/><circle cx="4" cy="12" r="1.2" fill="currentColor"/><circle cx="4" cy="18" r="1.2" fill="currentColor"/>',
  // Subject glyphs
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  database:
    '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
  sigma: '<path d="M17 5H7l6 7-6 7h10"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  graph:
    '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M10.8 7.2L6.2 16.8M13.2 7.2l4.6 9.6"/>',
  braces:
    '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1"/><path d="M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1"/>',
  dice: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/>',
  flask: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3"/><path d="M7.5 15h9"/>',
  stack:
    '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  bookOpen: '<path d="M3 5h6a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H3z"/><path d="M21 5h-6a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h7z"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
};
type IconName = keyof typeof ICONS;

function icon(name: IconName, size: number, strokeWidth = 2): CardNode {
  const shapes = [...ICONS[name].matchAll(/<(\w+)([^>]*)\/>/g)].map(([, type, attrs]) => ({
    type,
    props: Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v])),
  }));
  return {
    type: 'svg',
    props: {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': strokeWidth,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      style: { flexShrink: 0 },
      children: shapes,
    },
  };
}

/** The same name → icon rules as the Mini App's subject tiles (components/SubjectIcon.tsx). */
const SUBJECT_ICON: Array<[RegExp, IconName]> = [
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
const subjectTile = (name: string, size: number): CardNode =>
  hs(
    'div.tile',
    { width: size, height: size, borderRadius: Math.round(size * 0.3) },
    icon(SUBJECT_ICON.find(([re]) => re.test(name))?.[1] ?? 'book', size / 2, 1.9),
  );

/** Brand mark: the letter F whose middle bar is a lime "signal". */
const LOGO: CardNode = {
  type: 'svg',
  props: {
    width: 52,
    height: 52,
    viewBox: '0 0 512 512',
    style: { flexShrink: 0 },
    children: [
      { type: 'rect', props: { width: 512, height: 512, rx: 142, fill: VIOLET } },
      { type: 'rect', props: { x: 138, y: 144, width: 52, height: 224, rx: 26, fill: '#FFFFFF' } },
      { type: 'rect', props: { x: 138, y: 144, width: 236, height: 52, rx: 26, fill: '#FFFFFF' } },
      { type: 'rect', props: { x: 206, y: 250, width: 168, height: 52, rx: 26, fill: LIME } },
    ],
  },
};

/** Every card: the night ground, the mark and what the card is on the left, the group on the right. */
const card = (label: string, chip: string | undefined, ...kids: Kid[]): CardNode =>
  h(
    'div.card',
    h('style', CSS),
    h('div.row.between.head', h('div.row', LOGO, h('div.label', label)), chip && h('div.chip.gchip', chip)),
    kids,
  );
/** The pale disc behind the top right corner of a card that has no lessons to show. */
const disc = (top: number): CardNode =>
  hs('div', { position: 'absolute', left: 450, top, width: 300, height: 300, borderRadius: 999, background: '#151A2C' });

const dotChip = (cls: string, text: string): CardNode => h(`div.chip.${cls}`, h('div.dot'), text);
const big = (size: number, lineHeight: number, extra: Style = {}): Style => ({
  fontSize: size,
  lineHeight: `${lineHeight}px`,
  letterSpacing: '-0.03em',
  ...extra,
});
const bar = (pct: number, height: number, track: string, fill: string, style: Style = {}): CardNode =>
  hs(
    'div.bar',
    { height, background: track, ...style },
    hs('div', { width: `${pct}%`, height: '100%', borderRadius: 999, background: fill }),
  );

// ── Words ─────────────────────────────────────────────────────────────────────────────────────────
const TYPE: Record<string, [full: string, short: string]> = {
  lecture: ['Лекція', 'лек'],
  practice: ['Практика', 'прак'],
  lab: ['Лабораторна', 'лаб'],
  seminar: ['Семінар', 'сем'],
};
const ORDINAL = ['', '1-ша', '2-га', '3-тя', '4-та', '5-та', '6-та', '7-ма', '8-ма'];

const typeOf = (l: CardLesson, short = false): string | undefined => TYPE[l.type ?? l.lessonType ?? '']?.[short ? 1 : 0];
const room = (l: CardLesson): string | undefined => l.room?.trim() || undefined;
const dots = (...parts: Array<string | false | null | undefined>): string => parts.filter(Boolean).join(' · ');
const toMin = (hhmm: string): number => {
  const [hh, mm] = hhmm.split(':').map(Number);
  return hh * 60 + mm;
};
const minuteOfDay = (d: Date): number => d.getHours() * 60 + d.getMinutes();
/** 15 → «15 хв», 125 → «2 год 5 хв». */
export const span = (mins: number): string => (mins < 60 ? `${mins} хв` : `${Math.floor(mins / 60)} год${mins % 60 ? ` ${mins % 60} хв` : ''}`);
const plural = (n: number, one: string, few: string, many: string): string => {
  const m10 = n % 10;
  const m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};
export const pairs = (n: number): string => `${n} ${plural(n, 'пара', 'пари', 'пар')}`;
const uk = (d: Date, opts: Intl.DateTimeFormatOptions): string => d.toLocaleDateString('uk-UA', opts);
const hhmm = (d: Date): string => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
/** «🔥 Олена Бондар» → «ОБ»: the first letter of the first two words that have one. */
const initials = (name: string): string =>
  name
    .split(/\s+/)
    .flatMap((w) => w.match(/\p{L}/u) ?? [])
    .slice(0, 2)
    .join('')
    .toUpperCase();

/** The buttons under a card: one for each lesson with a link, named after its subject when there are several lessons. */
const linkButtons = (lessons: Array<{ subjectName: string; link?: CardLink }>): CardLink[] | undefined => {
  const buttons = lessons.flatMap((l) =>
    l.link ? [{ label: dots(lessons.length > 1 && l.subjectName, l.link.label.trim() || 'Онлайн'), url: l.link.url }] : [],
  );
  return buttons.length ? buttons : undefined;
};

/** Calendar leaf: the day big, the month under it. */
const leaf = (d: Date): CardNode =>
  hs(
    'div.soft.center',
    { width: 112, height: 112, borderRadius: 28, gap: 2, flexShrink: 0 },
    hs('div.num', { fontSize: 44, lineHeight: '46px' }, d.getDate()),
    hs('div.eyebrow', { color: '#ADA5FF' }, uk(d, { month: 'short' }).slice(0, 3)),
  );

const logger = new Logger('Cards');
/**
 * Cards are best effort: a builder that trips over data nobody expected returns nothing, and the sender
 * goes on with the text (BotService.sendCard).
 */
const safe =
  <A extends unknown[]>(build: (...args: A) => Card | undefined) =>
  (...args: A): Card | undefined => {
    try {
      return build(...args);
    } catch (err) {
      logger.error(`${build.name} failed, the text goes out instead: ${(err as Error).stack}`);
      return undefined;
    }
  };

// ── Lessons: reminder, /now, /left ────────────────────────────────────────────────────────────────

/** «Через 10 хв пара»: one lesson gets the whole card, several (subgroups, electives) share it. */
export const lessonReminderCard = safe(function lessonReminderCard(
  group: string | undefined,
  minutesLeft: number,
  lessons: CardLesson[],
): Card {
  const sorted = [...lessons].sort((a, b) => a.subjectName.localeCompare(b.subjectName, 'uk'));
  const [first] = sorted;
  const soon = dotChip('dark', `через ${span(minutesLeft)}`);

  if (sorted.length === 1) {
    const teachers = first.teacherNames?.join(', ');
    return {
      tree: card(
        'Нагадування',
        group,
        hs(
          'div.panel.lime',
          { marginTop: 28 },
          h(
            'div.row.between',
            soon,
            ORDINAL[first.lessonNumber ?? 0] && h('div.small.b.olive', `${ORDINAL[first.lessonNumber ?? 0]} пара`),
          ),
          hs('div.num', big(124, 108, { marginTop: 20 }), first.startTime),
          hs('div.num.olive', { marginTop: 12, fontSize: 26, lineHeight: '32px', fontWeight: 500 }, `до ${first.endTime}`),
        ),
        hs(
          'div.row',
          { marginTop: 28, gap: 18 },
          subjectTile(first.subjectName, 80),
          hs(
            'div.col.grow',
            { gap: 10 },
            hs('div.b', { fontSize: 36, lineHeight: 1.15, letterSpacing: '-0.01em', lineClamp: 2 }, first.subjectName),
            (typeOf(first) || first.link) &&
              hs(
                'div.row',
                { gap: 8 },
                typeOf(first) && h('div.tag', typeOf(first)),
                first.link && h('div.tag.online', icon('video', 22), first.link.label.trim() || 'Онлайн'),
              ),
          ),
        ),
        (room(first) || teachers) &&
          hs(
            'div.row',
            { marginTop: 30, paddingTop: 22, borderTop: '2px solid #262B45', gap: 32 },
            room(first) &&
              hs(
                'div.row.muted',
                { gap: 12, flexShrink: 0 },
                icon('pin', 28),
                hs('div.num', { fontSize: 26, lineHeight: '32px', fontWeight: 500, color: '#F4F5FB' }, room(first)),
              ),
            teachers &&
              hs(
                'div.row.muted.grow',
                { gap: 12 },
                icon('user', 28),
                hs('div.cut.grow', { fontSize: 26, lineHeight: '32px', fontWeight: 600, color: '#F4F5FB' }, teachers),
              ),
          ),
      ),
      links: linkButtons(sorted),
    };
  }

  const sameEnd = sorted.every((l) => l.endTime === first.endTime);
  const shown = sorted.slice(0, 6);
  return {
    tree: card(
      'Нагадування',
      group,
      hs(
        'div.panel.lime',
        { marginTop: 28, padding: '26px 32px 28px' },
        h('div.row.between', soon, h('div.small.b.olive', `${pairs(sorted.length)} одночасно`)),
        hs(
          'div.row',
          { marginTop: 16, gap: 12, alignItems: 'baseline' },
          hs('div.num', big(84, 76), first.startTime),
          sameEnd && hs('div.num.olive', { fontSize: 30, lineHeight: '36px', fontWeight: 500 }, `–${first.endTime}`),
        ),
      ),
      hs(
        'div.col',
        { marginTop: 14, gap: 10 },
        shown.map((l) =>
          hs(
            'div.row.soft',
            { gap: 16, padding: '18px 20px', borderRadius: 24 },
            subjectTile(l.subjectName, 60),
            hs(
              'div.col.grow',
              { gap: 4 },
              hs('div.b.cut', { fontSize: 26, lineHeight: 1.2 }, l.subjectName),
              h(
                'div.small.muted.cut',
                dots(typeOf(l), l.teacherNames?.join(', '), !sameEnd && `до ${l.endTime}`, room(l) && l.link?.label.trim()) || '—',
              ),
            ),
            room(l)
              ? hs(
                  'div.num.row',
                  {
                    height: 44,
                    padding: '0 14px',
                    borderRadius: 14,
                    border: '2px solid #333A57',
                    fontSize: 20,
                    lineHeight: 1,
                    fontWeight: 500,
                    flexShrink: 0,
                  },
                  room(l),
                )
              : l.link &&
                  hs('div.tag.online', { height: 44, borderRadius: 14, flexShrink: 0 }, icon('video', 22), l.link.label.trim() || 'Онлайн'),
          ),
        ),
        sorted.length > shown.length && hs('div.small.muted', { marginTop: 4 }, `…і ще ${sorted.length - shown.length}`),
      ),
    ),
    links: linkButtons(sorted),
  };
});

/** The block for «nothing is on, the next lesson is…», shared by /now and /left. */
function breakCard(chip: string, next: CardLesson, now: Date): CardNode {
  return card(
    'Зараз',
    chip,
    hs('div.num', { marginTop: 36, fontSize: 38, lineHeight: '46px', letterSpacing: '-0.01em', whiteSpace: 'normal' }, 'Зараз пари немає'),
    hs(
      'div.panel.soft',
      { marginTop: 26 },
      h(
        'div.row.between',
        h('div.eyebrow.muted', 'Далі'),
        dotChip('lime', `через ${span(Math.max(0, toMin(next.startTime) - minuteOfDay(now)))}`),
      ),
      hs(
        'div.row',
        { marginTop: 16, gap: 14, alignItems: 'baseline' },
        hs('div.num', big(96, 86, { color: LIME }), next.startTime),
        hs('div.num.muted', { fontSize: 30, lineHeight: '36px', fontWeight: 500 }, `–${next.endTime}`),
      ),
      hs(
        'div.row',
        { marginTop: 22, gap: 16 },
        subjectTile(next.subjectName, 64),
        hs(
          'div.col.grow',
          { gap: 4 },
          hs('div.b', { fontSize: 32, lineHeight: 1.15, letterSpacing: '-0.01em', lineClamp: 2 }, next.subjectName),
          dots(typeOf(next), room(next)) && h('div.small.muted.cut', dots(typeOf(next), room(next))),
        ),
      ),
    ),
  );
}

/** «Сьогодні пар більше немає», shared by /now and /left. */
function dayDoneCard(chip: string): CardNode {
  return card(
    'Сьогодні',
    chip,
    disc(-20),
    hs('div.center.lime', { marginTop: 36, width: 96, height: 96, borderRadius: 999, position: 'relative' }, icon('check', 48, 2.6)),
    hs(
      'div.num',
      { marginTop: 26, fontSize: 60, lineHeight: '64px', letterSpacing: '-0.02em', whiteSpace: 'normal', position: 'relative' },
      'На сьогодні все',
    ),
    hs('div.muted', { marginTop: 12, fontSize: 26, fontWeight: 600, position: 'relative' }, 'Сьогодні пар більше немає'),
  );
}

/** /now: every lesson that is on (subgroups run in parallel), then the next one. */
export const nowCard = safe(function nowCard(
  group: string,
  weekType: 1 | 2,
  running: Array<{ lesson: CardLesson; link?: CardLink }>,
  next: CardLesson | null,
  now: Date,
): Card {
  const chip = `${group} · ${weekType === 1 ? 'I' : 'II'} тиждень`;
  if (!running.length) return { tree: next ? breakCard(chip, next, now) : dayDoneCard(chip) };

  const at = minuteOfDay(now);
  // Two rows of one subject with the same room and link read as one lesson, as in the text.
  const unique = [
    ...new Map(running.map((r) => [[r.lesson.subjectName, r.lesson.endTime, room(r.lesson), r.link?.url].join('|'), r])).values(),
  ];
  return {
    tree: card(
      'Зараз',
      chip,
      unique.slice(0, 3).map(({ lesson: l, link }, i) => {
        const start = toMin(l.startTime);
        const end = toMin(l.endTime);
        return hs(
          'div.panel.lime',
          { marginTop: i ? 14 : 34 },
          hs(
            'div.row.between',
            { height: 48 },
            hs('div.num', { fontSize: 40, lineHeight: '48px', letterSpacing: '-0.02em' }, `${l.startTime}–${l.endTime}`),
            dotChip('dark', `ще ${span(Math.max(0, end - at))}`),
          ),
          hs('div.b', { marginTop: 18, fontSize: 40, lineHeight: 1.1, letterSpacing: '-0.01em', lineClamp: 2 }, l.subjectName),
          dots(typeOf(l), room(l), link?.label.trim()) &&
            hs('div.olive.cut', { marginTop: 8, fontWeight: 600 }, dots(typeOf(l), room(l), link?.label.trim())),
          bar(Math.min(100, Math.max(0, ((at - start) / Math.max(1, end - start)) * 100)), 12, '#A9CF4F', NIGHT, { marginTop: 22 }),
        );
      }),
      next &&
        hs(
          'div.panel.soft',
          { marginTop: 14, padding: '24px 28px 26px', borderRadius: 32, gap: 14 },
          h(
            'div.row.between',
            h('div.eyebrow.muted', 'Далі'),
            hs('div.small.muted', { fontWeight: 600 }, `через ${span(Math.max(0, toMin(next.startTime) - at))}`),
          ),
          hs(
            'div.row',
            { gap: 20 },
            hs('div.num', { fontSize: 34, lineHeight: '38px', color: LIME, flexShrink: 0 }, next.startTime),
            hs(
              'div.col.grow',
              { gap: 2 },
              hs('div.b.cut', { fontSize: 30, lineHeight: 1.2 }, next.subjectName),
              h('div.small.muted.cut', dots(typeOf(next), `до ${next.endTime}`, room(next))),
            ),
          ),
        ),
    ),
    links: linkButtons(unique.map((r) => ({ subjectName: r.lesson.subjectName, link: r.link }))),
  };
});

/** /left: minutes to the end of the lesson that is on. */
export const leftCard = safe(function leftCard(group: string, current: CardLesson | null, next: CardLesson | null, now: Date): Card {
  if (!current) return { tree: next ? breakCard(group, next, now) : dayDoneCard(group) };

  const start = toMin(current.startTime);
  const end = toMin(current.endTime);
  const left = Math.max(0, end - minuteOfDay(now));
  return {
    tree: card(
      'До кінця пари',
      group,
      hs(
        'div.row.between',
        { marginTop: 38, alignItems: 'flex-end' },
        hs(
          'div.row',
          { gap: 14, alignItems: 'baseline', color: LIME },
          // Three digits (a double lesson) still have to fit beside «до 12:00».
          hs('div.num', left < 100 ? big(200, 160, { letterSpacing: '-0.04em' }) : big(140, 160, { letterSpacing: '-0.04em' }), left),
          hs('div.num', { fontSize: 56, lineHeight: '56px', fontWeight: 500 }, 'хв'),
        ),
        hs(
          'div.col',
          { alignItems: 'flex-end', gap: 2 },
          h('div.eyebrow.muted', 'до'),
          hs('div.num', { fontSize: 34, lineHeight: '40px' }, current.endTime),
        ),
      ),
      bar(Math.min(100, Math.max(0, ((minuteOfDay(now) - start) / Math.max(1, end - start)) * 100)), 14, '#1A1E33', LIME, {
        marginTop: 26,
      }),
      hs(
        'div.row',
        { marginTop: 28, gap: 18 },
        subjectTile(current.subjectName, 72),
        hs(
          'div.col.grow',
          { gap: 4 },
          hs('div.b', { fontSize: 34, lineHeight: 1.15, letterSpacing: '-0.01em', lineClamp: 2 }, current.subjectName),
          dots(typeOf(current), room(current)) && h('div.muted.cut', dots(typeOf(current), room(current))),
        ),
      ),
    ),
  };
});

// ── Schedule: /today, /tomorrow, morning digest ───────────────────────────────────────────────────

/** A day without lessons: the weekday, why it is free and where it sits in its week. */
function dayFreeCard(label: string, chip: string, weekday: string, date: Date): CardNode {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7));
  return card(
    label,
    chip,
    disc(-60),
    hs('div.num', { marginTop: 36, fontSize: 64, lineHeight: '68px', letterSpacing: '-0.02em', position: 'relative' }, weekday),
    hs(
      'div.muted',
      { marginTop: 8, fontSize: 28, fontWeight: 600, position: 'relative' },
      date.getDay() === 0 ? 'Вихідний — пар немає' : 'Пар немає',
    ),
    hs(
      'div.row',
      { marginTop: 30, gap: 12, position: 'relative' },
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
        const on = d.getDate() === date.getDate();
        return hs(
          `div.center.grow.${on ? 'lime' : 'soft'}`,
          { height: 84, borderRadius: 22, gap: 4 },
          hs(`div.eyebrow${on ? '' : '.muted'}`, { letterSpacing: '0.04em' }, uk(d, { weekday: 'short' })),
          hs('div.num', { fontSize: 24, lineHeight: '28px' }, d.getDate()),
        );
      }),
    ),
  );
}

/**
 * /today and /tomorrow. `weekday` is the handler's label («Середа»); with `now` (today only) the
 * lessons that are over are dimmed and the one that is on stands out.
 */
export const dayCard = safe(function dayCard(
  group: string,
  kind: 'today' | 'tomorrow',
  weekday: string,
  date: Date,
  weekType: 1 | 2,
  lessons: CardLesson[],
  now?: Date,
): Card {
  const label = kind === 'today' ? 'Сьогодні' : 'Завтра';
  if (!lessons.length) return { tree: dayFreeCard(label, group, weekday, date) };

  const at = now ? minuteOfDay(now) : -1;
  const times = (l: CardLesson, startColor?: string, endColor?: string): CardNode =>
    hs(
      'div.col',
      { width: 118, gap: 2, flexShrink: 0 },
      hs('div.num', { fontSize: 28, lineHeight: '32px', ...(startColor ? { color: startColor } : {}) }, l.startTime),
      hs('div.num', { fontSize: 20, lineHeight: '24px', fontWeight: 500, ...(endColor ? { color: endColor } : {}) }, l.endTime),
    );
  const name = (l: CardLesson, style: Style = {}): CardNode =>
    hs('div.b', { fontSize: 28, lineHeight: 1.2, lineClamp: 2, ...style }, l.subjectName);

  return {
    tree: card(
      label,
      group,
      hs(
        'div.row.between',
        { marginTop: 30 },
        hs(
          'div.col',
          { gap: 8 },
          hs('div.num', { fontSize: 60, lineHeight: '64px', letterSpacing: '-0.02em' }, weekday),
          hs('div.muted', { fontSize: 26 }, `${weekType === 1 ? 'I' : 'II'} тиждень · ${pairs(lessons.length)}`),
        ),
        leaf(date),
      ),
      hs(
        'div.col',
        { marginTop: 28, gap: 10 },
        lessons.map((l) => {
          const meta = dots(typeOf(l), room(l));
          // Over: an outline. On: the lime block, as in /now. Ahead: a soft panel.
          if (at >= toMin(l.endTime)) {
            return hs(
              'div.row.faded',
              { gap: 18, padding: '16px 20px', borderRadius: 24, border: `2px solid ${LINE}` },
              times(l),
              hs('div.col.grow', { gap: 4 }, name(l), meta && h('div.small.cut', meta)),
              icon('check', 28, 2.2),
            );
          }
          if (at >= toMin(l.startTime)) {
            const start = toMin(l.startTime);
            const end = toMin(l.endTime);
            return hs(
              'div.col.lime',
              { gap: 16, padding: '20px 22px 22px', borderRadius: 24 },
              hs(
                'div.row',
                { gap: 18 },
                times(l, undefined, '#3A4620'),
                hs(
                  'div.col.grow',
                  null,
                  hs('div.row.eyebrow', { gap: 10 }, h('div.dot'), `зараз · ще ${span(end - at)}`),
                  name(l, { marginTop: 6 }),
                  meta && hs('div.small.olive.cut', { marginTop: 4 }, meta),
                ),
              ),
              bar(((at - start) / Math.max(1, end - start)) * 100, 8, '#A9CF4F', NIGHT),
            );
          }
          return hs(
            'div.row.soft',
            { gap: 18, padding: '18px 22px', borderRadius: 24 },
            times(l, undefined, '#A4A9C4'),
            hs('div.col.grow', { gap: 4 }, name(l), meta && h('div.small.muted.cut', meta)),
          );
        }),
      ),
    ),
  };
});

/** 08:00 DM: today's lessons and deadlines. `group` is the header chip for a reader in one group. */
export const digestCard = safe(function digestCard(today: Date, lessons: CardLesson[], deadlines: CardDeadline[], group?: string): Card {
  const byStart = [...lessons].sort((a, b) => a.startTime.localeCompare(b.startTime));
  const byTime = [...deadlines].sort((a, b) => a.deadline.getTime() - b.deadline.getTime());
  const section = (title: string, rows: CardNode[], total: number): Kid => [
    hs('div.eyebrow.muted', { marginTop: 22 }, title),
    hs(
      'div.col.soft',
      { marginTop: 12, padding: '6px 22px', borderRadius: 28 },
      rows.map((r, i) => hs('div.col', i ? { borderTop: `1.5px solid ${LINE}` } : null, r)),
      total > rows.length && hs('div.small.muted', { padding: '12px 0', borderTop: `1.5px solid ${LINE}` }, `…і ще ${total - rows.length}`),
    ),
  ];

  return {
    tree: card(
      'Ранковий дайджест',
      group,
      hs(
        'div.panel.lime',
        { marginTop: 24, position: 'relative', overflow: 'hidden' },
        hs('div', { position: 'absolute', left: 450, top: -60, width: 140, height: 140, borderRadius: 999, background: '#B8E64A' }),
        hs(
          'div.eyebrow.olive',
          { letterSpacing: '0.06em', position: 'relative' },
          uk(today, { weekday: 'long', day: 'numeric', month: 'long' }),
        ),
        hs(
          'div.num',
          { marginTop: 10, fontSize: 44, lineHeight: '52px', letterSpacing: '-0.02em', position: 'relative' },
          'Доброго ранку!',
        ),
      ),
      byStart.length > 0 &&
        section(
          'Пари',
          byStart
            .slice(0, 8)
            .map((l) =>
              hs(
                'div.row',
                { gap: 14, padding: '14px 0' },
                hs('div.num', { width: 88, fontSize: 22, lineHeight: '30px', flexShrink: 0 }, l.startTime),
                hs('div.cut.grow', { fontWeight: 600, lineHeight: '30px' }, l.subjectName),
                dots(l.groupName, typeOf(l, true), room(l)) &&
                  hs(
                    'div.small.muted',
                    { lineHeight: '30px', whiteSpace: 'nowrap', flexShrink: 0 },
                    dots(l.groupName, typeOf(l, true), room(l)),
                  ),
              ),
            ),
          byStart.length,
        ),
      byTime.length > 0 &&
        section(
          'Дедлайни сьогодні',
          byTime.slice(0, 6).map((d) => {
            const endOfDay = d.deadline.getHours() === 23 && d.deadline.getMinutes() === 59;
            return hs(
              'div.row',
              { gap: 14, padding: '12px 0' },
              hs(
                'div.col.grow',
                { gap: 2 },
                hs('div.b.cut', { lineHeight: '30px' }, d.title),
                dots(d.groupName, d.subjectName) && h('div.small.muted.cut', dots(d.groupName, d.subjectName)),
              ),
              hs('div.chip.warn', { height: 40, padding: '0 14px' }, endOfDay ? 'до кінця дня' : `до ${hhmm(d.deadline)}`),
            );
          }),
          byTime.length,
        ),
    ),
  };
});

// ── Group events: birthday, deadline, announcement ────────────────────────────────────────────────

const CONFETTI: Array<[x: number, y: number, w: number, h: number, color: string, rotate?: number]> = [
  [400, 58, 20, 20, LIME],
  [448, 46, 48, 16, '#FFFFFF', -20],
  [104, 150, 78, 22, LIME, -28],
  [60, 236, 24, 24, '#FFFFFF'],
  [152, 268, 52, 18, VIOLET, 22],
  [190, 122, 18, 18, '#ADA5FF'],
  [452, 136, 56, 18, '#FFFFFF', 34],
  [516, 204, 84, 22, LIME, -16],
  [446, 262, 22, 22, VIOLET],
  [568, 292, 44, 16, '#ADA5FF', 40],
  [44, 372, 64, 20, '#ADA5FF', -38],
  [96, 446, 20, 20, LIME],
  [40, 506, 72, 20, '#FFFFFF', 18],
  [524, 448, 66, 20, VIOLET, -24],
  [574, 514, 18, 18, LIME],
  [112, 566, 84, 22, LIME, 14],
  [216, 598, 20, 20, VIOLET],
  [318, 604, 44, 16, '#ADA5FF', 8],
  [440, 582, 60, 18, '#FFFFFF', -30],
  [524, 574, 24, 24, '#ADA5FF'],
];

/** «Сьогодні день народження у …». `avatar` is the profile photo as a data URI; without one the initials stand in. */
export const birthdayCard = safe(function birthdayCard(group: string, fullName: string, avatar?: string): Card {
  const words = fullName.trim().split(/\s+/).slice(0, 3);
  const longest = Math.max(...words.map((w) => w.length));
  // Unbounded is wide: «Олександра» is the longest word that still fits at full size.
  const size = longest <= 10 ? 50 : longest <= 13 ? 40 : 32;
  const tree = card(
    'День народження',
    group,
    CONFETTI.map(([x, y, w, hh, color, rotate]) =>
      hs('div', {
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: hh,
        borderRadius: 999,
        background: color,
        ...(rotate ? { transform: `rotate(${rotate}deg)` } : {}),
      }),
    ),
    hs(
      'div.center',
      // 508 = a 640px square minus the paddings and the header: the confetti is placed for that square.
      { position: 'relative', height: 508, textAlign: 'center' },
      hs(
        'div.center.num',
        {
          boxSizing: 'border-box',
          width: 168,
          height: 168,
          borderRadius: 999,
          background: '#1A1E33',
          border: `6px solid ${LIME}`,
          color: LIME,
          fontSize: 48,
          lineHeight: 1,
          flexShrink: 0,
        },
        avatar
          ? // 156 = the circle inside its 6px ring.
            { type: 'img', props: { src: avatar, width: 156, height: 156, style: { borderRadius: 999, objectFit: 'cover' } } }
          : initials(fullName),
      ),
      hs('div.eyebrow.muted', { marginTop: 28 }, 'Сьогодні день народження'),
      hs(
        'div.col',
        { marginTop: 12, alignItems: 'center' },
        words.map((w) => hs('div.num', { fontSize: size, lineHeight: `${Math.round(size * 1.12)}px`, letterSpacing: '-0.02em' }, w)),
      ),
      hs(
        'div.num.row.lime',
        { marginTop: 22, height: 60, padding: '0 30px', borderRadius: 999, fontSize: 26, lineHeight: 1, flexShrink: 0 },
        'Вітаємо!',
      ),
    ),
  );
  return { tree };
});

/** «Завтра дедлайн»: the DM on the eve of a homework deadline. */
export const deadlineCard = safe(function deadlineCard(
  group: string | undefined,
  title: string,
  deadline: Date,
  subjectName?: string,
): Card {
  const endOfDay = deadline.getHours() === 23 && deadline.getMinutes() === 59;
  return {
    tree: card(
      'Дедлайн',
      group,
      hs(
        'div.row',
        { marginTop: 30, gap: 24 },
        hs(
          'div.col.grow',
          { alignItems: 'flex-start' },
          dotChip('warn', `завтра · ${endOfDay ? 'до кінця дня' : `до ${hhmm(deadline)}`}`),
          hs('div.b', { marginTop: 18, fontSize: 38, lineHeight: 1.15, letterSpacing: '-0.01em', lineClamp: 3 }, title),
          subjectName && hs('div.muted.cut', { marginTop: 10, maxWidth: '100%' }, subjectName),
        ),
        hs(
          'div.col.soft',
          { width: 140, height: 164, borderRadius: 28, overflow: 'hidden', flexShrink: 0 },
          hs('div.center.eyebrow', { height: 44, background: '#F2B64A', color: NIGHT, flexShrink: 0 }, uk(deadline, { weekday: 'short' })),
          hs(
            'div.center.grow',
            { gap: 2 },
            hs('div.num', { fontSize: 60, lineHeight: '64px', letterSpacing: '-0.02em' }, deadline.getDate()),
            hs('div.small.muted', { fontWeight: 600 }, uk(deadline, { day: 'numeric', month: 'long' }).replace(/^\d+\s*/, '')),
          ),
        ),
      ),
    ),
  };
});

/**
 * An announcement of the head or a deputy, whole: nothing is cut off on the card. So there is no card
 * (and the bot sends the text, as before cards) for a long announcement, and for one with a link or a
 * mention, which only text keeps alive.
 */
export const announcementCard = safe(function announcementCard(
  group: string,
  title: string,
  body: string,
  date: Date,
  author?: { name: string; role?: string },
): Card | undefined {
  // About 30 characters of the body fit on a line: a dozen lines keep the card a comfortable height.
  const lines = body.split('\n').reduce((n, paragraph) => n + Math.max(1, Math.ceil(paragraph.length / 30)), 0);
  // A link is anything Telegram would make one: an address with or without http, a mention, an e-mail.
  if (title.length > 80 || lines > 12 || /https?:\/\/|[a-z0-9-]+\.[a-z]{2,}|@\w/i.test(`${title}\n${body}`)) return undefined;
  return {
    tree: card(
      'Оголошення',
      group,
      hs(
        'div.col.soft',
        { marginTop: 28, padding: '32px 32px 28px', borderRadius: 36 },
        hs('div.b', { fontSize: 36, lineHeight: 1.15, letterSpacing: '-0.01em' }, title),
        hs('div.muted', { marginTop: 16, lineHeight: 1.45, whiteSpace: 'pre-wrap' }, body),
        hs(
          'div.row.between.small',
          { marginTop: 24, paddingTop: 20, borderTop: `1.5px solid ${LINE}`, gap: 12 },
          author
            ? hs(
                'div.row.grow',
                { gap: 12 },
                hs('div.avatar', { width: 48, height: 48, fontSize: 16 }, initials(author.name)),
                hs('div.b.cut', null, author.name),
                author.role && hs('div.muted', { whiteSpace: 'nowrap', flexShrink: 0 }, `· ${author.role}`),
              )
            : h('div.grow'),
          hs('div.muted', { whiteSpace: 'nowrap', flexShrink: 0 }, uk(date, { day: 'numeric', month: 'long' })),
        ),
      ),
    ),
  };
});

// ── Queues ────────────────────────────────────────────────────────────────────────────────────────

/** A row of numbered places that runs off the card's right edge. */
const slotStrip = (size: number, style: Style, numberStyle: Style): CardNode =>
  hs(
    'div.row',
    { marginTop: 26, marginRight: -40, gap: 10, overflow: 'hidden' },
    Array.from({ length: 9 }, (_, i) => hs('div.slot.num', { width: size, height: size, lineHeight: 1, ...style, ...numberStyle }, i + 1)),
  );

/** «За 5 хв відкриється черга». */
export const queueSoonCard = safe(function queueSoonCard(group: string, title: string, opensAt: Date, now: Date): Card {
  const minutes = Math.max(1, Math.round((opensAt.getTime() - now.getTime()) / 60_000));
  return {
    tree: card(
      'Черга',
      group,
      hs('div.eyebrow.muted', { marginTop: 28 }, 'Відкриється через'),
      hs(
        'div.row.between',
        { marginTop: 8, alignItems: 'flex-end' },
        hs(
          'div.row',
          { gap: 12, alignItems: 'baseline', color: LIME },
          hs('div.num', big(150, 120, { letterSpacing: '-0.04em' }), minutes),
          hs('div.num', { fontSize: 48, lineHeight: '48px', fontWeight: 500 }, 'хв'),
        ),
        hs(
          'div.col',
          { alignItems: 'flex-end', gap: 2 },
          h('div.eyebrow.muted', 'відкриття'),
          hs('div.num', { fontSize: 34, lineHeight: '40px' }, hhmm(opensAt)),
        ),
      ),
      hs('div.b', { marginTop: 22, fontSize: 34, lineHeight: 1.15, letterSpacing: '-0.01em', lineClamp: 2 }, title),
      slotStrip(60, { borderRadius: 18, border: `2px solid ${LINE}` }, { fontSize: 20, fontWeight: 500, color: '#A4A9C4' }),
    ),
  };
});

/** «Черга відкрита»: the same card goes to the group chat and to members' DMs. */
export const queueOpenCard = safe(function queueOpenCard(group: string | undefined, title: string, slotsCount: number): Card {
  return {
    tree: card(
      'Черга',
      group,
      hs('div.row', { marginTop: 34 }, dotChip('lime', 'відкрита')),
      hs('div.b', { marginTop: 18, fontSize: 40, lineHeight: 1.15, letterSpacing: '-0.01em', lineClamp: 2 }, title),
      hs(
        'div.muted',
        { marginTop: 10 },
        `${slotsCount} ${plural(slotsCount, 'місце', 'місця', 'місць')} · обирайте своє у FICE Helper`,
      ),
      slotStrip(68, { borderRadius: 22, background: VIOLET }, { fontSize: 22 }),
    ),
  };
});

/** What a neighbour's place says under its number, by queue status (short: five places share the card's width). */
const PLACE_LABEL: Record<string, string> = {
  default: 'чекає',
  preparing: 'чекає',
  passing: 'здає',
  passed: 'здав',
  failed: 'не здав',
  missed: 'пропуск',
};

/** «Готуйтесь — ви наступний». `around` are the places next to the reader's; a free one has no status. */
export const queueNextCard = safe(function queueNextCard(
  title: string,
  slot: number,
  around: Array<{ slot: number; status?: string }>,
): Card {
  return {
    tree: card(
      'Черга',
      undefined,
      hs(
        'div.panel.lime',
        { marginTop: 28 },
        hs(
          'div.row.between',
          { height: 56 },
          dotChip('dark', 'готуйтесь'),
          hs(
            'div.row',
            { gap: 12 },
            h('div.small.b.olive', 'місце'),
            hs(
              'div.center.num',
              {
                minWidth: 56,
                height: 56,
                padding: '0 10px',
                boxSizing: 'border-box',
                borderRadius: 18,
                background: NIGHT,
                color: LIME,
                fontSize: 26,
                lineHeight: 1,
              },
              slot,
            ),
          ),
        ),
        hs('div.num', { marginTop: 18, fontSize: 52, lineHeight: '58px', letterSpacing: '-0.02em' }, 'Ви наступний'),
        hs('div.olive', { marginTop: 12, lineHeight: 1.35, fontWeight: 600 }, 'Попередній починає здавати — підготуйте свої файли.'),
      ),
      hs(
        'div.row.muted',
        { marginTop: 24, gap: 12 },
        icon('list', 28),
        hs('div.b.cut.grow', { fontSize: 30, lineHeight: 1.2, letterSpacing: '-0.01em', color: '#F4F5FB' }, title),
      ),
      hs(
        'div.row',
        { marginTop: 18, gap: 12 },
        around.map((p) => {
          const mine = p.slot === slot;
          const label = mine ? 'ви' : PLACE_LABEL[p.status ?? ''];
          const active = !mine && p.status === 'passing';
          return hs(
            'div.slot.grow',
            {
              height: 96,
              borderRadius: 24,
              gap: 2,
              ...(mine ? { background: LIME, color: NIGHT } : label ? { background: '#1A1E33' } : { border: `2px solid ${LINE}` }),
              ...(active ? { border: `2px solid ${LIME}` } : {}),
              ...(mine || active ? {} : { color: '#A4A9C4' }),
            },
            hs('div.num', { fontSize: 28, lineHeight: '32px' }, p.slot),
            label && hs('div.small', { fontWeight: mine ? 700 : 600, ...(active ? { color: LIME } : {}) }, label),
          );
        }),
      ),
    ),
  };
});

/** A place in a queue as a big tile; two of them make a swap. */
const PLACE = {
  soft: { cls: '.soft', caption: '#A4A9C4', number: '#F4F5FB' },
  grey: { cls: '', style: { border: `2px solid ${LINE}` }, caption: '#8A90AC', number: '#8A90AC' },
  violet: { cls: '', style: { background: VIOLET }, caption: '#FFFFFF', number: LIME },
  lime: { cls: '', style: { background: LIME }, caption: '#3A4620', number: NIGHT },
} satisfies Record<string, { cls: string; style?: Style; caption: string; number: string }>;
type Place = [kind: keyof typeof PLACE, caption: string, slot: number];

function places(left: Place, middle: CardNode, right: Place): CardNode {
  const tile = ([kind, caption, slot]: Place): CardNode => {
    const look: { cls: string; style?: Style; caption: string; number: string } = PLACE[kind];
    return hs(
      `div.col.grow${look.cls}`,
      { boxSizing: 'border-box', height: 160, padding: '22px 24px', borderRadius: 32, gap: 8, ...look.style },
      hs('div.eyebrow', { color: look.caption }, caption),
      hs('div.num', big(88, 80, { color: look.number }), slot),
    );
  };
  return hs('div.row', { marginTop: 22, gap: 16 }, tile(left), middle, tile(right));
}
/** `look`: the class that colours it. */
const roundIcon = (name: IconName, look: string, style: Style = {}): CardNode =>
  hs(`div.center.${look}`, { width: 64, height: 64, borderRadius: 999, flexShrink: 0, ...style }, icon(name, 30, 2.3));
const queueLine = (title: string): CardNode =>
  hs('div.row.muted', { marginTop: 20, gap: 12 }, icon('list', 26), hs('div.cut.grow', { fontWeight: 600 }, title));

/** «Запит на обмін у черзі»: `theirSlot` is the sender's place, `yourSlot` the reader's. */
export const swapRequestCard = safe(function swapRequestCard(
  fromName: string,
  queueTitle: string,
  theirSlot: number,
  yourSlot: number,
): Card {
  return {
    tree: card(
      'Обмін місцями',
      undefined,
      hs(
        'div.row',
        { marginTop: 28, gap: 16 },
        hs('div.avatar', { width: 60, height: 60, fontSize: 20 }, initials(fromName)),
        hs(
          'div.col.grow',
          { gap: 2 },
          hs('div.b.cut', { fontSize: 28, lineHeight: 1.2 }, fromName),
          h('div.small.muted', 'пропонує помінятися місцями'),
        ),
      ),
      places(['soft', 'Ваше місце', yourSlot], roundIcon('swap', 'soft', { color: LIME }), ['violet', 'Пропонують', theirSlot]),
      queueLine(queueTitle),
    ),
  };
});

/** The answer to a swap request, for its sender: `fromSlot` was theirs, `toSlot` is the one they asked for. */
export const swapResultCard = safe(function swapResultCard(
  accepted: boolean,
  otherName: string,
  queueTitle: string,
  fromSlot: number,
  toSlot: number,
): Card {
  return {
    tree: card(
      'Обмін місцями',
      undefined,
      hs(
        'div.row',
        { marginTop: 26 },
        hs(
          `div.chip.${accepted ? 'ok' : 'bad'}`,
          { gap: 8, paddingLeft: 14 },
          icon(accepted ? 'check' : 'close', 22, 2.6),
          accepted ? 'підтверджено' : 'відхилено',
        ),
      ),
      hs(
        'div.b',
        { marginTop: 16, fontSize: 38, lineHeight: 1.15, letterSpacing: '-0.01em' },
        accepted ? 'Обмін відбувся' : 'Обмін не відбувся',
      ),
      hs('div.small.muted.cut', { marginTop: 6 }, dots(otherName, queueTitle)),
      accepted
        ? places(['grey', 'Було', fromSlot], roundIcon('arrowRight', 'ok'), ['lime', 'Тепер ваше', toSlot])
        : places(['soft', 'Ваше місце', fromSlot], roundIcon('close', 'bad'), ['grey', 'Запитували', toSlot]),
    ),
  };
});

// ── Teachers ──────────────────────────────────────────────────────────────────────────────────────

/** A teacher asks the head for access to the group; the approve / reject buttons go under the card. */
export const teacherRequestCard = safe(function teacherRequestCard(group: string, name: string, username?: string, note?: string): Card {
  const tag = username && name !== `@${username}` ? `@${username}` : undefined;
  return {
    tree: card(
      'Запит викладача',
      group,
      hs(
        'div.col.soft',
        { marginTop: 28, padding: 28, borderRadius: 32 },
        hs(
          'div.row',
          { gap: 18 },
          hs('div.avatar', { width: 72, height: 72, fontSize: 24 }, initials(name)),
          hs(
            'div.col.grow',
            { gap: 2 },
            hs('div.b', { fontSize: 28, lineHeight: 1.2, lineClamp: 2 }, name),
            tag && hs('div.small.cut', { fontWeight: 600, color: '#ADA5FF' }, tag),
          ),
        ),
        hs('div.muted', { marginTop: 20, lineHeight: 1.35 }, `Хоче приєднатися до групи ${group} як викладач`),
        note &&
          hs(
            'div.row',
            { marginTop: 18, padding: '16px 20px', borderRadius: 20, background: '#262B45', gap: 12, alignItems: 'flex-start' },
            hs('div', { display: 'flex', marginTop: 3, color: '#ADA5FF' }, icon('chat', 26)),
            hs('div.grow', { lineHeight: 1.35 }, note),
          ),
      ),
      hs(
        'div.row.small.muted',
        { marginTop: 20, gap: 10, justifyContent: 'center', fontWeight: 600 },
        icon('arrowDown', 24, 2.2),
        'Рішення — кнопками під карткою',
      ),
    ),
  };
});

/** The head's answer, for the teacher. */
export const teacherDecisionCard = safe(function teacherDecisionCard(group: string, approved: boolean): Card {
  return {
    tree: card(
      'Доступ до групи',
      group,
      hs(
        'div.row',
        { marginTop: 32, gap: 24 },
        hs(
          'div.col.grow',
          { alignItems: 'flex-start' },
          hs(
            `div.chip.${approved ? 'ok' : 'bad'}`,
            { gap: 8, paddingLeft: 14 },
            icon(approved ? 'check' : 'close', 22, 2.6),
            approved ? 'схвалено' : 'відхилено',
          ),
          hs(
            'div.b',
            { marginTop: 16, fontSize: 40, lineHeight: 1.15, letterSpacing: '-0.01em' },
            approved ? 'Доступ відкрито' : 'Доступ не надано',
          ),
          hs(
            'div.muted',
            { marginTop: 10, lineHeight: 1.35 },
            approved ? `Черги та журнал групи ${group} — у FICE Helper` : `Запит на доступ до групи ${group} відхилено`,
          ),
        ),
        hs(
          `div.center.${approved ? 'ok' : 'bad'}`,
          { width: 128, height: 128, borderRadius: 999, flexShrink: 0 },
          icon(approved ? 'check' : 'close', approved ? 64 : 60, 2.4),
        ),
      ),
    ),
  };
});

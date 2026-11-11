import { execFile } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { setPriority } from 'os';
import { text } from 'stream/consumers';

/** A satori element. Plain JSON, so a card crosses the process boundary as is. */
export interface CardNode {
  type: string;
  props: Record<string, unknown>;
}

/** Design width in px; the PNG is twice that (Telegram keeps photos up to 1280px). */
const WIDTH = 640;

type Font = { name: string; data: Buffer; weight: 500 | 600 | 700; style: 'normal' };
let fonts: Font[] | undefined;

/**
 * Onest + Unbounded, the Mini App's faces. A @fontsource file holds one unicode subset and satori falls
 * back per glyph along `font-family`, so Latin and Cyrillic are two families per face (`Onest, 'Onest Cyr'`).
 */
function loadFonts(): Font[] {
  const file = (pkg: string, subset: string, weight: Font['weight'], name: string): Font => ({
    name,
    data: readFileSync(require.resolve(`@fontsource/${pkg}/files/${pkg}-${subset}-${weight}-normal.woff`)),
    weight,
    style: 'normal',
  });
  return (fonts ??= [
    ...([500, 600, 700] as const).flatMap((w) => [file('onest', 'latin', w, 'Onest'), file('onest', 'cyrillic', w, 'Onest Cyr')]),
    ...([500, 600] as const).flatMap((w) => [
      file('unbounded', 'latin', w, 'Unbounded'),
      file('unbounded', 'cyrillic', w, 'Unbounded Cyr'),
    ]),
    // In no `font-family`: satori turns to these for what the faces above lack (ł, ₴, →, ≥, ✓), one weight is enough.
    ...['latin-ext', 'cyrillic-ext', 'math', 'symbols'].map((subset) => file('onest', subset, 600, `Onest ${subset}`)),
  ]);
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** The card with the graphemes in `drop` taken out of every text. */
function without(node: unknown, drop: Set<string>): unknown {
  if (typeof node === 'string') {
    const all = [...graphemes.segment(node)].map((g) => g.segment);
    const kept = all.filter((g) => !drop.has(g));
    // No double space or dangling one where an emoji stood.
    return kept.length === all.length ? node : kept.join('').replace(/ {2,}/g, ' ').replace(/^ | $/gm, '');
  }
  if (Array.isArray(node)) return node.map((kid) => without(kid, drop));
  if (!node || typeof node !== 'object') return node;
  const { type, props } = node as CardNode;
  return type === 'style' ? node : { type, props: { ...props, children: without(props.children, drop) } };
}

/**
 * Renders in this process. Once loaded, satori and resvg keep ~150 MB of WASM and native memory for good,
 * so the bot itself never calls this: it is for the child below and for tests.
 */
export async function renderTree(tree: CardNode): Promise<Buffer> {
  const { default: satori } = await import('satori');
  const { Resvg } = await import('@resvg/resvg-js');
  // Emoji, other scripts: satori names every grapheme no font here can draw. They would come out as empty boxes.
  const missing = new Set<string>();
  const draw = (card: unknown): Promise<string> =>
    satori(card as never, {
      width: WIDTH,
      fonts: loadFonts(),
      pointScaleFactor: 2,
      loadAdditionalAsset: async (_language: string, text: string) => {
        for (const g of graphemes.segment(text)) missing.add(g.segment);
        return [];
      },
    });
  let svg = await draw(tree);
  // ponytail: such text is drawn without them. Real emoji on a card need a picture set (Twemoji) handed
  // out from loadAdditionalAsset.
  if (missing.size) svg = await draw(without(tree, missing));
  return new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH * 2 }, font: { loadSystemFonts: false } }).render().asPng();
}

// Small heap, no optimizing compilers: the child lives for one card, so warm-up speed is all that matters.
const CHILD_FLAGS = ['--max-old-space-size=64', '--max-semi-space-size=1', '--liftoff-only', '--no-opt'];
/** Drawing may take this much of any minute. Past it cards are refused, and the bot's texts still go out on time. */
const BUDGET_MS = 20_000;
let queue: Promise<unknown> = Promise.resolve();
let minuteStart = 0;
let spent = 0;

/**
 * Card → PNG in a child process, one card at a time.
 */
// ponytail: a fresh node process per card (~0.5 s of CPU, ~100 MB while it runs), because the backend
// container has 384 MB and a renderer that stays loaded would take ~150 MB of it. That is a few dozen new
// cards a minute, and a busier minute gets texts. A warm worker with an idle exit when that is not enough.
export function renderCard(tree: CardNode): Promise<Buffer> {
  const run = queue.then(() => {
    const started = Date.now();
    if (started - minuteStart >= 60_000) [minuteStart, spent] = [started, 0];
    if (spent >= BUDGET_MS) throw new Error('this minute is over its drawing budget');
    return new Promise<Buffer>((resolve, reject) => {
      const child = execFile(
        process.execPath,
        [...CHILD_FLAGS, __filename],
        { encoding: 'buffer', maxBuffer: 16 << 20, timeout: 20_000 },
        (err, stdout, stderr) => (err ? reject(new Error(stderr.toString().trim().split('\n').pop() || err.message)) : resolve(stdout)),
      );
      try {
        // Rendering must not starve the API on a one-core VPS.
        if (child.pid) setPriority(child.pid, 10);
      } catch {
        /* best effort */
      }
      // A child that died before reading its card: execFile reports it above, and an unheard EPIPE here would take the bot down.
      child.stdin?.on('error', () => undefined).end(JSON.stringify(tree));
    }).finally(() => (spent += Date.now() - started));
  });
  queue = run.catch(() => undefined);
  return run;
}

// Child: the card on stdin, the PNG on stdout.
if (require.main === module) {
  try {
    // Out of memory in the container → the kernel takes this process, not the bot.
    writeFileSync('/proc/self/oom_score_adj', '1000');
  } catch {
    /* not Linux */
  }
  text(process.stdin)
    .then((json) => renderTree(JSON.parse(json)))
    .then(
      (png) => process.stdout.write(png),
      (err) => {
        console.error(String((err as Error)?.message ?? err));
        process.exitCode = 1;
      },
    );
}

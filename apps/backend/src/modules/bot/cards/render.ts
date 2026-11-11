import { type ChildProcess, fork } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { setPriority } from 'os';

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

// Small heap, no optimizing compilers: less memory, and no slower on cards (measured). `gc` is for the child below.
const CHILD_FLAGS = ['--expose-gc', '--max-old-space-size=64', '--max-semi-space-size=1', '--liftoff-only', '--no-opt'];
/** Drawing may take this much of any minute. Past it cards are refused, and the bot's texts still go out on time. */
const BUDGET_MS = 20_000;
/** A card that takes longer fails, and the renderer that hangs on it is killed. */
const CARD_TIMEOUT_MS = 20_000;
/** The renderer exits after this long without a card and gives its memory back. */
const IDLE_MS = 5 * 60_000;
let queue: Promise<unknown> = Promise.resolve();
let minuteStart = 0;
let spent = 0;
let renderer: ChildProcess | undefined;
let idle: NodeJS.Timeout | undefined;

/**
 * Card → PNG in a child process, one card at a time.
 */
// ponytail: one renderer kept warm between cards (~0.1 s a card) and gone after IDLE_MS, because the backend
// container has 384 MB and a warm one holds ~100 MB. The first card after a quiet spell starts it again
// (~0.3 s more here, a few times that on the VPS). Drop the idle exit once the container has the memory.
export function renderCard(tree: CardNode): Promise<Buffer> {
  const run = queue.then(() => {
    const started = Date.now();
    if (started - minuteStart >= 60_000) [minuteStart, spent] = [started, 0];
    if (spent >= BUDGET_MS) throw new Error('this minute is over its drawing budget');
    clearTimeout(idle);
    return draw(tree).finally(() => {
      spent += Date.now() - started;
      idle = setTimeout(() => {
        renderer?.kill();
        renderer = undefined;
      }, IDLE_MS);
    });
  });
  queue = run.catch(() => undefined);
  return run;
}

function draw(tree: CardNode): Promise<Buffer> {
  const child = (renderer ??= startRenderer());
  return new Promise<Buffer>((resolve, reject) => {
    const settle = (result: { png?: Uint8Array; error?: string }, broken = false) => {
      clearTimeout(timer);
      child.off('message', onMessage).off('exit', onExit).off('error', onError);
      if (broken) {
        child.kill();
        if (renderer === child) renderer = undefined;
      }
      if (result.png) resolve(Buffer.from(result.png));
      else reject(new Error(result.error));
    };
    const onMessage = (result: { png?: Uint8Array; error?: string }) => settle(result);
    const onExit = (code: number | null, signal: string | null) => settle({ error: `the renderer exited (${signal ?? code})` }, true);
    const onError = (err: Error) => settle({ error: err.message }, true);
    const timer = setTimeout(() => settle({ error: `the card took over ${CARD_TIMEOUT_MS / 1000} s` }, true), CARD_TIMEOUT_MS);
    child.on('message', onMessage).on('exit', onExit).on('error', onError);
    child.send(JSON.stringify(tree));
  });
}

function startRenderer(): ChildProcess {
  // `advanced`: the PNG comes back as bytes, not as a JSON array of numbers.
  const child = fork(__filename, [], { execArgv: CHILD_FLAGS, serialization: 'advanced' });
  // Gone between cards (killed for memory, say): the next card starts another. An unheard 'error' would take the bot down.
  child
    .on('exit', () => {
      if (renderer === child) renderer = undefined;
    })
    .on('error', () => undefined);
  try {
    // Rendering must not starve the API on a one-core VPS.
    if (child.pid) setPriority(child.pid, 10);
  } catch {
    /* best effort */
  }
  return child;
}

// Child: cards in, PNGs out over the IPC channel. It exits by itself once the bot is gone and the channel with it.
if (require.main === module) {
  try {
    // Out of memory in the container → the kernel takes this process, not the bot.
    writeFileSync('/proc/self/oom_score_adj', '1000');
  } catch {
    /* not Linux */
  }
  process.on('message', (json: string) => {
    renderTree(JSON.parse(json))
      .then(
        (png) => process.send!({ png }),
        (err) => process.send!({ error: String((err as Error)?.message ?? err) }),
      )
      // resvg's pixmaps (~8 MB a card) live outside the JS heap, which is too small to notice them:
      // left to the GC, the renderer grows past 300 MB in 30 cards.
      .finally(() => globalThis.gc?.());
  });
}

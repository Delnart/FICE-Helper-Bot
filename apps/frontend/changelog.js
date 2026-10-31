/**
 * CHANGELOG.md → the releases of the «Оновлення» page, parsed once at build time (next.config.js).
 * A release is { version, date, blocks }, the blocks in file order: { title } for `### ` subheads,
 * { text } for paragraphs, { items } for `- ` lists, loose ones too; both may wrap over lines.
 * `>` callouts are notes for whoever deploys: they last until a blank line and stay out whatever
 * they hold, like the intro above the first release. A `##` line still ends a callout and headings
 * are checked in the intro too, or a release would vanish. UNSUPPORTED markup fails the build;
 * what it doesn't name, like *italics*, prints as written.
 * Self-check: node apps/frontend/changelog.js
 */
const RELEASE = /^## (\d+\.\d+\.\d+|\d+\.x)\s+[—–-]\s+(.+)$/;
// Other heading levels, fences, * + 1. lists, table rows, rules and table delimiters, bold, links.
const UNSUPPORTED = /^((?!### )#|```|~~~|[*+] |\d+[.)] |\||[-=*_:| ]+$)|\*\*|__|\]\(/;

function parseChangelog(md) {
  const releases = [];
  let callout = false;
  let wrap = false; // a plain line continues the item or paragraph above
  for (const [i, raw] of md.split(/\r?\n/).entries()) {
    const line = raw.trim();
    const text = line.replace(/`/g, '');
    const heading = line.match(RELEASE);
    const blocks = releases.at(-1)?.blocks;
    const last = blocks?.at(-1);
    // The intro isn't shown, but a broken first heading must not hide in it.
    if (!blocks && !/^##|^#+\s*\d/.test(line)) continue;
    if (!line) callout = wrap = false;
    else if (!heading && !/^##(?!#)/.test(line) && (callout || line.startsWith('>'))) callout = true;
    else if ((!blocks && !heading) || UNSUPPORTED.test(heading ? heading[2] : line)) {
      throw new Error(
        `CHANGELOG.md: line ${i + 1} is not "## <version> — <date>", "### ", "- ", "> " or plain text: ${line}`,
      );
    } else if (heading) {
      releases.push({ version: heading[1], date: heading[2].replace(/`/g, ''), blocks: [] });
      callout = wrap = false;
    } else if (line.startsWith('### ')) {
      blocks.push({ title: text.slice(4) });
      wrap = false;
    } else if (line.startsWith('- ')) {
      if (last?.items) last.items.push(text.slice(2));
      else blocks.push({ items: [text.slice(2)] });
      wrap = true;
    } else if (!wrap) {
      blocks.push({ text });
      wrap = true;
    } else if (last.items) last.items[last.items.length - 1] += ` ${text}`;
    else last.text += ` ${text}`;
  }
  if (!releases.length) throw new Error('CHANGELOG.md: no "## <version> — <date>" headings');
  return releases;
}

module.exports = { parseChangelog };

if (require.main === module) {
  const assert = require('node:assert');
  const md = [
    '# Журнал змін',
    '',
    'Вступ із **жирним** і [посиланням](docs.md): на сторінку не йде.',
    '',
    '## 2.0.0 — 2026-10-27',
    '',
    'Редизайн',
    'і решта.',
    '',
    '> **Адміну:** запустіть',
    'міграцію за [інструкцією](docs.md)',
    '- пункт нотатки',
    '### підзаголовок нотатки',
    '```',
    '| таблиця |',
    '',
    '### Черги',
    '',
    '- Перша `/now`',
    '  продовження',
    '',
    '- Друга',
    '> нотатка між пунктами',
    '',
    '- Третя',
    'лінивий перенос',
    '',
    'Абзац після списку',
    'на два рядки.',
    '- Новий список',
    '### Без порожніх рядків',
    'Абзац під підзаголовком.',
    '',
    'Другий абзац із 1.x, C++, a_b, 2 * 3 і https://example.com/.',
    '> нотатка перед релізом без порожнього рядка',
    '## 1.x — травень — вересень 2026',
    'Усе до редизайну.',
    '',
    '## 0.9.0 - 2026-01-02',
    '## 0.8.0 – `2026-01-01`',
    '',
  ].join('\r\n');
  assert.deepStrictEqual(parseChangelog(md), [
    {
      version: '2.0.0',
      date: '2026-10-27',
      blocks: [
        { text: 'Редизайн і решта.' },
        { title: 'Черги' },
        { items: ['Перша /now продовження', 'Друга', 'Третя лінивий перенос'] },
        { text: 'Абзац після списку на два рядки.' },
        { items: ['Новий список'] },
        { title: 'Без порожніх рядків' },
        { text: 'Абзац під підзаголовком.' },
        { text: 'Другий абзац із 1.x, C++, a_b, 2 * 3 і https://example.com/.' },
      ],
    },
    { version: '1.x', date: 'травень — вересень 2026', blocks: [{ text: 'Усе до редизайну.' }] },
    { version: '0.9.0', date: '2026-01-02', blocks: [] },
    { version: '0.8.0', date: '2026-01-01', blocks: [] },
  ]);

  // Each one named in the error, by number and by text; line 4 of `${head}${bad}`.
  const head = '## 2.0.0 — дата\n\nТекст\n';
  for (const bad of [
    '## Unreleased',
    '##2.5.0',
    '## 2.5.0',
    '## 2.5.0 —',
    '## 2.5 — дата',
    '## v2.5.0 — дата',
    '## 2.5.0—дата',
    '## 2.5.0 — **дата**',
    '## 2.5.0 — [дата](url)',
    '# Заголовок',
    '#### Заголовок',
    '###### Заголовок',
    '###Заголовок',
    '```',
    '```js',
    '~~~',
    '---',
    '***',
    '___',
    '- - -',
    '===',
    '* пункт',
    '+ пункт',
    '1. пункт',
    '2) пункт',
    '| a | b |',
    '--- | ---',
    '|---|---|',
    'Текст із **жирним**',
    'Текст із __жирним__',
    '- Пункт із **жирним**',
    '### Підзаголовок із **жирним**',
    'Текст із [посиланням](docs.md)',
    '- Пункт із ![картинкою](a.png)',
    'дуже** жирний кінець перенесеного рядка',
  ]) {
    assert.throws(
      () => parseChangelog(`${head}${bad}\n`),
      (e) => e.message.startsWith('CHANGELOG.md: line 4 ') && e.message.endsWith(`: ${bad}`),
      bad,
    );
  }
  // Above the first release too, or the newest release would vanish into the intro.
  assert.throws(
    () => parseChangelog('# Журнал\n\n##2.5.0\n\n## 2.4.0 — дата\n'),
    /line 3 .*##2\.5\.0/,
  );
  assert.throws(() => parseChangelog('# Журнал\n\n## Unreleased\n\n## 2.4.0 — дата\n'), /line 3 /);
  // At the wrong level above the first release, or broken right under a callout.
  for (const bad of ['### 2.5.0 — дата', '# 2.5.0 — дата', '#### 2.5.0 — дата']) {
    assert.throws(() => parseChangelog(`# Журнал\n\n${bad}\n\n## 2.4.0 — дата\n`), /line 3 /, bad);
  }
  for (const bad of ['## Unreleased', '##2.4.0', '## 2.4 — дата']) {
    assert.throws(() => parseChangelog(`## 2.5.0 — дата\n\n> нотатка\n${bad}\n`), /line 4 /, bad);
  }
  assert.throws(() => parseChangelog('# Порожньо'), /no "## <version> — <date>" headings/);
  console.log('changelog.js ok');
}

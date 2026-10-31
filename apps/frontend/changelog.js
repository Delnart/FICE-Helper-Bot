/**
 * CHANGELOG.md → the releases of the «Оновлення» page, parsed once at build time (next.config.js).
 * Knows what the file uses: `## <version> — <date>`, `### ` subheads, `- ` items and paragraphs
 * wrapped over lines. `>` callouts are notes for whoever deploys, so they stay out.
 * Self-check: node apps/frontend/changelog.js
 */
function parseChangelog(md) {
  const releases = md
    .split(/^## /m)
    .slice(1)
    .map((chunk) => {
      const [heading, ...body] = chunk.split(/\r?\n/);
      const [version, date] = heading.trim().split(' — ');
      const sections = [{ paragraphs: [], items: [] }];
      let list = null; // what a wrapped line continues
      for (const raw of body) {
        const line = raw.trim().replace(/`/g, '');
        const section = sections[sections.length - 1];
        if (!line || line.startsWith('>')) list = null;
        else if (line.startsWith('### ')) {
          sections.push({ title: line.slice(4), paragraphs: [], items: [] });
          list = null;
        } else if (line.startsWith('- ')) {
          section.items.push(line.slice(2));
          list = section.items;
        } else if (list) list[list.length - 1] += ` ${line}`;
        else {
          section.paragraphs.push(line);
          list = section.paragraphs;
        }
      }
      return { version, date, sections: sections.filter((s) => s.title || s.paragraphs.length || s.items.length) };
    });
  if (!releases.length) throw new Error('CHANGELOG.md: no "## <version> — <date>" headings');
  return releases;
}

module.exports = { parseChangelog };

if (require.main === module) {
  const assert = require('node:assert');
  const md = [
    '# Журнал змін',
    '',
    'Вступ.',
    '',
    '## 2.0.0 — 2026-10-27',
    '',
    'Редизайн',
    'і решта.',
    '',
    '> **Адміну:** запустіть',
    '> міграцію.',
    '',
    '### Черги',
    '',
    '- Перша `/now`',
    '  продовження',
    '- Друга',
    '',
    '## 1.x — травень 2026',
    'Усе до редизайну.',
    '',
  ].join('\r\n');
  assert.deepStrictEqual(parseChangelog(md), [
    {
      version: '2.0.0',
      date: '2026-10-27',
      sections: [
        { paragraphs: ['Редизайн і решта.'], items: [] },
        { title: 'Черги', paragraphs: [], items: ['Перша /now продовження', 'Друга'] },
      ],
    },
    { version: '1.x', date: 'травень 2026', sections: [{ paragraphs: ['Усе до редизайну.'], items: [] }] },
  ]);
  assert.throws(() => parseChangelog('# Порожньо'));
  console.log('changelog.js ok');
}

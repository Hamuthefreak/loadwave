import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

/**
 * The product has no emoji in it, and this is what keeps that true.
 *
 * Emoji are not a style preference that can be left to review. Three things go
 * wrong the moment one is a UI element: it is drawn by the *platform* rather
 * than the product, so the same warning is a different picture on Android, iOS
 * and Windows; it arrives with its own colour, which no theme can retune and
 * which fights the status hues this app uses to carry meaning; and it is a
 * character in the text run, so a screen reader announces the picture's name in
 * the middle of a sentence. Icons live in `web/src/components/icons.tsx`, drawn
 * to one grid, inheriting `currentColor`, `aria-hidden`.
 *
 * The rule is Unicode's, not an opinion about taste: everything with a
 * pictographic or emoji presentation is out, along with the variation selector
 * that exists only to *force* emoji presentation. Deliberately still allowed are
 * the typographic marks this app uses as text — `✓` and `✕` (both `Emoji=No`,
 * drawn identically in every font, which is exactly the property emoji lack),
 * the legal marks `©`/`®`/`™`, the arithmetic and punctuation the copy needs,
 * and the arrow glyphs. `★` and `⚑` are *not* allowed even though fonts usually
 * draw them as text: they are in the emoji property set, they were the two this
 * codebase actually used as icons, and a rating star is an icon.
 */

/** Skipped: dependencies, build output, VCS, and the gitignored scratch dir. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  'build',
  '.freebuff',
  '.vite',
  '.next',
]);

/** Everything that ships or is read by a human. */
const SCANNED = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.css',
  '.scss',
  '.html',
  '.md',
  '.sql',
  '.prisma',
  '.yml',
  '.yaml',
  '.json',
  '.txt',
]);

/**
 * An emoji-presentation pictograph, a regional-indicator flag, a keycap, a
 * zero-width joiner (only ever used to glue emoji together), or a miscellaneous
 * symbol / dingbat we have ruled out — minus the two text marks that are
 * allowed. Written as one pattern so the allow-list is in the same place as the
 * rule it excepts.
 */
const EMOJI =
  /\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u{1F1E6}-\u{1F1FF}]|\u{20E3}|\u{200D}|\uFE0F|[\u{2600}-\u{27BF}]/u;
/**
 * Characters the rule deliberately lets through: the text marks this app draws
 * as typography. They share the one property that matters — no font replaces
 * them with a colour picture on any platform — and any attempt to *force* one
 * is still caught, because the variation selector is flagged on its own.
 *
 * The arrows are here because Unicode marks some of them (↔, ↖) as
 * pictographic while leaving their neighbours (→, ↑) alone; forbidding half of
 * the arrow block would be a rule nobody could apply.
 */
const ALLOWED_TEXT = /^[\u2190-\u21FF\u2713\u2715\u00A9\u00AE\u2122]$/u;

/**
 * This file is the rule, so it has to name the characters the rule is about —
 * otherwise it could not test itself below. Every other file is fair game.
 */
const SELF = resolve(__dirname, 'no-emoji.test.ts');

function offenders(line: string): string[] {
  const found = new Set<string>();
  for (const char of line) {
    if (!EMOJI.test(char)) continue;
    if (ALLOWED_TEXT.test(char)) continue;
    found.add(`U+${char.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0')} ${char}`);
  }
  return [...found];
}

function walk(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, files);
      continue;
    }
    if (SCANNED.has(extname(name))) files.push(full);
  }
  return files;
}

describe('no emoji in the product', () => {
  it('leaves the typographic marks it means to leave, and flags the rest', () => {
    // The rule is only useful if it is neither so broad that it forbids `✓` nor
    // so narrow that a rating star walks through it.
    expect(offenders('✓ copied')).toEqual([]);
    expect(offenders('✕')).toEqual([]);
    expect(offenders('412 L · $1.284/L → ON')).toEqual([]);
    expect(offenders('Québec ↔ Ontario')).toEqual([]);
    expect(offenders('© 2026 Loadwave')).toEqual([]);
    expect(offenders('★ 4.6')).toEqual(['U+2605 ★']);
    expect(offenders('⚑ 2 reports')).toEqual(['U+2691 ⚑']);
    // The selector that forces emoji presentation is out on its own: ️ has no
    // other use, and it is what turns a harmless mark into a colour picture.
    expect(offenders('\uFE0F')).toEqual(['U+FE0F \uFE0F']);
    expect(offenders('Save the document')).toEqual([]);
  });

  it('finds no emoji anywhere in the source', () => {
    const root = resolve(__dirname, '../..');
    const hits: string[] = [];

    for (const file of walk(root)) {
      if (file === SELF) continue;
      const lines = readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, index) => {
        const found = offenders(line);
        if (found.length > 0) hits.push(`${relative(root, file)}:${index + 1} — ${found.join(', ')}`);
      });
    }

    // Compared as one string so a failure prints the offending lines with the
    // fix attached, rather than a diff of an array of paths.
    const report =
      hits.length === 0
        ? ''
        : 'replace each of these with an icon from web/src/components/icons.tsx (or with words):' +
          `\n${hits.join('\n')}`;
    expect(report).toBe('');
  });
});

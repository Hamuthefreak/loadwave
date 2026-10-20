import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Contrast for the auth screens, measured from the stylesheet.
 *
 * axe's `color-contrast` rule needs a real renderer to sample pixels, so it
 * cannot run under jsdom. Rather than leave contrast unguarded, this test
 * reads the same custom properties the auth card uses and computes WCAG 2.1
 * ratios directly. It fails if a token or a button colour is nudged below
 * 4.5:1 for normal text.
 */

const css = readFileSync(join(__dirname, '../src/marketing.css'), 'utf8');

function ruleBody(selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`missing rule ${selector}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

function declarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of body.matchAll(/(-{0,2}[a-z][a-z0-9-]*)\s*:\s*([^;]+);/gi)) {
    out[match[1]] = match[2].trim();
  }
  return out;
}

const light = declarations(ruleBody('.ld-mkt {'));
const dark = declarations(ruleBody("html[data-theme='dark'] .ld-mkt {"));

function resolve(value: string, tokens: Record<string, string>): string {
  const variable = value.match(/^var\((--[a-z0-9-]+)\)$/i);
  if (!variable) return value;
  const resolved = tokens[variable[1]];
  if (!resolved) throw new Error(`undefined token ${variable[1]}`);
  return resolved;
}

function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const expanded =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  const channels = [0, 2, 4].map((i) => parseInt(expanded.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

const button = declarations(ruleBody('.ld-auth-card .btn-block {'));
const buttonColor = resolve(button.background, light);
const hoverColor = declarations(ruleBody('.ld-auth-card .btn-block:hover {'))['background'];

const hero = declarations(ruleBody('.ld-auth-hero {'));
const heroText = declarations(ruleBody('.ld-auth-hero p {')).color;
const heroStops = [...hero.background.matchAll(/#[0-9a-f]{3,8}/gi)].map((m) => m[0]);

describe.each([
  ['light', light],
  ['dark', dark],
])('the %s auth palette', (_theme, tokens) => {
  const color = (name: string) => resolve(tokens[name], tokens);

  it('keeps body copy readable on the card and in the fields', () => {
    expect(ratio(color('--body'), color('--card'))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(color('--body'), color('--field'))).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps labels and typed text readable', () => {
    expect(ratio(color('--ink'), color('--card'))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(color('--ink'), color('--field'))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the auth call to action', () => {
  it('carries white text at AA in the resting and hover states', () => {
    expect(buttonColor).toMatch(/^#[0-9a-f]{3,8}$/i);
    expect(ratio('#ffffff', buttonColor)).toBeGreaterThanOrEqual(4.5);
    expect(ratio('#ffffff', hoverColor)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the sign-in hero', () => {
  it('keeps its copy readable against both gradient stops', () => {
    expect(heroStops.length).toBeGreaterThanOrEqual(2);
    for (const stop of heroStops) {
      expect(ratio(heroText, stop)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_EMBED_HEIGHT, fullEmbedHeight } from '../editor/metrics.ts';
import { buildEmbedSnippet } from './embedSnippet.ts';

const url = new URL('https://play.luau.org/?embed=true');
const height = DEFAULT_EMBED_HEIGHT;

function iframe(html: string): string {
  const match = html.match(/<iframe[\s\S]*?<\/iframe>/);
  assert.ok(match, 'snippet contains an iframe');
  return match[0];
}

test('a snippet that fits is a plain sized iframe', () => {
  const html = buildEmbedSnippet(url, height, height / 2);

  assert.match(iframe(html), /width="100%"/);
  assert.match(iframe(html), new RegExp(`height="${height}"`));
  assert.doesNotMatch(html, /<style>/);
  assert.doesNotMatch(html, /luau-embed-toggle/);
});

test('only code taller than the collapsed height gets an expand toggle', () => {
  const short = fullEmbedHeight({ 'main.luau': 'print(1)\n' });
  const lines = Array.from({ length: 40 }, (_, i) => `print(${i})`).join('\n');
  const long = fullEmbedHeight({ 'main.luau': lines, 'utils.luau': lines });

  assert.ok(short <= height);
  assert.ok(long > height);
  assert.doesNotMatch(buildEmbedSnippet(url, height, short), /luau-embed-toggle/);
  const expandable = buildEmbedSnippet(url, height, long);
  assert.match(expandable, /luau-embed-toggle/);
  assert.doesNotMatch(iframe(expandable), /[?&]expand=true/);
  assert.match(expandable, /luau-embed-expand/);
});

test('multi-file embeds add the tab bar height', () => {
  const lines = Array.from({ length: 40 }, (_, i) => `print(${i})`).join('\n');

  assert.ok(fullEmbedHeight({ 'main.luau': lines, 'utils.luau': lines }) > fullEmbedHeight({ 'main.luau': lines }));
});

test('the frame tells the host checkbox to resize', () => {
  const html = buildEmbedSnippet(url, height, height * 2);
  const id = html.match(/id="(luau-embed-[^"]+)"/)?.[1];

  assert.ok(id);
  assert.match(iframe(html), new RegExp(`[?&]expandId=${id}`));
  assert.doesNotMatch(html, /luau-embed-label/);
});

test('an expandable iframe keeps its size when the stylesheet is stripped', () => {
  const html = buildEmbedSnippet(url, height, height * 2);
  const stripped = html.replace(/<style>[\s\S]*<\/style>/, '');

  assert.match(html, /height:\s*var\(--luau-collapsed\)/);
  assert.match(iframe(stripped), /width="100%"/);
  assert.match(iframe(stripped), new RegExp(`height="${height}"`));
  assert.doesNotMatch(stripped, /<style>/);
});

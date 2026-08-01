import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('admin markup and runtime templates contain no inline event handlers', async () => {
  const sources = `${await read('index.html')}\n${await read('app.js')}`;
  assert.doesNotMatch(sources, /\son(?:click|change|input|submit)\s*=/i);
  assert.match(sources, /data-admin-click=/);
  assert.match(sources, /const ADMIN_ACTION_NAMES = new Set/);
  assert.doesNotMatch(sources, /\beval\s*\(|\bnew Function\s*\(/);
});

test('production CSP blocks script attributes and is enforced', async () => {
  const config = JSON.parse(await read('vercel.json'));
  const headers = config.headers.flatMap(rule => rule.headers || []);
  const csp = headers.find(header => header.key === 'Content-Security-Policy');
  assert.ok(csp, 'enforced CSP header is required');
  assert.match(csp.value, /script-src-attr 'none'/);
  assert.doesNotMatch(csp.value, /script-src-attr 'unsafe-inline'/);
  assert.equal(headers.some(header => header.key === 'Content-Security-Policy-Report-Only'), false);
});

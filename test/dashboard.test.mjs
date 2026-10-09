import test from 'node:test';
import assert from 'node:assert/strict';
import { paired } from './fixture.mjs';

test('read-only dashboard is localized, bound to loopback, and exposes no message bodies or secrets', async t => {
  const b = await paired(t); await b.cx.send({ body: 'never expose private body' });
  const { openDashboard } = await import('../lib/dashboard.mjs');
  const dashboard = await openDashboard({ root: b.root, language: 'ko' });
  b.beforeCleanup(() => dashboard.close());
  assert.match(dashboard.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  const html = await (await fetch(dashboard.url)).text(); assert.match(html, /[가-힣]/); assert.equal(html.includes('never expose private body'), false);
  const response = await fetch(dashboard.url + 'api/status'); assert.equal(response.status, 200);
  const data = await response.json(); assert.equal(data.addresses.length, 2);
  assert.equal(data.addresses.find(x => x.address === 'claude-demo').pending, 1);
  assert.equal(JSON.stringify(data).includes('never expose private body'), false);
  assert.equal((await fetch(dashboard.url + 'api/status', { method: 'POST' })).status, 405);
  assert.equal((await fetch(dashboard.url + 'api/status', { headers: { Origin: 'https://other.example' } })).status, 403);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match((await fetch(dashboard.url)).headers.get('content-security-policy'), /default-src 'none'/);
});

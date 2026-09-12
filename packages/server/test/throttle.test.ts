/** Die Drossel für das Kennwortraten (Audit 12.09.2026, F12). */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { Throttle } from '../src/http/throttle.js';

const MIN = 60_000;

test('nach `max` Fehlversuchen ist gesperrt — bis das Fenster abläuft', () => {
  const t = new Throttle({ max: 3, windowMs: 15 * MIN });
  const k = 'wer@example.org';
  assert.equal(t.blockedFor(k, 0), 0);
  t.fail(k, 0);
  t.fail(k, 1000);
  assert.equal(t.blockedFor(k, 2000), 0, 'zwei sind noch nicht drei');
  t.fail(k, 2000);
  const rest = t.blockedFor(k, 3000);
  assert.ok(rest > 0 && rest <= 15 * 60, `gesperrt, Retry-After ${rest}s`);
  assert.equal(t.blockedFor(k, 2000 + 15 * MIN + 1), 0, 'nach dem Fenster wieder frei');
});

test('ein Treffer löscht den Zähler', () => {
  const t = new Throttle({ max: 2, windowMs: MIN });
  t.fail('a', 0);
  t.succeed('a');
  t.fail('a', 10);
  assert.equal(t.blockedFor('a', 20), 0);
});

test('zwei Schlüssel, zwei Zähler', () => {
  const t = new Throttle({ max: 1, windowMs: MIN });
  t.fail('konto:a', 0);
  assert.ok(t.blockedFor('konto:a', 1) > 0);
  assert.equal(t.blockedFor('konto:b', 1), 0);
  assert.equal(t.blockedFor('ip:1.2.3.4', 1), 0);
});

test('alte Zähler werden weggeräumt', () => {
  const t = new Throttle({ max: 5, windowMs: MIN });
  t.fail('x', 0);
  t.fail('y', 0);
  assert.equal(t.size, 2);
  t.sweep(MIN + 1);
  assert.equal(t.size, 0);
});

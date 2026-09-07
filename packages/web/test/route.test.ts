import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { neighboursFor, neighboursForStep, reordered } from '../src/reorder.js';
import { modeOfRoute, parseRoute, pathOf, viewOf, type Route } from '../src/route.js';

/* ── Die Ansicht ist ein Ort ───────────────────────────────────────────── */

const ID = '7f3a9c21-4b5e-4d8a-9c1f-2e6b8a0d4f57';

test('jede Route überlebt den Weg in die URL und zurück', () => {
  const routes: Route[] = [
    { kind: 'today' },
    { kind: 'upcoming' },
    { kind: 'someday' },
    { kind: 'project', projectId: ID },
    { kind: 'mode', mode: 'search' },
    { kind: 'mode', mode: 'trash' },
  ];
  for (const route of routes) {
    assert.deepEqual(parseRoute(pathOf(route)), route, `${pathOf(route)} kommt nicht zurück`);
  }
});

test('die Wurzel ist Heute', () => {
  assert.deepEqual(parseRoute('/'), { kind: 'today' });
  assert.deepEqual(parseRoute(''), { kind: 'today' });
  assert.equal(pathOf({ kind: 'today' }), '/');
});

test('ein unbekannter Pfad ist Heute und kein Fehlerbildschirm', () => {
  // Wer einen alten Link öffnet, will nicht wissen, dass er alt ist.
  assert.deepEqual(parseRoute('/gibtsnicht'), { kind: 'today' });
  assert.deepEqual(parseRoute('/p'), { kind: 'today' });
});

test('eine Projekt-Id, die keine ist, wird nicht an den Server gegeben', () => {
  assert.deepEqual(parseRoute('/p/haus'), { kind: 'today' });
  assert.deepEqual(parseRoute('/p/../../etc'), { kind: 'today' });
  assert.deepEqual(parseRoute(`/p/${ID}`), { kind: 'project', projectId: ID });
});

test('die Route sagt, welche Ansicht der Server liefern soll', () => {
  assert.equal(viewOf({ kind: 'today' }), 'today');
  assert.equal(viewOf({ kind: 'upcoming' }), 'upcoming');
  assert.equal(viewOf({ kind: 'someday' }), 'someday');
  assert.equal(viewOf({ kind: 'project', projectId: ID }), 'project');
  // Ein Modus ohne Bildschirm liefert keine fremde Liste nach.
  assert.equal(viewOf({ kind: 'mode', mode: 'trash' }), 'today');
});

test('alle Aufgaben-Ansichten leuchten denselben Modus in der Schiene', () => {
  for (const route of [
    { kind: 'today' } as const,
    { kind: 'upcoming' } as const,
    { kind: 'someday' } as const,
    { kind: 'project', projectId: ID } as const,
  ]) {
    assert.equal(modeOfRoute(route), 'tasks');
  }
  assert.equal(modeOfRoute({ kind: 'mode', mode: 'shares' }), 'shares');
});

/* ── Nachbarn beim Umsortieren ─────────────────────────────────────────── */

const L = ['a', 'b', 'c', 'd'];

test('nach oben an den Anfang', () => {
  assert.deepEqual(neighboursFor(L, 2, 0), { afterId: null, beforeId: 'a' });
});

test('nach oben in die Mitte', () => {
  assert.deepEqual(neighboursFor(L, 3, 1), { afterId: 'a', beforeId: 'b' });
});

test('nach unten ans Ende', () => {
  assert.deepEqual(neighboursFor(L, 0, 4), { afterId: 'd', beforeId: null });
});

test('nach unten um eine Stelle — die eigene Zeile zählt nicht mit', () => {
  // Die Falle: `a` steht noch in der Liste, also ist Stelle 2 nach dem
  // Herausnehmen die Stelle 1. Wer das übersieht, landet eine Stelle zu hoch
  // und die Zeile bewegt sich nicht.
  assert.deepEqual(neighboursFor(L, 0, 2), { afterId: 'b', beforeId: 'c' });
});

test('auf die eigene Stelle heißt: nichts zu tun', () => {
  assert.equal(neighboursFor(L, 1, 1), null);
  assert.equal(neighboursFor(L, 1, 2), null);
});

test('unmögliche Stellen werden abgelehnt', () => {
  assert.equal(neighboursFor(L, -1, 0), null);
  assert.equal(neighboursFor(L, 4, 0), null);
  assert.equal(neighboursFor(L, 0, 5), null);
});

test('ein Schritt mit der Tastatur bewegt genau eine Stelle', () => {
  assert.deepEqual(neighboursForStep(L, 'c', -1), { afterId: 'a', beforeId: 'b' });
  assert.deepEqual(neighboursForStep(L, 'b', 1), { afterId: 'c', beforeId: 'd' });
  // An den Rändern gibt es keinen Schritt.
  assert.equal(neighboursForStep(L, 'a', -1), null);
  assert.equal(neighboursForStep(L, 'd', 1), null);
  assert.equal(neighboursForStep(L, 'x', 1), null);
});

test('ein Schritt nach unten und einer zurück ergibt dieselbe Reihe', () => {
  const once = reordered(L, 1, 3);
  assert.deepEqual(once, ['a', 'c', 'b', 'd']);
  assert.deepEqual(reordered(once, 2, 1), L);
});

test('die Vorschau stimmt mit den gemeldeten Nachbarn überein', () => {
  // Der eigentliche Punkt: was die Oberfläche zeigt und was sie dem Server
  // sagt, müssen dieselbe Reihenfolge ergeben.
  for (let from = 0; from < L.length; from += 1) {
    for (let to = 0; to <= L.length; to += 1) {
      const n = neighboursFor(L, from, to);
      if (n === null) continue;
      const preview = reordered(L, from, to);
      const at = preview.indexOf(L[from]!);
      assert.equal(
        at === 0 ? null : preview[at - 1],
        n.afterId,
        `von ${from} nach ${to}: linker Nachbar`,
      );
      assert.equal(
        at === preview.length - 1 ? null : preview[at + 1],
        n.beforeId,
        `von ${from} nach ${to}: rechter Nachbar`,
      );
    }
  }
});

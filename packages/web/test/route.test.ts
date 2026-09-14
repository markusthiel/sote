import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { neighboursFor, neighboursForStep, reordered } from '../src/reorder.js';
import { listRouteFor, modeOfRoute, parseRoute, pathOf, placeOf, viewOf, type Route } from '../src/route.js';

/* ── Die Ansicht ist ein Ort ───────────────────────────────────────────── */

const ID = '7f3a9c21-4b5e-4d8a-9c1f-2e6b8a0d4f57';

test('ein Aufgabenlink zeigt sein Projekt oder den Posteingang und behält seine Adresse', () => {
  const route: Route = { kind: 'task', taskId: ID };
  assert.deepEqual(listRouteFor(route, 'project-id'), { kind: 'project', projectId: 'project-id' });
  assert.deepEqual(listRouteFor(route, null), { kind: 'inbox' });
  assert.equal(listRouteFor(route, undefined), route, 'ein noch unbekannter Ort bleibt unaufgelöst');
  assert.equal(pathOf(route), `/a/${ID}`, 'Neuladen und Zurück behalten den Aufgabenlink');
  const today: Route = { kind: 'today' };
  assert.equal(listRouteFor(today, 'project-id'), today, 'normale Listen werden nicht umgeleitet');
});

/** Wie der Browser: Pfad und Abfrageteil getrennt. */
function roundTrip(route: Route): Route {
  const path = pathOf(route);
  const q = path.indexOf('?');
  return q < 0 ? parseRoute(path) : parseRoute(path.slice(0, q), path.slice(q));
}

test('jede Route überlebt den Weg in die URL und zurück', () => {
  const routes: Route[] = [
    { kind: 'today' },
    { kind: 'upcoming' },
    { kind: 'someday' },
    { kind: 'project', projectId: ID },
    { kind: 'search', q: '' },
    { kind: 'search', q: 'kabel +haus' },
    { kind: 'mode', mode: 'trash' },
    { kind: 'calendar', span: 'week', date: '2026-09-14' },
    { kind: 'calendar', span: 'month', date: '2026-09-01' },
    { kind: 'calendar', span: 'day', date: '2026-09-14' },
    { kind: 'calendar-sources' },
  ];
  for (const route of routes) {
    assert.deepEqual(roundTrip(route), route, `${pathOf(route)} kommt nicht zurück`);
  }
});

test('die Suchabfrage steht in der URL und wird richtig kodiert', () => {
  const path = pathOf({ kind: 'search', q: 'projekt:"Umzug Büro" !!' });
  assert.match(path, /^\/suche\?q=/);
  assert.equal(path.includes(' '), false, 'ein Leerzeichen gehört kodiert');
  assert.deepEqual(roundTrip({ kind: 'search', q: 'projekt:"Umzug Büro" !!' }), {
    kind: 'search',
    q: 'projekt:"Umzug Büro" !!',
  });
});

test('/suche ohne Abfrage ist die leere Suche, nicht Heute', () => {
  assert.deepEqual(parseRoute('/suche'), { kind: 'search', q: '' });
  assert.deepEqual(parseRoute('/suche', '?q='), { kind: 'search', q: '' });
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
  assert.equal(viewOf({ kind: 'search', q: 'kabel' }), 'today');
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

test('jede Adresse führt dorthin, wo der Klick hinführt', () => {
  /*
   * Der Fehler, den es gibt: in `parseRoute` standen ZWEI `case 'workspaces'`
   * im selben `switch` — der alte gab die Platzhalterseite zurück, der neue
   * war toter Code. Ein doppelter Fall ist in JavaScript erlaubt, also sagte
   * niemand etwas: nicht der Übersetzer, nicht das Lint, nicht die Tests.
   *
   * Und mein Test im Browser fand es nicht, weil er GEKLICKT hat. Ein Klick
   * setzt den Zustand direkt; nur ein Neuladen geht durch `parseRoute`. Beides
   * muss dasselbe ergeben, sonst ist eine Adresse eine Sackgasse — genau die
   * Eigenschaft, wegen der die Einstellungen überhaupt Adressen haben.
   */
  const roundTrip: readonly Route[] = [
    { kind: 'today' },
    { kind: 'upcoming' },
    { kind: 'someday' },
    { kind: 'search', q: 'kabel' },
    { kind: 'settings', section: 'profil' },
    { kind: 'settings', section: 'aussehen' },
    { kind: 'workspaces', section: 'alle' },
    { kind: 'workspaces', section: 'aussehen' },
    { kind: 'admin', section: 'instanz' },
    // Der Posteingang ist seit dem Bau eine ANSICHT und kein Modus mehr — er
    // hat einen Inhalt, und die Platzhalterseite hatte keinen.
    { kind: 'inbox' },
    // Freigaben sind seit dem Bau ein Ort mit Inhalt und kein Platzhalter.
    { kind: 'shares' },
    // Und ein Link ohne Konto: der Token steht in der ADRESSE, sonst ist es
    // keiner, den man weitergeben kann.
    { kind: 'share', token: 'A'.repeat(43) },
    // Eine Einladung: auch ohne Konto erreichbar, also im Rundgang.
    { kind: 'invite', token: 'B'.repeat(43) },
    { kind: 'mode', mode: 'trash' },
  ];
  for (const route of roundTrip) {
    const path = pathOf(route);
    const [pathname, query] = path.split('?');
    assert.deepEqual(
      parseRoute(pathname!, query ?? ''),
      route,
      `${path} kommt nicht als dieselbe Route zurück`,
    );
  }
});

test('kein Fall steht zweimal im switch', () => {
  // Direkt am Dateiinhalt, weil die Sprache es erlaubt und der Übersetzer
  // schweigt. Ein Test über das Verhalten oben hätte den Fall gefunden — dieser
  // findet auch den, den noch niemand als Route benutzt.
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'route.ts'),
    'utf8',
  );
  const cases = [...src.matchAll(/^\s*case '([a-z-]+)':/gm)].map((m) => m[1]!);
  const seen = new Map<string, number>();
  for (const c of cases) seen.set(c, (seen.get(c) ?? 0) + 1);
  // Zweimal ist erlaubt, wenn es zwei switch-Blöcke sind (lesen und schreiben);
  // dreimal ist es nie.
  for (const [name, n] of seen) {
    assert.ok(n <= 2, `„${name}" steht ${n}-mal — mindestens einer ist toter Code`);
  }
});

test('der Ort einer Route: Projekte sind je einer, Suchabfragen sind einer', () => {
  // Gemeldet: die Spalte blieb bei der Suche offen, beim Wechsel des Bereichs,
  // bei Benachrichtigungen. Die Spalte schließt, wenn sich der ORT ändert.
  assert.equal(placeOf({ kind: 'today' }), 'today');
  assert.notEqual(placeOf({ kind: 'today' }), placeOf({ kind: 'search', q: 'x' }));
  assert.notEqual(placeOf({ kind: 'today' }), placeOf({ kind: 'notifications' }));
  assert.notEqual(
    placeOf({ kind: 'project', projectId: 'a' }),
    placeOf({ kind: 'project', projectId: 'b' }),
    'zwei Projekte sind zwei Orte',
  );
  assert.equal(
    placeOf({ kind: 'search', q: 'a' }),
    placeOf({ kind: 'search', q: 'ab' }),
    'Weitertippen ist kein Ortswechsel',
  );
});

test('/kalender ohne Tag ist die Woche von heute, mit Unsinn auch', () => {
  assert.deepEqual(parseRoute('/kalender/quellen'), { kind: 'calendar-sources' });
  assert.equal(modeOfRoute({ kind: 'calendar-sources' }), 'calendar');
  assert.notEqual(placeOf({ kind: 'calendar-sources' }), placeOf({ kind: 'calendar', span: 'week', date: '2026-09-14' }));
  const r = parseRoute('/kalender');
  assert.equal(r.kind, 'calendar');
  if (r.kind === 'calendar') {
    assert.equal(r.span, 'week');
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
  }
  const u = parseRoute('/kalender/tag/gestern');
  assert.equal(u.kind === 'calendar' && u.span, 'day');
});

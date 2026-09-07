/**
 * SOTE — Wanduhr und Zeitpunkt.
 *
 * Gemeldet: „morgen 9 Uhr" eingetippt, „morgen, 11:00" angezeigt. Diese Datei
 * hält die Rechnung fest, die das behebt — inklusive der beiden Tage im Jahr,
 * an denen sie schwierig ist.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  endOfDayIn,
  fromWallClock,
  isZone,
  offsetMs,
  startOfDayIn,
  toWallClock,
} from '../src/time/zone.js';

const BERLIN = 'Europe/Berlin';
const H = 3_600_000;

test('eine Zone wird geprüft, nicht geglaubt', () => {
  assert.equal(isZone(BERLIN), true);
  assert.equal(isZone('UTC'), true);
  assert.equal(isZone('Pacific/Auckland'), true);
  assert.equal(isZone(''), false);
  assert.equal(isZone('Europa/Berlin'), false);
  assert.equal(isZone('nope'), false);
});

test('Berlin ist im Winter eine und im Sommer zwei Stunden vor UTC', () => {
  assert.equal(offsetMs(BERLIN, new Date('2026-01-15T12:00:00Z')), 1 * H);
  assert.equal(offsetMs(BERLIN, new Date('2026-07-15T12:00:00Z')), 2 * H);
  assert.equal(offsetMs('UTC', new Date('2026-07-15T12:00:00Z')), 0);
});

test('der gemeldete Fall: 9 Uhr Wanduhr ist 07:00Z im Sommer', () => {
  // Genau die Rechnung, die vorher fehlte.
  const wall = new Date(Date.UTC(2026, 8, 8, 9, 0));
  const real = fromWallClock(BERLIN, wall);
  assert.equal(real.toISOString(), '2026-09-08T07:00:00.000Z');
  // Und die Uhr in Berlin zeigt darauf wieder 9.
  assert.equal(toWallClock(BERLIN, real).getUTCHours(), 9);
});

test('hin und zurück ist dasselbe, über das ganze Jahr', () => {
  for (let day = 1; day <= 365; day += 1) {
    const at = new Date(Date.UTC(2026, 0, day, 13, 37));
    const back = fromWallClock(BERLIN, toWallClock(BERLIN, at));
    assert.equal(back.getTime(), at.getTime(), `Tag ${day}`);
  }
});

test('Mitternacht ist die der Person, nicht die von UTC', () => {
  // Der zweite Teil des Fehlers: um 00:30 Berliner Zeit ist es in UTC noch
  // gestern — eine Ansicht „heute", die in UTC rechnet, zeigt dann den
  // falschen Tag.
  const at = new Date('2026-09-08T22:30:00Z'); // 00:30 am 9. in Berlin
  assert.equal(startOfDayIn(BERLIN, at).toISOString(), '2026-09-08T22:00:00.000Z');
  assert.equal(endOfDayIn(BERLIN, at).toISOString(), '2026-09-09T21:59:59.999Z');
  // In UTC wäre derselbe Zeitpunkt noch der 8.
  assert.equal(startOfDayIn('UTC', at).toISOString(), '2026-09-08T00:00:00.000Z');
});

test('ein Tag ist nicht immer 24 Stunden lang', () => {
  // Umstellung nach vorn: 29. März 2026, 02:00 → 03:00. Der Tag hat 23 Stunden.
  const inside = new Date('2026-03-29T10:00:00Z');
  const len = endOfDayIn(BERLIN, inside).getTime() - startOfDayIn(BERLIN, inside).getTime();
  assert.equal(Math.round(len / H), 23);

  // Und zurück: 25. Oktober 2026, 25 Stunden.
  const autumn = new Date('2026-10-25T10:00:00Z');
  const len2 = endOfDayIn(BERLIN, autumn).getTime() - startOfDayIn(BERLIN, autumn).getTime();
  assert.equal(Math.round(len2 / H), 25);
});

test('die Stunde, die es nicht gibt, rutscht nach vorn', () => {
  // 29. März 2026 um 02:30 gibt es in Berlin nicht. Entschieden: der Zeitpunkt
  // NACH der Umstellung, also 03:30 — statt eines Fehlers über eine Stunde,
  // die es nicht gibt.
  const wall = new Date(Date.UTC(2026, 2, 29, 2, 30));
  const real = fromWallClock(BERLIN, wall);
  assert.equal(toWallClock(BERLIN, real).getUTCHours(), 3);
  assert.equal(real.toISOString(), '2026-03-29T01:30:00.000Z');
});

test('die Stunde, die es zweimal gibt, nimmt das erste Vorkommen', () => {
  // 25. Oktober 2026 um 02:30 gibt es zweimal. Entschieden: das frühere —
  // bei einer Erinnerung ist zu früh besser als zu spät.
  const wall = new Date(Date.UTC(2026, 9, 25, 2, 30));
  const real = fromWallClock(BERLIN, wall);
  assert.equal(real.toISOString(), '2026-10-25T00:30:00.000Z');
  assert.equal(toWallClock(BERLIN, real).getUTCHours(), 2);
});

test('eine Zone weit weg und über die Datumsgrenze', () => {
  // Auckland ist im Januar 13 Stunden vor UTC: 9 Uhr dort ist der Vortag 20:00Z.
  const wall = new Date(Date.UTC(2026, 0, 15, 9, 0));
  assert.equal(fromWallClock('Pacific/Auckland', wall).toISOString(), '2026-01-14T20:00:00.000Z');
  // Und westlich davon andersherum.
  assert.equal(fromWallClock('America/Los_Angeles', wall).toISOString(), '2026-01-15T17:00:00.000Z');
});

test('UTC bleibt UTC — der Weg muss ohne Zone dasselbe tun wie vorher', () => {
  const at = new Date('2026-09-08T09:00:00Z');
  assert.equal(toWallClock('UTC', at).getTime(), at.getTime());
  assert.equal(fromWallClock('UTC', at).getTime(), at.getTime());
});

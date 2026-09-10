import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  COMMON_LEAD_MINUTES,
  describeTaskReminder,
  readTaskReminder,
  saysLead,
  taskReminderDueAt,
  taskReminderIsDue,
} from '../src/task/reminder.js';

test('ein Vorlauf zählt vor dem geplanten Zeitpunkt', () => {
  const plan = new Date('2026-09-10T09:00:00Z');
  assert.deepEqual(taskReminderDueAt({ kind: 'before', minutes: 0 }, plan), plan, 'pünktlich');
  assert.deepEqual(
    taskReminderDueAt({ kind: 'before', minutes: 30 }, plan),
    new Date('2026-09-10T08:30:00Z'),
  );
  assert.deepEqual(
    taskReminderDueAt({ kind: 'before', minutes: 24 * 60 }, plan),
    new Date('2026-09-09T09:00:00Z'),
    'einen Tag vorher',
  );
});

test('eine absolute Erinnerung gilt unabhängig vom Plan', () => {
  const at = new Date('2026-09-10T07:00:00Z');
  assert.deepEqual(taskReminderDueAt({ kind: 'at', at }, null), at, 'auch ohne Plan');
  assert.deepEqual(
    taskReminderDueAt({ kind: 'at', at }, new Date('2026-12-24T18:00:00Z')),
    at,
    'und der Plan ändert sie nicht',
  );
});

test('„30 Minuten vor nichts" ist keine Zeit', () => {
  /*
   * `undefined` und kein Fehler: die Erinnerung bleibt gespeichert und wird
   * fällig, sobald die Aufgabe einen Termin bekommt. Ein Fehler hier hieße,
   * dass man an einer ungeplanten Aufgabe keine Erinnerung setzen darf — und
   * dann müsste man erst planen, um erinnert zu werden.
   */
  assert.equal(taskReminderDueAt({ kind: 'before', minutes: 30 }, null), undefined);
});

test('eine verschickte Erinnerung ist nicht mehr fällig', () => {
  const plan = new Date('2026-09-10T09:00:00Z');
  const now = new Date('2026-09-10T08:59:00Z');
  const r = { kind: 'before', minutes: 30 } as const;
  assert.equal(taskReminderIsDue(r, { plannedAt: plan, sentAt: null, now }), true, 'offen und vorbei');
  assert.equal(
    taskReminderIsDue(r, { plannedAt: plan, sentAt: new Date('2026-09-10T08:30:00Z'), now }),
    false,
    'schon geschickt — sonst kommt derselbe Brief bei jedem Durchgang noch einmal',
  );
});

test('vor ihrer Zeit klingelt sie nicht', () => {
  assert.equal(
    taskReminderIsDue(
      { kind: 'before', minutes: 30 },
      {
        plannedAt: new Date('2026-09-10T09:00:00Z'),
        sentAt: null,
        now: new Date('2026-09-10T08:00:00Z'),
      },
    ),
    false,
  );
});

test('die Vorläufe heißen auf Deutsch, was sie sind', () => {
  assert.equal(saysLead(0), 'pünktlich');
  assert.equal(saysLead(10), '10 Minuten vorher');
  assert.equal(saysLead(60), 'eine Stunde vorher');
  assert.equal(saysLead(120), '2 Stunden vorher');
  assert.equal(saysLead(24 * 60), 'einen Tag vorher');
  assert.equal(saysLead(48 * 60), '2 Tage vorher');
  // Und jeder angebotene Vorlauf muss einen Satz haben, sonst steht in der
  // Auswahl eine Zahl ohne Wort.
  for (const m of COMMON_LEAD_MINUTES) {
    assert.match(saysLead(m), /[a-zä]/, `${m} hat keinen Satz`);
  }
});

test('eine Zeile trägt genau eine Form', () => {
  assert.deepEqual(readTaskReminder({ offset_minutes: 30, at: null }), {
    kind: 'before',
    minutes: 30,
  });
  const at = new Date('2026-09-10T07:00:00Z');
  assert.deepEqual(readTaskReminder({ offset_minutes: null, at }), { kind: 'at', at });
  // Beides oder keines kann die Datenbank nicht enthalten (CHECK
  // `reminder_is_one_kind`) — kommt es doch, ist etwas kaputt und das gehört
  // gesagt, nicht stillschweigend übergangen.
  assert.throws(() => readTaskReminder({ offset_minutes: 30, at }), /entweder/);
  assert.throws(() => readTaskReminder({ offset_minutes: null, at: null }), /entweder/);
});

test('eine absolute Erinnerung wird in der Zone gesagt, in der sie gemeint ist', () => {
  const at = new Date('2026-09-10T07:00:00Z');
  const berlin = describeTaskReminder({ kind: 'at', at }, 'Europe/Berlin');
  const tokio = describeTaskReminder({ kind: 'at', at }, 'Asia/Tokyo');
  assert.notEqual(berlin, tokio, 'derselbe Augenblick, zwei Uhrzeiten');
  assert.match(berlin, /09:00/, 'Berlin ist im September zwei Stunden vor UTC');
});

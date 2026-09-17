/**
 * Die Verbindungsadresse wird geprüft, bevor `pg` sie sieht.
 *
 * `pg` meldet eine unlesbare Adresse als „Invalid URL“ — ohne Variable, ohne
 * Ursache. Die Ursache war ein `POSTGRES_PASSWORD` aus `openssl rand -base64
 * 32` mit einem `/`, das compose unkodiert in die Adresse einsetzt. Der Server
 * muss stattdessen die Variable und den Ausweg nennen.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { EnvError, databaseUrl } from '../src/env.js';

const NAME = 'SOTE_TEST_DATABASE_URL';

const withValue = <T>(value: string, fn: () => T): T => {
  const before = process.env[NAME];
  process.env[NAME] = value;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env[NAME];
    else process.env[NAME] = before;
  }
};

describe('SOTE_DATABASE_URL', () => {
  test('ein schlichtes Kennwort geht unverändert durch', () => {
    const url = 'postgres://sote:0f3a9c@db:5432/sote';
    assert.equal(withValue(url, () => databaseUrl(NAME)), url);
  });

  test('ein Base64-Kennwort mit Schrägstrich wird abgelehnt — mit Variable und Ausweg', () => {
    assert.throws(
      () => withValue('postgres://sote:ab/cd+ef==@db:5432/sote', () => databaseUrl(NAME)),
      (err: unknown) =>
        err instanceof EnvError &&
        err.message.includes(NAME) &&
        /POSTGRES_PASSWORD/.test(err.message) &&
        /openssl rand -hex 32/.test(err.message),
    );
  });

  test('ein prozentkodiertes Kennwort ist in Ordnung', () => {
    const url = 'postgres://sote:ab%2Fcd@db:5432/sote';
    assert.equal(withValue(url, () => databaseUrl(NAME)), url);
  });
});

/**
 * SOTE — Einstellungen.
 *
 * Nach SONEs Vorbild ein **eigener Bildschirm** und kein Dialog über den
 * Aufgaben (SONEs ADR-0027, ADR-0032). Ein Dialog über etwas, das man beim
 * Einstellen ansehen will, verdeckt genau das.
 *
 * ## Die Ebene steht an der Einstellung
 *
 * Drei Abschnitte, und der Titel jedes einzelnen sagt, **wessen** Einstellung
 * das ist: „Du", „Dieser Arbeitsbereich", „Diese Instanz". Das ist SONEs
 * Grenze zwischen den Bereichen — „whose settings these are rather than who may
 * change them" — und sie ist hier wichtiger als dort, weil in SOTE alle drei
 * auf einem Bildschirm liegen.
 *
 * ## Woher ein Wert kommt, steht dabei
 *
 * Ein Schalter, der „dunkel" zeigt, ohne zu sagen, dass der Arbeitsbereich das
 * vorgibt, ist eine Auskunft, die zur Frage wird, sobald man sie ändert und
 * nichts passiert. Deshalb zeigt jede Zeile ihren eigenen Wert **und** was
 * daraus folgt.
 *
 * ## Was hier nicht steht
 *
 * Textgröße und Dichte. Die gehören dem Browser und nicht der Person (SONEs
 * ADR-0124), und es gibt sie in SOTE noch nicht — sie kämen mit einem eigenen
 * Abschnitt „Dieses Gerät", damit niemand sie für synchronisiert hält.
 */

import { resolveSettings, SCHEMES, type Scheme } from '@sote/core';
import { useEffect, useState } from 'react';

import { api, ApiError, type SettingsAnswer } from '../api.js';
import { applyScheme } from '../appearance.js';

const SCHEME_LABELS: Record<Scheme, string> = {
  system: 'Wie das Gerät',
  light: 'Hell',
  dark: 'Dunkel',
};

/** Zonen, die man ohne Nachschlagen erkennt — plus die des Browsers. */
function zoneChoices(): string[] {
  const mine = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return 'UTC';
    }
  })();
  return [
    ...new Set([
      mine,
      'Europe/Berlin',
      'Europe/London',
      'America/New_York',
      'America/Los_Angeles',
      'Asia/Tokyo',
      'Australia/Sydney',
      'UTC',
    ]),
  ];
}

export function Settings({
  workspaceName,
  displayName,
  email,
  onClose,
}: {
  workspaceName: string;
  displayName: string;
  email: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<SettingsAnswer | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setData(await api.settings());
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : 'Laden ging nicht.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  async function save(scope: 'user' | 'workspace' | 'instance', changes: Record<string, unknown>) {
    setBusy(true);
    setNotice(undefined);
    try {
      /*
       * Ein Umlauf, nicht zwei.
       *
       * Vorher: PATCH, dann ein volles GET hinterher — auf einer entfernten
       * Instanz sind das zwei Wartezeiten für eine Handlung. Die Antwort des
       * PATCH enthält, was die Ebene jetzt sagt; was daraus insgesamt folgt,
       * rechnet der Kern mit derselben Funktion wie der Server.
       */
      const saved = await api.patchSettings(scope, changes);
      // `data` ist hier gesetzt: ohne geladene Antwort gibt es keine Knöpfe.
      const levels = { ...data!.levels, [scope]: saved.settings };
      const next = {
        levels,
        effective: resolveSettings(levels.user, levels.workspace, levels.instance),
      };
      setData(next);
      // Sofort anwenden und nicht erst beim nächsten Laden: eine Einstellung,
      // die man ändert und nicht sieht, ist eine Einstellung, die man zweimal
      // ändert.
      applyScheme(next.effective.scheme);
    } catch (e) {
      setNotice(
        e instanceof ApiError
          ? e.code === 'not_allowed'
            ? 'Das darfst du hier nicht ändern.'
            : e.message
          : 'Speichern ging nicht.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (data === undefined) {
    return (
      <div className="settings">
        <p className="muted">{notice ?? 'Einen Moment…'}</p>
      </div>
    );
  }

  const schemeRow = (
    scope: 'user' | 'workspace' | 'instance',
    /** `null` heißt „nichts gesagt" — die Ebene darüber entscheidet. */
    value: Scheme | undefined,
    /**
     * Was hier steht, wenn nichts gewählt ist — oder `null`.
     *
     * `null` für die Instanz, und das ist kein Sonderfall, sondern die
     * Wahrheit: über ihr steht nichts mehr. „Nichts gesagt" und „wie das
     * Gerät" haben dort **dieselbe Wirkung**, und beide anzubieten wäre eine
     * Wahl, die keine ist — im Bild standen prompt zwei Knöpfe mit demselben
     * Wort nebeneinander.
     */
    inherited: string | null,
  ) => (
    <div className="set-row">
      <span className="set-label">Erscheinung</span>
      <div className="set-choice" role="radiogroup" aria-label={`Erscheinung — ${scope}`}>
        {inherited === null ? null : (
          <button
            type="button"
            role="radio"
            aria-checked={value === undefined}
            disabled={busy}
            onClick={() => void save(scope, { scheme: null })}
          >
            {inherited}
          </button>
        )}
        {SCHEMES.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={value === s}
            disabled={busy}
            onClick={() => void save(scope, { scheme: s })}
          >
            {SCHEME_LABELS[s]}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="settings">
      <div className="settings-head">
        <h1>Einstellungen</h1>
        <button type="button" className="btn" onClick={onClose}>
          Fertig
        </button>
      </div>

      {notice === undefined ? null : <p className="note-error">{notice}</p>}

      {/* ── Du ── */}
      <section className="set-card">
        <h2>Du</h2>
        <p className="muted">
          {displayName} — {email}. Diese Einstellungen reisen mit dir; wer hier
          dunkel wählt, bekommt am Telefon auch dunkel.
        </p>
        {schemeRow('user', data.levels.user.scheme, 'Wie der Arbeitsbereich')}
        <div className="set-row">
          <span className="set-label">Zeitzone</span>
          <div className="set-value">
            <select
              aria-label="Deine Zeitzone"
              disabled={busy}
              value={data.levels.user.zone ?? ''}
              onChange={(e) =>
                void save('user', { zone: e.target.value === '' ? null : e.target.value })
              }
            >
              <option value="">Wie der Browser sagt</option>
              {zoneChoices().map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
            <p className="muted small">
              Der Browser weiß, wo du gerade bist, und hat beim Tippen Vorrang.
              Diese Angabe gilt für alles, was ohne Browser passiert — später
              etwa nächtliche Erinnerungen.
            </p>
          </div>
        </div>
      </section>

      {/* ── Der Arbeitsbereich ── */}
      <section className="set-card">
        <h2>{workspaceName}</h2>
        <p className="muted">
          Gilt für alle Mitglieder, solange sie selbst nichts anderes gewählt
          haben.
        </p>
        {schemeRow('workspace', data.levels.workspace.scheme, 'Wie die Instanz')}
      </section>

      {/* ── Die Instanz ── */}
      <section className="set-card">
        <h2>Diese Instanz</h2>
        <p className="muted">
          Die Vorgabe für alle Arbeitsbereiche, die nichts eigenes sagen.
        </p>
        {schemeRow('instance', data.levels.instance.scheme, null)}
      </section>

      <p className="muted small">
        Gerade gilt: <strong>{SCHEME_LABELS[data.effective.scheme]}</strong>
        {data.effective.zone === undefined ? null : `, ${data.effective.zone}`}
      </p>
    </div>
  );
}

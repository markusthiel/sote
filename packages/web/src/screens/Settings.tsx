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

import {
  CORNERS,
  FONTS,
  LANDINGS,
  PALETTE,
  readThemeFile,
  resolveLanding,
  resolveLook,
  themeFile,
  resolveSettings,
  SCHEMES,
  SURFACES,
  TREATMENTS,
  type Landing,
  type Look,
  type Scheme,
} from '@sote/core';
import { useEffect, useState } from 'react';

import { api, ApiError, type SettingsAnswer } from '../api.js';
import { applyScheme } from '../appearance.js';

/**
 * Die Abschnitte, und wessen Einstellungen sie sind.
 *
 * Auf Modulebene, weil die **Seitenleiste** sie braucht, bevor der Bildschirm
 * etwas zeichnet — dieselbe Aufteilung wie in SONE, wo die Einstellungen keine
 * eigene Hülle mehr sind, sondern das Panel füllen: „the way back is the mark,
 * the account is at the foot of the rail". Eine Hülle über allem war ein
 * zweiter Rahmen für dieselbe Anwendung.
 *
 * Die Überschrift jedes Abschnitts sagt, **wessen** Einstellung das ist. Das
 * ist SONEs Grenze zwischen den Bereichen — „whose settings these are rather
 * than who may change them".
 */
export const SETTING_SECTIONS = [
  { id: 'profil', label: 'Profil', hint: 'Name und Adresse' },
  { id: 'aussehen', label: 'Aussehen', hint: 'Hell oder dunkel' },
  { id: 'zeit', label: 'Zeit', hint: 'Deine Zeitzone' },
  { id: 'landen', label: 'Wo du landest', hint: 'Beim Anmelden' },
  { id: 'erinnern', label: 'Erinnerungen', hint: 'Post am Morgen' },
] as const;

/**
 * Was unter „Workspaces" steht, und was unter „Verwaltung".
 *
 * Drei Bereiche statt einer Liste mit drei Kästen, und die Aufteilung ist
 * SONEs: **die Einstellungen sind deine, ein Arbeitsbereich gehört allen darin,
 * die Verwaltung gilt für jeden auf dem Server.** Vorher lagen alle drei auf
 * einem Bildschirm, und die Überschrift jedes Kastens musste sagen, wen er
 * angeht — das war eine Notlösung dafür, dass der Ort es nicht sagte.
 */
export const WORKSPACE_SECTIONS = [
  { id: 'alle', label: 'Alle Workspaces', hint: 'Übersicht' },
  { id: 'name', label: 'Name und Zeichen', hint: 'Woran man ihn erkennt' },
  { id: 'landen', label: 'Standard-Seite', hint: 'Vorgabe für alle' },
  { id: 'leute', label: 'Leute', hint: 'Wer hier mitarbeitet' },
  { id: 'rollen', label: 'Rollen', hint: 'Was jemand darf' },
  { id: 'gruppen', label: 'Gruppen', hint: 'Leute zusammenfassen' },
  { id: 'weg', label: 'Mitnehmen und wegwerfen', hint: 'Export und Löschen' },
  { id: 'aussehen', label: 'Farben und Flächen', hint: 'Für alle Mitglieder' },
] as const;

export const ADMIN_SECTIONS = [
  { id: 'instanz', label: 'Diese Instanz', hint: 'Vorgaben für alle' },
  { id: 'konten', label: 'Konten', hint: 'Wer auf diesem Server ist' },
  { id: 'einladungen', label: 'Einladungen', hint: 'Neue Konten' },
  { id: 'wartung', label: 'Wartung', hint: 'Was von selbst läuft' },
] as const;

/** Wie die Flächen und Beziehungen heißen — SONEs Worte, auf Deutsch. */
const SURFACE_LABELS: Record<(typeof SURFACES)[number], string> = {
  rail: 'Schmale Leiste',
  sidebar: 'Seitenleiste',
  detail: 'Detailspalte',
};

const TREATMENT_LABELS: Record<(typeof TREATMENTS)[number], string> = {
  follow: 'Wie entworfen',
  raised: 'Angehoben',
  sunken: 'Vertieft',
  inverted: 'Umgekehrt',
  accent: 'Akzentfarbe',
};

const FONT_LABELS: Record<(typeof FONTS)[number], string> = {
  designed: 'Wie entworfen',
  reading: 'Zum Lesen',
  plain: 'Nüchtern',
  system: 'Wie das Gerät',
};

/**
 * Die Orte, und was sie versprechen.
 *
 * Die Erklärung steht neben jeder Wahl und nicht als Absatz darüber: wer
 * „oberste Seite" liest, will wissen, was daran wackelt, und zwar dort.
 */
const LANDING_LABELS: Record<
  (typeof LANDINGS)[number],
  { label: string; hint: string }
> = {
  last: { label: 'Wo du zuletzt warst', hint: 'Folgt dir — die Ansicht, die zuletzt offen war.' },
  today: { label: 'Heute', hint: 'Immer dieselbe Frage: was liegt an.' },
  inbox: { label: 'Posteingang', hint: 'Erst einsortieren, dann arbeiten.' },
  project: {
    label: 'Ein bestimmtes Projekt',
    hint: 'Immer dasselbe, egal was du zuletzt getan hast.',
  },
};

const CORNER_LABELS: Record<(typeof CORNERS)[number], string> = {
  sharp: 'Kantig',
  soft: 'Wie entworfen',
  round: 'Rund',
};

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
  section,
  projects,
  workspaceName,
  displayName,
  email,
  onEffective,
}: {
  section: string;
  /** Für „ein bestimmtes Projekt" — die Liste ist ohnehin da. */
  projects: readonly { id: string; name: string }[];
  workspaceName: string;
  displayName: string;
  email: string;
  /**
   * Sagt der Hülle, was jetzt gilt.
   *
   * Ohne das war die Einstellung gespeichert und **nicht angewandt**: die Hülle
   * holt `/api/settings` nur beim Wechsel des Arbeitsbereichs, also sah man
   * eine geänderte Fläche erst nach dem Neuladen. Eine Einstellung, die man
   * ändert und nicht sieht, ist eine Einstellung, die man zweimal ändert.
   *
   * Gemeldet und nicht neu geholt: die Antwort des Schreibens sagt schon, was
   * die Ebene jetzt sagt, und der Kern rechnet daraus dasselbe wie der Server.
   */
  onEffective: (out: { scheme: Scheme; look: Look }) => void;
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
        effective: {
          ...resolveSettings(levels.user, levels.workspace, levels.instance),
          look: resolveLook(levels.workspace, levels.instance),
          // Jedes Feld, das der Server auflöst, wird hier auch aufgelöst.
          // Sonst zeigt der Bildschirm nach dem Speichern etwas anderes als
          // nach dem Neuladen — und das ist der Fehler, den man erst beim
          // Neuladen sieht.
          landing: resolveLanding(levels.user.landing, levels.workspace.landing),
        },
      };
      setData(next);
      // Sofort anwenden und nicht erst beim nächsten Laden.
      applyScheme(next.effective.scheme);
      onEffective({ scheme: next.effective.scheme, look: next.effective.look });
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

  /**
   * Eine Angabe im Aussehen ändern, ohne die anderen zu verlieren.
   *
   * `look` ist **ein** Feld in den Einstellungen, also schreibt jedes Ändern
   * das ganze Objekt. Ohne das Zusammenführen hier würde ein Klick auf „Ecken:
   * rund" die Flächen leeren — der Fehler, bei dem eine Einstellung eine
   * andere still wegwirft, und der erst auffällt, wenn jemand beides gesetzt
   * hat.
   */
  const saveLook = (
    scope: 'workspace' | 'instance',
    before: Look,
    /*
     * `undefined` heißt hier ausdrücklich „auf die Vorgabe zurück".
     *
     * Deshalb steht es im Typ und wird nicht von `exactOptionalPropertyTypes`
     * wegdefiniert: ein Zurückstellen ist eine Angabe und kein fehlendes Feld.
     */
    change: { [K in keyof Look]?: Look[K] | undefined },
  ) => {
    const next: Record<string, unknown> = { ...before, ...change };
    // Was auf die Vorgabe zurückgestellt wird, verschwindet — abwesend und
    // „wie entworfen" sind derselbe Zustand (Konzept, `theme.ts`).
    for (const [key, value] of Object.entries(change)) {
      if (value === undefined) delete next[key];
    }
    void save(scope, { look: Object.keys(next).length === 0 ? null : next });
  };

  const lookCard = (scope: 'workspace' | 'instance', look: Look) => (
    <section className="set-card">
      <h2>Farben und Flächen</h2>
      <p className="muted">
        Gewählt wird eine <strong>Beziehung</strong> und keine Farbe: „umgekehrt"
        ist im hellen Design dunkel und im dunklen hell — aus einem gespeicherten
        Wert. Ein festes Grau wäre in beiden dasselbe Grau.
      </p>

      {SURFACES.map((surface) => (
        <div className="set-row" key={surface}>
          <span className="set-label">{SURFACE_LABELS[surface]}</span>
          <div className="set-choice" role="radiogroup" aria-label={SURFACE_LABELS[surface]}>
            {TREATMENTS.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={(look.surfaces?.[surface] ?? 'follow') === t}
                disabled={busy}
                onClick={() =>
                  saveLook(scope, look, {
                    surfaces:
                      t === 'follow'
                        ? Object.fromEntries(
                            Object.entries(look.surfaces ?? {}).filter(([k]) => k !== surface),
                          )
                        : { ...look.surfaces, [surface]: t },
                  })
                }
              >
                {TREATMENT_LABELS[t]}
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className="set-row">
        <span className="set-label">Schrift</span>
        <div className="set-value">
          <div className="set-choice" role="radiogroup" aria-label="Schrift">
            {FONTS.map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={(look.fonts ?? 'designed') === f}
                disabled={busy}
                onClick={() =>
                  saveLook(scope, look, {
                    fonts: f === 'designed' ? undefined : f,
                  })
                }
              >
                {FONT_LABELS[f]}
              </button>
            ))}
          </div>
          <p className="muted small">
            Ein benanntes Paar und keine Schriftfamilie: eine eingetippte Schrift
            ist eine, die die Maschine der anderen vielleicht nicht hat — und wer
            sie eingetippt hat, sieht seine eigene und kann es nicht wissen.
          </p>
        </div>
      </div>

      <div className="set-row">
        <span className="set-label">Ecken</span>
        <div className="set-choice" role="radiogroup" aria-label="Ecken">
          {CORNERS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={(look.corners ?? 'soft') === c}
              disabled={busy}
              onClick={() =>
                saveLook(scope, look, { corners: c === 'soft' ? undefined : c })
              }
            >
              {CORNER_LABELS[c]}
            </button>
          ))}
        </div>
      </div>

      {/*
        Ein Thema als Datei — und KEINE Route dafür (SONEs ADR-0125).
        Der Browser liest die Datei und schickt sie über den Weg, der ohnehin
        existiert. Ein zweiter Endpunkt wäre eine zweite Stelle, an der ein
        Thema geprüft wird.
      */}
      <div className="set-row">
        <span className="set-label">Als Datei</span>
        <div className="set-value">
          <div className="pick">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                // `lookCard` gibt es nur für Arbeitsbereich und Instanz — die
                // Person hat kein Thema (ADR-0028: das Aussehen gestaltet, was
                // alle sehen). Der Zweig für 'user' war darum toter Code, und
                // der Übersetzer hat es gesagt.
                const level = data!.levels[scope];
                const text = JSON.stringify(themeFile(level), null, 2);
                const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
                const a = document.createElement('a');
                a.href = url;
                a.download = `sote-thema-${scope}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Speichern
            </button>
            <label className="btn as-label">
              {/*
                „Laden und übernehmen", weil es genau das tut.
                In SONE füllt das Laden ein Formular und „Speichern" schreibt;
                SOTE hat kein solches Formular — hier wirkt jeder Klick sofort,
                und ein Zwischenzustand nur für den Dateiweg wäre ein zweites
                Bedienmodell in einem Bildschirm.
              */}
              Laden und übernehmen
              <input
                type="file"
                accept="application/json,.json"
                aria-label="Thema laden"
                disabled={busy}
                onChange={(e) => {
                  const datei = e.target.files?.[0];
                  // Das Feld leeren, sonst löst dieselbe Datei zweimal nichts
                  // aus — ein Wähler, der beim zweiten Mal schweigt, sieht wie
                  // ein Fehler aus.
                  e.target.value = '';
                  if (datei === undefined) return;
                  void datei.text().then((text) => {
                    const out = readThemeFile(text);
                    if (!out.ok) {
                      setNotice(
                        out.why === 'kein_json'
                          ? 'Das ist keine Datei dieser Art.'
                          : 'Das ist eine Datei, aber kein Thema von SOTE.',
                      );
                      return;
                    }
                    void save(scope, {
                      // Beides in EINEM Schreibvorgang: zwei hintereinander
                      // wären zwei Zustände, von denen der erste kurz sichtbar
                      // ist — und bei einem Thema ist genau das der Moment, in
                      // dem es falsch aussieht.
                      ...(out.theme.scheme === undefined ? {} : { scheme: out.theme.scheme }),
                      look: out.theme.look ?? null,
                    });
                  });
                }}
              />
            </label>
          </div>
          <p className="muted small">
            Eine Datei trägt das ganze Thema: Farben, Flächen, Ecken, Schrift und
            hell oder dunkel. Geladen wird sie sofort übernommen — eine Datei
            kann nichts, was du hier nicht auch einstellen könntest.
          </p>
        </div>
      </div>

      <div className="set-row">
        <span className="set-label">Tönung</span>
        <div className="set-value">
          <div className="pick">
            {/*
              Ein freier Wähler und keine Palette: eine Tönung ist die
              Hausfarbe von jemandem, und die ist selten eine von acht. Ein
              Palettenname wäre hier auch inhaltlich falsch — er soll der
              Palette folgen, und die Tönung folgt niemandem.
            */}
            <input
              type="color"
              aria-label="Tönung"
              disabled={busy}
              value={look.tint ?? '#f0ede5'}
              onChange={(e) => saveLook(scope, look, { tint: e.target.value as `#${string}` })}
            />
            <button
              type="button"
              className="btn"
              disabled={busy || look.tint === undefined}
              onClick={() => saveLook(scope, look, { tint: undefined })}
            >
              Zurücksetzen
            </button>
          </div>
          <p className="muted small">
            Wird in Seitenleiste, Bereiche und Menüs gemischt — eine Farbe statt
            einer pro Fläche, damit sie weiter zusammengehören. Die Seite bleibt
            fast unberührt.
          </p>
        </div>
      </div>

      <div className="set-row">
        <span className="set-label">Akzent</span>
        <div className="set-value">
          <div className="set-choice" role="radiogroup" aria-label="Akzent">
            <button
              type="button"
              role="radio"
              aria-checked={look.accent === undefined}
              disabled={busy}
              onClick={() => saveLook(scope, look, { accent: undefined })}
            >
              Wie entworfen
            </button>
            {PALETTE.map((name) => (
              <button
                key={name}
                type="button"
                role="radio"
                className="swatch-btn"
                aria-label={name}
                aria-checked={look.accent === name}
                disabled={busy}
                style={{ background: `var(--sote-palette-${name})` }}
                onClick={() => saveLook(scope, look, { accent: name })}
              />
            ))}
          </div>
          <div className="pick">
            {/*
              Beides ist erlaubt, und der Unterschied ist keine Bequemlichkeit:
              ein NAME folgt der Palette und ist damit in beiden Themen richtig,
              ein HEX-WERT ist in beiden derselbe. Wer genau diesen einen Ton
              will, nimmt den Wähler.
            */}
            <input
              type="color"
              aria-label="Eigene Akzentfarbe"
              disabled={busy}
              value={look.accent?.startsWith('#') === true ? look.accent : '#2f7d6f'}
              onChange={(e) => saveLook(scope, look, { accent: e.target.value as `#${string}` })}
            />
            <span className="muted small">
              Eigene Farbe — ein Name folgt der Palette, ein Wert bleibt er selbst.
            </span>
          </div>
        </div>
      </div>
    </section>
  );

  /**
   * Wo eine Sitzung aufgeht — eine Liste je Ebene.
   *
   * Auf der Personen-Ebene gibt es einen Eintrag mehr: „wie der Workspace",
   * und der nennt, was das gerade heißt. Ohne diese Angabe müsste man den
   * anderen Bildschirm aufsuchen, um zu wissen, was man gerade wählt.
   */
  const landingCard = (
    scope: 'user' | 'workspace',
    mine: Landing | undefined,
    workspaceSays: Landing | undefined,
  ) => (
    <section className="set-card">
      <h2>{scope === 'user' ? 'Wo du landest' : 'Standard-Seite'}</h2>
      <p className="muted">
        {scope === 'user'
          ? 'Beim Anmelden, beim Wechsel des Workspace, oder wenn SOTE ohne bestimmte Adresse geöffnet wird. Gilt nur für dich.'
          : 'Die Vorgabe für alle Mitglieder, die selbst nichts gewählt haben.'}
      </p>

      {scope === 'user' ? (
        <button
          type="button"
          className="set-choice-row"
          aria-current={mine === undefined}
          disabled={busy}
          onClick={() => void save('user', { landing: null })}
        >
          <span className="scr-label">Wie der Workspace</span>
          <span className="scr-hint">
            Zurzeit:{' '}
            {workspaceSays === undefined
              ? LANDING_LABELS.today.label
              : LANDING_LABELS[workspaceSays.kind].label}
          </span>
        </button>
      ) : null}

      {LANDINGS.map((kind) => {
        const chosen = (scope === 'user' ? mine : workspaceSays)?.kind === kind;
        if (kind === 'project') {
          /*
           * Ein Projekt statt eines Knopfes: „ein bestimmtes" ohne die Angabe,
           * welches, wäre eine Wahl, die man nicht treffen kann — der Zustand
           * dazwischen gehört gar nicht in die Daten (`readLanding` wirft ihn
           * weg).
           */
          return (
            <div className="set-choice-row as-row" key={kind}>
              <span className="scr-label">{LANDING_LABELS[kind].label}</span>
              <select
                aria-label="Projekt zum Landen"
                disabled={busy || projects.length === 0}
                value={
                  ((scope === 'user' ? mine : workspaceSays)?.projectId ?? '') as string
                }
                onChange={(e) =>
                  void save(scope, {
                    landing:
                      e.target.value === ''
                        ? null
                        : { kind: 'project', projectId: e.target.value },
                  })
                }
              >
                <option value="">— keins gewählt —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          );
        }
        return (
          <button
            type="button"
            className="set-choice-row"
            key={kind}
            aria-current={chosen}
            disabled={busy}
            onClick={() => void save(scope, { landing: { kind } })}
          >
            <span className="scr-label">{LANDING_LABELS[kind].label}</span>
            <span className="scr-hint">{LANDING_LABELS[kind].hint}</span>
          </button>
        );
      })}
    </section>
  );

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
      {/*
        Kein „Fertig"-Knopf mehr.
        Er stand hier, weil der Bildschirm sich wie ein Dialog anfühlte. Tut er
        nicht mehr: die Seitenleiste trägt die Abschnitte, die Schiene steht
        daneben, und der Weg zurück ist derselbe wie überall — ein Klick auf
        Aufgaben. Ein zusätzlicher Ausgang wäre ein zweiter Weg für dieselbe
        Sache (SONEs ADR-0032).
      */}

      {section === 'profil' ? (
        <section className="set-card">
          <h2>Profil</h2>
          <div className="set-row">
            <span className="set-label">Name</span>
            <div className="set-value">{displayName}</div>
          </div>
          <div className="set-row">
            <span className="set-label">E-Mail</span>
            <div className="set-value">
              {email}
              <p className="muted small">
                Sie erkennt das Konto beim Anmelden. Sie zu ändern braucht einen
                Weg, die neue Adresse als eigene zu belegen — den hat diese
                Instanz noch nicht.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {section === 'aussehen' ? (
        <section className="set-card">
          <h2>Aussehen</h2>
          <p className="muted">
            Reist mit dir: wer hier dunkel wählt, bekommt am Telefon auch dunkel.
          </p>
          {schemeRow('user', data.levels.user.scheme, 'Wie der Arbeitsbereich')}
        </section>
      ) : null}

      {section === 'erinnern' ? (
        <section className="set-card">
          <h2>Erinnerungen</h2>
          <p className="muted">
            <strong>Ein</strong> Brief am Tag, zu deiner Zeit — mit dem, was
            heute anliegt und was überfällig ist. Nicht einer je Aufgabe: dreißig
            Mails am Tag heißen einen Filter im Postfach, und danach erinnert
            nichts mehr an nichts.
          </p>
          <div className="set-row">
            <span className="set-label">Post am Morgen</span>
            <div className="set-value">
              <div className="pick">
                <input
                  type="time"
                  className="set-input"
                  aria-label="Zeit für die Erinnerung"
                  value={data.levels.user.reminders?.at ?? ''}
                  disabled={busy}
                  onChange={(e) =>
                    void save('user', {
                      // Leer heißt aus — und das ist eine Angabe, kein
                      // Vergessen: ein leeres Feld ist der übliche Weg, eine
                      // Zeit zurückzunehmen.
                      reminders: e.target.value === '' ? null : { at: e.target.value },
                    })
                  }
                />
                {data.levels.user.reminders === undefined ? (
                  <span className="muted small">aus</span>
                ) : (
                  <button
                    type="button"
                    className="btn quiet small"
                    disabled={busy}
                    onClick={() => void save('user', { reminders: null })}
                  >
                    Abstellen
                  </button>
                )}
              </div>
              <p className="muted small">
                Deine Ortszeit ({data.effective.zone ?? 'UTC'}). Nachgesehen wird
                alle fünfzehn Minuten — der Brief kommt also kurz nach der
                gewählten Zeit, nie davor.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {section === 'landen' ? (
        landingCard('user', data.levels.user.landing, data.levels.workspace.landing)
      ) : null}

      {section === 'ws-landen' ? (
        landingCard('workspace', undefined, data.levels.workspace.landing)
      ) : null}

      {section === 'zeit' ? (
        <section className="set-card">
          <h2>Zeit</h2>
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
      ) : null}

      {/* ── Unter „Workspaces" ── */}
      {section === 'ws-aussehen' ? (
        <>
          <section className="set-card">
            <h2>{workspaceName}</h2>
            <p className="muted">
              Gilt für alle Mitglieder, solange sie selbst nichts anderes gewählt
              haben.
            </p>
            {schemeRow('workspace', data.levels.workspace.scheme, 'Wie die Instanz')}
          </section>
          {lookCard('workspace', data.levels.workspace.look ?? {})}
        </>
      ) : null}

      {/* ── Unter „Verwaltung" ── */}
      {section === 'instanz' ? (
        <>
          <section className="set-card">
            <h2>Diese Instanz</h2>
            <p className="muted">
              Die Vorgabe für alle Arbeitsbereiche, die nichts eigenes sagen.
            </p>
            {schemeRow('instance', data.levels.instance.scheme, null)}
          </section>
          {lookCard('instance', data.levels.instance.look ?? {})}
        </>
      ) : null}

      {notice === undefined ? null : <p className="note-error">{notice}</p>}

      <p className="muted small">
        Gerade gilt: <strong>{SCHEME_LABELS[data.effective.scheme]}</strong>
        {data.effective.zone === undefined ? null : `, ${data.effective.zone}`}
      </p>
    </div>
  );
}

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
  BOARD_TINTS,
  BOARD_TINT_SAYS,
  BOARD_WIDTHS,
  BOARD_WIDTH_SAYS,
  LIST_VIEWS,
  LIST_VIEW_SAYS,
  SCHEMES,
  SURFACES,
  TREATMENTS,
  type Board,
  type Landing,
  type Look,
  type Scheme,
} from '@sote/core';
import { useEffect, useState } from 'react';

import { api, ApiError, type SettingsAnswer } from '../api.js';
import { applyScheme } from '../appearance.js';
import { NOTE_SAYS, type NoteKind } from '@sote/core';

import { OwnColor } from '../components/OwnColor.js';
import { pushAus, pushEin, pushStand, type PushStand } from '../lib/push.js';
import { avatarVariant } from '../imageVariant.js';

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
  { id: 'melden', label: 'Benachrichtigungen', hint: 'Was wo ankommt' },
  { id: 'kalender', label: 'Kalender', hint: 'Abonnement für dein Programm' },
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
  /*
   * „Überall" (Heute und Demnächst aus allen Bereichen) stand hier ganz
   * oben. Es ist in den Kalender in der Schiene aufgegangen: der zeigt alle
   * Bereiche mit Filter und beantwortet dieselbe Frage — „was liegt an" —
   * mit Tagen statt mit zwei Listen. Gemeldet: „die war da noch nicht ganz
   * korrekt."
   */
  { id: 'alle', label: 'Alle Workspaces', hint: 'Übersicht' },
  { id: 'name', label: 'Name und Zeichen', hint: 'Woran man ihn erkennt' },
  { id: 'landen', label: 'Standard-Seite', hint: 'Vorgabe für alle' },
  { id: 'leute', label: 'Leute', hint: 'Wer hier mitarbeitet' },
  { id: 'rollen', label: 'Rollen', hint: 'Was jemand darf' },
  { id: 'gruppen', label: 'Gruppen', hint: 'Leute zusammenfassen' },
  { id: 'schlagworte', label: 'Schlagwörter', hint: 'Richtigstellen und wegräumen' },
  { id: 'tafel', label: 'Tafel', hint: 'Spalten und Fertig' },
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

/**
 * Was ein Profilbild in dieser Datei braucht.
 *
 * Als eigener Haken, weil drei Zustände zusammengehören: ob eines da ist, ob
 * gerade etwas läuft, und ein Zähler, der den Browser zum Neuholen zwingt.
 * Einzeln im Bildschirm verstreut wären sie drei Dinge, die man einzeln
 * vergisst.
 */
function useAvatar(userId: string): {
  hatBild: boolean;
  picStand: number;
  picBusy: boolean;
  picNotice: string | undefined;
  bildHoch: (datei: File) => Promise<void>;
  bildWeg: () => Promise<void>;
} {
  const [hatBild, setHatBild] = useState(false);
  const [picStand, setPicStand] = useState(0);
  const [picBusy, setPicBusy] = useState(false);
  const [picNotice, setPicNotice] = useState<string | undefined>(undefined);

  useEffect(() => {
    let lebt = true;
    // Ein HEAD statt eines GET: die Frage ist „gibt es eines", nicht „gib es
    // mir" — das Bild holt gleich danach das `img`-Element selbst.
    void fetch(`/api/users/${userId}/picture`, { method: 'HEAD' })
      .then((r) => {
        if (lebt) setHatBild(r.ok);
      })
      .catch(() => undefined);
    return () => {
      lebt = false;
    };
  }, [userId]);

  async function bildHoch(datei: File): Promise<void> {
    setPicBusy(true);
    setPicNotice(undefined);
    try {
      const klein = await avatarVariant(datei);
      if (klein === undefined) {
        /*
         * Kein Rückfall auf das Original.
         *
         * Bei SONE lädt der Aufrufer dann die große Datei hoch; hier wäre das
         * das Handyfoto in der Datenbank, und der Deckel lehnt es ohnehin ab.
         * Ein Satz ist die richtige Antwort — und er sagt, was zu tun ist.
         */
        setPicNotice('Dieses Bild lässt sich nicht verkleinern. Ein JPEG oder PNG geht.');
        return;
      }
      await api.setPicture(klein);
      setHatBild(true);
      // Der Zähler zwingt den Browser zum Neuholen: die Adresse bleibt
      // dieselbe, und `cache-control` gilt auch für den, der es geändert hat.
      setPicStand((n) => n + 1);
    } catch (e) {
      setPicNotice(e instanceof ApiError ? e.message : 'Hochladen ging nicht.');
    } finally {
      setPicBusy(false);
    }
  }

  async function bildWeg(): Promise<void> {
    setPicBusy(true);
    setPicNotice(undefined);
    try {
      await api.deletePicture();
      setHatBild(false);
      setPicStand((n) => n + 1);
    } catch (e) {
      setPicNotice(e instanceof ApiError ? e.message : 'Entfernen ging nicht.');
    } finally {
      setPicBusy(false);
    }
  }

  return { hatBild, picStand, picBusy, picNotice, bildHoch, bildWeg };
}

export function Settings({
  section,
  projects,
  workspaceName,
  workspaceId,
  displayName,
  email,
  userId,
  onEffective,
}: {
  section: string;
  /** Für „ein bestimmtes Projekt" — die Liste ist ohnehin da. */
  projects: readonly { id: string; name: string }[];
  workspaceName: string;
  /**
   * WELCHER Arbeitsbereich. Ohne ihn nahm der Server den ersten — und die
   * Akzentfarbe „dieses" Arbeitsbereichs war immer die des ersten.
   */
  workspaceId: string | undefined;
  displayName: string;
  email: string;
  /** Für die Adresse des eigenen Bildes: `/api/users/:id/picture`. */
  userId: string;
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
  /**
   * Ob dieses Gerät Meldungen bekommt.
   *
   * Aus dem BROWSER gelesen und nicht vom Server: er weiss, ob es ein
   * Abonnement gibt, aber nicht, ob der Browser die Erlaubnis noch hat — die
   * kann man ihm jederzeit entziehen, ohne dass jemand den Server fragt.
   */
  const [pushLage, setPushLage] = useState<PushStand>(() => pushStand());
  const [busy, setBusy] = useState(false);
  /**
   * Wohin Meldungen gehen — vom Server, auch wenn es nur die Vorgabe ist.
   *
   * `undefined` heisst „noch nicht geladen" und nicht „nichts eingestellt":
   * die beiden zu verwechseln hiesse, für einen Augenblick alle Schalter aus
   * zu zeigen und damit etwas zu behaupten, das nicht stimmt.
   */
  const [kanaele, setKanaele] = useState<
    | {
        channels: { kind: string; email: boolean; push: boolean; eigen: boolean }[];
        mailOn: boolean;
      }
    | undefined
  >(undefined);

  useEffect(() => {
    if (section !== 'melden') return;
    void api
      .channels()
      .then(setKanaele)
      .catch(() => undefined);
  }, [section]);

  /*
   * Sofort umlegen und dann schreiben.
   *
   * Ein Schalter, der erst nach der Antwort umspringt, fühlt sich kaputt an —
   * und die Antwort kommt hier immer, weil es eine Zeile in einer Tabelle ist.
   * Geht es doch schief, lädt der Fehlerfall die Wahrheit neu.
   */
  async function setzeKanal(kind: string, wohin: { email: boolean; push: boolean }) {
    setKanaele((alt) =>
      alt === undefined
        ? alt
        : {
            ...alt,
            channels: alt.channels.map((c) =>
              c.kind === kind ? { ...c, ...wohin, eigen: true } : c,
            ),
          },
    );
    setBusy(true);
    try {
      await api.setChannels(kind, wohin);
    } catch {
      setKanaele(await api.channels().catch(() => undefined));
    } finally {
      setBusy(false);
    }
  }
  const { hatBild, picStand, picBusy, picNotice, bildHoch, bildWeg } = useAvatar(userId);

  const load = async () => {
    try {
      setData(await api.settings(workspaceId));
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : 'Laden ging nicht.');
    }
  };

  /*
   * Neu laden, wenn der Arbeitsbereich wechselt.
   *
   * Hier stand `[]` — geladen wurde EINMAL. Gemeldet: „Wenn ich bei Workspaces
   * Einstellungen mache und den Workspace wechsle und da auch Einstellungen
   * machen will, dann übernimmt er die vom Vorgänger."
   *
   * Und der Schaden ist größer als eine falsche Anzeige: `save` baut die neue
   * Ebene aus `data.levels` auf, also aus dem Stand des VORGÄNGERS. Wer dann
   * irgendetwas anderes einstellte, schrieb dessen Akzentfarbe in diesen
   * Arbeitsbereich — „wenn ich jetzt irgendwas anderes dort eingestellt habe,
   * hat er auch die Farbe übernommen." Ein stehengebliebener Stand, aus dem
   * geschrieben wird, ist kein Anzeigefehler, sondern Datenverlust.
   *
   * `data` wird beim Wechsel zurückgesetzt: sonst zeigt die Maske für einen
   * Augenblick die Werte des alten Bereichs, und ein Klick in diesem Augenblick
   * schreibt sie fest.
   */
  useEffect(() => {
    setData(undefined);
    void load();
  }, [workspaceId]);

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
      const saved = await api.patchSettings(scope, changes, workspaceId);
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

  /*
   * Schrift und Ecken haben eine EIGENE Karte — SONEs Trennung.
   *
   * Gemeldet dort: *„der Bereich Typografie [sollte] aufgeteilt werden. Schrift
   * Design kann gerne alleine stehen, aber die Oberfläche, Tönung,
   * Akzent-Farbe gehört da nicht hin."* Und die Antwort im Code: *„the surfaces
   * and the type scale have nothing to do with each other, and only the second
   * is typography."*
   *
   * In SOTE standen beide in „Farben und Flächen" — eine Karte, die zwei
   * verschiedene Dinge sagt. Die Ecken gehen mit der Schrift und nicht mit den
   * Farben: beide sind die Form der Oberfläche, nicht ihre Färbung.
   */
  const typeCard = (scope: 'workspace' | 'instance', look: Look) => (
    <section className="settings-card">
      <h2>Schrift und Form</h2>
      <p className="muted">
        Wie die Oberfläche gesetzt ist. Die Farben stehen darüber — zwei Fragen,
        zwei Karten.
      </p>
      <div className="settings-row">
        <span className="settings-row-label"><b>Schrift</b><span>Ein benanntes Paar und keine Schriftfamilie: eine eingetippte Schrift
            ist eine, die die Maschine der anderen vielleicht nicht hat — und wer
            sie eingetippt hat, sieht seine eigene und kann es nicht wissen.</span></span>
        <div className="settings-row-value">
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
        </div>
      </div>

      <div className="settings-row">
        <span className="settings-row-label"><b>Ecken</b></span>
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
      </div>    </section>
  );

  /**
   * Wie die Tafel aussieht.
   *
   * Eine GRUPPE und keine einzelne Farbe: gewünscht war „welche Tönung und
   * Akzentfarbe speziell für diese Spalte", mit dem Zusatz „da folgen sicher
   * noch mehr Einstellungen". Eine Einstellung allein bekäme einen Abschnitt,
   * der für eine Sache zu groß und für die nächste zu klein wäre.
   *
   * Auf Arbeitsbereichs-Ebene und nicht je Person: die Tafel eines Vorhabens
   * sieht für alle gleich aus — sie ist der Gegenstand und nicht die Brille
   * (ADR-0028). Was jeder für sich wählt, ist die Anzeigeform, und die steht
   * im Kopf der Liste.
   */
  const boardCard = (scope: 'workspace' | 'instance', board: Board) => (
    <section className="settings-card">
      <h2>Tafel</h2>
      <p className="muted">
        Gilt für alle Tafeln in diesem Arbeitsbereich. Welche Anzeigeform eine
        Liste hat, wählt jeder für sich im Kopf der Liste.
      </p>

      <div className="settings-row">
        <span className="settings-row-label">
          <b>Fertig-Spalte</b>
          <span>
            Wie deutlich sie sich von den anderen abhebt. „Wie jede andere" ist
            eine Wahl — wer zehn Spalten hat, will vielleicht keine
            hervorgehoben.
          </span>
        </span>
        <div className="settings-row-value">
          <div className="set-choice" role="radiogroup" aria-label="Tönung der Fertig-Spalte">
            {BOARD_TINTS.map((wahl) => (
              <button
                key={wahl}
                type="button"
                role="radio"
                aria-checked={board.doneTint === wahl}
                disabled={busy}
                onClick={() => save(scope, { board: { ...board, doneTint: wahl } })}
              >
                {BOARD_TINT_SAYS[wahl]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="settings-row">
        <span className="settings-row-label">
          <b>Farbe dafür</b>
          <span>
            Ohne Wahl die des Arbeitsbereichs — und dann wandert sie mit, wenn
            der Akzent wechselt.
          </span>
        </span>
        <div className="settings-row-value">
          <div className="set-choice" role="radiogroup" aria-label="Farbe der Fertig-Spalte">
            <button
              type="button"
              role="radio"
              aria-checked={board.doneAccent === undefined}
              disabled={busy}
              onClick={() =>
                save(scope, { board: { ...board, doneAccent: null } as never })
              }
            >
              Wie der Akzent
            </button>
            {PALETTE.map((name) => (
              <button
                key={name}
                type="button"
                role="radio"
                className="swatch-btn"
                aria-label={name}
                aria-checked={board.doneAccent === name}
                disabled={busy}
                style={{ background: `var(--sote-palette-${name})` }}
                onClick={() => save(scope, { board: { ...board, doneAccent: name } })}
              />
            ))}
            {/*
              Und eine EIGENE Farbe — dieselbe Pipette wie beim Akzent und am
              Arbeitsbereich.

              GEMELDET: „Überall wo wir Farben auswählen können, sollte man auch
              eine eigene Farbe hinzufügen können mit Picker. Also bei Tafel,
              bei Name und Zeichen auch."

              Der Kern nimmt sie längst (`readBoard` prüft auf `#rrggbb`), nur
              diese Stelle bot sie nicht an. Ein Name folgt der Palette und ist
              in beiden Themen richtig; ein Wert bleibt er selbst.
            */}
            <OwnColor
              value={board.doneAccent}
              disabled={busy}
              label="Fertig-Spalte: eigene Farbe"
              onPick={(farbe) => save(scope, { board: { ...board, doneAccent: farbe } })}
            />
          </div>
        </div>
      </div>

      <div className="settings-row">
        <span className="settings-row-label">
          <b>Spaltenbreite</b>
          <span>Wie viele Spalten nebeneinander passen, bevor gerollt wird.</span>
        </span>
        <div className="settings-row-value">
          <div className="set-choice" role="radiogroup" aria-label="Spaltenbreite">
            {BOARD_WIDTHS.map((wahl) => (
              <button
                key={wahl}
                type="button"
                role="radio"
                aria-checked={board.columnWidth === wahl}
                disabled={busy}
                onClick={() => save(scope, { board: { ...board, columnWidth: wahl } })}
              >
                {BOARD_WIDTH_SAYS[wahl]}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );

  const lookCard = (scope: 'workspace' | 'instance', look: Look) => (
    <section className="settings-card">
      <h2>Farben und Flächen</h2>
      <p className="muted">
        Gewählt wird eine <strong>Beziehung</strong> und keine Farbe: „umgekehrt"
        ist im hellen Design dunkel und im dunklen hell — aus einem gespeicherten
        Wert. Ein festes Grau wäre in beiden dasselbe Grau.
      </p>

      {SURFACES.map((surface) => (
        <div className="settings-row" key={surface}>
          <span className="settings-row-label"><b>{SURFACE_LABELS[surface]}</b></span>
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


      {/*
        Ein Thema als Datei — und KEINE Route dafür (SONEs ADR-0125).
        Der Browser liest die Datei und schickt sie über den Weg, der ohnehin
        existiert. Ein zweiter Endpunkt wäre eine zweite Stelle, an der ein
        Thema geprüft wird.
      */}
      <div className="settings-row">
        <span className="settings-row-label"><b>Als Datei</b><span>Eine Datei trägt das ganze Thema: Farben, Flächen, Ecken, Schrift und
            hell oder dunkel. Geladen wird sie sofort übernommen — eine Datei
            kann nichts, was du hier nicht auch einstellen könntest.</span></span>
        <div className="settings-row-value">
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
        </div>
      </div>

      <div className="settings-row">
        <span className="settings-row-label"><b>Tönung</b><span>Wird in Seitenleiste, Bereiche und Menüs gemischt — eine Farbe statt
            einer pro Fläche, damit sie weiter zusammengehören. Die Seite bleibt
            fast unberührt.</span></span>
        <div className="settings-row-value">
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
        </div>
      </div>

      <div className="settings-row">
        <span className="settings-row-label"><b>Akzent</b></span>
        <div className="settings-row-value">
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
            {/*
              Beides ist erlaubt, und der Unterschied ist keine Bequemlichkeit:
              ein NAME folgt der Palette und ist damit in beiden Themen richtig,
              ein HEX-WERT ist in beiden derselbe. Wer genau diesen einen Ton
              will, nimmt den Wähler.

              IN DERSELBEN REIHE wie die Palette und in derselben Größe — wie an
              den drei anderen Stellen, an denen es diese Wahl gibt. Vorher
              stand das Feld hier eine Zeile tiefer und war größer: dieselbe
              Sache, vier Zeilen weiter unten anders gebaut.
            */}
            <OwnColor
              value={look.accent}
              disabled={busy}
              label="Akzentfarbe: eigene Farbe"
              onPick={(farbe) => saveLook(scope, look, { accent: farbe as `#${string}` })}
            />
          </div>
          <div className="pick">
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
    <section className="settings-card">
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
    <div className="settings-row">
      <span className="settings-row-label"><b>Erscheinung</b></span>
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
        <section className="settings-card">
          <h2>Profil</h2>
          <div className="settings-row">
            <span className="settings-row-label"><b>Bild</b><span>Wird im Browser auf 512 Pixel verkleinert, bevor es hochgeht —
                das Original bleibt auf deinem Gerät. Ein Profilbild wird
                zweiundzwanzig Pixel breit gezeichnet.</span></span>
            <div className="settings-row-value">
              <div className="pic-row">
                {/*
                  Der Schlüssel `picStand` zwingt den Browser, neu zu holen.
                  Ohne ihn zeigt er nach dem Hochladen das alte Bild — die
                  Adresse ist dieselbe, und ein `cache-control` von einer Minute
                  gilt auch für den, der es gerade geändert hat.
                */}
                {hatBild ? (
                  <img
                    className="pic"
                    src={`/api/users/${userId}/picture?v=${picStand}`}
                    alt=""
                    width={64}
                    height={64}
                  />
                ) : (
                  // Kein Platzhalterbild: wer keines hat, hat keines, und die
                  // Initialen kennt die Oberfläche schon.
                  <div className="pic initials" aria-hidden="true">
                    {displayName
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((w) => w[0] ?? '')
                      .join('')
                      .toUpperCase()}
                  </div>
                )}
                <div className="pic-do">
                  <label className="btn">
                    {picBusy ? 'Einen Moment…' : hatBild ? 'Anderes wählen' : 'Bild wählen'}
                    {/*
                      Ein `label` um ein verstecktes Feld: ein Knopf, der ein
                      `input` anklickt, braucht JavaScript für etwas, das das
                      Formularelement selbst kann.
                    */}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      aria-label="Profilbild wählen"
                      disabled={picBusy}
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const datei = e.target.files?.[0];
                        // Das Feld leeren: wer dieselbe Datei zweimal wählt,
                        // löst sonst kein `change` aus, und dann sieht es aus,
                        // als wäre der Knopf kaputt.
                        e.target.value = '';
                        if (datei !== undefined) void bildHoch(datei);
                      }}
                    />
                  </label>
                  {hatBild ? (
                    <button
                      type="button"
                      className="btn quiet"
                      disabled={picBusy}
                      onClick={() => void bildWeg()}
                    >
                      Entfernen
                    </button>
                  ) : null}
                </div>
              </div>
              {picNotice === undefined ? null : (
                <p className="note-error">{picNotice}</p>
              )}
            </div>
          </div>
          <div className="settings-row">
            <span className="settings-row-label"><b>Name</b></span>
            <div className="settings-row-value">{displayName}</div>
          </div>
          <div className="settings-row">
            <span className="settings-row-label"><b>E-Mail</b><span>Sie erkennt das Konto beim Anmelden. Sie zu ändern braucht einen
                Weg, die neue Adresse als eigene zu belegen — den hat diese
                Instanz noch nicht.</span></span>
            <div className="settings-row-value">
              {email}
            </div>
          </div>
        </section>
      ) : null}

      {section === 'aussehen' ? (
        <section className="settings-card">
          <h2>Aussehen</h2>
          <p className="muted">
            Reist mit dir: wer hier dunkel wählt, bekommt am Telefon auch dunkel.
          </p>
          {schemeRow('user', data.levels.user.scheme, 'Wie der Arbeitsbereich')}
        </section>
      ) : null}

      {section === 'melden' ? (
        <section className="settings-card">
          <h2>Benachrichtigungen</h2>
          {/*
            WAS WO ANKOMMT.

            GEWÜNSCHT: „konfigurierbar machen, was per E-Mail benachrichtigt
            wird, über die Oberfläche oder per App?"

            Drei Spalten, von denen eine keine Wahl ist: der POSTEINGANG ist
            immer an. Er ist kein Kanal, sondern der Ort, an dem eine Meldung
            ohnehin steht — ihn abschaltbar zu machen hiesse, Meldungen zu
            erzeugen, die niemand je sieht.

            Die geltende Wahl kommt vom SERVER, auch wenn sie nur die Vorgabe
            ist. Zwei Stellen, die dieselbe Vorgabe kennen, laufen beim ersten
            Ändern auseinander.
          */}
          <p className="muted small">
            Im Posteingang steht jede Meldung — das lässt sich nicht abstellen.
            Hier wählst du, was zusätzlich per Mail kommt und was auf deine
            Geräte.
          </p>

          {kanaele === undefined ? (
            <p className="muted small">Wird geladen…</p>
          ) : (
            <div className="channels">
              <div className="channels-head">
                <span />
                <span>Mail</span>
                <span>App</span>
              </div>
              {kanaele.channels.map((c) => (
                <div className="channels-row" key={c.kind}>
                  <span className="channels-what">
                    <b>{NOTE_SAYS[c.kind as NoteKind]?.says ?? c.kind}</b>
                    <span className="muted small">
                      {NOTE_SAYS[c.kind as NoteKind]?.hint ?? ''}
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    aria-label={`${NOTE_SAYS[c.kind as NoteKind]?.says ?? c.kind} per Mail`}
                    checked={c.email}
                    /* Ohne Mailversand ist der Schalter ein Versprechen ohne
                       Deckung — dann steht er da und lässt sich nicht legen. */
                    disabled={busy || !kanaele.mailOn}
                    onChange={(e) =>
                      void setzeKanal(c.kind, { email: e.target.checked, push: c.push })
                    }
                  />
                  <input
                    type="checkbox"
                    aria-label={`${NOTE_SAYS[c.kind as NoteKind]?.says ?? c.kind} auf Geräte`}
                    checked={c.push}
                    disabled={busy}
                    onChange={(e) =>
                      void setzeKanal(c.kind, { email: c.email, push: e.target.checked })
                    }
                  />
                </div>
              ))}
            </div>
          )}
          {kanaele !== undefined && !kanaele.mailOn ? (
            <p className="muted small">
              Dieser Server verschickt keine Mail — ohne SMTP bleibt die Spalte aus.
            </p>
          ) : null}
        </section>
      ) : null}

      {section === 'erinnern' ? (
        <section className="settings-card">
          <h2>Erinnerungen</h2>
          {/*
            MELDUNGEN AUF DIESEM GERÄT.

            GEWÜNSCHT: „Wenn ich als App installiere, dass es richtige
            App-Benachrichtigungen sendet."

            Die Erlaubnis wird auf KNOPFDRUCK gefragt und nie von selbst: ein
            Browser fragt genau einmal, und wer beim ersten Laden gefragt wird,
            ohne zu wissen wofür, sagt nein. Danach gibt es keinen zweiten
            Versuch mehr — ausser in den Einstellungen des Browsers, die
            niemand findet.

            Je GERÄT und nicht je Konto: der Satz daneben sagt das, weil es
            sonst aussieht, als hätte man es überall eingeschaltet.
          */}
          <div className="settings-row">
            <span className="settings-row-label">
              <b>Meldungen auf diesem Gerät</b>
              <span>
                Erinnerungen kommen als Benachrichtigung an, auch wenn SOTE zu
                ist. Gilt für dieses Gerät — an einem zweiten schaltet man es
                dort ein.
              </span>
            </span>
            <div className="settings-row-value">
              {pushLage === 'unmöglich' ? (
                <span className="muted small">Dieser Browser kann das nicht.</span>
              ) : pushLage === 'verweigert' ? (
                <span className="muted small">
                  Der Browser lässt keine zu — das lässt sich nur in seinen
                  eigenen Einstellungen ändern.
                </span>
              ) : pushLage === 'an' ? (
                <button
                  type="button"
                  className="btn quiet small"
                  disabled={busy}
                  onClick={() => {
                    void pushAus().then(() => setPushLage(pushStand()));
                  }}
                >
                  Ausschalten
                </button>
              ) : (
                <button
                  type="button"
                  className="btn small"
                  disabled={busy}
                  onClick={() => {
                    void pushEin().then((r) => {
                      setPushLage(pushStand());
                      if (!r.ok && r.sagt !== undefined) setNotice(r.sagt);
                    });
                  }}
                >
                  Einschalten
                </button>
              )}
            </div>
          </div>
          <p className="muted">
            <strong>Ein</strong> Brief am Tag, zu deiner Zeit — mit dem, was
            heute anliegt und was überfällig ist. Nicht einer je Aufgabe: dreißig
            Mails am Tag heißen einen Filter im Postfach, und danach erinnert
            nichts mehr an nichts.
          </p>
          <div className="settings-row">
            <span className="settings-row-label"><b>Post am Morgen</b><span>Deine Ortszeit ({data.effective.zone ?? 'UTC'}). Nachgesehen wird
                alle fünfzehn Minuten — der Brief kommt also kurz nach der
                gewählten Zeit, nie davor.</span></span>
            <div className="settings-row-value">
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
        <section className="settings-card">
          <h2>Zeit</h2>
          <div className="settings-row">
            <span className="settings-row-label"><b>Zeitzone</b><span>Der Browser weiß, wo du gerade bist, und hat beim Tippen Vorrang.
                Diese Angabe gilt für alles, was ohne Browser passiert — später
                etwa nächtliche Erinnerungen.</span></span>
            <div className="settings-row-value">
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
            </div>
          </div>
        </section>
      ) : null}

      {/* ── Unter „Workspaces" ── */}
      {section === 'ws-tafel' ? boardCard('workspace', data.levels.workspace.board ?? {}) : null}

      {section === 'ws-aussehen' ? (
        <>
          <section className="settings-card">
            <h2>{workspaceName}</h2>
            <p className="muted">
              Gilt für alle Mitglieder, solange sie selbst nichts anderes gewählt
              haben.
            </p>
            {schemeRow('workspace', data.levels.workspace.scheme, 'Wie die Instanz')}
            {/*
              Die VORGABE für die Anzeigeform — nicht die Wahl.

              Wo jemand abweicht, stellt er im Kopf der Liste selbst ein, und
              das gehört ihm allein (Migration 0028): „jeder sollte die Liste
              so anzeigen können wie er möchte". Hier steht, was gilt, solange
              niemand etwas gesagt hat — auch für Heute und den Posteingang,
              die keine Liste sind und darum keine eigene Wahl haben können.
            */}
            <div className="settings-row">
              <span className="settings-row-label">
                <b>Listen zeigen</b>
                <span>
                  Vorgabe für alle. Wer eine Liste anders sehen will, stellt
                  das im Kopf der Liste ein — das gilt dann nur für ihn.
                </span>
              </span>
              <div className="settings-row-value">
                <div className="pick">
                  {LIST_VIEWS.map((wahl) => (
                    <button
                      key={wahl}
                      type="button"
                      className="btn quiet small"
                      aria-pressed={data.levels.workspace.listView === wahl}
                      title={LIST_VIEW_SAYS[wahl].says}
                      disabled={busy}
                      onClick={() =>
                        void save('workspace', {
                          // Nochmal dasselbe nimmt die Vorgabe zurück — dann
                          // gilt wieder die der Instanz. Ohne diesen Weg wäre
                          // „nichts vorgeben" nach der ersten Wahl für immer
                          // unerreichbar.
                          listView: data.levels.workspace.listView === wahl ? null : wahl,
                        })
                      }
                    >
                      {LIST_VIEW_SAYS[wahl].name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>
          {lookCard('workspace', data.levels.workspace.look ?? {})}
          {typeCard('workspace', data.levels.workspace.look ?? {})}
        </>
      ) : null}

      {/* ── Unter „Verwaltung" ── */}
      {section === 'instanz' ? (
        <>
          <section className="settings-card">
            <h2>Diese Instanz</h2>
            <p className="muted">
              Die Vorgabe für alle Arbeitsbereiche, die nichts eigenes sagen.
            </p>
            {schemeRow('instance', data.levels.instance.scheme, null)}
          </section>
          {lookCard('instance', data.levels.instance.look ?? {})}
          {typeCard('instance', data.levels.instance.look ?? {})}
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

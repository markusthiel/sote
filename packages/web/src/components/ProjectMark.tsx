/**
 * SOTE — das Zeichen eines Projekts.
 *
 * Abgesehen von SONE (`EntryIconView.tsx`), und zwar samt Begründung: **der
 * ganze Lucide-Satz, abgeleitet statt gelistet.** Meine erste Fassung hatte
 * zwölf selbst gezeichnete Pfade; gemeldet: „Auch die Icons stimmen nicht."
 * Sie stimmten wirklich nicht — Aktentasche und Einkaufstasche waren bei 14 px
 * nicht zu unterscheiden, und zwölf Zeichen sind eine Auswahl, die jemand
 * einmal getroffen hat.
 *
 * SONEs Satz dazu, wörtlich lehrreich: eine handgepflegte Liste war „fünfzig
 * Namen, die jemand einmal gewählt hat, und mit einem Filter im Wähler gibt es
 * keinen Grund, für irgendwen zu wählen: sie können den ganzen Satz
 * durchsuchen."
 *
 * ## Der Satz wird geholt, wenn er gebraucht wird
 *
 * Gemeldet: „sote hängt teilweise sekunden." Gemessen: 1018 KB Zeichensatz auf
 * **jedem** Laden, eingebunden, um in der Seitenleiste eine Handvoll Symbole zu
 * zeichnen. Bei vierfach gedrosseltem Prozessor 663 ms bis zum ersten Inhalt,
 * und das ohne Netz.
 *
 * Mein Fehler war der Kurzschluss „SONE macht das, also passt es". SONE ist
 * eine Notizanwendung, in der der Zeichenwähler mitten im Gegenstand sitzt;
 * SOTE lädt ihn für eine Seitenleiste. Dieselbe Entscheidung, anderer Ort,
 * anderer Preis.
 *
 * Jetzt wird der Satz **nachgeladen**, und zwar nur, wenn ihn jemand braucht:
 * wenn ein Projekt wirklich ein Zeichen hat, oder wenn der Wähler aufgeht. Bis
 * dahin steht der Anfangsbuchstabe — derselbe Rückfall, den es ohnehin für
 * unbekannte Namen gibt. Wer keine Zeichen vergibt, lädt das Megabyte nie.
 *
 * ## Die beiden Fallen, die SONE schon hatte
 *
 * **Die Umwandlung ist in beide Richtungen verlustbehaftet.** `AArrowDown` und
 * `ArrowDownAZ` haben Großbuchstaben, die eine einzelne Trennregel nicht
 * wiederherstellt, und zwei Exporte können auf denselben Namen fallen. Statt
 * immer klügerer Regeln entscheidet **der Rundgang**: ein Feld im Gitter, das
 * als Vorgabe gezeichnet wird, ist von einer echten Wahl nicht zu
 * unterscheiden — genau der Fehlschlag, der zu vermeiden ist.
 *
 * **Ein Lucide-Zeichen ist ein `forwardRef`-Bauteil, also ein Objekt und keine
 * Funktion.** Eine Prüfung auf `typeof === 'function'` verwarf in SONE jedes
 * einzelne, also fielen alle auf die Vorgabe zurück: fünfzig verschiedene
 * Zeichen im Wähler, alle als dasselbe Blatt Papier gezeichnet, und das Wählen
 * änderte nichts Sichtbares.
 */

import { colorValue } from '@sote/core';
import type * as lucideTypes from 'lucide-react';
import { useEffect, useState } from 'react';

import { FolderIcon, ListIcon } from './icons.js';

/*
 * Der geladene Satz, oder `null`.
 *
 * Ein Modulzustand und kein React-Zustand: es gibt genau einen Satz, und jede
 * Zeile, die ein Zeichen zeichnen will, meint denselben. Über einen Kontext
 * wäre es dieselbe Sache mit mehr Teilen.
 */
let loaded: typeof lucideTypes | null = null;
let loading: Promise<void> | null = null;
const waiting = new Set<() => void>();

/**
 * Holt den Satz, einmal.
 *
 * Mehrere Aufrufer bekommen dasselbe Versprechen — sonst lädt eine Liste mit
 * fünf Zeichen ihn fünfmal an. Scheitert es, bleibt es beim Anfangsbuchstaben:
 * ein fehlendes Zeichen ist kein Grund, eine Zeile unbrauchbar zu machen.
 */
export function loadIcons(): Promise<void> {
  if (loaded !== null) return Promise.resolve();
  loading ??= import('lucide-react')
    .then((mod) => {
      loaded = mod;
      for (const tell of waiting) tell();
      waiting.clear();
    })
    .catch(() => {
      loading = null;
    });
  return loading;
}

/** Sagt Bescheid, sobald der Satz da ist. */
function useIcons(needed: boolean): typeof lucideTypes | null {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!needed || loaded !== null) return undefined;
    const tell = () => bump((n) => n + 1);
    waiting.add(tell);
    void loadIcons();
    return () => {
      waiting.delete(tell);
    };
  }, [needed]);
  return loaded;
}

/** Trennt bei `aB` und bei `ABc`, damit eine Abkürzung nicht das nächste Wort schluckt. */
function kebab(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

/** `wallet-cards` wird als `WalletCards` exportiert. */
function componentFor(name: string): lucideTypes.LucideIcon | null {
  if (loaded === null) return null;
  const exported = name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  const found = (loaded as unknown as Record<string, unknown>)[exported];
  // Objekt ODER Funktion — siehe oben.
  const usable = typeof found === 'function' || (typeof found === 'object' && found !== null);
  return usable ? (found as lucideTypes.LucideIcon) : null;
}

/**
 * Jeder Name, den der Satz hergibt, in der Schreibweise, die gespeichert wird.
 *
 * Aliasse und die `*Icon`-Doppel, die Lucide mitliefert, fallen weg — sonst
 * steht dieselbe Zeichnung dreimal unter drei Namen im Gitter.
 */
let names: string[] | null = null;

export function iconNames(): string[] {
  if (loaded === null) return [];
  names ??= [
    ...new Set(
      Object.keys(loaded)
        .filter((key) => /^[A-Z]/.test(key) && !key.endsWith('Icon') && !key.startsWith('Lucide'))
        .map(kebab)
        .filter((name) => /^[a-z][a-z0-9-]*$/.test(name)),
    ),
  ]
    .filter((name) => componentFor(name) !== null)
    .sort();
  return names;
}

/**
 * Die Zeichen für das Gitter: **der ganze Satz**.
 *
 * Hier stand eine Vorauswahl von dreißig Zeichen für den leeren Suchbegriff,
 * mit meinem Grund: der Satz ist alphabetisch, also beginnt ein ungefiltertes
 * Gitter mit einer Wand aus `a-arrow-…`, `alarm-…` und `align-…`.
 *
 * **Markus hat sie zurückgenommen** („Ich hätte gerne auch wieder das volle
 * Set an Icons, das war schon ok so"), und das ist die richtige Entscheidung
 * aus einem Grund, den ich hätte sehen können: eine Vorauswahl ist eine
 * Behauptung darüber, was jemand braucht. Wer ein Projekt „Ausrichtung" nennt,
 * will die Wand aus Ausrichtungssymbolen. Und der Ärger, den ich vermeiden
 * wollte, kostet einen Wisch; der Ärger, den ich verursachte, kostet das
 * Erraten des richtigen Suchworts für ein Zeichen, dessen Namen man nicht
 * kennt.
 *
 * Auch der Deckel von 120 Treffern ist weg. Er war aus demselben Holz: wer
 * „arrow" tippt, will die Pfeile sehen und nicht die ersten hundertzwanzig.
 */
export function iconsFor(query: string): string[] {
  const needle = query.trim().toLowerCase();
  const all = iconNames();
  // Vor dem Laden gibt es nichts zu zeigen; der Wähler sagt das selbst.
  if (all.length === 0) return [];
  return needle === '' ? all : all.filter((n) => n.includes(needle));
}

export const hasIcon = (name: string | undefined): boolean =>
  name !== undefined && componentFor(name) !== null;

/**
 * Ein Zeichen, oder der Anfangsbuchstabe.
 *
 * `aria-hidden`, immer: das Zeichen sagt nichts, was der Name nicht schon sagt,
 * und eine Vorleseansage „Haus, Haus" ist eine Ansage zu viel. Die Zeile trägt
 * die Beschriftung.
 *
 * Ein Name, der nicht mehr auflöst, kostet ein Projekt sein Zeichen und nie
 * seinen Platz im Baum — dieselbe Regel wie in SONE.
 */
export function ProjectMark({
  icon,
  kind,
  name,
  color,
}: {
  icon: string | undefined;
  /**
   * Woraus die Vorgabe kommt, wenn niemand ein Zeichen gewaehlt hat.
   *
   * Aus dem **Rahmensatz** und nicht aus Lucide: waere die Vorgabe ein
   * Lucide-Name, wuerde jede Zeile im Baum den ganzen Satz nachladen — und die
   * 1018 KB waeren durch die Hintertuer wieder im Startpfad.
   */
  kind: 'folder' | 'list';
  name: string;
  /** Schon durch `colorValue` gegangen, oder `undefined`. */
  color: string | undefined;
}) {
  // Der Satz wird nur geholt, wenn dieses Projekt wirklich ein Zeichen hat.
  useIcons(icon !== undefined);
  const Chosen = icon === undefined ? null : componentFor(icon);
  return (
    <span
      className="p-mark"
      aria-hidden="true"
      {...(color === undefined ? {} : { style: { color } })}
    >
      {Chosen === null ? (
        kind === 'folder' ? (
          <FolderIcon size={15} />
        ) : (
          <ListIcon size={15} />
        )
      ) : (
        <Chosen
          // Passt zu den Zeichen daneben statt zu Lucides eigener Vorgabe,
          // damit ein gewähltes Zeichen nicht schwerer wirkt als die Zeile.
          size={15}
          strokeWidth={1.75}
        />
      )}
    </span>
  );
}

/** Das Zeichen im Wähler — dieselbe Zeichnung, ohne Farbe und ohne Rückfall. */
export function IconPreview({ name }: { name: string }) {
  const Chosen = componentFor(name);
  return Chosen === null ? null : <Chosen size={15} strokeWidth={1.75} aria-hidden="true" />;
}

/** Was `colorValue` daraus macht — hier gebündelt, damit die Zeile es nicht importiert. */
export const markColor = (value: unknown): string | undefined => colorValue(value);

/**
 * SOTE — die Suchabfrage.
 *
 * Eine Abfrage ist **ein String**, und dieser String ist die einzige Wahrheit
 * darüber, wonach gesucht wird. Die Bedienelemente im Panel lesen ihn, ändern
 * eine Sache und schreiben ihn zurück — sie bauen `projekt:` nicht selbst
 * zusammen. Das ist SONEs Lösung aus `claude/suche-als-ort.md`, und der Grund
 * dort war: eine Kopie im Komponentenzustand ist eine zweite Antwort auf
 * „wonach wird gesucht", und Panel und Feld laufen beim ersten Gebrauch
 * auseinander.
 *
 * Daraus folgt die Aufteilung dieser Datei: `parseTaskQuery` liest, und
 * `buildTaskQuery` schreibt genau eine Facette in den vorhandenen String.
 * Beides rein, beides getestet.
 *
 * Geschrieben wird, was gelesen werden kann: die Chips im Bildschirm zeigen
 * `read`, und damit wird das Vokabular im Nachhinein auffindbar statt vorher in
 * einer Dokumentation zu stehen.
 */

export type QueryStatus = 'open' | 'done' | 'all';

export interface TaskQuery {
  /** Was übrig bleibt, wenn alle Facetten heraus sind. */
  readonly text: string;
  readonly projects: readonly string[];
  readonly labels: readonly string[];
  readonly assignees: readonly string[];
  readonly priorities: readonly number[];
  readonly status: QueryStatus;
  /** `due:heute`, `due:woche`, `due:überfällig` — grobe Körbe, keine Daten. */
  readonly due: 'today' | 'week' | 'overdue' | undefined;
  readonly read: readonly { readonly facet: string; readonly value: string }[];
}

/**
 * Ein Schlüsselwort und seine Kurzform.
 *
 * Deutsch **und** englisch, weil eine Abfrage getippt wird und niemand
 * nachsieht, welche Sprache die Oberfläche gerade hat. Die Kurzformen sind
 * dieselben Zeichen wie in der Schnellerfassung — wer `#haus` tippt, um etwas
 * anzulegen, tippt `#haus`, um es zu finden.
 */
const FACETS: Record<string, 'project' | 'label' | 'assignee' | 'priority' | 'status' | 'due'> = {
  projekt: 'project',
  project: 'project',
  p: 'project',
  schlagwort: 'label',
  label: 'label',
  tag: 'label',
  zugewiesen: 'assignee',
  assignee: 'assignee',
  wer: 'assignee',
  prio: 'priority',
  priority: 'priority',
  status: 'status',
  ist: 'status',
  is: 'status',
  frist: 'due',
  due: 'due',
  faellig: 'due',
  fällig: 'due',
};

const STATUS: Record<string, QueryStatus> = {
  offen: 'open',
  open: 'open',
  erledigt: 'done',
  done: 'done',
  fertig: 'done',
  alles: 'all',
  alle: 'all',
  all: 'all',
};

const DUE: Record<string, 'today' | 'week' | 'overdue'> = {
  heute: 'today',
  today: 'today',
  woche: 'week',
  week: 'week',
  überfällig: 'overdue',
  ueberfaellig: 'overdue',
  overdue: 'overdue',
};

/** `projekt:"Umzug Büro"` — ein Wert in Anführungszeichen darf Leerzeichen. */
const TOKEN = /(\w+|[#@+]):?("([^"]*)"|[^\s]*)|#(\S+)|@(\S+)|\+(\S+)|"([^"]*)"|(\S+)/g;

export function parseTaskQuery(input: string): TaskQuery {
  const words: string[] = [];
  const projects: string[] = [];
  const labels: string[] = [];
  const assignees: string[] = [];
  const priorities: number[] = [];
  const read: { facet: string; value: string }[] = [];
  /*
   * Die Vorgabe ist `all` und nicht `open`.
   *
   * Gefragt und beantwortet: „auch erledigtes". Hier stand `open`, und das war
   * die Stelle, die es verhinderte — nicht `search.ts`, wo ich zuerst gesucht
   * habe: dort sortiert Erledigtes längst ans Ende und wird nur gefiltert, wenn
   * die Abfrage einen Status NENNT. Genannt hat ihn die Vorgabe.
   *
   * Der Grund für `all`: **in einer Suche nennt man einen Namen, keinen
   * Zustand.** Wer „Dosen" tippt, sucht die Aufgabe „Dosen setzen" — ob sie
   * abgehakt ist, ist die Antwort und nicht die Frage. Eine Suche, die einen
   * Treffer verbirgt, lügt, und zwar unbemerkt: man sieht kein Ergebnis und
   * schließt daraus, dass es die Sache nicht gibt.
   *
   * Einschränken kann man weiter, und dafür gibt es den Facettennamen —
   * `status:offen` ist der Ort, an dem eine Suche eingeengt wird, und er steht
   * dann sichtbar in der Abfrage.
   */
  let status: QueryStatus = 'all';
  let due: 'today' | 'week' | 'overdue' | undefined;

  for (const part of splitQuery(input)) {
    // Das Zeichen zuerst: `+guest:lars` ist eine Zuweisung an einen Gast und
    // keine unbekannte Facette namens `+guest`. Die erste Fassung prüfte den
    // Doppelpunkt vorher und ließ solche Token als Freitext durchfallen — die
    // Suche nach einem Gast fand dann nichts.
    const first = part[0];
    if ((first === '#' || first === '@' || first === '+') && part.length > 1) {
      const value = unquote(part.slice(1));
      if (first === '#') {
        projects.push(value);
        read.push({ facet: 'projekt', value });
      } else if (first === '@') {
        /* `@` ist eine PERSON — seit dem Umdrehen der Zeichen, und die Suche
           spricht dieselbe Sprache wie die Erfassung. Alles andere waere ein
           Feld, in dem dasselbe Zeichen etwas anderes bedeutet. */
        assignees.push(value);
        read.push({ facet: 'zugewiesen', value });
      } else {
        labels.push(value);
        read.push({ facet: 'schlagwort', value });
      }
      continue;
    }

    const colon = part.indexOf(':');
    if (colon > 0) {
      const key = part.slice(0, colon).toLowerCase();
      const value = unquote(part.slice(colon + 1));
      const facet = FACETS[key];
      if (facet !== undefined && value !== '') {
        switch (facet) {
          case 'project':
            projects.push(value);
            read.push({ facet: 'projekt', value });
            continue;
          case 'label':
            labels.push(value);
            read.push({ facet: 'schlagwort', value });
            continue;
          case 'assignee':
            assignees.push(value);
            read.push({ facet: 'zugewiesen', value });
            continue;
          case 'priority': {
            const n = Number(value.replace(/^p/i, ''));
            if (Number.isInteger(n) && n >= 1 && n <= 4) {
              priorities.push(n);
              read.push({ facet: 'priorität', value: String(n) });
              continue;
            }
            break;
          }
          case 'status': {
            const s = STATUS[value.toLowerCase()];
            if (s !== undefined) {
              status = s;
              read.push({ facet: 'status', value });
              continue;
            }
            break;
          }
          case 'due': {
            const d = DUE[value.toLowerCase()];
            if (d !== undefined) {
              due = d;
              read.push({ facet: 'frist', value });
              continue;
            }
            break;
          }
        }
      }
      // Ein Doppelpunkt, der keine bekannte Facette ist, bleibt Text. Eine
      // Abfrage, die bei „12:30" nichts findet, wäre schlechter als eine, die
      // danach sucht.
      words.push(unquote(part));
      continue;
    }

    const bangs = /^!{1,3}$/.exec(part);
    if (bangs !== null) {
      const level = 4 - part.length;
      priorities.push(level);
      read.push({ facet: 'priorität', value: String(level) });
      continue;
    }

    words.push(unquote(part));
  }

  return {
    text: words.join(' ').trim(),
    projects,
    labels,
    assignees,
    priorities,
    status,
    due,
    read,
  };
}

/** Teilt an Leerzeichen, hält aber Anführungszeichen zusammen. */
export function splitQuery(input: string): string[] {
  const out: string[] = [];
  let current = '';
  let quoted = false;
  for (const ch of input) {
    if (ch === '"') {
      quoted = !quoted;
      current += ch;
    } else if (/\s/.test(ch) && !quoted) {
      if (current !== '') out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current !== '') out.push(current);
  return out;
}

const unquote = (s: string) => (s.startsWith('"') ? s.replace(/^"|"$/g, '') : s);

const needsQuotes = (s: string) => /\s/.test(s);
const quote = (s: string) => (needsQuotes(s) ? `"${s}"` : s);

export type Facet = 'projekt' | 'schlagwort' | 'zugewiesen' | 'priorität' | 'status' | 'frist';

const KEY_OF: Record<Facet, string> = {
  projekt: 'projekt',
  schlagwort: 'schlagwort',
  zugewiesen: 'zugewiesen',
  priorität: 'prio',
  status: 'status',
  frist: 'frist',
};

/**
 * Eine Facette in einer bestehenden Abfrage setzen, ersetzen oder entfernen.
 *
 * `value === undefined` entfernt sie. `multiple` sagt, ob mehrere Werte
 * nebeneinander stehen dürfen: ein Status kann nicht zugleich offen und
 * erledigt sein, ein Schlagwort schon.
 *
 * Der Rest der Abfrage bleibt **wortgetreu** stehen, einschließlich des
 * Freitexts und seiner Reihenfolge. Ein Bedienelement, das die Abfrage neu
 * zusammensetzt, würde beim Klicken den Text umsortieren, und niemand tippt
 * gern in ein Feld, das sich selbst umschreibt.
 */
export function buildTaskQuery(
  input: string,
  facet: Facet,
  value: string | undefined,
  { multiple = false }: { multiple?: boolean } = {},
): string {
  const key = KEY_OF[facet];
  const sigil = facet === 'projekt' ? '#' : facet === 'schlagwort' ? '@' : facet === 'zugewiesen' ? '+' : null;

  const kept: string[] = [];
  let alreadyThere = false;

  for (const part of splitQuery(input)) {
    const colon = part.indexOf(':');
    let partFacet: string | undefined;
    let partValue = '';

    if (colon > 0) {
      const mapped = FACETS[part.slice(0, colon).toLowerCase()];
      if (mapped !== undefined) {
        partFacet = mapped;
        partValue = unquote(part.slice(colon + 1));
      }
    } else if (sigil !== null && part.startsWith(sigil) && part.length > 1) {
      partFacet =
        sigil === '#' ? 'project' : sigil === '@' ? 'label' : 'assignee';
      partValue = unquote(part.slice(1));
    } else if (/^!{1,3}$/.test(part)) {
      partFacet = 'priority';
      partValue = String(4 - part.length);
    }

    const mine =
      partFacet ===
      (facet === 'projekt'
        ? 'project'
        : facet === 'schlagwort'
          ? 'label'
          : facet === 'zugewiesen'
            ? 'assignee'
            : facet === 'priorität'
              ? 'priority'
              : facet === 'status'
                ? 'status'
                : 'due');

    if (!mine) {
      kept.push(part);
      continue;
    }
    if (multiple) {
      // Derselbe Wert zweimal ist kein zweiter Filter, sondern ein Klick zu
      // viel — er entfernt ihn wieder.
      if (value !== undefined && partValue.toLowerCase() === value.toLowerCase()) {
        alreadyThere = true;
        continue;
      }
      kept.push(part);
      continue;
    }
    // Nicht mehrfach: der alte Wert fällt weg.
  }

  if (value === undefined || alreadyThere) return kept.join(' ').trim();
  return [...kept, `${key}:${quote(value)}`].join(' ').trim();
}

/** Hat die Abfrage überhaupt etwas zu suchen? */
export function isEmptyQuery(q: TaskQuery): boolean {
  return (
    q.text === '' &&
    q.projects.length === 0 &&
    q.labels.length === 0 &&
    q.assignees.length === 0 &&
    q.priorities.length === 0 &&
    q.due === undefined
  );
}

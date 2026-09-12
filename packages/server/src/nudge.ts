/**
 * SOTE — die Türklingel, vom Kanal bis zum Browser.
 *
 * Übernommen aus SONE (`claude/live-aktualisierung.md`). Die Regeln dort sind
 * teuer erarbeitet, und drei bestimmen diese Datei:
 *
 * ## Eine lauschende Verbindung, außerhalb des Pools
 *
 * `LISTEN` bindet eine Verbindung dauerhaft. Aus dem Pool genommen wäre sie
 * eine Verbindung, die nie zurückkommt — und der Pool würde bei genug Neustarts
 * verhungern. Alle Scopes liegen auf **dieser einen**: die Kosten fallen pro
 * Verbindung an, nicht pro Kanal.
 *
 * ## Der Rahmen ist eine Türklingel, kein Brief
 *
 * Was hinausgeht, ist ein Scope-Name. Keine Zahl, keine Id, keinen Auszug —
 * *was jemand sehen darf, entscheidet die Route, die die Liste liefert.* Eine
 * Zahl auf der Leitung wäre eine zweite Antwort auf die Frage, die die Liste
 * schon beantwortet.
 *
 * ## SSE und nicht WebSocket
 *
 * Eine Klingel geht in **eine** Richtung. Ein WebSocket wäre ein Kanal für
 * Antworten, die es nicht gibt, mitsamt Handschlag, Rahmenprotokoll und einem
 * Paket dafür. `EventSource` bringt den Wiederaufbau nach einem Abbruch
 * mitgeliefert — genau das, was man hier braucht und sonst selbst schreibt.
 *
 * SONE hat einen WebSocket, aber aus einem anderen Grund: dort fließen
 * Dokumentänderungen in beide Richtungen. Für eine Klingel wäre er der Aufbau
 * ohne den Anlass.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import { Client, type Pool } from 'pg';

/** Die Scopes, die ein Client abonnieren darf. */
export const SCOPES = ['tasks', 'projects', 'shares', 'comments'] as const;
export type Scope = (typeof SCOPES)[number];

const isScope = (v: string): v is Scope => (SCOPES as readonly string[]).includes(v);

type Listener = (workspaceId: string, scope: Scope) => void;

const listeners = new Set<Listener>();
let client: Client | undefined;

/**
 * Die lauschende Verbindung aufbauen und halten.
 *
 * Bricht sie ab, wird nach einer Sekunde neu verbunden — und **während sie weg
 * ist, klingelt nichts**. Das ist kein Mangel, sondern die Grenze der Sache:
 * *ein Push sagt, was passierte, während man zuhörte.* Was in einer Lücke
 * passiert, sagt die Auffrischung beim Fokus, und die bleibt darum überall.
 */
export function startListening(databaseUrl: string): void {
  if (client !== undefined) return;
  const c = new Client({ connectionString: databaseUrl });
  client = c;

  const neu = (): void => {
    client = undefined;
    // Nach einer Sekunde, nicht sofort: eine Datenbank, die gerade neu startet,
    // beantwortet einen Sturm von Verbindungsversuchen nicht schneller.
    setTimeout(() => startListening(databaseUrl), 1000).unref();
  };

  c.on('notification', (msg) => {
    const raw = msg.payload ?? '';
    const trenner = raw.indexOf(':');
    if (trenner < 0) return;
    const workspaceId = raw.slice(0, trenner);
    const scope = raw.slice(trenner + 1);
    /*
     * Der Scope wird geprüft, **bevor** er an einen Client geht.
     *
     * Eine Zeichenkette, die Clients erreicht, weil eine Migration sie getippt
     * hat, ist ein Vertrag, dem niemand zugestimmt hat (SONEs Regel).
     */
    if (!isScope(scope)) return;
    for (const fn of listeners) fn(workspaceId, scope);
  });
  c.on('error', (e: unknown) => {
    console.error('Klingel:', e);
    void c.end().catch(() => undefined);
    neu();
  });

  void c
    .connect()
    .then(() => c.query('LISTEN sote_workspace_changed'))
    .catch((e: unknown) => {
      console.error('Klingel:', e);
      neu();
    });
}

/** Nur für Tests: einen Zuhörer eintragen. */
export function onNudge(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Ein Strom für einen Browser.
 *
 * `filter` entscheidet, was diesen Empfänger angeht — und **auf dem Server**,
 * weil nur er den Zugang kennt. Für ein Mitglied ist es sein Arbeitsbereich;
 * für einen Gast über einen Link ist es der Arbeitsbereich seines Projekts.
 *
 * Der Preis, benannt: ein Gast erfährt damit, *dass* in diesem Arbeitsbereich
 * etwas passiert ist, auch wenn es ein anderes Projekt war — ein Zeitsignal.
 * SONE nimmt dasselbe in Kauf („der Anstoß geht ungefiltert an jeden mit dem
 * Workspace offen"). Was er **sieht**, entscheidet weiter die Route, die seine
 * Liste liefert, und die kennt nur sein Projekt.
 */
export function stream(
  req: IncomingMessage,
  res: ServerResponse,
  filter: (workspaceId: string, scope: Scope) => boolean,
): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    // Ohne das puffert ein Reverse Proxy den Strom und die Klingel kommt in
    // Schüben an — oder gar nicht.
    'x-accel-buffering': 'no',
    connection: 'keep-alive',
  });
  // Ein erster Rahmen sofort: manche Proxys geben eine Antwort erst weiter,
  // wenn Daten geflossen sind, und dann wartet der Browser auf ein Ereignis,
  // das er nicht bekommt.
  res.write(': hallo\n\n');

  const ab = onNudge((workspaceId, scope) => {
    if (filter(workspaceId, scope)) res.write(`data: ${scope}\n\n`);
  });

  /*
   * Ein Lebenszeichen alle 25 Sekunden.
   *
   * Ein stiller Strom wird von Proxys und Mobilfunknetzen nach einer halben
   * Minute geschlossen. `EventSource` baut dann neu auf — aber jeder Aufbau
   * kostet eine Anfrage, und ein Strom, der jede Minute neu entsteht, ist ein
   * Polling mit mehr Aufwand.
   */
  const puls = setInterval(() => res.write(': puls\n\n'), 25_000);
  puls.unref();

  const zu = (): void => {
    clearInterval(puls);
    ab();
  };
  req.on('close', zu);
  res.on('close', zu);
}

/** Ob die Klingel steht — für die Wartungsansicht. */
export const listening = (): boolean => client !== undefined;

/** Nur für Tests: einen Anstoß auslösen, wie ein Trigger es täte. */
export async function poke(pool: Pool, workspaceId: string, scope: Scope): Promise<void> {
  await pool.query('SELECT notify_workspace($1, $2)', [workspaceId, scope]);
}

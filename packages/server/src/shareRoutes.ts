/**
 * SOTE — was ein Link erreichen kann.
 *
 * **Eine Datei, damit man sie ganz lesen kann.** Wer prüfen will, was ein
 * Fremder ohne Konto tun darf, liest diese Datei und nicht die
 * fünfzehnhundert Zeilen von `routes.ts`. Das ist keine Ordnungsliebe: eine
 * Rechtefläche, die über eine große Datei verteilt ist, ist eine Rechtefläche,
 * deren Umfang niemand kennt.
 *
 * ## Die drei Regeln, die hier jede Zeile binden
 *
 * 1. **Das Recht kommt aus `accessByToken`**, nie aus einem Parameter
 *    (SONEs ADR-0087, dort dreimal die Antwort: *ein Parameter, den jeder
 *    Aufrufer richtig berechnen muss, ist ein Parameter, den ein Aufrufer
 *    falsch berechnet.*)
 * 2. **Jede Aufgabe wird gegen das Projekt der Freigabe geprüft.** Eine Id in
 *    der Adresse ist eine Behauptung des Aufrufers, nicht eine Auskunft. Ohne
 *    diese Prüfung wäre jede Freigabe eine Freigabe auf **alle** Aufgaben der
 *    Instanz, sobald jemand eine fremde Id einsetzt — und Ids stehen in
 *    Antworten.
 * 3. **`read` darf nichts ändern**, und das steht als eine Zeile am Anfang
 *    jedes schreibenden Wegs und nicht als Bedingung im Rumpf.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Pool } from 'pg';

import { queryOne } from './db.js';
import { fail, json, readJson } from './http/respond.js';
import { accessByToken, type RightLevel } from './shares.js';
import { complete, NotFound, OutOfOrder, patch, reopen, createFromLine } from './tasks.js';
import { list } from './views.js';

interface Ctx {
  readonly pool: Pool;
}

/** Gehört diese Aufgabe zum freigegebenen Projekt? */
async function inProject(pool: Pool, taskId: string, projectId: string): Promise<boolean> {
  const row = await queryOne<{ n: string }>(
    pool,
    /*
     * Auch Teilaufgaben: sie tragen kein eigenes `project_id`, sondern erben
     * den Ort vom Elternteil (Konzept, Abschnitt 8). Ohne den Elternteil in
     * dieser Abfrage wäre eine Teilaufgabe unerreichbar — oder, schlimmer, mit
     * einer laxeren Prüfung woanders erreichbar.
     */
    `SELECT count(*) AS n FROM tasks t
       LEFT JOIN tasks e ON e.id = t.parent_id
      WHERE t.id = $1 AND t.trashed_at IS NULL
        AND coalesce(t.project_id, e.project_id) = $2`,
    [taskId, projectId],
  );
  return Number(row?.n ?? 0) > 0;
}

export async function shareRoutes(
  ctx: Ctx,
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
  rest: string,
  method: string,
  now: Date,
): Promise<void> {
  const access = await accessByToken(ctx.pool, token);
  if (access === null) {
    /*
     * **Ein Satz für alle Fälle**, und das ist hier anders begründet als bei
     * ADR-0073s „no such account is said plainly".
     *
     * Dort durfte die Auskunft deutlich sein, weil nur jemand fragt, der schon
     * wissen darf, wer im Arbeitsbereich ist. Hier fragt ein Fremder. „Gibt es
     * nicht" gegen „ist abgelaufen" gegen „ist widerrufen" wäre eine Auskunft
     * darüber, ob ein geratener Token einmal existiert hat — und das ist genau
     * das, was Raten lohnend macht.
     */
    fail(res, 404, 'no_share', 'dieser Link gilt nicht mehr');
    return;
  }

  const darfSchreiben = (): boolean => access.right === 'edit';
  const nurLesen = (): void => {
    fail(res, 403, 'read_only', 'dieser Link darf nur lesen');
  };

  /* ── Was es zu sehen gibt ──────────────────────────────────────────────── */

  if (rest === '' && method === 'GET') {
    const project = await queryOne<{ name: string; icon: unknown }>(
      ctx.pool,
      'SELECT name, icon FROM projects WHERE id = $1',
      [access.projectId],
    );
    /*
     * Der Name des Projekts, sein Recht — und **nicht** der Arbeitsbereich,
     * nicht die anderen Projekte, nicht die Leute. Wer eine Liste abarbeiten
     * soll, braucht die Liste und nichts darüber; jede Angabe mehr hier wäre
     * eine Angabe, die eine Freigabe über ihren Gegenstand hinaus macht.
     */
    json(res, 200, {
      project: { name: project?.name ?? 'Projekt', icon: project?.icon ?? null },
      right: access.right satisfies RightLevel,
    });
    return;
  }

  if (rest === '/tasks' && method === 'GET') {
    // Erledigtes kommt mit, wenn danach gefragt wird — dieselbe Wahl wie in
    // den Listen (Konzept), und derselbe Weg.
    const withDone = new URL(req.url ?? '/', 'http://x').searchParams.get('done') === '1';
    const rows = await list(
      ctx.pool,
      'project',
      access.workspaceId,
      now,
      access.projectId,
      undefined,
      withDone,
    );
    json(res, 200, {
      tasks: rows.map((t) => ({
        id: t.id,
        title: t.title,
        completed: t.completed_at?.toISOString() ?? null,
        plannedAt: t.planned_at?.toISOString() ?? null,
        dueAt: t.due_at?.toISOString() ?? null,
        priority: t.priority,
      })),
    });
    return;
  }

  /* ── Was ein Link mit `edit` ändern darf ───────────────────────────────── */

  if (rest === '/tasks' && method === 'POST') {
    if (!darfSchreiben()) return nurLesen();
    const body = (await readJson(req)) as { line?: unknown };
    const line = String(body?.line ?? '').trim();
    if (line === '') {
      fail(res, 400, 'no_line', 'ohne Zeile keine Aufgabe');
      return;
    }
    /*
     * `userId` ist **null**: ein Gast ist niemand.
     *
     * Das ist der Preis der Entscheidung „ein Token, kein Konto" (Konzept
     * 10e), und er steht hier, wo er anfällt. Wer über einen Link etwas
     * anlegt, erscheint als „über einen Link" und nicht als jemand.
     */
    const out = await createFromLine(ctx.pool, {
      workspaceId: access.workspaceId,
      userId: null,
      line,
      now,
      projectId: access.projectId,
    });
    /*
     * Und `#projekt` aus der Zeile gilt hier NICHT: das Projekt ist gesetzt.
     * Sonst könnte eine Zeile eine Aufgabe in ein Projekt legen, das die
     * Freigabe nicht meint — die Schnellerfassung wäre ein Weg aus ihrem
     * eigenen Gegenstand hinaus.
     */
    if (out.task.project_id !== access.projectId) {
      await ctx.pool.query('UPDATE tasks SET project_id = $2 WHERE id = $1', [
        out.task.id,
        access.projectId,
      ]);
    }
    json(res, 201, { id: out.task.id, title: out.task.title });
    return;
  }

  const taskPath = /^\/tasks\/([0-9a-f-]{36})(\/complete)?$/.exec(rest);
  if (taskPath !== null) {
    if (!darfSchreiben()) return nurLesen();
    const taskId = taskPath[1]!;
    // Die Prüfung steht VOR jeder Verzweigung: eine Id in der Adresse ist eine
    // Behauptung des Aufrufers, nicht eine Auskunft.
    if (!(await inProject(ctx.pool, taskId, access.projectId))) {
      fail(res, 404, 'no_task', 'diese Aufgabe gehört nicht zu diesem Link');
      return;
    }

    try {
      if (taskPath[2] === '/complete' && method === 'POST') {
        await complete(ctx.pool, taskId, null, now);
        json(res, 200, { ok: true });
        return;
      }
      if (taskPath[2] === '/complete' && method === 'DELETE') {
        await reopen(ctx.pool, taskId, access.workspaceId);
        json(res, 200, { ok: true });
        return;
      }
      if (taskPath[2] === undefined && method === 'PATCH') {
        const body = (await readJson(req)) as Record<string, unknown>;
        /*
         * **Nur Titel und Zeitpunkt.** Nicht das Projekt (das wäre ein Weg aus
         * der Freigabe hinaus), nicht der Papierkorb (der ist ein Ort des
         * Arbeitsbereichs), nicht die Zuweisung (es gibt hier niemanden, dem
         * man etwas zuweist).
         *
         * Als Auswahlliste und nicht als Sperrliste: was hier nicht steht, geht
         * nicht — und ein neues Feld an der Aufgabe wird damit nicht
         * versehentlich zu einem Recht des Gasts.
         */
        const erlaubt: Record<string, unknown> = {};
        for (const feld of ['title', 'plannedAt', 'plannedAllDay', 'dueAt', 'dueAllDay', 'priority']) {
          if (feld in (body ?? {})) erlaubt[feld] = body[feld];
        }
        if (Object.keys(erlaubt).length === 0) {
          fail(res, 400, 'nothing', 'dieser Link darf daran nichts ändern');
          return;
        }
        await patch(ctx.pool, taskId, access.workspaceId, erlaubt as never);
        json(res, 200, { ok: true });
        return;
      }
    } catch (e) {
      if (e instanceof NotFound) {
        fail(res, 404, 'no_task', e.message);
        return;
      }
      if (e instanceof OutOfOrder) {
        fail(res, 409, 'conflict', e.message);
        return;
      }
      throw e;
    }
  }

  fail(res, 404, 'no_route', 'diesen Weg gibt es für einen Link nicht');
}

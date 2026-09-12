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
import { addChild, addComment, detail } from './detail.js';
import { stream } from './nudge.js';
import { fail, json, readJson } from './http/respond.js';
import { detailView, taskView } from './routes.js';
import { isInlineSafe } from '@sote/core';
import { accessByToken, type RightLevel } from './shares.js';
import { complete, move, NotFound, OutOfOrder, patch, reopen, createFromLine } from './tasks.js';
import {
  addFile,
  attachWeb,
  filesDir,
  filesOf,
  maxBytes,
  readFileOf,
  removeFile,
} from './taskFiles.js';
import { childrenOf, list } from './views.js';

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

  /*
   * Die Türklingel für einen Gast.
   *
   * **Hier** und nicht als eigene Route neben dem Gast-Zweig: mein erster
   * Versuch legte sie in `routes.ts`, und der Zweig oben fängt
   * `/api/share/:token/…` vorher ab — sie war **unerreichbar** und antwortete
   * 404, was im Browser als stiller `EventSource`-Fehler ankam. Die Regel
   * dieser Datei („eine Datei für alle Gast-Wege") ist genau dagegen da.
   *
   * Gefiltert wird auf dem Server, weil nur er den Zugang kennt. Der Preis
   * steht in `nudge.ts`: ein Gast erfährt, *dass* im Arbeitsbereich etwas
   * passiert ist, auch wenn es ein anderes Projekt war — ein Zeitsignal. Was
   * er **sieht**, entscheidet weiter seine `/tasks`-Route, und die kennt nur
   * sein Projekt.
   */
  if (rest === '/stream' && method === 'GET') {
    /*
     * `tasks` UND `comments`, aber nicht mehr.
     *
     * Ein Gast soll erfahren, dass sich seine Liste geändert hat und dass
     * jemand geschrieben hat — beides betrifft, was er vor sich sieht.
     * `projects` und `shares` nicht: dass anderswo ein Projekt umbenannt
     * wurde, ist eine Auskunft über einen Arbeitsbereich, den er nicht kennt.
     *
     * Die Klingel nennt ohnehin nur einen Scope und keinen Inhalt — aber „wann
     * passiert dort etwas" ist auch eine Auskunft, und die kleinere ist hier
     * die richtige.
     */
    stream(
      req,
      res,
      (ws, scope) =>
        ws === access.workspaceId && (scope === 'tasks' || scope === 'comments'),
    );
    return;
  }

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
    /*
     * DIESELBE Form wie für Mitglieder.
     *
     * GEMELDET: „Die geteilte Ansicht klappt nicht korrekt. Da müssen wir
     * vermutlich an Features noch nachziehen."
     *
     * Die Ursache ist hier: die Freigabe lieferte eine EIGENE, kürzere Form —
     * sechs Felder. Alles, was seitdem an einer Aufgabe dazugekommen ist
     * (Schlagwörter, Dauer, Merkmale, Aussehen, Titelbild), fehlte dem Gast,
     * und die Oberfläche musste eine eigene Zeile dafür bauen. Zwei Formen für
     * dieselbe Sache laufen auseinander — diese hier über Monate.
     *
     * Es ist dieselbe Abfrage (`list`), also war die Kürzung nie eine
     * Ersparnis, sondern nur eine zweite Antwort.
     */
    /*
     * MIT den Unteraufgaben.
     *
     * GEMELDET: „Mache noch die Unteraufgaben und Reihenfolge."
     *
     * Mit der Liste und nicht beim Aufklappen — derselbe Grund wie beim
     * Mitglied: das Ziehen braucht sie schon vorher, denn wer eine Aufgabe auf
     * eine ZUGEKLAPPTE zieht, soll sie ans Ende der Kinder setzen, und der
     * Schlüssel dafür wird in der Oberfläche gerechnet.
     */
    json(res, 200, {
      tasks: rows.map(taskView),
      children: Object.fromEntries(
        Object.entries(
          await childrenOf(
            ctx.pool,
            access.workspaceId,
            rows.map((r) => r.id),
            withDone,
          ),
        ).map(([id, kinder]) => [id, kinder.map(taskView)]),
      ),
    });
    return;
  }

  /* ── Was ein Link mit `edit` ändern darf ───────────────────────────────── */

  /*
   * ANHÄNGE — auch in einer Freigabe.
   *
   * GEMELDET: „Datei-Uploads gehen nicht, sollte aber, das gehört dazu.
   * Anhänge und Bilder werden gar nicht angezeigt. Da bitte auch wie als
   * User."
   *
   * Beides stimmte, und der Satz im Quelltext, der es begründete, war falsch:
   * „beim Gast fehlt es ebenso — eine Datei hängt an einem Konto." Tut sie
   * nicht. Sie hängt an einer AUFGABE, und die Aufgabe ist freigegeben. Wer
   * `uploaded_by` braucht, bekommt `NULL` — genau die Spalte ist von Anfang an
   * dafür gebaut („ein geloeschtes Konto nimmt nicht die Anhaenge mit").
   *
   * Lesen darf jeder mit dem Link, Anhängen und Wegnehmen nur mit
   * Bearbeitungsrecht. Und alles nur innerhalb DIESER Liste: `imProjekt`
   * unten prüft es, wie beim Umsortieren.
   */
  const fileWeg = /^\/tasks\/([0-9a-f-]{36})\/files(?:\/([0-9a-f-]{36}))?(\/web)?$/.exec(rest);
  if (fileWeg !== null) {
    const taskId = fileWeg[1]!;
    const fileId = fileWeg[2];
    if (filesDir() === undefined) {
      fail(res, 501, 'files_off', 'dieser Server nimmt keine Anhänge');
      return;
    }
    const gehoert = await queryOne<{ id: string }>(
      ctx.pool,
      `SELECT id FROM tasks
        WHERE id = $1 AND workspace_id = $2 AND project_id = $3 AND trashed_at IS NULL`,
      [taskId, access.workspaceId, access.projectId],
    );
    if (gehoert === undefined) {
      fail(res, 404, 'no_task', 'diese Aufgabe gehört nicht zu dieser Freigabe');
      return;
    }

    if (fileId !== undefined && method === 'GET') {
      const got = await readFileOf(ctx.pool, {
        id: fileId,
        taskId,
        workspaceId: access.workspaceId,
        ...(new URL(req.url ?? '/', 'http://x').searchParams.get('size') === 'web'
          ? { size: 'web' as const }
          : {}),
      });
      if (got === undefined) {
        fail(res, 404, 'no_file', 'diesen Anhang gibt es nicht');
        return;
      }
      const inline =
        new URL(req.url ?? '/', 'http://x').searchParams.get('inline') === '1' &&
        isInlineSafe(got.file.mimeType);
      res.writeHead(200, {
        'content-type': got.file.mimeType,
        'content-length': String(got.bytes.length),
        'x-content-type-options': 'nosniff',
        'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(got.file.filename)}`,
      });
      res.end(got.bytes);
      return;
    }

    if (!darfSchreiben()) return nurLesen();

    if (fileId === undefined && method === 'POST') {
      const grenze = maxBytes();
      const stücke: Buffer[] = [];
      let größe = 0;
      for await (const stück of req) {
        größe += (stück as Buffer).length;
        if (größe > grenze) {
          req.destroy();
          fail(res, 413, 'too_big', `größer als ${Math.floor(grenze / 1024 / 1024)} MB`);
          return;
        }
        stücke.push(stück as Buffer);
      }
      if (größe === 0) {
        fail(res, 400, 'empty', 'keine Datei dabei');
        return;
      }
      const f = await addFile(ctx.pool, {
        taskId,
        workspaceId: access.workspaceId,
        /*
         * OHNE Konto: ein Gast hat keins. `uploaded_by` ist dafür gebaut, leer
         * sein zu dürfen — die Datei bleibt, wer sie hochgeladen hat, ist dann
         * unbekannt.
         */
        userId: null,
        filename: new URL(req.url ?? '/', 'http://x').searchParams.get('name') ?? 'Datei',
        mimeType: (req.headers['content-type'] ?? 'application/octet-stream')
          .split(';')[0]!
          .trim(),
        bytes: Buffer.concat(stücke),
      });
      json(res, 200, { file: { ...f, createdAt: f.createdAt.toISOString() } });
      return;
    }

    if (fileId !== undefined && fileWeg[3] === '/web' && method === 'PUT') {
      const stücke: Buffer[] = [];
      for await (const stück of req) stücke.push(stück as Buffer);
      const ok = await attachWeb(ctx.pool, {
        id: fileId,
        taskId,
        workspaceId: access.workspaceId,
        bytes: Buffer.concat(stücke),
      });
      json(res, ok ? 200 : 404, { ok });
      return;
    }

    if (fileId !== undefined && method === 'DELETE') {
      const weg = await removeFile(ctx.pool, {
        id: fileId,
        taskId,
        workspaceId: access.workspaceId,
      });
      json(res, weg ? 200 : 404, { ok: weg });
      return;
    }
  }

  /*
   * DIE REIHENFOLGE ÄNDERN — auch als Gast.
   *
   * GEFRAGT und beantwortet: „Ja, er darf ändern. Er hat Bearbeitungsrechte,
   * das gehört dazu."
   *
   * Das ist die richtige Antwort und nicht die bequeme: Bearbeiten heisst
   * Bearbeiten. Eine Freigabe, in der man Aufgaben anlegen und abhaken, aber
   * nicht ordnen darf, wäre eine halbe Erlaubnis — und die erklärt sich
   * niemandem, der die Liste vor sich hat.
   *
   * DIE GRENZE IST DIE FREIGABE, nicht die Erlaubnis: `parentId` darf nur auf
   * eine Aufgabe DESSELBEN Projekts zeigen. `move` prüft den Arbeitsbereich,
   * nicht das Projekt — ein Gast könnte sonst eine Aufgabe unter eine hängen,
   * die er nie sehen durfte, und sie damit aus seiner Freigabe herausschieben.
   * Also hier geprüft, wo die Freigabe bekannt ist.
   */
  if (/^\/tasks\/[0-9a-f-]{36}\/move$/.test(rest) && method === 'PUT') {
    if (!darfSchreiben()) return nurLesen();
    const id = rest.split('/')[2]!;
    const body = (await readJson(req)) as Record<string, unknown>;

    const imProjekt = async (taskId: string): Promise<boolean> => {
      const row = await queryOne<{ id: string }>(
        ctx.pool,
        `SELECT id FROM tasks
          WHERE id = $1 AND workspace_id = $2 AND project_id = $3 AND trashed_at IS NULL`,
        [taskId, access.workspaceId, access.projectId],
      );
      return row !== undefined;
    };

    if (!(await imProjekt(id))) {
      fail(res, 404, 'no_task', 'diese Aufgabe gehört nicht zu dieser Freigabe');
      return;
    }
    const elter = 'parentId' in body ? body['parentId'] : undefined;
    if (typeof elter === 'string' && !(await imProjekt(elter))) {
      fail(res, 403, 'outside', 'nur innerhalb dieser Liste');
      return;
    }
    /* Die Nachbarn ebenso: ein Schlüssel „zwischen" zwei fremden Aufgaben wäre
       eine Auskunft über eine Liste, die man nicht sieht. */
    for (const seite of ['afterId', 'beforeId'] as const) {
      const wert = body[seite];
      if (typeof wert === 'string' && !(await imProjekt(wert))) {
        fail(res, 403, 'outside', 'nur innerhalb dieser Liste');
        return;
      }
    }

    try {
      /*
       * DIE NAMEN SIND `afterId` UND `beforeId`.
       *
       * GEMELDET: „Sortieren klappt jetzt, aber egal wo ich etwas hin ziehe, es
       * landet immer ganz oben. Rein ziehen als Unteraufgabe klappt aber."
       *
       * Genau dieses Bild gehört zu genau diesem Fehler: ich hatte hier `after`
       * und `before` geschrieben, und `move` kennt nur `afterId`/`beforeId`.
       * Unbekannte Schlüssel fallen still weg — also kam ein Zug ohne Nachbarn
       * an, und ohne Nachbarn heisst „ganz nach vorn".
       *
       * `parentId` heisst in beiden gleich. Darum ging das Hineinziehen, und
       * darum war die Meldung so genau: sie hat den Fehler beschrieben, bevor
       * ich ihn gesehen habe.
       */
      const task = await move(ctx.pool, id, access.workspaceId, {
        ...('afterId' in body
          ? { afterId: body['afterId'] === null ? null : String(body['afterId']) }
          : {}),
        ...('beforeId' in body
          ? { beforeId: body['beforeId'] === null ? null : String(body['beforeId']) }
          : {}),
        ...('parentId' in body
          ? { parentId: elter === null ? null : String(elter) }
          : {}),
      });
      json(res, 200, { task: taskView(task) });
    } catch (e) {
      if (e instanceof OutOfOrder) {
        fail(res, 422, 'out_of_order', e.message);
        return;
      }
      throw e;
    }
    return;
  }

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

  const taskPath = /^\/tasks\/([0-9a-f-]{36})(\/complete|\/children|\/comments)?$/.exec(rest);
  if (taskPath !== null) {
    /*
     * **Lesen zuerst**, denn ein Link, der nur lesen darf, darf die Aufgabe
     * ansehen.
     *
     * Vorher stand `darfSchreiben()` ganz oben und verweigerte jeden Weg unter
     * `/tasks/:id` — dann hätte ein Lese-Link eine Detailspalte, die 403 sagt.
     * Die Schreibprüfung sitzt jetzt an jedem schreibenden Zweig, und das ist
     * die Reihenfolge, die die Sache selbst hat.
     */
    const taskIdVor = taskPath[1]!;
    if (!(await inProject(ctx.pool, taskIdVor, access.projectId))) {
      fail(res, 404, 'no_task', 'diese Aufgabe gehört nicht zu diesem Link');
      return;
    }

    if (taskPath[2] === undefined && method === 'GET') {
      /*
       * Die Detailspalte eines Gasts — dieselbe Abfrage wie beim Mitglied.
       *
       * Gemeldet: „Die Seitenleiste mit Aufgabendetails braucht ein geteilter
       * User auch." Zwei Abfragen für dieselbe Ansicht wären zwei Wahrheiten
       * über eine Aufgabe, und die eine hätte irgendwann ein Feld weniger.
       */
      // DIESELBE Abbildung wie beim Mitglied: `detailView`. Die innere Form
      // hier durchzureichen war mein Fehler — sie trägt Daten statt
      // Zeichenketten und `undefined` statt `null`.
      /*
       * MIT den Anhängen.
       *
       * GEMELDET, zweimal: „Anhänge und Bilder werden gar nicht angezeigt … Anhänge
       * sehe ich immer noch keine."
       *
       * Beim ersten Mal habe ich den Schreibweg gebaut und die Ursache
       * übersehen: `detailView` nimmt die Dateien als DRITTES Argument, und
       * hier stand nur das erste. Der Vorgabewert ist eine leere Liste — also
       * antwortete der Server „keine Anhänge" und log dabei nicht einmal, er
       * wurde nie gefragt.
       *
       * Ein Vorgabewert, der wie eine gültige Antwort aussieht, ist die
       * unangenehmste Sorte: nichts bricht, und die Auskunft ist trotzdem
       * falsch.
       */
      json(
        res,
        200,
        detailView(
          await detail(ctx.pool, taskIdVor, access.workspaceId),
          [],
          filesDir() === undefined ? [] : await filesOf(ctx.pool, taskIdVor),
        ),
      );
      return;
    }

    if (taskPath[2] === '/children' && method === 'POST') {
      if (!darfSchreiben()) return nurLesen();
      const body = (await readJson(req)) as { title?: unknown };
      const titel = String(body?.title ?? '').trim();
      if (titel === '') {
        fail(res, 400, 'no_title', 'ohne Titel keine Teilaufgabe');
        return;
      }
      // `null` als Urheber: ein Gast ist niemand (Konzept 10e).
      const kind = await addChild(ctx.pool, taskIdVor, access.workspaceId, null, titel);
      json(res, 201, kind);
      return;
    }

    if (taskPath[2] === '/comments' && method === 'POST') {
      if (!darfSchreiben()) return nurLesen();
      const body = (await readJson(req)) as { body?: unknown; parentId?: unknown };
      const text = String(body?.body ?? '').trim();
      if (text === '') {
        fail(res, 400, 'empty', 'ein leerer Kommentar ist keiner');
        return;
      }
      /*
       * Ein Gast kommentiert als **niemand**, und das erscheint als „über einen
       * Link". Ehrlicher als ein erfundener Name — und die Benachrichtigung
       * daran (Migration 0019) trägt `actor_id = NULL` genau dafür.
       */
      json(
        res,
        201,
        await addComment(
          ctx.pool,
          taskIdVor,
          access.workspaceId,
          null,
          text,
          undefined,
          /* Auch ein Gast darf antworten: das Gespräch gehört der Aufgabe, und
             die ist freigegeben. Der Server löst auf eine Ebene auf. */
          typeof body?.parentId === 'string' ? body.parentId : null,
        ),
      );
      return;
    }

    if (!darfSchreiben()) return nurLesen();
    const taskId = taskIdVor;

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
         * **Titel, Notiz, Zeitpunkte, Priorität.** Nicht das Projekt (das wäre ein Weg aus
         * der Freigabe hinaus), nicht der Papierkorb (der ist ein Ort des
         * Arbeitsbereichs), nicht die Zuweisung (es gibt hier niemanden, dem
         * man etwas zuweist).
         *
         * Als Auswahlliste und nicht als Sperrliste: was hier nicht steht, geht
         * nicht — und ein neues Feld an der Aufgabe wird damit nicht
         * versehentlich zu einem Recht des Gasts.
         */
        const erlaubt: Record<string, unknown> = {};
        for (const feld of [
          'title',
          'note',
          'planned',
          'plannedAllDay',
          'due',
          'dueAllDay',
          'priority',
        ]) {
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

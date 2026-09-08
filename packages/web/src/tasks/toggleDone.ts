/**
 * SOTE — abhaken oder zurücknehmen, an einer Stelle.
 *
 * Der **fünfte** Fall desselben Musters, und darum jetzt eine Funktion statt
 * einer Regel, an die sich drei Aufrufer erinnern müssen.
 *
 * Gemeldet war: „Ich kann übrigens abgehakte Aufgaben nicht wieder eröffnen."
 * Behoben habe ich das in `TaskList.tsx` — und dann in der **Suche** und in der
 * **Detailspalte** stehen gelassen, wo `api.complete` genauso unbedingt gerufen
 * wurde. Der Wächter, den ich dafür geschrieben habe, prüfte `TaskList.tsx` und
 * sonst nichts.
 *
 * Die Lehre ist nicht „besser aufpassen". Sie ist: **eine Entscheidung, die an
 * drei Stellen richtig getroffen werden muss, wird an einer davon falsch
 * getroffen.** Also gibt es die Entscheidung nur noch hier, und der Wächter
 * prüft, dass niemand `api.complete` direkt ruft.
 */

import { api, type Task } from '../api.js';

/**
 * Schaltet den Haken um — in die Richtung, in der die Aufgabe gerade steht.
 *
 * Gibt zurück, was der Server über einen Nachfolger sagt, damit der Aufrufer es
 * melden kann. Beim Zurücknehmen gibt es keinen: `undefined` heißt „dazu ist
 * nichts zu sagen" und nicht „es gibt keinen".
 */
export async function toggleDone(
  task: Task,
  workspace: string | undefined,
): Promise<{ nextTitle?: string }> {
  if (task.completed !== null) {
    await api.reopen(task.id, workspace);
    return {};
  }
  const out = await api.complete(task.id, workspace);
  return out.next === null ? {} : { nextTitle: out.next.title };
}

/**
 * SOTE — der Klartext-Schatten der Notiz, und der Weg zurück.
 *
 * Die Notiz ist ab jetzt ein Dokument. Vier Stellen lesen sie trotzdem als
 * Klartext und sollen das weiter tun: die Volltextsuche (`to_tsvector` über
 * Titel und Notiz), die Vorschau auf der Karte, der Kalender-Tooltip und die
 * Beschreibung im ICS-Export. Keine davon kann etwas mit Auszeichnung anfangen,
 * und keine davon soll den Editor kennen müssen.
 *
 * Also wird beim Speichern **beides** geschrieben: das Dokument als Wahrheit
 * und der Klartext daraus als Schatten. Genau deshalb nimmt die PATCH-Route
 * `noteDoc` nur zusammen mit `note` an — zwei getrennt schreibbare Antworten
 * auf dieselbe Frage laufen auseinander, und man merkt es erst in der Suche.
 *
 * Was der Schatten NICHT ist: eine Rückverwandlung. Aus ihm lässt sich das
 * Dokument nicht wiederherstellen, und er soll es auch nicht — er ist die
 * Fassung für den, der nur die Wörter braucht.
 */

import type { Node as PMNode } from 'prosemirror-model';

import { schema } from './schema.js';

/**
 * Wie ein Block im Klartext endet.
 *
 * Listen und Aufgaben bekommen ihr Zeichen, weil eine Kartenvorschau aus drei
 * Punkten ohne Punkte eine Zeile Fließtext wäre, in der drei Gedanken
 * ineinanderlaufen. Überschriften bekommen keines: sie stehen ohnehin vorn.
 */
const PREFIX: Record<string, string> = {
  bulletList: '• ',
  numberedList: '• ',
  todo: '• ',
  quote: '„',
};

const SUFFIX: Record<string, string> = { quote: '"' };

/** Der Text einer Zeile, Erwähnungen als `@Name`, Bilder als ihr Alt-Text. */
function inlineText(node: PMNode): string {
  let out = '';
  node.forEach((child) => {
    if (child.isText) out += child.text ?? '';
    else if (child.type.name === 'mention') out += `@${String(child.attrs['label'] ?? '')}`;
    else out += inlineText(child);
  });
  return out;
}

/**
 * Der Klartext eines Notiz-Dokuments.
 *
 * Eine Zeile je Block, leere Blöcke fallen weg. Ein Trenner, ein Bild ohne
 * Alt-Text und eine leere Tabellenzelle tragen keine Wörter und stehen deshalb
 * auch nicht als Leerzeile in der Suche.
 */
export function noteText(doc: PMNode): string {
  const lines: string[] = [];
  const walk = (node: PMNode): void => {
    node.forEach((child) => {
      if (child.type.name === 'image') {
        const alt = String(child.attrs['alt'] ?? '').trim();
        if (alt !== '') lines.push(alt);
        return;
      }
      if (child.isTextblock) {
        const text = inlineText(child).trim();
        if (text !== '') {
          lines.push(`${PREFIX[child.type.name] ?? ''}${text}${SUFFIX[child.type.name] ?? ''}`);
        }
        return;
      }
      walk(child);
    });
  };
  walk(doc);
  return lines.join('\n');
}

/**
 * Aus einer alten Notiz ein Dokument machen.
 *
 * Absätze an Leerzeilen, sonst eine Zeile ein Absatz — das ist, wie der Text im
 * Textfeld ausgesehen hat, und mehr Auslegung wäre geraten. Kein Markdown-Leser
 * hier: wer `**fett**` getippt hat, hat es als Zeichen getippt, und es
 * nachträglich zu Auszeichnung zu erklären ändert seine Notiz ohne Anlass.
 *
 * Läuft beim ersten Öffnen im Editor, nicht in einem Massenlauf: eine Aufgabe,
 * die niemand anfasst, bleibt so, wie sie ist.
 */
export function docFromPlainText(text: string): PMNode {
  const paragraph = schema.nodes['paragraph'];
  if (!paragraph) throw new Error('Schema ohne Absatz');
  const lines = text.split('\n');
  const blocks = lines
    .map((line) => line.trim())
    .filter((line, index, all) => line !== '' || (index > 0 && index < all.length - 1))
    .map((line) => (line === '' ? paragraph.create() : paragraph.create(null, schema.text(line))));
  return schema.nodes['doc']!.create(null, blocks.length > 0 ? blocks : [paragraph.create()]);
}

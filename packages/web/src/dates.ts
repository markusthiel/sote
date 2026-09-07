/**
 * SOTE — Datum und Uhrzeit für die Anzeige.
 *
 * Rein und mit übergebenem `now`, damit „heute" testbar ist. Und die
 * Unterscheidung, um die es dem ganzen Produkt geht, steckt in der Signatur:
 * ein **Ganztagstermin** wird ohne Uhrzeit gezeigt, sonst stünde überall
 * „00:00" und niemand könnte „morgen" von „morgen um Mitternacht" trennen.
 */

const DAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'] as const;
const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
] as const;

const startOfDay = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());

export const dayDiff = (a: Date, b: Date): number =>
  Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86_400_000);

const hhmm = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** „heute, 09:30", „Fr, 4. Sept", „morgen". */
export function whenLabel(at: Date, allDay: boolean, now: Date): string {
  const diff = dayDiff(at, now);
  const time = allDay ? '' : hhmm(at);
  if (diff === 0) return allDay ? 'heute' : `heute, ${time}`;
  if (diff === 1) return allDay ? 'morgen' : `morgen, ${time}`;
  if (diff === -1) return allDay ? 'gestern' : `gestern, ${time}`;
  const day = `${DAYS[at.getDay()]}, ${at.getDate()}. ${MONTHS[at.getMonth()]!.slice(0, 4)}`;
  return allDay ? day : `${day}, ${time}`;
}

export const isOverdue = (at: Date, now: Date): boolean => dayDiff(at, now) < 0;

export function longDate(now: Date): string {
  return `${
    ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'][
      now.getDay()
    ]
  }, ${now.getDate()}. ${MONTHS[now.getMonth()]}`;
}

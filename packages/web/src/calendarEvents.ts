import type { SpanEvent } from './api.js';
import { addDays, parseIsoDate, startOfDay } from './calendar.js';

/** Ganztag bleibt ein Datum; Zeitangaben werden in die Browserzone übersetzt. */
export function eventOnDay(event: SpanEvent, day: Date): { from: number; to: number } | null {
  const start = event.allDay ? parseIsoDate(event.start.slice(0, 10)) : new Date(event.start);
  const end = event.allDay ? parseIsoDate(event.end.slice(0, 10)) : new Date(event.end);
  if (start === undefined || end === undefined || !Number.isFinite(+start) || !Number.isFinite(+end)) return null;
  const midnight = startOfDay(day);
  const next = addDays(midnight, 1);
  // Das Ende ist exklusiv: Mitternacht gehört nicht noch zum Folgetag.
  if (start >= next || end <= midnight || end <= start) return null;
  const minutes = (d: Date) => d.getHours() * 60 + d.getMinutes();
  return { from: start <= midnight ? 0 : minutes(start), to: end >= next ? 1440 : minutes(end) };
}

export const eventKey = (event: SpanEvent): string =>
  JSON.stringify([event.feedId, event.uid, event.recurrenceId, event.start]);

/** Gleichzeitig belegte Zeiten bekommen eigene Spalten, je Überschneidungsgruppe. */
export function timedEventsOnDay(events: readonly SpanEvent[], day: Date) {
  const segments = events.filter((event) => !event.allDay).flatMap((event) => {
    const segment = eventOnDay(event, day);
    return segment === null ? [] : [{ event, ...segment, lane: 0, lanes: 1 }];
  }).sort((a, b) => a.from - b.from || b.to - a.to);
  let group: typeof segments = [];
  let ends: number[] = [];
  const finish = () => { for (const segment of group) segment.lanes = ends.length; };
  for (const segment of segments) {
    if (ends.every((end) => end <= segment.from)) {
      finish(); group = []; ends = [];
    }
    const free = ends.findIndex((end) => end <= segment.from);
    segment.lane = free < 0 ? ends.length : free;
    ends[segment.lane] = Math.min(1440, Math.max(segment.to, segment.from + 15));
    group.push(segment);
  }
  finish();
  return segments;
}

import type { CalendarDefault } from '@sote/core';
import { isCalendarSpan, type CalendarSpan } from './calendar.js';

const remembered = new Map<string, CalendarSpan>();
const key = (userId: string) => `sote.calendar.last.${userId}`;

/** Die Vorgabe reist mit dem Konto, die letzte Ansicht gehört zu diesem Browser. */
export function rememberCalendarSpan(userId: string, span: CalendarSpan): void {
  remembered.set(userId, span);
  try { localStorage.setItem(key(userId), span); } catch { /* Bleibt für diese Sitzung gemerkt. */ }
}

export function preferredCalendarSpan(userId: string, choice: CalendarDefault = 'last'): CalendarSpan {
  if (choice !== 'last') return choice;
  let saved: unknown = remembered.get(userId);
  try { saved = localStorage.getItem(key(userId)) ?? saved; } catch { /* Sitzung bleibt nutzbar. */ }
  return isCalendarSpan(saved) ? saved : 'week';
}

import { addDays, isoDate, parseIsoDate } from './calendar.js';

export interface CalendarTooltipData {
  title: string; source: string; when: string; duration?: string; location?: string | null;
  note?: string; color?: string; status?: string;
}

/** Neben dem Termin, sonst darunter/darüber; stets vollständig innerhalb des Fensters. */
export function placeCalendarTooltip(anchor: {left:number;right:number;top:number;bottom:number}, size: {width:number;height:number}, viewport: {width:number;height:number}) {
  const margin=12, gap=8;
  const maxX=Math.max(margin,viewport.width-size.width-margin), maxY=Math.max(margin,viewport.height-size.height-margin);
  const clamp=(v:number,max:number)=>Math.max(margin,Math.min(v,max));
  let left=anchor.right+gap, top=anchor.top;
  if(left>maxX) {
    if(anchor.left-gap-size.width>=margin) left=anchor.left-gap-size.width;
    else {left=anchor.left;top=anchor.bottom+gap+size.height<=viewport.height-margin?anchor.bottom+gap:anchor.top-gap-size.height;}
  }
  return {left:clamp(left,maxX),top:clamp(top,maxY)};
}

/** ICS-Ganztage tragen Kalendertage; ihr Enddatum ist exklusiv. */
export function calendarTooltipWhen(start: string, end: string | null, allDay: boolean): string {
  const from=allDay?parseIsoDate(start.slice(0,10)):new Date(start);
  const until=end?(allDay?parseIsoDate(end.slice(0,10)):new Date(end)):null;
  if(!from||!Number.isFinite(+from)) return '';
  const date=(d:Date)=>d.toLocaleDateString('de-DE',{weekday:'short',day:'numeric',month:'long',year:'numeric'});
  const time=(d:Date)=>d.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
  if(allDay) {
    const last=until&&+until>+from?addDays(until,-1):from;
    return `${date(from)}${isoDate(last)!==isoDate(from)?` – ${date(last)}`:''} · Ganztägig`;
  }
  return `${date(from)} · ${time(from)}${until&&+until>+from?` – ${isoDate(until)===isoDate(from)?'':date(until)+' · '}${time(until)}`:''}`;
}

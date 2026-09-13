import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import { scheduleDraft, schedulePatch } from '../src/taskSchedule.js';

let oldZone: string | undefined;
before(() => { oldZone = process.env['TZ']; process.env['TZ'] = 'Europe/Berlin'; });
after(() => { if (oldZone === undefined) delete process.env['TZ']; else process.env['TZ'] = oldZone; });

test('Manuelle örtliche Uhrzeit und Dauer werden gemeinsam gespeichert und erneut gelesen', () => {
  const draft = { date:'2026-09-14', time:'14:35', allDay:false, duration:'1 Stunde' };
  const result = schedulePatch(draft);
  assert.deepEqual(result.patch,{ planned:'2026-09-14T12:35:00.000Z', plannedAllDay:false, duration:60 });
  assert.deepEqual(scheduleDraft(result.patch as {planned:string;plannedAllDay:boolean;duration:number}),{ ...draft,duration:'1 h' });
  assert.equal(schedulePatch({...draft,date:'2026-12-14'}).patch?.planned,'2026-12-14T13:35:00.000Z');
});

test('Ganztägig verwendet den örtlichen Tag; Dauer bleibt eine Schätzung', () => {
  assert.deepEqual(schedulePatch({date:'2026-09-14',time:'18:45',allDay:true,duration:'30'}).patch,{planned:'2026-09-13T22:00:00.000Z',plannedAllDay:true,duration:30});
  assert.equal(scheduleDraft({planned:'2026-09-13T22:00:00.000Z',plannedAllDay:true,duration:30}).date,'2026-09-14');
});

test('Dauer funktioniert ohne Datum und kann wieder entfernt werden', () => {
  const draft={date:'',time:'09:00',allDay:true,duration:'15 min'};
  assert.deepEqual(schedulePatch(draft).patch,{planned:null,plannedAllDay:true,duration:15});
  assert.equal(schedulePatch({...draft,duration:''}).patch?.duration,null);
  for(const duration of ['15','30','1h','2h','1:30 h']) assert.ok(schedulePatch({...draft,duration}).patch);
});

test('Fehlende und unmögliche Zeitpunkte oder Dauern schreiben keinen Ersatzwert', () => {
  const draft={date:'2026-09-14',time:'09:00',allDay:false,duration:'30'};
  for(const changes of [{date:''},{date:'2026-02-30'},{time:''},{time:'25:00'},{duration:'0'},{duration:'unsinn'},{duration:'10081'}]) assert.ok(schedulePatch({...draft,...changes}).error);
  assert.match(schedulePatch({...draft,date:'2026-03-29',time:'02:30'}).error!,/Zeitumstellung/);
});

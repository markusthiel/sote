import { strict as assert } from 'node:assert';
import { test, type TestContext } from 'node:test';
import { preferredCalendarSpan, rememberCalendarSpan } from '../src/calendarPreference.js';

function storage(t: TestContext, value: Partial<Storage>) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable:true, value });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  });
}

test('Letzte Kalenderansicht bleibt je Konto erhalten; feste Vorgabe gewinnt beim Öffnen', (t) => {
  const entries = new Map<string,string>();
  storage(t, { getItem:(key:string)=>entries.get(key)??null, setItem:(key:string,value:string)=>{entries.set(key,value);} });
  assert.equal(preferredCalendarSpan('a'),'week');
  rememberCalendarSpan('a','month');
  assert.equal(preferredCalendarSpan('a'),'month');
  assert.equal(preferredCalendarSpan('b'),'week');
  for (const choice of ['day','week','month'] as const) assert.equal(preferredCalendarSpan('a',choice),choice);
  assert.equal(preferredCalendarSpan('a','last'),'month');
  entries.set('sote.calendar.last.a','day');
  assert.equal(preferredCalendarSpan('a'),'day');
  entries.set('sote.calendar.last.a','year');
  assert.equal(preferredCalendarSpan('a'),'week');
});

test('Gesperrter Browserspeicher verhindert weder Wechsel noch Wiederbesuch', (t) => {
  storage(t, { getItem:()=>{throw new Error('blocked');}, setItem:()=>{throw new Error('blocked');} });
  rememberCalendarSpan('private','day');
  assert.equal(preferredCalendarSpan('private'),'day');
});

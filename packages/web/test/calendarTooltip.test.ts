import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {calendarTooltipWhen,placeCalendarTooltip} from '../src/calendarTooltip.js';

test('Kalendervorschau wechselt die Seite und bleibt an allen Fensterrändern sichtbar',()=>{
 const size={width:300,height:250},viewport={width:1000,height:700};
 assert.deepEqual(placeCalendarTooltip({left:100,right:200,top:100,bottom:160},size,viewport),{left:208,top:100});
 assert.deepEqual(placeCalendarTooltip({left:850,right:950,top:100,bottom:160},size,viewport),{left:542,top:100});
 for(const anchor of [{left:0,right:100,top:-50,bottom:10},{left:950,right:1100,top:650,bottom:800},{left:10,right:970,top:20,bottom:60},{left:10,right:970,top:640,bottom:680}]){
  const at=placeCalendarTooltip(anchor,size,viewport);
  assert.ok(at.left>=12&&at.top>=12);assert.ok(at.left+size.width<=988);assert.ok(at.top+size.height<=688);
 }
 assert.deepEqual(placeCalendarTooltip({left:12,right:308,top:300,bottom:340},{width:296,height:220},{width:320,height:568}),{left:12,top:72});
});

test('Ganztagsvorschau nennt volle Tage und zieht das exklusive Enddatum ab',()=>{
 const single=calendarTooltipWhen('2026-09-14T00:00:00Z','2026-09-15T00:00:00Z',true);
 assert.match(single,/14\. September 2026/);assert.doesNotMatch(single,/15\. September/);assert.match(single,/Ganztägig/);
 const multi=calendarTooltipWhen('2026-09-14','2026-09-17',true);assert.match(multi,/16\. September 2026/);assert.doesNotMatch(multi,/17\. September/);
});

test('Zeitvorschau zeigt die wirkliche Uhrzeit und bei Mitternacht beide Tage',()=>{
 const from=new Date(2026,8,14,23,30),to=new Date(2026,8,15,1,0);
 const text=calendarTooltipWhen(from.toISOString(),to.toISOString(),false);
 assert.match(text,/23:30/);assert.match(text,/01:00/);assert.match(text,/15\. September/);
 assert.doesNotMatch(calendarTooltipWhen(from.toISOString(),null,false),/01:00/);
});

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarIcon, ClockIcon } from './icons.js';
import { placeCalendarTooltip, type CalendarTooltipData } from '../calendarTooltip.js';

/** Eine sofortige Vorschau für alle Karten; der Zeiger darf in die Vorschau wechseln. */
export function useCalendarTooltip() {
  const id=useId();
  const [active,setActive]=useState<{key:string;anchor:HTMLElement;data:CalendarTooltipData;y?:number}|null>(null);
  const box=useRef<HTMLDivElement>(null);
  const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const keep=()=>{clearTimeout(timer.current);};
  const hide=()=>{keep();setActive(null);};
  const leave=()=>{keep();timer.current=setTimeout(()=>setActive(null),150);};
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  useEffect(()=>{
    if(!active)return;
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();hide();}};
    const scroll=(e:Event)=>{if(e.target instanceof Node&&box.current?.contains(e.target))return;hide();};
    const outside=(e:PointerEvent)=>{if(e.target instanceof Node&&(box.current?.contains(e.target)||active.anchor.contains(e.target)))return;hide();};
    window.addEventListener('keydown',key,true);window.addEventListener('scroll',scroll,true);window.addEventListener('resize',hide);document.addEventListener('pointerdown',outside);
    return()=>{window.removeEventListener('keydown',key,true);window.removeEventListener('scroll',scroll,true);window.removeEventListener('resize',hide);document.removeEventListener('pointerdown',outside);};
  },[active]);
  useLayoutEffect(()=>{
    if(!active||!box.current)return;
    const popup=box.current;
    const position=()=>{
      const rect=active.anchor.getBoundingClientRect();
      const size=popup.getBoundingClientRect();
      const point=active.y===undefined?rect:{left:rect.left,right:rect.right,bottom:rect.bottom,top:active.y};
      const at=placeCalendarTooltip(point,size,{width:window.innerWidth,height:window.innerHeight});
      popup.style.left=`${at.left}px`;popup.style.top=`${at.top}px`;
    };
    position();const observer=new ResizeObserver(position);observer.observe(popup);
    return()=>observer.disconnect();
  },[active]);
  const bind=(key:string,data:CalendarTooltipData)=>({
    'aria-describedby':active?.key===key?id:undefined,
    onPointerEnter:(e:React.PointerEvent<HTMLElement>)=>{if(e.pointerType==='touch'||e.buttons!==0)return;keep();setActive({key,anchor:e.currentTarget,data,y:e.clientY});},
    onPointerLeave:leave,
    onFocus:(e:React.FocusEvent<HTMLElement>)=>{if(!e.currentTarget.matches(':focus-visible'))return;keep();setActive({key,anchor:e.currentTarget,data});},
    onBlur:leave,
  });
  const tooltip=active?createPortal(<div id={id} ref={box} className="cal-tooltip" role="tooltip" onPointerEnter={keep} onPointerLeave={leave}>
    <p className="cal-tooltip-source"><span style={{background:active.data.color??'var(--accent)'}} />{active.data.source}</p>
    <h3>{active.data.title}</h3>
    <p className="cal-tooltip-detail"><CalendarIcon size={16}/><span>{active.data.when}</span></p>
    {active.data.duration?<p className="cal-tooltip-detail"><ClockIcon size={16}/><span>{active.data.duration}</span></p>:null}
    {active.data.location?<p className="cal-tooltip-detail"><span>Ort: {active.data.location}</span></p>:null}
    {active.data.status?<p className="cal-tooltip-detail">{active.data.status}</p>:null}
    {active.data.note?<p className="cal-tooltip-note">{active.data.note}</p>:null}
  </div>,active.anchor.closest('.app')??document.body):null;
  return {bind,hide,tooltip};
}

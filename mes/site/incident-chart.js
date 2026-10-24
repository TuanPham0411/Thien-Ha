import {priorityHeight,priorityAt} from './incident-load.js';
import {incidentFlow} from './incident-flow.js';
import {departmentInk,countInk} from './incident-colors.js';
import {t,getLanguage} from './i18n.js';
const NS='http://www.w3.org/2000/svg';
const S=(tag,attrs={},text)=>{const n=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,String(v));if(text!==undefined)n.textContent=text;return n;};
export function countScale(maximum,minimum=3){
 const target=Math.max(minimum,maximum),raw=target/3,base=10**Math.floor(Math.log10(Math.max(raw,.001))),step=[1,2,5,10].map(n=>n*base).find(n=>n>=raw),integerStep=Math.max(1,Math.ceil(step)),max=Math.ceil(target/integerStep)*integerStep;
 return {max,ticks:Array.from({length:Math.round(max/integerStep)+1},(_,i)=>i*integerStep)};
}
export const countLineColor=()=>countInk();
export function createIncidentChart(result,{width=960,fontSize=14,night=true,countColor,unit='day',onBucket=()=>{},onTime=()=>{},onTicket=()=>{},onHover=()=>{},onLeave=()=>{}}={}){
 if(!result.flow)result={...incidentFlow(result,{start:result.start,end:result.end,now:result.now??result.end}),start:result.start,end:result.end};
 const s=fontSize/14,w=Math.max(360*s,width),left=44*s,right=w-104*s,top=30*s,bottom=224*s,height=260*s,plot=right-left;
 const lineColor=countColor||countInk(result.entries.map(e=>e.issue.departmentId||'__none'));
 const c=night?{ink:'#e7eef4',muted:'#a3b2be',grid:'#354149',line:lineColor,bg:'#171f25'}:{ink:'#233244',muted:'#617284',grid:'#dce4ea',line:lineColor,bg:'#f8fafc'};
 const axis=countScale(result.peak),x=time=>left+(time-result.start)/(result.end-result.start)*plot,y=n=>bottom-n/axis.max*(bottom-top),py=priority=>bottom-priorityHeight(priority)/8*(bottom-top);
 const svg=S('svg',{xmlns:NS,viewBox:`0 0 ${w} ${height}`,width:w,height,role:'group',tabindex:0,'aria-label':t('Combined incident timeline'),'aria-description':t('Left: ticket count. Right: four relative priority levels.'),class:'incident-analysis-svg','data-count-max':axis.max,'data-peak':result.peak,style:`font-family:inherit;font-size:${fontSize}px;width:${w}px;height:${height}px;max-width:none;isolation:isolate`});
 svg.append(S('title',{},t('Combined incident timeline')));
 const text=(value,px,yy,attrs={})=>S('text',{x:px,y:yy,fill:c.muted,'font-size':fontSize,'font-family':'inherit',...attrs},value);
 svg.append(text(t('Open tickets'),left,15*s,{fill:c.ink,'font-weight':600}),text(t('Priority'),right,15*s,{fill:c.ink,'font-weight':600,'text-anchor':'end'}));
 for(const n of axis.ticks)svg.append(S('line',{x1:left,x2:right,y1:y(n),y2:y(n),stroke:c.grid,'stroke-width':1,'stroke-opacity':n===0?.8:.42}),text(n,left-10*s,y(n)+4*s,{'text-anchor':'end',class:'incident-left-tick'}));
 for(let level=1;level<=4;level++)svg.prepend(S('rect',{x:left,y:bottom-level/4*(bottom-top),width:plot,height:(bottom-top)/4,fill:c.ink,'fill-opacity':level%2?.014:0,'pointer-events':'none'}));
 for(const priority of ['Low','Medium','High','Critical'])svg.append(S('line',{x1:right,x2:right+5*s,y1:py(priority),y2:py(priority),stroke:c.muted,'stroke-opacity':.5}),text(t(priority),right+10*s,py(priority)+4*s,{class:'incident-right-tick','data-priority':priority}));
 const defs=S('defs'),clip=S('clipPath',{id:'incident-plot-clip'});clip.append(S('rect',{x:left,y:top-2*s,width:plot,height:bottom-top+4*s}));defs.append(clip);const fillGradient=S('linearGradient',{id:'incident-count-fill',x1:0,y1:0,x2:0,y2:1});fillGradient.append(S('stop',{offset:'0%','stop-color':c.line,'stop-opacity':.05}),S('stop',{offset:'100%','stop-color':c.line,'stop-opacity':0}));defs.append(fillGradient);svg.append(defs);
 const highlight=S('rect',{x:left,y:top,width:0,height:bottom-top,fill:c.line,opacity:.06,'pointer-events':'none'});svg.append(highlight);
 const layers=S('g',{'clip-path':'url(#incident-plot-clip)'}),columns=S('g',{class:'incident-columns'}),paths=S('g',{class:'incident-trajectories'}),arrows=S('g',{class:'incident-priority-arrows'});layers.append(columns,paths);svg.append(layers);
 if(result.buckets.some(b=>!b.matches))for(const b of result.buckets)if(b.matches)layers.prepend(S('rect',{x:x(b.start),y:top,width:Math.max(1,x(b.end)-x(b.start)),height:bottom-top,fill:c.line,'fill-opacity':.07,class:'incident-frequency-window','pointer-events':'none'}));
 const focusTicket=id=>{svg.toggleAttribute('data-ticket-focus',!!id);for(const node of svg.querySelectorAll('[data-ticket]'))node.setAttribute('opacity',!id||node.dataset.ticket===String(id)?'1':'.14');};
 const interactive=(node,value,time)=>{node.addEventListener('mouseenter',event=>{focusTicket(value.entry.id);onHover(value,event);});node.addEventListener('mouseleave',()=>{focusTicket(null);onLeave();});node.addEventListener('focus',event=>{focusTicket(value.entry.id);onHover(value,event);});node.addEventListener('blur',()=>{focusTicket(null);onLeave();});node.addEventListener('click',event=>{event.stopPropagation();onTime(time);});node.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();event.stopPropagation();onTicket(value.entry.issue.id);}});};
 for(const col of [...result.flow.columns].sort((a,b)=>priorityHeight(b.priority)-priorityHeight(a.priority))){
  const {entry,time,priority,reason}=col,color=departmentInk(entry.issue.departmentId),column=S('rect',{x:x(time)-6*s,y:py(priority),width:12*s,height:bottom-py(priority),fill:color,'fill-opacity':reason==='snapshot'?.13:reason==='resolved'?.06:.29,stroke:color,'stroke-width':reason==='resolved'?1.6*s:.8*s,'stroke-opacity':reason==='snapshot'?.48:.95,rx:1.5*s,class:'incident-start-column','data-severity':priority,'data-level':priorityHeight(priority)/2,'data-start':time,'data-ticket':entry.id,'data-reason':reason,'data-department':entry.issue.departmentId||'__none',style:night?'mix-blend-mode:normal':'mix-blend-mode:multiply',role:'button',tabindex:0,'aria-label':`${entry.issue.ticketNumber||entry.id} · ${t(reason==='resolved'?'Resolved':reason==='snapshot'?'Existing ticket snapshot':'Ticket created')}`});
  column.append(S('title',{},`${entry.issue.ticketNumber||entry.id} · ${t(reason==='resolved'?'Resolved':reason==='snapshot'?'Existing ticket snapshot':'Ticket created')} · ${t(priority)}`));interactive(column,{entry,milestone:col},time);columns.append(column);
  if(reason==='resolved')columns.append(S('path',{d:`M${x(time)-4*s},${py(priority)+5*s} l${3*s},${3*s} l${5*s},${-6*s}`,fill:'none',stroke:c.ink,'stroke-width':1.4*s,'pointer-events':'none',class:'incident-resolved-mark'}));
 }
 for(const entry of result.flow.tickets){const color=departmentInk(entry.issue.departmentId);
  const addPath=(d,cycle,phase)=>{const group=S('g',{class:'incident-range',role:'button',tabindex:0,'data-ticket':entry.id,'data-phase':phase,'aria-label':`${entry.issue.ticketNumber||entry.id} · ${t(phase==='closing'?'Resolved to Closed':'Ticket progression')}`});group.append(S('path',{d,fill:'none',stroke:color,'stroke-opacity':.72,'stroke-width':1.6*s,'stroke-dasharray':`${5*s} ${4*s}`,'stroke-linejoin':'round',class:'incident-continuation'}),S('path',{d,fill:'none',stroke:'transparent','stroke-width':10*s}));interactive(group,{entry,cycle,phase},Math.max(result.start,phase==='closing'?cycle.resolvedAt:cycle.incidentStart));paths.append(group);};
  for(const cycle of entry.cycles){
   const from=Math.max(result.start,cycle.incidentStart),to=Math.min(result.end,cycle.activeEnd);
   if(to>from){
    if(cycle.incidentStart>=result.start&&cycle.incidentStart<result.end){const onset=S('g',{class:'incident-onset','data-ticket':entry.id,'data-time':cycle.incidentStart,role:'button',tabindex:0,'aria-label':`${entry.issue.ticketNumber||entry.id} · ${t('Incident time')}`});onset.append(S('circle',{cx:x(cycle.incidentStart),cy:bottom,r:3*s,fill:color}),S('circle',{cx:x(cycle.incidentStart),cy:bottom,r:8*s,fill:'transparent'}));interactive(onset,{entry,report:{start:cycle.incidentStart}},cycle.incidentStart);paths.append(onset);}
    const riseEnd=Math.max(cycle.incidentStart,cycle.start),creationY=py(priorityAt(entry,cycle.start)),rampY=time=>riseEnd>cycle.incidentStart?bottom+(creationY-bottom)*Math.max(0,Math.min(1,(time-cycle.incidentStart)/(riseEnd-cycle.incidentStart))):creationY;
    let d=`M${x(from)},${from===cycle.incidentStart?bottom:from<riseEnd?rampY(from):py(priorityAt(entry,from))}`;
    if(from<riseEnd){const rampEnd=Math.min(to,riseEnd);d+=` L${x(rampEnd)},${rampY(rampEnd)}`;}
    if(to>=riseEnd){if(from===riseEnd&&from===cycle.incidentStart)d+=` V${creationY}`;
     for(const change of entry.history){if(change.at<=Math.max(from,riseEnd)||change.at>to||!change.priority||change.priority===change.beforePriority)continue;d+=` H${x(change.at)} V${py(change.priority)}`;}
     d+=` H${x(to)}`;
    }
    if(cycle.closedAt!==null&&cycle.resolvedAt===null&&cycle.closedAt===to)d+=` V${bottom}`;addPath(d,cycle,'active');
   }
   if(cycle.resolvedAt!==null&&cycle.closedAt!==null&&cycle.closedAt>=result.start&&cycle.resolvedAt<result.end){
    const begin=cycle.resolvedAt,finish=cycle.closedAt,from=Math.max(begin,result.start),to=Math.min(finish,result.end),height=py(priorityAt(entry,begin)),at=time=>height+(bottom-height)*(time-begin)/Math.max(1,finish-begin);
    addPath(`M${x(from)},${at(from)} L${x(to)},${at(to)}`,cycle,'closing');
   }
   if(cycle.closedAt!==null&&cycle.closedAt>=result.start&&cycle.closedAt<result.end){const marker=S('g',{class:'incident-completion','data-ticket':entry.id,role:'button',tabindex:0,'aria-label':`${entry.issue.ticketNumber||entry.id} · ${t('Closed')}`});marker.append(S('circle',{cx:x(cycle.closedAt),cy:bottom,r:4*s,fill:c.bg,stroke:color,'stroke-width':1.5*s}));interactive(marker,{entry,cycle,phase:'closing'},cycle.closedAt);paths.append(marker);}
  }
  const seen=new Set();for(const change of entry.history){if(change.at<result.start||change.at>=result.end||!change.priority||!change.beforePriority||change.priority===change.beforePriority)continue;
   const cycle=entry.cycles.find(c=>c.start<=change.at&&change.at<=c.activeEnd);if(!cycle)continue;
   const key=change.at+'@'+change.beforePriority+'@'+change.priority;if(seen.has(key))continue;seen.add(key);
   const upgrade=priorityHeight(change.priority)>priorityHeight(change.beforePriority),color=upgrade?'#ef626e':'#54cb85',xx=x(change.at),center=(py(change.priority)+py(change.beforePriority))/2,dir=upgrade?-1:1;
   const arrowOffset=(upgrade?-16:16)*s;
   const arrow=S('g',{class:'incident-priority-arrow',transform:`translate(${arrowOffset} 0)`,role:'button',tabindex:0,'data-ticket':entry.id,'data-direction':upgrade?'up':'down','data-at':change.at,'aria-label':`${entry.issue.ticketNumber||entry.id} · ${t(change.beforePriority)} → ${t(change.priority)}`});
   arrow.append(S('circle',{cx:xx,cy:center,r:9*s,fill:c.bg,'fill-opacity':.96}),S('path',{d:`M${xx},${center-dir*7*s} V${center+dir*7*s} M${xx-4*s},${center+dir*2*s} L${xx},${center+dir*7*s} L${xx+4*s},${center+dir*2*s}`,fill:'none',stroke:color,'stroke-width':2.2*s,'stroke-linecap':'round','stroke-linejoin':'round'}),S('rect',{x:xx-10*s,y:center-12*s,width:20*s,height:24*s,fill:'transparent'}),S('title',{},`${entry.issue.ticketNumber||entry.id} · ${t(change.beforePriority)} → ${t(change.priority)}`));interactive(arrow,{entry,change},change.at);arrows.append(arrow);
  }
 }
 const runs=result.flow.lineRuns||[],d=runs.map(run=>run.map((p,i)=>`${i?'L':'M'}${x(p.time)},${y(p.count)}`).join(' ')).join(' ');
 for(const run of runs){const first=run[0],last=run.at(-1),area=run.map((p,i)=>`${i?'L':'M'}${x(p.time)},${y(p.count)}`).join(' ');layers.prepend(S('path',{d:`${area} L${x(last.time)},${bottom} L${x(first.time)},${bottom} Z`,fill:'url(#incident-count-fill)','pointer-events':'none',class:'incident-count-area'}));}
 if(d)layers.append(S('path',{d,fill:'none',stroke:c.line,'stroke-opacity':.8,'stroke-width':2.4*s,'stroke-linejoin':'round','stroke-linecap':'round',class:'incident-total-line','pointer-events':'none'}));layers.append(arrows);
 let previous=null;for(const time of [...new Set(result.flow.columns.map(c=>c.time))].sort((a,b)=>a-b)){
  const cols=result.flow.columns.filter(c=>c.time===time),count=result.entries.filter(e=>e.ranges.some(r=>r.start<=time&&time<r.end)).length;if(count===previous)continue;previous=count;
  const lowest=Math.max(...cols.map(c=>py(c.priority))),px=Math.min(right-9*s,Math.max(left+9*s,x(time))),yy=(lowest+bottom)/2,label=S('g',{class:'incident-count-label','data-time':time,'data-count':count,'pointer-events':'none'});
  label.append(S('rect',{x:px-9*s,y:yy-10*s,width:18*s,height:18*s,rx:4*s,fill:c.bg,stroke:c.grid,'stroke-width':.6*s,'fill-opacity':.98}),text(count,px,yy+4*s,{'text-anchor':'middle',fill:c.ink,'font-weight':700}));layers.append(label);
 }
 const showTime=unit==='hour'||result.end-result.start<=2*86400000,ticks=Math.max(2,Math.min(8,Math.floor(plot/((showTime?160:95)*s))));
 for(let i=0;i<ticks;i++){const time=result.start+(result.end-result.start)*i/(ticks-1),value=new Date(time).toLocaleString(getLanguage()==='vi'?'vi-VN':'en-GB',{timeZone:'Asia/Ho_Chi_Minh',day:'2-digit',month:'2-digit',...(showTime?{hour:'2-digit',minute:'2-digit'}:{})});svg.append(text(value,x(time),bottom+23*s,{'text-anchor':i===0?'start':i===ticks-1?'end':'middle'}));}
 if(!result.entries.length){const center=left+plot/2;svg.append(S('rect',{x:left,y:top+35*s,width:plot,height:110*s,rx:10*s,fill:c.bg,'fill-opacity':.96}),text(t('No incidents in this period'),center,top+80*s,{'text-anchor':'middle',fill:c.ink,'font-weight':600,class:'incident-empty-title'}),text(t(w<560*s?'Clear filters to try again.':'Try another period or clear the filters.'),center,top+106*s,{'text-anchor':'middle'}));}
 const cursor=S('line',{x1:left,x2:left,y1:top,y2:bottom,stroke:c.muted,'stroke-opacity':.6,'stroke-dasharray':`${3*s} ${4*s}`,'pointer-events':'none',visibility:'hidden',class:'incident-crosshair'});svg.append(cursor);
 let selected=Math.max(0,result.buckets.findIndex(b=>b.count===result.peak));
 const inspect=(index,event)=>{selected=Math.max(0,Math.min(result.buckets.length-1,index));const b=result.buckets[selected];if(!b)return;highlight.setAttribute('x',x(b.start));highlight.setAttribute('width',Math.max(1,x(b.end)-x(b.start)));cursor.setAttribute('x1',x((b.start+b.end)/2));cursor.setAttribute('x2',x((b.start+b.end)/2));cursor.setAttribute('visibility','visible');onHover({bucket:b},event);};
 const timeAt=event=>{const bounds=svg.getBoundingClientRect();return result.start+((event.clientX-bounds.left)*w/(bounds.width||w)-left)/plot*(result.end-result.start);};
 svg.addEventListener('mousemove',event=>{if(event.target.closest('.incident-range,.incident-onset,.incident-start-column,.incident-priority-arrow,.incident-completion'))return;const time=timeAt(event),index=result.buckets.findIndex(b=>b.start<=time&&time<b.end);if(index>=0)inspect(index,event);else onLeave();});
 svg.addEventListener('mouseleave',()=>{highlight.setAttribute('width',0);cursor.setAttribute('visibility','hidden');focusTicket(null);onLeave();});
 svg.addEventListener('click',event=>{const time=timeAt(event);if(time>=result.start&&time<result.end)onTime(time);});
 svg.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End','Enter',' '].includes(event.key))return;event.preventDefault();if(['Enter',' '].includes(event.key))onBucket(result.buckets[selected],'load');else inspect(event.key==='Home'?0:event.key==='End'?result.buckets.length-1:selected+(event.key==='ArrowLeft'?-1:1));});
 return svg;
}

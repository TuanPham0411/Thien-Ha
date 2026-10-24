import {priorityAt,severityOrder} from './incident-load.js';
const stamp=value=>typeof value==='number'?value:Date.parse(value);
const finished=status=>['Resolved','Closed'].includes(status);
// A ticket has one creation milestone. Occurrence reports establish the start
// of the issue trajectory, independently of the ticket-count series.
export function incidentFlow(base,{start,end,now=Date.now()}={}){
 const tickets=[];
 for(const candidate of base.candidates||base.entries){
  const incidentStart=Math.min(...candidate.reported.map(r=>r.start));
  const created=stamp(candidate.issue.createdAt),createdKnown=Number.isFinite(created),born=createdKnown?created:incidentStart;
  if(!Number.isFinite(born)||born>now)continue;
  const history=candidate.history.filter(h=>h.at>=born&&h.at<=now),events=history.filter(h=>h.status&&h.status!==h.beforeStatus).map(h=>({...h}));
  const resolved=stamp(candidate.issue.resolvedAt);
  if(finished(candidate.issue.status)&&Number.isFinite(resolved)&&resolved>=born&&resolved<=now&&!events.some(h=>finished(h.status)&&h.at===resolved))events.push({at:resolved,status:'Resolved'});
  events.sort((a,b)=>a.at-b.at);
  let cycle={start:born,incidentStart,activeEnd:null,resolvedAt:null,closedAt:null,until:now},previous='New';const cycles=[cycle];
  for(const event of events){
   if(event.status==='Resolved'&&!finished(previous)){cycle.activeEnd=event.at;cycle.resolvedAt=event.at;}
   else if(event.status==='Closed'&&previous!=='Closed'){cycle.activeEnd??=event.at;cycle.closedAt=event.at;cycle.until=event.at;}
   else if(!finished(event.status)&&finished(previous)){cycle.until=event.at;cycle={start:event.at,incidentStart:event.at,activeEnd:null,resolvedAt:null,closedAt:null,until:now};cycles.push(cycle);}
   previous=event.status;
  }
  for(const c of cycles)c.activeEnd??=c.until;
  const spans=cycles.map(c=>({start:c.start,end:c.activeEnd})).filter(r=>r.end>r.start);
  const lifecycleEnd=cycles.at(-1).closedAt??now;
  if(Math.min(born,incidentStart)>=end||lifecycleEnd<start)continue;
  const ranges=spans.map(r=>({start:Math.max(start,r.start),end:Math.min(end,r.end)})).filter(r=>r.end>r.start);
  tickets.push({...candidate,born,createdKnown,incidentStart,cycles,lifecycleEnd,ranges});
 }
 const statusAt=(ticket,time)=>{let status='New';for(const c of ticket.cycles){if(c.start>time)break;status=c.closedAt!==null&&c.closedAt<=time?'Closed':c.resolvedAt!==null&&c.resolvedAt<=time?'Resolved':'New';}return status;};
 const exists=(ticket,time)=>ticket.born<=time&&statusAt(ticket,time)!=='Closed';
 const columnMap=new Map(),columns=[],creationTimes=[...new Set(tickets.map(e=>e.born))].filter(time=>time>=start&&time<end).sort((a,b)=>a-b);
 function column(entry,time,reason){const key=entry.id+'@'+time,existing=columnMap.get(key);if(existing){if(reason==='resolved')existing.reason=reason;return;}const value={entry,time,reason,priority:priorityAt(entry,time),status:statusAt(entry,time)};columnMap.set(key,value);columns.push(value);}
 for(const time of creationTimes)for(const ticket of tickets)if(exists(ticket,time))column(ticket,time,ticket.born===time?'created':'snapshot');
 for(const entry of tickets)for(const cycle of entry.cycles)if(cycle.resolvedAt!==null&&cycle.resolvedAt>=start&&cycle.resolvedAt<end)column(entry,cycle.resolvedAt,'resolved');
 const eventTimes=new Set([start,end]);for(const ticket of tickets)for(const r of ticket.ranges){eventTimes.add(r.start);eventTimes.add(r.end);}
 const times=[...eventTimes].sort((a,b)=>a-b),segments=[];let peak=0;
 for(let i=0;i<times.length-1;i++){const time=times[i],active=tickets.filter(e=>e.ranges.some(r=>r.start<=time&&time<r.end)),counts=Object.fromEntries(severityOrder.map(p=>[p,0]));for(const e of active)counts[priorityAt(e,time)]++;peak=Math.max(peak,active.length);segments.push({start:time,end:times[i+1],count:active.length,counts});}
 const countRanges=tickets.flatMap(entry=>entry.cycles.map(cycle=>({start:cycle.start,end:cycle.activeEnd,ended:cycle.resolvedAt!==null||cycle.closedAt!==null||cycle.until<now}))).filter(r=>r.end>r.start);
 const lineEnd=Math.min(end,now),lineTimes=new Set(start<=lineEnd?[start,lineEnd]:[]);for(const r of countRanges)for(const time of [r.start,r.end])if(time>=start&&time<=lineEnd)lineTimes.add(time);
 const valueAt=(time,before=false)=>countRanges.reduce((count,r)=>{if(time<r.start||time>r.end||(!before&&time===r.end&&r.ended)||(before&&time===r.start))return count;return count+1;},0);
 const line=[];for(const time of [...lineTimes].sort((a,b)=>a-b)){const before=valueAt(time,true),after=valueAt(time);line.push({time,count:before});if(after!==before)line.push({time,count:after});}
 const lineRuns=[];let run=null;for(const point of line){if(point.count<=0){run=null;continue;}if(!run){run=[];lineRuns.push(run);}run.push(point);}
 const buckets=base.buckets.map(b=>{const overlapping=segments.filter(s=>s.start<b.end&&s.end>b.start),best=overlapping.reduce((a,v)=>v.count>a.count?v:a,{count:0,counts:Object.fromEntries(severityOrder.map(p=>[p,0]))}),started=tickets.filter(e=>e.born>=b.start&&e.born<b.end),startCounts=Object.fromEntries(severityOrder.map(p=>[p,0]));for(const e of started)startCounts[priorityAt(e,e.born)]++;
 return {...b,count:best.count,counts:best.counts,starts:started.length,startCounts,tickets:tickets.filter(e=>e.ranges.some(r=>r.start<b.end&&r.end>b.start)).map(e=>e.issue)};});
 const threshold=base.frequencyThreshold??3,frequency=base.frequency||'all';for(const b of buckets)b.matches=frequency==='high'?b.count>=threshold:frequency==='low'?b.count<=threshold:true;
 return {...base,entries:tickets,segments,peak,total:tickets.length,buckets,ranked:buckets.filter(b=>b.matches).sort((a,b)=>(frequency==='low'?a.count-b.count:b.count-a.count)||a.start-b.start),flow:{tickets,columns,line,lineRuns,statusAt}};
}

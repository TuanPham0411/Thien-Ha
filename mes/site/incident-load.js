import {incidentSeries} from './incident-analytics.js';
export const severityOrder=['Low','Medium','High','Critical','Unclassified'];
export const severityColors={Low:'#36b7a0',Medium:'#e9b44c',High:'#f18743',Critical:'#ef626e',Unclassified:'#94a3b8'};
const timestamp=value=>typeof value==='number'?value:Date.parse(value);
export const priorityHeight=p=>({Low:2,Medium:4,High:6,Critical:8}[p]||2);
export const departmentColor=id=>{let hash=2166136261;for(const c of String(id||'__none'))hash=Math.imul(hash^c.charCodeAt(0),16777619);const h=(hash>>>0)%360,s=.68,l=.58,a=s*Math.min(l,1-l),f=n=>{const k=(n+h/30)%12;return Math.round(255*(l-a*Math.max(-1,Math.min(k-3,9-k,1)))).toString(16).padStart(2,'0');};return '#'+f(0)+f(8)+f(4);};
export function stateHistory(issue){
 const source=issue.analysisHistory||issue.timeline||[];
 return source.flatMap(e=>{const m=e.kind==='handling'?String(e.text||'').match(/^Status: (.+?) → (.+?)\. Priority: (.+?) → (.+?)\./):null;
 const v=m?{at:e.createdAt,beforeStatus:m[1],status:m[2],beforePriority:m[3],priority:m[4]}:e.kind==='edit'?{at:e.createdAt,beforeStatus:e.before?.status,status:e.after?.status,beforePriority:e.before?.priority,priority:e.after?.priority}:e;
 const at=timestamp(v.at);return Number.isFinite(at)?[{...v,at}]:[];}).sort((a,b)=>a.at-b.at);
}
export function priorityAt(entry,time){let p=entry.history.find(h=>severityOrder.includes(h.beforePriority))?.beforePriority||entry.priority;for(const h of entry.history){if(h.at>time)break;if(severityOrder.includes(h.priority))p=h.priority;}return p;}

// Merge each ticket's intervals before sweeping: multiple reports must never
// inflate its simultaneous contribution. End events precede starts at a boundary.
export function incidentLoad(issues,options={}){
 const {start,end,now=Date.now(),continuePoints=true,department='All',issueType='All',severity='All'}=options;
 const filtered=issues.filter(i=>(department==='All'||(i.departmentId||'__none')===department)&&(issueType==='All'||(i.issueTypeId||'__none')===issueType)&&(severity==='All'||(severityOrder.includes(i.priority)?i.priority:'Unclassified')===severity));
 const {buckets}=incidentSeries([],{...options,frequency:'all'}),events=new Map(),entries=[],candidates=[],seen=new Set();let missing=0;
 const event=time=>{if(!events.has(time))events.set(time,{add:[],remove:[]});return events.get(time);};event(Number(start));event(Number(end));
 for(const [index,issue]of filtered.entries()){
  const id=issue.id??index;if(seen.has(id))continue;seen.add(id);
  const history=stateHistory(issue);
  const valid=(Array.isArray(issue.occurrences)?issue.occurrences:[]).flatMap(o=>{
   if(!o||!['point','range'].includes(o.kind)||!o.start||(o.kind==='range'&&!o.end))return [];
   const from=timestamp(o.start),actualEnd=o.kind==='range'?timestamp(o.end):from;
   if(!Number.isFinite(from)||!Number.isFinite(actualEnd)||actualEnd<from)return [];
   if(o.kind==='range'||!continuePoints)return [{start:from,end:actualEnd,kind:o.kind,reportedEnd:actualEnd,completedAt:o.kind==='range'?actualEnd:null}];
   const closed=status=>['Resolved','Closed'].includes(status),resolved=timestamp(issue.resolvedAt),periods=[];
   let opened=from;
   for(const h of history){if(h.at<from||h.at>now||!h.status)continue;
    if(closed(h.status)&&opened!==null){periods.push({start:opened,end:h.at,completedAt:h.at,column:opened===from});opened=null;}
    else if(!closed(h.status)&&closed(h.beforeStatus)&&opened===null)opened=h.at;
   }
   if(opened!==null){const completedAt=closed(issue.status)&&Number.isFinite(resolved)&&resolved>=opened?resolved:null;periods.push({start:opened,end:Math.max(opened,Math.min(now,completedAt??now)),completedAt,column:opened===from});}
   return periods.map(p=>({...p,kind:o.kind,reportedEnd:actualEnd}));
  });
  if(!valid.length){missing++;continue;}
  candidates.push({id,issue,priority:severityOrder.includes(issue.priority)?issue.priority:'Unclassified',history,reported:valid});
  const visible=valid.filter(r=>r.start<end&&(r.end>=start));if(!visible.length)continue;
  const priority=severityOrder.includes(issue.priority)?issue.priority:'Unclassified';
  const ranges=visible.map(r=>({start:Math.max(Number(start),r.start),end:Math.min(Number(end),r.end===r.start?r.end+1:r.end)})).filter(r=>r.start<r.end).sort((a,b)=>a.start-b.start);
  const merged=[];for(const r of ranges){const last=merged.at(-1);if(last&&r.start<=last.end)last.end=Math.max(last.end,r.end);else merged.push({...r});}
  if(!merged.length)continue;
  const entry={id,issue,priority,history,ranges:merged,reported:visible};entries.push(entry);
  for(const r of merged){event(r.start).add.push(entry);event(r.end).remove.push(entry);}
 }
 const active=new Map(),segments=[],times=[...events.keys()].sort((a,b)=>a-b);let peak=0;
 for(let k=0;k<times.length-1;k++){
  const at=times[k],change=events.get(at);for(const e of change.remove)active.delete(e.id);for(const e of change.add)active.set(e.id,e);
  const counts=Object.fromEntries(severityOrder.map(p=>[p,0]));for(const e of active.values())counts[e.priority]++;
  const count=active.size;peak=Math.max(peak,count);segments.push({start:at,end:times[k+1],count,counts});
 }
 let cursor=0;
 for(const b of buckets){
  while(cursor<segments.length&&segments[cursor].end<=b.start)cursor++;
  b.count=0;b.starts=0;b.startCounts=Object.fromEntries(severityOrder.map(p=>[p,0]));b.tickets=[];b.counts=Object.fromEntries(severityOrder.map(p=>[p,0]));
  for(let j=cursor;j<segments.length&&segments[j].start<b.end;j++)if(segments[j].count>b.count){b.count=segments[j].count;b.counts=segments[j].counts;}
  for(const e of entries){if(e.ranges.some(r=>r.start<b.end&&r.end>b.start))b.tickets.push(e.issue);if(e.reported.some(r=>r.start>=b.start&&r.start<b.end)){b.starts++;b.startCounts[e.priority]++;}}
  b.matches=options.frequency==='high'?b.count>=Number(options.threshold??3):options.frequency==='low'?b.count<=Number(options.threshold??3):true;
 }
 return {segments,buckets,entries,candidates,peak,missing,frequency:options.frequency,frequencyThreshold:Number(options.threshold??3),total:entries.length,ranked:buckets.filter(b=>b.matches).sort((a,b)=>(options.frequency==='low'?a.count-b.count:b.count-a.count)||a.start-b.start)};
}

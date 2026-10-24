const HOUR=3600000,DAY=24*HOUR,OFFSET=7*HOUR;
export function incidentSeries(issues,{start,end,unit='day',frequency='all',threshold=3}={}){
 start=Number(start);end=Number(end);const step=unit==='hour'?HOUR:DAY;
 if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end)throw new Error('Choose a valid incident time range.');
 const first=Math.floor((start+OFFSET)/step)*step-OFFSET,length=Math.ceil((end-first)/step);
 if(length>744)throw new Error('Choose a shorter time range or group by day.');
 if(!Number.isInteger(Number(threshold))||Number(threshold)<0)throw new Error('Enter a non-negative ticket threshold.');
 const buckets=Array.from({length},(_,i)=>({start:Math.max(start,first+i*step),end:Math.min(end,first+(i+1)*step),count:0,tickets:[]}));
 let missing=0,total=0;const seen=new Set();
 for(const [index,issue]of issues.entries()){
  const id=issue.id??index;if(seen.has(id))continue;seen.add(id);
  const ranges=(Array.isArray(issue.occurrences)?issue.occurrences:[]).flatMap(o=>{
   if(!o||!['point','range'].includes(o.kind)||!o.start||(o.kind==='range'&&!o.end))return [];
   const from=Date.parse(o.start),to=o.kind==='range'&&o.end?Date.parse(o.end):from;
   return Number.isFinite(from)&&Number.isFinite(to)&&to>=from?[{from,to}]:[];
  });
  if(!ranges.length){missing++;continue;}
  let included=false;
  for(const bucket of buckets)if(ranges.some(r=>r.from===r.to?r.from>=bucket.start&&r.from<bucket.end:r.from<bucket.end&&r.to>bucket.start)){
   bucket.count++;bucket.tickets.push(issue);included=true;
  }
  if(included)total++;
 }
 for(const b of buckets)b.matches=frequency==='high'?b.count>=Number(threshold):frequency==='low'?b.count<=Number(threshold):true;
 const ranked=buckets.filter(b=>b.matches).sort((a,b)=>(frequency==='low'?a.count-b.count:b.count-a.count)||a.start-b.start);
 return {buckets,ranked,missing,total};
}
export function vietnamInput(value){return new Date(value+OFFSET).toISOString().slice(0,16);}
export function vietnamTime(value){return Date.parse(value.length===16?value+':00+07:00':value+'+07:00');}

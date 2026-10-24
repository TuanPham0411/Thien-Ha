import {test} from 'node:test';
import assert from 'node:assert/strict';
import {incidentLoad,priorityAt,priorityHeight,departmentColor} from '../mes/site/incident-load.js';
const start=Date.parse('2026-10-20T17:00:00Z'),hour=3600000,end=start+4*hour;
const iso=n=>new Date(start+n*hour).toISOString();
const issue=(id,priority,occurrences,extra={})=>({id,priority,occurrences,...extra});
const range=(a,b)=>({kind:'range',start:iso(a),end:iso(b)}),point=a=>({kind:'point',start:iso(a)});
test('exact overlap uses distinct tickets, severity layers sum to the total, and ranges stop at their end',()=>{
 const result=incidentLoad([issue('a','Critical',[range(0,2),range(.5,1.5)]),issue('b','High',[range(1,3)]),issue('c','Low',[range(2,4)])],{start,end,now:end,unit:'hour'});
 assert.equal(result.total,3);assert.equal(result.peak,2);assert.deepEqual(result.buckets.map(b=>b.count),[1,2,2,1]);
 for(const s of result.segments)assert.equal(Object.values(s.counts).reduce((a,b)=>a+b,0),s.count);
 const after=result.segments.find(s=>s.start===start+2*hour);assert.equal(after.counts.Critical,0);assert.equal(after.counts.High,1);assert.equal(after.counts.Low,1);
});
test('moments without a recorded completion continue to now, with an explicit moment-only view',()=>{
 const issues=[issue('a','Medium',[point(-1)],{status:'Closed'}),issue('b','High',[point(1)])];
 const result=incidentLoad(issues,{start,end,now:start+3*hour,unit:'hour'});assert.deepEqual(result.buckets.map(b=>b.count),[1,2,2,0]);assert.equal(result.entries[0].ranges[0].start,start);assert.equal(result.entries[0].ranges[0].end,start+3*hour);
 const moments=incidentLoad(issues,{start,end,now:end,unit:'hour',continuePoints:false});assert.equal(moments.total,1);assert.deepEqual(moments.buckets.map(b=>b.count),[0,1,0,0]);
});
test('non-overlapping incidents in one bucket do not inflate concurrency; start counts remain distinct',()=>{
 const result=incidentLoad([issue('a','High',[range(.1,.2)]),issue('b','High',[range(.3,.4)])],{start,end,now:end,unit:'hour',frequency:'high',threshold:2});
 assert.equal(result.peak,1);assert.equal(result.buckets[0].count,1);assert.equal(result.buckets[0].starts,2);assert.equal(result.ranked.length,0);
});
test('type, department and severity filters combine; invalid/missing incident times never fall back to createdAt',()=>{
 const issues=[issue('a','Critical',[range(0,1)],{departmentId:'d1',issueTypeId:'t1'}),issue('b','High',[range(0,1)],{departmentId:'d1',issueTypeId:'t2'}),issue('bad','Critical',[{kind:'range',start:iso(1)}],{departmentId:'d1',issueTypeId:'t1',createdAt:start}),issue('missing','Low',[],{createdAt:start})];
 const result=incidentLoad(issues,{start,end,now:end,unit:'hour',department:'d1',issueType:'t1',severity:'Critical'});assert.equal(result.total,1);assert.equal(result.missing,1);assert.equal(result.entries[0].id,'a');
 const quiet=incidentLoad(issues,{start,end,now:end,unit:'hour',frequency:'low',threshold:0});assert.equal(quiet.ranked.length,3);assert.equal(quiet.missing,2);
});
test('simultaneous end/start events do not create false peaks, and clipping preserves carried-over intervals',()=>{
 const result=incidentLoad([issue('a','Low',[range(-2,1)]),issue('b','Unrecognized',[range(1,5)]),issue('b','High',[range(0,4)])],{start,end,now:end,unit:'hour'});
 assert.equal(result.peak,1);assert.equal(result.total,2);assert.deepEqual(result.buckets.map(b=>b.count),[1,1,1,1]);assert.equal(result.buckets[1].counts.Unclassified,1);assert.equal(result.entries[1].ranges[0].end,end);
});
test('completion stops a reported moment; priority changes retain the original column height',()=>{
 const item=issue('a','Low',[point(0)],{status:'Closed',resolvedAt:start+3*hour,analysisHistory:[{at:start+hour,beforePriority:'Critical',priority:'High',beforeStatus:'New',status:'In progress'},{at:start+2*hour,beforePriority:'High',priority:'Low',beforeStatus:'In progress',status:'In progress'},{at:start+3*hour,beforePriority:'Low',priority:'Low',beforeStatus:'In progress',status:'Closed'}]});
 const result=incidentLoad([item],{start,end,now:end,unit:'hour'}),entry=result.entries[0];
 assert.deepEqual(result.buckets.map(b=>b.count),[1,1,1,0]);assert.equal(entry.reported[0].completedAt,start+3*hour);
 assert.equal(priorityAt(entry,start), 'Critical');assert.equal(priorityAt(entry,start+hour),'High');assert.equal(priorityAt(entry,start+2*hour),'Low');assert.equal(priorityHeight(priorityAt(entry,start)),8);
});
test('reopened ticket resumes after completion without another start column',()=>{
 const result=incidentLoad([issue('a','High',[point(0)],{status:'In progress',analysisHistory:[{at:start+hour,beforeStatus:'New',status:'Closed'},{at:start+2*hour,beforeStatus:'Closed',status:'In progress'}]})],{start,end,now:end,unit:'hour'});
 assert.deepEqual(result.buckets.map(b=>b.count),[1,0,1,1]);assert.equal(result.entries[0].reported[1].column,false);
});
test('department colors remain stable across filtering and priorities use four explicit tiers',()=>{
 assert.equal(departmentColor('d1'),departmentColor('d1'));assert.notEqual(departmentColor('d1'),departmentColor('d2'));
 assert.deepEqual(['Low','Medium','High','Critical'].map(priorityHeight),[2,4,6,8]);
});

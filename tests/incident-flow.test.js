import {test} from 'node:test';
import assert from 'node:assert/strict';
import {incidentLoad} from '../mes/site/incident-load.js';
import {incidentFlow} from '../mes/site/incident-flow.js';
const start=Date.parse('2026-10-20T17:00:00Z'),hour=3600000,at=h=>start+h*hour,end=at(24),point=h=>({kind:'point',start:new Date(at(h)).toISOString()});
const run=(issues,extra={})=>incidentFlow(incidentLoad(issues,{start,end,now:end,unit:'hour',...extra}),{start,end,now:end});
const ticket=(id,created,extra={})=>({id,priority:'Medium',status:'New',departmentId:id,createdAt:at(created),occurrences:[point(created-2)],...extra});
test('multiple incident reports create one ticket column, and each new ticket snapshots every existing ticket once',()=>{
 const result=run([ticket('a',4,{occurrences:[point(1),point(2),point(2)]}),ticket('b',8)]);
 assert.deepEqual(result.flow.columns.map(c=>[c.entry.id,c.time,c.reason]),[['a',at(4),'created'],['a',at(8),'snapshot'],['b',at(8),'created']]);
 assert.equal(result.flow.columns.filter(c=>c.entry.id==='a'&&c.reason==='created').length,1);
 const line=result.flow.line;assert.equal(line[0].count,0);assert.ok(!line.some(p=>p.time===at(1)));assert.equal(line.filter(p=>p.time===at(4)).at(-1).count,1);assert.equal(line.filter(p=>p.time===at(8)).at(-1).count,2);assert.equal(result.entries[0].cycles[0].incidentStart,at(1));assert.equal(result.entries[0].ranges[0].start,at(4));
 assert.ok(line.every(p=>Number.isInteger(p.count)));for(let i=1;i<line.length;i++)assert.ok(line[i].time===line[i-1].time||line[i].count===line[i-1].count,'Count changes vertically at lifecycle events, never as reporting-delay ramps');
});
test('Resolved stops active progression; Closed is a separate recorded milestone',()=>{
 const result=run([ticket('a',4,{status:'Closed',resolvedAt:at(12),analysisHistory:[{at:at(12),beforeStatus:'New',status:'Resolved',beforePriority:'Medium',priority:'Medium'},{at:at(18),beforeStatus:'Resolved',status:'Closed',beforePriority:'Medium',priority:'Medium'}]})]);
 const cycle=result.flow.tickets[0].cycles[0];assert.equal(cycle.activeEnd,at(12));assert.equal(cycle.resolvedAt,at(12));assert.equal(cycle.closedAt,at(18));assert.equal(result.flow.statusAt(result.entries[0],at(16)),'Resolved');assert.equal(result.flow.statusAt(result.entries[0],at(19)),'Closed');
 assert.deepEqual(result.flow.columns.map(c=>c.reason),['created','resolved']);assert.equal(result.segments.find(s=>s.start===at(12)).count,0);
});
test('a resolved ticket remains visible before closure but has no invented Closed timestamp',()=>{
 const result=run([ticket('a',4,{status:'Resolved',resolvedAt:at(8)})]);assert.equal(result.flow.tickets[0].cycles[0].closedAt,null);
 const shifted=incidentFlow(incidentLoad([ticket('a',4,{status:'Resolved',resolvedAt:at(8)})],{start:at(12),end,now:end,unit:'hour'}),{start:at(12),end,now:end});assert.equal(shifted.entries.length,1);assert.equal(shifted.peak,0);
});
test('new-ticket snapshots exclude Closed tickets and deduplicate simultaneous creation/resolution',()=>{
 const result=run([ticket('a',2,{status:'Closed',analysisHistory:[{at:at(6),beforeStatus:'New',status:'Closed'}]}),ticket('b',10),ticket('c',10,{status:'Resolved',resolvedAt:at(10)})]);
 assert.ok(!result.flow.columns.some(c=>c.time===at(10)&&c.entry.id==='a'));assert.equal(result.flow.columns.filter(c=>c.time===at(10)&&c.entry.id==='c').length,1);assert.equal(result.flow.columns.find(c=>c.entry.id==='c').reason,'resolved');
});
test('priority history changes snapshot height without changing the creation column',()=>{
 const result=run([ticket('a',4,{priority:'Low',analysisHistory:[{at:at(6),beforePriority:'Medium',priority:'Critical'},{at:at(9),beforePriority:'Critical',priority:'Low'}]}),ticket('b',8)]);
 assert.equal(result.flow.columns.find(c=>c.entry.id==='a'&&c.time===at(4)).priority,'Medium');assert.equal(result.flow.columns.find(c=>c.entry.id==='a'&&c.time===at(8)).priority,'Critical');
});
test('reopening starts a new active cycle without manufacturing another ticket creation',()=>{
 const result=run([ticket('a',2,{status:'In progress',analysisHistory:[{at:at(6),beforeStatus:'New',status:'Resolved'},{at:at(9),beforeStatus:'Resolved',status:'Closed'},{at:at(12),beforeStatus:'Closed',status:'In progress'}]})]);
 assert.equal(result.flow.tickets[0].cycles.length,2);assert.equal(result.flow.columns.filter(c=>c.reason==='created').length,1);assert.equal(result.segments.find(s=>s.start===at(12)).count,1);
});
test('frequency filters use actual concurrent ticket totals after lifecycle projection',()=>{
 const result=run([ticket('a',4),ticket('b',8)],{frequency:'high',threshold:2});assert.ok(result.ranked.length>0);assert.ok(result.ranked.every(b=>b.count>=2));
});
test('open tickets keep their count at the current-time edge instead of dropping to zero',()=>{
 const result=run([ticket('a',4),ticket('b',8)]);assert.equal(result.flow.line.at(-1).time,end);assert.equal(result.flow.line.at(-1).count,2);
});
test('a range extending into the future never draws a predicted count or false decline',()=>{
 const now=at(12),result=incidentFlow(incidentLoad([ticket('a',4)],{start,end,now,unit:'hour'}),{start,end,now});
 assert.equal(result.flow.line.at(-1).time,now);assert.equal(result.flow.line.at(-1).count,1);assert.ok(result.flow.line.every(p=>p.time<=now));
});

test('visible count runs skip zero intervals and never connect separate ticket bursts',()=>{
 const result=run([ticket('a',4,{status:'Resolved',resolvedAt:at(8)}),ticket('b',14,{status:'Resolved',resolvedAt:at(18)})]);
 assert.equal(result.flow.lineRuns.length,2);
 assert.deepEqual(result.flow.lineRuns.map(run=>[run[0].time,run.at(-1).time]),[[at(4),at(8)],[at(14),at(18)]]);
 assert.ok(result.flow.lineRuns.flat().every(point=>point.count>0));
 const past=incidentFlow(incidentLoad([ticket('a',4,{status:'Resolved',resolvedAt:at(8)})],{start:at(12),end,now:end,unit:'hour'}),{start:at(12),end,now:end});
 assert.deepEqual(past.flow.lineRuns,[]);
});

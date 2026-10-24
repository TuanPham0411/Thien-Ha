import {test} from 'node:test';
import assert from 'node:assert/strict';
import {incidentSeries,vietnamInput,vietnamTime} from '../mes/site/incident-analytics.js';
const start=Date.parse('2026-10-20T17:00:00Z'),end=start+86400000;
test('incident timeline uses reported times, counts closed records once per bucket and keeps missing times separate',()=>{
 const issues=[{id:'a',status:'Closed',createdAt:end+1000,occurrences:[{kind:'point',start:new Date(start).toISOString()},{kind:'range',start:new Date(start).toISOString(),end:new Date(start+3600000).toISOString()}]},{id:'b',createdAt:start},{id:'bad',occurrences:[{kind:'range',start:'bad',end:'bad'}]}];
 const result=incidentSeries(issues,{start,end,unit:'hour'});assert.equal(result.total,1);assert.equal(result.missing,2);assert.equal(result.buckets[0].count,1);assert.equal(result.buckets[1].count,0);assert.equal(result.buckets.length,24);
});
test('incident buckets follow Vietnam midnight and clip ranges without counting boundary twice',()=>{
 const result=incidentSeries([{id:'a',occurrences:[{kind:'range',start:new Date(start-1000).toISOString(),end:new Date(start+86400000).toISOString()}]},{id:'b',occurrences:[{kind:'point',start:new Date(end).toISOString()}]}],{start,end:end+86400000,unit:'day'});
 assert.deepEqual(result.buckets.map(b=>b.count),[1,1]);assert.equal(result.total,2);assert.equal(result.buckets[0].start,start);assert.equal(vietnamInput(start),'2026-10-21T00:00');assert.equal(vietnamTime('2026-10-21T00:00'),start);
});
test('frequency filters include quiet windows, preserve chronology and reject unbounded ranges',()=>{
 const result=incidentSeries([{occurrences:[{kind:'point',start:new Date(start).toISOString()}]}],{start,end,unit:'hour',frequency:'low',threshold:0});assert.equal(result.ranked.length,23);assert.equal(result.buckets[0].matches,false);assert.equal(result.buckets[1].matches,true);assert.ok(result.buckets.every((b,i)=>!i||b.start>result.buckets[i-1].start));assert.throws(()=>incidentSeries([],{start,end:start+4000*3600000,unit:'hour'}),/shorter/);assert.throws(()=>incidentSeries([],{start,end:start}),/valid/);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {countScale} from '../mes/site/incident-chart.js';
import {incidentLoad,severityOrder} from '../mes/site/incident-load.js';
test('ticket axes use actual integer counts and retain a useful scale for sparse datasets',()=>{
 for(const count of [0,1,2,3,4,17,125,1200]){const scale=countScale(count);assert.ok(scale.max>=count);assert.ok(scale.max>=3);assert.equal(scale.ticks[0],0);assert.equal(scale.ticks.at(-1),scale.max);assert.ok(scale.ticks.every(Number.isInteger));assert.ok(scale.ticks.every((n,i)=>!i||n>scale.ticks[i-1]));}
 assert.deepEqual(countScale(1),{max:3,ticks:[0,1,2,3]});
});
test('stacked start columns count each ticket once per interval and preserve severity totals',()=>{
 const start=Date.parse('2026-10-20T17:00:00Z'),end=start+2*3600000,iso=value=>new Date(start+value).toISOString();
 const result=incidentLoad([{id:'a',priority:'Critical',occurrences:[{kind:'point',start:iso(100)},{kind:'range',start:iso(200),end:iso(300)}]},{id:'b',priority:'High',occurrences:[{kind:'range',start:iso(500),end:iso(700)}]},{id:'old',priority:'Low',occurrences:[{kind:'point',start:iso(-3600000)}]}],{start,end,now:end,unit:'hour'});
 assert.equal(result.buckets[0].starts,2);assert.equal(result.buckets[0].startCounts.Critical,1);assert.equal(result.buckets[0].startCounts.High,1);assert.equal(result.buckets[0].startCounts.Low,0);
 for(const b of result.buckets)assert.equal(severityOrder.reduce((sum,p)=>sum+b.startCounts[p],0),b.starts);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {population,atConfidence,forTargetRate,selectThreshold} from '../thresholds.mjs';

function raw(scores){return {times:[0],xy:[scores.map(()=>[10,20])],scores:[[...scores]]};}
const sequence=Array.from({length:17},(_,i)=>(i+1)/20);
test('joint denominator includes every joint, including missing points',()=>{
  const r=raw(sequence);r.xy[0][0]=[null,null];r.scores[0][1]=0;
  const p=population(r),result=atConfidence(p,.001);
  assert.equal(result.total_keypoints,17);assert.equal(result.passed_keypoints,15);assert.equal(result.achieved_rate,15/17*100);
});
test('confidence mode includes equality and calculates automatic rate',()=>{
  const r=selectThreshold(population(raw(sequence)),{mode:'confidence',confidence:.5});
  assert.equal(r.passed_keypoints,8);assert.equal(r.requested_rate,null);assert.equal(r.effective_confidence,.5);
});
test('rate mode finds exact attainable joint count',()=>{
  const r=forTargetRate(population(raw(sequence)),100*8/17);
  assert.equal(r.passed_keypoints,8);assert.equal(r.limited_by_ties_or_bounds,false);
});
test('nearest attainable rate is used and ties prefer a higher threshold',()=>{
  const r=forTargetRate(population(raw(sequence)),50);
  assert.equal(r.passed_keypoints,8);assert.equal(r.limited_by_ties_or_bounds,true);
});
test('equal scores cannot be arbitrarily split to fake a target rate',()=>{
  const r=forTargetRate(population(raw(Array(17).fill(.8))),80);
  assert.equal(r.achieved_rate,100);assert.equal(r.effective_confidence,.8);assert.equal(r.limited_by_ties_or_bounds,true);
});
test('zero and one hundred percent targets respect valid scores',()=>{
  const p=population(raw(sequence));assert.equal(forTargetRate(p,0).achieved_rate,0);assert.equal(forTargetRate(p,100).achieved_rate,100);
});
test('invalid joints remain in denominator at a one hundred percent target',()=>{
  const r=raw(sequence);r.xy[0][3]=[null,20];
  assert.equal(forTargetRate(population(r),100).passed_keypoints,16);
  assert.equal(forTargetRate(population(r),100).limited_by_ties_or_bounds,true);
});
test('no valid joints yields zero observed rate without inventing coordinates',()=>{
  const r=raw(Array(17).fill(0));assert.equal(forTargetRate(population(r),90).achieved_rate,0);
});
test('empty input yields an undefined rate and invalid inputs fail clearly',()=>{
  const p=population({times:[],xy:[],scores:[]});assert.equal(atConfidence(p,.4).achieved_rate,null);
  assert.throws(()=>forTargetRate(p,101));assert.throws(()=>atConfidence(p,0));assert.throws(()=>population(raw([.5])));
});
test('automatic threshold achieves the closest count among every candidate',()=>{
  const p=population(raw([.1,.2,.2,.2,.3,.3,.4,.5,.6,.7,.8,.9,.9,.9,.95,.96,.97]));
  for(let target=0;target<=100;target++){
    const best=forTargetRate(p,target);
    for(const t of [.001,1,...p.scores,...p.scores.map(v=>v+1e-8)])if(t<=1)assert.ok(Math.abs(best.achieved_rate-target)<=Math.abs(atConfidence(p,t).achieved_rate-target)+1e-8);
  }
});

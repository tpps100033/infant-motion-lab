import test from 'node:test';
import assert from 'node:assert/strict';
import {syntheticDemo,analyzeTracks,derivatives,config} from '../metrics.mjs';
import {addMonths,susScore,comparisonKey,researchQuality,followup} from '../research-core.mjs';
import {analyzeAudio} from '../audio.mjs';

test('constant velocity has analytic speed, zero acceleration and jerk',()=>{
  const t=Array.from({length:120},(_,i)=>i/30),p=t.map(x=>[2*x,3*x]);const d=derivatives(t,p,config());
  const v=d.speed.filter(Number.isFinite),a=d.acceleration.filter(Number.isFinite);
  assert.ok(v.every(x=>Math.abs(x-Math.sqrt(13))<1e-10));assert.ok(a.every(x=>x<1e-9));
});
test('expanded metrics contain dynamics, projected angles and coordination',()=>{
  const r=syntheticDemo();assert.equal(r.summary.schema_version,'2.0');
  const wrist=r.summary.features.find(f=>f.joint==='left_wrist');assert.ok(wrist.speed_p95>=wrist.speed_median);assert.ok(wrist.path_length>0);assert.ok(wrist.acceleration_rms>0);assert.ok(wrist.dimensionless_squared_jerk>0);
  assert.equal(r.summary.angles.length,4);assert.equal(r.summary.coordination.length,6);assert.ok(r.summary.angles.every(r=>r.angle_mean_deg>=0&&r.angle_mean_deg<=180));
});
test('stationary motion leaves undefined normalized smoothness and coordination empty',()=>{
  const r=syntheticDemo(),xy=r.raw.times.map(()=>r.raw.xy[0]);const out=analyzeTracks(r.raw.times,xy,r.raw.scores);
  assert.ok(out.summary.features.every(f=>f.dimensionless_squared_jerk===null));assert.ok(out.summary.coordination.every(c=>c.speed_correlation===null));
});
test('long missing gaps are not bridged for displacement and straightness',()=>{
  const r=syntheticDemo();for(let i=60;i<80;i++)r.raw.scores[i][9]=0;
  const out=analyzeTracks(r.raw.times,r.raw.xy,r.raw.scores,{min_coverage:.5});const wrist=out.summary.features.find(f=>f.joint==='left_wrist');
  assert.equal(wrist.displacement,null);assert.equal(wrist.straightness,null);assert.equal(wrist.dimensionless_squared_jerk,null);
});
test('calendar month scheduling and research qualification',()=>{
  assert.equal(addMonths('2028-01-31',1),'2028-02-29');assert.equal(susScore([5,1,5,1,5,1,5,1,5,1]),100);
  assert.equal(researchQuality({usable_video_seconds:11}).ready,false);
  assert.equal(followup({enrolled_on:'2026-01-01',age_months:6}).next_mcdi,'2026-03-01');
  assert.equal(followup({enrolled_on:'2026-01-01',age_months:6},[{visited_on:'2026-03-01',age_months:8}]).next_mcdi,'2026-03-01');
  assert.notEqual(comparisonKey({config:{confidence:.2}}),comparisonKey({config:{confidence:.4}}));
});
test('audio silence does not invent vocalizations or pitch',()=>{
  const r=analyzeAudio(new Float32Array(16000),16000);assert.equal(r.summary.event_count,0);assert.equal(r.summary.pitch_samples,0);
});
test('audio periodic signal estimates known pitch in an active region',()=>{
  const s=new Float32Array(48000);for(let i=16000;i<32000;i++)s[i]=.3*Math.sin(2*Math.PI*400*i/16000);
  const r=analyzeAudio(s,16000);assert.ok(r.summary.event_count>=1);assert.ok(Math.abs(r.summary.pitch_median_hz-400)<20);assert.equal(r.summary.reviewed_infant_events,0);
});

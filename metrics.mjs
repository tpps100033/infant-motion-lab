// Measurement definitions match infant_motion/core.py v1.0. Pure JS, no server.
export const JOINTS = ['nose','left_eye','right_eye','left_ear','right_ear','left_shoulder','right_shoulder','left_elbow','right_elbow','left_wrist','right_wrist','left_hip','right_hip','left_knee','right_knee','left_ankle','right_ankle'];
export const EDGES = [[5,6],[5,7],[7,9],[6,8],[8,10],[5,11],[6,12],[11,12],[11,13],[13,15],[12,14],[14,16]];
const PAIRS = [[7,8],[9,10],[13,14],[15,16]];
const finitePoint = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const nan = () => [NaN,NaN];
export const mean = a => a.length ? a.reduce((s,v)=>s+v,0)/a.length : NaN;
const std = a => { const m=mean(a); return Math.sqrt(mean(a.map(v=>(v-m)**2))); };
export function quantile(a,q) {
  if (!a.length) return NaN;
  const b=[...a].sort((x,y)=>x-y), k=(b.length-1)*q, lo=Math.floor(k), f=k-lo;
  return b[lo]*(1-f)+b[Math.min(lo+1,b.length-1)]*f;
}
export function runs(mask) {
  const out=[]; let start=null;
  for(let i=0;i<=mask.length;i++) {
    if(mask[i] && start===null) start=i;
    if(!mask[i] && start!==null) {out.push([start,i]);start=null;}
  }
  return out;
}
function interp(query,x,y) {
  let i=0;
  return query.map(t=>{
    while(i<x.length-2 && t>x[i+1]) i++;
    if(t<=x[0]) return y[0];
    if(t>=x.at(-1)) return y.at(-1);
    const f=(t-x[i])/(x[i+1]-x[i]); return y[i]*(1-f)+y[i+1]*f;
  });
}
function solve(a,b) {
  const n=b.length, m=a.map((r,i)=>[...r,b[i]]);
  for(let c=0;c<n;c++) {
    let pivot=c;for(let j=c+1;j<n;j++) if(Math.abs(m[j][c])>Math.abs(m[pivot][c])) pivot=j;
    [m[c],m[pivot]]=[m[pivot],m[c]];
    if(Math.abs(m[c][c])<1e-12) throw Error('平滑矩陣無法求解');
    const scale=m[c][c];for(let k=c;k<=n;k++)m[c][k]/=scale;
    for(let j=0;j<n;j++)if(j!==c) {const f=m[j][c];for(let k=c;k<=n;k++)m[j][k]-=f*m[c][k];}
  }
  return m.map(r=>r[n]);
}
// Local cubic regression equals Savitzky-Golay mode='interp', including edges.
export function smooth(values,width) {
  const n=values.length, half=(width-1)/2, coefficientCache=new Map();
  return values.map((_,i)=>{
    const start=Math.max(0,Math.min(n-width,i-half)), offset=i-start;
    let weights=coefficientCache.get(offset);
    if(!weights) {
      const coordinates=Array.from({length:width},(_,k)=>(k-offset)/width);
      const normal=Array.from({length:4},(_,r)=>Array.from({length:4},(_,c)=>coordinates.reduce((s,x)=>s+x**(r+c),0)));
      const z=solve(normal,[1,0,0,0]);
      weights=coordinates.map(x=>z.reduce((s,v,k)=>s+v*x**k,0));
      coefficientCache.set(offset,weights);
    }
    return weights.reduce((s,v,k)=>s+v*values[start+k],0);
  });
}
export function config(input={}) {
  const c={confidence:.4,max_gap_s:.1,smooth_s:.3,window_s:10,min_coverage:.8,min_segment_s:.5,max_speed:20,...input};
  if(!Object.values(c).every(Number.isFinite) || c.confidence<0 || c.confidence>1 || c.min_coverage<0 || c.min_coverage>1 || c.window_s<=0 || c.min_segment_s<=0 || c.max_speed<=0 || c.max_gap_s<0 || c.smooth_s<0) throw Error('分析參數無效');
  return c;
}
export function validateTracks(t,xy,scores) {
  if(!Array.isArray(t)||t.length<2||t.some((v,i)=>!Number.isFinite(v)||(i>0&&v<=t[i-1])))throw Error('至少需要兩個遞增的有限時間戳');
  if(xy.length!==t.length||scores.length!==t.length||xy.some(p=>!Array.isArray(p)||p.length!==17||p.some(v=>!Array.isArray(v)||v.length!==2||v.some(x=>x!==null&&!Number.isFinite(x))))||scores.some(s=>!Array.isArray(s)||s.length!==17||s.some(v=>!Number.isFinite(v))))throw Error('資料必須為 COCO 17 點，座標可留 null，分數須為有限數值');
}
export function prepare(t,xy,scores,cfg) {
  validateTracks(t,xy,scores);
  const dt=quantile(t.slice(1).map((v,i)=>v-t[i]),.5), n=t.length;
  const breaks=t.map((v,i)=>i>0 && v-t[i-1]>Math.max(1.8*dt,cfg.max_gap_s));
  const observed=xy.map((p,i)=>p.map((v,j)=>finitePoint(v)&&scores[i][j]>=cfg.confidence));
  const clean=xy.map((p,i)=>p.map((v,j)=>observed[i][j]?[...v]:nan()));
  const filled=t.map(()=>Array(17).fill(false));
  for(let j=0;j<17;j++) {
    for(const [a,b] of runs(observed.map(r=>!r[j]))) {
      if(a===0||b===n)continue;
      if(t[b]-t[a-1]-dt<=cfg.max_gap_s+1e-9 && !breaks.slice(a,b+1).some(Boolean)) {
        for(let i=a;i<b;i++) {const f=(t[i]-t[a-1])/(t[b]-t[a-1]);clean[i][j]=[0,1].map(k=>clean[a-1][j][k]*(1-f)+clean[b][j][k]*f);filled[i][j]=true;}
      }
    }
    for(const [start,end] of runs(clean.map(p=>finitePoint(p[j])))) {
      const cuts=[start,...Array.from({length:end-start-1},(_,i)=>start+i+1).filter(i=>breaks[i]),end];
      for(let k=0;k<cuts.length-1;k++) {
        const a=cuts[k],b=cuts[k+1],n=b-a;
        if(n<5||cfg.smooth_s===0)continue;
        const step=(t[b-1]-t[a])/(n-1), grid=Array.from({length:n},(_,i)=>t[a]+i*step);
        // Python round uses ties-to-even. Ties occur rarely but are handled explicitly.
        const raw=cfg.smooth_s/step, floor=Math.floor(raw), rounded=raw-floor===.5?floor+(floor%2):Math.round(raw);
        const width=Math.min(Math.max(5,rounded|1),(n-1)|1);
        for(let axis=0;axis<2;axis++) {
          const uniform=interp(grid,t.slice(a,b),clean.slice(a,b).map(p=>p[j][axis]));
          const filtered=interp(t.slice(a,b),grid,smooth(uniform,width));
          for(let i=a;i<b;i++)clean[i][j][axis]=filtered[i-a];
        }
      }
    }
  }
  const shoulders=clean.map(p=>[0,1].map(k=>(p[5][k]+p[6][k])/2));
  const pelvis=clean.map(p=>[0,1].map(k=>(p[11][k]+p[12][k])/2));
  const trunk=pelvis.map((p,i)=>p.map((v,k)=>v-shoulders[i][k]));
  const lengths=trunk.map(v=>Math.hypot(...v)), anchor=lengths.map(v=>Number.isFinite(v)&&v>1);
  if(anchor.filter(Boolean).length<2)throw Error('肩膀或髖部有效點不足，請調整嬰幼兒範圍或信心門檻');
  const scale=quantile(lengths.filter((_,i)=>anchor[i]),.5);
  const body=clean.map((points,i)=>points.map(p=>{
    if(!anchor[i])return nan();
    const y=trunk[i].map(v=>v/lengths[i]),x=[y[1],-y[0]],d=p.map((v,k)=>v-pelvis[i][k]);
    return [(d[0]*x[0]+d[1]*x[1])/scale,(d[0]*y[0]+d[1]*y[1])/scale];
  }));
  return {times:t,clean_px:clean,body,observed,interpolated:filled,anchor_valid:anchor,breaks,scale_px:scale};
}
export function gradient(values,t) {
  const n=t.length, out=[];
  for(let i=0;i<n;i++) {
    let indices,weights;
    if(i===0) {const a=t[1]-t[0],b=t[2]-t[1];indices=[0,1,2];weights=[-(2*a+b)/(a*(a+b)),(a+b)/(a*b),-a/(b*(a+b))];}
    else if(i===n-1) {const a=t[n-2]-t[n-3],b=t[n-1]-t[n-2];indices=[n-3,n-2,n-1];weights=[b/(a*(a+b)),-(a+b)/(a*b),(2*b+a)/(b*(a+b))];}
    else {const a=t[i]-t[i-1],b=t[i+1]-t[i];indices=[i-1,i,i+1];weights=[-b/(a*(a+b)),(b-a)/(a*b),a/(b*(a+b))];}
    out.push([0,1].map(axis=>indices.reduce((s,j,k)=>s+values[j][axis]*weights[k],0)));
  }
  return out;
}
export function derivatives(t,points,cfg,breaks=[]) {
  const speed=Array(t.length).fill(NaN),jerk=t.map(nan),acceleration=Array(t.length).fill(NaN);
  for(const [start,end] of runs(points.map(finitePoint))) {
    const cuts=[start,...Array.from({length:end-start-1},(_,i)=>start+i+1).filter(i=>breaks[i]),end];
    for(let k=0;k<cuts.length-1;k++) {
      const a=cuts[k],b=cuts[k+1];if(b-a<9||t[b-1]-t[a]<cfg.min_segment_s)continue;
      const wt=t.slice(a,b),v=gradient(points.slice(a,b),wt),acc=gradient(v,wt),j=gradient(acc,wt);
      for(let i=a+3;i<b-3;i++) {speed[i]=Math.hypot(...v[i-a]);jerk[i]=j[i-a];acceleration[i]=Math.hypot(...acc[i-a]);}
    }
  }
  return {speed,jerk,acceleration};
}
function amplitude(p) {
  const q=p.filter(finitePoint);if(q.length<2)return NaN;
  return Math.hypot(...[0,1].map(k=>quantile(q.map(v=>v[k]),.95)-quantile(q.map(v=>v[k]),.05)));
}
function cleanJSON(value) {return JSON.parse(JSON.stringify(value));}
export function analyzeTracks(t,xy,scores,input={}) {
  const cfg=config(input),p=prepare(t,xy,scores,cfg),features=[],symmetry=[],coordination=[],angles=[];
  const dt=quantile(t.slice(1).map((v,i)=>v-t[i]),.5);
  for(let start=t[0];start<t.at(-1)+dt*.5;start+=cfg.window_s) {
    const ids=t.map((v,i)=>i).filter(i=>t[i]>=start-1e-9&&t[i]<start+cfg.window_s-1e-9);
    if(ids.length<2)continue;
    const wt=ids.map(i=>t[i]),wb=ids.map(i=>p.body[i]),speeds=[];
    for(let j=0;j<17;j++) {
      const q=wb.map(v=>v[j]),valid=q.filter(finitePoint),coverage=valid.length/wt.length;
      const {speed:v,jerk,acceleration}=derivatives(wt,q,cfg,ids.map(i=>p.breaks[i]));speeds.push(v);
      const vs=v.filter(Number.isFinite),outliers=vs.length?vs.filter(v=>v>cfg.max_speed).length/vs.length:null;
      const enough=coverage>=cfg.min_coverage&&vs.length>=3,ok=enough&&outliers===0;
      let metrics=Object.fromEntries(['speed_mean','speed_sd','speed_median','speed_p95','speed_peak','acceleration_rms','acceleration_peak','position_variability','variability_x','variability_y','amplitude','amplitude_x','amplitude_y','path_length','path_observed_s','path_mean_speed','displacement','straightness','jerk_rms','dimensionless_squared_jerk','derivative_duration_s'].map(k=>[k,null]));
      if(ok) {
        const m=[0,1].map(k=>mean(valid.map(v=>v[k])));
        metrics={speed_mean:mean(vs),speed_sd:std(vs),position_variability:Math.sqrt(mean(valid.map(v=>(v[0]-m[0])**2+(v[1]-m[1])**2))),amplitude:amplitude(q),jerk_rms:Math.sqrt(mean(jerk.filter(finitePoint).map(v=>v[0]**2+v[1]**2)))};
        const axisAmplitude=[0,1].map(k=>quantile(valid.map(v=>v[k]),.95)-quantile(valid.map(v=>v[k]),.05));
        let path=0,pathTime=0,jerkEnergy=0,derivativeTime=0,allAdjacent=true;
        for(let i=1;i<q.length;i++){
          const gap=p.breaks[ids[i]],step=wt[i]-wt[i-1];
          if(!gap&&finitePoint(q[i])&&finitePoint(q[i-1])){path+=Math.hypot(q[i][0]-q[i-1][0],q[i][1]-q[i-1][1]);pathTime+=step;}else allAdjacent=false;
          if(!gap&&finitePoint(jerk[i])&&finitePoint(jerk[i-1])){jerkEnergy+=step*(jerk[i][0]**2+jerk[i][1]**2+jerk[i-1][0]**2+jerk[i-1][1]**2)/2;derivativeTime+=step;}
        }
        const displacement=allAdjacent?Math.hypot(q.at(-1)[0]-q[0][0],q.at(-1)[1]-q[0][1]):null;
        const acc=acceleration.filter(Number.isFinite);
        // Dimensionless squared jerk uses only a single contiguous derivative interval.
        const derivativeIds=jerk.map((v,i)=>finitePoint(v)?i:-1).filter(i=>i>=0);
        const contiguous=derivativeIds.length>1&&derivativeIds.at(-1)-derivativeIds[0]+1===derivativeIds.length&&!ids.slice(derivativeIds[0]+1,derivativeIds.at(-1)+1).some(i=>p.breaks[i]);
        let derivativePath=0;
        if(contiguous)for(let i=derivativeIds[0]+1;i<=derivativeIds.at(-1);i++)derivativePath+=Math.hypot(q[i][0]-q[i-1][0],q[i][1]-q[i-1][1]);
        Object.assign(metrics,{speed_median:quantile(vs,.5),speed_p95:quantile(vs,.95),speed_peak:Math.max(...vs),acceleration_rms:Math.sqrt(mean(acc.map(v=>v*v))),acceleration_peak:Math.max(...acc),variability_x:std(valid.map(v=>v[0])),variability_y:std(valid.map(v=>v[1])),amplitude_x:axisAmplitude[0],amplitude_y:axisAmplitude[1],path_length:path,path_observed_s:pathTime,path_mean_speed:pathTime>0?path/pathTime:null,displacement,straightness:displacement!==null&&path>1e-4?displacement/path:null,derivative_duration_s:derivativeTime,dimensionless_squared_jerk:contiguous&&derivativePath>1e-4?derivativeTime**5*jerkEnergy/derivativePath**2:null});
      }
      features.push({window_start_s:start,window_end_s:wt.at(-1),joint:JOINTS[j],coverage,observed_fraction:mean(ids.map(i=>+p.observed[i][j])),interpolated_fraction:mean(ids.map(i=>+p.interpolated[i][j])),derivative_fraction:vs.length/wt.length,speed_outlier_fraction:outliers,status:ok?'ok':enough?'speed_outlier':'insufficient_coverage_or_duration',...metrics});
    }
    for(const [l,r] of PAIRS) {
      const both=wb.map((v,i)=>i).filter(i=>finitePoint(wb[i][l])&&finitePoint(wb[i][r]));
      const common=both.filter(i=>Number.isFinite(speeds[l][i])&&Number.isFinite(speeds[r][i]));
      const vl=common.map(i=>speeds[l][i]),vr=common.map(i=>speeds[r][i]);
      const ok=both.length/wt.length>=cfg.min_coverage&&common.length>=3&&!vl.some(v=>v>cfg.max_speed)&&!vr.some(v=>v>cfg.max_speed);
      const m={speed_asymmetry:null,amplitude_asymmetry:null,mirrored_distance_rms:null,speed_correlation:null};
      if(ok) {
        const ml=mean(vl),mr=mean(vr),la=amplitude(both.map(i=>wb[i][l])),ra=amplitude(both.map(i=>wb[i][r]));
        m.speed_asymmetry=ml+mr>1e-5?2*Math.abs(ml-mr)/(ml+mr):null;
        m.amplitude_asymmetry=la+ra>1e-5?2*Math.abs(la-ra)/(la+ra):null;
        m.mirrored_distance_rms=Math.sqrt(mean(both.map(i=>(wb[i][l][0]+wb[i][r][0])**2+(wb[i][l][1]-wb[i][r][1])**2)));
        if(std(vl)>1e-5&&std(vr)>1e-5)m.speed_correlation=mean(vl.map((v,i)=>(v-ml)*(vr[i]-mr)))/(std(vl)*std(vr));
      }
      symmetry.push({window_start_s:start,pair:`${JOINTS[l]}:${JOINTS[r]}`,paired_coverage:both.length/wt.length,status:ok?'ok':'insufficient_or_outlier',...m});
    }
    for(const [l,r,label] of [[9,15,'left_arm_leg'],[10,16,'right_arm_leg'],[9,16,'left_arm_right_leg'],[10,15,'right_arm_left_leg'],[9,10,'bilateral_wrists'],[15,16,'bilateral_ankles']]){
      const common=wt.map((_,i)=>i).filter(i=>Number.isFinite(speeds[l][i])&&Number.isFinite(speeds[r][i]));
      const a=common.map(i=>speeds[l][i]),b=common.map(i=>speeds[r][i]);
      const coverage=common.length/wt.length;
      const enough=coverage>=cfg.min_coverage&&a.length>=3&&!a.some(v=>v>cfg.max_speed)&&!b.some(v=>v>cfg.max_speed);
      const moving=enough&&std(a)>1e-5&&std(b)>1e-5;
      coordination.push({window_start_s:start,window_end_s:wt.at(-1),pair:label,joint_a:JOINTS[l],joint_b:JOINTS[r],paired_derivative_fraction:coverage,samples:a.length,speed_correlation:moving?Math.max(-1,Math.min(1,mean(a.map((v,i)=>(v-mean(a))*(b[i]-mean(b))))/(std(a)*std(b)))):null,status:moving?'ok':enough?'inactive':'insufficient_or_outlier'});
    }
    for(const [a,b,c,label] of [[5,7,9,'left_elbow'],[6,8,10,'right_elbow'],[11,13,15,'left_knee'],[12,14,16,'right_knee']]){
      const values=wb.map(points=>{
        if(![a,b,c].every(j=>finitePoint(points[j])))return NaN;
        const u=[0,1].map(k=>points[a][k]-points[b][k]),v=[0,1].map(k=>points[c][k]-points[b][k]),den=Math.hypot(...u)*Math.hypot(...v);
        return den>1e-8?Math.acos(Math.max(-1,Math.min(1,(u[0]*v[0]+u[1]*v[1])/den)))*180/Math.PI:NaN;
      }).filter(Number.isFinite),coverage=values.length/wt.length,ok=coverage>=cfg.min_coverage&&values.length>=3;
      angles.push({window_start_s:start,window_end_s:wt.at(-1),joint:label,coverage,angle_mean_deg:ok?mean(values):null,angle_sd_deg:ok?std(values):null,angle_p05_deg:ok?quantile(values,.05):null,angle_p95_deg:ok?quantile(values,.95):null,range_p90_deg:ok?quantile(values,.95)-quantile(values,.05):null,status:ok?'ok':'insufficient_coverage'});
    }
  }
  return cleanJSON({format:'infant-motion-web/v1',summary:{schema_version:'2.0',config:cfg,joint_order:JOINTS,units:{position:'median_torso_length',speed:'torso_length/s',acceleration:'torso_length/s^2',variability:'torso_length',jerk:'torso_length/s^3',dimensionless_squared_jerk:'dimensionless; integral over contiguous interior derivative interval',angles:'degrees; 2D projected',coordination:'Pearson speed correlation -1..1; null when inactive',asymmetry:'0..2; 0 = equal magnitude; null when inactive'},coordinate_frame:'pelvis origin, shoulder-to-pelvis vertical, constant median torso scale',frames:t.length,duration_s:t.at(-1)-t[0],scale_px:p.scale_px,anchor_coverage:mean(p.anchor_valid.map(Number)),features,symmetry,coordination,angles,interpretation:'Research measurements; no developmental diagnosis or normative score.'},raw:{times:t,xy,scores},processed:p});
}
export function syntheticDemo() {
  const times=Array.from({length:180},(_,i)=>i/30),base=[[0,-1.3],[-.1,-1.4],[.1,-1.4],[-.2,-1.3],[.2,-1.3],[-.3,-1],[.3,-1],[-.5,-.5],[.5,-.5],[-.6,0],[.6,0],[-.2,0],[.2,0],[-.2,.6],[.2,.6],[-.2,1.2],[.2,1.2]];
  const xy=times.map(t=>base.map((p,j)=>[(p[0]+(j===9?-.2:j===10?.2:j===15?-.12:j===16?.18:0)*Math.sin(2*Math.PI*.5*t))*100+320,(p[1]+(j===15||j===16?.12*Math.sin(2*Math.PI*t):0))*100+240]));
  const packet=analyzeTracks(times,xy,times.map(()=>Array(17).fill(.95)));
  packet.summary.inference={source_name:'合成運動示範（非受試者影片）',model:{weights:'synthetic_ground_truth'}};
  packet.demo=true;return packet;
}

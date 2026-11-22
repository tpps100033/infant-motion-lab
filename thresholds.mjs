// Joint judgement rate is a threshold pass rate, never ground-truth accuracy.
export const CONFIDENCE_MIN=.001;
export const CONFIDENCE_MAX=1;

export function population(raw){
  if(!raw||!Array.isArray(raw.times)||!Array.isArray(raw.xy)||!Array.isArray(raw.scores)||raw.xy.length!==raw.times.length||raw.scores.length!==raw.times.length)throw Error('判定率需要完整的原始關節座標與分數');
  const scores=[];
  for(let i=0;i<raw.times.length;i++){
    if(raw.xy[i]?.length!==17||raw.scores[i]?.length!==17)throw Error('判定率以每影格 17 個關節為分母');
    for(let j=0;j<17;j++){
      const p=raw.xy[i][j],s=raw.scores[i][j];
      if(Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Number.isFinite(s)&&s>0)scores.push(s);
    }
  }
  scores.sort((a,b)=>a-b);
  return {scores,total_keypoints:raw.times.length*17,valid_keypoints:scores.length};
}
function lowerBound(values,value){let lo=0,hi=values.length;while(lo<hi){const mid=(lo+hi)>>>1;if(values[mid]<value)lo=mid+1;else hi=mid;}return lo;}
export function atConfidence(data,confidence){
  if(!Number.isFinite(confidence)||confidence<CONFIDENCE_MIN||confidence>CONFIDENCE_MAX)throw Error('信心門檻需介於 0.001 與 1');
  const passed=data.scores.length-lowerBound(data.scores,confidence);
  return {effective_confidence:confidence,passed_keypoints:passed,total_keypoints:data.total_keypoints,valid_keypoints:data.valid_keypoints,achieved_rate:data.total_keypoints?100*passed/data.total_keypoints:null};
}
function nextUp(value){const view=new DataView(new ArrayBuffer(8));view.setFloat64(0,value);view.setBigUint64(0,view.getBigUint64(0)+1n);return view.getFloat64(0);}
export function forTargetRate(data,targetRate){
  if(!Number.isFinite(targetRate)||targetRate<0||targetRate>100)throw Error('目標判定率需介於 0% 與 100%');
  const candidates=new Set([CONFIDENCE_MIN,CONFIDENCE_MAX]);
  const wanted=data.scores.length-data.total_keypoints*targetRate/100;
  for(const index of [Math.floor(wanted),Math.ceil(wanted)]){
    const score=data.scores[Math.max(0,Math.min(data.scores.length-1,index))];
    if(Number.isFinite(score))for(const v of [score,nextUp(score)])candidates.add(Math.max(CONFIDENCE_MIN,Math.min(CONFIDENCE_MAX,v)));
  }
  let best=null;
  for(const threshold of candidates){
    const result=atConfidence(data,threshold),error=Math.abs((result.achieved_rate??0)-targetRate);
    if(!best||error<best.error-1e-10||Math.abs(error-best.error)<1e-10&&threshold>best.effective_confidence)best={...result,error};
  }
  const {error,...result}=best;
  return {...result,requested_rate:targetRate,limited_by_ties_or_bounds:result.achieved_rate===null||Math.abs(result.achieved_rate-targetRate)>1e-8};
}
export function selectThreshold(data,{mode='confidence',confidence=.4,targetRate=80}={}){
  if(!['confidence','judgement_rate'].includes(mode))throw Error('不支援的門檻設定模式');
  const result=mode==='confidence'?{...atConfidence(data,confidence),requested_rate:null,limited_by_ties_or_bounds:false}:forTargetRate(data,targetRate);
  return {mode,...result,definition:'finite coordinates and positive score >= confidence / (frames * 17)',confidence_bounds:[CONFIDENCE_MIN,CONFIDENCE_MAX]};
}

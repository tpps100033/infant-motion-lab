// Shared research scheduling and comparison rules; no clinical classification.
export const GROUP_LABELS={typical:'一般發展組',high_risk:'高風險組',developmental_concern:'發展異常組'};
export function addMonths(value,count){
  const d=new Date(value+'T00:00:00Z');if(!Number.isFinite(d.getTime()))throw Error('日期無效');
  const day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+count);
  const end=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,end));return d.toISOString().slice(0,10);
}
export function followup(subject,visits=[],clinical=[]){
  const dates=visits.map(v=>v.visited_on).sort(),last=dates.at(-1)||subject.enrolled_on;
  const mcdi=clinical.filter(r=>r.tool==='MCDI').map(r=>r.assessed_on).sort();
  const latest=[...visits].sort((a,b)=>a.visited_on.localeCompare(b.visited_on)).at(-1),age=latest?.age_months??subject.age_months;
  const firstDue=age>=8&&age<=30?last:age<8?addMonths(subject.enrolled_on,Math.ceil(8-subject.age_months)):null;
  return {next_visit:addMonths(last,1),next_mcdi:age>30?null:mcdi.length?addMonths(mcdi.at(-1),3):firstDue};
}
export function averageMetric(summary,joint,metric){
  let weight=0,total=0;
  for(const row of summary.features||[]){
    const seconds=row.window_end_s-row.window_start_s;
    if(row.joint===joint&&row.status==='ok'&&Number.isFinite(row[metric])&&seconds>0){weight+=seconds;total+=row[metric]*seconds;}
  }
  return weight?total/weight:null;
}
export function comparisonKey(summary){return JSON.stringify({schema:summary.schema_version,config:summary.config,frame:summary.coordinate_frame,model:summary.inference?.model?.sha256||'unknown'});}
export function researchQuality(visit){
  const reasons=[];
  if(visit.usable_video_seconds<180)reasons.push('可用連續影片不足 3 分鐘');
  for(const [key,label] of [['full_body','全身入鏡'],['stable_camera','固定鏡頭'],['adequate_light','光線足夠'],['natural_activity','自然活動']])if(!visit[key])reasons.push('待確認：'+label);
  return {ready:!reasons.length,reasons};
}
export function susScore(answers){if(answers.length!==10||answers.some(v=>!Number.isInteger(v)||v<1||v>5))throw Error('SUS 需 10 題，答案介於 1–5');return answers.reduce((s,v,i)=>s+(i%2?5-v:v-1),0)*2.5;}
export function csvText(rows){
  if(!rows.length)return '\ufeff';const keys=[...new Set(rows.flatMap(Object.keys))];
  const quote=v=>{let s=String(v??'');if(/^[=+@\t\r]/.test(s)||/^-[^\d.]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  return '\ufeff'+[keys.map(quote).join(','),...rows.map(r=>keys.map(k=>quote(r[k])).join(','))].join('\r\n');
}

import {GROUP_LABELS,followup,averageMetric,comparisonKey,researchQuality,csvText} from './research-core.mjs';
import {analyzeAudio} from './audio.mjs';
const $=id=>document.getElementById(id),today=()=>new Date().toLocaleDateString('sv-SE');
let session=null,subjects=[],settings={},selected=null,detail=null,analysisCache=[],audioResult=null,audioURL=null;
const format=(v,n=3)=>Number.isFinite(v)?v.toFixed(n):'—';
function note(text,error=false){$('notice').textContent=text;$('notice').className='notice'+(error?' error':'');}
async function api(path,options={}){
  const response=await fetch('./api/'+path,{credentials:'same-origin',...options,headers:{'X-MotionLab-Request':'1',...(options.body&&typeof options.body==='string'?{'Content-Type':'application/json'}:{}),...options.headers}});
  if(!response.ok){let message='操作失敗';try{const b=await response.json();message=typeof b.detail==='string'?b.detail:JSON.stringify(b.detail);}catch{message=await response.text().catch(()=>message);}if(response.status===401){session=null;showSession();}throw Error(message);}
  return response.status===204?null:response.headers.get('content-type')?.includes('application/json')?response.json():response.blob();
}
const post=(path,value)=>api(path,{method:'POST',body:JSON.stringify(value)});
function download(name,data,type='application/json'){const url=URL.createObjectURL(data instanceof Blob?data:new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
function el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
function button(text,action){const e=el('button',text,'button outline compact');e.type='button';e.addEventListener('click',()=>run(action));return e;}
async function run(action){try{await action();}catch(error){note(error.message,true);}}
function formValues(form,numbers=[],checks=[]){const value=Object.fromEntries(new FormData(form));for(const key of numbers)value[key]=value[key]===''?null:Number(value[key]);for(const key of checks)value[key]=form.elements[key].checked;return value;}
function table(target,headers,rows){target.replaceChildren();const wrap=el('div',undefined,'table-wrap'),t=el('table'),head=el('tr');headers.forEach(h=>head.append(el('th',h)));const thead=el('thead');thead.append(head);t.append(thead);const body=el('tbody');rows.forEach(row=>{const tr=el('tr');row.forEach(v=>tr.append(el('td',v??'—')));body.append(tr);});t.append(body);wrap.append(t);target.append(wrap);}
function bindForm(id,action){$(id).addEventListener('submit',e=>{e.preventDefault();const b=e.submitter;if(b)b.disabled=true;run(()=>action(e.target)).finally(()=>{if(b)b.disabled=false;});});}
function fill(form,value){for(const [key,v] of Object.entries(value)){const input=form.elements[key];if(!input)continue;if(input.type==='checkbox')input.checked=!!v;else input.value=v??'';}}
function currentVisit(){return detail?.visits.find(v=>v.id===$('visitSelect').value);}
function showSession(){
  $('loginPanel').hidden=!!session;$('privateWorkspace').hidden=!session;$('usabilityPanel').hidden=!session;
  document.querySelectorAll('.admin-only').forEach(e=>e.hidden=session?.role!=='admin');
  if(session)$('sessionInfo').textContent=`${session.username} · ${session.role==='admin'?'管理員':session.role==='researcher'?'研究員':'審閱者'} · 閒置或關閉前請登出`;
}
bindForm('loginForm',async form=>{session=await post('login',formValues(form));form.reset();showSession();await refresh();note('已登入本機私人資料庫。');});
$('logout').onclick=()=>run(async()=>{await post('logout',{});session=null;subjects=[];detail=null;analysisCache=[];$('subjectList').replaceChildren();$('subjectDetail').replaceChildren();showSession();note('已登出。');});
async function refresh(){settings=await api('study');subjects=await api('subjects');fill($('studyForm'),settings);$('subjectForm').elements.consent_version.value=settings.consent_version;$('subjectForm').elements.enrolled_on.value=today();$('subjectForm').elements.consent_on.value=today();$('visitForm').elements.visited_on.value=today();$('clinicalForm').elements.assessed_on.value=today();renderSubjects();renderStats();if(session.role==='admin')await renderUsers();await renderUsability();}
function renderStats(){
  const active=subjects.filter(s=>!s.withdrawn_at&&s.study_year===1),cards=[['第一年收案',active.length,settings.target_year1],['一般發展組',active.filter(s=>s.group==='typical').length,settings.target_typical],['高風險組',active.filter(s=>s.group==='high_risk').length,settings.target_high_risk],['發展異常組',active.filter(s=>s.group==='developmental_concern').length,settings.target_concern]];
  $('enrollmentStats').replaceChildren();for(const [label,count,target] of cards){const article=el('article');article.append(el('span',label),el('strong',`${count} / ${target}`),el('small','依收案時分組計數；退出個案排除'));$('enrollmentStats').append(article);}
}
function renderSubjects(){
  const query=$('subjectSearch').value.trim().toLowerCase();$('subjectList').replaceChildren();
  for(const s of subjects.filter(s=>s.code.toLowerCase().includes(query)).sort((a,b)=>a.code.localeCompare(b.code))){const b=button(s.code,()=>selectSubject(s.id));b.className=s.id===selected?'selected':'';b.append(el('small',`${GROUP_LABELS[s.group]} · ${format(s.age_months,1)} 個月${s.withdrawn_at?' · 已退出':''}`));$('subjectList').append(b);}
  if(!subjects.length)$('subjectList').append(el('p','尚無收案。先在研究設定登錄 IRB 資訊，再建立第一位受試者。','muted'));
}
$('subjectSearch').oninput=renderSubjects;
bindForm('subjectForm',async form=>{const value=formValues(form,['age_months','gestational_weeks','birth_weight_g','study_year'],['guardian_confirmed']);value.risk_factors=value.risk_factors.split(',').map(s=>s.trim()).filter(Boolean);const saved=await post('subjects',value);await refresh();await selectSubject(saved.id);form.closest('details').open=false;note('收案已保存。');});
async function selectSubject(id){
  selected=id;detail=await api('subjects/'+id);detail.visits.sort((a,b)=>a.visited_on.localeCompare(b.visited_on));renderSubjects();const s=detail.subject,follow=followup(s,detail.visits,detail.clinical),box=$('subjectDetail');box.replaceChildren();
  box.append(el('h2',s.code),el('p',`收案 ${s.enrolled_on} · 實足月齡 ${format(s.age_months,1)} · 場域 ${s.site_code} · ${s.cohort==='external'?'第三年獨立驗證':'第一／二年模型開發'}`));
  box.append(el('p',`同意版本 ${s.consent_version} · 同意日期 ${s.consent_on} · 下次每月訪視 ${follow.next_visit}${follow.next_mcdi?' · MCDI 規劃 '+follow.next_mcdi:''}`));
  if(s.withdrawn_at)box.append(el('p','已退出：停止新增資料，研究匯出排除此個案。','notice error'));
  else if(session.role!=='reviewer')box.append(button('登錄退出研究',async()=>{const reason=prompt('請填退出原因代碼或簡述（不含身分資料）');if(!reason)return;if(!confirm(`確認將 ${s.code} 標記退出？既有紀錄會保留，後續停止新增資料。`))return;await post('subjects/'+id+'/withdraw',{reason});await refresh();await selectSubject(id);note('已登錄退出。');}));
  if(s.withdrawn_at&&session.role==='admin')box.append(button('依核准程序清除個案資料',async()=>{const confirm_code=prompt(`此操作會永久清除 ${s.code} 的資料與媒體。輸入完整研究代碼以確認：`);if(confirm_code!==s.code)return;const reason=prompt('清除依據／原因（請先完成必要備份與核准）');if(!reason)return;await post('subjects/'+id+'/purge',{confirm_code,reason});detail=null;selected=null;analysisCache=[];$('subjectDetail').replaceChildren();for(const p of ['visitPanel','analysisPanel','trendPanel'])$(p).hidden=true;await refresh();note('本機個案資料已清除。既有備份副本須另依保存期限處理。');}));
  if(settings.end_date){const retention=Number(settings.end_date.slice(0,4))+5+settings.end_date.slice(4);box.append(el('p',`計畫結束日 ${settings.end_date}；保存期限最晚 ${retention}，到期由管理員依核准程序處理。`,'muted'));}
  $('visitPanel').hidden=false;$('analysisPanel').hidden=false;$('trendPanel').hidden=false;
  $('visitSelect').replaceChildren();for(const v of detail.visits){const o=el('option',`${v.visited_on} · ${GROUP_LABELS[v.group]}`);o.value=v.id;$('visitSelect').append(o);}$('visitSelect').value=detail.visits.at(-1)?.id||'';
  $('visitForm').elements.group.value=detail.visits.at(-1)?.group||s.group;
  analysisCache=detail.analyses.filter(a=>a.kind==='motion');
  renderVisit();await renderAnalyses();renderTrend();
}
function renderVisit(){const v=currentVisit();$('analyzeVisit').hidden=!v||!!detail.subject.withdrawn_at;$('saveAudio').disabled=!v||!audioResult||session.role==='reviewer';$('motionImport').disabled=!v||session.role==='reviewer';
  if(!v){$('visitQuality').textContent='尚未建立訪視。請先新增日期、分組與拍攝檢核，再歸檔研究資料。';return;}
  $('analyzeVisit').href='./index.html?visit='+encodeURIComponent(v.id);const q=researchQuality(v);$('visitQuality').textContent=`實足月齡 ${format(v.age_months,2)}／校正月齡 ${format(v.corrected_age_months,2)}。`+(q.ready?'拍攝檢核已完成。':q.reasons.join('；'));
  $('clinicalList').replaceChildren();table($('clinicalList'),['工具','版本','日期','評估者代碼','分數／判讀'],detail.clinical.filter(c=>c.visit_id===v.id).map(c=>[c.tool,c.version,c.assessed_on,c.assessor_code,Object.entries(c.scores).map(([k,val])=>k+': '+val).join('；')+' '+c.classification]));
  $('mediaList').replaceChildren();for(const file of detail.files.filter(f=>f.visit_id===v.id)){const card=el('div',undefined,'record-card');card.append(el('p',`${file.kind==='video'?'影片':'語音'} · ${(file.bytes/1048576).toFixed(1)} MB · ${format(file.duration_s,1)} 秒 · ${file.sha256.slice(0,16)}…`));if(session.role!=='reviewer')card.append(button('下載原始檔',async()=>download('research-media'+(file.mime.includes('wav')?'.wav':file.mime.includes('audio')?'.audio':'.mp4'),await api('files/'+file.id))));$('mediaList').append(card);}
}
$('visitSelect').onchange=()=>{renderVisit();renderAnalyses();};
bindForm('visitForm',async form=>{if(!selected)throw Error('請先選擇受試者');await post('subjects/'+selected+'/visits',formValues(form,['usable_video_seconds'],['full_body','stable_camera','adequate_light','natural_activity','no_unrelated_speech']));await selectSubject(selected);form.closest('details').open=false;note('訪視與當次分組已保存；既有訪視分組不會改寫。');});
bindForm('clinicalForm',async form=>{const v=currentVisit();if(!v)throw Error('請先建立訪視');const value=formValues(form);value.scores={};for(const line of form.elements.scores.value.split('\n').filter(s=>s.trim())){const parts=line.split('=');if(parts.length!==2||!parts[0].trim()||!Number.isFinite(Number(parts[1])))throw Error('分數格式請使用 欄位代碼=數值');value.scores[parts[0].trim()]=Number(parts[1]);}await post('visits/'+v.id+'/clinical',value);await selectSubject(selected);note('臨床評估已保存。');});
bindForm('mediaForm',async form=>{const v=currentVisit();if(!v)throw Error('請先建立訪視');const file=form.elements.media.files[0];if(file.size>256*1048576)throw Error('檔案超過 256 MB，請依院內 SOP 壓縮或切分');note('正在上傳並加密媒體，請保持此頁面開啟…');await api(`visits/${v.id}/files?kind=${form.elements.kind.value}&duration=${encodeURIComponent(form.elements.duration.value)}`,{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream'},body:file});form.reset();await selectSubject(selected);note('媒體已加密保存。');});
$('motionImport').onchange=e=>run(async()=>{const file=e.target.files[0],v=currentVisit();if(!file||!v)return;if(file.size>64*1048576)throw Error('JSON 超過 64 MB，請分段保存');const result=JSON.parse(await file.text());await post('visits/'+v.id+'/analyses',{kind:'motion',result});e.target.value='';await selectSubject(selected);note('動作分析已歸檔，等待審閱。');});
async function renderAnalyses(){
  $('analysisList').replaceChildren();const v=currentVisit();if(!v)return;
  const list=detail.analyses.filter(a=>a.visit_id===v.id).sort((a,b)=>b.created_at.localeCompare(a.created_at));
  for(const a of list){const card=el('article',undefined,'record-card');card.append(el('strong',`${a.kind==='motion'?'動作':'語音'}分析 · ${a.id.slice(0,8)}`),el('p',`${a.created_at} · ${a.review==='accepted'?'審閱通過':a.review==='rejected'?'拒絕':a.review==='needs_repeat'?'需重錄':'待審閱'}`));
    if(a.kind==='motion'){
      card.append(el('p',`${a.summary.frames} 影格 · 門檻 ${format(a.summary.config?.confidence*100,1)}% · 判定率 ${format(a.summary.threshold_policy?.achieved_rate,1)}% · 指標版本 ${a.summary.schema_version}`));
      const link=el('a','檢視軌跡與全部指標','button soft compact');link.href='./index.html?analysis='+a.id;card.append(link);
    }else card.append(el('p',`能量片段 ${a.summary.event_count} · 音高中位數 ${format(a.summary.pitch_median_hz,1)} Hz · 已人工確認嬰兒片段 ${a.summary.reviewed_infant_events??0}`));
    card.append(button('下載 JSON',async()=>{const full=await api('analyses/'+a.id);download(a.kind+'-'+a.id.slice(0,8)+'.json',JSON.stringify(full.result,null,2));}));
    if(session.role!=='researcher'){
      const select=el('select');select.setAttribute('aria-label','分析審閱狀態');for(const [value,text] of [['pending','待審閱'],['accepted','通過'],['needs_repeat','需重錄'],['rejected','拒絕']]){const o=el('option',text);o.value=value;select.append(o);}select.value=a.review;
      const input=el('input');input.placeholder='審閱註記';input.maxLength=1000;input.value=a.review_note||'';
      card.append(select,input,button('保存審閱',async()=>{await post('analyses/'+a.id+'/review',{status:select.value,note:input.value});await selectSubject(selected);note('審閱狀態已保存。');}));
    }
    $('analysisList').append(card);
  }
  if(!list.length)$('analysisList').append(el('p','此訪視尚無分析結果。','muted'));
}
function renderTrend(){
  const joint=$('trendJoint').value,metric=$('trendMetric').value,accepted=analysisCache.filter(a=>a.review==='accepted'&&a.summary.inference?.model?.sha256).sort((a,b)=>a.created_at.localeCompare(b.created_at));
  const reference=accepted.at(-1),key=reference&&comparisonKey(reference.summary),byVisit=new Map();
  for(const a of accepted)if(comparisonKey(a.summary)===key)byVisit.set(a.visit_id,a);
  const rows=detail.visits.map(v=>{const a=byVisit.get(v.id);return {date:v.visited_on,age:v.corrected_age_months,group:v.group,value:a?averageMetric(a.summary,joint,metric):null,id:a?.id||''};});
  table($('trendTable'),['訪視日期','校正月齡','當次分組','指標值','分析版本'],rows.map(r=>[r.date,format(r.age,2),GROUP_LABELS[r.group],format(r.value),r.id.slice(0,8)||'無相同設定的審閱結果']));
  const finite=rows.filter(r=>Number.isFinite(r.value));$('trendChart').replaceChildren();
  if(finite.length<2){$('trendChart').append(el('p','需至少兩次同設定且審閱通過的訪視，才能繪製縱向趨勢。','muted'));return;}
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 720 260');svg.setAttribute('aria-label','訪視動作指標趨勢');
  const minAge=Math.min(...finite.map(r=>r.age)),maxAge=Math.max(...finite.map(r=>r.age)),minVal=Math.min(...finite.map(r=>r.value)),maxVal=Math.max(...finite.map(r=>r.value));
  const x=v=>60+(v-minAge)/(maxAge-minAge||1)*620,y=v=>215-(v-minVal)/(maxVal-minVal||1)*170;
  const path=document.createElementNS(ns,'path');path.setAttribute('d',finite.map((r,i)=>`${i?'L':'M'}${x(r.age)},${y(r.value)}`).join(' '));path.setAttribute('fill','none');path.setAttribute('stroke','#0c827c');path.setAttribute('stroke-width','3');svg.append(path);
  for(const r of finite){const c=document.createElementNS(ns,'circle');c.setAttribute('cx',x(r.age));c.setAttribute('cy',y(r.value));c.setAttribute('r','5');c.setAttribute('fill','#0c827c');svg.append(c);const text=document.createElementNS(ns,'text');text.setAttribute('x',x(r.age));text.setAttribute('y',y(r.value)-12);text.setAttribute('text-anchor','middle');text.textContent=format(r.value);svg.append(text);}
  $('trendChart').append(svg);
}
$('trendJoint').onchange=renderTrend;$('trendMetric').onchange=renderTrend;
bindForm('studyForm',async form=>{const v=formValues(form,['target_year1','target_typical','target_high_risk','target_concern'],['approved']);v.end_date=v.end_date||null;settings=await api('study',{method:'PUT',body:JSON.stringify(v)});await refresh();note('研究設定已保存。');});
async function renderUsers(){const users=await api('users');$('userList').replaceChildren();for(const u of users){const card=el('div',undefined,'record-card');card.append(el('span',`${u.username} · ${u.role} · ${u.active?'啟用':'停用'}`));if(u.username!==session.username&&u.active)card.append(button('停用',async()=>{if(!confirm('確定停用此帳號？'))return;await post('users/'+u.id+'/disable',{});await renderUsers();}));$('userList').append(card);}}
bindForm('userForm',async form=>{await post('users',formValues(form));form.reset();await renderUsers();note('帳號已建立。');});
bindForm('passwordForm',async form=>{const v=formValues(form);await post('password',{current_password:v.current_password,new_password:v.new_password});form.reset();session=null;showSession();note('密碼已更新，請重新登入。');});
$('loadAudit').onclick=()=>run(async()=>{const records=await api('audit');table($('auditList'),['UTC 時間','帳號 ID','操作','紀錄 ID'],records.map(r=>[r.at,r.actor.slice(0,8),r.action,r.record_id.slice(0,8)]));});
$('exportResearch').onclick=()=>run(async()=>download('research-reviewed.csv',await api('export')));
$('backup').onclick=()=>run(async()=>{note('正在建立加密備份…');download('motionlab-encrypted-backup.zip',await api('backup'));note('備份已下載。請另外備份 master.key，勿把金鑰與備份放在相同媒體。');});
$('printReport').onclick=()=>{
  if(!selected){note('請先選擇個案',true);return;}
  const report=window.open('','motionlab-subject-report');if(!report){note('請允許此網站開啟報告視窗',true);return;}
  report.document.title='研究個案報告 '+detail.subject.code;report.document.body.replaceChildren();
  const stylesheet=report.document.createElement('link');stylesheet.rel='stylesheet';stylesheet.href=new URL('./report.css',location.href).href;report.document.head.append(stylesheet);
  const content=el('main'),s=detail.subject;content.append(el('h1','Motion Lab 研究個案報告'),el('p',`${s.code} · 場域 ${s.site_code} · ${s.cohort} · 匯出 ${new Date().toISOString()}`),el('p',`同意版本 ${s.consent_version}；收案 ${s.enrolled_on}；${s.withdrawn_at?'已退出研究':'在案'}`));
  const actions=el('div',undefined,'report-actions');actions.append(button('列印／另存 PDF',()=>report.print()));content.append(actions);
  for(const v of detail.visits){
    content.append(el('h2',`訪視 ${v.visited_on} · ${GROUP_LABELS[v.group]}`),el('p',`實足月齡 ${format(v.age_months,2)}／校正月齡 ${format(v.corrected_age_months,2)}；姿勢 ${v.posture}；可用影片 ${v.usable_video_seconds} 秒`));
    const quality=researchQuality(v);content.append(el('p',quality.ready?'拍攝檢核完成':quality.reasons.join('；')));
    const clinical=el('div');table(clinical,['臨床工具','版本','日期','結果'],detail.clinical.filter(c=>c.visit_id===v.id).map(c=>[c.tool,c.version,c.assessed_on,JSON.stringify(c.scores)+' '+c.classification]));content.append(clinical);
    for(const a of detail.analyses.filter(a=>a.visit_id===v.id)){
      content.append(el('h3',`${a.kind==='motion'?'動作':'語音'}分析 ${a.id.slice(0,8)} · ${a.review}`));
      if(a.kind==='motion'){
        content.append(el('p',`影格 ${a.summary.frames}；長度 ${format(a.summary.duration_s,2)} 秒；判定率 ${format(a.summary.threshold_policy?.achieved_rate,1)}%；軀幹有效率 ${format(a.summary.anchor_coverage*100,1)}%`));
        content.append(el('pre','方法版本 '+a.summary.schema_version+'\n參數 '+JSON.stringify(a.summary.config)+'\n模型 '+(a.summary.inference?.model?.sha256||'未提供')));
        const features=el('div');table(features,['關節','視窗起點 s','速度 TL/s','變異 TL','Jerk TL/s³','幅度 TL','品質'],a.summary.features.map(r=>[r.joint,format(r.window_start_s,1),format(r.speed_mean),format(r.position_variability),format(r.jerk_rms),format(r.amplitude),r.status]));content.append(features);
        const paired=el('div');table(paired,['雙側關節','視窗起點 s','速度差異','幅度差異','速度相關'],a.summary.symmetry.map(r=>[r.pair,format(r.window_start_s,1),format(r.speed_asymmetry),format(r.amplitude_asymmetry),format(r.speed_correlation)]));content.append(paired);
      }else{const audio=el('div');table(audio,['聲學欄位','數值'],Object.entries(a.summary).filter(([,value])=>!value||typeof value!=='object').map(([key,value])=>[key,value]));content.append(audio);}
    }
  }
  content.append(el('p','本報告為研究量測，包含未審閱項目時請依標記判讀。沒有月齡常模或臨床診斷分數；null／空值代表資料不足。完整擴充欄位請下載研究 CSV 或 JSON。'));
  report.document.body.append(content);
};
bindForm('usabilityForm',async form=>{const v=formValues(form);v.answers=v.answers.split(',').map(Number);await post('usability',v);form.reset();await renderUsability();note('可用性回饋已保存。');});

async function renderUsability(){const rows=await api('usability');table($('usabilityResults'),['測試者代碼','角色','SUS','回饋'],rows.map(r=>[r.tester_code,r.role,r.sus_score,r.feedback]));}
let audioFile=null;
$('audioFile').onchange=()=>{audioFile=$('audioFile').files[0];audioResult=null;$('audioAnalyze').disabled=!audioFile;$('audioExport').disabled=true;$('saveAudio').disabled=true;$('audioSummary').replaceChildren();$('audioSegments').replaceChildren();if(audioURL)URL.revokeObjectURL(audioURL);if(audioFile){audioURL=URL.createObjectURL(audioFile);$('audioPlayer').src=audioURL;$('audioPlayer').hidden=false;}};
$('audioAnalyze').onclick=()=>run(async()=>{
  if(!audioFile)return;if(audioFile.size>256*1048576)throw Error('音訊檔案超過 256 MB');$('audioAnalyze').disabled=true;$('audioStatus').textContent='正在解碼與分析音訊，請稍候…';
  let context;
  try{
    context=new AudioContext({sampleRate:16000});const decoded=await context.decodeAudioData(await audioFile.arrayBuffer());if(decoded.duration>600)throw Error('單次語音分析最長 10 分鐘');
    const mono=new Float32Array(decoded.length);for(let c=0;c<decoded.numberOfChannels;c++){const values=decoded.getChannelData(c);for(let i=0;i<mono.length;i++)mono[i]+=values[i]/decoded.numberOfChannels;}
    await new Promise(resolve=>setTimeout(resolve,20));audioResult=analyzeAudio(mono,decoded.sampleRate,{gate_db:Number($('audioGate').value)});renderAudio();$('audioStatus').textContent='基礎特徵已計算。請確認每個能量片段的聲音來源。';$('audioExport').disabled=false;$('saveAudio').disabled=!session||!currentVisit()||session.role==='reviewer';
  }finally{await context?.close();$('audioAnalyze').disabled=false;}
});
function renderAudio(){
  const s=audioResult.summary;table($('audioSummary'),['量測','數值','說明'],[['時長',format(s.duration_s,1)+' 秒','短時間錄音'],['聲音活動比例',format(s.active_fraction*100,1)+'%','能量閾值通過比例'],['能量片段',s.event_count,'需人工排除成人語音及噪音'],['片段頻率',format(s.events_per_minute,2)+' 次／分','聲音事件，非已確認嬰兒發聲頻率'],['音高中位數',format(s.pitch_median_hz,1)+' Hz',`${s.pitch_samples} 個可用估計；150–1200 Hz`],['音高 IQR',format(s.pitch_iqr_hz,1)+' Hz','第 25–75 百分位差'],['削波比例',format(s.clipping_fraction*100,2)+'%','接近數位滿刻度樣本'],['片段間距平均',format(s.event_interval_mean_s,2)+' 秒','事件起點間隔'],['片段間距 SD',format(s.event_interval_sd_s,2)+' 秒','事件節律變異']]);
  $('audioSegments').replaceChildren();audioResult.segments.forEach((segment,i)=>{const row=el('label',`${i+1} · ${format(segment.start_s,2)}–${format(segment.end_s,2)} 秒`),select=el('select');for(const [v,text] of [['unreviewed','未確認'],['infant_vocal','嬰兒發聲'],['cry','哭聲'],['coo','咕咕聲'],['babbling','牙牙學語'],['adult','成人語音'],['noise','噪音']]){const option=el('option',text);option.value=v;select.append(option);}select.value=segment.label;select.onchange=()=>{segment.label=select.value;audioResult.summary.reviewed_infant_events=audioResult.segments.filter(s=>['infant_vocal','cry','coo','babbling'].includes(s.label)).length;audioResult.summary.reviewed_vocalizations_per_minute=audioResult.summary.reviewed_infant_events/audioResult.summary.duration_s*60;};row.append(select,button('播放片段',()=>{$('audioPlayer').currentTime=segment.start_s;$('audioPlayer').play();}));$('audioSegments').append(row);});
}
$('audioExport').onclick=()=>{if(audioResult)download('infant_audio_result.json',JSON.stringify(audioResult,null,2));};
$('saveAudio').onclick=()=>run(async()=>{if(!audioResult||!currentVisit())throw Error('請先分析語音並選擇訪視');await post('visits/'+currentVisit().id+'/analyses',{kind:'audio',result:audioResult});await selectSubject(selected);note('語音分析已歸檔，等待審閱。');});

async function start(){
  try{
    const response=await fetch('./api/health');if(!response.ok||(await response.json()).private_server!==true)throw Error('public');
    $('serverBadge').textContent='私人資料庫 · 本機服務';$('loginPanel').hidden=false;
    try{session=await api('me');showSession();await refresh();note('私人資料庫已連線。');}catch{session=null;showSession();note('請使用本機研究帳號登入。');}
  }catch{$('serverBadge').textContent='公開分析網站';$('publicSetup').hidden=false;$('loginPanel').hidden=true;note('此頁尚未連接私人資料庫。收案與原始媒體請在 localhost 私人網址管理。');}
}
start();

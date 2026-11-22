import {JOINTS,EDGES,syntheticDemo,config,mean,derivatives} from './metrics.mjs?v=0.4.0';
import {population,selectThreshold,CONFIDENCE_MIN,CONFIDENCE_MAX} from './thresholds.mjs';

const $=id=>document.getElementById(id),video=$('sourceVideo'),canvas=$('overlay'),ctx=canvas.getContext('2d');
const names=['鼻','左眼','右眼','左耳','右耳','左肩','右肩','左肘','右肘','左腕','右腕','左髖','右髖','左膝','右膝','左踝','右踝'];
let packet=null,sourceURL=null,sourceName='',roi=null,busy=false,cancelled=false,playing=false,raf=0,previewTime=0;
let worker=null,nextId=0,pending=new Map(),model=null;
let selectionMode='confidence',targetRate=80,manualConfidence=.4,effectiveConfidence=.4;
let scorePopulation=null,populationRaw=null,remeasureTimer=null,measurementVersion=0,measuring=false;
let batchRunning=false,batchCancelled=false,batchVideos=[];
const nfmt=(value,digits=3)=>Number.isFinite(value)?value.toFixed(digits):'—';
const timeLabel=t=>`${Math.floor(t/60).toString().padStart(2,'0')}:${Math.floor(t%60).toString().padStart(2,'0')}`;
function status(text,kind=''){$('statusText').textContent=text;$('statusBox').className='status-box '+kind;}
function getConfig(){return config({confidence:effectiveConfidence,window_s:+$('window').value,smooth_s:+$('smooth').value,max_gap_s:+$('gap').value,min_coverage:+$('coverage').value});}
function choosePolicy(raw){
  if(populationRaw!==raw){scorePopulation=population(raw);populationRaw=raw;}
  return selectThreshold(scorePopulation,{mode:selectionMode,confidence:manualConfidence,targetRate});
}
function updateThresholdUI(raw=packet?.raw,policy=null){
  if(raw)policy=policy||choosePolicy(raw);
  effectiveConfidence=policy?.effective_confidence??manualConfidence;
  for(const radio of document.querySelectorAll('[name=thresholdMode]')){radio.checked=radio.value===selectionMode;radio.disabled=busy;}
  $('confidence').disabled=busy||selectionMode!=='confidence';
  $('judgementRate').disabled=busy||selectionMode!=='judgement_rate';
  $('confidence').value=effectiveConfidence;
  $('confidenceKind').textContent=selectionMode==='confidence'?'手動':'自動';
  $('confidenceValue').value=selectionMode==='judgement_rate'&&!raw?'待分析':effectiveConfidence.toFixed(4);
  $('judgementRateKind').textContent=selectionMode==='judgement_rate'?'目標（手動）':'自動';
  $('judgementRate').value=selectionMode==='judgement_rate'?targetRate:policy?.achieved_rate??0;
  $('judgementRateValue').value=selectionMode==='judgement_rate'?`${targetRate.toFixed(0)}%`:Number.isFinite(policy?.achieved_rate)?`${policy.achieved_rate.toFixed(1)}%`:'待分析';
  if(policy){
    const actual=Number.isFinite(policy.achieved_rate)?`${policy.achieved_rate.toFixed(1)}%`:'無資料';
    $('judgementInfo').textContent=(selectionMode==='judgement_rate'?`目標 ${targetRate.toFixed(0)}%，實際 ${actual}。`:`實際判定率 ${actual}。`)+`${policy.passed_keypoints} / ${policy.total_keypoints} 個關節點通過。`+(policy.limited_by_ties_or_bounds?'分數相同或有效點不足時，採可達到的最接近比例。':'');
    $('statJudgement').textContent=actual;
  }else{
    $('judgementInfo').textContent=packet&&!raw?'此摘要沒有原始關節分數，請匯入完整 JSON 或重新分析後計算判定率。':selectionMode==='judgement_rate'?'分析後依全部關節分數，自動選擇最接近目標判定率的信心門檻。':'分析後自動計算判定率。一次只開放一個參數手動調整。';
    $('statJudgement').textContent='—';
  }
  return policy;
}
function invalidateMeasurements(){clearTimeout(remeasureTimer);measurementVersion++;measuring=false;}
function refreshExports(){
  $('exportJson').disabled=measuring||!packet;
  $('exportTracks').disabled=measuring||!packet?.processed;
  $('exportFeatures').disabled=measuring||!packet?.summary?.features?.length;
  $('exportSymmetry').disabled=measuring||!packet?.summary?.symmetry?.length;
  $('exportCoordination').disabled=measuring||!packet?.summary?.coordination?.length;
  $('exportAngles').disabled=measuring||!packet?.summary?.angles?.length;
  $('archiveResult').disabled=measuring||busy||!packet||!!packet.demo;
}
async function measureSelection(raw,cfg,inference={},demo=false){
  const policy=choosePolicy(raw);cfg={...cfg,confidence:policy.effective_confidence};
  let result;
  try{result=await request('measure',{...raw,config:cfg});}
  catch(error){
    if(!error.message.includes('肩膀或髖部有效點不足'))throw error;
    result={format:'infant-motion-web/v1',raw,processed:null,summary:{schema_version:'1.0',frames:raw.times.length,duration_s:raw.times.at(-1)-raw.times[0],anchor_coverage:null,config:cfg,joint_order:JOINTS,features:[],symmetry:[],measurement_error:error.message,interpretation:'Insufficient reference joints. Raw tracks retained; no motion metrics reported.'}};
  }
  result.summary.inference=inference;result.summary.threshold_policy=policy;result.demo=demo;
  return result;
}
function queueRemeasure(){
  updateThresholdUI();
  if(!packet?.raw||busy)return;
  clearTimeout(remeasureTimer);const version=++measurementVersion,snapshot=packet;
  measuring=true;refreshExports();status('正在依信心門檻與判定率重算指標，不需重新執行模型…');
  remeasureTimer=setTimeout(async()=>{
    try{
      const result=await measureSelection(snapshot.raw,getConfig(),snapshot.summary.inference,snapshot.demo);
      if(version!==measurementVersion||busy)return;
      packet=result;showResults(packet);draw();status(result.summary.measurement_error?'判定率已更新，但肩髖資料不足，請降低門檻或提高目標判定率。':'判定率與動作指標已同步更新。',result.summary.measurement_error?'error':'success');
    }catch(error){
      if(version===measurementVersion)status('重算失敗：'+error.message,'error');
    }finally{if(version===measurementVersion){measuring=false;refreshExports();}}
  },180);
}
function initWorker(){
  if(worker)return;
  worker=new Worker(new URL('./worker.mjs?v=0.4.0',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{
    const task=pending.get(data.id);if(!task)return;
    if(data.progress){status(data.progress);return;}
    pending.delete(data.id);clearTimeout(task.timer);
    if(data.error)task.reject(Error(data.error));else task.resolve(data.result);
  };
  worker.onerror=event=>{
    const error=Error(event.message||'模型執行器無法載入，請確認透過 HTTPS 或 localhost 開啟。');
    for(const task of pending.values()){clearTimeout(task.timer);task.reject(error);}pending.clear();
    worker?.terminate();worker=null;model=null;
  };
}
function request(type,data={},transfer=[]){
  initWorker();const id=++nextId;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(Error(type==='init'?'模型載入逾時，請檢查網路後再試。':'運算逾時，請縮短影片或重新整理後再試。'));worker?.terminate();worker=null;model=null;},type==='init'?600000:60000);
    pending.set(id,{resolve,reject,timer});worker.postMessage({id,type,...data},transfer);
  });
}
function setBusy(value){
  busy=value;$('analyzeButton').disabled=value||!sourceURL;$('cancelButton').hidden=!value;
  for(const id of ['videoFile','resultFile','demoButton','videoDemoButton','sampleFps','duration','window','smooth','gap','coverage','resetRoi','playButton','scrub','roiX1','roiY1','roiX2','roiY2'])$(id).disabled=value;
  $('progress').hidden=!value;
  if(!value){$('playButton').disabled=!packet&&!sourceURL;$('scrub').disabled=!packet&&!sourceURL;$('resetRoi').disabled=!sourceURL;}
  updateThresholdUI();
  if(batchRunning)for(const id of ['analyzeButton','videoFile','resultFile','demoButton','videoDemoButton','sampleFps','duration','confidence','judgementRate','window','smooth','gap','coverage'])$(id).disabled=true;
  $('batchFiles').disabled=value||batchRunning;$('batchStart').disabled=value||batchRunning||!batchVideos.length;
}
function updateROIFields(){
  if(!roi)return;
  ['roiX1','roiY1','roiX2','roiY2'].forEach((id,i)=>{$(id).value=Math.round(roi[i]);$(id).max=i%2?video.videoHeight:video.videoWidth;});
}
function resetROI(){roi=[0,0,video.videoWidth,video.videoHeight];updateROIFields();draw();}
function fitCanvas(width,height){canvas.width=width;canvas.height=height;$('videoFrame').style.aspectRatio=`${width}/${height}`;}
function stopPlayback(){playing=false;cancelAnimationFrame(raf);video.pause();$('playButton').textContent='播放';}
function getPreviewFrame(){
  if(!packet?.raw?.times?.length)return null;
  const t=packet.raw.times;let low=0,high=t.length-1;
  while(low<high){const mid=Math.floor((low+high)/2);if(t[mid]<previewTime)low=mid+1;else high=mid;}
  if(low>0&&Math.abs(t[low-1]-previewTime)<Math.abs(t[low]-previewTime))low--;
  return low;
}
function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const frame=getPreviewFrame();
  if(!sourceURL){
    ctx.fillStyle='#eaf1f7';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.strokeStyle='#d7e3eb';ctx.lineWidth=1;
    for(let x=0;x<canvas.width;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,canvas.height);ctx.stroke();}
    for(let y=0;y<canvas.height;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(canvas.width,y);ctx.stroke();}
  }
  const allowOverlay=packet?.raw&&(packet.demo||packet.summary.inference?.source_name===sourceName);
  if(frame!==null&&allowOverlay){
    const points=packet.raw.xy[frame],scores=packet.raw.scores[frame],threshold=packet.summary.config?.confidence??.4;
    const valid=points.map((p,j)=>p.every(Number.isFinite)&&scores[j]>=threshold);
    const size=Math.max(2,canvas.width/400);
    ctx.lineWidth=size;ctx.lineCap='round';ctx.strokeStyle='#0c827c';
    for(const [a,b] of EDGES)if(valid[a]&&valid[b]){ctx.beginPath();ctx.moveTo(...points[a]);ctx.lineTo(...points[b]);ctx.stroke();}
    for(let j=0;j<17;j++)if(valid[j]){ctx.beginPath();ctx.arc(...points[j],size*1.5,0,Math.PI*2);ctx.fillStyle='#f0a657';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=size*.5;ctx.stroke();}
    if(packet.demo){ctx.fillStyle='#356575';ctx.font='15px system-ui';ctx.fillText('合成關節示範 · 非受試者影片',20,30);}
  }
  if(sourceURL&&roi){
    ctx.strokeStyle='#45cbb6';ctx.lineWidth=Math.max(2,canvas.width/400);ctx.setLineDash([10,6]);ctx.strokeRect(roi[0],roi[1],roi[2]-roi[0],roi[3]-roi[1]);ctx.setLineDash([]);
    if(canvas.height>100){ctx.fillStyle='#0b5550';ctx.font=`${Math.max(14,canvas.width/70)}px system-ui`;ctx.fillText('分析範圍',roi[0]+8,Math.min(canvas.height-10,roi[1]+24));}
  }
  const duration=sourceURL?video.duration:packet?.raw?.times?.at(-1)??0;
  $('timeLabel').textContent=`${timeLabel(previewTime)} / ${timeLabel(duration||0)}`;
  $('scrub').value=duration?previewTime/duration:0;
}
async function loadVideo(file,minimumDuration=0){
  if(busy)return;
  stopPlayback();invalidateMeasurements();packet=null;updateThresholdUI();$('results').hidden=true;
  if(sourceURL)URL.revokeObjectURL(sourceURL);
  sourceURL=URL.createObjectURL(file);sourceName=file.name;video.hidden=false;
  $('emptyHint').hidden=true;video.src=sourceURL;
  try{
    await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(Error('瀏覽器無法解碼這部影片，請轉成 H.264 MP4 或 WebM。'));});
    if(!Number.isFinite(video.duration)||video.duration<=0)throw Error('影片長度無效');
    if(video.duration<minimumDuration)throw Error(`範例影片需至少 ${minimumDuration} 秒，來源片長不足，請改用本機影片。`);
    fitCanvas(video.videoWidth,video.videoHeight);previewTime=0;roi=[0,0,video.videoWidth,video.videoHeight];updateROIFields();
    $('roiEditor').hidden=false;$('fileInfo').textContent=`${file.name} · ${video.videoWidth} × ${video.videoHeight} · ${nfmt(video.duration,1)} 秒`;
    $('modeBadge').textContent='待分析影片';$('previewHint').textContent='拖曳預覽畫面或輸入像素座標，圈住一名嬰幼兒的完整活動範圍。';
    setBusy(false);status('影片已就緒。確認分析範圍後按「開始分析」。');draw();
  }catch(error){sourceURL=null;video.hidden=true;$('analyzeButton').disabled=true;status(error.message,'error');}
}
$('videoFile').addEventListener('change',e=>{if(e.target.files[0])loadVideo(e.target.files[0]);});
$('videoDemoButton').addEventListener('click',async()=>{
  if(busy)return;
  try{
    setBusy(true);status('正在從 BabyPose 公開專案載入示範短片…');
    const response=await fetch('https://raw.githubusercontent.com/meyurtsever/BabyPose/main/data/kicking_legs/kicking_legs_14.mp4');
    if(!response.ok)throw Error(`公開短片下載失敗（${response.status}），請改用本機影片。`);
    const blob=await response.blob();setBusy(false);
    $('duration').value=0;
    selectionMode='confidence';manualConfidence=.2;updateThresholdUI(null);
    await loadVideo(new File([blob],'babypose_fullbody_11s.mp4',{type:'video/mp4'}),10);
  }catch(error){setBusy(false);status(error.message,'error');}
});
for(const event of ['dragover','dragleave','drop'])$('dropZone').addEventListener(event,e=>{
  e.preventDefault();$('dropZone').classList.toggle('dragover',event==='dragover');
  if(event==='drop'&&e.dataTransfer.files[0])loadVideo(e.dataTransfer.files[0]);
});
for(const radio of document.querySelectorAll('[name=thresholdMode]'))radio.addEventListener('change',()=>{if(!radio.checked||busy)return;selectionMode=radio.value;queueRemeasure();});
$('confidence').addEventListener('input',()=>{if(selectionMode!=='confidence'||busy)return;manualConfidence=+$('confidence').value;queueRemeasure();});
$('judgementRate').addEventListener('input',()=>{if(selectionMode!=='judgement_rate'||busy)return;targetRate=+$('judgementRate').value;queueRemeasure();});
$('resetRoi').addEventListener('click',resetROI);
for(const id of ['roiX1','roiY1','roiX2','roiY2'])$(id).addEventListener('change',()=>{
  const b=['roiX1','roiY1','roiX2','roiY2'].map(k=>+$(k).value);
  if(b.every(Number.isFinite)&&b[0]>=0&&b[1]>=0&&b[2]<=video.videoWidth&&b[3]<=video.videoHeight&&b[2]>b[0]&&b[3]>b[1]){roi=b;draw();}else{status('分析範圍需位於影片內，且寬高大於 0。','error');updateROIFields();}
});
let pointerStart=null;
function canvasPoint(e){
  const rect=canvas.getBoundingClientRect(),ratio=Math.min(rect.width/canvas.width,rect.height/canvas.height);
  const offsetX=(rect.width-canvas.width*ratio)/2,offsetY=(rect.height-canvas.height*ratio)/2;
  return [Math.max(0,Math.min(canvas.width,(e.clientX-rect.left-offsetX)/ratio)),Math.max(0,Math.min(canvas.height,(e.clientY-rect.top-offsetY)/ratio))];
}
canvas.addEventListener('pointerdown',e=>{if(!sourceURL||busy)return;stopPlayback();pointerStart=canvasPoint(e);canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener('pointermove',e=>{if(!pointerStart)return;const p=canvasPoint(e);roi=[Math.min(p[0],pointerStart[0]),Math.min(p[1],pointerStart[1]),Math.max(p[0],pointerStart[0]),Math.max(p[1],pointerStart[1])];updateROIFields();draw();});
canvas.addEventListener('pointerup',()=>{if(!pointerStart)return;pointerStart=null;if(roi[2]-roi[0]<10||roi[3]-roi[1]<10)resetROI();});
canvas.addEventListener('pointercancel',()=>{pointerStart=null;});
video.addEventListener('timeupdate',()=>{previewTime=video.currentTime;draw();});
video.addEventListener('ended',stopPlayback);
$('playButton').addEventListener('click',()=>{
  if(playing){stopPlayback();return;}
  playing=true;$('playButton').textContent='暫停';
  if(sourceURL){video.play().catch(error=>{stopPlayback();status(error.message,'error');});return;}
  const duration=packet?.raw?.times?.at(-1)??0;if(previewTime>=duration)previewTime=0;
  const started=performance.now(),base=previewTime;
  const tick=now=>{if(!playing)return;previewTime=base+(now-started)/1000;if(previewTime>=duration){previewTime=duration;stopPlayback();}draw();if(playing)raf=requestAnimationFrame(tick);};raf=requestAnimationFrame(tick);
});
$('scrub').addEventListener('input',()=>{
  stopPlayback();if(sourceURL){video.currentTime=+$('scrub').value*video.duration;previewTime=video.currentTime;}else previewTime=+$('scrub').value*(packet?.raw?.times?.at(-1)??0);draw();
});
async function seekFrame(target){
  return new Promise((resolve,reject)=>{
    let done=false,callback=null,fallbackTimer=null,decoded=false,frameTime=null;
    const cleanup=()=>{clearTimeout(timer);clearTimeout(fallbackTimer);video.removeEventListener('error',error);video.removeEventListener('seeked',seeked);if(callback!==null)video.cancelVideoFrameCallback?.(callback);};
    const finish=(time,exact)=>{if(done)return;done=true;cleanup();resolve({time,exact});};
    const error=()=>{if(done)return;done=true;cleanup();reject(Error('影片解碼失敗或逾時，請轉為 H.264 MP4 後再試。'));};
    const seeked=()=>{
      decoded=true;
      if(frameTime!==null)finish(frameTime,true);
      else if(!video.requestVideoFrameCallback)finish(video.currentTime,false);
      else fallbackTimer=setTimeout(()=>finish(video.currentTime,false),80);
    };
    const timer=setTimeout(error,10000);
    video.addEventListener('error',error,{once:true});
    video.addEventListener('seeked',seeked,{once:true});
    if(video.requestVideoFrameCallback)callback=video.requestVideoFrameCallback((_,meta)=>{frameTime=meta.mediaTime;if(decoded)finish(frameTime,true);});
    video.currentTime=Math.max(0,Math.min(video.duration-.001,target+1e-7));
  });
}
$('cancelButton').addEventListener('click',()=>{cancelled=true;status('正在停止；已擷取的影格會嘗試產生部分結果。');});
async function analyzeVideo(){
  if(busy||!sourceURL)return;
  stopPlayback();let samples={times:[],xy:[],scores:[]},fallback=0,duplicates=0,latency=[];
  try{
    const cfg=getConfig(),fps=+$('sampleFps').value,limit=+$('duration').value;
    if(!Number.isFinite(limit)||limit<0||limit>3600)throw Error('分析長度需為 0 至 3600 秒');
    const end=Math.min(video.duration,limit||video.duration),count=Math.ceil(end*fps);
    if(count>108000)throw Error('請將單次分析縮短為一小時以內');
    if(!roi||roi[2]<=roi[0]||roi[3]<=roi[1])throw Error('請先設定分析範圍');
    invalidateMeasurements();packet=null;setBusy(true);cancelled=false;$('results').hidden=true;
    $('videoFrame').scrollIntoView({block:'center',behavior:'instant'});
    $('progress').value=0;
    if(!model)model=await request('init');
    for(let i=0;i<count;i++){
      if(cancelled)break;
      const {time,exact}=await seekFrame(i/fps);
      if(!exact)fallback++;
      if(samples.times.length&&time<=samples.times.at(-1)+1e-8){duplicates++;continue;}
      let result;
      if(typeof OffscreenCanvas!=='undefined'&&typeof createImageBitmap==='function'){
        const bitmap=await createImageBitmap(video);result=await request('predict',{bitmap,roi},[bitmap]);
      }else{
        const snapshot=document.createElement('canvas');snapshot.width=video.videoWidth;snapshot.height=video.videoHeight;
        const c=snapshot.getContext('2d');c.drawImage(video,0,0);
        const pixels=c.getImageData(0,0,snapshot.width,snapshot.height).data.buffer;
        result=await request('predict',{pixels,width:snapshot.width,height:snapshot.height,roi},[pixels]);
      }
      samples.times.push(time);samples.xy.push(result.xy);samples.scores.push(result.scores);latency.push(result.latency_ms);
      previewTime=time;
      ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.strokeStyle='#0c827c';ctx.lineWidth=Math.max(2,canvas.width/400);
      for(const[a,b]of EDGES)if(result.scores[a]>=cfg.confidence&&result.scores[b]>=cfg.confidence){ctx.beginPath();ctx.moveTo(...result.xy[a]);ctx.lineTo(...result.xy[b]);ctx.stroke();}
      $('progress').value=(i+1)/count;status(`正在分析 ${timeLabel(time)} / ${timeLabel(end)}，已擷取 ${samples.times.length} 個影格…`);
    }
    if(samples.times.length<2)throw Error(cancelled?'分析已停止，擷取資料不足。':'解碼影格不足，請檢查影片。');
    status('正在計算軌跡與五項動作指標…');
    packet=await measureSelection(samples,cfg);
    packet.summary.inference={source_name:sourceName,width:video.videoWidth,height:video.videoHeight,roi_xyxy:[...roi],requested_sample_fps:fps,decoded_frames:packet.summary.frames,duplicate_frame_requests:duplicates,timestamp_fallback_frames:fallback,timestamp_source:'requestVideoFrameCallback.mediaTime; currentTime fallback when unavailable',selection:'manual_fixed_roi',partial:cancelled,model:{name:model.name,sha256:model.sha256,runtime:model.runtime,provider:'wasm_single_thread'},latency_mean_ms:mean(latency),latency_scope:'model inference; excludes seeking, preprocessing, measurement and export',created_utc:new Date().toISOString()};
    showResults(packet);$('modeBadge').textContent=cancelled?'部分分析結果':'分析完成';
    status(`${cancelled?'已停止並產生部分結果':'分析完成'}：${packet.summary.frames} 個影格。${fallback?'部分影格使用近似時間，詳見匯出紀錄。':''}${packet.summary.measurement_error?'肩髖資料不足，請降低門檻或提高目標判定率。':''}`,packet.summary.measurement_error?'error':'success');
  }catch(error){status(error.message||String(error),'error');}
  finally{setBusy(false);draw();}
}
$('analyzeButton').addEventListener('click',analyzeVideo);
function table(element,headers,rows){
  element.replaceChildren();const head=document.createElement('thead'),tr=document.createElement('tr');
  headers.forEach(text=>{const th=document.createElement('th');th.textContent=text;tr.append(th);});head.append(tr);element.append(head);
  const body=document.createElement('tbody');
  rows.forEach(values=>{const tr=document.createElement('tr');values.forEach(v=>{const td=document.createElement('td');td.textContent=v;tr.append(td);});body.append(tr);});element.append(body);
}
function jointName(key){return names[JOINTS.indexOf(key)]||key;}
function showResults(value){
  const s=value.summary;
  updateThresholdUI(value.raw,s.threshold_policy);
  $('results').hidden=false;$('statFrames').textContent=s.frames??'—';$('statDuration').textContent=nfmt(s.duration_s,1);$('statCoverage').textContent=Number.isFinite(s.anchor_coverage)?`${nfmt(s.anchor_coverage*100,1)}%`:'—';
  $('resultNote').textContent=s.measurement_error?'肩髖有效點不足，保留原始分數與判定率；動作指標暫不輸出。':value.demo?'合成測試資料，僅展示操作及指標定義。':`${s.inference?.source_name||'匯入的分析結果'} · ${s.inference?.partial?'部分結果 · ':''}品質通過不代表臨床正常。`;
  const windowValue=$('featureWindow').value;$('featureWindow').replaceChildren();const all=document.createElement('option');all.value='all';all.textContent='全部視窗';$('featureWindow').append(all);for(const start of [...new Set(s.features.map(r=>r.window_start_s))]){const option=document.createElement('option');option.value=String(start);option.textContent=nfmt(start,1)+' s';$('featureWindow').append(option);}$('featureWindow').value=[...$('featureWindow').options].some(o=>o.value===windowValue)?windowValue:'all';
  renderFeatureTable();
  table($('symmetryTable'),['雙側關節','起點 (s)','速度差異','幅度差異','鏡射 RMS','速度相關','共同有效率'],s.symmetry.map(r=>[jointName(r.pair.split(':')[0]).replace('左','左右'),nfmt(r.window_start_s,1),nfmt(r.speed_asymmetry),nfmt(r.amplitude_asymmetry),nfmt(r.mirrored_distance_rms),nfmt(r.speed_correlation),`${nfmt(r.paired_coverage*100,0)}%`]));
  table($('coordinationTable'),['關節組合','起點 s','速度相關','共同微分比例','品質'],(s.coordination||[]).map(r=>[jointName(r.joint_a)+' / '+jointName(r.joint_b),nfmt(r.window_start_s,1),nfmt(r.speed_correlation),nfmt(r.paired_derivative_fraction*100,1)+'%',r.status]));
  table($('anglesTable'),['關節','起點 s','平均 °','SD °','P05 °','P95 °','活動範圍 °','有效率'],(s.angles||[]).map(r=>[jointName(r.joint),nfmt(r.window_start_s,1),nfmt(r.angle_mean_deg),nfmt(r.angle_sd_deg),nfmt(r.angle_p05_deg),nfmt(r.angle_p95_deg),nfmt(r.range_p90_deg),nfmt(r.coverage*100,1)+'%']));
  renderChart();
  refreshExports();
  $('playButton').disabled=!value.raw&&!sourceURL;$('scrub').disabled=!value.raw&&!sourceURL;
}
const featureColumns={core:[['speed_mean','平均速度'],['position_variability','位置變異度'],['jerk_rms','Jerk RMS'],['amplitude','幅度']],dynamics:[['speed_mean','平均速度'],['speed_sd','速度 SD'],['speed_median','速度中位數'],['speed_p95','速度 P95'],['speed_peak','速度峰值'],['acceleration_rms','加速度 RMS'],['acceleration_peak','加速度峰值']],range:[['amplitude_x','X 幅度'],['amplitude_y','Y 幅度'],['amplitude','合成幅度'],['variability_x','X 變異度'],['variability_y','Y 變異度'],['path_length','路徑長度'],['path_observed_s','路徑可用秒數'],['path_mean_speed','路徑平均速度'],['displacement','位移'],['straightness','直線度']],smoothness:[['jerk_rms','Jerk RMS'],['dimensionless_squared_jerk','無因次平方 Jerk'],['derivative_duration_s','微分可用秒數']],quality:[['coverage','座標有效比例'],['observed_fraction','原始觀測比例'],['interpolated_fraction','補值比例'],['derivative_fraction','微分比例'],['speed_outlier_fraction','速度跳點比例']]};
function renderFeatureTable(){
  if(!packet)return;const category=$('featureCategory').value,columns=featureColumns[category],joint=$('featureJoint').value,window=$('featureWindow').value;
  table($('featuresTable'),['關節','起點 s',...columns.map(c=>c[1]),'品質'],packet.summary.features.filter(r=>(joint==='all'||r.joint===joint)&&(window==='all'||String(r.window_start_s)===window)).map(r=>[jointName(r.joint),nfmt(r.window_start_s,1),...columns.map(([key])=>nfmt(r[key])),r.status==='ok'?'通過':r.status==='speed_outlier'?'速度跳點':'資料不足']));
  $('featureUnits').textContent=category==='dynamics'?'速度：軀幹長度／秒；加速度：軀幹長度／秒²':category==='range'?'幅度、變異度、路徑及位移：軀幹長度；直線度：0–1':category==='smoothness'?'Jerk RMS：軀幹長度／秒³；無因次平方 Jerk：無單位；靜止或分段缺口留空':category==='quality'?'各比例介於 0–1；補值後有效率與原始判定率不同':'速度：軀幹長度／秒；變異度與幅度：軀幹長度；Jerk RMS：軀幹長度／秒³';
}
function renderChart(){
  const chart=$('chart');chart.replaceChildren();
  if(!packet?.processed?.body){const p=document.createElement('p');p.className='empty-chart';p.textContent=packet?.summary?.measurement_error?'有效肩髖不足，無法建立軀幹座標。請降低門檻或提高目標判定率後重算。':'此檔案只有指標摘要。匯入完整網頁版 JSON，可檢視逐幀軌跡。';chart.append(p);return;}
  const t=packet.raw.times,j=+$('jointSelect').value,signal=$('signalSelect').value,bodyPoints=packet.processed.body.map(p=>p[j]);
  const derived=signal==='position'?null:derivatives(t,bodyPoints,config(packet.summary.config),packet.processed.breaks);
  const points=signal==='position'?bodyPoints:derived[signal].map(v=>[v,NaN]),values=points.flat().filter(Number.isFinite);
  document.querySelector('.legend .x').textContent=signal==='position'?'橫向位置 x':signal==='speed'?'速度':'加速度';document.querySelector('.legend .y').hidden=signal!=='position';
  if(!values.length){chart.textContent='此關節的有效點不足。';return;}
  const width=760,height=280,left=50,right=15,top=18,bottom=42;
  let lo=values.reduce((m,v)=>Math.min(m,v),Infinity),hi=values.reduce((m,v)=>Math.max(m,v),-Infinity);const pad=Math.max((hi-lo)*.15,.05);lo-=pad;hi+=pad;
  const x=v=>left+(v-t[0])/(t.at(-1)-t[0]||1)*(width-left-right),y=v=>height-bottom-(v-lo)/(hi-lo)*(height-top-bottom);
  const NS='http://www.w3.org/2000/svg',svg=document.createElementNS(NS,'svg');svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.setAttribute('aria-label',`${names[j]}位置軌跡`);
  const add=(tag,attrs,text)=>{const el=document.createElementNS(NS,tag);Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,v));if(text)el.textContent=text;svg.append(el);return el;};
  for(let k=0;k<=4;k++){
    const yy=top+k*(height-top-bottom)/4;add('line',{x1:left,x2:width-right,y1:yy,y2:yy,stroke:'#e3ebf1'});add('text',{x:left-9,y:yy+4,'text-anchor':'end',fill:'#6a7d8e','font-size':11},(hi-k*(hi-lo)/4).toFixed(2));
    const stamp=t[0]+k*(t.at(-1)-t[0])/4;add('text',{x:x(stamp),y:height-bottom+23,'text-anchor':'middle',fill:'#6a7d8e','font-size':11},stamp.toFixed(1)+' s');
  }
  for(let axis=0;axis<(signal==='position'?2:1);axis++){
    let d='',connected=false;
    points.forEach((p,i)=>{if(!Number.isFinite(p[axis])||packet.processed.breaks?.[i]){connected=false;if(!Number.isFinite(p[axis]))return;}d+=`${connected?'L':'M'}${x(t[i]).toFixed(2)},${y(p[axis]).toFixed(2)} `;connected=true;});
    add('path',{d,fill:'none',stroke:axis?'#e29445':'#0c827c','stroke-width':2.2,'stroke-linejoin':'round'});
  }
  chart.append(svg);
}
JOINTS.forEach((key,i)=>{const option=document.createElement('option');option.value=i;option.textContent=names[i];$('jointSelect').append(option);const featureOption=document.createElement('option');featureOption.value=key;featureOption.textContent=names[i];$('featureJoint').append(featureOption);});$('jointSelect').value=9;
$('jointSelect').addEventListener('change',renderChart);
$('signalSelect').addEventListener('change',()=>{renderChart();$('signalUnits').textContent=$('signalSelect').value==='position'?'單位：軀幹長度':$('signalSelect').value==='speed'?'單位：軀幹長度／秒':'單位：軀幹長度／秒²';});
for(const id of ['featureCategory','featureJoint','featureWindow'])$(id).addEventListener('change',renderFeatureTable);
for(const tab of document.querySelectorAll('[role=tab]')){
  tab.addEventListener('click',()=>{for(const b of document.querySelectorAll('[role=tab]')){const selected=b===tab;b.setAttribute('aria-selected',String(selected));$(b.dataset.panel).hidden=!selected;b.tabIndex=selected?0:-1;}});
  tab.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const tabs=[...document.querySelectorAll('[role=tab]')],i=tabs.indexOf(tab),next=tabs[(i+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length];next.click();next.focus();});
}
$('demoButton').addEventListener('click',()=>{
  if(busy)return;invalidateMeasurements();stopPlayback();if(sourceURL)URL.revokeObjectURL(sourceURL);sourceURL=null;video.removeAttribute('src');video.load();video.hidden=true;roi=null;
  packet=syntheticDemo();fitCanvas(640,480);previewTime=0;$('emptyHint').hidden=true;$('roiEditor').hidden=true;$('modeBadge').textContent='合成示範';$('fileInfo').textContent='合成週期運動 · 180 影格 · 30 FPS';$('previewHint').textContent='播放或拖動時間軸，觀察合成關節與軌跡。';$('analyzeButton').disabled=true;$('resetRoi').disabled=true;
  packet.summary.threshold_policy=choosePolicy(packet.raw);
  showResults(packet);draw();queueRemeasure();
});
function validatePacket(value){
  const summary=value.summary||value;
  if(!summary||!Array.isArray(summary.features)||!Array.isArray(summary.symmetry)||!Number.isFinite(summary.frames)||summary.features.length>100000)throw Error('不是支援的分析結果 JSON');
  for(const row of summary.features)if(typeof row.joint!=='string')throw Error('關節結果格式不正確');
  for(const row of summary.symmetry)if(typeof row.pair!=='string')throw Error('雙側結果格式不正確');
  return {...value,summary};
}
$('resultFile').addEventListener('change',async e=>{
  const file=e.target.files[0];if(!file||busy)return;
  try{
    if(file.size>150*1024*1024)throw Error('結果檔案大於 150 MB，請先切分影片');
    const value=validatePacket(JSON.parse(await file.text()));
    invalidateMeasurements();
    selectionMode=value.summary.threshold_policy?.mode==='judgement_rate'?'judgement_rate':'confidence';
    targetRate=value.summary.threshold_policy?.requested_rate??80;
    manualConfidence=Math.max(CONFIDENCE_MIN,Math.min(CONFIDENCE_MAX,value.summary.config?.confidence??.4));
    for(const [id,key] of [['window','window_s'],['smooth','smooth_s'],['gap','max_gap_s'],['coverage','min_coverage']])if(Number.isFinite(value.summary.config?.[key]))$(id).value=value.summary.config[key];
    // Imported raw data are recomputed under their saved config instead of trusting derived arrays.
    if(value.raw){packet=await measureSelection(value.raw,value.summary.config,value.summary.inference,value.demo);}
    else packet={summary:value.summary};
    showResults(packet);$('modeBadge').textContent='匯入結果';status('已匯入分析結果。','success');draw();
  }catch(error){status('匯入失敗：'+error.message,'error');}
  e.target.value='';
});
function download(name,content,type){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([content],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function csv(rows){
  if(!rows.length)return'';const fields=Object.keys(rows[0]),escape=v=>`"${String(v??'').replaceAll('"','""')}"`;
  return '\ufeff'+[fields.map(escape).join(','),...rows.map(row=>fields.map(k=>escape(row[k])).join(','))].join('\r\n');
}
$('exportJson').addEventListener('click',()=>{if(packet)download('infant_motion_result.json',JSON.stringify(packet,null,2),'application/json');});
$('exportFeatures').addEventListener('click',()=>{if(packet)download('features.csv',csv(packet.summary.features.map(row=>({confidence_threshold:packet.summary.config?.confidence,judgement_rate:packet.summary.threshold_policy?.achieved_rate,...row}))),'text/csv;charset=utf-8');});
$('exportSymmetry').addEventListener('click',()=>{if(packet)download('symmetry.csv',csv(packet.summary.symmetry.map(row=>({confidence_threshold:packet.summary.config?.confidence,judgement_rate:packet.summary.threshold_policy?.achieved_rate,...row}))),'text/csv;charset=utf-8');});
$('exportTracks').addEventListener('click',()=>{
  if(!packet?.raw)return;const rows=[];
  packet.raw.times.forEach((t,i)=>JOINTS.forEach((joint,j)=>rows.push({frame:i,time_s:t,joint,raw_x_px:packet.raw.xy[i][j][0],raw_y_px:packet.raw.xy[i][j][1],confidence:packet.raw.scores[i][j],body_x:packet.processed.body[i][j][0],body_y:packet.processed.body[i][j][1],observed:packet.processed.observed[i][j],interpolated:packet.processed.interpolated[i][j]})));
  download('trajectories.csv',csv(rows),'text/csv;charset=utf-8');
});
if(location.protocol==='file:')status('請透過 GitHub Pages 或 localhost 開啟。瀏覽器不允許直接從 file:// 載入推論模組。','error');
updateThresholdUI();draw();

for(const [id,section,name] of [['exportCoordination','coordination','coordination.csv'],['exportAngles','angles','angles.csv']])$(id).onclick=()=>{if(packet)download(name,csv((packet.summary[section]||[]).map(row=>({confidence_threshold:packet.summary.config?.confidence,judgement_rate:packet.summary.threshold_policy?.achieved_rate,...row}))),'text/csv;charset=utf-8');};

$('batchFiles').onchange=()=>{batchVideos=[...$('batchFiles').files];$('batchStart').disabled=!batchVideos.length||busy;$('batchStatus').textContent=`已選擇 ${batchVideos.length} 部影片。每部都會分析全片；請保持分頁開啟並允許多檔下載。`;};
$('batchStop').onclick=()=>{batchCancelled=true;cancelled=true;$('batchStatus').textContent='正在停止佇列；當前影片會嘗試保存部分結果。';};
$('batchStart').onclick=async()=>{
  if(busy||batchRunning||!batchVideos.length)return;
  batchRunning=true;batchCancelled=false;$('batchStop').disabled=false;const rows=[];
  for(let i=0;i<batchVideos.length&&!batchCancelled;i++){
    const file=batchVideos[i];$('batchStatus').textContent=`正在處理 ${i+1} / ${batchVideos.length}：${file.name}`;
    try{
      await loadVideo(file);if(!sourceURL)throw Error('無法解碼影片');$('duration').value=0;
      await analyzeVideo();
      if(!packet?.raw)throw Error($('statusText').textContent||'未產生有效結果');
      const stem=file.name.replace(/\.[^.]+$/,'').replace(/[^\p{L}\p{N}_-]/gu,'_');
      download(`${String(i+1).padStart(2,'0')}_${stem}_analysis.json`,JSON.stringify(packet,null,2),'application/json');
      rows.push([file.name,packet.summary.frames,nfmt(packet.summary.threshold_policy?.achieved_rate,1)+'%',packet.summary.inference?.partial?'部分結果':packet.summary.measurement_error?'肩髖資料不足':'完成']);
    }catch(error){rows.push([file.name,'—','—',error.message]);}
    table($('batchTable'),['影片','影格數','判定率','狀態'],rows);
  }
  batchRunning=false;$('batchStop').disabled=true;setBusy(false);$('batchStatus').textContent=batchCancelled?'佇列已停止；已完成結果已觸發下載。':'佇列完成。請確認瀏覽器下載清單，再在私人面板歸檔。';
};

const archiveVisit=new URLSearchParams(location.search).get('visit'),archiveAnalysis=new URLSearchParams(location.search).get('analysis');
async function privateAPI(path,options={}){
  const response=await fetch('./api/'+path,{credentials:'same-origin',...options,headers:{'X-MotionLab-Request':'1','Content-Type':'application/json',...options.headers}});
  if(!response.ok){let body;try{body=await response.json();}catch{}throw Error(typeof body?.detail==='string'?body.detail:'請從私人研究面板登入後再操作');}
  return response.json();
}
if(archiveVisit||archiveAnalysis){
  $('archivePanel').hidden=false;$('results').hidden=false;$('archiveInfo').textContent='正在確認私人資料庫登入狀態…';
  (async()=>{
    try{
      const me=await privateAPI('me');$('archiveInfo').textContent=archiveVisit?`已登入 ${me.username}。目前歸檔訪視：${archiveVisit.slice(0,8)}。分析後按保存，原始影片不會自動上傳。`:'已登入私人資料庫，正在讀取已歸檔分析。';
      $('archiveResult').hidden=!archiveVisit;
      if(archiveAnalysis){
        const saved=await privateAPI('analyses/'+encodeURIComponent(archiveAnalysis));
        if(saved.kind!=='motion')throw Error('此筆為語音分析，請在研究管理面板檢視');
        const value=validatePacket(saved.result);invalidateMeasurements();selectionMode=value.summary.threshold_policy?.mode==='judgement_rate'?'judgement_rate':'confidence';targetRate=value.summary.threshold_policy?.requested_rate??80;manualConfidence=Math.max(CONFIDENCE_MIN,Math.min(CONFIDENCE_MAX,value.summary.config?.confidence??.4));
        for(const [id,key] of [['window','window_s'],['smooth','smooth_s'],['gap','max_gap_s'],['coverage','min_coverage']])if(Number.isFinite(value.summary.config?.[key]))$(id).value=value.summary.config[key];
        packet=value.raw?await measureSelection(value.raw,value.summary.config,value.summary.inference,value.demo):value;showResults(packet);draw();$('archiveInfo').textContent='顯示已歸檔分析。原始座標依保存的參數重算；資料庫版本未被改寫。';
      }
    }catch(error){$('archiveInfo').textContent=error.message;$('archiveResult').disabled=true;}
  })();
}
$('archiveResult').onclick=async()=>{
  if(!archiveVisit||!packet||packet.demo||measuring)return;
  $('archiveResult').disabled=true;
  try{const result=await privateAPI('visits/'+encodeURIComponent(archiveVisit)+'/analyses',{method:'POST',body:JSON.stringify({kind:'motion',result:packet})});$('archiveStatus').textContent=`已保存分析 ${result.id.slice(0,8)}，等待研究團隊審閱。`;}
  catch(error){$('archiveStatus').textContent=error.message;}
  finally{$('archiveResult').disabled=false;}
};

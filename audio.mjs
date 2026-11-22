// Energy activity and autocorrelation F0 are signal descriptors, not infant speech recognition.
import {quantile,mean} from './metrics.mjs';
export function analyzeAudio(samples,sampleRate,{gate_db=-40,pitch_min=150,pitch_max=1200}={}){
  if(!Number.isFinite(sampleRate)||sampleRate<8000||!samples.length||samples.length/sampleRate>600)throw Error('語音需為 0–600 秒、取樣率至少 8 kHz');
  if(!Number.isFinite(gate_db)||gate_db < -90||gate_db>0||pitch_min<50||pitch_max>2000||pitch_min>=pitch_max)throw Error('語音參數無效');
  const width=Math.round(.04*sampleRate),hop=Math.round(.02*sampleRate),frames=[];
  let clipped=0;for(const s of samples){if(!Number.isFinite(s))throw Error('音訊包含無效樣本');if(Math.abs(s)>=.999)clipped++;}
  // First-order 80 Hz high-pass removes DC and low-frequency rumble; no voice enhancement claim.
  const filtered=new Float32Array(samples.length),alpha=Math.exp(-2*Math.PI*80/sampleRate);
  for(let i=1;i<samples.length;i++)filtered[i]=alpha*(filtered[i-1]+samples[i]-samples[i-1]);
  for(let start=0;start+width<=samples.length;start+=hop){
    let square=0,crossings=0;
    for(let k=0;k<width;k++){const v=filtered[start+k];square+=v*v;if(k&&v*filtered[start+k-1]<0)crossings++;}
    frames.push({start_s:start/sampleRate,end_s:(start+width)/sampleRate,rms:Math.sqrt(square/width),zcr:crossings/(width-1),pitch_hz:null,pitch_confidence:null});
  }
  const noise=quantile(frames.map(f=>20*Math.log10(Math.max(f.rms,1e-9))),.2),threshold=Math.max(gate_db,noise+6);
  for(let index=0;index<frames.length;index++){
    const frame=frames[index];frame.active=20*Math.log10(Math.max(frame.rms,1e-9))>=threshold;
    if(!frame.active||index%5)continue; // F0 at 100 ms intervals to bound compute.
    const start=index*hop,minLag=Math.floor(sampleRate/pitch_max),maxLag=Math.ceil(sampleRate/pitch_min),corr=[];
    for(let lag=minLag;lag<=maxLag;lag++){
      let xy=0,xx=0,yy=0;
      for(let k=0;k<width-maxLag;k+=2){const a=filtered[start+k],b=filtered[start+k+lag];xy+=a*b;xx+=a*a;yy+=b*b;}
      corr.push(xy/Math.sqrt(xx*yy||1));
    }
    let best=-1;
    for(let k=1;k<corr.length-1;k++)if(corr[k]>.6&&corr[k]>=corr[k-1]&&corr[k]>=corr[k+1]&&(best<0||corr[k]>corr[best]+.03))best=k;
    if(best>=0){frame.pitch_hz=sampleRate/(minLag+best);frame.pitch_confidence=corr[best];}
  }
  const segments=[];let begin=null;
  for(let i=0;i<=frames.length;i++){
    if(frames[i]?.active&&begin===null)begin=i;
    if(!frames[i]?.active&&begin!==null){const end=i-1;if(frames[end].end_s-frames[begin].start_s>=.1)segments.push({start_s:frames[begin].start_s,end_s:frames[end].end_s,label:'unreviewed'});begin=null;}
  }
  // Merge gaps shorter than 100 ms. These remain unreviewed acoustic events.
  const merged=[];for(const s of segments){const prev=merged.at(-1);if(prev&&s.start_s-prev.end_s<.1)prev.end_s=s.end_s;else merged.push({...s});}
  const pitch=frames.map(f=>f.pitch_hz).filter(Number.isFinite),active=frames.filter(f=>f.active);
  const intervals=merged.slice(1).map((s,i)=>s.start_s-merged[i].start_s);
  return {format:'infant-audio/v1',summary:{method_version:'energy-autocorrelation/1.0',duration_s:samples.length/sampleRate,sample_rate:sampleRate,config:{gate_db,pitch_min,pitch_max,highpass_hz:80,frame_ms:40,hop_ms:20,pitch_hop_ms:100},noise_floor_dbfs:noise,active_threshold_dbfs:threshold,clipping_fraction:clipped/samples.length,active_fraction:frames.length?active.length/frames.length:0,event_count:merged.length,events_per_minute:merged.length/(samples.length/sampleRate)*60,pitch_median_hz:quantile(pitch,.5),pitch_iqr_hz:pitch.length?quantile(pitch,.75)-quantile(pitch,.25):null,pitch_samples:pitch.length,zcr_mean:mean(active.map(f=>f.zcr)),event_interval_mean_s:mean(intervals),event_interval_sd_s:intervals.length?Math.sqrt(mean(intervals.map(x=>(x-mean(intervals))**2))):null,reviewed_infant_events:0,interpretation:'Energy events may include adult speech or noise. Pitch is an unvalidated estimate; review required. No automated syllable, babbling or diagnostic classification.'},frames,segments:merged};
}

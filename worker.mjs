import * as ort from './vendor/ort.wasm.min.mjs';
import {preprocess,decode} from './pose.mjs';
import {analyzeTracks} from './metrics.mjs?v=0.4.0';

let session,manifest;
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
async function loadModel(id) {
  if(session)return manifest;
  ort.env.wasm.numThreads=1; // GitHub Pages does not supply COOP/COEP headers.
  ort.env.wasm.wasmPaths=new URL('./vendor/',import.meta.url).href;
  const response=await fetch(new URL('./assets/model.json',import.meta.url));
  if(!response.ok)throw Error('找不到模型清單，請確認部署包含 assets 資料夾');
  manifest=await response.json();
  const bytes=new Uint8Array(manifest.bytes);let offset=0;
  for(const part of manifest.parts) {
    self.postMessage({id,progress:`正在載入模型 ${Math.round(offset/manifest.bytes*100)}%（約 54 MB）`});
    const r=await fetch(new URL('./assets/'+part.file,import.meta.url));
    if(!r.ok)throw Error(`模型檔案 ${part.file} 下載失敗（${r.status}）`);
    const chunk=new Uint8Array(await r.arrayBuffer());
    if(chunk.byteLength!==part.bytes||await digest(chunk)!==part.sha256)throw Error(`模型檔案 ${part.file} 不完整`);
    bytes.set(chunk,offset);offset+=chunk.byteLength;
  }
  if(offset!==manifest.bytes||await digest(bytes)!==manifest.sha256)throw Error('模型 SHA256 驗證失敗');
  self.postMessage({id,progress:'正在啟動 RTMPose，首次載入需稍候…'});
  session=await ort.InferenceSession.create(bytes,{executionProviders:['wasm'],graphOptimizationLevel:'all'});
  return manifest;
}
self.onmessage=async event=>{
  const {id,type}=event.data;
  try {
    let result;
    if(type==='init')result=await loadModel(id);
    else if(type==='predict') {
      if(!session)throw Error('請先載入模型');
      const {bitmap,roi}=event.data;
      let pixels,width,height;
      if(bitmap) {
        width=bitmap.width;height=bitmap.height;
        const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d',{willReadFrequently:true});
        ctx.drawImage(bitmap,0,0);bitmap.close();pixels=ctx.getImageData(0,0,width,height).data;
      }else {({width,height}=event.data);pixels=new Uint8ClampedArray(event.data.pixels);}
      const input=preprocess(pixels,width,height,roi);
      const started=performance.now();
      const outputs=await session.run({[session.inputNames[0]]:new ort.Tensor('float32',input,[1,3,256,192])});
      const tensors=Object.values(outputs),x=tensors.find(t=>t.dims.at(-1)===384),y=tensors.find(t=>t.dims.at(-1)===512);
      if(!x||!y)throw Error('RTMPose 模型輸出格式不符');
      result={...decode(x.data,y.data,roi,width,height),latency_ms:performance.now()-started};
      for(const value of tensors)value.dispose?.();
    }else if(type==='measure')result=analyzeTracks(event.data.times,event.data.xy,event.data.scores,event.data.config);
    else throw Error('不支援的操作');
    self.postMessage({id,result});
  }catch(error){self.postMessage({id,error:error.message||String(error)});}
};

import fs from 'node:fs';
import {analyzeTracks} from '../metrics.mjs';
const [input,output,confidence='.2']=process.argv.slice(2);
if(!input||!output)throw Error('Usage: node scripts/measure_tracks.mjs raw.json result.json [confidence]');
const raw=JSON.parse(fs.readFileSync(input,'utf8'));
const result=analyzeTracks(raw.times,raw.xy,raw.scores,{confidence:Number(confidence)});
fs.writeFileSync(output,JSON.stringify(result,null,2));
console.log(JSON.stringify({frames:result.summary.frames,schema:result.summary.schema_version,features:result.summary.features.length}));

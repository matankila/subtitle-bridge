import {buildRequestBody,buildTranslateUrl,parseResponse} from './vendor/google-core.mjs';
import {AddonError,plain} from './subtitles.mjs';
export function selectGoogleBatch(units,maxUnits=48){
 const result=[];let chars=0;
 for(const unit of units){
  if(unit.translated)continue;
  const size=`@@STREMIO_IDX_${result.length}@@ ${unit.text}\n`.length;
  if(result.length>=maxUnits||chars+size>4500)break;
  result.push(unit);chars+=size;
 }
 return result;
}
export async function googleTranslate(text,target,fetcher=fetch){
  const response=await fetcher(buildTranslateUrl(),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:buildRequestBody(text,'en',target),redirect:'manual',signal:AbortSignal.timeout(20000)});
  if(!response.ok){await response.body?.cancel();throw new AddonError('GOOGLE_UNAVAILABLE',`Google translation unavailable (HTTP ${response.status}). Retry later or configure a fallback.`,503);}
  const reader=response.body?.getReader();if(!reader)throw new AddonError('GOOGLE_RESPONSE','Empty Google response.');
  let size=0;const chunks=[];try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>250000)throw new AddonError('GOOGLE_RESPONSE','Google response is too large.');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  const parsed=parseResponse(new TextDecoder().decode(bytes));
  if(!parsed.success||!plain(parsed.text))throw new AddonError('GOOGLE_RESPONSE','Google did not return usable translated text.');
  return plain(parsed.text);
}
export async function googleBatch(texts,target,fetcher=fetch){
  if(texts.length===1)return [await googleTranslate(texts[0],target,fetcher)];
  if(texts.some(t=>/STREMIO_IDX/i.test(t)))throw new AddonError('GOOGLE_ALIGNMENT','Reserved batch marker in source.');
  const source=texts.map((t,i)=>`@@STREMIO_IDX_${i}@@ ${t}`).join('\n');
  const output=await googleTranslate(source,target,fetcher);
  const matches=[...output.matchAll(/(?:@@\s*)?STREMIO[\s_-]*IDX[\s_-]*(\d+)(?:\s*@@)?/gi)];
  if(matches.length!==texts.length||matches.some((m,i)=>Number(m[1])!==i))throw new AddonError('GOOGLE_ALIGNMENT','Google changed subtitle markers. Translation paused to preserve cue alignment.');
  const result=matches.map((m,i)=>output.slice(m.index+m[0].length,matches[i+1]?.index??output.length).trim());
  if(result.some(t=>!t))throw new AddonError('GOOGLE_ALIGNMENT','Google returned an empty subtitle cue.');
  return result;
}

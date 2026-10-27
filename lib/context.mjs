import {singleReferenceNumber} from './hebrew.mjs';
import {language} from './subtitles.mjs';
export const CONTEXT_VERSION='references-v2';
export function referenceTracks(tracks){
 const out=[];
 for(const lang of ['fr','es','ru']){
  const candidates=tracks.filter(t=>language(t.lang_code||t.lang)===lang&&t.ai_translated===false&&t.machine_translated!==true&&!t.foreign_parts_only).sort((a,b)=>Number(Boolean(b.from_trusted))-Number(Boolean(a.from_trusted)));
  if(candidates[0])out.push({...candidates[0],sourceLang:lang});
 }
 return out.slice(0,3);
}
// Strict local timing match. Reject drift instead of guessing an offset or matching
// cue numbers. One English passage may correspond to up to three foreign cues.
export function alignedText(cues,start,end){
 const hits=cues.filter(c=>c.end>start&&c.start<end);
 if(!hits.length||hits.length>3)return null;
 if(Math.abs(hits[0].start-start)>250||Math.abs(hits.at(-1).end-end)>250)return null;
 const coverage=hits.reduce((n,c)=>n+Math.max(0,Math.min(end,c.end)-Math.max(start,c.start)),0)/(end-start);
 if(coverage<0.85||hits.some((c,i)=>i&&c.start-hits[i-1].end>500))return null;
 const text=hits.map(c=>c.text).join(' ');return text.length<=450?text:null;
}
export function attachReferences(data,tracks){
 let eligible=0;
 for(let i=0;i<data.units.length;i++){
  if(!/\b(you|your|yours|i|we|they|them|their|he|she|his|her|ready|sure|afraid|tired)\b/i.test(data.units[i].text))continue;
  const slots=data.cues.filter(c=>c.parts.includes(i));
  // Repeated text at multiple distinct scenes cannot share contextual inference.
  if(!slots.length||(!data.units[i].originals&&slots.length!==1)||slots.some(c=>c.parts.length!==1))continue;
  const start=slots[0].start,end=slots.at(-1).end;
  const refs=tracks.map(t=>({lang:t.sourceLang,text:alignedText(t.cues,start,end),url:t.url,uploader:t.uploader_id||null})).filter(r=>r.text);
  if(!refs.length)continue;
  // Known same-uploader tracks are not treated as independent votes.
  if(refs.length>1&&refs[0].uploader&&refs[0].uploader===refs[1].uploader)refs.splice(1);
  data.units[i].references=refs.slice(0,2);eligible++;
 }
 data.context={version:CONTEXT_VERSION,referenceTracks:tracks.map(t=>({language:t.sourceLang,url:t.url,trusted:Boolean(t.from_trusted)})),eligiblePassages:eligible,consensusApplied:0,singleReferenceApplied:0};
 return data;
}
const normalize=s=>s.normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu,'').toLowerCase();
function similarity(a,b){
 const x=Array.from(normalize(a)),y=Array.from(normalize(b));if(Math.max(x.length,y.length)>500)return 0;
 let row=Array.from({length:y.length+1},(_,i)=>i);
 for(let i=1;i<=x.length;i++){const next=[i];for(let j=1;j<=y.length;j++)next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+Number(x[i-1]!==y[j-1]));row=next;}
 return 1-row[y.length]/Math.max(1,x.length,y.length);
}
// This is conservative agreement scoring, not semantic understanding. Preserve
// English whenever references disagree or propose a substantially different line.
export function chooseConsensus(baseline,alternatives){
 if(alternatives.length<2||alternatives.some(s=>!s))return {text:baseline,applied:false};
 if(normalize(alternatives[0])!==normalize(alternatives[1]))return {text:baseline,applied:false};
 const candidate=alternatives[0],score=similarity(candidate,baseline);
 const genderFold=s=>s.replace(/(?<![\p{L}])(אתה|את|מוכן|מוכנה|עייף|עייפה|בטוח|בטוחה|מפחד|מפחדת)(?![\p{L}])/gu,w=>({אתה:'את',את:'את',מוכן:'מוכנ',מוכנה:'מוכנ',עייף:'עייפ',עייפה:'עייפ',בטוח:'בטוח',בטוחה:'בטוח',מפחד:'מפחד',מפחדת:'מפחד'}[w]));
 if((score<0.7&&normalize(genderFold(candidate))!==normalize(genderFold(baseline)))||normalize(candidate)===normalize(baseline))return {text:baseline,applied:false};
 // Do not accept changed numbers, which often identify contradictory references.
 const numbers=s=>(s.match(/\d+(?:[.,]\d+)*/g)||[]).join('|');
 if(numbers(candidate)!==numbers(baseline))return {text:baseline,applied:false};
 const negations=s=>(s.match(/(?<![\p{L}])(לא|אין|בלי|אל|אינני|אינו|אינה)(?![\p{L}])/gu)||[]).sort().join('|');
 if(negations(candidate)!==negations(baseline))return {text:baseline,applied:false};
 return {text:candidate,applied:true};
}
export function translationRequests(units){
 return units.flatMap(unit=>{
  if(unit.translated)return [];
  if(!unit.baseline)return [{unit,text:unit.text,lang:'en',kind:'baseline'}];
  return (unit.references||[]).map((r,i)=>({unit,text:r.text,lang:r.lang,kind:i})).filter(r=>!unit.referenceOutputs?.[r.kind]);
 });
}
export function applyResponses(requests,outputs,data){
 requests.forEach((r,i)=>{if(!outputs[i])return;if(r.kind==='baseline')r.unit.baseline=outputs[i];else{r.unit.referenceOutputs??=[];r.unit.referenceOutputs[r.kind]=outputs[i];}});
 for(const unit of new Set(requests.map(r=>r.unit))){
  if(!unit.baseline)continue;
  if(!unit.references?.length){unit.translated=unit.baseline;continue;}
  if(unit.references.length===1){const result=singleReferenceNumber(unit.sourceText||unit.text,unit.baseline,unit.references[0]);unit.translated=result.text;unit.contextDecision=result.applied?'explicit-singular-reference':'english-fallback';if(result.applied&&data.context){data.context.singleReferenceApplied++;data.context.consensusApplied++;}continue;}
  if(unit.references.every((_,i)=>unit.referenceOutputs?.[i])){
   const result=chooseConsensus(unit.baseline,unit.referenceOutputs);unit.translated=result.text;unit.contextDecision=result.applied?'reference-agreement':'english-fallback';if(result.applied&&data.context)data.context.consensusApplied++;
  }
 }
}

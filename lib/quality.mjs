// Conservative sentence reconstruction. Never join speaker turns, captions,
// sentences that are already complete, long gaps, or ambiguous uppercase starts.
export function sentenceGroups(cues){
 const groups=[];
 for(let i=0;i<cues.length;){
  const group=[cues[i++]];
  while(i<cues.length&&group.length<3){
   const previous=group.at(-1),next=cues[i],combined=[...group,next].map(c=>c.text).join(' ');
   const linkedPause=/\b(?:you|we|i|he|she|they)\.\.\.$/i.test(previous.text.trim())&&/^and (?:I|you|we)\b/.test(next.text.trim());
   if((!linkedPause&&/[.!?…:;]["'”’)]?$/.test(previous.text.trim()))||!/^\p{Ll}/u.test(next.text.trim())||/[\n]|^\s*[-–—[♪]/u.test(next.text)||/^\s*[-–—[♪]/u.test(previous.text)||next.start<previous.end||next.start-previous.end>(linkedPause?1800:400)||next.end-group[0].start>9000||new TextEncoder().encode(combined).length>450)break;
   group.push(next);i++;
  }
  groups.push(group);
 }
 return groups;
}
// Allocate whole words to original cue slots. Reserve at least one per cue.
export function distributeSentence(text,sources){
 const words=text.trim().split(/\s+/);if(words.length<sources.length)return null;
 const weights=sources.map(s=>Math.max(1,s.trim().split(/\s+/).length)),total=weights.reduce((a,b)=>a+b,0);let used=0,weight=0;
 return sources.map((_,i)=>{weight+=weights[i];const end=i===sources.length-1?words.length:Math.max(used+1,Math.min(words.length-(sources.length-i-1),Math.round(words.length*weight/total)));const part=words.slice(used,end).join(' ');used=end;return part;});
}
export function applyGlossary(text,entries={}){
 for(const [source,target] of Object.entries(entries)){
  if(typeof target!=='string'||!source||source.length>80||target.length>80)continue;
  const escaped=source.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  text=text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`,'gu'),()=>target);
 }
 return text;
}
export function makeQualityWork(cues,makeWork){
 const data={cues:[],units:[],qualityVersion:1},dedup=new Map();
 for(const group of sentenceGroups(cues)){
  if(group.length===1){const work=makeWork(group),indices=work.units.map(u=>{if(!dedup.has(u.text)){dedup.set(u.text,data.units.length);data.units.push(u);}return dedup.get(u.text);});data.cues.push(...work.cues.map(c=>({...c,parts:c.parts.map(p=>indices[p])})));continue;}
  const index=data.units.length;
  data.units.push({text:group.map(c=>c.text).join(' '),translated:null,attempts:0,originals:group.map(c=>c.text)});
  data.cues.push(...group.map((c,slot)=>({start:c.start,end:c.end,parts:[index],qualitySlot:slot})));
 }
 return data;
}
export function resolveQuality(data,glossary={},polish=(source,text)=>text){
 for(let index=0;index<data.units.length;index++){
  const unit=data.units[index];if(!unit.translated)continue;
  unit.translated=applyGlossary(polish(unit.sourceText||unit.text,unit.translated),glossary);
  if(!unit.originals)continue;
  const sources=unit.originals,parts=distributeSentence(unit.translated,sources),slots=data.cues.filter(c=>c.parts.length===1&&c.parts[0]===index&&c.qualitySlot!==undefined);
  // A shortened output that cannot fill every cue is retried as separate text.
  const indices=sources.map((text,i)=>{if(i===0){unit.text=text;unit.translated=parts?.[i]||null;return index;}data.units.push({text,translated:parts?.[i]||null,attempts:0});return data.units.length-1;});
  for(const cue of slots){cue.parts=[indices[cue.qualitySlot]];delete cue.qualitySlot;}
  delete unit.originals;
 }
 return data;
}

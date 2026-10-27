import {applyGlossary} from './quality.mjs';
export const POLISH_VERSION='hebrew-v3';
// Project editorial defaults, not an official Hebrew localization. Every rule
// requires its English source term and the exact series identity.
const bleach=[
 [['Soul Society'],['Soul Society','חברת הנשמה','חברת הנשמות','אגודת הנשמות'],'סול סוסייטי'],
 [['Yhwach'],['Yhwach','יהוה'],'יוהאבך'],
 [['Bankai'],['Bankai','בנקאיי','באנקאי'],'בנקאי'],
 [['Hyorinmaru'],['Hyorinmaru'],'היורינמארו'],
 [['Zanka no Tachi'],['Zanka no Tachi',"זאנקה נו טאצ׳י"],"זאנקה נו טאצ'י"],
 [['Soul Reapers'],['Soul Reapers'],'מלאכי מוות'],
 [['Soul Reaper'],['Soul Reaper'],'מלאך מוות'],
 [['Quincies'],['Quincies','קווינסיס'],'קווינסים'],
 [['Hollows'],['Hollows','הולווז'],'הולואים'],
 [['Squad 1'],['Squad 1'],'יחידה 1'],
 [['Shigekuni Yamamoto'],['Shigekuni Yamamoto'],'שיגקוני יאמאמוטו'],
 [['Genryusai Yamamoto'],['Genryusai Yamamoto'],'גנריוסאי יאמאמוטו'],
 [['Ichigo'],['Ichigo'],'איצ׳יגו'],[['Rukia'],['Rukia'],'רוקיה'],[['Aizen'],['Aizen'],'אייזן'],
];
export function profileFor(mediaId){return ['tt14986406','tt0434665'].includes(mediaId)?'bleach':null;}
export function editorialEntities(mediaId){return profileFor(mediaId)==='bleach'?bleach.map(([names,variants,he])=>({name:names[0],aliases:names.slice(1),variants,he,kind:'other',gender:'unknown',evidence:{cue:0,quote:'Project editorial default'}})):[];}
function replaceTerm(text,from,to){
 if(!/^[א-ת]/.test(from))return applyGlossary(text,{[from]:to});
 const escaped=from.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 return text.replace(new RegExp(`(?<![\\p{L}\\p{N}])([ובכלמשה]{0,2})${escaped}(?![\\p{L}\\p{N}])`,'gu'),(_,prefix)=>prefix+to);
}
export function prepareEnglish(text){
 return text.replace(/\b(focused)(?=\s+(?:all\s+)?(?:the\s+)?heat\b)/gi,'concentrated')
  .replace(/\bwhisk\s+(it|them|him|her|us|me)\s+away\b/gi,'carry $1 away');
}
export function polishHebrew(source,text,profile=null){
 if(profile==='bleach')for(const [triggers,variants,preferred] of bleach){
  if(triggers.some(t=>new RegExp(`\\b${t}\\b`,'i').test(source))){
   for(const variant of variants)text=replaceTerm(text,variant,preferred);
   const escaped=preferred.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
   text=text.replace(new RegExp(`([ובכלמשה])-(${escaped})`,'gu'),'$1$2');
  }
 }
 // Phrase-level repairs require matching English intent and matching bad output.
 if(/^\s*now then[.!…\s]*$/i.test(source)&&/^עכשיו אז[.!…\s]*$/.test(text))text='ובכן...';
 if(/\bpetal\b/i.test(source))text=text.replace(/(?<![\p{L}])על כותרת(?![\p{L}])/gu,'עלה כותרת');
 if(/\bfocused\s+(?:all\s+)?(?:the\s+)?heat\b/i.test(source))text=text.replace(/(?<![\p{L}])(?:התמקדתי|התרכזתי)(?= כל חום)/gu,'ריכזתי את');
 if(/\bscorched\b[\s\S]*\bsword\b/i.test(source))text=replaceTerm(text,'צרוכה','חרוכה');
 if(profile==='bleach'&&/^Please settle this quickly[.…\s]*$/i.test(source))text=text.replace('בבקשה תסדיר את זה מהר','בבקשה סיים את זה מהר');
 return text;
}
// One source can justify a narrow singular-address correction, not a general
// retranslation or inferred speaker gender. Written past forms stay gender-neutral.
export function singleReferenceNumber(source,baseline,reference){
 if(!reference)return {text:baseline,applied:false};
 const singular=reference.lang==='es'?/(?:^|[\s¿¡])(?:te\s+)?(?:aseguraste|dijiste|hiciste|fuiste|viste|supiste|quisiste|entendiste|escuchaste|pensaste|decidiste|intentaste|diste|tomaste|dejaste)\b/i.test(reference.text):reference.lang==='fr'?/\btu\b/i.test(reference.text):reference.lang==='ru'?/(?<!\p{L})ты(?!\p{L})/iu.test(reference.text):false;
 if(!singular)return {text:baseline,applied:false};
 const rules=[[/\byou (?:made sure|ensured)\b/i,'וידאתם','וידאת'],[/\byou said\b/i,'אמרתם','אמרת'],[/\byou did\b/i,'עשיתם','עשית'],[/\byou saw\b/i,'ראיתם','ראית'],[/\byou knew\b/i,'ידעתם','ידעת'],[/\byou understood\b/i,'הבנתם','הבנת'],[/\byou decided\b/i,'החלטתם','החלטת']];
 let text=baseline;for(const [guard,from,to] of rules)if(guard.test(source))text=applyGlossary(text,{[from]:to});
 return {text,applied:text!==baseline};
}
